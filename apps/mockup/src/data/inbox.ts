import type { DomainId, Fact } from "./world"
import { factById, facts, kindLabel } from "./world"
import { spainDraft } from "./drafts"
import { reviews } from "./review"
import { DEFINITIONS_TOOL } from "./integrations"

export type CardType = "suggestion" | "gap" | "flag" | "check" | "look" | "alert"

/** Each card by what happened, so the word explains itself. */
export const cardTypeLabel: Record<CardType, string> = {
  suggestion: "Suggestion",
  gap: "Not found",
  flag: "Reported",
  check: "Due for a check",
  look: "Needs a look",
  alert: "Alert",
}

/**
 * This week's questions from agents, as counts: what is kept about them (no question text, no
 * names). The Inbox says it in one quiet sentence, including when nothing needs you.
 */
export const week = { asked: 142, found: 117, nothing: 25, mostAbout: "Orders in Spain" }

export type FieldChange = { label: string; before: string; after: string }

export type Suggestion = {
  /** The context item it changes; none for a new one. */
  factId?: string
  from: string
  /** Set when an agent sent it, with the person's OK. */
  agent?: string
  via: string
  on: string
  note?: string
  changes: FieldChange[]
  draft: Fact
}

export type InboxCard = {
  id: string
  type: CardType
  domain: DomainId
  /** Whose Inbox it lands in. */
  for: string
  when: string
  title: string
  line: string
  detail: string
  primary: string
  secondary: string[]
  factId?: string
  suggestion?: Suggestion
  /**
   * Not found: the scope agents asked about and how often (never their words, which are not
   * kept), and the item drafted for it, so the owner reviews a draft instead of a blank page.
   */
  gap?: { scope: string[]; times: number; belongs: string; draft?: Fact; acrossMonths?: string }
  /** A report someone sent on purpose from a conversation: kept with their words, and their name. */
  flag?: { reason: "wrong" | "unclear"; note: string; when: string; by: string; via: string }
  /** Raised by the saved-question alert: the questions that answer worse now, from Quality's one list. */
  look?: { questions: string[] }
  /**
   * Raised by an alert rule with a card of its own (Conflict, More questions not found, Calls fail,
   * Model spend, A connected tool did not sync): its rule, and where its one action goes.
   */
  alert?: {
    rule: "disagree" | "share" | "fail" | "spend" | "sync"
    name: string
    href: string
    /** A Conflict alert: the pair agents got, opened in the conflict dock. */
    pair?: string
  }
  /** Created by a sync from a document, never by a person. */
  source?: { tool: "Google Drive"; folder: string; doc: string; read: string }
}

export type Waiting = {
  id: string
  for: string
  title: string
  waitingFor: string
  domain: DomainId
  sent: string
  /** The suggestion's card in the owner's Inbox, where its comments hang. */
  card: string
}

const unitsSold = factById("itm_s90n5xps")!
const campaign = factById("itm_eprlkrz2")!

