import { useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PersonRow } from '@/api'
import { personPickerQuery } from '@/api/queries'
import { Owner } from '@/components/item/item-marks'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemMeta,
  ComboboxList,
  ComboboxStatus,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { personStatusWords } from '@/lib/roles'

/** The person a picker holds: their name, and their address once a search has found them. */
export type PickedPerson = Pick<PersonRow, 'id' | 'name' | 'initials'> &
  Partial<Pick<PersonRow, 'email' | 'status'>>

const samePerson = (a: PickedPerson, b: PickedPerson) => a.id === b.id
const nameOf = (person: PickedPerson) => person.name

/**
 * Escape with the list closed leaves the choice as it is and reaches the dialog around the
 * picker, which closes. Base UI would clear the field instead, every chosen person at once; the
 * clear button and each chip's remove button do that on purpose.
 */
export function keepOnEscape(
  event: KeyboardEvent<HTMLInputElement> & { preventBaseUIHandler: () => void },
) {
  if (event.key === 'Escape' && event.currentTarget.getAttribute('aria-expanded') !== 'true')
    event.preventBaseUIHandler()
}

/**
 * The people a search finds on the server for the words typed, best matches first, without those
 * left out; the chosen stay options, so the list marks them even when a search leaves them out.
 */
function useFound({
  single,
  open,
  text,
  chosen,
  everyone,
  exclude,
}: {
  /** One person, whose name the field shows once chosen. */
  single: boolean
  open: boolean
  text: string
  chosen: readonly PickedPerson[]
  everyone: boolean
  exclude: readonly string[]
}) {
  // A chosen name in a single field is not a search: opened again, the list starts from the top.
  const typed = single && chosen[0] && text === chosen[0].name ? '' : text.trim()
  const words = useDebouncedValue(typed)
  const found = useQuery({
    ...personPickerQuery(words, everyone ? 'all' : 'active'),
    enabled: open,
  })
  const loaded = (found.data?.people ?? []).filter((person) => !exclude.includes(person.id))
  const missing = typed
    ? []
    : chosen.filter((person) => !loaded.some((one) => one.id === person.id))
  const items: PickedPerson[] = [...missing, ...loaded]
  const searching = found.isPending || typed !== words
  const more = found.data ? found.data.total - found.data.people.length : 0
  const empty = searching
    ? 'Finding people…'
    : found.isError
      ? "We couldn't search for people. Try again."
      : typed
        ? `Nobody${everyone ? '' : ' active'} matches “${typed}”. Try part of the name or the email.`
        : 'Type part of a name or an email.'
  const status =
    more > 0 && !searching
      ? `${more.toLocaleString('en')} more ${more === 1 ? 'matches' : 'match'}. Type more of the name or the email.`
      : ''
  return { items, empty, status, fetching: found.isFetching && items.length > 0 }
}

function PersonOption({ person }: { person: PickedPerson }) {
  return (
    <ComboboxItem value={person} data-person={person.id}>
      <Owner
        name={person.name}
        initials={person.initials}
        role={person.email ?? undefined}
        size="md"
      />
      {person.status && person.status !== 'active' ? (
        <ComboboxItemMeta>{personStatusWords[person.status]}</ComboboxItemMeta>
      ) : null}
    </ComboboxItem>
  )
}

/**
 * Choosing a person (people and roles decision, slice 1): type part of a name or an email and
 * Heed finds them on the server, best matches first, each with their address, so two people of
 * one name are told apart. Leavers are never offered, unless the picker finds `everyone`, as the
 * history log's person filter does to read what a leaver did; they are marked there.
 */
export function PersonPicker({
  id,
  value,
  onValueChange,
  everyone = false,
  exclude = [],
  placeholder = 'Name or email',
  size = 'lg',
  invalid = false,
  disabled = false,
  showClear = false,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: {
  id?: string
  value: PickedPerson | null
  onValueChange: (person: PickedPerson | null) => void
  everyone?: boolean
  /** People not offered, such as the one already in a seat. */
  exclude?: readonly string[]
  placeholder?: string
  size?: 'default' | 'lg' | 'toolbar'
  invalid?: boolean
  disabled?: boolean
  showClear?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const found = useFound({
    single: true,
    open,
    text,
    chosen: value ? [value] : [],
    everyone,
    exclude,
  })

  return (
    <Combobox
      items={found.items}
      value={value}
      filter={null}
      open={open}
      onOpenChange={setOpen}
      onInputValueChange={(next) => setText(next)}
      onValueChange={(next: PickedPerson | null) => onValueChange(next)}
      itemToStringLabel={nameOf}
      isItemEqualToValue={samePerson}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        size={size}
        placeholder={placeholder}
        showClear={showClear && value !== null}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        onKeyDown={keepOnEscape}
      />
      <ComboboxContent className="min-w-popover">
        <ComboboxEmpty>{found.empty}</ComboboxEmpty>
        <ComboboxList>
          {(person: PickedPerson) => <PersonOption key={person.id} person={person} />}
        </ComboboxList>
        <ComboboxStatus loading={found.fetching}>{found.status}</ComboboxStatus>
      </ComboboxContent>
    </Combobox>
  )
}

/**
 * Choosing several people, as chips (people and roles decision, slice 2): the same search as
 * `PersonPicker`, one name after another. Leavers are never offered.
 */
export function PeoplePicker({
  id,
  value,
  onValueChange,
  placeholder = 'Name or email',
  invalid = false,
  disabled = false,
}: {
  id?: string
  value: readonly PickedPerson[]
  onValueChange: (people: PickedPerson[]) => void
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const anchor = useComboboxAnchor()
  const found = useFound({
    single: false,
    open,
    text,
    chosen: value,
    everyone: false,
    exclude: [],
  })

  return (
    <Combobox
      multiple
      items={found.items}
      value={[...value]}
      filter={null}
      open={open}
      onOpenChange={setOpen}
      onInputValueChange={(next) => setText(next)}
      onValueChange={(next: PickedPerson[]) => onValueChange(next)}
      itemToStringLabel={nameOf}
      isItemEqualToValue={samePerson}
      disabled={disabled}
    >
      <ComboboxChips ref={anchor} size="lg">
        <ComboboxValue>
          {(people: PickedPerson[]) =>
            people.map((person) => (
              <ComboboxChip key={person.id} label={person.name}>
                {person.name}
              </ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput
          id={id}
          placeholder={value.length ? undefined : placeholder}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={keepOnEscape}
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor} className="min-w-popover">
        <ComboboxEmpty>{found.empty}</ComboboxEmpty>
        <ComboboxList>
          {(person: PickedPerson) => <PersonOption key={person.id} person={person} />}
        </ComboboxList>
        <ComboboxStatus loading={found.fetching}>{found.status}</ComboboxStatus>
      </ComboboxContent>
    </Combobox>
  )
}
