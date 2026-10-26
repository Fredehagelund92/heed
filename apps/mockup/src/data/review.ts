import { spainDraft } from "./drafts"
import { LARS_REPLY } from "./comments"

// What the full-screen review shows for each waiting suggestion: a one-sentence summary, the
// change split into blocks by kind, what agents will say before and after, and what to watch for.
// Mock content; in Heed the blocks come from diffing the parsed document (words, formatting,
// links and order told apart deterministically, no model).

/** A run of text in a change: unchanged, added, removed, or the same words formatted differently. */
export type Seg = { t: "same" | "add" | "del" | "fmt"; text: string; note?: string }

/**
 * Text with marks, so the data stays readable: [-removed-], {+added+}, {*formatted|what changed*}.
 */
export function marks(s: string): Seg[] {
  const out: Seg[] = []
  const re = /\[-([\s\S]+?)-\]|\{\+([\s\S]+?)\+\}|\{\*([\s\S]+?)\*\}/g
  let last = 0
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ t: "same", text: s.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ t: "del", text: m[1] })
    else if (m[2] !== undefined) out.push({ t: "add", text: m[2] })
    else {
      const [text, note] = m[3].split("|")
      out.push({ t: "fmt", text, note })
    }
    last = m.index! + m[0].length
  }
  if (last < s.length) out.push({ t: "same", text: s.slice(last) })
  return out
}

/** "1 link", "2 links", "3 dates", "2 wording": a count of changes of one kind. */
export function countWord(kind: ChangeKind, n: number) {
  const w = kind.toLowerCase()
  if (n === 1) return w.replace(/s$/, "")
  return kind === "Link" || kind === "Order" ? `${w}s` : w
}

/** The quiet label each change block carries. */
export type ChangeKind = "Wording" | "Formatting" | "Link" | "Order" | "Added" | "Removed" | "Dates"

export type Block =
  | { kind: "Wording" | "Added" | "Removed"; field: string; text: string }
  | { kind: "Formatting"; field: string; label: string; text: string; list?: { ordered: boolean; was: "bullets" | "numbers"; items: string[] } }
  | { kind: "Link"; field: string; text: string; before: string; after: string }
  /** An @ link added or removed in the text: what an agent can follow from the item changes. */
  | { kind: "Link"; field: string; text: string; mention: { id: string; label: string; change: "added" | "removed" } }
  | { kind: "Order"; field: string; label: string; steps: { text: string; from?: number }[] }
  | { kind: "Dates"; field: string; before: string; after: string; span: { from: number; was: number; now: number } }

export type Answer = { state: "grounded" | "missing" | "conflict"; text: string }

export type Review = {
  /** The Inbox card this review is for. */
  id: string
  title: string
  from: string
  agent?: string
  via: string
  on: string
  note?: string
  mode: "edit" | "new" | "retire"
  /** Drafted for a Not found card: how many questions it answers, and what it was drafted from. Nobody wrote it. */
  drafted?: { questions: number; scope: string; from: string }
  /** A suggestion a sync created from a document: where it came from, and the quote Heed kept. */
  synced?: { tool: "Google Drive"; folder: string; doc: string; read: string; quote: string }
  /** One sentence: what changes, said before any mark is shown. */
  summary: string
  /** Counts by kind, for the summary line. */
  counts: { kind: ChangeKind; n: number }[]
  /** The values that moved, pulled out: Number 312 to 340. */
  moved: { label: string; before?: string; after: string }[]
  blocks: Block[]
  unchanged: string[]
  formattingOnly?: boolean
  /** A long rewrite: side by side, with where the changes sit. */
  rewrite?: { field: string; before: string; after: string; changes: number }
  /** An agent's suggestion: each claim against the sentence the agent copied from the source. */
  claims?: { sentence: string; rows: { claim: string; source: string; same: "same" | "different" | "check" }[] }
  /** Overlaps a live context item that says something else. */
  clash?: { factId: string; title: string; mine: string; theirs: string }
  retire?: {
    factId: string
    reason: string
    used: number
    checkFirst: string
    /** The proposer took it back in the comments: the review shows that, and Archive steps back. */
    withdrawn?: { by: string; when: string; quote: string }
  }
  tryIt: { question: string; before: Answer; after: Answer; reach: number }
  /** The stored markdown, for the Source view. */
  source: { before: string; after: string }
}