export const cards: InboxCard[] = [
  {
    id: "sug-ines",
    type: "suggestion",
    domain: "sales",
    for: "Jon Abara",
    when: "Today, 09:12",
    title: "Units sold excludes test accounts",
    line: "A change from Ines Duarte, from a chat.",
    detail: "340 test accounts instead of 312, and the returns team's 28 accounts left out from 1 October.",
    primary: "Review",
    secondary: [],
    factId: unitsSold.id,
    suggestion: {
      factId: unitsSold.id,
      from: "Ines Duarte",
      via: "a chat",
      on: "22 Oct 2026",
      note: "The returns team started its own test accounts in October. They were counted until last week.",
      changes: [
        {
          label: "What agents should know",
          before: unitsSold.summary,
          after:
            "Units sold in Norway leaves out the 340 accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too. From 1 October 2026 the 28 accounts the returns team uses to test refunds are left out as well.",
        },
        { label: "Kind", before: kindLabel.note, after: kindLabel.note },
        { label: "Where", before: "Units sold · Norway", after: "Units sold · Norway" },
        { label: "When", before: "Always", after: "Always" },
        {
          label: "Source",
          before: unitsSold.source,
          after: "https://wiki.example/data/definitions/units-sold-october",
        },
        { label: "Don't conclude", before: unitsSold.dontConclude, after: unitsSold.dontConclude },
      ],
      draft: {
        ...unitsSold,
        summary:
          "Units sold in Norway leaves out the 340 accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too. From 1 October 2026 the 28 accounts the returns team uses to test refunds are left out as well.",
        source: "https://wiki.example/data/definitions/units-sold-october",
      },
    },
  },
  {
    id: "sug-agent",
    type: "suggestion",
    domain: "sales",
    for: "Jon Abara",
    when: "Yesterday, 16:40",
    title: "Payment provider delays order data in Poland",
    line: "New context from an agent, sent with Kofi Mensah's OK.",
    detail: "Poland orders arrive up to two days late from the payment provider since 14 October.",
    primary: "Review",
    secondary: [],
    suggestion: {
      from: "Kofi Mensah",
      agent: "Cursor",
      via: "a chat",
      on: "21 Oct 2026",
      changes: [
        { label: "Title", before: "", after: "Payment provider delays order data in Poland" },
        {
          label: "What agents should know",
          before: "",
          after:
            "Poland orders arrive up to two days late from the payment provider since 14 October 2026. The last two days of Poland orders are short until the files catch up.",
        },
        { label: "Kind", before: "", after: kindLabel.issue },
        { label: "Where", before: "", after: "Orders · Poland" },
        { label: "When", before: "", after: "From 14 Oct 2026, still going on" },
        { label: "Source", before: "", after: "https://status.example/payments/poland" },
        {
          label: "Don't conclude",
          before: "",
          after:
            "Low orders in Poland for these days do not mean that customers ordered less. Wait until the data catches up before comparing Poland with other markets.",
        },
      ],
      draft: {
        id: "draft_poland",
        title: "Payment provider delays order data in Poland",
        summary:
          "Poland orders arrive up to two days late from the payment provider since 14 October 2026. The last two days of Poland orders are short until the files catch up.",
        domain: "sales",
        kind: "issue",
        where: ["Orders", "Poland"],
        valid: { from: "2026-10-14", ongoing: true },
        when: "From 14 Oct 2026, still going on",
        status: "Live",
        checkedBy: "Jon Abara",
        checkedOn: "22 Oct 2026",
        source: "https://status.example/payments/poland",
        quote: "Settlement files for Poland are delayed by up to 48 hours.",
        dontConclude:
          "Low orders in Poland for these days do not mean that customers ordered less. Wait until the data catches up before comparing Poland with other markets.",
      },
    },
  },
  {
    id: "gap-spain",
    type: "gap",
    domain: "sales",
    for: "Jon Abara",
    when: "This week",
    title: "Orders in Spain, October 2026",
    line: "Agents found nothing written down for this, 9 times this week.",
    detail: "A draft is ready from what agents asked and a payment provider's status page. Check every part before you publish.",
    primary: "Review",
    secondary: ["Not something we write down"],
    gap: {
      scope: ["Orders", "Spain", "1 to 31 Oct 2026"],
      times: 9,
      belongs: "context about Orders in Spain",
      draft: spainDraft,
    },
  },
  {
    // A gap across a month edge: 3 calls about 30 October and 3 about 1 November. Each month alone
    // stays under 5; counted together over 7 days, the card comes (the agreed change to FR-606 case 1).
    id: "gap-germany",
    type: "gap",
    domain: "sales",
    for: "Jon Abara",
    when: "This week",
    title: "Orders in Germany, 30 Oct to 1 Nov 2026",
    line: "Agents found nothing written down for this, 6 times this week: 3 about 30 October and 3 about 1 November, counted together.",
    detail: "Each month alone stayed under 5, so before, no card came. Nothing is drafted yet: write what agents should know about orders in Germany around the month edge.",
    primary: "Write context",
    secondary: ["Not something we write down"],
    gap: { scope: ["Orders", "Germany", "30 Oct to 1 Nov 2026"], times: 6, belongs: "context about Orders in Germany", acrossMonths: "October and November 2026" },
  },
  {
    id: "flag-germany",
    type: "flag",
    domain: "sales",
    for: "Jon Abara",
    when: "Yesterday, 11:05",
    title: "Orders lags by one day in the source tool",
    line: "Reported unclear: “Is this Germany only, or every market?”",
    detail: "Agents keep getting the context item until it is changed.",
    primary: "Open the context item",
    secondary: ["Not a problem"],
    factId: "itm_0tmqp7o1",
    flag: { reason: "unclear", note: "Is this Germany only, or every market?", when: "21 Oct 2026", by: "Maria Lindqvist", via: "Claude" },
  },
  {
    id: "look-sales",
    type: "look",
    domain: "sales",
    for: "Jon Abara",
    when: "Today, 09:41",
    title: "3 saved questions need a look",
    line: "One after Payment provider switched in Norway was archived, one after a check date passed, and one now gets a Conflict.",
    detail: "Agents get the new answer until someone fixes the item, or keeps the new answer as the saved one. Quality has before and now for each.",
    primary: "Open in Quality",
    secondary: [],
    look: { questions: ["sq-support-norway", "sq-gross-margin", "sq-gift-cards"] },
  },
  {
    id: "alert-orders-norway",
    type: "alert",
    domain: "sales",
    for: "Jon Abara",
    when: "Tue 20 Oct",
    title: "Orders in Norway: conflict, 3 times",
    line: "Agents got two context items that say different things about this.",
    detail: "Compare the two and keep one, narrow one, or keep both. Nothing changes until an owner chooses.",
    primary: "Compare and decide",
    secondary: ["Open the topic"],
    alert: {
      rule: "disagree",
      name: "Conflict",
      href: "/observability/questions?dock=topic.orders-norway",
      pair: "itm_gift_store_credit.itm_gift_card_only",
    },
  },
  {
    id: "check-returns",
    type: "check",
    domain: "sales",
    for: "Jon Abara",
    when: "Since 2 Oct",
    title: "Returns changed definition on 28 April 2026",
    line: "Its check date passed on 2 Oct. Agents are told it may be out of date.",
    detail: "Last checked by you, 2 Jul 2026.",
    primary: "Still true",
    secondary: ["Edit", "Archive"],
    factId: "itm_ra39ow6c",
  },
  {
    id: "check-margin",
    type: "check",
    domain: "sales",
    for: "Jon Abara",
    when: "Since 7 Oct",
    title: "What to rule out before explaining a jump in Gross margin",
    line: `${DEFINITIONS_TOOL} changed the definition of Gross margin on 7 Oct, after this context item was checked.`,
    detail: "Last checked by Sofia Brandt, 30 Sep 2026.",
    primary: "Still true",
    secondary: ["Edit", "Archive"],
    factId: "itm_kcy22j54",
  },
  {
    id: "sug-jon",
    type: "suggestion",
    domain: "marketing",
    for: "Tomas Eriksen",
    when: "20 Oct",
    title: "Norway launch campaign started on 24 March 2026",
    line: "A change from Jon Abara, written in the editor.",
    detail: "Adds that the campaign budget is held until 19 November 2026.",
    primary: "Review",
    secondary: [],
    factId: campaign.id,
    suggestion: {
      factId: campaign.id,
      from: "Jon Abara",
      via: "editor",
      on: "20 Oct 2026",
      note: "Finance asked about the held budget twice this month.",
      changes: [
        {
          label: "What agents should know",
          before: campaign.summary,
          after: `${campaign.summary} Its budget is held until 19 November 2026.`,
        },
        { label: "Kind", before: kindLabel.event, after: kindLabel.event },
        { label: "Where", before: "Return on ad spend · Norway", after: "Return on ad spend · Norway" },
        { label: "When", before: campaign.when, after: campaign.when },
        { label: "Source", before: campaign.source, after: campaign.source },
        { label: "Don't conclude", before: campaign.dontConclude, after: campaign.dontConclude },
      ],
      draft: { ...campaign, summary: `${campaign.summary} Its budget is held until 19 November 2026.` },
    },
  },
  {
    id: "check-italy",
    type: "check",
    domain: "marketing",
    for: "Tomas Eriksen",
    when: "Since 18 Sep",
    title: "Regulator paused price promotions in Italy on 18 April 2026",
    line: "Its check date passed on 18 Sep. Agents are told it may be out of date.",
    detail: "Last checked by you, 20 Jun 2026.",
    primary: "Still true",
    secondary: ["Edit", "Archive"],
    factId: "itm_pfet8zj3",
  },
]

