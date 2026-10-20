import { textFindings } from '@domain/draft'
import { AREA_DESCRIPTION_MAX, AREA_SUMMARY_MAX } from '@domain/item'
import { DOMAIN_DELETED_REASON } from '@domain/area-removal'
import type { AreaRemoval, AreaRemoved } from '@/api'
import { kindNames } from '@/lib/library'

/** What a domain is, as its form edits it (FR-813): a summary line and a description. */
export type DomainAboutValues = { summary: string; description: string }

/** Everyone reads what a domain is, so it names no person and holds no secret (FR-117). */
const sensitive =
  'Remove the email address, phone number or secret. Everyone can read this, and so can the assistant and AI apps.'

/**
 * Why a summary or description cannot be saved, by field, in the words the form shows; empty
 * when both can. Both may be empty. The service checks the same limits and words again.
 */
export function domainAboutProblems(
  values: DomainAboutValues,
): Partial<Record<keyof DomainAboutValues, string>> {
  const problems: Partial<Record<keyof DomainAboutValues, string>> = {}
  const summary = values.summary.trim()
  if ([...summary].length > AREA_SUMMARY_MAX)
    problems.summary = `Keep the summary to ${AREA_SUMMARY_MAX} characters.`
  // eslint-disable-next-line no-control-regex
  else if (/[\u0000-\u001f\u007f]/.test(summary)) problems.summary = 'Keep the summary to one line.'
  else if (textFindings(summary).length) problems.summary = sensitive
  const description = values.description.trim()
  if ([...description].length > AREA_DESCRIPTION_MAX)
    problems.description = `Keep the description to ${AREA_DESCRIPTION_MAX.toLocaleString('en')} characters.`
  // eslint-disable-next-line no-control-regex
  else if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(description))
    problems.description = 'Use text and line breaks only.'
  else if (textFindings(description).length) problems.description = sensitive
  return problems
}