const ines = { from: "Ines Duarte", via: "a chat", on: "22 Oct 2026" }

export const reviews: Review[] = [
  // A Not found card's draft: reviewed, edited and published like any suggestion, never a blank page.
  {
    id: "gap-spain",
    title: spainDraft.title,
    from: "Drafted for you",
    via: "agents' questions",
    on: "23 Oct 2026",
    mode: "new",
    drafted: { questions: 9, scope: "Orders in Spain, October 2026", from: "a payment provider's status page" },
    note: "Agents asked about Orders in Spain for October 9 times this week and found nothing written down. This draft comes from the payment provider's status page; check the dates and the wording.",
    summary: "A draft for what agents couldn't answer: card payments in Spain failed from 14 to 16 October 2026.",
    counts: [{ kind: "Added", n: 1 }],
    moved: [
      { label: "New", after: "Orders, Spain" },
      { label: "When", after: "14 to 16 Oct 2026" },
    ],
    blocks: [
      { kind: "Added", field: "What agents should know", text: `${spainDraft.summary} ${spainDraft.body}` },
      { kind: "Added", field: "Where and when", text: "Orders in Spain, 14 to 16 Oct 2026" },
      { kind: "Added", field: "Don't conclude", text: spainDraft.dontConclude },
    ],
    unchanged: [],
    claims: {
      sentence: spainDraft.quote,
      rows: [
        { claim: "from 14 to 16 October 2026", source: "between 14 and 16 October 2026", same: "same" },
        { claim: "card payments failed", source: "card authorisations failed intermittently", same: "check" },
        { claim: "orders there fell", source: "not in the sentence", same: "check" },
      ],
    },
    tryIt: {
      question: "How did orders in Spain change in October 2026?",
      before: { state: "missing", text: "Nothing is written down for Orders in Spain, 1 to 31 Oct 2026." },
      after: { state: "grounded", text: `${spainDraft.summary} ${spainDraft.body}` },
      reach: 9,
    },
    source: { before: "", after: `${spainDraft.summary}\n\n${spainDraft.body}` },
  },
  {
    id: "sug-ines",
    title: "Units sold excludes test accounts",
    ...ines,
    note: "The returns team started its own test accounts in October. They were counted until last week.",
    mode: "edit",
    summary: "Raises the test-account count from 312 to 340, and leaves out the returns team's 28 accounts from 1 October.",
    counts: [
      { kind: "Wording", n: 2 },
      { kind: "Link", n: 2 },
    ],
    moved: [
      { label: "Number", before: "312", after: "340" },
      { label: "New date", after: "1 Oct 2026" },
      { label: "Source page", after: "units-sold-october" },
    ],
    blocks: [
      {
        kind: "Wording",
        field: "What agents should know",
        text: "Units sold in Norway leaves out the [-312-]{+340+} accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too.{+ From 1 October 2026 the 28 accounts the returns team uses to test refunds are left out as well.+}",
      },
      {
        kind: "Link",
        field: "What agents should know",
        text: "In the new sentence about the returns team's accounts.",
        mention: { id: "term:Test account", label: "Test account", change: "added" },
      },
      {
        kind: "Link",
        field: "Source",
        text: "Units sold definition",
        before: "https://wiki.example/data/definitions/units-sold",
        after: "https://wiki.example/data/definitions/units-sold-october",
      },
    ],
    unchanged: ["Kind", "Where", "When", "Don't conclude"],
    tryIt: {
      question: "How many test accounts does units sold leave out in Norway?",
      before: {
        state: "grounded",
        text: "Units sold in Norway leaves out the 312 accounts the teams use to test the webshop, and the new app's test accounts from 29 May 2026.",
      },
      after: {
        state: "grounded",
        text: "Units sold in Norway leaves out the 340 accounts the teams use to test the webshop, the new app's test accounts from 29 May 2026, and the returns team's 28 accounts from 1 October 2026.",
      },
      reach: 12,
    },
    source: {
      before:
        "Units sold in Norway leaves out the 312 accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too.\n\nSource: [Units sold definition](https://wiki.example/data/definitions/units-sold)",
      after:
        "Units sold in Norway leaves out the 340 accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too. From 1 October 2026 the 28 accounts the returns team uses to test refunds are left out as well.\n\nSource: [Units sold definition](https://wiki.example/data/definitions/units-sold-october)",
    },
  },
  {
    id: "sug-ines-format",
    title: "Online sales to Norway stopped on 4 August 2026",
    ...ines,
    note: "Made the two checks easier to follow in order.",
    mode: "edit",
    summary: "Tidies the layout: the two checks become a numbered list, and two phrases are emphasised.",
    counts: [{ kind: "Formatting", n: 3 }],
    moved: [],
    formattingOnly: true,
    blocks: [
      {
        kind: "Formatting",
        field: "What agents should know",
        label: "Bold added",
        text: "There are no stores in Norway, so the webshop was {*the only way to buy there|Bold*}.",
      },
      {
        kind: "Formatting",
        field: "What agents should know",
        label: "Bulleted list became a numbered list",
        text: "",
        list: {
          ordered: true,
          was: "bullets",
          items: ["Parcels already on their way still arrived.", "Compare Norway with itself before or after the stop, never across it."],
        },
      },
      {
        kind: "Formatting",
        field: "What agents should know",
        label: "Italic added",
        text: "Compare Norway with itself before or after the stop, {*never across it|Italic*}.",
      },
    ],
    unchanged: ["Title", "Kind", "Where", "When", "Source", "Don't conclude"],
    tryIt: {
      question: "Why did orders in Norway drop in August?",
      before: { state: "grounded", text: "Online sales to Norway stopped on 4 August 2026 under a new customs rule, and there are no stores there." },
      after: { state: "grounded", text: "Online sales to Norway stopped on 4 August 2026 under a new customs rule, and there are no stores there." },
      reach: 9,
    },
    source: {
      before:
        "There are no stores in Norway, so the webshop was the only way to buy there.\n\n- Parcels already on their way still arrived.\n- Compare Norway with itself before or after the stop, never across it.",
      after:
        "There are no stores in Norway, so the webshop was **the only way to buy there**.\n\n1. Parcels already on their way still arrived.\n2. Compare Norway with itself before or after the stop, _never across it_.",
    },
  },
  {
    id: "sug-ines-link",
    title: "Returns changed definition on 28 April 2026",
    ...ines,
    note: "The old changelog page moved.",
    mode: "edit",
    summary: "Points the source at the new changelog page. The words are the same, but where readers and agents are sent changes.",
    counts: [{ kind: "Link", n: 1 }],
    moved: [{ label: "Source page", before: "returns/changelog-2026", after: "definitions/returns#changelog" }],
    blocks: [
      {
        kind: "Link",
        field: "Source",
        text: "Returns definition changelog",
        before: "https://wiki.example/data/returns/changelog-2026",
        after: "https://wiki.example/data/definitions/returns#changelog",
      },
    ],
    unchanged: ["Title", "What agents should know", "Kind", "Where", "When", "Don't conclude"],
    tryIt: {
      question: "Why did Norway returns drop at the end of April?",
      before: { state: "grounded", text: "From 28 April 2026, Norway returns count only refunds that reached the customer's bank. Source: the 2026 changelog page." },
      after: {
        state: "grounded",
        text: "From 28 April 2026, Norway returns count only refunds that reached the customer's bank. Source: the returns definition's changelog.",
      },
      reach: 4,
    },
    source: {
      before: "Source: [Returns definition changelog](https://wiki.example/data/returns/changelog-2026)",
      after: "Source: [Returns definition changelog](https://wiki.example/data/definitions/returns#changelog)",
    },
  },
  {
    id: "sug-ines-order",
    title: "What to rule out before explaining a jump in Gross margin",
    ...ines,
    note: "Large orders were the cause both times this autumn, so check them first.",
    mode: "edit",
    summary: "Moves the check for very large orders to the top of the guide. The words are the same.",
    counts: [{ kind: "Order", n: 1 }],
    moved: [{ label: "Step", before: "2", after: "1" }],
    blocks: [
      {
        kind: "Order",
        field: "What agents should know",
        label: "Moved up from step 2",
        steps: [
          { text: "Check for a few very large orders. One big order at full price can lift a week's margin.", from: 2 },
          { text: "Look at four weeks or more, never one weekend." },
          { text: "Compare with the average order value for the same weeks." },
        ],
      },
    ],
    unchanged: ["Title", "Kind", "Where", "When", "Source", "Don't conclude"],
    tryIt: {
      question: "What should I check before explaining a jump in gross margin in Spain?",
      before: {
        state: "grounded",
        text: "First look at four weeks or more, never one weekend. Then check for a few very large orders, and compare with average order value.",
      },
      after: {
        state: "grounded",
        text: "First check for a few very large orders. Then look at four weeks or more, never one weekend, and compare with average order value.",
      },
      reach: 6,
    },
    source: {
      before:
        "1. Look at four weeks or more, never one weekend.\n2. Check for a few very large orders. One big order at full price can lift a week's margin.\n3. Compare with the average order value for the same weeks.",
      after:
        "1. Check for a few very large orders. One big order at full price can lift a week's margin.\n2. Look at four weeks or more, never one weekend.\n3. Compare with the average order value for the same weeks.",
    },
  },
  {
    id: "sug-ines-long",
    title: "What to rule out before explaining a jump in Orders",
    ...ines,
    note: "Rewrote it after the September jump. The provider now sends Saturday files on Sunday.",
    mode: "edit",
    summary: "Rewrites the France guide: weekend files now arrive on Sunday, and a second check on refunds is added.",
    counts: [{ kind: "Wording", n: 4 }],
    moved: [
      { label: "Day", before: "Monday", after: "Sunday" },
      { label: "New check", after: "refunds" },
    ],
    blocks: [],
    rewrite: {
      field: "What agents should know",
      changes: 4,
      before:
        "Before you explain a jump in France orders, check the file dates. The provider sends [-weekend files together on Monday-], and most jumps are [-those late files, not customers-]. [-Compare a full week with the same week last year.-]",
      after:
        "Before you explain a jump in France orders, check the file dates. The provider sends {+Saturday's file on Sunday and Sunday's on Monday+}, and most jumps are {+files arriving late rather than more customers+}. {+Then check refunds: a batch of refunds booked on one day reads as a drop.+} {+Compare whole weeks, Monday to Sunday, with the same weeks last year.+}",
    },
    unchanged: ["Title", "Kind", "Where", "When", "Source", "Don't conclude"],
    tryIt: {
      question: "Why did orders in France jump on Monday?",
      before: { state: "grounded", text: "The provider sends weekend files together on Monday, and most jumps are those late files, not customers." },
      after: {
        state: "grounded",
        text: "The provider sends Saturday's file on Sunday and Sunday's on Monday, so a Monday jump is usually files arriving late. Check refunds too.",
      },
      reach: 7,
    },
    source: {
      before:
        "Before you explain a jump in France orders, check the file dates. The provider sends weekend files together on Monday, and most jumps are those late files, not customers. Compare a full week with the same week last year.",
      after:
        "Before you explain a jump in France orders, check the file dates. The provider sends Saturday's file on Sunday and Sunday's on Monday, and most jumps are files arriving late rather than more customers. Then check refunds: a batch of refunds booked on one day reads as a drop. Compare whole weeks, Monday to Sunday, with the same weeks last year.",
    },
  },
  {
    id: "sug-ines-dates",
    title: "Payment provider switched in France on 12 May 2026",
    ...ines,
    note: "Finance found double bookings up to 26 May.",
    mode: "edit",
    summary: "Extends when it applies by a week: from 12 to 26 May 2026 instead of 12 to 19 May.",
    counts: [{ kind: "Dates", n: 1 }],
    moved: [{ label: "End date", before: "19 May 2026", after: "26 May 2026" }],
    blocks: [{ kind: "Dates", field: "When", before: "12 to 19 May 2026", after: "12 to 26 May 2026", span: { from: 12, was: 19, now: 26 } }],
    unchanged: ["Title", "What agents should know", "Kind", "Where", "Source", "Don't conclude"],
    tryIt: {
      question: "Why are France orders high for 20 to 26 May?",
      before: { state: "missing", text: "Nothing is written down for Orders in France from 20 to 26 May 2026." },
      after: { state: "grounded", text: "France's payments moved to a new provider on 12 May 2026, and some orders were booked twice until 26 May." },
      reach: 3,
    },
    source: { before: "When: 12 to 19 May 2026", after: "When: 12 to 26 May 2026" },
  },
  {
    id: "sug-agent",
    title: "Payment provider delays order data in Poland",
    from: "Kofi Mensah",
    agent: "Cursor",
    via: "a chat",
    on: "21 Oct 2026",
    mode: "new",
    summary: "New context: Poland orders arrive up to two days late from the payment provider since 14 October 2026.",
    counts: [{ kind: "Added", n: 1 }],
    moved: [
      { label: "New", after: "Orders, Poland" },
      { label: "From", after: "14 Oct 2026" },
    ],
    blocks: [
      {
        kind: "Added",
        field: "What agents should know",
        text: "Poland orders arrive up to two days late from the payment provider since 14 October 2026. The last two days of Poland orders are short until the files catch up.",
      },
      { kind: "Added", field: "Where and when", text: "Orders in Poland, from 14 Oct 2026, still going on" },
      { kind: "Added", field: "Don't conclude", text: "Low orders in Poland for these days do not mean that customers ordered less." },
    ],
    unchanged: [],
    claims: {
      sentence: "Settlement files for Polish card payments are delivered within 48 hours from 14 October 2026.",
      rows: [
        { claim: "since 14 October 2026", source: "from 14 October 2026", same: "same" },
        { claim: "up to two days late", source: "within 48 hours", same: "check" },
        { claim: "Poland orders", source: "Polish card payments", same: "different" },
      ],
    },
    tryIt: {
      question: "Why are Poland orders low for the last two days?",
      before: { state: "missing", text: "Nothing is written down for Orders in Poland." },
      after: {
        state: "grounded",
        text: "Poland orders arrive up to two days late from the payment provider since 14 October 2026, so the last two days are short until the files catch up.",
      },
      reach: 5,
    },
    source: {
      before: "",
      after:
        "Poland orders arrive up to two days late from the payment provider since 14 October 2026. The last two days of Poland orders are short until the files catch up.",
    },
  },
  {
    id: "sug-sofia-clash",
    title: "Norway orders leave out store credit from 1 November 2026",
    from: "Sofia Brandt",
    via: "editor",
    on: "22 Oct 2026",
    note: "Finance changes the rule on 1 November.",
    mode: "new",
    summary: "New context that says Norway orders leave out store credit, where live context says they count it.",
    counts: [{ kind: "Added", n: 1 }],
    moved: [{ label: "From", after: "1 Nov 2026" }],
    blocks: [
      {
        kind: "Added",
        field: "What agents should know",
        text: "From 1 November 2026, orders in Norway leave out store credit and gift cards. Earlier weeks include them.",
      },
    ],
    unchanged: [],
    clash: {
      factId: "itm_gift_store_credit",
      title: "Norway orders count store credit",
      mine: "From 1 November 2026, orders in Norway {+leave out+} store credit and gift cards.",
      theirs: "Orders in Norway {*include*} orders paid with store credit and gift cards, in euros at the daily rate.",
    },
    tryIt: {
      question: "Do Norway orders include gift-card money?",
      before: { state: "grounded", text: "Orders in Norway include orders paid with store credit and gift cards." },
      after: {
        state: "conflict",
        text: "Two context items disagree: one says Norway orders include store credit, the other that they leave it out from 1 November 2026.",
      },
      reach: 8,
    },
    source: { before: "", after: "From 1 November 2026, orders in Norway leave out store credit and gift cards. Earlier weeks include them." },
  },
  {
    id: "sug-lars-retire",
    title: "Data for Orders before 19 January 2026 is not reliable",
    from: "Lars Dahl",
    via: "editor",
    on: "21 Oct 2026",
    note: "Finance restated Sweden's orders back to 2025 last week.",
    mode: "retire",
    summary: "Archives a context item: finance restated Sweden orders before 19 January 2026, so the warning no longer holds.",
    counts: [{ kind: "Removed", n: 1 }],
    moved: [],
    blocks: [],
    unchanged: [],
    retire: {
      factId: "itm_r6lyl1pc",
      reason: "Finance restated Sweden orders before 19 January 2026 from the new payment report.",
      used: 4,
      checkFirst: "If some days are still missing from the restated data, edit the dates instead of archiving.",
      withdrawn: { by: "Lars Dahl", when: "Today, 08:50", quote: LARS_REPLY },
    },
    tryIt: {
      question: "Can I compare Sweden orders for 2025 and 2026?",
      before: {
        state: "grounded",
        text: "Sweden orders before 19 January 2026 come from the old payment report, which left out bank transfers. Use Sweden orders from 19 January 2026 only.",
      },
      after: { state: "missing", text: "Nothing is written down for Orders in Sweden for these dates." },
      reach: 4,
    },
    source: {
      before: "Sweden orders before 19 January 2026 come from the old payment report, which left out bank transfers.",
      after: "",
    },
  },
]

