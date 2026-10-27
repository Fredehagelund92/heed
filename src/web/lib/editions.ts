/**
 * Editions and delivery in the person's words: what made an edition, what changed in it, what
 * going back does and what a stop switch stops (FR-215, FR-217, FR-805). Pure functions, so the
 * screens, the dialogs and the unit tests read the same sentences.
 */
import type { EditionChangeKind } from '@domain/editions'
import type { ActiveStop, AuditEntry, Edition, EditionComparison } from '@/api'
import { formatDay, formatMoment } from '@/lib/library'

/** An edition number: the day it was sealed and its place in that day (`2026-10-07.2`). */
export type EditionLabelParts = { day: string; number: number }

/** Reads an edition number; null for anything that is not one. */
export function parseEditionLabel(label: string): EditionLabelParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})\.([1-9]\d*)$/.exec(label.trim())
  if (!match) return null
  const [, year, month, day, number] = match
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`)
  // 2026-02-30 is not a day: the date must read back as itself.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`)
    return null
  return { day: `${year}-${month}-${day}`, number: Number(number) }
}

/** The day an edition was saved, as people read it: "7 October 2026"; null for anything else. */
export function editionDay(label: string): string | null {
  const parts = parseEditionLabel(label)
  return parts ? formatDay(parts.day, 'long') : null
}

const reasonWords: Record<string, string> = {
  bootstrap: 'First edition',
  proposal_accepted: 'Proposal accepted',
  item_retired: 'Fact archived',
  vocabulary_changed: 'Names changed',
  // Editions from before every domain was served (14 Oct 2026) may have moved a domain's state.
  area_state_changed: 'Domain state changed',
  area_map_changed: 'Domains mapped again',
  source_rechecked: 'Checked, still correct',
  item_restored: 'Restored from the Bin',
  area_deleted: 'Domain deleted',
  area_restored: 'Domain restored',
  decision_undone: 'A decision undone',
  rollback: 'Went back',
}

/** What made an edition, in a few words: "Proposal accepted", "Went back to 2026-10-06.2". */
export function editionReason(edition: Pick<Edition, 'reason' | 'restores'>): string {
  if (edition.reason === 'rollback' && edition.restores) return `Went back to ${edition.restores}`
  return reasonWords[edition.reason] ?? 'Other change'
}