/** The summary and description as the service takes them: no space or empty line at either end. */
export function domainAbout(values: DomainAboutValues): DomainAboutValues {
  return { summary: values.summary.trim(), description: values.description.trim() }
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

const termKindWords: Record<AreaRemoval['terms'][number]['kind'], string> = {
  metric: 'Metric',
  metric_group: 'Metric group',
  // eslint-disable-next-line heed/plain-words -- shown only in Administration, which says dimension
  dimension: 'Dimension',
  dimension_value: 'Value',
}

const roleWords: Record<AreaRemoval['team'][number]['role'], string> = {
  owner: 'Owner',
  approver: 'Approver',
}

/** One thing deleting a domain affects, as its list names it. */
export type DeletionEntry = {
  key: string
  label: string
  /** What it is, and anything that sets it apart: "Note", "Metric · stays, without a domain". */
  detail: string
}

/** What deleting a domain does to one kind of thing under it (FR-814). */
export type DeletionLine = {
  kind: 'items' | 'terms' | 'openProposals' | 'drafts' | 'team' | 'sourceMembers' | 'history'
  title: string
  /** What happens to them, in one or two sentences. */
  detail: string
  entries: DeletionEntry[]
  /** How many there are beyond the entries listed. */
  more: number
}

/**
 * The lines of the deletion dialog, in the order the person reads them: what goes with the domain
 * and what happens to each kind, with every one named. Nothing is listed for what it does not hold.
 */
export function deletionLines(
  removal: Pick<
    AreaRemoval,
    'name' | 'outcome' | 'holdings' | 'items' | 'terms' | 'openProposals' | 'drafts' | 'team'
  >,
): DeletionLine[] {
  const { holdings: held } = removal
  const more = (total: number, listed: number) => Math.max(0, total - listed)
  const kept = removal.terms.filter((term) => term.fate !== 'retired').length
  const termDetail = (fate: AreaRemoval['terms'][number]['fate']) =>
    fate === 'kept'
      ? 'stays, without a domain: another domain uses it'
      : fate === 'source'
        ? 'stays, without a domain: only the source put it here'
        : null
  const lines: (DeletionLine | false)[] = [
    held.items > 0 && {
      kind: 'items',
      title: count(held.items, 'accepted fact'),
      detail:
        'They move to the Bin, and AI apps stop getting them at once. You can restore each one from the Bin.',
      entries: removal.items.map((item) => ({
        key: item.id,
        label: item.title,
        detail: kindNames[item.kind],
      })),
      more: more(held.items, removal.items.length),
    },
    held.terms > 0 && {
      kind: 'terms',
      title: count(held.terms, 'name'),
      detail: `The metrics, markets and other names the domain knows. They're archived in the same step, so AI apps stop getting them and their metrics lose this domain.${
        kept
          ? ` ${kept === held.terms ? (kept === 1 ? 'It stays' : 'They all stay') : `${count(kept, 'name')} ${kept === 1 ? 'stays' : 'stay'}`}, without a domain, as marked.`
          : ''
      }`,
      entries: removal.terms.map((term) => ({
        key: term.key,
        label: term.name,
        detail: [termKindWords[term.kind], termDetail(term.fate)].filter(Boolean).join(' · '),
      })),
      more: more(held.terms, removal.terms.length),
    },
    held.openProposals > 0 && {
      kind: 'openProposals',
      title: count(held.openProposals, 'open proposal'),
      detail: `They're withdrawn, with the reason ${DOMAIN_DELETED_REASON}. ${held.openProposals === 1 ? 'Its author is' : 'Their authors are'} told.`,
      entries: removal.openProposals.map((proposal) => ({
        key: proposal.id,
        label: proposal.title,
        detail: `Proposal #${proposal.number} · ${proposal.subject === 'vocabulary' ? 'Name' : 'Fact'}`,
      })),
      more: more(held.openProposals, removal.openProposals.length),
    },
    held.drafts > 0 && {
      kind: 'drafts',
      title: count(held.drafts, 'draft'),
      detail: `${held.drafts === 1 ? 'Stays with its author' : 'Stay with their authors'}, marked ${DOMAIN_DELETED_REASON}, to send to another domain or discard.`,
      entries: removal.drafts.map((draft) => ({
        key: draft.id,
        label: draft.title,
        detail: `By ${draft.author}`,
      })),
      more: more(held.drafts, removal.drafts.length),
    },
    held.team > 0 && {
      kind: 'team',
      title: count(held.team, 'team role'),
      detail:
        removal.outcome === 'delete'
          ? 'They end. The history log keeps who held them.'
          : 'They end. Restoring the domain gives them back.',
      entries: removal.team.map((role) => ({
        key: `${role.personId}:${role.role}`,
        label: role.name,
        detail: roleWords[role.role],
      })),
      more: more(held.team, removal.team.length),
    },
    held.sourceMembers > 0 && {
      kind: 'sourceMembers',
      title: count(held.sourceMembers, 'name from a source', 'names from a source'),
      detail: `A definition source puts ${held.sourceMembers === 1 ? 'it' : 'them'} in ${removal.name}. ${held.sourceMembers === 1 ? 'It has' : 'They have'} no domain until the source names another.`,
      entries: [],
      more: 0,
    },
    removal.outcome === 'archive' && {
      kind: 'history',
      title: 'Its history',
      detail: `Decided proposals, archived facts and the history log stay, and keep the name ${removal.name}.`,
      entries: [],
      more: 0,
    },
  ]
  return lines.filter((line): line is DeletionLine => line !== false)
}

/** What deleting the domain does, in one sentence. */
export function deletionEffect(removal: Pick<AreaRemoval, 'name' | 'outcome' | 'demo'>): string {
  if (removal.demo) return `${removal.name} is the demo domain, so it always stays.`
  switch (removal.outcome) {
    case 'delete':
      return `${removal.name} is empty, so it's deleted for good. You can create it again right after.`
    case 'archive':
      return `Everything in ${removal.name} is handled in this one step, so you don't have to move anything first. An admin can restore it later.`
    case 'blocked':
      return `${removal.name} can't be deleted.`
  }
}

/** What deleting did, for the dialog's last step: one sentence per kind it handled. */
export function deletedSummary(
  removed: Pick<AreaRemoved, 'outcome' | 'holdings' | 'edition'>,
): string[] {
  const held = removed.holdings
  if (removed.outcome === 'deleted')
    return ["It's gone from every list and picker. The history log keeps a record that it existed."]
  const served = [
    held.items ? `${count(held.items, 'fact')} moved to the Bin` : null,
    held.terms ? `${count(held.terms, 'name')} left this domain` : null,
  ].filter(Boolean)
  return [
    served.length ? `${served.join(' and ')}. AI apps no longer get them.` : null,
    held.openProposals ? `${count(held.openProposals, 'proposal')} withdrawn.` : null,
    held.drafts
      ? `${count(held.drafts, 'draft')} kept for ${held.drafts === 1 ? 'its author' : 'their authors'}.`
      : null,
    held.team ? `${count(held.team, 'team role')} ended.` : null,
    'Restore it from Deleted domains, below the domains.',
  ].filter((line): line is string => line !== null)
}