// Two suggestions today's Google Drive read created for the owners of Sales: never published by
// the read, waiting in the Inbox like any other suggestion.
const drive = { from: "Google Drive", via: "today's read of Google Drive", on: "23 Oct 2026" }
reviews.push(
  {
    id: "drive-marketplace",
    title: "Orders in Germany include marketplace orders from 15 October 2026",
    ...drive,
    mode: "new",
    synced: {
      tool: "Google Drive",
      folder: "Data team / Definitions",
      doc: "Marketplace orders: what we count",
      read: "Today, 06:00",
      quote: "From 15 October, German marketplace orders flow into the Orders table. Before that date they were only in the marketplace reports.",
    },
    summary: "New context from a document: Orders in Germany include marketplace orders from 15 October 2026.",
    counts: [{ kind: "Added", n: 1 }],
    moved: [
      { label: "New", after: "Orders, Germany" },
      { label: "From", after: "15 Oct 2026" },
    ],
    blocks: [
      {
        kind: "Added",
        field: "What agents should know",
        text: "From 15 October 2026, Orders in Germany include orders placed through marketplaces. Earlier weeks leave them out, so compare Germany only within each side of the date.",
      },
      { kind: "Added", field: "Where and when", text: "Orders in Germany, from 15 Oct 2026, still going on" },
    ],
    unchanged: [],
    tryIt: {
      question: "Why did orders in Germany jump in October?",
      before: { state: "missing", text: "Nothing is written down for Orders in Germany for October 2026." },
      after: { state: "grounded", text: "From 15 October 2026, Orders in Germany include marketplace orders, which earlier weeks leave out." },
      reach: 6,
    },
    source: { before: "", after: "From 15 October 2026, Orders in Germany include orders placed through marketplaces. Earlier weeks leave them out." },
  },
  {
    id: "drive-bundles",
    title: "Units sold counts a bundle as one unit",
    ...drive,
    mode: "new",
    synced: {
      tool: "Google Drive",
      folder: "Data team / Definitions",
      doc: "Units sold: bundles and sets",
      read: "Today, 06:00",
      quote: "A bundle (a tent with its footprint, say) is one line in the order and one unit in Units sold, whatever it holds.",
    },
    summary: "New context from a document: a bundle counts as one unit in Units sold, whatever it holds.",
    counts: [{ kind: "Added", n: 1 }],
    moved: [{ label: "New", after: "Units sold" }],
    blocks: [
      {
        kind: "Added",
        field: "What agents should know",
        text: "Units sold counts a bundle as one unit, however many products it holds. A tent sold with its footprint is one unit, not two.",
      },
    ],
    unchanged: [],
    tryIt: {
      question: "Does a tent bundle count as two units?",
      before: { state: "missing", text: "Nothing is written down for Units sold and bundles." },
      after: { state: "grounded", text: "No. Units sold counts a bundle as one unit, however many products it holds." },
      reach: 2,
    },
    source: { before: "", after: "Units sold counts a bundle as one unit, however many products it holds." },
  }
)

