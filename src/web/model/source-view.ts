import { sourceHealth } from '@domain/source-state'
import {
  firstReadWords,
  type ConnectorKind,
  type Health,
  type Source,
  type When,
} from './integrations'

// What a connected tool's page says of it, from one value: its kind and its state, with the facts
// the words need (when it was read, what it holds). Every cell of kind, intent, pending read and
// last read has words chosen on purpose, so no combination falls through to another's: a failed
// read is never "in part" or "0 documents looked at", and a refused key is never "paused".

/** A number of the page, under its label. */
export type SourceNumber = { label: string; value: string; sub: string; tone?: 'warn' | 'bad' }

/**
 * The note under a tool's head: its last read failed; its key was refused, and when it is tried
 * again; or it is paused, in words that say what its last read was.
 */
export type SourceBanner =
  { kind: 'failed' } | { kind: 'refused'; retry: string } | { kind: 'paused'; words: string }

export type SourceView = {
  health: Health
  /** A read the page waits on, shown beside the health. */
  pending: 'queued' | 'reading' | null
  banner: SourceBanner | null
  numbers: [SourceNumber, SourceNumber, SourceNumber, SourceNumber]
}

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`

/** "Today" stays "07:00"; another day is the day. */
const dayOrTime = (at: When) => (at.day === 'Today' ? at.time : at.day)

/** When a tool whose key was refused is tried again: "at 11:00", "on 24 Oct at 06:00", "now". */
function retryWords(state: Extract<Source['state'], { intent: 'active' }>) {
  if (state.read === 'reading') return 'It is being tried again now.'
  if (state.read === 'queued') return "It is tried again at the job's next turn."
  const { day, time } = state.next
  if (day === 'Today') return `It is tried again at ${time}.`
  return `It is tried again ${day === 'Tomorrow' ? 'tomorrow' : `on ${day}`} at ${time}.`
}

export function sourceView(
  kind: ConnectorKind,
  source: Source,
  /** The last day a definitions read changed definitions ("7 Oct"). */
  changedOn: string | null,
): SourceView {
  const { state } = source
  const active = state.intent === 'active' ? state : null
  const failed = state.last === 'failed' || state.last === 'refused'

  const banner: SourceBanner | null =
    state.intent === 'paused'
      ? {
          kind: 'paused',
          words:
            state.last === 'never'
              ? 'Paused before its first read.'
              : state.last === 'failed'
                ? `Paused. Its last read failed: ${source.failure ?? "it couldn't be read"}.`
                : state.last === 'refused'
                  ? 'Paused. It will need a new key.'
                  : 'Reading is paused.',
        }
      : state.last === 'failed'
        ? { kind: 'failed' }
        : state.last === 'refused'
          ? { kind: 'refused', retry: retryWords(state) }
          : null

  const last = source.last
  const lastNumber: SourceNumber =
    state.last === 'never'
      ? { label: 'Last read', value: 'Not yet', sub: `first read ${firstReadWords(state)}` }
      : state.last === 'refused'
        ? {
            label: 'Last read',
            value: last ? `${last.at.day}, ${last.at.time}` : 'Not yet',
            sub: 'refused: it needs a new key',
            tone: 'warn',
          }
        : state.last === 'failed'
          ? {
              label: 'Last good read',
              value: source.lastGood?.day ?? 'None',
              sub: source.lastGood
                ? `${source.lastGood.time}${source.lastGood.ago ? `, ${source.lastGood.ago}` : ''}`
                : 'not read yet',
              tone: 'bad',
            }
          : {
              label: 'Last read',
              value: last ? `${last.at.day}, ${last.at.time}` : 'Not yet',
              sub:
                kind === 'definitions'
                  ? `${state.last === 'ok' ? 'complete' : 'in part'}${last?.seconds == null ? '' : `, ${last.seconds} s`}`
                  : `${count(last?.seen ?? 0, 'document', 'documents')} looked at`,
            }

  const label = failed ? 'Next try' : 'Next read'
  const nextNumber: SourceNumber = !active
    ? { label, value: 'Paused', sub: source.every }
    : active.read === 'reading'
      ? { label, value: 'Now', sub: 'being read' }
      : active.read === 'queued'
        ? { label, value: 'Queued', sub: 'waiting for the job' }
        : {
            label,
            value: dayOrTime(active.next),
            sub:
              active.retry === 'backoff'
                ? 'backing off'
                : active.next.day === 'Today'
                  ? source.every
                  : `${active.next.time}, ${source.every}`,
          }

  const d = source.definitions
  const docs = source.documents
  const counts: [SourceNumber, SourceNumber] = d
    ? active?.last === 'failed'
      ? [
          { label: 'Definitions', value: String(d.metrics + d.dimensions), sub: 'as last read' },
          {
            label: 'Context affected',
            value: String(d.flagged),
            sub: d.flagged ? 'flagged' : 'none flagged',
          },
        ]
      : [
          {
            label: 'Definitions',
            value: String(d.metrics + d.dimensions),
            sub: `${count(d.metrics, 'metric', 'metrics')}, ${count(d.dimensions, 'dimension', 'dimensions')}`,
          },
          {
            label: 'Context to check',
            value: String(d.flagged),
            sub: d.flagged
              ? changedOn
                ? `after the ${changedOn} changes`
                : 'after a change'
              : 'none flagged',
          },
        ]
    : [
        {
          label: 'Suggestions waiting',
          value: String(docs?.waiting ?? 0),
          sub: docs?.waiting ? `for ${count(docs.domains, 'domain', 'domains')}` : 'none yet',
        },
        {
          label: 'Drafts today',
          value: `${docs?.madeToday ?? 0} of ${docs?.perDay ?? 0}`,
          sub: 'the daily cap',
        },
      ]

  return {
    health: sourceHealth(state),
    pending: active && active.read !== 'scheduled' ? active.read : null,
    banner,
    numbers: [lastNumber, nextNumber, ...counts],
  }
}

/**
 * What a read that ended says, once, by how it went: "Read Cube" with what it found, or "Couldn't
 * read Cube" with why. `detail` is the read's line in Activity.
 */
export function readEndedWords(
  name: string,
  last: Source['state']['last'],
  detail: string | undefined,
): { title: string; description?: string } {
  const title = last === 'failed' || last === 'refused' ? `Couldn't read ${name}` : `Read ${name}`
  if (!detail) return { title }
  return { title, description: /[.!?]$/.test(detail) ? detail : `${detail}.` }
}
