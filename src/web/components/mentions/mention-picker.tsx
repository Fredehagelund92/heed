import { useMemo, useState } from 'react'
import type { Icon } from '@/components/icons'
import type { MentionTargetType } from '@/lib/mention-names'
import { searchMentionTargets, type MentionMatch, type MentionOption } from '@/lib/mention-targets'
import { LIST_ROWS, ListAnchor, MentionList, optionId, REQUEST_ROW } from './mention-list'

/*
  The @ picker every mention input shares (FR-129): the item's summary and body, a plain text
  field, and the assistant's question. It searches what was typed after `@` (or `#`, values only)
  over the targets the place allows, keeps the active row, says what a key does while the list is
  open, and draws the list with its count for a screen reader. The field keeps the focus, the
  caret and its own text: it hands the picker the trigger at its caret and inserts what is picked.
*/

/**
 * What a picker can be set to offer. Item text and the assistant's question offer the targets
 * text stores (`ENTITY_TYPES`); `person` is for proposal comments and discussion, a later stage,
 * and offers nothing yet: no target list holds people.
 */
export type PickerType = MentionTargetType | 'person'

/** Metrics, values, dimensions, accepted items and domains: what item text and the question offer. */
export const ENTITY_TYPES: readonly PickerType[] = ['metric', 'val', 'dim', 'item', 'area']

/** The `@` or `#` before the caret and the words after it. `at` is where the sign is. */
export type PickerTrigger = { at: number; char: '@' | '#'; query: string }

/**
 * The list's last row, after the matches: a request to an owner, or the question's dates.
 * `preferred` makes it the active row until the person moves.
 */
export type PickerRow = { label: string; onChoose: () => void; icon?: Icon; preferred?: boolean }

/** What a key does while the list is open: handled, Enter or Tab with no row to take, or nothing. */
export type PickerKey = 'handled' | 'empty' | null

export type MentionPicker<T extends PickerTrigger = PickerTrigger> = {
  listId: string
  /** The trigger while the list is open: not dismissed with Escape. */
  trigger: T | null
  open: boolean
  matches: MentionMatch[]
  row: PickerRow | null
  activeKey: string | null
  setActive: (key: string | null) => void
  /** The id of the active row, for the field's `aria-activedescendant`. */
  activeDescendant: string | undefined
  /** Closes the list for this trigger only: once it is gone, a new one opens the list again. */
  dismiss: () => void
  /** Opens the list again for a trigger that was dismissed. */
  reset: () => void
  /** Up and Down move, Enter and Tab take the active row, Escape closes the list. */
  keyDown: (key: string) => PickerKey
  pick: (option: MentionOption) => void
}

