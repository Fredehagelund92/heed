/**
 * The `HeedApi` conformance suite: the same cases run against the mock binding
 * (tests/app/mock/conformance.test.ts) and against the http binding talking to the real service and
 * PostgreSQL (tests/app/integration/http-api.test.ts). A case names the methods it needs, so it runs
 * against a binding once that binding answers them; the http binding grows its list as the pull
 * requests that wire each screen land.
 */
import { describe, expect, it } from 'vitest'
import { heedApiMethods, type HeedApi, type HeedApiMethod } from '@/api/client'
import type { ObsData } from '@/model/observability'
import { whenLabel } from '@/model/validity'
import type { CardType, InboxCard } from '@/model/inbox'
import { mentionNotesOf, type Subject } from '@/model/comments'
import { plainOf } from '@/components/templates/comment-box/utils'
import { readiness } from '@/model/review'
import { findDefinition, meaningOf, type Definition } from '@/lib/definitions'
import { emailOf } from '@/model/people'

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
}

export function describeHeedApi(
  name: string,
  getApi: () => HeedApi,
  { person, wired, colleague }: HeedApiConformance,
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

    it.skipIf(lacks('signIn', 'listAgentConnections', 'revokeAgentConnection'))(
      'lists the agents people connected, one row each, and revokes one',
      async () => {
        const live = await signedIn()
        const rows = await live.listAgentConnections()
        expect(rows.length).toBeGreaterThan(1)
        expect(new Set(rows.map((r) => `${r.agent}/${r.who}`)).size).toBe(rows.length)
        for (const r of rows) {
          expect(r.agent).not.toBe('')
          expect(r.since).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/)
          expect(r.used).not.toBe('')
        }
        const gone = rows.find((r) => r.who !== person) ?? rows[0]!
        await live.revokeAgentConnection({ agent: gone.agent, who: gone.who })
        const after = await live.listAgentConnections()
        expect(after.some((r) => r.agent === gone.agent && r.who === gone.who)).toBe(false)
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

    it.skipIf(lacks('signIn', 'advancedPage'))(
      'reads Settings, Advanced: the limits in words, what was deleted, the log, jobs and editions',
      async () => {
        const page = await (await signedIn()).advancedPage()
        expect(page.limits.length).toBeGreaterThan(2)
        expect(page.settings).toBeGreaterThanOrEqual(page.limits.length)
        for (const l of page.limits) {
          expect(l.key).toMatch(/^[a-z_]+(\.[a-z_]+)+$/)
          expect(l.value, l.key).not.toBe('')
          expect(l.what, l.key).not.toBe('')
        }
        expect(page.limits.find((l) => l.key === 'privacy.min_count')?.value).toBe('5')
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
