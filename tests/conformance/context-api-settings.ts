/**
 * The Settings side of the `ContextApi` conformance suite (FR-801, FR-804, FR-806 to FR-810,
 * FR-410, FR-120): settings and their versions, roles and area roles, areas, the history log,
 * the operations view, the MCP traffic and item import. The same steps run against the mock
 * binding (tests/unit/mock-settings.test.ts) and against the http binding on the real service and
 * PostgreSQL (tests/integration/api-settings.test.ts), so the screens' mock keeps the service's
 * rules. Ids, times and counts differ between the two and are not compared; everything a screen
 * branches on is.
 *
 * The people are the fixture's: Ravi is an administrator, Ella an auditor, Jon the owner of
 * Sales and Sandbox, Tomas the owner of Marketing, and Kofi has no role.
 */
import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import type { ContextApi } from '../../src/web/api/client.ts'
import { ApiError } from '../../src/web/api/errors.ts'
import { settingKeys } from '../../src/contract/admin.ts'
import { lastOwnerMessage } from '../../src/contract/auth.ts'

export const settingsPeople = ['ravi', 'ella', 'jon', 'tomas', 'kofi'] as const
export type SettingsPerson = (typeof settingsPeople)[number]
export type SettingsSignedIn = Record<SettingsPerson, ContextApi>

export type SettingsConformanceOptions = {
  /** The binding's id for a fixture person, for example `per_kofi`. */
  personId: (fixtureId: string) => string
}

/** Resolves to the `ApiError` a call is refused with; fails the test when it succeeds. */
async function refusal(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('Expected the call to be refused')
}

/** A new item the live vocabulary resolves, as the write suite drafts it. */
const newItem = {
  areaId: 'area_sandbox',
  title: 'Norway closure, imported',
  summary: 'Online sales to Norway stopped',
  scope: {
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
  },
  validity: { start: '2026-08-04', end: null },
  evidence: [
    { url: 'https://example.test/law', quote: 'Online sales stopped', date: '2026-08-04' },
  ],
}