export function useMentionPicker<T extends PickerTrigger>({
  listId,
  targets,
  trigger: raw,
  types,
  full = false,
  limit = LIST_ROWS,
  row: rowOf,
  onPick,
}: {
  listId: string
  targets: MentionOption[]
  /** The trigger at the caret, or null (no trigger, or the field is not focused). */
  trigger: T | null
  /** What `@` offers here; `#` offers values only, wherever values are allowed. */
  types: readonly PickerType[]
  /** No more mentions fit: the list says so instead of offering more. */
  full?: boolean
  /** The most matches the list shows. */
  limit?: number
  /** The last row for what was typed, or none. */
  row?: (found: { trigger: T; matches: MentionMatch[] }) => PickerRow | null
  onPick: (option: MentionOption, trigger: T) => void
}): MentionPicker<T> {
  const [active, setActive] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<number | null>(null)
  // Escape closes the list for that trigger only: once it is gone, a new one opens the list again.
  if (raw === null && dismissed !== null) setDismissed(null)
  const trigger = raw && raw.at !== dismissed ? raw : null
  const offered = useMemo(
    () =>
      types.filter(
        (type): type is MentionTargetType =>
          type !== 'person' && (trigger?.char !== '#' || type === 'val'),
      ),
    [types, trigger?.char],
  )
  // Null while the list is closed: what the matches are found for.
  const query = trigger ? trigger.query : null
  const matches = useMemo(
    () =>
      query !== null && !full && offered.length > 0
        ? searchMentionTargets(targets, query, {
            types: offered,
            perGroup: query ? 4 : 2,
            limit,
          })
        : [],
    [query, full, offered, targets, limit],
  )
  const row = trigger && rowOf ? rowOf({ trigger, matches }) : null
  const rows = [...matches.map((match) => match.option.key), ...(row ? [REQUEST_ROW] : [])]
  const activeKey =
    active && rows.includes(active) ? active : row?.preferred ? REQUEST_ROW : (rows[0] ?? null)
  const open = trigger !== null

  const pick = (option: MentionOption) => {
    if (!trigger) return
    onPick(option, trigger)
    setActive(null)
  }
  return {
    listId,
    trigger,
    open,
    matches,
    row,
    activeKey,
    setActive,
    activeDescendant: open && activeKey ? optionId(listId, activeKey) : undefined,
    dismiss: () => setDismissed(raw?.at ?? null),
    reset: () => setDismissed(null),
    keyDown: (key) => {
      if (!open) return null
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        if (rows.length > 0) {
          const at = activeKey ? rows.indexOf(activeKey) : -1
          const step = key === 'ArrowDown' ? 1 : -1
          setActive(rows[(at + step + rows.length) % rows.length] ?? null)
        }
        return 'handled'
      }
      if (key === 'Enter' || key === 'Tab') {
        if (activeKey === REQUEST_ROW && row) {
          row.onChoose()
          setActive(null)
          return 'handled'
        }
        const match = matches.find((one) => one.option.key === activeKey)
        if (!match) return 'empty'
        pick(match.option)
        return 'handled'
      }
      if (key === 'Escape') {
        setDismissed(raw?.at ?? null)
        return 'handled'
      }
      return null
    },
    pick,
  }
}

/** What the list's live region says: how many rows match, or nothing while it is closed. */
export function pickerStatus(picker: MentionPicker): string {
  if (!picker.open) return ''
  const n = picker.matches.length
  return n === 0 ? 'No match.' : `${n} ${n === 1 ? 'match' : 'matches'}.`
}

/** The open list at its point in the field: above it for a field at the bottom of the screen. */
export function MentionPickerList({
  picker,
  label,
  empty,
  point,
  side = 'bottom',
  peek,
}: {
  picker: MentionPicker
  /** The listbox's name, such as "Mention a metric, value, fact or domain". */
  label: string
  /** What the list says when nothing matches. */
  empty?: string
  point: { left: number; top?: number; bottom?: number } | null
  side?: 'top' | 'bottom'
  peek?: boolean
}) {
  if (!picker.open) return null
  const { row } = picker
  return (
    <ListAnchor point={point} side={side}>
      <MentionList
        id={picker.listId}
        label={label}
        matches={picker.matches}
        query={picker.trigger?.query ?? ''}
        activeKey={picker.activeKey}
        onPick={picker.pick}
        onActivate={picker.setActive}
        empty={empty}
        peek={peek}
        request={row ? { label: row.label, onRequest: row.onChoose, icon: row.icon } : null}
      />
    </ListAnchor>
  )
}

/**
 * The list a field controls: open at its point, or an empty listbox the field's `aria-controls`
 * names while it is closed, with a polite count of the matches.
 */
export function MentionPickerPopup({
  closedLabel,
  ...props
}: Parameters<typeof MentionPickerList>[0] & {
  /** The closed listbox's name. */
  closedLabel: string
}) {
  return (
    <>
      {props.picker.open ? (
        <MentionPickerList {...props} />
      ) : (
        <div id={props.picker.listId} role="listbox" aria-label={closedLabel} hidden />
      )}
      <span role="status" className="sr-only">
        {pickerStatus(props.picker)}
      </span>
    </>
  )
}
