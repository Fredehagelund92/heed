import type { HeedApi, HeedApiMethod, Inbox } from '../client'
import { ApiError } from '../errors'
import type { SavedView } from '@/lib/obs-views'
import { mentionNotesOf, type Subject } from '@/model/comments'
import { servedToAgents } from '@/model/items'
import { createComments } from './comments'
import { createAlerts } from './data/alerts'
import { historyOf, historyOfDefinition } from './data/history'
import { DEFINITIONS_TOOL } from '@/model/integrations'
import { answerLinks, linksOf } from '@/lib/links'
import { cards, waiting, week } from './data/inbox'
import { norwayDraft } from './data/drafts'
import { obsData } from './data/observability'
import { obsPage } from './obs-page'
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
import { advancedOf, contextFile, demoAccessKey, historyFile } from './advanced'
import { createChats } from './chats'
import { askedThisWeek } from './data/asked-week'
import { createSettings } from './settings'
import { cubeViews, driveFolders, warehouseHas } from './data/integrations'
import { createIntegrations } from './integrations'
import { figureFor } from './data/figures'
import { reportedOn, type AskInput } from '@/model/ask'
import { createDefinitions } from './definitions'
import { publishEffects, touchedBy } from './publish'
import { SAVED_TREND } from './data/saved-questions'
import { createSaved } from './saved'
import { createScenario, type Address } from './scenario'
import { searchWorld } from './search'
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
  const integrations = createIntegrations(() => settings.read(scenario.address()).connected)
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

  /** The reports the person sent from Ask this visit, newest first. */
  const reports: { id: string; question: string; at: Date }[] = []

  const copy = <T>(value: T): T => (value === undefined ? value : structuredClone(value))
  const read = <T>(method: HeedApiMethod, key: string, run: () => T) =>
    scenario.read(method, key, () => copy(run()))
  // A rule the mock keeps (only its author edits a comment) refuses as the service does: the
  // promise rejects, never throws before it is returned.
  /** The app's own address, which an invite link leads back to. */
  const origin = () => globalThis.location?.origin ?? 'http://localhost'
  const now = <T>(run: () => T) => new Promise<T>((resolve) => resolve(copy(run())))

  const api: HeedApi = {
    // Session and workspace
    getSession: () => now(() => ({ user: state.user, install: state.install, fresh: state.fresh })),
    // The demo signs in with the person picker; an invite link opens the invite it names.
    getSignInMethod: () => now(() => ({ kind: 'picker' as const })),
    readInvite: ({ token }) => now(() => workspace.readInvite(token)),
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
    // Only an empty domain is deleted, and never the sandbox, as the service refuses.
    removeDomain: ({ id }) =>
      now(() => {
        const domain = workspace.domainMap()[id]
        if (!domain)
          throw new ApiError('not-found', "We couldn't find this domain. It may have been deleted.")
        if (domain.sandbox)
          throw new ApiError(
            'conflict',
            "The sandbox can't be deleted. It is where people try context, and agents never get it.",
          )
        const holds =
          factsOf(state).some((f) => f.domain === id && servedToAgents(f)) ||
          definitions.list().some((d) => d.domain === id)
        if (holds)
          throw new ApiError(
            'conflict',
            'Only an empty domain can be deleted. Move its context and terms to another domain first.',
          )
        workspace.removeDomain(id)
      }),
    setOwner: ({ name, domain, own }) =>
      now(() =>
        workspace.setOwner(name, domain, own) === 'last'
          ? { done: false as const, last: true as const }
          : { done: true as const },
      ),
    setAdmin: ({ name, admin }) => now(() => workspace.setAdmin(name, admin)),
    invite: ({ emails, admin, owns }) => now(() => workspace.invite(emails, admin, owns, origin())),
    resendInvite: ({ name }) =>
      now(() => {
        const link = workspace.resendInvite(name, origin())
        if (!link) throw new ApiError('not-found', `${name} has no open invite.`)
        return { link }
      }),
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
    searchAll: ({ q }) =>
      now(() =>
        searchWorld(q, {
          facts: factsOf(state),
          definitions: definitions.list(),
          domains: workspace.domains(),
          people: workspace.people(),
        }),
      ),
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
    getRelated: ({ id }) =>
      now(() => ({
        links: linksOf(id, {
          facts: factsOf(state),
          definitions: definitions.list(),
          domains: Object.fromEntries(workspace.domains().map((d) => [d.id, d])),
        }),
        following: settings.read(scenario.address()).links,
      })),
    // The item's words as they are now: the demo's versions are made up, so each restores the same.
    restoreAsDraft: ({ id }) =>
      now(() => {
        const item = factsOf(state).find((f) => f.id === id)
        if (!item) throw new ApiError('not-found', "This context item isn't in Context any more.")
        const draft = `itm_draft_${Date.now().toString(36)}`
        dispatch({
          type: 'addFact',
          fact: { ...item, id: draft, status: 'Draft', by: me(), checkedBy: '', checkedOn: '' },
        })
        return { id: draft }
      }),
    markViewed: ({ id }) => now(() => dispatch({ type: 'viewedFact', id })),
    editItem: ({ id, patch }) => now(() => dispatch({ type: 'editFact', id, patch })),
    draftFromText: () => now(() => norwayDraft),
    saveItem: ({ fact, isNew, relations = {}, gap, setup }) =>
      scenario.send('saveItem', () => {
        const id = isNew ? `itm_new_${Date.now().toString(36)}` : fact.id
        // What the owner said of an overlap is kept on the item, as a published suggestion's is.
        const related = Object.entries(relations)
        const replaces = related.find(([, r]) => r === 'replaces')?.[0]
        const disagreesWith = related.find(([, r]) => r === 'disagree')?.[0]
        const saved = {
          ...fact,
          ...(replaces ? { replaces } : {}),
          ...(disagreesWith ? { disagreesWith } : {}),
        }
        if (isNew) dispatch({ type: 'addFact', fact: { ...saved, id } })
        else dispatch({ type: 'editFact', id, patch: saved })
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
    editComment: ({ subject, id, content }) => now(() => comments.edit(subject, id, content, me())),
    removeComment: ({ subject, id }) => now(() => comments.remove(subject, id, me())),
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
          return { also: () => comments.unpost(subject, posted) }
        }),
      ),

    // Ask
    readQuestion: ({ question }) =>
      now(() => {
        const read = readQuestion(question)
        return { metric: read.metric, markets: read.markets }
      }),
    ask: (input) =>
      now(() => {
        const a = answer(input)
        // What an agent follows from the answer's items, with the switch as it is now.
        const links = answerLinks(
          a.sources,
          {
            facts: factsOf(state),
            definitions: definitions.list(),
            domains: Object.fromEntries(workspace.domains().map((d) => [d.id, d])),
          },
          settings.read(scenario.address()).links,
        )
        return { ...a, links }
      }),
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
    // A named report waits in this visit's memory; the demo's owners don't act on it here.
    reportAnswer: ({ question }) =>
      now(() => {
        const id = `report-${reports.length + 1}`
        reports.unshift({ id, question, at: new Date() })
        return { id }
      }),
    getMyReports: () =>
      now(() =>
        reports.map((r) => ({ id: r.id, question: r.question, on: reportedOn(r.at, new Date()) })),
      ),

    // Observability
    observabilityPage: ({ section, ...view }) =>
      read('observabilityPage', JSON.stringify([section, view]), () => {
        const person = workspace.people().find((p) => p.name === me())
        const reader = { admin: !!person?.admin, owns: person?.owns ?? [] }
        return obsPage(obsData(scenario.obsState()), view, reader)
      }),
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
    setTool: ({ name, on }) => now(() => settings.setTool(name, on)),
    setPause: (change) => now(() => settings.setPause(change)),
    createAccessKey: () => now(() => ({ key: demoAccessKey() })),
    advancedPage: () => read('advancedPage', '', () => advancedOf(state.log)),
    checkHistory: () => now(() => ({ whole: true, entries: 1284 })),
    exportHistory: () => now(() => historyFile(state.log)),
    exportContext: () =>
      now(() =>
        contextFile(
          factsOf(state)
            .filter((f) => f.status !== 'Draft' && f.status !== 'Archived')
            .map((f) => ({ id: f.id, title: f.title })),
        ),
      ),
    setFigures: ({ source, on }) => now(() => settings.setFigures(source, on)),
    setDataContact: ({ source, name }) => now(() => settings.setContact(source, name)),
    setFigureConnection: ({ source, endpoint }) =>
      now(() => settings.setConnection(source, endpoint)),
    connectIntegration: ({ id, setup }) =>
      now(() => {
        settings.connect(id)
        if (setup) dispatch({ type: 'setupStep', step: 'definitions' })
      }),
    disconnectIntegration: ({ id }) => now(() => settings.disconnect(id)),
    getIntegrations: () =>
      now(() => ({
        cubeViews,
        driveFolders,
        figureConnections: settings.connections(),
        warehouseHas,
      })),
    integrationsPage: () =>
      read('integrationsPage', '', () => integrations.page(scenario.address())),
    integrationPage: ({ id }) =>
      read('integrationPage', id, () => integrations.sourcePage(id, scenario.address())),
    readIntegration: ({ id }) => now(() => integrations.readAgain(id, new Date())),
    pauseIntegration: ({ id, paused }) => now(() => integrations.pause(id, paused)),
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
    // ?quality=running holds a check at 5 of them; ?quality=failed shows one that stopped at 8.
    getSavedCheck: () =>
      now(() => {
        const flag = scenario.address().query.quality
        const total = saved.list().length
        const base = { total, checkedAt: saved.checkedAt(), trend: SAVED_TREND }
        if (flag === 'running') return { ...base, run: 'running' as const, checked: 5 }
        if (flag === 'failed') return { ...base, run: 'failed' as const, checked: 8 }
        const { run, checked, total: of } = saved.progress()
        return run === 'running'
          ? { ...base, run, checked, total: of }
          : { ...base, run, checked: 0 }
      }),
    checkSavedQuestions: ({ domain }) => {
      if (scenario.offline()) return Promise.reject(new ApiError('unanswered', "You're offline."))
      return saved.check(domain)
    },
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
