/**
 * The `HeedApi` conformance suite: the same cases run against the mock binding
 * (tests/web/mock/conformance.test.ts) and against the http binding talking to the real service and
 * PostgreSQL (tests/web/integration/http-api.test.ts). A case names the methods it needs, so it runs
 * against a binding once that binding answers them; the http binding grows its list as the pull
 * requests that wire each screen land.
 */
import { describe, expect, it } from 'vitest'
import { settingKeys } from '@contract/admin'
import { heedApiMethods, type HeedApi, type HeedApiMethod, type Related } from '@/api/client'
import type { ObsData } from '@/model/observability'
import { labelDay, whenLabel } from '@/model/validity'
import type { CardType, InboxCard } from '@/model/inbox'
import { mentionNotesOf, type Subject } from '@/model/comments'
import { plainOf } from '@/components/templates/comment-box/utils'
import { readiness } from '@/model/review'
import { findDefinition, meaningOf, type Definition } from '@/lib/definitions'
import { emailOf } from '@/model/people'
import { connectorById } from '@/model/integrations'

/** Two names for the same word: case aside. */
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export type HeedApiConformance = {
  /** Someone the binding's sign-in offers, by name. */
  person: string
  /**
   * The methods the binding answers; a case that needs another is skipped. A binding that answers
   * the Inbox's methods gives the person, an owner, at least a suggestion, two plain changes, a
   * suggestion to archive something, a Reported card and a card due for a check in their Inbox.
   */
  wired: readonly HeedApiMethod[]
  /** Someone else the sign-in offers, by name: the comments' second voice. */
  colleague: string
  /**
   * The address of a Markdown repository the binding's Markdown in Git can read, with Markdown
   * files in folders under `docs`, and the token it wants (or none): the connect flow's cases
   * connect it. The mock reads any address.
   */
  repository: { address: string; token: string | null }
  /**
   * Someone the sign-in offers who sent a suggestion to archive that waits for the person: they
   * take it back with a comment. The mock's sign-in offers nobody who did.
   */
  sender?: string
}