/** The versions of a change: "Version 1, new", "Version 2 to 3", "Was version 4". */
export function versionWords(change: { from: number | null; to: number | null }): string {
  if (change.from === null) return change.to === 1 ? 'Version 1, new' : `Version ${change.to}`
  if (change.to === null) return `Was version ${change.from}`
  return `Version ${change.from} to ${change.to}`
}

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`

// ---- going back (FR-217; Editions design, slice S5) ----

/** One fact in the comparison of the live edition with the edition to go back to. */
type GoingBack = {
  change: EditionChangeKind
  from: { version: number } | null
  to: { version: number } | null
}

/**
 * What going back does to one item, read from the live edition compared backwards with the
 * target: it stops being served, comes back, or returns to the version the target served.
 */
export function goBackEffect(item: GoingBack): string {
  switch (item.change) {
    case 'added':
      return 'Comes back'
    case 'removed':
    case 'retired':
      return 'Stops being shared'
    case 'changed':
      return item.from && item.to
        ? `Version ${item.from.version} returns to version ${item.to.version}`
        : 'Returns to an earlier version'
    case 'resaved':
      return 'Earlier save, nothing different'
    case 'checked':
      return 'Earlier check, same content'
  }
}

/** The order the preview lists its items in: what agents lose or get back first. */
export const goBackOrder: readonly EditionChangeKind[] = [
  'removed',
  'retired',
  'added',
  'changed',
  'checked',
  'resaved',
]

type GoBackCounts = Pick<EditionComparison, 'facets' | 'vocabulary' | 'withheld'>

/**
 * What going back changes for agents, in one or two sentences from the comparison's counts:
 * "38 facts change for agents: 23 stop being shared, 1 returns to an earlier version and 14 go
 * back to an earlier save with nothing different."
 */
export function goBackSummary(comparison: GoBackCounts): string {
  const counts = comparison.facets.change
  const parts = [
    counts.removed + counts.retired
      ? plural(counts.removed + counts.retired, 'stops being shared', 'stop being shared')
      : '',
    counts.added ? plural(counts.added, 'comes back', 'come back') : '',
    counts.changed
      ? plural(counts.changed, 'returns to an earlier version', 'return to an earlier version')
      : '',
    counts.checked
      ? plural(counts.checked, 'goes back to an earlier check', 'go back to an earlier check')
      : '',
    counts.resaved
      ? plural(
          counts.resaved,
          'goes back to an earlier save with nothing different',
          'go back to an earlier save with nothing different',
        )
      : '',
  ].filter(Boolean)
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const items = total
    ? `${plural(total, 'fact changes', 'facts change')} for agents: ${listWords(parts)}.`
    : 'Nothing changes for agents.'
  const also = comparison.vocabulary
    ? ` ${plural(comparison.vocabulary, 'name of a metric, market or product goes', 'names of metrics, markets or products go')} back too.`
    : ''
  const withheld = comparison.withheld
    ? ` ${plural(comparison.withheld, 'fact only some groups can see changes', 'facts only some groups can see change')} too, and ${comparison.withheld === 1 ? "isn't" : "aren't"} shown here.`
    : ''
  return `${items}${also}${withheld}`
}

/** "a", "a and b", "a, b and c". */
function listWords(parts: readonly string[]): string {
  if (parts.length < 2) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/** Why a version can't be shared again, from the database's reason (FR-205), in plain words. */
export function blockedProblem(problem: string): string {
  switch (problem) {
    case 'no accept decision by an owner or deputy of the area':
      return 'No owner of its domain accepted this version.'
    case 'high risk needs an accept decision by a named approver':
      return "It's high risk, and no approver accepted this version."
    case 'a required check has not passed':
      return "A check this version needs hasn't passed."
    case 'a recheck must keep the content of the version it checks':
      return 'It was marked as checked, but its content differs from the version that was checked.'
    default:
      return `${problem.charAt(0).toUpperCase()}${problem.slice(1)}${problem.endsWith('.') ? '' : '.'}`
  }
}

/** How many versions stop going back: "One of its fact versions can't be shared again." */
function blockedCount(blocked: number): string {
  return blocked === 1
    ? "One of its fact versions can't be shared with agents again."
    : `${blocked.toLocaleString('en')} of its fact versions can't be shared with agents again.`
}

/** The refusal when going back can't go ahead, as the error the service's refusal becomes. */
export function goBackRefusal(target: string, blocked: number): string {
  return `You can't go back to edition ${target}. ${blockedCount(blocked)} Nothing has changed.`
}

/** Under "You can't go back to this edition": why, and that agents keep what they get today. */
export function goBackBlocked(blocked: number, live: string): string {
  return `${blockedCount(blocked)} Nothing has changed: agents still get edition ${live}.`
}

/** What a stop applies to, as the person sees it. */
export type StopTarget = { scope: ActiveStop['scope']; areaName?: string; itemTitle?: string }

/** "everything", "Commercial", "the fact "Net revenue excludes test accounts"". */
export function stopTargetWords(target: StopTarget): string {
  if (target.scope === 'all') return 'everything'
  if (target.scope === 'area') return target.areaName ?? 'one domain'
  return target.itemTitle ? `the fact "${target.itemTitle}"` : 'one fact'
}

/** The words to type before a stop: the domain's name, or "everything". A fact needs none. */
export function stopConfirmText(target: StopTarget): string | undefined {
  if (target.scope === 'all') return 'everything'
  if (target.scope === 'area') return target.areaName
  return undefined
}

/** When a stop reaches agents: "Within a minute, agents get no facts from Commercial." */
export function stopNow(target: StopTarget): string {
  return target.scope === 'all'
    ? 'Within a minute, agents get no facts at all.'
    : target.scope === 'area'
      ? `Within a minute, agents get no facts from ${target.areaName ?? 'this domain'}.`
      : `Within a minute, agents no longer get ${stopTargetWords(target)}.`
}

