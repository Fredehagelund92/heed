import type { AnswerState } from "@/data/ask"
import { SLUG } from "@/lib/brand"

// One source for what Help and the docs say about the product's own words. The in-app Help page, the
// answer line's card in Ask, Ask's own labels and the docs' "Answer lines" article draw from these
// lists, so they can never disagree. Ten words is the ceiling: a "how do I" belongs in the docs.

/**
 * The six answer states, in one or two plain words, because many readers are not native English
 * speakers: no idioms, no contractions. The word never shows alone: its icon and tint always go with
 * it, and when the state is not Checked one short sentence goes under it. `long` is the older, longer
 * form, kept as the explanation (in a tooltip, in Help, in the answer line's card).
 */
export const ANSWER_LINES: { state: AnswerState; label: string; long: string; sentence: string; means: string; todo: string }[] = [
  {
    state: "grounded",
    label: "Checked",
    long: "Based on checked context",
    sentence: "This is written down and checked.",
    means: "Context applies, and its owner published it with a source and a check date.",
    todo: "Nothing to do.",
  },
  {
    state: "partial",
    label: "Partial",
    long: "Covers part of it",
    sentence: "Only part of this is written down.",
    means: "Context covers part of the question, or the dates were assumed. The answer says which part.",
    todo: "Write the missing part, or tell the owner.",
  },
  {
    state: "missing",
    label: "Not found",
    long: "Nothing written down",
    sentence: "Nothing is written about this yet.",
    means: "Nobody has written anything down for this. It does not mean there is no explanation.",
    todo: "Write context, or tell the owner.",
  },
  {
    state: "conflict",
    label: "Conflict",
    long: "Context disagrees",
    sentence: "Two items say different things.",
    means: "Two items that apply say different things. Agents give both and say so.",
    todo: "An owner keeps one, narrows one, or keeps both.",
  },
  {
    state: "stale",
    label: "Outdated",
    long: "May be out of date",
    sentence: "Some of this may be old.",
    means: "An item's check date has passed, or a definition it relies on changed.",
    todo: "The owner checks it: Still true, or Edit.",
  },
  {
    state: "failed",
    label: "Not checked",
    long: "Could not check",
    sentence: "The check did not run.",
    means: "The check could not run just now. It is not the same as Not found.",
    todo: "Ask again in a minute.",
  },
]

export const WORDS: [string, string][] = [
  ["Context item", "One thing agents should know about the numbers: an event, a warning, a rule or a guide. It has a source and a check date."],
  ["Domain", "An area of the business, such as Sales or Marketing. Every context item belongs to one."],
  ["Owner", "The person who publishes and checks a domain's context. Agents read only what an owner has published."],
  ["Suggestion", "A change someone else sends to an owner, from the editor or through their agent. Nothing changes until the owner publishes it."],
  ["Definition", "A metric, a dimension or a term, and what it means here. Metrics and dimensions come from your definitions source; terms are written here."],
  ["Synonym", "Another name for a metric or a dimension, such as GMV for Gross sales. Agents read it as that definition."],
  ["Not found", "A question agents asked several times and found nothing written down for. Its card brings a draft."],
  ["Reported", "Someone said a context item is wrong or unclear. The owner sees it in the Inbox."],
  ["Due for a check", "A context item whose check date has passed. The owner confirms it is still true, or edits it."],
  ["Don't conclude", "A line on a context item that stops an agent from reading a cause into it."],
]

export type Keys = { keys: string[]; then?: string[]; label: string; or?: string[] }
export const SHORTCUTS: { group: string; rows: Keys[] }[] = [
  {
    group: "Anywhere",
    rows: [
      { keys: ["⌘", "K"], label: "Search, or go anywhere" },
      { keys: ["⌘", "B"], label: "Show or hide the sidebar" },
      { keys: ["?"], label: "Show these shortcuts" },
      { keys: ["Esc"], label: "Close, or go back" },
    ],
  },
  {
    group: "Lists",
    rows: [
      { keys: ["J"], or: ["K"], label: "Move down, or up" },
      { keys: ["↵"], label: "Open" },
      { keys: ["X"], label: "Select" },
      { keys: ["⇧", "↓"], label: "Select a run, as Shift and a click does" },
      { keys: ["/"], label: "Search the list" },
    ],
  },
  {
    group: "Review",
    rows: [
      { keys: ["J"], or: ["K"], label: "Next, or previous suggestion" },
      { keys: ["N"], or: ["P"], label: "Next, or previous change" },
      { keys: ["⌘", "↵"], label: "Publish, when it is ready" },
      { keys: ["Esc"], label: "Close the note, keeping it" },
    ],
  },
  {
    group: "Ask",
    rows: [
      { keys: ["/"], label: "Start typing a question" },
      { keys: ["⌥", "H"], label: "Show or hide history" },
    ],
  },
]

export type DocPage = { slug: string; title: string; line: string; group: string; mins: number }
export const DOC_GROUPS = ["Start", "Write and review", "Set up", "How it works", "Reference"] as const
export const DOC_PAGES: DocPage[] = [
  {
    slug: "get-started",
    title: "Get started",
    line: "From an empty workspace to a first answer from what you wrote, in about ten minutes.",
    group: "Start",
    mins: 4,
  },
  {
    slug: "connect-an-agent",
    title: "Connect an agent",
    line: "One prompt for Claude, Cursor or another agent, and what approving does.",
    group: "Start",
    mins: 3,
  },
  {
    slug: "write-context",
    title: "Write context",
    line: "What a context item is, what to put in it, its source and its check date.",
    group: "Write and review",
    mins: 5,
  },
  {
    slug: "review-a-suggestion",
    title: "Review a suggestion",
    line: "The quick view, the review, Try it, and publishing or returning.",
    group: "Write and review",
    mins: 4,
  },
  {
    slug: "definitions-and-synonyms",
    title: "Definitions and synonyms",
    line: "Metrics and terms, other names for them, and why some are read-only.",
    group: "Write and review",
    mins: 3,
  },
  { slug: "domains-and-owners", title: "Domains and owners", line: "Who publishes what, how to add a domain, and the sandbox.", group: "Set up", mins: 3 },
  {
    slug: "integrations",
    title: "Integrations",
    line: "Connect where metrics are defined and where documents live, and what is read.",
    group: "Set up",
    mins: 4,
  },
  {
    slug: "how-agents-use-it",
    title: "How agents use it",
    line: "Published context only, one answer line first, and what happens when nothing is written down.",
    group: "How it works",
    mins: 4,
  },
  { slug: "answer-lines", title: "Answer lines", line: "The six lines an answer starts with, and what each one asks of you.", group: "How it works", mins: 2 },
  { slug: "privacy", title: "Privacy", line: "What is kept about questions, what is never kept, and who can see a chat.", group: "How it works", mins: 2 },
  { slug: "tools", title: "Agent tools", line: "The six tools an agent can call, with what each takes and returns.", group: "Reference", mins: 3 },
]

export const DOCS_HOME = "#/docs"
export const SUPPORT_EMAIL = `support@${SLUG}.example`

/** The plain-text index an agent can read at /docs/llms.txt: every page with its one line. */
export const llmsTxt = () =>
  [
    "# Documentation",
    "",
    "Guides for writing context, connecting agents and reviewing suggestions.",
    "",
    ...DOC_GROUPS.flatMap((g) => [`## ${g}`, ...DOC_PAGES.filter((p) => p.group === g).map((p) => `- [${p.title}](/docs/${p.slug}): ${p.line}`), ""]),
  ].join("\n")