/* More suggestions waiting for Jon, one for each state the full-screen review shows. */
const when: Record<string, string> = {
  "sug-ines-format": "Today, 09:12",
  "sug-ines-link": "Today, 09:12",
  "sug-ines-order": "Today, 09:12",
  "sug-ines-long": "Today, 09:12",
  "sug-ines-dates": "Today, 09:12",
  "sug-sofia-clash": "Today, 08:30",
  // Returned with a note yesterday; Lars answered in the comments this morning, so it is back.
  "sug-lars-retire": "Today, 08:50",
  "drive-marketplace": "Today, 06:00",
  "drive-bundles": "Today, 06:00",
}
const extra: InboxCard[] = []
for (const r of reviews.filter((r) => when[r.id])) {
  const fact = r.retire ? factById(r.retire.factId) : r.mode === "edit" ? facts.find((f) => f.title === r.title) : undefined
  extra.push({
    id: r.id,
    type: "suggestion",
    domain: "sales",
    for: "Jon Abara",
    when: when[r.id],
    title: r.title,
    source: r.synced ? { tool: r.synced.tool, folder: r.synced.folder, doc: r.synced.doc, read: r.synced.read } : undefined,
    line: r.synced ? `New context from ${r.synced.tool}: ${r.synced.doc}.` : r.mode === "retire" ? `${r.from} suggests archiving it.` : r.mode === "new" ? `New context from ${r.from}.` : `A change from ${r.from}, from ${r.via}.`,
    detail: r.summary,
    primary: "Review",
    secondary: [],
    factId: fact?.id,
    suggestion: {
      factId: fact?.id,
      from: r.from,
      via: r.via,
      on: r.on,
      note: r.note,
      changes: [],
      draft: fact
        ? { ...fact, summary: r.source.after.split("\n")[0] || fact.summary, status: r.mode === "retire" ? "Archived" : fact.status }
        : {
            ...facts[0],
            id: `draft_${r.id}`,
            title: r.title,
            summary: r.source.after,
            // Where and when come from what the review pulled out: "New: Orders, Germany", "From: 15 Oct 2026".
            where: r.moved.find((m) => m.label === "New")?.after.split(", ") ?? ["Orders"],
            when: (w => (w ? `From ${w}, still going on` : "Always"))(r.moved.find((m) => m.label === "From")?.after),
            kind: "note",
          },
    },
  })
}
// Newest first, as the Inbox says: today's after Ines's first change, yesterday's after the agent's.
cards.splice(1, 0, ...extra.filter((c) => c.when.startsWith("Today") && !c.source).sort((a, b) => b.when.localeCompare(a.when)))
// Suggestions from a sync sit together, under one header per read.
cards.splice(cards.findIndex((c) => c.id === "sug-sofia-clash") + 1, 0, ...extra.filter((c) => c.source))
cards.splice(cards.findIndex((c) => c.id === "sug-agent") + 1, 0, ...extra.filter((c) => !c.when.startsWith("Today")))