export const reviewFor = (id: string | undefined) => reviews.find((r) => r.id === id)

/** Needs care before publishing: an unverified claim, or a clash with live context. */
export const needsCare = (r: Review) => !!r.claims || !!r.clash

/** The claims an agent or a draft makes that the copied sentence doesn't plainly say. */
export const claimsToCheck = (r: Review) => r.claims?.rows.filter((x) => x.same !== "same").length ?? 0

/** What needs care, in a few words, for the quick view and the Inbox row: "2 claims to check". */
export function careLine(r: Review) {
  const n = claimsToCheck(r)
  if (n) return `${n} ${n === 1 ? "claim" : "claims"} to check`
  if (r.clash) return "Overlaps live context"
  if (r.retire?.withdrawn) return `Withdrawn by ${r.retire.withdrawn.by}`
  return undefined
}

/**
 * How long a change has to be on screen before it counts as read: longer for more words, from a
 * second and a half for a date to eight seconds for a long rewording.
 */
export const readTime = (r: Review) => Math.min(8000, Math.max(1500, 1000 + 12 * r.source.after.length))

/** An edit's new numbers and dates that come without a source: no new source page came with them. */
function unsourced(r: Review) {
  if (r.mode !== "edit") return []
  const newSource = r.blocks.some((b) => b.kind === "Link" && "after" in b)
  return newSource ? [] : r.moved.filter((m) => /number|date/i.test(m.label)).map((m) => m.after)
}

