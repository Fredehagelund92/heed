import type { ItemKind } from './item.ts'
import { kinds, type Kind } from './words.ts'

/*
  What a change to many rows of the Context list does, row by row, before anything happens
  (FR-139): which rows it acts on, and which it leaves alone and why ("2 skipped: owned by
  Marketing"). Owners of an item's domain and admins change it. A draft (never published) can be
  deleted; a published item is archived, never deleted, so its history stays and agents simply stop
  getting it. Pure, so the service and the app's mock read one rule and say it in the same words.
*/

export const bulkActions = [
  'archive',
  'delete',
  'domain',
  'kind',
  'owner_add',
  'owner_set',
  'check',
] as const
export type BulkAction = (typeof bulkActions)[number]

/** Why a row is left alone. */
export const bulkRowSkipCodes = [
  'not_found',
  'not_allowed',
  'archived',
  'draft',
  'published',
  'same_domain',
  'same_kind',
  'not_owner_there',
  'already_owner',
  'only_owner',
  'not_opened',
] as const
export type BulkRowSkipCode = (typeof bulkRowSkipCodes)[number]

/** One row of the list as the rule reads it: a published item, or a draft that was never published. */
export type BulkRow = {
  id: string
  title: string
  kind: ItemKind
  areaId: string
  status: 'draft' | 'live' | 'archived'
  /** Who answers for it: its own owners, or else its domain's. */
  owners: readonly string[]
}

/** Someone, as the rule needs them: admin or not, and the domains they own. */
export type BulkPerson = { id: string; name: string; admin: boolean; owns: readonly string[] }

export type BulkInput = {
  action: BulkAction
  /** Change domain: where to. */
  areaId?: string
  /** Change kind: to what. */
  kind?: ItemKind
  /** Add or change owner: who. */
  person?: BulkPerson
}

export type BulkRowSkip = {
  id: string
  title: string
  code: BulkRowSkipCode
  /** A few words for the line under the bar: "owned by Marketing". */
  why: string
  /** One sentence for its tooltip. */
  message: string
}

export type BulkRowPlan = { act: BulkRow[]; skipped: BulkRowSkip[] }

/** Owners of the item's domain and admins change an item. */
export const changesItem = (row: Pick<BulkRow, 'areaId'>, person: BulkPerson) =>
  person.admin || person.owns.includes(row.areaId)

const kindName = (kind: ItemKind) => (kind in kinds ? kinds[kind as Kind].label : 'Example')

/**
 * The plan of one change: each row the person may change and the change would change, and each
 * other row with its reason. `opened` holds the items the person opened (Mark as checked);
 * `domainName` names a domain by its id.
 */
export function planBulk(
  rows: readonly BulkRow[],
  input: BulkInput,
  me: BulkPerson,
  { opened, domainName }: { opened: ReadonlySet<string>; domainName: (id: string) => string },
): BulkRowPlan {
  const act: BulkRow[] = []
  const skipped: BulkRowSkip[] = []
  const skip = (row: BulkRow, code: BulkRowSkipCode, why: string, message: string) =>
    skipped.push({ id: row.id, title: row.title, code, why, message })
  for (const row of rows) {
    const domain = domainName(row.areaId)
    if (!changesItem(row, me)) {
      skip(
        row,
        'not_allowed',
        `owned by ${domain}`,
        `Only owners of ${domain} and admins can change it.`,
      )
      continue
    }
    const why = whyNot(row, input, opened, domainName)
    if (why) skip(row, ...why)
    else act.push(row)
  }
  return { act, skipped }
}

type Why = [BulkRowSkipCode, string, string]

function whyNot(
  row: BulkRow,
  input: BulkInput,
  opened: ReadonlySet<string>,
  domainName: (id: string) => string,
): Why | undefined {
  const domain = domainName(row.areaId)
  switch (input.action) {
    case 'archive':
      if (row.status === 'archived')
        return ['archived', 'already archived', 'It is archived already.']
      if (row.status === 'draft')
        return ['draft', 'a draft', 'A draft was never published, so it is deleted, not archived.']
      return
    case 'delete':
      if (row.status !== 'draft')
        return ['published', 'published', 'Published items are archived, not deleted.']
      return
    case 'domain': {
      if (row.status === 'archived')
        return ['archived', 'archived', `It is archived, so it stays in ${domain}.`]
      if (input.areaId === row.areaId) {
        const to = domainName(row.areaId)
        return ['same_domain', `already in ${to}`, `It is in ${to} already.`]
      }
      return
    }
    case 'kind': {
      if (row.status === 'archived')
        return ['archived', 'archived', 'It is archived, so it keeps its kind.']
      if (input.kind === row.kind) {
        const name = kindName(row.kind)
        return ['same_kind', `already a ${name}`, `It is a ${name} already.`]
      }
      return
    }
    case 'owner_add':
    case 'owner_set': {
      const person = input.person
      if (!person) return
      // An owner answers for an item, so they must be able to change it.
      if (!changesItem(row, person))
        return [
          'not_owner_there',
          `${person.name} doesn't own ${domain}`,
          `Only owners of ${domain} and admins can own its items.`,
        ]
      if (input.action === 'owner_add' && row.owners.includes(person.id))
        return ['already_owner', 'already an owner', `${person.name} owns it already.`]
      if (input.action === 'owner_set' && row.owners.length === 1 && row.owners[0] === person.id)
        return ['only_owner', 'already the owner', `${person.name} is its only owner already.`]
      return
    }
    case 'check':
      if (row.status === 'draft')
        return ['draft', 'a draft', 'A draft is checked when it is published.']
      if (row.status === 'archived')
        return ['archived', 'archived', "Agents don't get it, so there is nothing to check."]
      // As with publishing together: only what was opened counts as read.
      if (!opened.has(row.id))
        return ['not_opened', 'not opened yet', 'Open it first: checking it means reading it.']
      return
  }
}

/** What a change says in History and in Settings, Advanced: "Moved to Marketing." */
export function changeSummary(
  input: BulkInput,
  titles: readonly string[],
  domainName: (id: string) => string,
): string {
  const first = titles[0] ?? ''
  const rest = titles.length - 1
  const which = rest > 0 ? `\u201c${first}\u201d and ${rest} more` : `\u201c${first}\u201d`
  switch (input.action) {
    case 'archive':
      return `Archived ${which}.`
    case 'delete':
      return `Deleted ${which}.`
    case 'domain':
      return `Moved ${which} to ${domainName(input.areaId ?? '')}.`
    case 'kind':
      return `Made ${which} a ${kindName(input.kind ?? 'note')}.`
    case 'owner_add':
      return `Added ${input.person?.name ?? 'an owner'} as an owner of ${which}.`
    case 'owner_set':
      return `Made ${input.person?.name ?? 'someone'} the owner of ${which}.`
    case 'check':
      return `Checked ${which}: still true.`
  }
}

/** The item_changes action a change is recorded as. */
export const changeAction: Record<BulkAction, string> = {
  archive: 'archived',
  delete: 'deleted',
  domain: 'moved',
  kind: 'kind',
  owner_add: 'owners',
  owner_set: 'owners',
  check: 'checked',
}
