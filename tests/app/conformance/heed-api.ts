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
import { mentionNotesOf, type Subject } from '@/model/comments'
import { plainOf } from '@/components/templates/comment-box/utils'
import { readiness } from '@/model/review'
import { findDefinition, meaningOf, type Definition } from '@/lib/definitions'

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

    it.skipIf(lacks('signIn'))('refuses someone the sign-in does not offer', async () => {
      await expect(api().signIn({ name: 'Nobody Here', fresh: false })).rejects.toMatchObject({
        kind: 'not-found',
      })
    })
  })
}
