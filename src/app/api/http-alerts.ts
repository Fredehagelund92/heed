/**
 * Alerts on the http binding (FR-621): the service's rules and raises as the Alerts page reads
 * them. The rules' sentences are the domain's (src/domain/alerts.ts), so the page says what the
 * service does; the service says which are on, at what threshold, what the person muted, and what
 * each raised lately, already narrowed to what the person may read.
 */
import type { AlertRaise, AlertRules } from '@contract/alerts'
import { raisedLine, type RaiseSubject } from '@domain/alerts'
import { ruleWords, type Alerts, type Raised, type Rule } from '@/model/alerts'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * When a rule raised, in the reader's own time zone, as the Alerts page writes it: "Today, 09:41",
 * "Yesterday, 18:02", "Tue 20 Oct", and the year when it is another year's.
 */
export function raisedWhen(iso: string, now: Date): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  const date = `${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`
  return at.getFullYear() === now.getFullYear() ? date : `${date} ${at.getFullYear()}`
}

/** Where a raise sends people in the app: its card in the Inbox, or the page it is about. */
export function hrefOf(subject: RaiseSubject): string {
  if ('card' in subject) return `/inbox?card=${subject.card}`
  if ('topic' in subject) return `/observability/questions?dock=topic.${subject.topic}`
  if ('connector' in subject) return `/settings/integrations/${subject.connector}`
  return `/observability/${subject.page}`
}

/** A raise as the page lists it: what, whom it reached, when, and where it sends people. */
export function raisedOf(r: AlertRaise, now: Date): Raised {
  return {
    id: r.id,
    rule: r.rule,
    title: r.title,
    line: raisedLine(r.rule, r.reached),
    when: raisedWhen(r.raisedAt, now),
    ...(r.areaIds.length === 1 ? { domain: r.areaIds[0]! } : {}),
    href: hrefOf(r.subject),
  }
}

/** The rules and what they raised lately, with what people changed, as the page reads them. */
export function alertsOf(rules: AlertRules, raised: readonly AlertRaise[], now: Date): Alerts {
  return {
    rules: rules.rules.map((record): Rule => ({
      ...ruleWords(record.rule, record.threshold),
      // The service gives the newest raise the person may read, so it needs no narrowing here.
      last: record.last ? raisedWhen(record.last.raisedAt, now) : 'Never',
      ...(record.last ? { lastHref: hrefOf(record.last.subject) } : {}),
    })),
    raised: raised.map((r) => raisedOf(r, now)),
    settings: {
      off: rules.rules.filter((r) => !r.enabled).map((r) => r.rule),
      muted: Object.fromEntries(
        rules.rules.filter((r) => r.mutedFor.length).map((r) => [r.rule, r.mutedFor]),
      ),
      thresholds: {},
    },
  }
}
