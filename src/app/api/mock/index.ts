import type { HeedApi, HeedApiMethod, Inbox } from '../client'
import { ApiError } from '../errors'
import type { SavedView } from '@/lib/obs-views'
import { mentionNotesOf, type Subject } from '@/model/comments'
import { createComments } from './comments'
import { createAlerts } from './data/alerts'
import { historyOf, historyOfDefinition } from './data/history'
import { DEFINITIONS_TOOL } from '@/model/integrations'
import { cards, waiting, week } from './data/inbox'
import { norwayDraft } from './data/drafts'
import { obsData } from './data/observability'
import { BEFORE, changedSteps, replay } from './replay'
import { reviews } from './data/review'
import {
  ABOUT_BUSINESS,
  dimensions,
  facts as seedFacts,
  markets,
  metrics,
  signInPeople,
  WORKSPACE_NAME,
} from './data/world'
import {
  answerFor,
  answerForScope,
  askQuestion,
  exampleAnswer,
  examples,
  readDefinitionsFrom,
  readQuestion,
} from './data/ask'
import { createChats } from './chats'
import { askedThisWeek } from './data/asked-week'
import { createSettings } from './settings'
import {
  cubeActivity,
  cubeViews,
  driveActivity,
  driveDocuments,
  driveFolders,
  figureConnections,
  integrationState,
  warehouseHas,
} from './data/integrations'
import { figureFor } from './data/figures'
import type { AskInput } from '@/model/ask'
import { createDefinitions } from './definitions'
import { publishEffects, touchedBy } from './publish'
import { createSaved } from './saved'
import { createScenario, type Address } from './scenario'
import { factsOf, reduce, start, type Action, type State } from './store'
import { createWorkspace } from './workspace'

/**
 * The mock binding: `HeedApi` over the demo world, in memory. Every answer is a copy, as if it came
 * over the wire, so a cache that holds it never shares an object the mock changes later. A reload
 * starts the demo again.
 *
 * `controls` are the mock's own, for the app's review flags and the Slow network switch: the http
 * binding has none.
 */