export function describeHeedApi(
  name: string,
  getApi: () => HeedApi,
  { person, wired, colleague, repository, sender }: HeedApiConformance,
) {
  const api = () => getApi()
  const lacks = (...methods: HeedApiMethod[]) => methods.some((m) => !wired.includes(m))

  describe(`HeedApi conformance: ${name}`, () => {
    it('has every method of the interface', () => {
      for (const method of heedApiMethods) expect(typeof api()[method], method).toBe('function')
    })

    it.skipIf(lacks('listSignInPeople'))('offers the person to sign in as', async () => {
      expect(await api().listSignInPeople()).toContain(person)
    })

    it.skipIf(lacks('signIn', 'getSession', 'signOut'))(
      'signs in, keeps the session, and signs out',
      async () => {
        const session = await api().signIn({ name: person, fresh: false })
        expect(session).toMatchObject({ user: person, fresh: false })
        expect((await api().getSession()).user).toBe(person)
        await api().signOut()
        expect((await api().getSession()).user).toBeNull()
      },
    )

    /** Signed in as the person, the reads every screen makes. */
    const signedIn = async () => {
      await api().signIn({ name: person, fresh: false })
      return api()
    }

    it.skipIf(lacks('signIn', 'getLibrary'))(
      'lists the library: each item once, of a kind and a status the app knows, with its When',
      async () => {
        const { items } = await (await signedIn()).getLibrary()
        expect(items.length).toBeGreaterThan(0)
        expect(new Set(items.map((f) => f.id)).size).toBe(items.length)
        for (const f of items) {
          expect(['event', 'issue', 'note', 'guide'], f.id).toContain(f.kind)
          expect(['Draft', 'Live', 'Needs checking', 'Archived'], f.id).toContain(f.status)
          expect(f.when, f.id).toBe(whenLabel(f.valid))
          expect(f.title, f.id).not.toBe('')
          for (const name of f.where) expect(name, f.id).not.toBe('')
        }
      },
    )

    it.skipIf(lacks('signIn', 'getLibrary', 'searchAll'))(
      'finds a library item by its title, a few of each group at most',
      async () => {
        const live = await signedIn()
        const item = (await live.getLibrary()).items.find((f) => f.status !== 'Draft')!
        const found = await live.searchAll({ q: item.title })
        expect(found.items.map((hit) => hit.id)).toContain(item.id)
        expect(found.items.find((hit) => hit.id === item.id)).toEqual({
          id: item.id,
          title: item.title,
          kind: item.kind,
          domain: item.domain,
        })
        const wide = await live.searchAll({ q: 'e' })
        for (const group of [wide.items, wide.definitions, wide.domains, wide.people])
          expect(group.length).toBeLessThanOrEqual(5)
        expect(wide.items.length).toBeGreaterThan(0)
      },
    )

    it.skipIf(lacks('signIn', 'searchAll'))(
      'finds nothing for words that are only spaces',
      async () => {
        expect(await (await signedIn()).searchAll({ q: '   ' })).toEqual({
          items: [],
          definitions: [],
          domains: [],
          people: [],
        })
      },
    )

    it.skipIf(lacks('signIn', 'getDefinitions'))(
      'lists the definitions: each name once, of a known type, its other names once each',
      async () => {
        const definitions = await (await signedIn()).getDefinitions()
        expect(definitions.length).toBeGreaterThan(0)
        expect(new Set(definitions.map((d) => d.name)).size).toBe(definitions.length)
        for (const d of definitions) {
          expect(['metric', 'dimension', 'term'], d.name).toContain(d.type)
          expect(new Set(d.sourceNames).size, d.name).toBe(d.sourceNames.length)
          if (d.type !== 'term') expect(d.synced, d.name).toBe(true)
        }
      },
    )

    it.skipIf(lacks('signIn', 'getDefinitions'))(
      'lists the terms written here: each by who wrote it, a synonym naming a definition in the list',
      async () => {
        const all = await (await signedIn()).getDefinitions()
        const terms = all.filter((d) => d.type === 'term')
        expect(terms.length).toBeGreaterThan(0)
        for (const t of terms) {
          expect(t.synced, t.name).toBe(false)
          expect(t.by, t.name).toBeTruthy()
          if (t.sameAs) {
            expect(findDefinition(all, t.sameAs), t.name).toBeDefined()
            expect(t.definition, t.name).toBe('')
          } else expect(t.definition, t.name).not.toBe('')
        }
        expect(terms.some((t) => t.sameAs)).toBe(true)
        expect(terms.some((t) => !t.sameAs)).toBe(true)
      },
    )

    it.skipIf(
      lacks('signIn', 'getWorkspace', 'getDefinitions', 'addSynonym', 'removeTerm', 'undo'),
    )(
      'adds another name for a definition once, refuses a word another term has, naming who wrote it, and takes it back',
      async () => {
        const live = await signedIn()
        const me = (await live.getWorkspace()).people.find((p) => p.name === person)!
        const all = await live.getDefinitions()
        const metric = all.find(
          (d) => d.type === 'metric' && !!d.domain && me.owns.includes(d.domain),
        )!
        const word = `Conformance ${metric.name}`
        expect(await live.addSynonym({ target: metric.name, word })).toEqual({
          ok: true,
          created: true,
        })
        const after = await live.getDefinitions()
        expect(findDefinition(after, word)).toMatchObject({
          type: 'term',
          sameAs: metric.name,
          synced: false,
          by: person,
        })
        // The same word again, whatever its case, is said already: never saved twice.
        expect(
          await live.addSynonym({ target: metric.name, word: word.toUpperCase() }),
        ).toMatchObject({ ok: false, why: 'here', holder: metric.name })
        // A word another synonym has means something else.
        const taken = after.find(
          (d) =>
            d.sameAs &&
            meaningOf(after, d).name !== metric.name &&
            !after.some((x) => x.synced && x.sourceNames.some((n) => same(n, d.name))),
        )!
        const refused = await live.addSynonym({ target: metric.name, word: taken.name })
        expect(refused).toMatchObject({ ok: false, why: 'taken', by: taken.by })
        expect(refused.ok ? '' : refused.reason).toContain(
          `“${taken.name}” is already another name for`,
        )
        expect(await live.addSynonym({ target: metric.name, word: '  ' })).toMatchObject({
          ok: false,
          why: 'empty',
        })
        // Removing it, and Undo.
        const { undo } = await live.removeTerm({ name: word })
        expect(findDefinition(await live.getDefinitions(), word)).toBeUndefined()
        await live.undo({ token: undo })
        expect(findDefinition(await live.getDefinitions(), word)).toMatchObject({
          sameAs: metric.name,
        })
        await live.removeTerm({ name: word })
      },
    )

    it.skipIf(
      lacks(
        'signIn',
        'getWorkspace',
        'getDefinitions',
        'saveTerm',
        'addSynonym',
        'moveTerms',
        'deleteTerms',
        'undo',
      ),
    )(
      'writes a term and renames it, moves it, and deletes it with its synonyms, each with Undo',
      async () => {
        const live = await signedIn()
        const { domains, people } = await live.getWorkspace()
        const home = people.find((p) => p.name === person)!.owns[0]!
        const away = domains.find((d) => d.id !== home)!.id
        const named = async (name: string) => findDefinition(await live.getDefinitions(), name)
        const term = (name: string, domain: string): Definition => ({
          name,
          type: 'term',
          definition: 'The weeks the suite runs.',
          synced: false,
          sourceNames: [],
          domain,
          by: person,
          updated: '',
        })
        await live.saveTerm({ term: term('Conformance season', home) })
        expect(await named('Conformance season')).toMatchObject({
          type: 'term',
          definition: 'The weeks the suite runs.',
          domain: home,
          by: person,
        })
        await live.saveTerm({
          previous: 'Conformance season',
          term: term('Conformance weeks', home),
        })
        expect(await named('Conformance season')).toBeUndefined()
        expect(await live.addSynonym({ target: 'Conformance weeks', word: 'Suite weeks' })).toEqual(
          { ok: true, created: true },
        )

        const moved = await live.moveTerms({ names: ['Conformance weeks'], domain: away })
        expect((await named('Conformance weeks'))?.domain).toBe(away)
        await live.undo({ token: moved.undo })
        expect((await named('Conformance weeks'))?.domain).toBe(home)

        const entry = {
          id: 'conformance-delete-terms',
          on: '2026-10-23',
          who: person,
          what: 'deleted' as const,
          summary: 'Deleted “Conformance weeks”.',
          items: [{ id: 'Conformance weeks', title: 'Conformance weeks' }],
        }
        const deleted = await live.deleteTerms({ names: ['Conformance weeks'], entry })
        expect(await named('Conformance weeks')).toBeUndefined()
        expect(await named('Suite weeks')).toBeUndefined()
        await live.undo({ token: deleted.undo })
        expect(await named('Conformance weeks')).toMatchObject({ domain: home })
        expect(await named('Suite weeks')).toMatchObject({ sameAs: 'Conformance weeks' })
        await live.deleteTerms({ names: ['Conformance weeks'], entry })
      },
    )

    it.skipIf(lacks('signIn', 'getDefinitions', 'definitionsPage', 'definitionPage'))(
      "reads the Definitions page, and a definition's page by its name in any case",
      async () => {
        const live = await signedIn()
        const all = await live.getDefinitions()
        expect(await live.definitionsPage()).toEqual(all)
        const d = all[0]!
        expect(await live.definitionPage({ name: d.name.toUpperCase() })).toEqual(d)
        expect(await live.definitionPage({ name: 'Nothing called this' })).toBeNull()
      },
    )

    it.skipIf(lacks('signIn', 'getDefinitions', 'getDefinitionHistory'))(
      "reads a definition's versions newest first: a term's writes by people, a synced one's from its tool",
      async () => {
        const live = await signedIn()
        const all = await live.getDefinitions()
        const term = all.find((d) => d.type === 'term' && !d.sameAs)!
        const versions = await live.getDefinitionHistory({ name: term.name })
        expect(versions.length).toBeGreaterThan(0)
        const numbers = versions.map((v) => v.v)
        expect(numbers).toEqual([...numbers].sort((a, b) => b - a))
        for (const v of versions) expect(v.who, term.name).toBeTruthy()
        const synced = all.find((d) => d.synced)!
        const read = await live.getDefinitionHistory({ name: synced.name })
        expect(read.length).toBeGreaterThan(0)
        expect(read.every((v) => v.kind === 'synced')).toBe(true)
        expect(await live.getDefinitionHistory({ name: 'Nothing called this' })).toEqual([])
      },
    )

    it.skipIf(lacks('signIn', 'getLibrary', 'itemPage'))(
      "reads a context item's page: the item and its versions, newest first",
      async () => {
        const live = await signedIn()
        const item = (await live.getLibrary()).items.find((f) => f.status === 'Live')!
        const page = await live.itemPage({ id: item.id })
        expect(page?.item).toMatchObject({ id: item.id, title: item.title, kind: item.kind })
        expect(page?.history.length).toBeGreaterThan(0)
        const numbers = page!.history.map((v) => v.v)
        expect(numbers).toEqual([...numbers].sort((a, b) => b - a))
        expect(await live.itemPage({ id: 'itm_nothere001' })).toBeNull()
      },
    )

    it.skipIf(lacks('signIn', 'getLibrary', 'getRelated'))(
      "reads Related: an item's links both ways, the owners' relations, a retired one not followed",
      async () => {
        const live = await signedIn()
        const { items } = await live.getLibrary()
        const titled = (title: string) => items.find((f) => f.title === title)!
        const related = (title: string) => live.getRelated({ id: `context:${titled(title).id}` })
        const to = (r: Related, id: string) => r.links.find((l) => l.to.id === id)
        // A metric another domain owns, written in the text: Orders is Sales's.
        const campaign = await related('Norway launch campaign started on 24 March 2026')
        expect(campaign.following).toBe(true)
        expect(to(campaign, 'metric:Orders')).toMatchObject({
          rel: 'mentions',
          to: { label: 'Orders', retired: false },
          otherDomain: true,
        })
        // The owners' relations, first: the item it replaces is archived, so it is not followed.
        const lag = await related('Orders lags by one day in the source tool')
        const replaced = titled('Orders lag by two days in the source tool')
        expect(lag.links[0]).toMatchObject({
          rel: 'replaces',
          to: { id: `context:${replaced.id}`, label: replaced.title, retired: true },
          otherDomain: false,
        })
        const credit = await related('Norway orders count store credit')
        const cardOnly = titled('Norway orders are card and cash payments only')
        expect(to(credit, `context:${cardOnly.id}`)).toMatchObject({
          rel: 'disagrees',
          to: { retired: false },
        })
        // The other way round: the metric is linked from the item that mentions it.
        const orders = await live.getRelated({ id: 'metric:Orders' })
        const campaignId = titled('Norway launch campaign started on 24 March 2026').id
        expect(to(orders, `context:${campaignId}`)).toMatchObject({ rel: 'mentioned_by' })
        // Each end once, and nothing to follow from a draft or from what is not there.
        for (const r of [campaign, lag, credit, orders])
          expect(new Set(r.links.map((l) => l.to.id)).size).toBe(r.links.length)
        const draft = items.find((f) => f.status === 'Draft')!
        expect((await live.getRelated({ id: `context:${draft.id}` })).links).toEqual([])
        expect((await live.getRelated({ id: 'context:itm_nothere001' })).links).toEqual([])
      },
    )

    it.skipIf(lacks('signIn', 'getLibrary', 'applyBulk', 'undo'))(
      'archives items together, and Undo puts exactly them back',
      async () => {
        const live = await signedIn()
        const [a, b] = (await live.getLibrary()).items.filter((f) => f.status === 'Live')
        const archive = { status: 'Archived' as const }
        const { done, failed, undo } = await live.applyBulk({
          action: 'archive',
          patches: { [a!.id]: archive, [b!.id]: archive },
          remove: [],
          entry: {
            id: 'conformance-archive',
            on: '2026-10-23',
            who: person,
            what: 'archived',
            summary: `Archived “${a!.title}” and 1 more.`,
            items: [a!, b!].map((f) => ({ id: f.id, title: f.title, domain: f.domain })),
          },
        })
        expect({ done: [...done].sort(), failed }).toEqual({
          done: [a!.id, b!.id].sort(),
          failed: [],
        })
        const status = async (id: string) =>
          (await live.getLibrary()).items.find((f) => f.id === id)?.status
        expect(await status(a!.id)).toBe('Archived')
        await live.undo({ token: undo })
        expect(await status(a!.id)).toBe('Live')
        expect(await status(b!.id)).toBe('Live')
      },
    )

    it.skipIf(lacks('signIn', 'draftFromText'))(
      'makes a draft from pasted text, with words to check',
      async () => {
        const fact = await (
          await signedIn()
        ).draftFromText({
          text: 'Orders in Norway paused from 3 October 2026 while the payment provider moved.',
        })
        expect(fact.title).not.toBe('')
        expect(fact.summary).not.toBe('')
        expect(['event', 'issue', 'note', 'guide']).toContain(fact.kind)
      },
    )

    it.skipIf(lacks('signIn', 'getLibrary', 'contextPage'))(
      "lists the Context page: the library's items and the drafts, each once, a draft by who started it",
      async () => {
        const live = await signedIn()
        const rows = await live.contextPage()
        expect(rows.map((f) => f.id).sort()).toEqual(
          (await live.getLibrary()).items.map((f) => f.id).sort(),
        )
        const drafts = rows.filter((f) => f.status === 'Draft')
        expect(drafts.length).toBeGreaterThan(0)
        for (const d of drafts) expect(d.by, d.id).toBeTruthy()
      },
    )

    it.skipIf(lacks('signIn', 'contextPage', 'itemPage', 'getItemHistory'))(
      "reads a draft's page, and an item's history as its page has it",
      async () => {
        const live = await signedIn()
        const rows = await live.contextPage()
        const draft = rows.find((f) => f.status === 'Draft')!
        expect((await live.itemPage({ id: draft.id }))?.item).toMatchObject({
          id: draft.id,
          title: draft.title,
          status: 'Draft',
        })
        const item = rows.find((f) => f.status === 'Live')!
        expect(await live.getItemHistory({ id: item.id })).toEqual(
          (await live.itemPage({ id: item.id }))!.history,
        )
        expect(await live.getItemHistory({ id: 'itm_nothere001' })).toEqual([])
      },
    )

    it.skipIf(lacks('signIn', 'getLibrary', 'markViewed'))(
      'keeps an item the person opened as opened, so it can be marked as checked with others',
      async () => {
        const live = await signedIn()
        const item = (await live.getLibrary()).items.filter((f) => f.status === 'Live').at(-1)!
        await live.markViewed({ id: item.id })
        expect((await live.getLibrary()).viewed[item.id]).toBe(true)
      },
    )

    it.skipIf(lacks('signIn', 'getWorkspace', 'getLibrary', 'editItem'))(
      'checks an item as still true in place: it reads as checked by the person',
      async () => {
        const live = await signedIn()
        const { domains } = await live.getWorkspace()
        const mine = new Set(domains.filter((d) => d.owners.includes(person)).map((d) => d.id))
        const due = (await live.getLibrary()).items.find(
          (f) => f.status === 'Needs checking' && mine.has(f.domain),
        )!
        await live.editItem({
          id: due.id,
          patch: {
            status: 'Live',
            outOfDate: undefined,
            checkedBy: person,
            checkedOn: '23 Oct 2026',
          },
        })
        const after = (await live.getLibrary()).items.find((f) => f.id === due.id)!
        expect(after).toMatchObject({ status: 'Live', checkedBy: person })
      },
    )

    /**
     * A new item the person may publish: in a domain they own, from a live item's words, on days
     * of its own (`month`, in 2031) so it overlaps nothing that agents get.
     */
    const newItem = async (live: HeedApi, title: string, month: string) => {
      const { domains } = await live.getWorkspace()
      const mine = new Set(domains.filter((d) => d.owners.includes(person)).map((d) => d.id))
      const { items } = await live.getLibrary()
      const from = items.find((f) => f.status === 'Live' && mine.has(f.domain))!
      const { item } = (await live.itemPage({ id: from.id }))!
      const valid = { from: `2031-${month}-01`, until: `2031-${month}-02` }
      // What agents get about the same place overlaps it, as the editor lists it: the owner
      // answers each.
      const overlaps = items.filter(
        (f) =>
          (f.status === 'Live' || f.status === 'Needs checking') &&
          item.where.every((w) => f.where.includes(w)),
      )
      return {
        fact: {
          ...item,
          id: 'new',
          title,
          status: 'Live' as const,
          owners: undefined,
          valid,
          when: whenLabel(valid),
        },
        relations: Object.fromEntries(overlaps.map((f) => [f.id, 'unrelated' as const])),
      }
    }

    it.skipIf(lacks('signIn', 'getWorkspace', 'getLibrary', 'itemPage', 'saveItem'))(
      'publishes a new item in one step as an owner, and an edit to it as a new version',
      async () => {
        const live = await signedIn()
        const { fact, relations } = await newItem(
          live,
          'Conformance: a new item, published in one step',
          '01',
        )
        const { id } = await live.saveItem({ fact, isNew: true, relations })
        const library = await live.getLibrary()
        expect(library.items.find((f) => f.id === id)).toMatchObject({
          title: fact.title,
          status: 'Live',
          domain: fact.domain,
        })
        expect(library.published[id]).toBeTruthy()
        const page = (await live.itemPage({ id }))!
        expect(page.item).toMatchObject({ summary: fact.summary, source: fact.source })
        const edited = { ...page.item, title: `${fact.title}, edited` }
        expect(await live.saveItem({ fact: edited, isNew: false, relations })).toEqual({ id })
        const after = (await live.itemPage({ id }))!
        expect(after.item.title).toBe(edited.title)
        expect(after.item.summary).toBe(page.item.summary)
      },
    )

    it.skipIf(lacks('signIn', 'searchScope'))(
      'searches what an item applies to without listing every value of a dimension (FR-107)',
      async () => {
        const live = await signedIn()
        // No words: only the person's recent terms, never a dimension's values.
        const empty = await live.searchScope({ q: '' })
        expect(empty).toMatchObject({ metrics: [], groups: [], nextCursor: null })
        expect(empty.recent.length).toBeLessThanOrEqual(6)
        // Another name finds the value, named with its dimension and the name it matched.
        const norge = await live.searchScope({ q: 'norge' })
        expect(norge.groups.find((g) => g.dimension.key === 'dim:market')?.values[0]).toMatchObject(
          {
            key: 'val:market/norway',
            kind: 'dimension_value',
            name: 'Norway',
            alias: 'Norge',
            dimension: { key: 'dim:market', name: 'Market' },
          },
        )
        // Words that match thousands of values give a count and a few, grouped by dimension.
        const wide = await live.searchScope({ q: 'sale' })
        const campaigns = wide.groups.find((g) => g.dimension.key === 'dim:campaign')!
        expect(campaigns).toMatchObject({ named: false, dimension: { kind: 'dimension' } })
        expect(campaigns.count).toBeGreaterThan(100)
        expect(campaigns.values.length).toBeLessThanOrEqual(5)
        // Inside one dimension, a page at a time, in a fixed order.
        const first = await live.searchScope({ q: 'sale', dimension: 'dim:campaign', limit: 20 })
        const next = await live.searchScope({
          q: 'sale',
          dimension: 'dim:campaign',
          limit: 20,
          cursor: first.nextCursor!,
        })
        expect(first.groups[0]!.count).toBe(campaigns.count)
        expect(first.groups[0]!.values).toHaveLength(20)
        expect(first.nextCursor).toBe('20')
        const keys = new Set(first.groups[0]!.values.map((v) => v.key))
        expect(next.groups[0]!.values.some((v) => keys.has(v.key))).toBe(false)
      },
    )

    it.skipIf(lacks('signIn', 'getWorkspace', 'getLibrary', 'itemPage', 'saveItem', 'searchScope'))(
      'keeps a value an item applies to by its key, and offers it again as recent',
      async () => {
        const live = await signedIn()
        const { fact, relations } = await newItem(
          live,
          'Conformance: an item for one campaign',
          '03',
        )
        const hit = (
          await live.searchScope({ q: 'norway spring sale 2026 email', dimension: 'dim:campaign' })
        ).groups[0]!.values[0]!
        const scope = [
          ...(fact.scope ?? []),
          { key: hit.key, kind: 'value' as const, name: hit.name, dimension: 'Campaign' },
        ]
        const { id } = await live.saveItem({
          fact: { ...fact, scope, where: scope.map((t) => t.name) },
          isNew: true,
          relations,
        })
        const page = (await live.itemPage({ id }))!
        expect(page.item.scope).toContainEqual({
          key: 'val:campaign/norway_spring_sale_2026_email',
          kind: 'value',
          name: 'Norway Spring Sale 2026 Email',
          dimension: 'Campaign',
        })
        expect(page.item.where).toContain('Norway Spring Sale 2026 Email')
        expect((await live.searchScope({ q: '' })).recent.map((h) => h.key)).toContain(hit.key)
      },
    )

    it.skipIf(
      lacks(
        'signIn',
        'getWorkspace',
        'getLibrary',
        'itemPage',
        'saveItem',
        'restoreAsDraft',
        'contextPage',
      ),
    )("restores an earlier version's words as a draft, and what agents get stays", async () => {
      const live = await signedIn()
      const { fact, relations } = await newItem(live, 'Conformance: an item to restore', '02')
      const { id } = await live.saveItem({ fact, isNew: true, relations })
      const page = (await live.itemPage({ id }))!
      await live.saveItem({
        fact: { ...page.item, title: `${fact.title}, renamed` },
        isNew: false,
        relations,
      })
      const history = (await live.itemPage({ id }))!.history
      const first = history.at(-1)!
      const restored = await live.restoreAsDraft({ id, v: first.v })
      const rows = await live.contextPage()
      expect(rows.find((f) => f.id === restored.id)).toMatchObject({ status: 'Draft' })
      expect(rows.find((f) => f.id === id)).toMatchObject({
        status: 'Live',
        title: `${fact.title}, renamed`,
      })
    })

    it.skipIf(
      lacks(
        'signIn',
        'getWorkspace',
        'getLibrary',
        'itemPage',
        'sendSuggestion',
        'withdrawSuggestion',
        'getInbox',
      ),
    )(
      "sends a suggestion to an item's owners, which waits for them until it is withdrawn",
      async () => {
        await api().signIn({ name: colleague, fresh: false })
        const live = api()
        const { domains, people } = await live.getWorkspace()
        const them = people.find((p) => p.name === colleague)!
        const item = (await live.getLibrary()).items.find(
          (f) => f.status === 'Live' && !them.owns.includes(f.domain) && !f.owners,
        )!
        const { item: full } = (await live.itemPage({ id: item.id }))!
        const owner = domains.find((d) => d.id === item.domain)!.owners[0]!
        const sent = {
          factId: item.id,
          title: `${item.title}, as suggested`,
          by: colleague,
          to: owner,
          domain: item.domain,
          at: 'just now',
        }
        const { id } = await live.sendSuggestion({ sent, fact: { ...full, title: sent.title } })
        expect((await live.getInbox()).sent).toContainEqual({ ...sent, id })
        // What agents get stays as it was until an owner decides.
        expect((await live.itemPage({ id: item.id }))!.item.title).toBe(full.title)
        await live.withdrawSuggestion({ id })
        expect((await live.getInbox()).sent.map((x) => x.id)).not.toContain(id)
        await api().signIn({ name: person, fresh: false })
      },
    )

    it.skipIf(lacks('signIn', 'getWorkspace'))(
      'names the domains with their owners, and the people with what they own',
      async () => {
        const { domains, people } = await (await signedIn()).getWorkspace()
        expect(domains.length).toBeGreaterThan(0)
        const names = people.map((p) => p.name)
        expect(names).toContain(person)
        for (const d of domains) {
          expect(d.name, d.id).not.toBe('')
          for (const owner of d.owners) expect(names, d.id).toContain(owner)
        }
        const me = people.find((p) => p.name === person)!
        expect(me.owns.length).toBeGreaterThan(0)
        for (const id of me.owns)
          expect(domains.find((d) => d.id === id)?.owners, id).toContain(person)
      },
    )

    it.skipIf(lacks('signIn', 'getConnectRequest', 'answerConnectRequest'))(
      "an agent's sign-in nobody started has ended: nothing to show, and no answer is taken",
      async () => {
        const live = await signedIn()
        const unknown = 'no-agent-asked-to-connect-with-this-link-00'
        expect(await live.getConnectRequest({ id: unknown })).toBeNull()
        await expect(live.answerConnectRequest({ id: unknown, allow: true })).rejects.toMatchObject(
          {
            kind: 'not-found',
          },
        )
      },
    )

    it.skipIf(
      lacks(
        'signIn',
        'getWorkspace',
        'invite',
        'readInvite',
        'resendInvite',
        'removePerson',
        'undo',
      ),
    )(
      'invites with a link, lists the invite as owning its domains, and takes it back',
      async () => {
        const live = await signedIn()
        const before = await live.getWorkspace()
        const domain = before.people.find((p) => p.name === person)!.owns[0]!
        const email = `invited.${Date.now()}@larchwood.example`
        const made = await live.invite({ emails: [email, email], admin: false, owns: [domain] })
        expect(made.links.map((l) => l.email)).toEqual([email])
        const token = /#\/signin\?invite=([A-Za-z0-9_-]{43})$/.exec(made.links[0]!.link)?.[1]
        expect(token, made.links[0]!.link).toBeDefined()
        expect(await live.readInvite({ token: token! })).toMatchObject({
          email,
          admin: false,
          domains: [before.domains.find((d) => d.id === domain)!.name],
        })
        const after = await live.getWorkspace()
        expect(after.people.find((p) => p.name === email)).toMatchObject({
          invited: true,
          admin: false,
          owns: [domain],
        })
        expect(after.domains.find((d) => d.id === domain)!.owners).toContain(email)
        // Someone here already, and an open invite, are named, not invited again.
        const mine = emailOf(after.people.find((p) => p.name === person)!)
        const again = await live.invite({ emails: [email, mine], admin: false, owns: [] })
        expect(again.links).toEqual([])
        expect(again.skipped).toEqual([
          { email, why: 'pending' },
          { email: mine, why: 'member' },
        ])
        // Sending it again gives a new link; the old one opens nothing.
        const resent = await live.resendInvite({ name: email })
        expect(resent.link).not.toBe(made.links[0]!.link)
        expect(await live.readInvite({ token: token! })).toBeNull()
        // Taken back, it is gone; Undo invites them again.
        const taken = await live.removePerson({ name: email })
        expect(taken).toMatchObject({ removed: true })
        expect((await live.getWorkspace()).people.some((p) => p.name === email)).toBe(false)
        await live.undo({ token: (taken as { undo: string }).undo })
        expect((await live.getWorkspace()).people.find((p) => p.name === email)).toMatchObject({
          invited: true,
          owns: [domain],
        })
        await live.removePerson({ name: email })
      },
    )

    it.skipIf(lacks('signIn', 'getWorkspace', 'setOwner', 'setAdmin', 'removePerson', 'undo'))(
      'changes owners and roles, keeps an owner on every domain, and removes with Undo',
      async () => {
        const live = await signedIn()
        const { domains, people } = await live.getWorkspace()
        const domain = people.find((p) => p.name === person)!.owns[0]!
        // A colleague becomes an owner, and stops being one.
        expect(await live.setOwner({ name: colleague, domain, own: true })).toEqual({ done: true })
        expect((await live.getWorkspace()).domains.find((d) => d.id === domain)!.owners).toContain(
          colleague,
        )
        expect(await live.setOwner({ name: colleague, domain, own: false })).toEqual({ done: true })
        // The only owner of a domain stays.
        const sole = domains.find(
          (d) => d.owners.length === 1 && people.some((p) => p.name === d.owners[0] && !p.invited),
        )
        if (sole)
          expect(
            await live.setOwner({ name: sole.owners[0]!, domain: sole.id, own: false }),
          ).toEqual({
            done: false,
            last: true,
          })
        // An admin makes a colleague an admin, and a member again.
        await live.setAdmin({ name: colleague, admin: true })
        expect((await live.getWorkspace()).people.find((p) => p.name === colleague)!.admin).toBe(
          true,
        )
        await live.setAdmin({ name: colleague, admin: false })
        expect((await live.getWorkspace()).people.find((p) => p.name === colleague)!.admin).toBe(
          false,
        )
        // Someone who owns a domain alone hands over first; anyone else goes, and Undo brings them back.
        const alone = people.find(
          (p) =>
            p.name !== person &&
            !p.invited &&
            domains.some((d) => d.owners.length === 1 && d.owners[0] === p.name),
        )
        if (alone) {
          const refused = await live.removePerson({ name: alone.name })
          expect(refused).toMatchObject({ removed: false })
          expect((refused as { alone: string[] }).alone.length).toBeGreaterThan(0)
        }
        const leaver = people.find(
          (p) => p.name !== person && !p.invited && !p.owns.length && !p.admin,
        )!
        const removed = await live.removePerson({ name: leaver.name })
        expect(removed).toMatchObject({ removed: true })
        expect((await live.getWorkspace()).people.some((p) => p.name === leaver.name)).toBe(false)
        await live.undo({ token: (removed as { undo: string }).undo })
        expect((await live.getWorkspace()).people.some((p) => p.name === leaver.name)).toBe(true)
      },
    )

    it.skipIf(lacks('signIn', 'getWorkspace'))(
      'names the workspace, as an admin named it',
      async () => {
        expect((await (await signedIn()).getWorkspace()).name).not.toBe('')
      },
    )

    it.skipIf(lacks('signIn', 'getWorkspace', 'addDomain', 'updateDomain', 'removeDomain'))(
      'adds a domain from its page, renames it and writes its text, and deletes it while empty',
      async () => {
        const live = await signedIn()
        const name = `Finance ${Date.now() % 100_000}`
        const { id } = await live.addDomain({ name, owners: [person], text: 'Costs and budgets.' })
        let made = (await live.getWorkspace()).domains.find((d) => d.id === id)
        expect(made).toMatchObject({ name, owners: [person], covers: 'Costs and budgets.' })
        expect(made?.sandbox).toBeFalsy()
        const text = 'Costs, budgets and payroll.\n\nHouse rules: money is in euros.'
        await live.updateDomain({ id, name: `${name} and payroll`, text })
        made = (await live.getWorkspace()).domains.find((d) => d.id === id)
        expect(made).toMatchObject({
          name: `${name} and payroll`,
          text,
          covers: 'Costs, budgets and payroll.',
        })
        await live.removeDomain({ id })
        expect((await live.getWorkspace()).domains.some((d) => d.id === id)).toBe(false)
      },
    )

    it.skipIf(lacks('signIn', 'getWorkspace', 'getLibrary', 'removeDomain'))(
      "doesn't delete a domain with context, nor the sandbox",
      async () => {
        const live = await signedIn()
        const { domains } = await live.getWorkspace()
        const items = (await live.getLibrary()).items
        const held = domains.find((d) =>
          items.some(
            (f) => f.domain === d.id && (f.status === 'Live' || f.status === 'Needs checking'),
          ),
        )!
        await expect(live.removeDomain({ id: held.id })).rejects.toMatchObject({
          kind: 'conflict',
          message: expect.stringMatching(/Only an empty domain can be deleted/) as unknown,
        })
        const sandbox = domains.find((d) => d.sandbox)!
        expect(sandbox, 'a sandbox').toBeDefined()
        await expect(live.removeDomain({ id: sandbox.id })).rejects.toMatchObject({
          kind: 'conflict',
        })
        expect((await live.getWorkspace()).domains.map((d) => d.id)).toEqual(
          domains.map((d) => d.id),
        )
      },
    )

    it.skipIf(lacks('signIn', 'getSettings', 'setLinks', 'setTool'))(
      'switches a tool agents call off and on again, links among them',
      async () => {
        const live = await signedIn()
        const before = await live.getSettings()
        expect(Object.keys(before.tools)).toEqual(
          expect.arrayContaining(['get_context', 'find_context', 'read_context', 'report']),
        )
        await live.setTool({ name: 'suggest_context', on: false })
        expect((await live.getSettings()).tools.suggest_context).toBe(false)
        await live.setTool({ name: 'suggest_context', on: true })
        expect((await live.getSettings()).tools.suggest_context).toBe(true)
        await live.setLinks({ on: !before.links })
        expect((await live.getSettings()).links).toBe(!before.links)
        await live.setLinks({ on: before.links })
        expect((await live.getSettings()).links).toBe(before.links)
      },
    )

    it.skipIf(lacks('signIn', 'getSettings', 'getWorkspace', 'setPause'))(
      'pauses sharing for everything, or for one domain at a time, and lets it go on',
      async () => {
        const live = await signedIn()
        expect((await live.getSettings()).pause).toEqual({ all: false, domain: null })
        await live.setPause({ all: true })
        expect((await live.getSettings()).pause.all).toBe(true)
        await live.setPause({ all: false })
        const [first, second] = (await live.getWorkspace()).domains
        await live.setPause({ domain: first!.id })
        expect((await live.getSettings()).pause).toEqual({ all: false, domain: first!.id })
        // Another domain paused lets the first go on.
        await live.setPause({ domain: second!.id })
        expect((await live.getSettings()).pause.domain).toBe(second!.id)
        await live.setPause({ domain: null })
        expect((await live.getSettings()).pause).toEqual({ all: false, domain: null })
      },
    )

    // Figures in Ask (FR-716): Cube in the demo week reads figures from the demo warehouse.
    const orders = {
      metric: 'Orders',
      markets: ['Norway'],
      dates: '1 to 31 Aug 2026',
      state: 'grounded',
      sources: [],
    }

    it.skipIf(lacks('signIn', 'getSettings', 'getIntegrations', 'readFigure', 'setFigures'))(
      'shows no figure until figures are on for Cube, then one, with its source and query in words',
      async () => {
        const live = await signedIn()
        const settings = await live.getSettings()
        expect(settings.figures.cube).toBe(false)
        expect(settings.contacts.cube).toBe('Ravi Kapoor')
        expect(settings.connected).toContain('cube')
        // Reached at one host, its secret set, and none of the secret shown.
        const cube = (await live.getIntegrations()).figureConnections.cube!
        expect(cube).toMatchObject({ secretSet: true, contact: 'Ravi Kapoor' })
        expect(cube.endpoint).toMatch(/\/v1\/load$/)
        expect(cube.host).toBeTruthy()
        expect(JSON.stringify(cube)).not.toMatch(/secretTail|token/i)
        // Off: the answer links into the tool.
        expect(await live.readFigure(orders)).toMatchObject({
          kind: 'link',
          source: 'cube',
          scope: 'Orders in Norway, 1 to 31 Aug 2026',
        })
        await live.setFigures({ source: 'cube', on: true })
        try {
          expect((await live.getSettings()).figures.cube).toBe(true)
          const figure = await live.readFigure(orders)
          expect(figure).toMatchObject({
            kind: 'line',
            source: 'cube',
            asOf: 'today at 06:00',
            figure: {
              label: 'Orders in Norway, 1 to 31 Aug 2026',
              value: '€43,600',
              change: 'down 89% from July (€412,600)',
              words:
                'Orders, added up for Norway from 1 to 31 Aug 2026, and the same for 1 to 31 Jul 2026 to compare.',
            },
          })
          // A figure that can't be read for the question is no figure, never a guess.
          expect(await live.readFigure({ ...orders, dates: undefined })).toBeNull()
          expect(await live.readFigure({ ...orders, state: 'failed' })).toBeNull()
        } finally {
          await live.setFigures({ source: 'cube', on: false })
        }
        expect((await live.getSettings()).figures.cube).toBe(false)
      },
    )

    it.skipIf(lacks('signIn', 'getSettings', 'getIntegrations', 'tryFigure'))(
      "tries a figure from Cube's figures connection as saved, with figures off, keeping nothing",
      async () => {
        const live = await signedIn()
        expect((await live.getSettings()).figures.cube).toBe(false)
        // The first of Cube's views by name with a single date is Marketing, and its first measure
        // by name is Conversion rate: the demo warehouse has nothing for it in the last 7 days,
        // which still says the endpoint and its token work.
        const tried = await live.tryFigure({ source: 'cube' })
        expect(tried).toEqual({
          kind: 'figure',
          source: 'cube',
          label: 'Conversion rate, 17 to 23 Oct 2026',
          value: null,
          asOf: 'today at 06:00',
          took: expect.any(Number) as number,
        })
        expect(JSON.stringify(tried)).not.toMatch(/token|secret/i)
        // Trying changes nothing: figures stay off, and the connection is as it was.
        expect((await live.getSettings()).figures.cube).toBe(false)
        expect((await live.getIntegrations()).figureConnections.cube).toMatchObject({
          secretSet: true,
        })
      },
    )

    it.skipIf(lacks('signIn', 'getSettings', 'setDataContact', 'getIntegrations'))(
      'names who hears about a figure that looks wrong',
      async () => {
        const live = await signedIn()
        await live.setDataContact({ source: 'cube', name: colleague })
        try {
          expect((await live.getSettings()).contacts.cube).toBe(colleague)
          expect((await live.getIntegrations()).figureConnections.cube?.contact).toBe(colleague)
        } finally {
          await live.setDataContact({ source: 'cube', name: 'Ravi Kapoor' })
        }
        expect((await live.getSettings()).contacts.cube).toBe('Ravi Kapoor')
      },
    )

    it.skipIf(lacks('signIn', 'getLibrary', 'reportAnswer'))(
      'reports a figure that does not fit a context item, to its owners and the data contact',
      async () => {
        const live = await signedIn()
        const [item] = (await live.getLibrary()).items.filter((f) => f.status === 'Live')
        const sent = await live.reportAnswer({
          question: 'Why did orders in Norway drop in August?',
          part: 'figure',
          sources: [item!.id],
          what: "The figure doesn't fit this context item.",
          figure: {
            source: 'cube',
            to: 'both',
            metric: 'Orders',
            markets: ['Norway'],
            dates: '1 to 31 Aug 2026',
          },
        })
        expect(sent.id).toBeTruthy()
      },
    )

    it.skipIf(lacks('signIn', 'setFigureConnection', 'getIntegrations'))(
      "sets where an integration's figures are read, and shows the token as set, never what it is",
      async () => {
        const live = await signedIn()
        const token = 'conformance-figures-token-7a1e'
        await live.setFigureConnection({
          source: 'cube',
          endpoint: 'https://cube.example.test/cubejs-api/v1/load',
          token,
        })
        const cube = (await live.getIntegrations()).figureConnections.cube!
        expect(cube).toMatchObject({
          endpoint: 'https://cube.example.test/cubejs-api/v1/load',
          host: 'cube.example.test',
          secretSet: true,
        })
        expect(JSON.stringify(await live.getIntegrations())).not.toContain(token)
        expect(JSON.stringify(await live.getSettings())).not.toContain(token)
      },
    )

    it.skipIf(lacks('signIn', 'listAgentConnections', 'revokeAgentConnection'))(
      'lists the agents people connected, one row each, and revokes one',
      async () => {
        const live = await signedIn()
        const rows = await live.listAgentConnections()
        expect(rows.length).toBeGreaterThan(1)
        expect(new Set(rows.map((r) => r.key ?? `${r.agent}/${r.who}`)).size).toBe(rows.length)
        for (const r of rows) {
          expect(r.agent).not.toBe('')
          expect(r.since).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/)
          expect(r.used).not.toBe('')
        }
        const gone = rows.find((r) => r.who !== person && !r.key) ?? rows[0]!
        await live.revokeAgentConnection({ agent: gone.agent, who: gone.who })
        const after = await live.listAgentConnections()
        expect(after.some((r) => r.agent === gone.agent && r.who === gone.who)).toBe(false)
        expect(after.length).toBe(rows.length - 1)
      },
    )

    it.skipIf(lacks('signIn', 'createAccessKey', 'listAgentConnections', 'revokeAgentConnection'))(
      'creates an access key that is shown once, lists it by who made it, and revokes it',
      async () => {
        const live = await signedIn()
        const before = await live.listAgentConnections()
        const { key } = await live.createAccessKey()
        expect(key.length).toBeGreaterThanOrEqual(32)
        const rows = await live.listAgentConnections()
        const made = rows.filter((r) => r.key && !before.some((b) => b.key === r.key))
        expect(made).toHaveLength(1)
        expect(made[0]).toMatchObject({ agent: 'Access key', who: person, used: 'Never' })
        expect(made[0]!.since).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/)
        // Only the answer that made it holds the key: no read says it again.
        expect(JSON.stringify(rows)).not.toContain(key)
        expect(JSON.stringify(await live.getSettings())).not.toContain(key)
        await live.revokeAgentConnection({ agent: 'Access key', who: person, key: made[0]!.key! })
        const after = await live.listAgentConnections()
        expect(after.some((r) => r.key === made[0]!.key)).toBe(false)
        expect(after.length).toBe(rows.length - 1)
      },
    )

    it.skipIf(lacks('signIn', 'checkConnect'))(
      'waits while no agent signed in since the wait began',
      async () => {
        expect(
          await (await signedIn()).checkConnect({ since: Date.now(), agent: 'Claude Code' }),
        ).toEqual({ state: 'waiting' })
      },
    )

    it.skipIf(lacks('signIn', 'integrationsPage', 'integrationPage', 'getSettings'))(
      "lists the tools connected, each with how it is, and opens each one's page",
      async () => {
        const live = await signedIn()
        const { sources, connectable } = await live.integrationsPage()
        expect(sources.length).toBeGreaterThan(0)
        expect(new Set(sources.map((s) => s.id)).size).toBe(sources.length)
        expect(connectable).toEqual(
          expect.arrayContaining(['cube', 'google-drive', 'markdown-git']),
        )
        // Settings' menu counts the same tools.
        expect((await live.getSettings()).connected).toEqual(
          expect.arrayContaining([...new Set(sources.map((s) => s.connector))]),
        )
        for (const s of sources) {
          const tool = connectorById(s.connector)
          expect(tool, s.id).toBeDefined()
          expect(tool!.soon, s.id).toBeFalsy()
          expect(['healthy', 'reading', 'failed', 'reauth', 'paused'], s.id).toContain(s.health)
          expect(s.every, s.id).toMatch(/^(every [a-z0-9 ]+|when asked)$/)
          expect(s.staleAfter, s.id).toMatch(/^\d+ (minute|hour|day)s?$/)
          if (s.last) expect(s.last.at.time, s.id).toMatch(/^\d{2}:\d{2}$/)
          // A definitions tool holds definitions, a context tool documents; never both.
          expect(!!(s.definitions && s.documents), s.id).toBe(false)
          if (tool!.kind === 'definitions') expect(s.definitions, s.id).not.toBeNull()
          if (tool!.kind === 'context') expect(s.documents, s.id).not.toBeNull()
          const page = await live.integrationPage({ id: s.id })
          expect(page?.source, s.id).toEqual(s)
          for (const a of page!.activity) {
            expect(['ok', 'changed', 'failed'], s.id).toContain(a.tone)
            expect(a.what, s.id).not.toBe('')
          }
          for (const row of page!.connection) {
            expect(row.label, s.id).not.toBe('')
            // A secret is never shown: only whether one is set.
            expect(row.value, s.id).not.toMatch(/token_|BEGIN PRIVATE KEY|private_key/)
          }
        }
        expect(await live.integrationPage({ id: 'no-such-tool' })).toBeNull()
      },
    )

    it.skipIf(lacks('signIn', 'integrationsPage', 'integrationPage'))(
      "a document tool's page lists what its read made: suggestions waiting for owners, none published by the read",
      async () => {
        const live = await signedIn()
        const drive = (await live.integrationsPage()).sources.find(
          (s) => s.connector === 'google-drive',
        )
        expect(drive?.documents?.waiting).toBeGreaterThan(0)
        expect(drive!.inbox).toMatch(/^\/inbox/)
        const page = (await live.integrationPage({ id: drive!.id }))!
        expect(page.folders.length).toBeGreaterThan(0)
        for (const f of page.folders) {
          expect(f.folder).not.toBe('')
          expect(f.documents).toBeGreaterThanOrEqual(0)
        }
        const waiting = page.documents.filter((d) => d.state === 'waiting')
        expect(waiting.length).toBeGreaterThan(0)
        // Each links to its card in the Inbox where the binding knows it.
        expect(waiting.some((d) => /^\/inbox\?(.*&)?card=/.test(d.href ?? ''))).toBe(true)
        for (const d of page.documents)
          expect(d.href === undefined || d.state === 'waiting').toBe(true)
      },
    )

    it.skipIf(lacks('signIn', 'integrationsPage', 'readIntegration', 'pauseIntegration'))(
      'reads a tool again, and pauses reading it until an admin lets it go on',
      async () => {
        const live = await signedIn()
        const health = async (id: string) =>
          (await live.integrationsPage()).sources.find((s) => s.id === id)!.health
        const cube = (await live.integrationsPage()).sources.find((s) => s.connector === 'cube')!
        await live.readIntegration({ id: cube.id })
        expect(await health(cube.id)).toBe('reading')
        await live.pauseIntegration({ id: cube.id, paused: true })
        const paused = (await live.integrationsPage()).sources.find((s) => s.id === cube.id)!
        expect(paused).toMatchObject({ health: 'paused', next: null })
        await expect(live.readIntegration({ id: cube.id })).rejects.toMatchObject({
          kind: 'conflict',
        })
        await live.pauseIntegration({ id: cube.id, paused: false })
        expect(await health(cube.id)).not.toBe('paused')
        await expect(live.readIntegration({ id: 'no-such-tool' })).rejects.toMatchObject({
          kind: 'not-found',
        })
      },
    )

    it.skipIf(lacks('signIn', 'connectForm'))(
      "draws a tool's connect form from its connector's manifest, and a connected one's settings without a secret",
      async () => {
        const live = await signedIn()
        const fresh = (await live.connectForm({ id: 'markdown-git' }))!
        expect(fresh).toMatchObject({ connector: 'markdown-git', source: null, chosen: [] })
        const field = (key: string) => fresh.fields.find((f) => f.key === key)
        expect(field('repository')).toMatchObject({ kind: 'address', required: true })
        expect(field('ref')?.value).toBe('main')
        expect(fresh.secrets).toEqual([expect.objectContaining({ key: 'token', set: false })])
        expect(fresh.every).toBe('every day')
        expect(fresh.perDay).toBeGreaterThan(0)
        // A connected tool's form is its settings, by its page's id: secrets only as set or not.
        const drive = (await live.integrationsPage()).sources.find(
          (s) => s.connector === 'google-drive',
        )!
        const settings = (await live.connectForm({ id: drive.id }))!
        expect(settings.source).toMatchObject({ id: drive.id })
        expect(settings.source!.revision).toBeGreaterThan(0)
        expect(settings.chosen.length).toBeGreaterThan(0)
        for (const c of settings.chosen) expect(c.domain, c.id).not.toBeNull()
        expect(settings.secrets.map((s) => s.key)).toEqual(['serviceAccountKey'])
        expect(JSON.stringify(settings)).not.toMatch(/private_key|BEGIN PRIVATE KEY/)
        expect(await live.connectForm({ id: 'no-such-tool' })).toBeNull()
        expect(await live.connectForm({ id: 'notion' })).toBeNull()
      },
    )

    it.skipIf(lacks('signIn', 'testIntegration'))(
      "tests a tool's settings, keeping nothing: what it may read, or why it can't",
      async () => {
        const live = await signedIn()
        const config = { repository: repository.address, ref: 'main', folder: 'docs' }
        const secrets = { token: repository.token ?? '' }
        const test = await live.testIntegration({ connector: 'markdown-git', config, secrets })
        expect(test.ok, JSON.stringify(test)).toBe(true)
        expect(test.steps.length).toBeGreaterThan(0)
        for (const step of test.steps) expect(step.status, step.title).not.toBe('failed')
        expect(test.scopes.length).toBeGreaterThan(0)
        expect(new Set(test.scopes.map((s) => s.id)).size).toBe(test.scopes.length)
        // Nothing was connected by the test.
        expect(
          (await live.integrationsPage()).sources.some((s) => s.connector === 'markdown-git'),
        ).toBe(false)
        const empty = await live.testIntegration({
          connector: 'markdown-git',
          config: { ...config, repository: '' },
          secrets,
        })
        expect(empty.ok).toBe(false)
      },
    )

    it.skipIf(
      lacks(
        'signIn',
        'testIntegration',
        'connectIntegration',
        'changeIntegration',
        'disconnectIntegration',
        'connectForm',
        'integrationsPage',
        'getLibrary',
      ),
    )(
      'connects a tool, changes its settings and disconnects it; nothing is published by any of it',
      async () => {
        const live = await signedIn()
        const published = async () =>
          (await live.getLibrary()).items.filter((f) => f.status === 'Live').length
        const before = await published()
        const config = { repository: repository.address, ref: 'main', folder: 'docs' }
        const secrets = { token: repository.token ?? '' }
        const test = await live.testIntegration({ connector: 'markdown-git', config, secrets })
        const { domains } = await live.getWorkspace()
        const scope = test.scopes[0]!
        const chosen = [{ id: scope.id, title: scope.title, domain: domains[0]!.id }]
        await expect(
          live.connectIntegration({
            connector: 'markdown-git',
            config,
            secrets,
            chosen,
            reason: '',
          }),
        ).rejects.toMatchObject({ kind: 'invalid' })
        const added = await live.connectIntegration({
          connector: 'markdown-git',
          config,
          secrets,
          chosen,
          reason: 'Our handbook lives in Git',
        })
        const row = (await live.integrationsPage()).sources.find((s) => s.id === added.id)
        expect(row?.connector).toBe('markdown-git')
        const form = (await live.connectForm({ id: added.id }))!
        expect(form.source?.id).toBe(added.id)
        expect(form.chosen).toEqual(chosen)
        expect(form.fields.find((f) => f.key === 'repository')?.value).toBe(repository.address)
        if (repository.token) {
          expect(form.secrets.find((s) => s.key === 'token')?.set).toBe(true)
          expect(JSON.stringify(form)).not.toContain(repository.token)
        }
        // Change settings: a secret left empty stays, and the change keeps what it was given.
        const changed = [{ ...chosen[0]!, domain: domains.at(-1)!.id }]
        await live.changeIntegration({
          id: added.id,
          revision: form.source!.revision,
          config: { ...config, ref: 'main' },
          secrets: { token: '' },
          chosen: changed,
          reason: 'The handbook moved to another domain',
        })
        const after = (await live.connectForm({ id: added.id }))!
        expect(after.chosen).toEqual(changed)
        if (repository.token) expect(after.secrets.find((s) => s.key === 'token')?.set).toBe(true)
        await live.disconnectIntegration({ id: added.id })
        expect((await live.integrationsPage()).sources.some((s) => s.id === added.id)).toBe(false)
        expect(await live.integrationPage({ id: added.id })).toBeNull()
        await expect(live.disconnectIntegration({ id: added.id })).rejects.toMatchObject({
          kind: 'not-found',
        })
        expect(await published()).toBe(before)
      },
    )

    it.skipIf(lacks('signIn', 'advancedPage'))(
      'reads Settings, Advanced: every setting in words, what was deleted, the log, jobs and editions',
      async () => {
        const page = await (await signedIn()).advancedPage()
        const rows = page.settings.flatMap((g) => g.rows)
        expect(rows.map((r) => r.key).sort()).toEqual([...settingKeys].sort())
        expect(page.settings.some((g) => g.group === 'Other')).toBe(false)
        for (const r of rows) {
          expect(r.value, r.key).not.toBe('')
          expect(r.what, r.key).not.toBe('')
          if (r.changed) expect(r.changed.who, r.key).not.toBe('')
        }
        expect(rows.find((r) => r.key === 'privacy.min_count')).toMatchObject({
          value: '5',
          changed: null,
        })
        for (const d of page.deleted) expect(d.hint).toMatch(/^Deleted by .+, .+: .+\.$/)
        expect(new Set(page.deleted.map((d) => d.key)).size).toBe(page.deleted.length)
        expect(page.history.length).toBeGreaterThan(0)
        for (const h of page.history) {
          expect(h.who).not.toBe('')
          expect(h.what).not.toBe('')
        }
        for (const e of page.editions) expect(e.label).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
      },
    )

    it.skipIf(lacks('signIn', 'checkHistory', 'exportHistory', 'exportContext'))(
      'checks the history chain, and exports the log and the context as files',
      async () => {
        const live = await signedIn()
        expect((await live.checkHistory()).whole).toBe(true)
        const log = await live.exportHistory()
        expect(log.name).toMatch(/^history-.+\.jsonl$/)
        expect(log.content.split('\n').length).toBeGreaterThan(0)
        for (const line of log.content.split('\n'))
          expect(() => JSON.parse(line) as unknown).not.toThrow()
        const context = await live.exportContext()
        expect(context.name).toMatch(/^context-.+\.json$/)
        expect(JSON.parse(context.content)).toBeTypeOf('object')
      },
    )

    it.skipIf(lacks('signIn', 'getSession', 'getWorkspace', 'setAbout', 'completeSetupStep'))(
      'keeps what the business is about, and the setup checklist counts it written',
      async () => {
        const live = await signedIn()
        // The person's workspace has finished its setup: it opens on the Inbox, not the checklist.
        expect((await live.getSession()).install).toBe('normal')
        const text = 'We rent bikes in three cities.\n\n- Ride: one rental, paid when it ends.'
        await live.setAbout({ text })
        await live.completeSetupStep({ step: 'about' })
        const workspace = await live.getWorkspace()
        expect(workspace.about).toBe(text)
        expect(workspace.setup.done.about).toBe(true)
        expect(workspace.aboutTemplate).toMatch(/outdoor-gear retailer/)
      },
    )

    it.skipIf(lacks('signIn', 'getVocabulary'))(
      'lists the metrics, the dimensions and the markets questions name',
      async () => {
        const vocabulary = await (await signedIn()).getVocabulary()
        expect(vocabulary.metrics.map((m) => m.name)).toContain('Orders')
        expect(vocabulary.markets).toContain('Norway')
        expect(new Set(vocabulary.markets).size).toBe(vocabulary.markets.length)
      },
    )

    it.skipIf(lacks('signIn', 'getInbox', 'inboxPage', 'getReviews'))(
      "reads the same Inbox both ways, and a review for each of the person's suggestions",
      async () => {
        const live = await signedIn()
        const [inbox, page] = [await live.getInbox(), await live.inboxPage()]
        expect(inbox.cards.map((c) => c.id)).toEqual(page.cards.map((c) => c.id))
        const mine = inbox.cards.filter((c) => c.for === person)
        const reviews = await live.getReviews()
        expect(new Set(reviews.map((r) => r.id)).size).toBe(reviews.length)
        for (const card of mine.filter((c) => c.type === 'suggestion'))
          expect(
            reviews.map((r) => r.id),
            card.id,
          ).toContain(card.id)
        for (const r of reviews) {
          expect(r.title, r.id).not.toBe('')
          expect(['edit', 'new', 'retire'], r.id).toContain(r.mode)
          for (const c of r.counts) expect(c.n, r.id).toBeGreaterThan(0)
        }
      },
    )

    it.skipIf(lacks('signIn', 'getConnectReview'))(
      'shows no live line of a connect review outside one',
      async () => {
        expect(await (await signedIn()).getConnectReview()).toBeNull()
      },
    )

    /** The first undecided card of this type in the person's own Inbox. */
    async function cardOf(type: CardType): Promise<InboxCard> {
      await api().signIn({ name: person, fresh: false })
      const inbox = await api().inboxPage()
      const card = inbox.cards.find((c) => c.type === type && c.for === person && !inbox.done[c.id])
      expect(card, `a ${type} card for ${person}`).toBeDefined()
      return card!
    }

    it.skipIf(lacks('signIn', 'inboxPage', 'markOpened'))(
      'keeps a card the person opened as opened',
      async () => {
        const card = await cardOf('suggestion')
        await api().markOpened({ ids: [card.id] })
        expect((await api().inboxPage()).opened[card.id]).toBe(true)
      },
    )

    it.skipIf(lacks('signIn', 'inboxPage', 'markReviewed'))(
      'keeps a suggestion the person read as read, so it can be published with others',
      async () => {
        const card = await cardOf('suggestion')
        await api().markReviewed({ id: card.id })
        expect((await api().inboxPage()).reviewed[card.id]).toBe(true)
      },
    )

    it.skipIf(lacks('signIn', 'inboxPage', 'completeCard', 'undo'))(
      'closes a report that is not a problem, and Undo opens it again',
      async () => {
        const card = await cardOf('flag')
        const { undo } = await api().completeCard({ card: card.id, outcome: 'Not a problem' })
        expect((await api().inboxPage()).done[card.id]?.label).toBe('Not a problem')
        await api().undo({ token: undo })
        expect((await api().inboxPage()).done[card.id]).toBeUndefined()
      },
    )

    it.skipIf(lacks('signIn', 'inboxPage', 'getReviews', 'publishReview', 'undo'))(
      'publishes a suggestion, and Undo puts it back to wait',
      async () => {
        await api().signIn({ name: person, fresh: false })
        const inbox = await api().inboxPage()
        const reviews = await api().getReviews()
        const plain = reviews.find(
          (r) =>
            !r.clash &&
            r.mode !== 'retire' &&
            inbox.cards.some((c) => c.id === r.id && c.for === person && !inbox.done[c.id]),
        )
        expect(plain, `a suggestion for ${person} with no clash`).toBeDefined()
        const { undo } = await api().publishReview({ id: plain!.id })
        expect((await api().inboxPage()).done[plain!.id]?.label).toBe('Published')
        await api().undo({ token: undo })
        expect((await api().inboxPage()).done[plain!.id]).toBeUndefined()
      },
    )

    it.skipIf(lacks('signIn', 'getReviews', 'getLibrary', 'publishReview', 'undo'))(
      'publishes each answer to a clash for its own live item: only the one it replaces is archived',
      async () => {
        const live = await signedIn()
        const r = (await live.getReviews()).find((x) => (x.clash?.items.length ?? 0) > 1)
        expect(r, 'a suggestion that overlaps more than one live item').toBeDefined()
        const items = r!.clash!.items
        const replaced = items.at(-1)!
        const status = async (id: string) =>
          (await live.getLibrary()).items.find((f) => f.id === id)?.status
        // An answer for one of them is not an answer for the others: Publish waits.
        await expect(
          live.publishReview({ id: r!.id, relations: { [replaced.factId]: 'replaces' } }),
        ).rejects.toMatchObject({ kind: 'invalid' })
        expect(await status(replaced.factId)).toBe('Live')
        const relations = Object.fromEntries(
          items.map((c) => [c.factId, c === replaced ? 'replaces' : 'unrelated'] as const),
        )
        const { undo } = await live.publishReview({ id: r!.id, relations })
        expect(await status(replaced.factId)).toBe('Archived')
        for (const c of items.filter((x) => x !== replaced))
          expect(await status(c.factId), c.title).toBe('Live')
        await live.undo({ token: undo })
        expect(await status(replaced.factId)).toBe('Live')
      },
    )

    it.skipIf(lacks('signIn', 'inboxPage', 'returnReview', 'undo'))(
      'returns a suggestion with a note, and Undo puts it back to wait',
      async () => {
        const card = await cardOf('suggestion')
        const note = {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Which markets?' }] }],
        }
        const { undo } = await api().returnReview({ id: card.id, note })
        expect((await api().inboxPage()).done[card.id]?.label).toBe('Returned')
        await api().undo({ token: undo })
        expect((await api().inboxPage()).done[card.id]).toBeUndefined()
      },
    )

    /* ---------- comments ---------- */

    const comments = [
      'signIn',
      'getLibrary',
      'getComments',
      'postComment',
    ] as const satisfies readonly HeedApiMethod[]
    /** A paragraph of words, and a mention of someone when given. */
    const said = (words: string, mention?: string) => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: words },
            ...(mention
              ? [{ type: 'mention', attrs: { id: `person:${mention}`, label: mention } }]
              : []),
          ],
        },
      ],
    })
    /** A live item's thread, signed in as `who`, and words of this run so a case finds its own. */
    async function threadAs(who: string) {
      await api().signIn({ name: who, fresh: false })
      const item = (await api().getLibrary()).items.find((f) => f.status === 'Live')!
      return { subject: `context:${item.id}` as Subject, mark: Math.random().toString(36).slice(2) }
    }
    const find = async (subject: Subject, id: string) =>
      ((await api().getComments()).threads[subject] ?? [])
        .flatMap((c) => [c, ...(c.replies ?? [])])
        .find((c) => c.id === id)

    it.skipIf(lacks(...comments))(
      'posts a comment and a reply on a context item, by their author, and reads them back',
      async () => {
        const { subject, mark } = await threadAs(person)
        const { id } = await api().postComment({ subject, content: said(`Still true? ${mark}`) })
        await api().signIn({ name: colleague, fresh: false })
        const reply = await api().postComment({
          subject,
          content: said(`Yes ${mark}`),
          parentId: id,
        })
        const thread = (await api().getComments()).threads[subject] ?? []
        const top = thread.find((c) => c.id === id)
        expect(top).toMatchObject({ author: person })
        expect(plainOf(top!.content)).toBe(`Still true? ${mark}`)
        expect(top!.when).not.toBe('')
        expect(top!.replies?.map((r) => [r.id, r.author, plainOf(r.content)])).toEqual([
          [reply.id, colleague, `Yes ${mark}`],
        ])
      },
    )

    it.skipIf(lacks(...comments, 'editComment', 'removeComment'))(
      'lets only the author edit and delete, and keeps a deleted comment that is answered',
      async () => {
        const { subject, mark } = await threadAs(person)
        const { id } = await api().postComment({ subject, content: said(`First ${mark}`) })
        await api().signIn({ name: colleague, fresh: false })
        await expect(
          api().editComment({ subject, id, content: said(`Mine ${mark}`) }),
        ).rejects.toMatchObject({ kind: 'forbidden' })
        await expect(api().removeComment({ subject, id })).rejects.toMatchObject({
          kind: 'forbidden',
        })
        await api().postComment({ subject, content: said(`Agreed ${mark}`), parentId: id })
        await api().signIn({ name: person, fresh: false })
        await api().editComment({ subject, id, content: said(`Second ${mark}`) })
        const edited = await find(subject, id)
        expect(edited).toMatchObject({ edited: true })
        expect(plainOf(edited!.content)).toBe(`Second ${mark}`)
        await api().removeComment({ subject, id })
        expect(await find(subject, id)).toMatchObject({ deleted: true })
        const alone = await api().postComment({ subject, content: said(`Never mind ${mark}`) })
        await api().removeComment({ subject, id: alone.id })
        expect(await find(subject, alone.id)).toBeUndefined()
      },
    )

    it.skipIf(lacks(...comments, 'reactToComment', 'reactToSubject'))(
      'gives and takes back one of the five reactions, and no other',
      async () => {
        const { subject, mark } = await threadAs(person)
        const mine = (list: { emoji: string; by: string[] }[] | undefined) =>
          (list ?? []).filter((r) => r.by.includes(person)).map((r) => r.emoji)
        const before = mine((await api().getComments()).reactions[subject])
        const emoji = before.includes('🙏') ? '🤔' : '🙏'
        await api().reactToSubject({ subject, emoji })
        expect(mine((await api().getComments()).reactions[subject])).toContain(emoji)
        await api().reactToSubject({ subject, emoji })
        expect(mine((await api().getComments()).reactions[subject])).not.toContain(emoji)
        const { id } = await api().postComment({ subject, content: said(`Shipped ${mark}`) })
        await api().reactToComment({ subject, id, emoji: '✅' })
        expect(mine((await find(subject, id))!.reactions)).toEqual(['✅'])
        await expect(api().reactToSubject({ subject, emoji: '🎉' as '👍' })).rejects.toMatchObject({
          kind: 'invalid',
        })
      },
    )

    it.skipIf(lacks(...comments, 'markMentionSeen'))(
      'brings a mention to the person mentioned until they read it',
      async () => {
        const { subject, mark } = await threadAs(person)
        const { id } = await api().postComment({
          subject,
          content: said(`Can you check? ${mark} `, colleague),
        })
        await api().signIn({ name: colleague, fresh: false })
        const notes = mentionNotesOf(await api().getComments()).get(colleague) ?? []
        expect(notes.find((n) => n.id === id)).toMatchObject({ subject, from: person })
        await api().markMentionSeen({ subject })
        const after = mentionNotesOf(await api().getComments()).get(colleague) ?? []
        expect(after.some((n) => n.subject === subject)).toBe(false)
      },
    )

    it.skipIf(lacks(...comments, 'markThreadSeen'))('opens a thread', async () => {
      const { subject } = await threadAs(person)
      await api().markThreadSeen({ subject })
      expect((await api().getComments()).newReplies[subject]).toBeUndefined()
    })

    it.skipIf(lacks('signIn', 'inboxPage', 'decideCard', 'undo'))(
      'checks a card that is due as still true, and Undo makes it due again',
      async () => {
        const card = await cardOf('check')
        const { undo } = await api().decideCard({ card: card.id, outcome: 'Checked' })
        expect((await api().inboxPage()).done[card.id]?.label).toBe('Checked')
        await api().undo({ token: undo })
        expect((await api().inboxPage()).done[card.id]).toBeUndefined()
      },
    )

    it.skipIf(lacks('signIn', 'inboxPage', 'getReviews', 'markReviewed', 'publishReviews', 'undo'))(
      'publishes the plain changes the person read together, and Undo puts all back',
      async () => {
        await api().signIn({ name: person, fresh: false })
        const inbox = await api().inboxPage()
        const plain = (await api().getReviews())
          .filter(
            (r) =>
              readiness(r).bulk &&
              inbox.cards.some((c) => c.id === r.id && c.for === person && !inbox.done[c.id]),
          )
          .slice(0, 2)
        expect(plain, `two plain changes for ${person}`).toHaveLength(2)
        for (const r of plain) await api().markReviewed({ id: r.id })
        const { undo } = await api().publishReviews({ ids: plain.map((r) => r.id) })
        const after = await api().inboxPage()
        for (const r of plain) expect(after.done[r.id]?.label, r.id).toBe('Published')
        await api().undo({ token: undo })
        const back = await api().inboxPage()
        for (const r of plain) expect(back.done[r.id], r.id).toBeUndefined()
      },
    )

    it.skipIf(lacks('signIn', 'inboxPage', 'getReviews', 'archiveReview', 'undo'))(
      'archives what a suggestion to archive names, and Undo brings it back',
      async () => {
        await api().signIn({ name: person, fresh: false })
        const inbox = await api().inboxPage()
        const retire = (await api().getReviews()).find(
          (r) =>
            r.mode === 'retire' &&
            inbox.cards.some((c) => c.id === r.id && c.for === person && !inbox.done[c.id]),
        )
        expect(retire, `a suggestion to archive for ${person}`).toBeDefined()
        const { undo } = await api().archiveReview({ id: retire!.id })
        expect((await api().inboxPage()).done[retire!.id]?.label).toBe('Archived')
        await api().undo({ token: undo })
        expect((await api().inboxPage()).done[retire!.id]).toBeUndefined()
      },
    )

    /* ---------- a suggestion to archive taken back in the comments ---------- */

    /** The person's suggestion to archive that its sender took back, still waiting. */
    async function withdrawnRetirement() {
      await api().signIn({ name: person, fresh: false })
      const inbox = await api().inboxPage()
      return (await api().getReviews()).find(
        (r) =>
          r.mode === 'retire' &&
          r.retire?.withdrawn &&
          inbox.cards.some((c) => c.id === r.id && c.for === person && !inbox.done[c.id]),
      )
    }

    it.skipIf(lacks('signIn', 'inboxPage', 'getReviews', 'getLibrary', 'closeReview', 'undo'))(
      'closes a suggestion to archive its sender took back: nothing changes, and Undo brings it back',
      async () => {
        const r = await withdrawnRetirement()
        expect(r, `a withdrawn suggestion to archive for ${person}`).toBeDefined()
        expect(r!.retire!.withdrawn).toMatchObject({ by: r!.from })
        expect(r!.retire!.withdrawn!.quote).not.toBe('')
        expect(readiness(r!)).toMatchObject({ ok: false, title: `Withdrawn by ${r!.from}` })
        const live = async () =>
          (await api().getLibrary()).items.find((f) => f.id === r!.retire!.factId)?.status
        const before = await live()
        expect(before).not.toBe('Archived')
        const { undo } = await api().closeReview({ id: r!.id })
        expect((await api().inboxPage()).done[r!.id]?.label).toBe('Closed')
        expect(await live()).toBe(before)
        await api().undo({ token: undo })
        expect((await api().inboxPage()).done[r!.id]).toBeUndefined()
        expect((await withdrawnRetirement())?.id).toBe(r!.id)
      },
    )

    it.skipIf(lacks('signIn', 'inboxPage', 'getReviews', 'closeReview'))(
      'closes nothing its sender did not take back',
      async () => {
        await api().signIn({ name: person, fresh: false })
        const inbox = await api().inboxPage()
        const plain = (await api().getReviews()).find(
          (r) =>
            r.mode !== 'retire' &&
            inbox.cards.some((c) => c.id === r.id && c.for === person && !inbox.done[c.id]),
        )
        expect(plain, `a suggestion for ${person}`).toBeDefined()
        await expect(api().closeReview({ id: plain!.id })).rejects.toMatchObject({
          kind: 'conflict',
        })
        expect((await api().inboxPage()).done[plain!.id]).toBeUndefined()
      },
    )

    it.skipIf(lacks(...comments, 'getReviews', 'removeComment', 'withdrawWithComment'))(
      "takes a suggestion back with a comment only for its sender: not with the owner's words",
      async () => {
        await api().signIn({ name: person, fresh: false })
        const r = (await api().getReviews()).find((x) => x.mode === 'retire' && x.from !== person)
        expect(r, `someone else's suggestion to archive for ${person}`).toBeDefined()
        const subject = `review:${r!.id}` as Subject
        expect((await api().getComments()).withdrawable[subject]).toBeFalsy()
        const { id } = await api().postComment({ subject, content: said('Is January complete?') })
        await expect(
          api().withdrawWithComment({ subject, id, withdrew: true }),
        ).rejects.toMatchObject({ kind: 'conflict' })
        expect((await find(subject, id))?.withdrew).toBeFalsy()
        await api().removeComment({ subject, id })
      },
    )

    it.skipIf(!sender || lacks(...comments, 'getReviews', 'removeComment', 'withdrawWithComment'))(
      'lets its sender take their suggestion to archive back with a comment, and the mark back again',
      async () => {
        await api().signIn({ name: sender!, fresh: false })
        const all = await api().getComments()
        const subject = (Object.keys(all.withdrawable) as Subject[]).find(
          (s) => all.withdrawable[s],
        )
        expect(subject, `a suggestion to archive ${sender} sent`).toBeDefined()
        const marked = () =>
          (all.threads[subject!] ?? [])
            .flatMap((c) => [c, ...(c.replies ?? [])])
            .find((c) => c.withdrew)?.id
        const before = marked()
        const words = 'On second thought, two days are still short.'
        const { id } = await api().postComment({ subject: subject!, content: said(words) })
        await api().withdrawWithComment({ subject: subject!, id, withdrew: true })
        const thread = (await api().getComments()).threads[subject!] ?? []
        expect(
          thread
            .flatMap((c) => [c, ...(c.replies ?? [])])
            .filter((c) => c.withdrew)
            .map((c) => c.id),
        ).toEqual([id])
        // Its owner reads the sender's words in the review.
        await api().signIn({ name: person, fresh: false })
        const review = (await api().getReviews()).find((x) => `review:${x.id}` === subject)
        expect(review?.retire?.withdrawn).toMatchObject({ by: sender, quote: words })
        // The mark goes back, and so does the comment.
        await api().signIn({ name: sender!, fresh: false })
        await api().withdrawWithComment({ subject: subject!, id, withdrew: false })
        expect((await find(subject!, id))?.withdrew).toBeFalsy()
        if (before)
          await api().withdrawWithComment({ subject: subject!, id: before, withdrew: true })
        await api().removeComment({ subject: subject!, id })
      },
    )

    /* ---------- People: what someone checked lately ---------- */

    it.skipIf(lacks('signIn', 'getLibrary', 'getActivity'))(
      'says what someone checked lately: up to three items they checked, newest first, as the library has them',
      async () => {
        const live = await signedIn()
        const { items } = await live.getLibrary()
        const checkers = [...new Set(items.map((f) => f.checkedBy).filter(Boolean))]
        expect(checkers.length).toBeGreaterThan(0)
        for (const name of checkers) {
          const theirs = items.filter((f) => f.checkedBy === name)
          const recent = await live.getActivity({ name })
          expect(recent, name).toHaveLength(Math.min(3, theirs.length))
          for (const line of recent)
            expect(
              theirs.some((f) => line.what === `Checked ${f.title}` && line.when === f.checkedOn),
              `${name}: ${line.what}, ${line.when}`,
            ).toBe(true)
          const days = recent.map((line) => labelDay(line.when) ?? '')
          expect(days, name).toEqual([...days].sort().reverse())
        }
        expect(await live.getActivity({ name: 'Nobody Here' })).toEqual([])
      },
    )

    /* ---------- Ask ---------- */

    const states = ['grounded', 'partial', 'missing', 'conflict', 'stale', 'failed']

    it.skipIf(lacks('signIn', 'readQuestion'))(
      'reads a question as a metric and its markets, with no model',
      async () => {
        const read = await (
          await signedIn()
        ).readQuestion({ question: 'How did orders in Norway and Spain do in September?' })
        expect(read.metric).toBe('Orders')
        expect(read.markets).toEqual(expect.arrayContaining(['Norway', 'Spain']))
      },
    )

    it.skipIf(lacks('signIn', 'ask', 'getLibrary'))(
      'answers a question with its state, numbered sources from the library and what agents are told',
      async () => {
        const a = await signedIn()
        const answer = await a.ask({ question: 'Why did orders in Norway drop in August?' })
        const library = new Set((await a.getLibrary()).items.map((f) => f.id))
        expect(states).toContain(answer.state)
        expect(answer).toMatchObject({ metric: 'Orders', markets: ['Norway'] })
        expect(answer.sources.length).toBeGreaterThan(0)
        for (const id of answer.sources) expect(library.has(id), id).toBe(true)
        // Every [n] in the words points at a source.
        for (const [, n] of answer.text.matchAll(/\[(\d+)\]/g))
          expect(Number(n)).toBeLessThanOrEqual(answer.sources.length)
        expect(answer.said).not.toBe('')
      },
    )

    it.skipIf(lacks('signIn', 'ask', 'getLibrary', 'setLinks'))(
      'says what an answer followed with get_related: one step, a retired link apart, nothing while switched off',
      async () => {
        const a = await signedIn()
        const question = 'Why did orders in Norway drop in August?'
        const answer = await a.ask({ question })
        const { items } = await a.getLibrary()
        const stop = items.find(
          (f) => f.title === 'Online sales to Norway stopped on 4 August 2026',
        )!
        expect(answer.links?.on).toBe(true)
        // The term the Norway item's text mentions: followed, with what it means.
        const webshop = answer.links!.followed.find((f) => f.to.id === 'term:Webshop')
        expect(webshop).toMatchObject({
          from: { id: stop.id, title: stop.title },
          rel: 'mentions',
          to: { label: 'Webshop' },
        })
        expect(webshop!.read).toContain('larchwood.example')
        // The payment provider's switch is retired: listed, never followed.
        expect(answer.links!.notFollowed).toContainEqual({
          from: { id: stop.id, title: stop.title },
          rel: 'mentions',
          to: {
            id: 'context:itm_kh4llvi9',
            label: 'Payment provider switched in Norway on 9 July 2025',
          },
        })
        // One step, each once, and never an item the answer has already.
        const ends = answer.links!.followed.map((f) => f.to.id)
        expect(new Set(ends).size).toBe(ends.length)
        for (const id of answer.sources) expect(ends).not.toContain(`context:${id}`)
        await a.setLinks({ on: false })
        try {
          const off = await a.ask({ question })
          expect(off.links).toEqual({ on: false, followed: [], notFollowed: [] })
          // Following links never changes what the answer has.
          expect(off.sources).toEqual(answer.sources)
        } finally {
          await a.setLinks({ on: true })
        }
      },
    )

    it.skipIf(lacks('signIn', 'ask'))(
      'answers a question that names nothing as Not found, with no sources',
      async () => {
        const answer = await (
          await signedIn()
        ).ask({ question: 'What is our refund policy for gift cards?' })
        expect(answer.state).toBe('missing')
        expect(answer.sources).toEqual([])
        expect(answer.text).not.toBe('')
      },
    )

    it.skipIf(lacks('signIn', 'askedThisWeek', 'ask'))(
      'lists what agents asked this week, most first and 5 times or more, each with the state Ask gives it',
      async () => {
        const a = await signedIn()
        const week = await a.askedThisWeek()
        expect(week.rows.length).toBeGreaterThan(0)
        expect(week.asked).toBeGreaterThanOrEqual(5)
        const times = week.rows.map((r) => r.times)
        expect(times).toEqual([...times].sort((x, y) => y - x))
        for (const r of week.rows) {
          expect(r.times, r.title).toBeGreaterThanOrEqual(5)
          expect(states, r.title).toContain(r.state)
        }
        // Asking a row gets the state its row shows.
        for (const r of week.rows.slice(0, 4))
          expect((await a.ask({ question: r.question })).state, r.title).toBe(r.state)
      },
    )

    it.skipIf(lacks('signIn', 'getAskExamples', 'ask'))(
      'offers questions to ask, and asking one by its id answers its words',
      async () => {
        const a = await signedIn()
        const examples = await a.getAskExamples()
        expect(examples.length).toBeGreaterThan(0)
        for (const e of examples.slice(0, 3)) {
          const byId = await a.ask({ example: e.id })
          const byWords = await a.ask({ question: e.question })
          expect(byId.question, e.id).toBe(e.question)
          expect(byId.state, e.id).toBe(byWords.state)
          expect(byId.sources, e.id).toEqual(byWords.sources)
        }
      },
    )

    it.skipIf(lacks('signIn', 'listChats', 'saveChat', 'renameChat', 'deleteChat', 'undo'))(
      "keeps the person's chats: a new one first in Today, renamed, deleted, and Undo puts it back",
      async () => {
        const a = await signedIn()
        const id = `chat-${Date.now()}`
        await a.saveChat({ id, question: 'How did orders in Spain change in October 2026?' })
        const [first] = await a.listChats()
        expect(first).toMatchObject({
          id,
          question: 'How did orders in Spain change in October 2026?',
          day: 'Today',
        })
        await a.renameChat({ id, title: 'Spain in October' })
        expect((await a.listChats()).find((t) => t.id === id)?.title).toBe('Spain in October')
        const { undo } = await a.deleteChat({ id })
        expect((await a.listChats()).some((t) => t.id === id)).toBe(false)
        await a.undo({ token: undo })
        expect((await a.listChats()).find((t) => t.id === id)?.title).toBe('Spain in October')
      },
    )

    it.skipIf(lacks('signIn', 'ask', 'reportAnswer', 'getMyReports'))(
      "sends a named report on an answer, and lists it as the person's own, sent just now",
      async () => {
        const a = await signedIn()
        const answer = await a.ask({ question: 'Do Norway orders include gift-card money?' })
        expect(answer.sources.length).toBeGreaterThan(0)
        const { id } = await a.reportAnswer({
          question: answer.question,
          part: answer.sources[0]!,
          sources: answer.sources,
          what: 'Gift cards are paid out separately since October.',
        })
        const [latest] = await a.getMyReports()
        expect(latest).toMatchObject({ id, question: answer.question, on: 'just now' })
        expect(latest!.outcome).toBeUndefined()
        // The answer itself is filed on its first source.
        const itself = await a.reportAnswer({
          question: answer.question,
          part: 'answer',
          sources: answer.sources,
          what: 'Both cannot be true.',
          correction: 'Norway orders leave gift cards out.',
          link: 'https://wiki.example/norway-orders',
        })
        expect((await a.getMyReports())[0]?.id).toBe(itself.id)
      },
    )

    /** FR-614 on a page: no count from one to four, and no shown total that gives one away. */
    const expectDisclosed = (page: ObsData) => {
      const fine = (n: number | null) => n === null || n === 0 || n >= 5
      const left = (total: number, parts: (number | null)[]) =>
        total - parts.reduce<number>((a, b) => a + (b ?? 0), 0)
      const counts = [
        page.numbers.asked,
        page.couldNotRead,
        ...page.agents.map((a) => a.count),
        ...page.bars.flatMap((b) => Object.values(b.counts)),
        ...page.topics.flatMap((t) => [t.total, ...Object.values(t.counts)]),
        ...page.subjects.flatMap((g) => [g.total, ...Object.values(g.counts)]),
        ...page.domains.map((d) => d.total),
      ]
      for (const n of counts) expect(fine(n), `a count of ${n}`).toBe(true)
      // Overview's numbers: what they leave over of everything asked is safe too.
      if (page.numbers.asked !== null)
        expect(fine(left(page.numbers.asked, Object.values(page.numbers.counts))), 'asked').toBe(
          true,
        )
      const byId = new Map(page.topics.map((t) => [t.id, t]))
      for (const t of page.topics)
        if (t.total !== null) expect(fine(left(t.total, Object.values(t.counts))), t.id).toBe(true)
      for (const g of page.subjects) {
        for (const id of g.topics) expect(byId.has(id), `${g.key} names ${id}`).toBe(true)
        if (g.total !== null)
          expect(
            fine(
              left(
                g.total,
                g.topics.map((id) => byId.get(id)!.total),
              ),
            ),
            g.key,
          ).toBe(true)
      }
    }

    it.skipIf(lacks('signIn', 'observabilityPage'))(
      'counts what agents asked as topics and counts, never one under 5 nor one worked out from the rest',
      async () => {
        await api().signIn({ name: person, fresh: false })
        for (const range of [7, 30, 90] as const) {
          const page = await api().observabilityPage({ section: 'overview', range })
          expect(page.state, `${range} days`).toBe('normal')
          expect(page.numbers.asked, `${range} days`).toBeGreaterThanOrEqual(5)
          // What was checked, never what was answered with a warning: the strict share.
          if (range === 7) expect(page.numbers.counts.grounded).toBe(94)
          expect(page.bars).toHaveLength(range === 90 ? 13 : range)
          expect(new Set(page.topics.map((t) => t.id)).size).toBe(page.topics.length)
          expectDisclosed(page)
        }
        const questions = await api().observabilityPage({ section: 'questions', range: 7 })
        expect(questions.topics.length).toBeGreaterThan(0)
        for (const t of questions.topics) {
          expect(t.month, t.id).toMatch(/^\d{4}-\d{2}$/)
          expect(t.where, t.id).not.toBe('')
        }
        expectDisclosed(questions)
      },
    )

    it.skipIf(lacks('signIn', 'observabilityPage', 'getWorkspace'))(
      'narrows the numbers to a domain, and keeps every topic the person sees for Questions',
      async () => {
        await api().signIn({ name: person, fresh: false })
        const all = await api().observabilityPage({ section: 'overview', range: 7 })
        const owned = (await api().getWorkspace()).domains.find((d) => d.owners.includes(person))!
        const one = await api().observabilityPage({
          section: 'overview',
          range: 7,
          domain: owned.id,
        })
        expect(one.numbers.asked).not.toBeNull()
        expect(one.numbers.asked!).toBeLessThan(all.numbers.asked!)
        expect(one.topics.map((t) => t.id).sort()).toEqual(all.topics.map((t) => t.id).sort())
        expectDisclosed(one)
      },
    )

    it.skipIf(lacks('signIn', 'observabilityPage', 'getWorkspace'))(
      "lists what was reported about answers, an agent's by its kind and never by a person's name",
      async () => {
        await api().signIn({ name: person, fresh: false })
        const page = await api().observabilityPage({ section: 'feedback', range: 7 })
        const names = (await api().getWorkspace()).people.map((p) => p.name)
        expect(page.feedback?.reports.length).toBeGreaterThan(0)
        for (const r of page.feedback!.reports.filter((x) => x.agent))
          expect(names, r.id).not.toContain(r.from)
        for (const n of [page.feedback!.week.good, page.feedback!.week.wrong])
          expect(n === null || n === 0 || n >= 5).toBe(true)
      },
    )

    it.skipIf(lacks('signIn', 'observabilityPage'))(
      'counts tool calls by tool and by kind of agent, and the spend against its cap',
      async () => {
        await api().signIn({ name: person, fresh: false })
        const page = await api().observabilityPage({ section: 'usage', range: 7 })
        const usage = page.usage!
        expect(usage.tools.length).toBeGreaterThan(0)
        for (const t of usage.tools)
          expect(t.answered + t.detail + t.nothing + t.failed, t.name).toBeLessThanOrEqual(t.calls)
        for (const a of usage.agents) expect(a.calls === null || a.calls >= 5, a.name).toBe(true)
        expect(usage.spend.total).toBeLessThanOrEqual(usage.spend.cap)
      },
    )

    it.skipIf(lacks('signIn', 'getSavedViews', 'saveView', 'removeView'))(
      'saves a view of Questions for everyone, and removes it',
      async () => {
        await api().signIn({ name: person, fresh: false })
        const name = `Found nothing ${Date.now()}`
        const { id } = await api().saveView({ name, filters: { answer: ['missing'] } })
        const saved = (await api().getSavedViews()).find((v) => v.id === id)
        expect(saved).toMatchObject({ name, filters: { answer: ['missing'] }, by: person })
        await api().removeView({ id })
        expect((await api().getSavedViews()).some((v) => v.id === id)).toBe(false)
      },
    )

    const saving = ['signIn', 'getWorkspace', 'getSavedQuestions', 'saveQuestion', 'undo'] as const

    it.skipIf(lacks(...saving, 'removeSavedQuestion'))(
      'saves a question for a domain the person owns, counted once in the one list, and Undo or Remove takes it out',
      async () => {
        const live = await signedIn()
        const { people } = await live.getWorkspace()
        const domain = people.find((p) => p.name === person)!.owns[0]!
        const before = await live.getSavedQuestions()
        const question = 'Why did orders in Norway drop in August?'
        const { id, undo } = await live.saveQuestion({
          question: { question, domain, savedBy: person, expect: '', factId: '' },
          origin: 'typed',
        })
        const all = await live.getSavedQuestions()
        expect(all).toHaveLength(before.length + 1)
        expect(new Set(all.map((q) => q.id)).size).toBe(all.length)
        expect(all.find((q) => q.id === id)).toMatchObject({
          question,
          domain,
          savedBy: person,
          result: 'same',
        })
        for (const q of all) {
          expect(['same', 'changed', 'look'], q.id).toContain(q.result)
          expect(q.why, q.id).not.toBe('')
          expect(q.when, q.id).not.toBe('')
          // A result that moved shows what it said when saved and what it says now.
          expect(!!q.diff, q.id).toBe(q.result !== 'same')
        }
        await live.undo({ token: undo })
        expect((await live.getSavedQuestions()).some((q) => q.id === id)).toBe(false)

        const again = await live.saveQuestion({
          question: { question, domain, savedBy: person, expect: '', factId: '' },
          origin: 'typed',
        })
        await live.removeSavedQuestion({ id: again.id })
        expect((await live.getSavedQuestions()).map((q) => q.id)).toEqual(before.map((q) => q.id))
      },
    )

    it.skipIf(lacks('signIn', 'getSavedQuestions', 'keepNewAnswer', 'undo'))(
      'keeps the new answer of a question whose answer moved, and Undo puts its result back',
      async () => {
        const live = await signedIn()
        const moved = (await live.getSavedQuestions()).find((q) => q.result !== 'same')!
        expect(moved).toBeDefined()
        const { undo } = await live.keepNewAnswer({ id: moved.id })
        const kept = (await live.getSavedQuestions()).find((q) => q.id === moved.id)!
        expect(kept).toMatchObject({ result: 'same' })
        expect(kept.diff).toBeUndefined()
        await live.undo({ token: undo })
        const back = (await live.getSavedQuestions()).find((q) => q.id === moved.id)!
        expect(back).toMatchObject({ result: moved.result, diff: moved.diff })
      },
    )

    it.skipIf(
      lacks('signIn', 'getWorkspace', 'getSavedQuestions', 'checkSavedQuestions', 'getSavedCheck'),
    )(
      'Check now checks every saved question of a domain, and says where the check stands',
      async () => {
        const live = await signedIn()
        const { people } = await live.getWorkspace()
        const domain = people.find((p) => p.name === person)!.owns[0]!
        const all = await live.getSavedQuestions()
        const { checked } = await live.checkSavedQuestions({ domain })
        expect(checked).toBe(all.filter((q) => q.domain === domain).length)
        // Checked, not changed: the same questions, each with a result.
        expect((await live.getSavedQuestions()).map((q) => q.id)).toEqual(all.map((q) => q.id))
        const status = await live.getSavedCheck()
        expect(status).toMatchObject({ run: 'idle', checked: 0 })
        expect(status.checkedAt).not.toBeNull()
        expect(status.trend.labels).toHaveLength(8)
        expect(status.trend.same).toHaveLength(8)
        expect(status.trend.total).toHaveLength(8)
        for (const [n, same] of status.trend.same.entries())
          expect(same).toBeLessThanOrEqual(status.trend.total[n]!)
      },
    )

    it.skipIf(lacks('signIn', 'getAlerts'))(
      'lists the eight alert rules as sentences, each threshold one its sentence offers, and what they raised lately',
      async () => {
        const { rules, raised, settings } = await (await signedIn()).getAlerts()
        expect(rules.map((r) => r.id)).toEqual([
          'gap',
          'saved',
          'disagree',
          'share',
          'fail',
          'spend',
          'sync',
          'due',
        ])
        for (const r of rules) {
          expect(r.name, r.id).not.toBe('')
          expect(r.then, r.id).not.toBe('')
          expect(['owners', 'admins', 'both'], r.id).toContain(r.audience)
          // A threshold sits inside its sentence, at one of the choices it offers.
          expect(r.when.includes('{n}'), r.id).toBe(!!r.threshold)
          if (r.threshold) expect(r.threshold.choices, r.id).toContain(r.threshold.value)
          expect(r.last, r.id).not.toBe('')
        }
        for (const off of settings.off) expect(rules.map((r) => r.id)).toContain(off)
        expect(raised.length).toBeGreaterThan(0)
        expect(new Set(raised.map((r) => r.id)).size).toBe(raised.length)
        for (const r of raised) {
          expect(
            rules.map((x) => x.id),
            r.id,
          ).toContain(r.rule)
          expect(r.title, r.id).not.toBe('')
          expect(r.line, r.id).toMatch(/went to .+\.$/)
          expect(r.when, r.id).not.toBe('')
          expect(r.href, r.id).toMatch(/^\//)
        }
        // The saved-question alert raised a card in the Inbox.
        expect(raised.some((r) => r.rule === 'saved' && r.href.startsWith('/inbox?card='))).toBe(
          true,
        )
      },
    )

    it.skipIf(lacks('signIn', 'getAlerts', 'setAlertRule', 'setAlertThreshold'))(
      'turns a rule off for everyone and on again, and changes a threshold inside its sentence',
      async () => {
        const live = await signedIn()
        await live.setAlertRule({ id: 'spend', on: false })
        expect((await live.getAlerts()).settings.off).toContain('spend')
        await live.setAlertRule({ id: 'spend', on: true })
        expect((await live.getAlerts()).settings.off).not.toContain('spend')
        const threshold = (a: Awaited<ReturnType<HeedApi['getAlerts']>>) => {
          const r = a.rules.find((x) => x.id === 'disagree')!
          return a.settings.thresholds.disagree ?? r.threshold!.value
        }
        const was = threshold(await live.getAlerts())
        const to = was === '5' ? '2' : '5'
        await live.setAlertThreshold({ id: 'disagree', value: to })
        expect(threshold(await live.getAlerts())).toBe(to)
        await live.setAlertThreshold({ id: 'disagree', value: was })
        expect(threshold(await live.getAlerts())).toBe(was)
      },
    )

    it.skipIf(lacks('signIn', 'getWorkspace', 'getAlerts', 'muteAlert'))(
      'mutes a rule for a domain the person owns, and unmutes it',
      async () => {
        const live = await signedIn()
        const { people } = await live.getWorkspace()
        const domain = people.find((p) => p.name === person)!.owns[0]!
        await live.muteAlert({ id: 'due', domains: [domain], muted: true })
        expect((await live.getAlerts()).settings.muted.due).toContain(domain)
        await live.muteAlert({ id: 'due', domains: [domain], muted: false })
        expect((await live.getAlerts()).settings.muted.due ?? []).not.toContain(domain)
      },
    )

    it.skipIf(lacks('signIn', 'observabilityPage', 'replayTopic'))(
      'replays a topic step by step, on what agents get now and before the last publish',
      async () => {
        await api().signIn({ name: person, fresh: false })
        const page = await api().observabilityPage({ section: 'questions', range: 7 })
        const topic = page.topics.find((t) => t.total !== null)!
        const now = await api().replayTopic({ topic: topic.id, when: 'now' })
        expect(now!.steps.map((s) => s.key)).toEqual([
          'scope',
          'looked',
          'left',
          'checked',
          'said',
          'next',
        ])
        expect(['grounded', 'partial', 'missing', 'conflict', 'stale', 'failed']).toContain(
          now!.answer.state,
        )
        expect(now!.before.label).toMatch(/^Before \d{1,2} [A-Z][a-z]{2}$/)
        const before = await api().replayTopic({ topic: topic.id, when: 'before' })
        expect(before!.steps).toHaveLength(6)
        expect(await api().replayTopic({ topic: 'no-such-topic', when: 'now' })).toBeNull()
      },
    )

    it.skipIf(lacks('signIn'))('refuses someone the sign-in does not offer', async () => {
      await expect(api().signIn({ name: 'Nobody Here', fresh: false })).rejects.toMatchObject({
        kind: 'not-found',
      })
    })
  })
}
