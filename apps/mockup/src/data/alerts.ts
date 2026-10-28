import * as React from "react"
import { DEFINITIONS_TOOL } from "@/data/integrations"
import type { DomainId } from "@/data/world"

// Alerts: rules, each one sentence, that raise a card in the Inbox. Nothing emails and nothing rings:
// a raised alert is a card with the same Review and Undo as any other. Three rules exist already
// (Not found, a tool did not sync, a check is due), one comes with saved questions, four are new.
// Owners see and mute the rules that reach them, for their own domains; admins turn rules off and
// change the thresholds.

export type RuleId = "gap" | "saved" | "disagree" | "share" | "fail" | "spend" | "sync" | "due"

/** Who a rule's card goes to: the owners of the domain, the admins, or both. */
export type Audience = "owners" | "admins" | "both"

export type Rule = {
  id: RuleId
  name: string
  /** When it fires, one sentence; `{n}` is the threshold an admin can change. */
  when: string
  /** What happens: where the card goes. */
  then: string
  audience: Audience
  /** New with this area; the others exist in the app already. */
  isNew?: boolean
  /** The threshold's choices, the first sentence part it fills, and its setting's name in Limits. */
  threshold?: { value: string; choices: string[]; setting?: string }
  last: string
  /** Where the last one raised went: its Inbox card, or what it was about. */
  lastHref?: string
  /** The domain the last one was about; an owner of another domain sees their own last one, or Never. */
  lastDomain?: DomainId
  /** The last one in another domain, as its owners see it. */
  lastIn?: Partial<Record<DomainId, { last: string; href: string }>>
}

export const RULES: Rule[] = [
  {
    id: "gap",
    name: "Not found",
    when: "{n} or more times in 7 days about the same thing, even across a month edge",
    then: "A Not found card to the owners",
    audience: "owners",
    threshold: { value: "5", choices: ["3", "5", "10"], setting: "gaps.no_item_threshold" },
    last: "Today, Orders in Germany",
    lastHref: "#/inbox?card=gap-germany",
    lastDomain: "sales",
  },
  {
    id: "saved",
    name: "A saved question needs a look",
    when: "After a publish, an archive, a restore, a sync, or a check date passing",
    then: "A card to the owners of the domain",
    audience: "owners",
    last: "Today, 2 questions",
    lastHref: "#/inbox?card=look-sales",
    lastDomain: "sales",
  },
  {
    id: "disagree",
    name: "Conflict",
    when: "Two items that apply say different things, asked {n} or more times",
    then: "A card to the owners",
    audience: "owners",
    isNew: true,
    threshold: { value: "3", choices: ["2", "3", "5"] },
    last: "Tue 20 Oct",
    lastHref: "#/inbox?card=alert-net-revenue",
    lastDomain: "sales",
  },
  {
    id: "share",
    name: "More questions not found",
    when: "More than {n} of a day's questions, two days running",
    then: "A line on Overview and a card to admins",
    audience: "admins",
    isNew: true,
    threshold: { value: "20%", choices: ["10%", "20%", "30%"] },
    last: "Never",
  },
  {
    id: "fail",
    name: "Calls fail",
    when: "More than {n} of a day's calls could not be read or failed",
    then: "A card to admins",
    audience: "admins",
    isNew: true,
    threshold: { value: "5%", choices: ["2%", "5%", "10%"] },
    last: "Never",
  },
  {
    id: "spend",
    name: "Model spend",
    when: "Reaches {n} of the monthly cap",
    then: "A card to admins",
    audience: "admins",
    isNew: true,
    threshold: { value: "80%", choices: ["50%", "80%", "100%"] },
    last: "Never",
  },
  {
    id: "sync",
    name: "A connected tool did not sync",
    when: "A read failed or is overdue",
    then: "A card to admins and the owners",
    audience: "both",
    last: "Fri 9 Oct",
    lastHref: "#/settings/integrations/cube",
  },
  {
    id: "due",
    name: "A check is due",
    when: "A check date is reached",
    then: "A reminder to the owner at 07:00",
    audience: "owners",
    last: "Today, 2 items",
    lastHref: "#/inbox?card=check-returns",
    lastDomain: "sales",
    lastIn: { marketing: { last: "Fri 18 Sep, 1 item", href: "#/inbox?card=check-italy" } },
  },
]

