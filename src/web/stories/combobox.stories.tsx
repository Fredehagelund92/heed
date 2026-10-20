import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemMeta,
  ComboboxLabel,
  ComboboxList,
  ComboboxStatus,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldHeader, FieldLabel } from '@/components/ui/field'
import { SigmaIcon, TagIcon, TargetIcon, UnlinkIcon } from '@/components/icons'
import { type ScopeOption, scopeGroups } from './form-kit-sample'
import { LONG_LABEL, StateRow, StoryPaper, stateParameters } from './form-story-parts'

const meta = {
  title: 'Forms/Combobox',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const allOptions = scopeGroups.flatMap((group) => group.items)
const byName = (...names: string[]) => allOptions.filter((option) => names.includes(option.name))

function Glyph({ option }: { option: ScopeOption }) {
  return option.type === 'metric' ? (
    <SigmaIcon aria-hidden className="text-muted-foreground" />
  ) : (
    <TagIcon aria-hidden className="text-muted-foreground" />
  )
}

function ScopeCombobox({
  label = 'Where it applies',
  initial = [],
  max,
  open,
  inputValue,
  loading = false,
  disabled = false,
}: {
  label?: string
  initial?: ScopeOption[]
  max?: number
  open?: boolean
  inputValue?: string
  loading?: boolean
  disabled?: boolean
}) {
  const [value, setValue] = useState(initial)
  const anchor = useComboboxAnchor()
  const full = max !== undefined && value.length >= max
  return (
    <Field disabled={disabled}>
      <FieldHeader>
        <FieldLabel icon={TargetIcon}>{label}</FieldLabel>
        <FieldDescription>Agents use this to decide when to show it.</FieldDescription>
      </FieldHeader>
      <Combobox
        multiple
        autoHighlight
        items={loading ? [] : scopeGroups}
        value={value}
        onValueChange={(next: ScopeOption[]) => setValue(next)}
        itemToStringLabel={(option: ScopeOption) => option.name}
        isItemEqualToValue={(a: ScopeOption, b: ScopeOption) => a.id === b.id}
        defaultOpen={open}
        defaultInputValue={inputValue}
        disabled={disabled}
      >
        <ComboboxChips ref={anchor} size="lg">
          <ComboboxValue>
            {(options: ScopeOption[]) =>
              options.map((option) => (
                <ComboboxChip key={option.id} label={option.name}>
                  <Glyph option={option} />
                  {option.name}
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput placeholder={value.length ? '' : 'Add a metric, market or product'} />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxStatus loading={loading}>
            {loading
              ? 'Loading the vocabulary'
              : full
                ? `You have added ${max}, the most it takes. Remove one to add another.`
                : null}
          </ComboboxStatus>
          {!loading && (
            <ComboboxEmpty>
              No match. An owner can add it.
              <Button variant="outline" size="sm" type="button">
                <UnlinkIcon aria-hidden />
                Ask an owner to add it
              </Button>
            </ComboboxEmpty>
          )}
          <ComboboxList>
            {(group: (typeof scopeGroups)[number]) => (
              <ComboboxGroup key={group.value} items={group.items}>
                <ComboboxLabel>{group.value}</ComboboxLabel>
                <ComboboxCollection>
                  {(option: ScopeOption) => (
                    <ComboboxItem
                      key={option.id}
                      value={option}
                      disabled={full && !value.some((chosen) => chosen.id === option.id)}
                    >
                      <Glyph option={option} />
                      <span className="truncate">{option.name}</span>
                      <ComboboxItemMeta>{option.count} items</ComboboxItemMeta>
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  )
}

/** Chips: type to filter, Enter adds, Backspace in the empty input removes the last chip. */
export const Chips: Story = {
  render: () => (
    <StoryPaper>
      <ScopeCombobox initial={byName('Units sold', 'Norway')} />
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('combobox', { name: 'Where it applies' })
    await userEvent.click(input)
    await userEvent.type(input, 'depo')
    const option = await screen.findByRole('option', { name: /Orders/ })
    await expect(option).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('button', { name: 'Remove Orders' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Backspace}{Backspace}')
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Remove Orders' })).not.toBeInTheDocument(),
    )
    await expect(canvas.getByRole('button', { name: 'Remove Norway' })).toBeInTheDocument()
  },
}

/** Open: options grouped by type, each with its count. */
export const Open: Story = {
  render: () => (
    <StoryPaper>
      <ScopeCombobox initial={byName('Units sold')} open />
    </StoryPaper>
  ),
}

export const LoadingOptions: Story = {
  render: () => (
    <StoryPaper>
      <ScopeCombobox open loading />
    </StoryPaper>
  ),
}

/** Nothing matches: say what to do, never accept the unknown value. */
export const NoMatch: Story = {
  render: () => (
    <StoryPaper>
      <ScopeCombobox open inputValue="Narnia" />
    </StoryPaper>
  ),
}

/** At the most it takes, the other options are disabled and the list says why. */
export const MaxReached: Story = {
  render: () => (
    <StoryPaper>
      <ScopeCombobox initial={byName('Orders', 'Units sold', 'Norway')} max={3} open />
    </StoryPaper>
  ),
}

function SingleCombobox({
  label = 'Market',
  disabled = false,
}: {
  label?: string
  disabled?: boolean
}) {
  const markets = scopeGroups[1]?.items ?? []
  return (
    <Field disabled={disabled}>
      <FieldLabel>{label}</FieldLabel>
      <Combobox
        items={markets}
        defaultValue={markets[0]}
        itemToStringLabel={(option: ScopeOption) => option.name}
        disabled={disabled}
      >
        <ComboboxInput size="lg" showClear className="max-w-popover" />
        <ComboboxContent>
          <ComboboxEmpty>No market by that name.</ComboboxEmpty>
          <ComboboxList>
            {(option: ScopeOption) => (
              <ComboboxItem key={option.id} value={option}>
                {option.name}
                <ComboboxItemMeta>{option.count} items</ComboboxItemMeta>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  )
}

/** Default, hover, focus-visible, disabled, the single form, long chips and a 200 character label. */
export const States: Story = {
  parameters: stateParameters,
  render: () => (
    <StoryPaper>
      <StateRow name="Default">
        <ScopeCombobox />
      </StateRow>
      <StateRow name="Hover" id="state-hover">
        <ScopeCombobox initial={byName('Units sold')} />
      </StateRow>
      <StateRow name="Focus visible" id="state-focus">
        <ScopeCombobox initial={byName('Units sold')} />
      </StateRow>
      <StateRow name="Disabled">
        <ScopeCombobox initial={byName('Units sold', 'Norway')} disabled />
      </StateRow>
      <StateRow name="Single choice">
        <SingleCombobox />
      </StateRow>
      <StateRow name="Many chips">
        <ScopeCombobox initial={allOptions.slice(0, 10)} />
      </StateRow>
      <StateRow name="200 character label">
        <ScopeCombobox label={LONG_LABEL} />
      </StateRow>
    </StoryPaper>
  ),
}