/** What stopping does, and how to undo it, in two sentences (contract 9.4). */
export function stopEffect(target: StopTarget): string {
  return `${stopNow(target)} Nothing is lost, and you can start again at any time.`
}

/** What starting again does. */
export function resumeEffect(target: StopTarget): string {
  return target.scope === 'all'
    ? 'Within a minute, agents get every fact again.'
    : target.scope === 'area'
      ? `Within a minute, agents get the facts from ${target.areaName ?? 'this domain'} again.`
      : `Within a minute, agents get ${stopTargetWords(target)} again.`
}

/**
 * The banner's sentence for one stop, which everyone signed in reads on every page, so it never
 * names an edition: "Agents get no facts from Commercial for now."
 */
export function stopHeadline(target: StopTarget): string {
  return target.scope === 'all'
    ? 'Agents get no facts for now.'
    : target.scope === 'area'
      ? `Agents get no facts from ${target.areaName ?? 'one domain'} for now.`
      : `Agents don't get ${stopTargetWords(target)} for now.`
}

/**
 * How far a stop reaches, from the facts agents get today: "Agents stop getting the 328 facts
 * in Commercial. Other domains stay as they are."
 */
export function stopReach(target: StopTarget, served: number | undefined): string {
  if (target.scope === 'item')
    return 'Agents stop getting only this fact. They still get every other fact.'
  const area = target.areaName ?? 'this domain'
  if (served === undefined)
    return target.scope === 'all'
      ? 'Agents stop getting every fact, in every domain.'
      : `Agents stop getting every fact in ${area}. Other domains stay as they are.`
  const facts = served === 1 ? 'the one fact' : `the ${plural(served, 'fact', 'facts')}`
  if (target.scope === 'all') return `Agents stop getting ${facts}, in every domain.`
  return `Agents stop getting ${facts} in ${area}. Other domains stay as they are.`
}

/** What people see while a stop is on: the stop is for agents only. */
export const stopReaders =
  'People still read these facts in the Library. Everyone signed in sees a banner about the stop.'

/** What people see after going back: what agents get, as the target had it. */
export const goBackReaders =
  "Agents and everyone reading the Library get these facts as that edition had them. Today's edition stays in the history."

/** The history log's actions that the Editions page reports: going back and the stop switch. */
export type ReleaseAction = 'edition.rollback' | 'stop.on' | 'stop.off'

/**
 * One entry of the history log as a sentence: who did it, what and when, and why. `target` names
 * what a stop applied to; `restores` the edition a going back served again, when it is known.
 */
export function releaseHistoryLine(
  entry: Pick<AuditEntry, 'action' | 'actorName' | 'at' | 'subjectId' | 'details'>,
  names: { target?: string; restores?: string | null } = {},
): string {
  const who = entry.actorName ?? 'Someone whose name is unavailable'
  const target = names.target ?? 'one fact'
  const what =
    entry.action === 'edition.rollback'
      ? `went back to ${names.restores ?? 'an earlier edition'}${entry.subjectId ? `, as edition ${entry.subjectId},` : ''}`
      : entry.action === 'stop.on'
        ? `stopped sharing ${target} with agents`
        : `started sharing ${target} with agents again`
  const why = entry.action === 'edition.rollback' ? entry.details.note : entry.details.reason
  const said = typeof why === 'string' ? why.trim() : ''
  const reason = said ? ` Why: ${said}${/[.!?]$/.test(said) ? '' : '.'}` : ''
  return `${who} ${what} on ${formatMoment(entry.at)}.${reason}`
}

/** A digest shortened for reading, its whole value kept for copying: `5f42b0f0…65b2a2`. */
export function shortDigest(digest: string): string {
  return digest.length > 16 ? `${digest.slice(0, 8)}…${digest.slice(-6)}` : digest
}

/**
 * What someone who may not open Editions is told instead (Quality design, section 0): owners and
 * admins read them; admins stop sharing and go back.
 */
export const editionsRefusal = {
  title: 'Editions are for owners and admins',
  description:
    'An edition is a saved set of all accepted facts, made each time one changes. Owners read what each edition changed. Admins can stop sharing with agents, or go back to an earlier edition. Ask an admin if something looks wrong.',
}