export function describeContextApiSettings(
  name: string,
  signedIn: () => SettingsSignedIn,
  { personId }: SettingsConformanceOptions,
) {
  describe(`ContextApi settings conformance: ${name}`, () => {
    const as = (person: SettingsPerson) => signedIn()[person]

    it('lists every setting the API changes, and refuses anyone but an administrator', async () => {
      const settings = await as('ravi').listSettings()
      for (const key of settingKeys)
        expect(
          settings.find((setting) => setting.key === key),
          key,
        ).toMatchObject({
          editable: true,
        })
      expect((await refusal(as('kofi').listSettings())).kind).toBe('forbidden')
      expect((await refusal(as('ella').listSettings())).kind).toBe('forbidden')
    })

    it('writes a first version of About our business from what Heed knows, for administrators only, and saves nothing', async () => {
      const key = 'business.about'
      const before = (await as('ravi').listSettings()).find((setting) => setting.key === key)!
      const draft = await as('ravi').draftAboutBusiness()
      // The domains, then the words; no number, and room left for what the company does.
      expect(draft.text).toMatch(/^We keep our facts in these domains: .*Sales/)
      expect(draft.text).not.toMatch(/\d/)
      expect([...draft.text].length).toBeLessThanOrEqual(1000)
      // The same facts give the same draft.
      expect(await as('ravi').draftAboutBusiness()).toEqual(draft)
      const after = (await as('ravi').listSettings()).find((setting) => setting.key === key)!
      expect(after.version).toBe(before.version)
      for (const person of ['jon', 'ella', 'tomas', 'kofi'] as const)
        expect((await refusal(as(person).draftAboutBusiness())).kind, person).toBe('forbidden')
    })

    it('changes a setting as a new version with a reason, newest first in its history', async () => {
      const key = 'review.open_issue_days'
      const before = (await as('ravi').listSettings()).find((setting) => setting.key === key)!
      const saved = await as('ravi').setSetting({
        key,
        version: before.version,
        value: 21,
        reason: 'Conformance: a longer wait before asking',
      })
      expect(saved).toMatchObject({
        key,
        version: before.version + 1,
        value: 21,
        reason: 'Conformance: a longer wait before asking',
        changedBy: personId('per_ravi'),
      })
      const history = await as('ravi').getSettingHistory(key)
      expect(history.map((version) => version.version)).toEqual(
        [...history.map((version) => version.version)].sort((a, b) => b - a),
      )
      expect(history[0]).toMatchObject({ version: saved.version, value: 21 })

      // The version read is stale now: the change is refused, not applied over the newer one.
      expect(
        (
          await refusal(
            as('ravi').setSetting({ key, version: before.version, value: 7, reason: 'Stale' }),
          )
        ).kind,
      ).toBe('conflict')
      // A value the setting does not accept is refused with the reason in words.
      expect(
        (
          await refusal(
            as('ravi').setSetting({ key, version: saved.version, value: 0, reason: 'Too short' }),
          )
        ).kind,
      ).toBe('invalid')
      expect(
        (
          await refusal(
            as('jon').setSetting({ key, version: saved.version, value: 9, reason: 'Owner' }),
          )
        ).kind,
      ).toBe('forbidden')

      // Put it back, so the rest of the suite and the next run see the default.
      await as('ravi').setSetting({
        key,
        version: saved.version,
        value: before.value,
        reason: 'Conformance: back to the default',
      })

      // The history log records the change, under the setting, by the administrator.
      const log = await as('ravi').searchAudit({ action: 'setting', subjectId: key, limit: 5 })
      expect(log.entries[0]).toMatchObject({
        action: 'setting.changed',
        subjectType: 'setting',
        subjectId: key,
        actorId: personId('per_ravi'),
      })
    })

    it('finds people by name or email, with their roles, for administrators and auditors only', async () => {
      const kofi = personId('per_kofi')
      const byName = await as('ravi').searchPeople({ q: 'kofi' })
      expect(byName.people.map((person) => person.id)).toEqual([kofi])
      expect(byName.people[0]).toMatchObject({
        name: 'Kofi Mensah',
        email: 'per_kofi@example.test',
        status: 'active',
        roles: [],
      })
      expect((await as('ravi').searchPeople({ q: 'PER_KOFI@' })).people[0]?.id).toBe(kofi)
      // The start of a name ranks before a match inside one.
      const words = (await as('ravi').searchPeople({ q: 'jo' })).people.map((p) => p.name)
      expect(words[0]).toBe('Jon Abara')
      const jon = (await as('ravi').searchPeople({ q: 'jon abara' })).people[0]
      expect(jon?.roles).toEqual(
        expect.arrayContaining([
          { role: 'owner', areaId: 'area_sales' },
          { role: 'owner', areaId: 'area_sandbox' },
        ]),
      )
      const owners = await as('ravi').searchPeople({ role: 'owner' })
      expect(owners.people.map((person) => person.name)).toEqual(
        expect.arrayContaining(['Jon Abara', 'Tomas Eriksen']),
      )
      const marketing = await as('ravi').searchPeople({ role: 'owner', areaId: 'area_marketing' })
      expect(marketing.people.map((person) => person.name)).toEqual(['Tomas Eriksen'])
      const none = (await as('ravi').searchPeople({ role: 'none' })).people.map((p) => p.id)
      expect(none).toContain(kofi)
      expect(none).not.toContain(personId('per_ravi'))
      const first = await as('ravi').searchPeople({ limit: 2 })
      expect(first).toMatchObject({ next: 2 })
      expect(first.people).toHaveLength(2)
      expect(first.total).toBeGreaterThanOrEqual(5)
      // Auditors find people for the history log's filter; everyone else is refused.
      expect((await as('ella').searchPeople({ q: 'kofi' })).total).toBe(1)
      expect((await refusal(as('kofi').searchPeople({ q: 'ravi' }))).kind).toBe('forbidden')
      expect((await refusal(as('ravi').searchPeople({ limit: 101 }))).kind).toBe('bad-request')
    })

    it("shows a person's roles and their history on the sheet, for administrators", async () => {
      const kofi = personId('per_kofi')
      await as('ravi').applyGrants({
        changes: [{ op: 'grant', personId: kofi, role: 'auditor' }],
        reason: 'Conformance: reads the log for a month',
      })
      const held = await as('ravi').getPersonSheet(kofi)
      expect(held?.grants).toEqual([
        expect.objectContaining({ role: 'auditor', areaId: null, grantedBy: personId('per_ravi') }),
      ])
      await as('ravi').applyGrants({ changes: [{ op: 'revoke', personId: kofi, role: 'auditor' }] })
      const sheet = await as('ravi').getPersonSheet(kofi)
      expect(sheet?.person).toMatchObject({ id: kofi, name: 'Kofi Mensah', roles: [] })
      expect(sheet?.grants).toEqual([])
      expect(sheet?.history.slice(0, 2)).toEqual([
        expect.objectContaining({
          change: 'revoked',
          role: 'auditor',
          actorName: 'Ravi Kapoor',
          reason: null,
        }),
        // The step's reason is on the sheet with the change it was given for.
        expect.objectContaining({
          change: 'granted',
          role: 'auditor',
          actorName: 'Ravi Kapoor',
          reason: 'Conformance: reads the log for a month',
        }),
      ])
      expect(await as('ravi').getPersonSheet('00000000-0000-4000-8000-0000000000ff')).toBeNull()
      expect((await refusal(as('ella').getPersonSheet(kofi))).kind).toBe('forbidden')
    })

    it('gives and removes a role, and a role already held changes nothing', async () => {
      const kofi = personId('per_kofi')
      const auditor = { personId: kofi, role: 'auditor' } as const
      const given = await as('ravi').applyGrants({ changes: [{ op: 'grant', ...auditor }] })
      expect(given.changes).toEqual([{ op: 'grant', ...auditor, changed: true }])
      expect(
        (await as('ravi').applyGrants({ changes: [{ op: 'grant', ...auditor }] })).changes,
      ).toEqual([{ op: 'grant', ...auditor, changed: false }])
      const grants = await as('ravi').listGrants()
      expect(grants.roles).toContainEqual(expect.objectContaining(auditor))
      // The role applies at once: Kofi reads the history log, and his session says so.
      expect((await as('kofi').getSession()).person.permissions.roles).toContain('auditor')
      expect((await as('kofi').searchAudit({ limit: 1 })).entries).toHaveLength(1)
      // The change is in the log with its batch id, the source and no reason.
      const log = await as('ravi').searchAudit({ batchId: given.batchId })
      expect(log.entries).toEqual([
        expect.objectContaining({
          action: 'role.granted',
          subjectId: kofi,
          batchId: given.batchId,
          reason: null,
          source: 'named',
        }),
      ])
      await as('ravi').applyGrants({ changes: [{ op: 'revoke', ...auditor }] })
      expect((await refusal(as('kofi').searchAudit({ limit: 1 }))).kind).toBe('forbidden')
      expect(
        (
          await refusal(
            as('jon').applyGrants({
              changes: [{ op: 'grant', personId: kofi, role: 'administrator' }],
            }),
          )
        ).kind,
      ).toBe('forbidden')
    })

    it('gives many roles in one step, one history entry each with the batch id and the reason', async () => {
      const kofi = personId('per_kofi')
      const ella = personId('per_ella')
      const changes = [
        { op: 'grant', personId: kofi, areaId: 'area_marketing', role: 'approver' },
        { op: 'grant', personId: ella, areaId: 'area_marketing', role: 'approver' },
      ] as const
      const step = await as('ravi').applyGrants({ changes: [...changes], reason: 'Conformance' })
      expect(step.changes.map((change) => change.changed)).toEqual([true, true])
      expect((await as('ravi').getArea('area_marketing'))?.approverIds).toEqual(
        expect.arrayContaining([kofi, ella]),
      )
      const log = await as('ravi').searchAudit({ batchId: step.batchId })
      expect(log.entries.map((entry) => [entry.action, entry.reason, entry.source])).toEqual([
        ['assignment.granted', 'Conformance', 'named'],
        ['assignment.granted', 'Conformance', 'named'],
      ])
      await as('ravi').applyGrants({
        changes: changes.map((change) => ({ ...change, op: 'revoke' as const })),
      })
      expect((await as('ravi').getArea('area_marketing'))?.approverIds).not.toContain(kofi)
    })

    it('gives an area several owners, and replaces one in a single step', async () => {
      const kofi = personId('per_kofi')
      const tomas = personId('per_tomas')
      const marketing = { areaId: 'area_marketing' }
      const owner = (who: string) => ({ ...marketing, personId: who, role: 'owner' as const })
      // A second owner joins the first: no seat to free first.
      const added = await as('ravi').applyGrants({ changes: [{ op: 'grant', ...owner(kofi) }] })
      expect(added.changes.map((change) => change.changed)).toEqual([true])
      expect((await as('ravi').getArea('area_marketing'))?.ownerIds).toEqual([tomas, kofi])
      expect(
        (await as('ravi').listAreas()).find((area) => area.id === 'area_marketing')?.ownerIds,
      ).toEqual([tomas, kofi])
      expect((await as('kofi').getSession()).person.permissions.assignments).toContainEqual({
        areaId: 'area_marketing',
        role: 'owner',
      })
      // Giving it again changes nothing.
      const again = await as('ravi').applyGrants({ changes: [{ op: 'grant', ...owner(kofi) }] })
      expect(again.changes.map((change) => change.changed)).toEqual([false])
      // Removing Tomas and keeping Kofi leaves Kofi alone; giving Tomas back in the same step as
      // removing Kofi replaces one with the other at once.
      await as('ravi').applyGrants({ changes: [{ op: 'revoke', ...owner(tomas) }] })
      expect((await as('ravi').getArea('area_marketing'))?.ownerIds).toEqual([kofi])
      await as('ravi').applyGrants({
        changes: [
          { op: 'revoke', ...owner(kofi) },
          { op: 'grant', ...owner(tomas) },
        ],
      })
      expect((await as('ravi').getArea('area_marketing'))?.ownerIds).toEqual([tomas])
    })

    it('changes all or nothing, refuses a role named twice, and keeps an administrator', async () => {
      const kofi = personId('per_kofi')
      const ravi = personId('per_ravi')
      const before = await as('ravi').listGrants()
      // The second change is refused (Heed would have no administrator), so the first is undone.
      const refused = await refusal(
        as('ravi').applyGrants({
          changes: [
            { op: 'grant', personId: kofi, role: 'auditor' },
            { op: 'revoke', personId: ravi, role: 'administrator' },
          ],
        }),
      )
      expect(refused.kind).toBe('conflict')
      expect(await as('ravi').listGrants()).toEqual(before)
      expect(
        (
          await refusal(
            as('ravi').applyGrants({
              changes: [
                { op: 'grant', personId: kofi, role: 'auditor' },
                { op: 'revoke', personId: kofi, role: 'auditor' },
              ],
            }),
          )
        ).kind,
      ).toBe('bad-request')
      // Ravi is the only administrator; he may hand the role on, not drop it.
      const lastOne = await refusal(
        as('ravi').applyGrants({
          changes: [{ op: 'revoke', personId: ravi, role: 'administrator' }],
        }),
      )
      expect(lastOne.kind).toBe('conflict')
      expect(lastOne.message).toBe(
        'This would leave no active admin. Make someone else an admin first.',
      )
      expect(await as('ravi').listGrants()).toEqual(before)
    })

    it('creates an area with nobody assigned, and edits it on the revision read', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const id = `area_conf_${suffix}`
      const created = await as('ravi').createArea({
        id,
        name: `Conformance ${suffix}`,
        label: 'lime',
        reviewDays: 5,
        chatChannel: null,
        ownerTeam: 'Data platform',
        reason: 'Conformance: a new area',
      })
      expect(created).toMatchObject({
        id,
        summary: '',
        description: '',
        ownerIds: [],
        approverIds: [],
        revision: 1,
        demo: false,
      })
      expect((await as('kofi').listAreas()).map((area) => area.id)).toContain(id)
      const edited = await as('ravi').updateArea({
        id,
        revision: created.revision,
        name: created.name,
        label: 'sky',
        reviewDays: 10,
        chatChannel: '#conformance',
        ownerTeam: null,
        summary: 'Invented numbers for the conformance suite.',
        description: '',
        reason: 'Conformance: a longer review time',
      })
      expect(edited).toMatchObject({
        label: 'sky',
        reviewDays: 10,
        summary: 'Invented numbers for the conformance suite.',
        revision: 2,
      })
      expect(
        (
          await refusal(
            as('ravi').updateArea({
              id,
              revision: created.revision,
              name: created.name,
              label: 'teal',
              reviewDays: 3,
              chatChannel: null,
              ownerTeam: null,
              summary: '',
              description: '',
              reason: 'Stale',
            }),
          )
        ).kind,
      ).toBe('conflict')
      // Names are unique.
      expect(
        (
          await refusal(
            as('ravi').createArea({
              id: `area_dup_${suffix}`,
              name: 'Sales',
              label: 'teal',
              reviewDays: 5,
              chatChannel: null,
              ownerTeam: null,
              reason: 'A taken name',
            }),
          )
        ).kind,
      ).toBe('conflict')
      expect((await refusal(as('jon').getArea(id))).kind).toBe('forbidden')
      const log = await as('ravi').searchAudit({ areaId: id, limit: 10 })
      expect(log.entries.map((entry) => entry.action)).toEqual(['area.changed', 'area.created'])
    })

    it("lets a domain's owner or an administrator say what it is, and nobody else", async () => {
      // Jon is Sales's owner; Tomas is Marketing's, not Sales's.
      const sales = (await as('jon').listAreas()).find((a) => a.id === 'area_sales')!
      const about = {
        summary: 'Revenue and payments, by market.',
        description: 'Sales covers **net revenue**, orders and returns.\n\n- Ask Jon first.',
      }
      const refused = await refusal(
        as('tomas').describeArea({ id: sales.id, revision: sales.revision, ...about }),
      )
      expect(refused.kind).toBe('forbidden')
      const saved = await as('jon').describeArea({
        id: sales.id,
        revision: sales.revision,
        ...about,
      })
      expect(saved).toMatchObject({ ...about, revision: sales.revision + 1 })
      // Everyone reads it with the domain, at once.
      expect((await as('kofi').listAreas()).find((a) => a.id === sales.id)).toMatchObject(about)
      // An edit on the revision read before is a conflict, so no edit is lost unseen.
      expect(
        (
          await refusal(
            as('ravi').describeArea({
              id: sales.id,
              revision: sales.revision,
              summary: '',
              description: '',
            }),
          )
        ).kind,
      ).toBe('conflict')
      // A summary is one line of at most 160 characters.
      for (const summary of ['x'.repeat(161), 'Two\nlines'])
        expect(
          (
            await refusal(
              as('jon').describeArea({
                id: sales.id,
                revision: saved.revision,
                summary,
                description: '',
              }),
            )
          ).kind,
        ).toBe('bad-request')
      // Everyone reads it, so it holds no person's email or phone number and no secret.
      const sensitive = await refusal(
        as('jon').describeArea({
          id: sales.id,
          revision: saved.revision,
          summary: about.summary,
          description: 'Ask jon.abara@example.com for access.',
        }),
      )
      expect(sensitive.kind).toBe('invalid')
      expect(sensitive.findings.map((finding) => finding.code)).toEqual(['email_address'])
      // An administrator may clear it; the history log keeps each change, before and after.
      const cleared = await as('ravi').describeArea({
        id: sales.id,
        revision: saved.revision,
        summary: '',
        description: '',
      })
      expect(cleared).toMatchObject({ summary: '', description: '' })
      const log = await as('ravi').searchAudit({ areaId: sales.id, limit: 5 })
      expect(log.entries.slice(0, 2).map((entry) => [entry.action, entry.details])).toEqual([
        ['area.changed', { from: about, to: { summary: '', description: '' } }],
        [
          'area.changed',
          {
            from: { summary: sales.summary, description: sales.description },
            to: about,
          },
        ],
      ])
    })

    it('creates an area with its owners and approvers in the same step', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const id = `area_team_${suffix}`
      const kofi = personId('per_kofi')
      const ella = personId('per_ella')
      const tomas = personId('per_tomas')
      const created = await as('ravi').createArea({
        id,
        name: `Team ${suffix}`,
        label: 'teal',
        reviewDays: 5,
        chatChannel: null,
        ownerTeam: null,
        reason: 'Conformance: a staffed area',
        team: { ownerIds: [kofi, ella], approverIds: [tomas] },
      })
      // Two given in one step have the same start, so either may come first.
      expect(created).toMatchObject({ id, approverIds: [tomas] })
      expect(created.ownerIds.toSorted()).toEqual([kofi, ella].sort())
      expect((await as('kofi').getSession()).person.permissions.assignments).toContainEqual({
        areaId: id,
        role: 'owner',
      })
      const log = await as('ravi').searchAudit({ areaId: id, limit: 10 })
      expect(log.entries.map((entry) => [entry.action, entry.reason])).toEqual([
        ['assignment.granted', 'Conformance: a staffed area'],
        ['assignment.granted', 'Conformance: a staffed area'],
        ['assignment.granted', 'Conformance: a staffed area'],
        ['area.created', null],
      ])
      expect(new Set(log.entries.slice(0, 3).map((entry) => entry.batchId)).size).toBe(1)
      // One of its two owners may go; the last may not, whatever else the step does.
      await as('ravi').applyGrants({
        changes: [{ op: 'revoke', personId: ella, areaId: id, role: 'owner' }],
      })
      const last = await refusal(
        as('ravi').applyGrants({
          changes: [
            { op: 'revoke', personId: tomas, areaId: id, role: 'approver' },
            { op: 'revoke', personId: kofi, areaId: id, role: 'owner' },
          ],
        }),
      )
      expect(last).toMatchObject({
        kind: 'conflict',
        message: lastOwnerMessage(`Team ${suffix}`),
      })
      expect((await as('ravi').getArea(id))?.approverIds).toEqual([tomas])
      // The area goes, and its team with it, so the rest of the suite sees the roles it started with.
      const removal = await as('ravi').getAreaRemoval(id)
      await as('ravi').removeArea({
        id,
        revision: removal!.revision,
        confirm: 'permanently delete',
      })
      expect((await as('kofi').getSession()).person.permissions.assignments).not.toContainEqual({
        areaId: id,
        role: 'owner',
      })
    })

    it('creates a first area from a name and an id alone, and deletes one that holds nothing', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const id = `gone_${suffix}`
      const fields = {
        id,
        name: `Gone ${suffix}`,
        label: 'teal' as const,
        reviewDays: 5,
        chatChannel: null,
        ownerTeam: null,
      }
      // A new area needs no reason: creating it is its own record in the history log.
      const created = await as('ravi').createArea(fields)
      expect((await refusal(as('kofi').getAreaRemoval(id))).kind).toBe('forbidden')
      const removal = await as('ravi').getAreaRemoval(id)
      expect(removal).toMatchObject({
        id,
        name: fields.name,
        revision: created.revision,
        demo: false,
        outcome: 'delete',
        holdings: {
          items: 0,
          terms: 0,
          openProposals: 0,
          sourceMembers: 0,
          drafts: 0,
          team: 0,
          history: false,
        },
        items: [],
        terms: [],
        openProposals: [],
        drafts: [],
        team: [],
      })
      // The words, not the name, confirm it.
      for (const confirm of [fields.name, 'Permanently delete', 'permanently'])
        expect(
          (await refusal(as('ravi').removeArea({ id, revision: created.revision, confirm }))).kind,
        ).toBe('bad-request')
      const confirm = 'permanently delete'
      expect(
        (await refusal(as('ravi').removeArea({ id, revision: created.revision + 1, confirm })))
          .kind,
      ).toBe('conflict')
      expect(
        (await refusal(as('kofi').removeArea({ id, revision: created.revision, confirm }))).kind,
      ).toBe('forbidden')
      const removed = await as('ravi').removeArea({
        id,
        revision: created.revision,
        confirm,
        reason: 'Conformance: made by mistake',
      })
      expect(removed).toMatchObject({
        outcome: 'deleted',
        area: { id, name: fields.name },
        edition: null,
      })
      expect((await as('kofi').listAreas()).map((area) => area.id)).not.toContain(id)
      expect(await as('ravi').getAreaRemoval(id)).toBeNull()
      expect((await as('ravi').listArchivedAreas()).map((area) => area.id)).not.toContain(id)
      const log = await as('ravi').searchAudit({ areaId: id, limit: 10 })
      expect(log.entries.map((entry) => entry.action)).toEqual(['area.deleted', 'area.created'])
      // Undo: the same id and name are free again.
      expect(await as('ravi').createArea(fields)).toMatchObject({ id, revision: 1 })
    })

    it('never deletes the demo area', async () => {
      const sandbox = await as('ravi').getAreaRemoval('area_sandbox')
      expect(sandbox).toMatchObject({ demo: true, outcome: 'blocked' })
      expect(
        await refusal(
          as('ravi').removeArea({
            id: 'area_sandbox',
            revision: sandbox!.revision,
            confirm: 'permanently delete',
          }),
        ),
      ).toMatchObject({ kind: 'conflict', status: 409 })
      expect((await as('kofi').listAreas()).map((area) => area.id)).toContain('area_sandbox')
    })

    // Accepted items, the Bin and terms are the service's (tests/integration/domain-delete.test.ts)
    // and the mock's own (tests/unit/mock-settings.test.ts): the mock's library is its fixtures.
    it('deletes an area and everything under it in one step, and restores it with its team', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const id = `held_${suffix}`
      const name = `Held ${suffix}`
      const jon = personId('per_jon')
      const tomas = personId('per_tomas')
      const created = await as('ravi').createArea({
        id,
        name,
        label: 'lime',
        reviewDays: 5,
        chatChannel: null,
        ownerTeam: null,
        team: { ownerIds: [jon], approverIds: [tomas] },
      })
      // An open proposal and a draft, both in the area.
      const draftOf = (title: string) => ({ ...newItem, areaId: id, title })
      const started = await as('kofi').createProposal({ draft: draftOf(`Oven repaired ${suffix}`) })
      const open = await as('kofi').submitProposal({ id: started.id, revision: started.revision })
      const draft = await as('kofi').createProposal({ draft: draftOf(`Started ${suffix}`) })

      const removal = await as('ravi').getAreaRemoval(id)
      expect(removal).toMatchObject({
        outcome: 'archive',
        holdings: { items: 0, openProposals: 1, drafts: 1, team: 2 },
        openProposals: [{ id: open.id, number: open.number, title: `Oven repaired ${suffix}` }],
        drafts: [
          { id: draft.id, title: `Started ${suffix}`, author: expect.any(String) as string },
        ],
      })
      expect(removal!.team.map((role) => [role.personId, role.role]).sort()).toEqual(
        [
          [jon, 'owner'],
          [tomas, 'approver'],
        ].sort(),
      )
      // Nothing has to move first: one step does it all.
      const removed = await as('ravi').removeArea({
        id,
        revision: removal!.revision,
        confirm: 'permanently delete',
        reason: 'Conformance: closing the bakery',
      })
      expect(removed).toMatchObject({
        outcome: 'archived',
        area: { id, ownerIds: [jon] },
        holdings: { openProposals: 1, drafts: 1, team: 2 },
      })
      expect((await as('kofi').listAreas()).map((area) => area.id)).not.toContain(id)
      // The open proposal is withdrawn; the draft stays with its author.
      expect(await as('kofi').getProposal(open.id)).toMatchObject({
        state: 'withdrawn',
        reason: 'Domain deleted',
      })
      expect(await as('kofi').getProposal(draft.id)).toMatchObject({ state: 'draft', areaId: id })
      // The team's roles end.
      expect((await as('jon').getSession()).person.permissions.assignments).not.toContainEqual({
        areaId: id,
        role: 'owner',
      })
      expect((await as('ravi').listArchivedAreas()).find((area) => area.id === id)).toMatchObject({
        name,
        label: 'lime',
        team: 2,
        binnedItems: 0,
      })
      expect((await refusal(as('kofi').listArchivedAreas())).kind).toBe('forbidden')
      // A deleted area keeps its id and name until it is restored.
      expect(
        (
          await refusal(
            as('ravi').createArea({
              id: `other_${suffix}`,
              name,
              label: 'teal',
              reviewDays: 5,
              chatChannel: null,
              ownerTeam: null,
            }),
          )
        ).kind,
      ).toBe('conflict')
      // One record names everything deleting did.
      const [deleted] = (
        await as('ravi').searchAudit({ areaId: id, action: 'area.deleted', limit: 1 })
      ).entries
      expect(deleted!.details).toMatchObject({
        name,
        kept: true,
        reason: 'Conformance: closing the bakery',
        items: [],
        openProposals: [{ id: open.id }],
        drafts: [{ id: draft.id }],
      })
      expect((deleted!.details as { roles: unknown[] }).roles).toHaveLength(2)

      expect((await refusal(as('kofi').restoreArea({ id }))).kind).toBe('forbidden')
      const restored = await as('ravi').restoreArea({ id, reason: 'Conformance: reopened' })
      expect(restored).toMatchObject({
        area: { id, name, ownerIds: [jon], approverIds: [tomas] },
        team: 2,
        binnedItems: [],
      })
      expect(restored.area.revision).toBeGreaterThan(created.revision)
      expect((await as('kofi').listAreas()).map((area) => area.id)).toContain(id)
      expect((await as('ravi').listArchivedAreas()).map((area) => area.id)).not.toContain(id)
      expect((await refusal(as('ravi').restoreArea({ id }))).kind).toBe('not-found')
      const actions = (await as('ravi').searchAudit({ areaId: id, limit: 50 })).entries.map(
        (entry) => entry.action,
      )
      expect(actions.indexOf('area.restored')).toBeLessThan(actions.indexOf('area.deleted'))
      // It goes again, and its team with it, so the rest of the suite sees the roles it started with.
      const again = await as('ravi').getAreaRemoval(id)
      await as('ravi').removeArea({
        id,
        revision: again!.revision,
        confirm: 'permanently delete',
      })
    })

    it('reads the history log a page at a time, exports it and checks its chain', async () => {
      const first = await as('ella').searchAudit({ limit: 2 })
      expect(first.entries).toHaveLength(2)
      expect(first.entries[0]!.seq).toBeGreaterThan(first.entries[1]!.seq)
      expect(first.next).toBe(first.entries[1]!.seq)
      const second = await as('ella').searchAudit({ limit: 2, before: first.next! })
      expect(second.entries[0]!.seq).toBeLessThan(first.entries[1]!.seq)

      const csv = await as('ella').exportAudit({ format: 'csv', limit: 3 })
      expect(csv.format).toBe('csv')
      expect(csv.count).toBe(3)
      expect(csv.content.split('\n')[0]).toMatch(/^seq,/)
      const lines = await as('ravi').exportAudit({ format: 'jsonl', limit: 2 })
      expect(
        lines.content
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as unknown),
      ).toHaveLength(2)

      expect(await as('ella').verifyAudit()).toEqual({ verified: true, firstBadSeq: null })
      expect((await refusal(as('jon').searchAudit())).kind).toBe('forbidden')
      expect((await refusal(as('kofi').verifyAudit())).kind).toBe('forbidden')
    })

    it('shows administrators the scheduled jobs, the sources and the spending', async () => {
      const overview = await as('ravi').getOperations()
      expect(['starting', 'running', 'stopped']).toContain(overview.runner)
      for (const job of overview.jobs)
        expect(['ok', 'waiting', 'failing', 'overdue']).toContain(job.status)
      for (const connector of overview.connectors)
        expect(['ok', 'waiting', 'stale', 'disabled']).toContain(connector.status)
      expect(overview.spend.month).toMatch(/^\d{4}-\d{2}$/)
      expect((await refusal(as('ravi').runJob({ job: 'no.such_job' }))).kind).toBe('not-found')
      expect((await refusal(as('jon').getOperations())).kind).toBe('forbidden')
    })

    it('offers administrators the connectors they may add, and refuses anyone else', async () => {
      const listings = await as('ravi').listSourceTypes()
      // Interface 3 connectors from their manifests, then interface 2 types through the adapter.
      expect(listings.map((listing) => [listing.manifest.id, listing.writtenTo])).toEqual([
        ['static-definitions', 3],
        ['cube', 2],
      ])
      const cube = listings.find((listing) => listing.manifest.id === 'cube')!.manifest
      expect(cube).toMatchObject({ kind: 'definitions', tool: 'Cube', refPrefix: 'cube' })
      expect(
        cube.config.fields.map((field) => [field.key, field.kind, field.required ?? false]),
      ).toEqual([
        ['repository', 'address', true],
        ['ref', 'text', true],
        ['folder', 'text', false],
        ['username', 'text', false],
        ['modelUrl', 'address', false],
        ['domainNames', 'domain_map', false],
      ])
      expect(cube.secrets).toEqual([
        expect.objectContaining({ key: 'token', required: false, boundTo: ['repository'] }),
      ])
      expect(cube.access.length).toBeGreaterThan(0)
      const list = listings.find((listing) => listing.manifest.id === 'static-definitions')!
      expect(list.manifest).toMatchObject({
        kind: 'definitions',
        maturity: 'experimental',
        secrets: [],
        egress: { hosts: [] },
      })
      for (const person of ['ella', 'jon', 'kofi'] as const) {
        expect((await refusal(as(person).listSourceTypes())).kind).toBe('forbidden')
        expect((await refusal(as(person).getSourceSettings('cube'))).kind).toBe('forbidden')
        expect(
          (
            await refusal(
              as(person).testSource({
                type: 'cube',
                config: { repository: 'https://git.example.test/a.git', ref: 'main' },
                secrets: {},
              }),
            )
          ).kind,
        ).toBe('forbidden')
        expect(
          (
            await refusal(
              as(person).addSource({
                type: 'cube',
                name: 'Not mine',
                config: { repository: 'https://git.example.test/a.git', ref: 'main' },
                secrets: { token: 'not-mine-token-1' },
                reason: 'Trying',
              }),
            )
          ).kind,
        ).toBe('forbidden')
      }
    })

    it('adds a source, never answers with its secret, and changes it on the revision read', async () => {
      const token = 'conformance-token-7c1e5b'
      const config = {
        repository: 'https://git.example.test/analytics/model.git',
        ref: 'main',
        folder: 'cube/model',
        domainNames: { sandbox: 'area_sandbox' },
      }
      const added = await as('ravi').addSource({
        type: 'cube',
        name: 'Analytics in Git',
        config,
        secrets: { token },
        reason: 'Read the analytics model from Git',
      })
      expect(added).toMatchObject({
        id: 'analytics-in-git',
        type: 'cube',
        name: 'Analytics in Git',
        revision: 1,
        config,
        secrets: [{ key: 'token', set: true }],
      })
      expect(JSON.stringify(added)).not.toContain(token)
      expect(await as('ravi').getSourceSettings('analytics-in-git')).toEqual(added)
      expect(await as('ravi').getSourceSettings('nothing-here')).toBeNull()
      // The server's own sources have no settings an administrator gave.
      expect(await as('ravi').getSourceSettings('cube')).toBeNull()

      const listed = (await as('ravi').getOperations()).connectors.find(
        (source) => source.id === 'analytics-in-git',
      )
      expect(listed).toMatchObject({
        origin: 'workspace',
        kind: 'definition_source',
        tool: 'Cube',
        status: 'waiting',
        settingKeys: [],
        server: null,
        lastRead: null,
      })

      // A second source of the same name gets the next free address.
      const second = await as('ravi').addSource({
        type: 'cube',
        name: 'Analytics in Git',
        config: { repository: 'https://git.example.test/public.git', ref: 'v1' },
        secrets: {},
        reason: 'A public model',
      })
      expect(second).toMatchObject({
        id: 'analytics-in-git-2',
        secrets: [{ key: 'token', set: false }],
      })

      const stale = await refusal(
        as('ravi').updateSource({
          id: 'analytics-in-git',
          revision: 7,
          name: 'Analytics in Git',
          config,
          secrets: {},
          reason: 'Stale',
        }),
      )
      expect(stale.kind).toBe('conflict')
      const changed = await as('ravi').updateSource({
        id: 'analytics-in-git',
        revision: 1,
        name: 'Analytics model',
        config: { ...config, ref: 'v2' },
        secrets: {},
        reason: 'Read the released model',
      })
      // A secret left out keeps the one the server holds.
      expect(changed).toMatchObject({
        name: 'Analytics model',
        revision: 2,
        config: { ref: 'v2' },
        secrets: [{ key: 'token', set: true }],
      })
      // A stored token goes only where it was given for: a new repository forgets it.
      const moved = await as('ravi').updateSource({
        id: 'analytics-in-git',
        revision: 2,
        name: 'Analytics model',
        config: { ...config, repository: 'https://git.example.test/elsewhere.git' },
        secrets: {},
        reason: 'Read another repository',
      })
      expect(moved).toMatchObject({ revision: 3, secrets: [{ key: 'token', set: false }] })
      expect(
        (
          await refusal(
            as('ravi').updateSource({
              id: 'nothing-here',
              revision: 1,
              name: 'X',
              config,
              secrets: {},
              reason: 'X',
            }),
          )
        ).kind,
      ).toBe('not-found')

      // The history log says a secret was set or replaced, never what it is.
      const log = await as('ravi').searchAudit({ action: 'source' })
      expect(log.entries.map((entry) => entry.action)).toEqual([
        'source.changed',
        'source.changed',
        'source.added',
        'source.added',
      ])
      expect(log.entries[0]!.details).toMatchObject({ secrets: { token: 'removed' } })
      expect(log.entries[3]!.details).toMatchObject({ secrets: { token: 'set' }, config })
      expect(JSON.stringify(log)).not.toContain(token)
    })

    it('refuses settings with problems, by field, and a secret pasted into another field', async () => {
      const problems = async (input: Parameters<ContextApi['addSource']>[0]) => {
        const error = await refusal(as('ravi').addSource(input))
        expect(error.kind).toBe('invalid')
        return error.findings.map((finding) => finding.field).sort()
      }
      const base = {
        type: 'cube',
        name: 'Broken',
        config: { repository: 'https://git.example.test/a.git', ref: 'main' },
        secrets: {},
        reason: 'Testing the rules',
      }
      expect(
        await problems({
          ...base,
          config: {
            repository: 'http://git.example.test/a.git',
            ref: '--upload-pack=x',
            folder: '../etc',
            modelUrl: 'https://me:pw@git.example.test/m',
            domainNames: { sandbox: 'area_nowhere' },
          },
        }),
      ).toEqual(['domainNames', 'folder', 'modelUrl', 'ref', 'repository'])
      expect(
        await problems({
          ...base,
          secrets: { token: 'pasted-secret-0042' },
          reason: 'The token is pasted-secret-0042',
        }),
      ).toEqual(['token'])
      expect(await problems({ ...base, type: 'nothing' })).toEqual(['type'])
      expect(await problems({ ...base, config: { ...base.config, password: 'x' } })).toEqual([
        'password',
      ])
    })

    it('adds and tests a source of an interface 3 connector, checked by its manifest and its runtime', async () => {
      const definitions = JSON.stringify([
        { kind: 'metric', name: 'orders.orders', title: 'Orders', domain: 'Finance' },
        { kind: 'dimension', name: 'orders.market', title: 'Market' },
      ])
      const config = { definitions, domainNames: { Finance: 'area_sandbox' } }
      const check = await as('ravi').testSource({ type: 'static-definitions', config, secrets: {} })
      expect(check).toMatchObject({
        ok: true,
        complete: true,
        views: 1,
        metrics: 1,
        dimensions: 1,
        warnings: [],
        steps: [
          { id: 'read', status: 'ok', detail: '1 metric and 1 dimension.' },
          { id: 'domains', status: 'ok' },
        ],
      })
      const added = await as('ravi').addSource({
        type: 'static-definitions',
        name: 'Finance metrics',
        config,
        secrets: {},
        reason: 'Try the platform with a short list',
      })
      expect(added).toMatchObject({
        id: 'finance-metrics',
        type: 'static-definitions',
        revision: 1,
        config,
        secrets: [],
      })
      expect(
        (await as('ravi').getOperations()).connectors.find((source) => source.id === added.id),
      ).toMatchObject({ origin: 'workspace', tool: 'Static list', status: 'waiting' })
      // The manifest's rules first, then the runtime's own, each by field.
      const refused = async (input: Record<string, unknown>, secrets = {}) => {
        const error = await refusal(
          as('ravi').addSource({
            type: 'static-definitions',
            name: 'Broken list',
            config: input as typeof config,
            secrets,
            reason: 'Testing the rules',
          }),
        )
        expect(error.kind).toBe('invalid')
        return error.findings.map((finding) => [finding.field, finding.message])
      }
      expect(await refused({ definitions: '[' })).toEqual([
        ['definitions', 'This is not JSON. Check the brackets, commas and quotes.'],
      ])
      expect(await refused({ definitions: '[{"kind": "measure", "name": "a"}]' })).toEqual([
        ['definitions', 'Entry 1 needs a kind: metric or dimension.'],
      ])
      expect(await refused({ definitions, domainNames: { Finance: 'area_nowhere' } })).toEqual([
        ['domainNames', "area_nowhere isn't a domain in Heed."],
      ])
      expect(await refused({ definitions }, { token: 'not-a-slot-0001' })).toEqual([
        ['token', 'This source has no such secret.'],
      ])
    })

    it('tests settings without keeping them, and says why it cannot read', async () => {
      const before = (await as('ravi').getOperations()).connectors.length
      const check = await as('ravi').testSource({
        type: 'cube',
        config: { repository: 'https://unreachable.invalid/analytics.git', ref: 'main' },
        secrets: { token: 'test-only-token-99' },
      })
      expect(check).toEqual({
        ok: false,
        steps: [],
        version: null,
        complete: false,
        views: 0,
        metrics: 0,
        dimensions: 0,
        warnings: [{ code: 'unreachable', target: 'https://unreachable.invalid/analytics.git' }],
      })
      expect((await as('ravi').getOperations()).connectors).toHaveLength(before)
      expect(
        (
          await refusal(
            as('ravi').testSource({
              id: 'nothing-here',
              type: 'cube',
              config: { repository: 'https://unreachable.invalid/a.git', ref: 'main' },
              secrets: {},
            }),
          )
        ).kind,
      ).toBe('not-found')
    })

    it('counts MCP traffic by client and tool for administrators, naming no person', async () => {
      const traffic = await as('ravi').getTraffic({ days: 7 })
      expect(traffic.retentionDays).toBeGreaterThan(0)
      expect(Date.parse(traffic.to) - Date.parse(traffic.from)).toBe(7 * 86_400_000)
      for (const row of traffic.rows) {
        expect(row.calls).toBe(
          row.ok +
            row.errors +
            row.invalidInput +
            row.rateLimited +
            row.forbidden +
            row.unauthorized,
        )
        expect(Object.keys(row)).not.toContain('personId')
      }
      expect((await refusal(as('kofi').getTraffic())).kind).toBe('forbidden')
    })

    it('checks a file of items in a dry run, and says what is wrong with the file', async () => {
      const report = await as('ravi').importItems({ content: stringify([newItem]), dryRun: true })
      expect(report).toMatchObject({
        applied: false,
        batchId: null,
        error: null,
        counts: { create: 1, change: 0, unchanged: 0, errors: 0 },
      })
      expect(report.entries[0]).toMatchObject({ index: 0, action: 'create', proposalId: null })

      const unknown = await as('ravi').importItems({
        content: stringify([{ ...newItem, id: 'itm_doesnotexist' }]),
        dryRun: true,
      })
      expect(unknown.counts.errors).toBe(1)
      expect(unknown.entries[0]!.findings.map((finding) => finding.code)).toContain('unknown_item')

      const broken = await as('ravi').importItems({ content: 'items: 12', dryRun: true })
      expect(broken.error).toMatch(/list of items/)
      expect(broken.entries).toEqual([])
    })
  })
}
