import * as React from "react"
import { cards, setupSteps } from "@/data/inbox"
import { reviews } from "@/data/review"

const reviewIds = () => reviews.map((r) => r.id)
import { ABOUT_BUSINESS, facts as seedFacts, person, type DomainId, type Fact } from "@/data/world"

// The mockup's whole state: who is signed in, what they did to their Inbox and to context.
// Mock behaviour only. Nothing leaves the browser, and a reload starts the demo again.

export type Outcome = { label: string; at: string }

/** What a change to many items did, as their History and Settings say it. */
export type LogEntry = {
  id: string
  /** ISO date. */
  on: string
  who: string
  what: "archived" | "deleted" | "moved" | "kind" | "owners" | "checked"
  /** One sentence: "Moved to Marketing." */
  summary: string
  items: { id: string; title: string; domain?: DomainId }[]
}

/** A suggestion someone sent from the editor: it waits for the owner, visibly, until they decide. */
export type Sent = { id: string; factId?: string; title: string; by: string; to: string; domain: DomainId; at: string }

export type State = {
  user: string | null
  install: "new" | "normal"
  /** A new install: no demo context or cards, only what this visit adds. */
  fresh: boolean
  setup: Record<string, boolean>
  done: Record<string, Outcome>
  /** Suggestions sent this visit, waiting for an owner. */
  sent: Sent[]
  /** Context published this visit, and when: the item says so on its page. */
  published: Record<string, string>
  /** Cards the owner has opened, in the quick view or the review: the Inbox's unread dot goes. */
  opened: Record<string, boolean>
  /**
   * Suggestions the owner has read in the review: the end of the change was on screen for a few
   * seconds, or they marked it read. Only these can be published together.
   */
  reviewed: Record<string, boolean>
  edits: Record<string, Partial<Fact>>
  added: Fact[]
  about: string
  /** Context items opened here, in the peek or on their page: only these can be marked checked together. */
  viewed: Record<string, boolean>
  /** Drafts deleted this visit: gone from every list. */
  deleted: Record<string, boolean>
  /** Changes made to many items at once, newest first. */
  log: LogEntry[]
}

export type Action =
  | { type: "signIn"; name: string; fresh: boolean }
  | { type: "signOut" }
  | { type: "demo"; mode: "setup" | "done" | "week" | "last" }
  | { type: "complete"; card: string; outcome: string }
  /** Undo of a decision: the card needs you again, and an item it changed is as it was. */
  | { type: "reopen"; card: string; restore?: { id: string; edit?: Partial<Fact> } }
  | { type: "opened"; card: string }
  | { type: "reviewed"; card: string }
  | { type: "send"; sent: Sent }
  | { type: "withdraw"; id: string }
  | { type: "published"; id: string }
  /** Undo: put back the state from before a decision. */
  | { type: "restore"; state: State }
  /**
   * Undo one or more decisions exactly, and only them: the cards' outcomes and the context items
   * they changed go back to how they were, while anything else done since stays.
   */
  | { type: "revert"; before: State; cards: string[]; facts: string[]; entry?: string }
  | { type: "editFact"; id: string; patch: Partial<Fact> }
  | { type: "viewedFact"; id: string }
  /** A change to many items at once: their edits, the drafts it deletes, and its line in History. */
  | { type: "bulk"; patches: Record<string, Partial<Fact>>; remove: string[]; entry: LogEntry }
  /** An undone change that only had its line in History (a term's deletion): the line goes. */
  | { type: "unlog"; entry: string }
  | { type: "addFact"; fact: Fact }
  | { type: "setupStep"; step: string }
  | { type: "about"; text: string }

export const start: State = {
  user: "Jon Abara",
  install: "normal",
  fresh: false,
  setup: {},
  done: {},
  opened: {},
  reviewed: {},
  sent: [],
  published: {},
  edits: {},
  added: [],
  about: ABOUT_BUSINESS,
  viewed: {},
  deleted: {},
  log: [],
}

