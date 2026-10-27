/**
 * The `HeedApi` conformance suite: the same cases run against the mock binding
 * (tests/app/mock/conformance.test.ts) and against the http binding talking to the real service and
 * PostgreSQL (tests/app/integration/http-api.test.ts). A case names the methods it needs, so it runs
 * against a binding once that binding answers them; the http binding grows its list as the pull
 * requests that wire each screen land.
 */
import { describe, expect, it } from 'vitest'
import { heedApiMethods, type HeedApi, type HeedApiMethod } from '@/api/client'
import { whenLabel } from '@/model/validity'
import type { CardType, InboxCard } from '@/model/inbox'

export type HeedApiConformance = {
  /** Someone the binding's sign-in offers, by name. */
  person: string
  /**
   * The methods the binding answers; a case that needs another is skipped. A binding that answers
   * the Inbox's methods gives the person at least a suggestion and a Reported card in their Inbox.
   */
  wired: readonly HeedApiMethod[]
}

export function describeHeedApi(
  name: string,
  getApi: () => HeedApi,
  { person, wired }: HeedApiConformance,
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

    it.skipIf(lacks('signIn'))('refuses someone the sign-in does not offer', async () => {
      await expect(api().signIn({ name: 'Nobody Here', fresh: false })).rejects.toMatchObject({
        kind: 'not-found',
      })
    })
  })
}