export function createMockApi() {
  const scenario = createScenario()
  const workspace = createWorkspace()
  const comments = createComments()
  const definitions = createDefinitions()
  const saved = createSaved()
  const alerts = createAlerts()
  const chats = createChats()
  const settings = createSettings()
  let views: SavedView[] = []
  readDefinitionsFrom(definitions.list)
  let state: State = start
  const me = () => state.user ?? 'Jon Abara'
  const dispatch = (action: Action) => {
    state = reduce(state, action)
  }

  /** What Undo needs, by token: the state before, and what the write touched. */
  const undos = new Map<string, () => void>()
  let undoCount = 0
  const remember = (undo: () => void) => {
    const token = `undo_${++undoCount}`
    undos.set(token, undo)
    return { undo: token }
  }
  /** Undo for a write over the store: exactly those cards, items and log line go back. */
  const revertTo = (
    before: State,
    touched: { cards?: string[]; facts?: string[]; entry?: string },
  ) =>
    remember(() =>
      dispatch({
        type: 'revert',
        before,
        cards: touched.cards ?? [],
        facts: touched.facts ?? [],
        entry: touched.entry,
      }),
    )

  /** The Inbox as the person sees it: none of the demo's cards on a new install. */
  const inbox = (): Inbox => {
    const titleOf = (subject: Subject) => {
      const [kind, id] = subject.split(':')
      return (
        (kind === 'context'
          ? factsOf(state).find((f) => f.id === id)?.title
          : cards.find((c) => c.id === id)?.title) ?? 'A comment'
      )
    }
    return {
      cards: state.fresh ? [] : cards,
      waiting: state.fresh ? [] : waiting,
      sent: state.sent,
      done: state.done,
      opened: state.opened,
      reviewed: state.reviewed,
      week,
      mentions: (mentionNotesOf(comments.read()).get(me()) ?? []).map((n) => ({
        ...n,
        title: titleOf(n.subject),
      })),
    }
  }

  /** A decision on a suggestion: its effects, the card done, and Undo for exactly those. */
  const decideReview = (
    id: string,
    outcome: string,
    effects: () => { cards?: string[]; facts?: string[]; also?: () => void } | void,
  ) => {
    const before = state
    const touched = effects() ?? {}
    dispatch({ type: 'complete', card: id, outcome })
    const r = reviews.find((x) => x.id === id)
    return remember(() => {
      dispatch({
        type: 'revert',
        before,
        cards: [id, ...(touched.cards ?? [])],
        facts: touched.facts ?? (r ? touchedBy(r) : []),
      })
      touched.also?.()
    })
  }

  const publishOne = (id: string, relation?: string | null, saveQuestion = true) => {
    const r = reviews.find((x) => x.id === id)
    if (!r) return () => {}
    const { itemId, domain } = publishEffects(r, me(), dispatch, relation)
    return saved.afterPublish(r, me(), itemId, domain, saveQuestion)
  }

  /** Ask's answer, from the context as it is now. */
  const answer = ({ question = '', parts, scope, example, reread }: AskInput) => {
    const pool = factsOf(state)
    if (example) return exampleAnswer(example)
    if (scope?.length) return answerForScope(question, scope, parts, pool)
    if (reread) {
      const read = readQuestion(question)
      return {
        ...answerFor(question, read.metric, read.markets, reread.dates, { pool }),
        alias: read.alias,
      }
    }
    return {
      ...askQuestion(question, pool),
      parts: parts?.some((p) => typeof p !== 'string') ? parts : undefined,
    }
  }

  const copy = <T>(value: T): T => (value === undefined ? value : structuredClone(value))
  const read = <T>(method: HeedApiMethod, key: string, run: () => T) =>
    scenario.read(method, key, () => copy(run()))
  const now = <T>(run: () => T) => Promise.resolve(copy(run()))

  const api: HeedApi = {
    // Session and workspace
    getSession: () => now(() => ({ user: state.user, install: state.install, fresh: state.fresh })),
    listSignInPeople: () => now(() => signInPeople),
    signIn: ({ name, fresh }) => {
      if (!signInPeople.includes(name))
        return Promise.reject(new ApiError('not-found', `${name} can't sign in here.`))
      return now(() => {
        dispatch({ type: 'signIn', name, fresh })
        return { user: state.user, install: state.install, fresh: state.fresh }
      })
    },
    signOut: () => now(() => dispatch({ type: 'signOut' })),
    getWorkspace: () =>
      now(() => ({
        name: WORKSPACE_NAME,
        domains: workspace.domains(),
        people: workspace.people(),
        about: state.about,
        aboutTemplate: ABOUT_BUSINESS,
        setup: { done: state.setup },
      })),
    getVocabulary: () => now(() => ({ metrics, dimensions, markets })),
    getActivity: ({ name }) => now(() => workspace.activityOf(name, seedFacts)),
    setAbout: ({ text }) => now(() => dispatch({ type: 'about', text })),
    completeSetupStep: ({ step }) => now(() => dispatch({ type: 'setupStep', step })),

    // Domains and people
    updateDomain: (input) => now(() => workspace.updateDomain(input)),
    addDomain: (input) => now(() => ({ id: workspace.addDomain(input) })),
    removeDomain: ({ id }) => now(() => workspace.removeDomain(id)),
    setOwner: ({ name, domain, own }) =>
      now(() =>
        workspace.setOwner(name, domain, own) === 'last'
          ? { done: false as const, last: true as const }
          : { done: true as const },
      ),
    setAdmin: ({ name, admin }) => now(() => workspace.setAdmin(name, admin)),
    invite: ({ emails, admin, owns }) => now(() => workspace.invite(emails, admin, owns)),
    removePerson: ({ name }) =>
      now(() => {
        const result = workspace.removePerson(name)
        return 'alone' in result
          ? { removed: false as const, alone: result.alone }
          : { removed: true as const, ...remember(result.restore) }
      }),

    // The library
    getLibrary: () =>
      now(() => ({
        items: factsOf(state),
        published: state.published,
        viewed: state.viewed,
        log: state.log,
      })),
    contextPage: () => read('contextPage', '', () => factsOf(state)),
    itemPage: ({ id }) =>
      read('itemPage', id, () => {
        const item = factsOf(state).find((f) => f.id === id)
        return item ? { item, history: historyOf(item, state.log) } : null
      }),
    getItemHistory: ({ id }) =>
      now(() => {
        const fact = factsOf(state).find((f) => f.id === id)
        return fact ? historyOf(fact, state.log) : []
      }),
    markViewed: ({ id }) => now(() => dispatch({ type: 'viewedFact', id })),
    editItem: ({ id, patch }) => now(() => dispatch({ type: 'editFact', id, patch })),
    draftFromText: () => now(() => norwayDraft),
    saveItem: ({ fact, isNew, gap, setup }) =>
      scenario.send('saveItem', () => {
        const id = isNew ? `itm_new_${Date.now().toString(36)}` : fact.id
        if (isNew) dispatch({ type: 'addFact', fact: { ...fact, id } })
        else dispatch({ type: 'editFact', id, patch: fact })
        dispatch({ type: 'published', id })
        if (gap) dispatch({ type: 'complete', card: gap, outcome: 'Context written' })
        if (setup) dispatch({ type: 'setupStep', step: 'fact' })
        return { id }
      }),
    applyBulk: ({ patches, remove, entry }) =>
      now(() => {
        const rows = [...new Set([...Object.keys(patches), ...remove])]
        // ?bulk=fail: the first change to many rows fails on its last row, so a partial failure can be seen.
        const failed = rows.length > 1 && scenario.failsOnce('bulk') ? rows.slice(-1) : []
        const done = rows.filter((id) => !failed.includes(id))
        const before = state
        dispatch({
          type: 'bulk',
          patches: Object.fromEntries(Object.entries(patches).filter(([id]) => done.includes(id))),
          remove: remove.filter((id) => done.includes(id)),
          entry: { ...entry, items: entry.items.filter((i) => done.includes(i.id)) },
        })
        return { done, failed, ...revertTo(before, { facts: done, entry: entry.id }) }
      }),
    sendSuggestion: ({ sent }) =>
      scenario.send('sendSuggestion', () => {
        const id = `sent_${Date.now().toString(36)}`
        dispatch({ type: 'send', sent: { ...sent, id } })
        return { id }
      }),
    withdrawSuggestion: ({ id }) => now(() => dispatch({ type: 'withdraw', id })),
    undo: ({ token }) =>
      now(() => {
        undos.get(token)?.()
        undos.delete(token)
      }),

    // Comments
    getComments: () => now(() => comments.read()),
    postComment: ({ subject, content, parentId, returned }) =>
      now(() => ({ id: comments.post(subject, me(), content, { parentId, returned }) })),
    reactToComment: ({ subject, id, emoji }) => now(() => comments.react(subject, id, emoji, me())),
    reactToSubject: ({ subject, emoji }) =>
      now(() => comments.reactToSubject(subject, emoji, me())),
    editComment: ({ subject, id, content }) => now(() => comments.edit(subject, id, content)),
    removeComment: ({ subject, id }) => now(() => comments.remove(subject, id)),
    markThreadSeen: ({ subject }) => now(() => comments.seen(subject)),
    markMentionSeen: ({ subject }) => now(() => comments.seenMention(subject, me())),

    // Definitions
    getDefinitions: () => now(() => definitions.list()),
    definitionsPage: () => read('definitionsPage', '', () => definitions.list()),
    definitionPage: ({ name }) =>
      read(
        'definitionPage',
        name,
        () => definitions.list().find((d) => d.name.toLowerCase() === name.toLowerCase()) ?? null,
      ),
    getDefinitionHistory: ({ name }) =>
      now(() => {
        const d = definitions.list().find((x) => x.name.toLowerCase() === name.toLowerCase())
        return d ? historyOfDefinition(d, d.tool ?? DEFINITIONS_TOOL) : []
      }),
    saveTerm: ({ previous, term }) =>
      scenario.send('saveTerm', () => definitions.saveTerm(previous, term)),
    addSynonym: ({ target, word }) => now(() => definitions.addSynonym(target, word, me())),
    removeTerm: ({ name }) => now(() => remember(definitions.removeTerm(name))),
    deleteTerms: ({ names, entry }) =>
      now(() => {
        const restore = definitions.deleteTerms(names)
        dispatch({ type: 'bulk', patches: {}, remove: [], entry })
        return remember(() => {
          restore()
          dispatch({ type: 'unlog', entry: entry.id })
        })
      }),
    moveTerms: ({ names, domain }) => now(() => remember(definitions.moveTerms(names, domain))),

    // The Inbox and the review
    getInbox: () => now(inbox),
    inboxPage: () => read('inboxPage', '', inbox),
    getReviews: () => now(() => reviews),
    markOpened: ({ ids }) => now(() => ids.forEach((card) => dispatch({ type: 'opened', card }))),
    markReviewed: ({ id }) => now(() => dispatch({ type: 'reviewed', card: id })),
    decideCard: ({ card, outcome, patch }) =>
      scenario.send(
        'decideCard',
        () => {
          const factId = cards.find((c) => c.id === card)?.factId
          const before = state
          if (patch && factId) dispatch({ type: 'editFact', id: factId, patch })
          dispatch({ type: 'complete', card, outcome })
          return revertTo(before, { cards: [card], facts: patch && factId ? [factId] : [] })
        },
        { key: card, flag: 'decide' },
      ),
    completeCard: ({ card, outcome }) =>
      now(() => {
        const before = state
        dispatch({ type: 'complete', card, outcome })
        return revertTo(before, { cards: [card] })
      }),
    publishReview: ({ id, relation, saveQuestion }) =>
      scenario.send('publishReview', () =>
        decideReview(id, 'Published', () => ({ also: publishOne(id, relation, saveQuestion) })),
      ),
    publishReviews: ({ ids }) =>
      scenario.send('publishReviews', () => {
        const before = state
        const also = ids.map((id) => {
          const undo = publishOne(id)
          dispatch({ type: 'complete', card: id, outcome: 'Published' })
          return undo
        })
        const facts = reviews.filter((r) => ids.includes(r.id)).flatMap(touchedBy)
        return remember(() => {
          dispatch({ type: 'revert', before, cards: ids, facts })
          also.forEach((u) => u())
        })
      }),
    archiveReview: ({ id }) =>
      scenario.send('archiveReview', () =>
        decideReview(id, 'Archived', () => {
          const r = reviews.find((x) => x.id === id)
          if (r?.retire)
            dispatch({ type: 'editFact', id: r.retire.factId, patch: { status: 'Archived' } })
        }),
      ),
    closeReview: ({ id }) =>
      scenario.send('closeReview', () => decideReview(id, 'Closed', () => {})),
    returnReview: ({ id, note }) =>
      scenario.send('returnReview', () =>
        decideReview(id, 'Returned', () => {
          const subject: Subject = `review:${id}`
          const posted = comments.post(subject, me(), note, { returned: true })
          return { also: () => comments.remove(subject, posted) }
        }),
      ),

    // Ask
    readQuestion: ({ question }) =>
      now(() => {
        const read = readQuestion(question)
        return { metric: read.metric, markets: read.markets }
      }),
    ask: (input) => now(() => answer(input)),
    askedThisWeek: () => now(() => askedThisWeek(factsOf(state))),
    getAskExamples: () => now(() => examples),
    listChats: () =>
      now(() =>
        chats.list().map((t) => ({
          ...t,
          preview: answer(
            t.example ? { example: t.example } : { question: t.question },
          ).text.replace(/\[\d+\]/g, ''),
        })),
      ),
    saveChat: ({ id, question }) => now(() => chats.add(id, question)),
    renameChat: ({ id, title }) => now(() => chats.rename(id, title)),
    deleteChat: ({ id }) => now(() => remember(chats.remove(id))),

    // Observability
    getObservability: () => now(() => obsData(scenario.obsState())),
    observabilityPage: ({ section }) =>
      read('observabilityPage', section, () => obsData(scenario.obsState())),
    getSavedViews: () => now(() => views),
    saveView: ({ name, filters }) =>
      now(() => {
        const id = `v-${views.length + 1}`
        views = [...views, { id, name, filters, by: me(), custom: true }]
        return { id }
      }),
    removeView: ({ id }) =>
      now(() => {
        views = views.filter((v) => v.id !== id)
      }),
    replayTopic: ({ topic, when }) =>
      now(() => {
        const t = obsData('normal').topics.find((x) => x.id === topic)
        if (!t) return null
        const pool = factsOf(state)
        return {
          ...replay(t, when, pool),
          changed: changedSteps(t, pool),
          before: { label: BEFORE.label, title: BEFORE.title },
        }
      }),

    // Alerts
    getAlerts: () => now(() => alerts.read()),
    setAlertRule: ({ id, on }) => now(() => alerts.setOn(id, on)),
    muteAlert: ({ id, domains, muted }) => now(() => alerts.setMuted(id, domains, muted)),
    setAlertThreshold: ({ id, value }) => now(() => alerts.setThreshold(id, value)),

    // Settings, integrations and agents
    getSettings: () => now(() => settings.read(scenario.address())),
    setLinks: ({ on }) => now(() => settings.setLinks(on)),
    setFigures: ({ source, on }) => now(() => settings.setFigures(source, on)),
    setDataContact: ({ source, name }) => now(() => settings.setContact(source, name)),
    connectIntegration: ({ id, setup }) =>
      now(() => {
        settings.connect(id)
        if (setup) dispatch({ type: 'setupStep', step: 'definitions' })
      }),
    disconnectIntegration: ({ id }) => now(() => settings.disconnect(id)),
    getIntegrations: () =>
      now(() => {
        const { path, query } = scenario.address()
        return {
          state: path.startsWith('/settings/integrations')
            ? integrationState(query.state ?? null)
            : 'normal',
          cubeViews,
          driveFolders,
          driveDocuments,
          activity: { cube: cubeActivity, drive: driveActivity },
          figureConnections,
          warehouseHas,
        }
      }),
    readFigure: (asked) =>
      now(() => {
        const on = settings.read(scenario.address()).figures
        return figureFor(asked, (id) => on[id] ?? false)
      }),
    listAgentConnections: () => now(() => settings.agents()),
    revokeAgentConnection: ({ agent, who }) => now(() => settings.revoke(agent, who)),
    checkConnect: ({ since, agent }) =>
      now(() => settings.check(scenario.address(), since, agent, me())),
    getConnectReview: () => now(() => settings.review(scenario.address(), me())),

    // Saved questions
    // ?quality=same shows the calm week, when every saved question answers as saved.
    getSavedQuestions: () =>
      now(() =>
        scenario.address().query.quality === 'same'
          ? saved.list().map((q) => ({
              ...q,
              result: 'same' as const,
              why: 'Same items, same sentence.',
              diff: undefined,
            }))
          : saved.list(),
      ),
    // ?quality=running holds a check at 5 of them; ?quality=failed shows one that failed.
    getSavedCheck: () =>
      now(() => {
        const flag = scenario.address().query.quality
        return flag === 'running'
          ? { run: 'running' as const, checked: 5 }
          : flag === 'failed'
            ? { run: 'failed' as const, checked: 0 }
            : { run: 'idle' as const, checked: 0 }
      }),
    saveQuestion: ({ question }) =>
      now(() => {
        const id = saved.save(question)
        return { id, ...remember(() => saved.remove(id)) }
      }),
    removeSavedQuestion: ({ id }) => now(() => saved.remove(id)),
    keepNewAnswer: ({ id }) => now(() => remember(saved.keepNew(id))),
  }

  const controls = {
    /** The app moved: the review flags in the address may change what the mock answers. */
    setAddress: (address: Address) => {
      const before = state
      const demo = address.query.demo
      const result = scenario.setAddress(address)
      let mentions = false
      if (demo !== lastDemo) {
        lastDemo = demo
        if (demo === 'setup' || demo === 'done' || demo === 'week' || demo === 'last')
          dispatch({ type: 'demo', mode: demo })
        if ((demo === 'done' || demo === 'week') && state.user) {
          comments.scenario(demo, state.user)
          mentions = true
        }
      }
      return { fault: result.fault, data: result.data || state !== before || mentions }
    },
    offline: scenario.offline,
    slowSwitch: scenario.slowSwitch,
    setSlow: scenario.setSlow,
    subscribe: scenario.subscribe,
  }
  let lastDemo: string | undefined

  return { api, controls }
}

export type MockControls = ReturnType<typeof createMockApi>['controls']