export function reduce(s: State, a: Action): State {
  switch (a.type) {
    case "signIn":
      return { ...start, user: a.name, install: a.fresh ? "new" : "normal", fresh: a.fresh, about: a.fresh ? "" : ABOUT_BUSINESS }
    case "signOut":
      return { ...s, user: null }
    case "demo": {
      // A scenario in the address is a fresh start, so every link lands the same way whatever came before.
      const fresh = { ...start, user: s.user }
      if (a.mode === "setup") return { ...fresh, install: "new", fresh: true, about: "" }
      if (a.mode === "week") return fresh
      // One suggestion left in the review: the rest decided, so its decision is the last.
      if (a.mode === "last")
        return {
          ...fresh,
          done: Object.fromEntries(
            reviewIds()
              .filter((id) => id !== "sug-ines-link")
              .map((id) => [id, { label: id === "sug-agent" ? "Returned" : id === "sug-lars-retire" ? "Closed" : "Published", at: "Today" }])
          ),
        }
      return {
        ...fresh,
        done: Object.fromEntries(cards.filter((c) => c.for === s.user).map((c) => [c.id, { label: doneLabel(c.type), at: "Today" }])),
      }
    }
    case "send":
      return { ...s, sent: [a.sent, ...s.sent] }
    case "withdraw":
      return { ...s, sent: s.sent.filter((x) => x.id !== a.id) }
    case "published":
      return { ...s, published: { ...s.published, [a.id]: "just now" } }
    case "restore":
      return a.state
    case "revert": {
      const back = <T>(now: Record<string, T>, then: Record<string, T>, keys: string[]) => {
        const out = { ...now }
        for (const k of keys) {
          if (k in then) out[k] = then[k]
          else delete out[k]
        }
        return out
      }
      return {
        ...s,
        done: back(s.done, a.before.done, a.cards),
        edits: back(s.edits, a.before.edits, a.facts),
        published: back(s.published, a.before.published, a.facts),
        added: [...a.before.added.filter((f) => a.facts.includes(f.id)), ...s.added.filter((f) => !a.facts.includes(f.id))],
        deleted: back(s.deleted, a.before.deleted, a.facts),
        // An undone change was never made: its line leaves History.
        log: a.entry ? s.log.filter((e) => e.id !== a.entry) : s.log,
      }
    }
    case "opened":
      return s.opened[a.card] ? s : { ...s, opened: { ...s.opened, [a.card]: true } }
    case "reviewed":
      return s.reviewed[a.card] ? s : { ...s, reviewed: { ...s.reviewed, [a.card]: true }, opened: { ...s.opened, [a.card]: true } }
    case "complete":
      return { ...s, done: { ...s.done, [a.card]: { label: a.outcome, at: "Just now" } } }
    case "reopen": {
      const done = { ...s.done }
      delete done[a.card]
      if (!a.restore) return { ...s, done }
      const edits = { ...s.edits }
      if (a.restore.edit) edits[a.restore.id] = a.restore.edit
      else delete edits[a.restore.id]
      return { ...s, done, edits }
    }
    case "editFact":
      return { ...s, edits: { ...s.edits, [a.id]: { ...s.edits[a.id], ...a.patch } } }
    case "viewedFact":
      return s.viewed[a.id] ? s : { ...s, viewed: { ...s.viewed, [a.id]: true } }
    case "bulk": {
      const edits = { ...s.edits }
      for (const [id, patch] of Object.entries(a.patches)) edits[id] = { ...edits[id], ...patch }
      const deleted = { ...s.deleted }
      for (const id of a.remove) deleted[id] = true
      return { ...s, edits, deleted, log: [a.entry, ...s.log] }
    }
    case "unlog":
      return { ...s, log: s.log.filter((e) => e.id !== a.entry) }
    case "addFact":
      return { ...s, added: [a.fact, ...s.added.filter((f) => f.id !== a.fact.id)] }
    case "setupStep": {
      const setup = { ...s.setup, [a.step]: true }
      const finished = setupSteps.every((st) => setup[st.id])
      return { ...s, setup, install: finished ? "normal" : s.install }
    }
    case "about":
      return { ...s, about: a.text }
  }
}

function doneLabel(type: string) {
  return type === "suggestion" ? "Published" : type === "gap" ? "Context written" : type === "flag" ? "Answered" : "Checked"
}

export const StoreContext = React.createContext<{ state: State; dispatch: React.Dispatch<Action> } | null>(null)

export function useStore() {
  const ctx = React.useContext(StoreContext)
  if (!ctx) throw new Error("useStore outside StoreProvider")
  return ctx
}

export function useMe() {
  const { state } = useStore()
  return person(state.user ?? "Jon Abara")
}

/** Every context item as it is now, with the demo's edits applied. */
export function useFacts(): Fact[] {
  const { state } = useStore()
  return React.useMemo(
    () =>
      (state.fresh ? state.added : [...state.added, ...seedFacts.map((f) => ({ ...f, ...state.edits[f.id] }))])
        .map((f) => (state.edits[f.id] && state.added.includes(f) ? { ...f, ...state.edits[f.id] } : f))
        .filter((f) => !state.deleted[f.id]),
    [state.added, state.edits, state.fresh, state.deleted]
  )
}

export function useFact(id: string | undefined) {
  const all = useFacts()
  return all.find((f) => f.id === id)
}