export const waiting: Waiting[] = [
  {
    id: "wait-jon",
    for: "Jon Abara",
    title: "Norway launch campaign started on 24 March 2026",
    waitingFor: "Tomas Eriksen, owner of Marketing",
    domain: "marketing",
    sent: "20 Oct",
    card: "sug-jon",
  },
  {
    id: "wait-ines",
    for: "Ines Duarte",
    title: "Units sold excludes test accounts",
    waitingFor: "Jon Abara, owner of Sales",
    domain: "sales",
    sent: "Today",
    card: "sug-ines",
  },
]

export type SetupStep = { id: string; title: string; description: string; action: string }

/** Write first, connect later: value in about ten actions, connectors when they help. */
export const setupSteps: SetupStep[] = [
  {
    id: "about",
    title: "Say what the business is about",
    description: "Paste a paragraph or write a few lines. Every agent reads it first.",
    action: "Write",
  },
  {
    id: "fact",
    title: "Write your first context item",
    description: "Two sentences and a source. You own the domain Company, so it goes live at once.",
    action: "Write context",
  },
  {
    id: "ask",
    title: "Ask a question about it",
    description: "See the answer an agent gets, from what you just wrote.",
    action: "Ask",
  },
  {
    id: "agent",
    title: "Connect your agent",
    description: "Paste one prompt into Claude, Cursor or another agent, and approve it once.",
    action: "Copy the prompt",
  },
  {
    id: "definitions",
    title: "Connect your definitions",
    description: "Connect where your metrics are defined, so their names arrive by themselves. It can wait.",
    action: "Connect",
  },
]
