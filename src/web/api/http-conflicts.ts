import type {
  ConflictDecision as ServiceDecision,
  ConflictRow as ServiceRow,
  ConflictSide as ServiceSide,
  ConflictView as ServiceView,
} from '@contract/conflicts'
import type { AnswerState } from '@/model/ask'
import type { Conflict, ConflictDecision, ConflictRow, ConflictSide, Said } from '@/model/conflicts'
import type { Kind } from '@/model/items'
import { dateLabel } from '@/model/validity'

// Conflicts as the service answers them (src/contract/conflicts.ts), in the app's words: names for
// ids, short dates, and what agents say as Try it shows it.

type Lookup = { person: (id: string) => string }

const kindOf = (kind: string): Kind =>
  kind === 'event' || kind === 'issue' || kind === 'note' || kind === 'guide' ? kind : 'note'

/** The clock time of a decision, as the outcome line says it. */
const timeOf = (at: string) =>
  new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function decisionOf(d: ServiceDecision, names: Lookup): ConflictDecision {
  return {
    outcome: d.outcome,
    keptId: d.keptId,
    reason: d.reason,
    quote: d.quote,
    by: names.person(d.personId),
    at: timeOf(d.at),
  }
}

function sideOf(s: ServiceSide, names: Lookup): ConflictSide {
  return {
    id: s.id,
    readable: s.readable,
    title: s.title,
    summary: s.summary,
    kind: kindOf(s.kind),
    domain: s.area.id,
    domainName: s.area.name,
    owners: s.owners.map((o) => o.name || names.person(o.id)),
    version: s.version,
    checkedOn: s.checked ? dateLabel(s.checked.on) : null,
    checkedBy: s.checked?.personId ? names.person(s.checked.personId) : null,
    source: s.source,
  }
}

const said = (a: { state: AnswerState; say: string }): Said => ({ state: a.state, text: a.say })

/** A pair as the conflict view reads it; `where` names what both apply to, from the service's keys. */
export function conflictOf(v: ServiceView, names: Lookup, where: string[]): Conflict {
  return {
    key: v.key,
    holder: sideOf(v.holder, names),
    other: sideOf(v.other, names),
    topic: v.topic,
    where,
    asked: v.asked,
    since: v.since ? dateLabel(v.since) : null,
    said: v.said
      ? {
          now: said(v.said.now),
          onlyHolder: said(v.said.onlyHolder),
          onlyOther: said(v.said.onlyOther),
          withoutFlag: said(v.said.withoutFlag),
        }
      : null,
    rights: v.rights,
    keptBoth: v.keptBoth ? decisionOf(v.keptBoth, names) : null,
  }
}

export function conflictRowOf(r: ServiceRow): ConflictRow {
  return {
    key: r.key,
    holder: { id: r.holder.id, title: r.holder.title, domain: r.holder.areaId },
    other: { id: r.other.id, title: r.other.title, domain: r.other.areaId },
    topic: r.topic,
    asked: r.asked,
    since: r.since ? dateLabel(r.since) : null,
    canSettle: r.canSettle,
    mine: r.mine,
  }
}
