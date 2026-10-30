import { alertRule, thresholdWords, type AlertAudience, type AlertRuleId } from '@domain/alerts'
import type { DomainId } from './items'

// Alerts as the app reads them (src/web/api): rules, each one sentence, that raise a card in the
// Inbox. Nothing emails and nothing rings: a raised alert is a card with the same Review and Undo as
// any other. Owners see and mute the rules that reach them, for their own domains; admins turn rules
// off and change the thresholds.

export type RuleId = AlertRuleId

/** Who a rule's card goes to: the owners of the domain, the admins, or both. */
export type Audience = AlertAudience

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

/** What was raised lately, newest first, each with the card it raised. */
export type Raised = {
  id: string
  rule: RuleId
  title: string
  line: string
  when: string
  domain?: DomainId
  href: string
}

/** What people changed: rules turned off, domains muted per rule, thresholds. */
export type AlertSettings = {
  off: RuleId[]
  muted: Partial<Record<RuleId, DomainId[]>>
  thresholds: Partial<Record<RuleId, string>>
}

/** The rules, what they raised lately, and what people changed. */
export type Alerts = { rules: Rule[]; raised: Raised[]; settings: AlertSettings }

/** A rule's last raise as someone sees it: an owner sees only their own domains'. */
export function lastOf(r: Rule, owned: DomainId[] | null) {
  if (!owned || !r.lastDomain || owned.includes(r.lastDomain))
    return { last: r.last, href: r.lastHref }
  const mine = owned.map((d) => r.lastIn?.[d]).find(Boolean)
  return mine ?? { last: 'Never', href: undefined }
}

export const thresholdOf = (r: Rule, s: AlertSettings) => s.thresholds[r.id] ?? r.threshold?.value

/** Owners see the rules that reach owners; admins see all eight. */
export const rulesFor = (rules: Rule[], admin: boolean) =>
  admin ? rules : rules.filter((r) => r.audience !== 'admins')

/**
 * A rule's sentence and threshold, in the domain's words (src/domain/alerts.ts), which the service
 * says too; `threshold` is the one it fires at now, the rule's first one when left out.
 */
export function ruleWords(
  id: RuleId,
  threshold?: number | null,
): Pick<Rule, 'id' | 'name' | 'when' | 'then' | 'audience' | 'isNew' | 'threshold'> {
  const r = alertRule(id)
  const t = r.threshold
  return {
    id,
    name: r.name,
    when: r.when,
    then: r.then,
    audience: r.audience,
    ...(r.isNew ? { isNew: true } : {}),
    ...(t
      ? {
          threshold: {
            value: thresholdWords(threshold ?? t.initial, t.unit),
            choices: t.choices.map((c) => thresholdWords(c, t.unit)),
            ...(t.setting ? { setting: t.setting } : {}),
          },
        }
      : {}),
  }
}