/** What was raised lately, newest first, each with the card it raised. */
export type Raised = { id: string; rule: RuleId; title: string; line: string; when: string; domain?: DomainId; href: string }

export const RAISED: Raised[] = [
  {
    id: "r-look",
    rule: "saved",
    title: "2 saved questions need a look",
    line: "One after Payment provider switched in Norway was archived, one after a check date passed. A card went to Jon Abara and Sofia Brandt.",
    when: "Today, 09:41",
    domain: "sales",
    href: "#/inbox?card=look-sales",
  },
  {
    id: "r-germany",
    rule: "gap",
    title: "Orders in Germany: not found, 6 times across a month edge",
    line: "3 calls about 30 October and 3 about 1 November, counted together. A Not found card went to Jon Abara and Sofia Brandt.",
    when: "Today, 06:20",
    domain: "sales",
    href: "#/inbox?card=gap-germany",
  },
  {
    id: "r-spain",
    rule: "gap",
    title: "Orders in Spain: not found, 9 times",
    line: "A Not found card went to Jon Abara and Sofia Brandt.",
    when: "Today, 06:05",
    domain: "sales",
    href: "#/inbox?card=gap-spain",
  },
  {
    id: "r-net-revenue",
    rule: "disagree",
    title: "Net revenue in Norway: conflict, 3 times",
    line: "A card went to Jon Abara and Sofia Brandt.",
    when: "Tue 20 Oct",
    domain: "sales",
    href: "#/inbox?card=alert-net-revenue",
  },
  {
    id: "r-cube",
    rule: "sync",
    title: `${DEFINITIONS_TOOL} did not sync`,
    line: "A card went to the admins. It synced again at 06:00.",
    when: "Fri 9 Oct",
    href: "#/settings/integrations/cube",
  },
  {
    id: "r-italy",
    rule: "due",
    title: "Regulator paused price promotions in Italy: its check date passed",
    line: "A reminder went to Tomas Eriksen at 07:00.",
    when: "Fri 18 Sep",
    domain: "marketing",
    href: "#/inbox?card=check-italy",
  },
]

/* ---------- what people changed: rules off, muted domains, thresholds ---------- */

type State = { off: RuleId[]; muted: Partial<Record<RuleId, DomainId[]>>; thresholds: Partial<Record<RuleId, string>> }

let state: State = { off: [], muted: {}, thresholds: {} }
const listeners = new Set<() => void>()
const set = (next: State) => {
  state = next
  listeners.forEach((l) => l())
}

export function useAlerts() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

/** An admin turns a rule on or off for everyone. */
export function setRuleOn(id: RuleId, on: boolean) {
  set({ ...state, off: on ? state.off.filter((x) => x !== id) : [...state.off, id] })
}

/** An owner mutes a rule for their domains: its cards stop reaching them, not anyone else. */
export function setMuted(id: RuleId, domains: DomainId[], muted: boolean) {
  const was = state.muted[id] ?? []
  set({ ...state, muted: { ...state.muted, [id]: muted ? [...new Set([...was, ...domains])] : was.filter((d) => !domains.includes(d)) } })
}

export function setThreshold(id: RuleId, value: string) {
  set({ ...state, thresholds: { ...state.thresholds, [id]: value } })
}

/** A rule's last raise as someone sees it: an owner sees only their own domains'. */
export function lastOf(r: Rule, owned: DomainId[] | null) {
  if (!owned || !r.lastDomain || owned.includes(r.lastDomain)) return { last: r.last, href: r.lastHref }
  const mine = owned.map((d) => r.lastIn?.[d]).find(Boolean)
  return mine ?? { last: "Never", href: undefined }
}

export const thresholdOf = (r: Rule, s: State = state) => s.thresholds[r.id] ?? r.threshold?.value

/** Owners see the rules that reach owners; admins see all eight. */
export const rulesFor = (admin: boolean) => (admin ? RULES : RULES.filter((r) => r.audience !== "admins"))