/** A changed link: someone should open the new page before it goes out. */
const changesALink = (r: Review) => r.blocks.some((b) => b.kind === "Link" && "after" in b)

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`)

/** `bulk` says whether it may go out with "Publish the ones you've read": not while something still needs a look. */
export type Readiness = { ok: boolean; title: string; text: string; bulk: boolean }

/**
 * The Ready line: what can honestly be said before publishing. Claims are checked only against a
 * copied sentence; a new number or date with no source says so, and only then. `relation` is the
 * answer to a clash, once given.
 */
export function readiness(r: Review, relation?: { hint: string } | null): Readiness {
  const n = claimsToCheck(r)
  const no = (x: Omit<Readiness, "bulk">): Readiness => ({ ...x, bulk: false })
  if (r.drafted)
    return no({ ok: false, title: "A draft to check", text: "Nobody has checked it yet. Read each claim against the source, edit what is off, then publish." })
  if (r.claims)
    return no({
      ok: false,
      title: `Ready, with ${n === 1 ? "a claim" : `${n} claims`} to check`,
      text: `${n === 1 ? "One claim isn't" : `${n} claims aren't`} plainly in the copied sentence. Return it with a note, or publish anyway if you know it's right.`,
    })
  if (r.clash)
    return relation
      ? no({ ok: true, title: "Ready", text: relation.hint })
      : no({ ok: false, title: "Not ready: choose how they relate", text: "Publish waits until you say how this relates to the live item." })
  if (r.retire?.withdrawn)
    return no({
      ok: false,
      title: `Withdrawn by ${r.retire.withdrawn.by}`,
      text: "In the comments they chose to suggest new dates instead. Close the suggestion, or archive anyway if you disagree.",
    })
  if (r.retire) return no({ ok: true, title: "Ready to archive", text: "Nothing else depends on it. Questions it answered get Not found." })
  const values = unsourced(r)
  if (values.length)
    return no({ ok: false, title: "Ready, not checked against a source", text: `Nothing compares ${list(values)} with a source. Check it, or return it with a note.` })
  if (changesALink(r))
    return no({
      ok: true,
      title: "Ready",
      text: r.counts.every((c) => c.kind === "Link")
        ? "The words are the same. Open the new page to check it says the same thing."
        : "The new values come with a new source page. Open it to check them.",
    })
  if (r.formattingOnly) return { ok: true, title: "Ready", text: "The words are the same; only the layout changes.", bulk: true }
  if (r.counts.every((c) => c.kind === "Order")) return { ok: true, title: "Ready", text: "The words are the same; only the order changes.", bulk: true }
  if (r.synced) return { ok: true, title: "Ready", text: "It says what the quoted document says. Who owns it is yours to decide.", bulk: true }
  return { ok: true, title: "Ready", text: "It reaches the questions it is meant for.", bulk: true }
}
