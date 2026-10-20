import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { itemKinds, type ItemKind } from '@domain/item'
import { DomainBadge, KindIcon } from '@/components/item/item-marks'
import { Field, FieldDescription, FieldError, FieldHeader, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { HeedDomainIcon, ShapesIcon } from '@/components/icons'
import { kindLines } from './form-kit-sample'
import { kindNames } from '@/lib/library'
import { areas } from '@/mocks/reference-data'
import { LONG_LABEL, StateRow, StoryPaper, stateParameters } from './form-story-parts'

const meta = {
  title: 'Forms/Select',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function KindSelect({
  label = 'What kind is it?',
  defaultValue = 'event',
  open,
  disabled,
  invalid,
}: {
  label?: string
  defaultValue?: ItemKind | null
  open?: boolean
  disabled?: boolean
  invalid?: string
}) {
  return (
    <Field invalid={Boolean(invalid)} disabled={disabled}>
      <FieldHeader>
        <FieldLabel icon={ShapesIcon}>{label}</FieldLabel>
        <FieldDescription>Pick the closest. An owner can change it.</FieldDescription>
      </FieldHeader>
      <Select
        defaultValue={defaultValue}
        defaultOpen={open}
        items={itemKinds.map((value) => ({ value, label: kindNames[value] }))}
      >
        <SelectTrigger size="lg" className="max-w-popover">
          <SelectValue placeholder="Choose a kind">
            {(value: ItemKind | null) =>
              value ? (
                <>
                  <KindIcon kind={value} decorative />
                  <span className="font-bold">{kindNames[value]}</span>
                  <span className="truncate text-muted-foreground">{kindLines[value]}</span>
                </>
              ) : null
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {itemKinds.map((value) => (
            <SelectItem key={value} value={value} className="items-start py-2">
              <KindIcon kind={value} decorative />
              <span className="flex min-w-0 flex-col">
                <SelectItemText className="font-bold">{kindNames[value]}</SelectItemText>
                <span className="text-caption text-muted-foreground">{kindLines[value]}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError>{invalid}</FieldError>
    </Field>
  )
}

/** The kind picker of the form: one line when closed, each kind with its line when open. */
export const Default: Story = {
  render: () => (
    <StoryPaper>
      <KindSelect />
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: 'What kind is it?' })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    const listbox = await screen.findByRole('listbox')
    await expect(listbox).toBeVisible()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    await expect(trigger).toHaveTextContent('Issue')
    await expect(trigger).toHaveFocus()
  },
}

export const Open: Story = {
  render: () => (
    <StoryPaper>
      <KindSelect open />
    </StoryPaper>
  ),
}

export const States: Story = {
  parameters: stateParameters,
  render: () => (
    <StoryPaper>
      <StateRow name="Default">
        <KindSelect />
      </StateRow>
      <StateRow name="Hover" id="state-hover">
        <KindSelect />
      </StateRow>
      <StateRow name="Focus visible" id="state-focus">
        <KindSelect />
      </StateRow>
      <StateRow name="Placeholder">
        <KindSelect defaultValue={null} />
      </StateRow>
      <StateRow name="Disabled">
        <KindSelect disabled />
      </StateRow>
      <StateRow name="Invalid">
        <KindSelect defaultValue={null} invalid="Choose what kind of context this is." />
      </StateRow>
      <StateRow name="200 character label">
        <KindSelect label={LONG_LABEL} />
      </StateRow>
    </StoryPaper>
  ),
}

/** A domain, never a person: the domain badge inside the control is the bare form. */
export const Domain: Story = {
  render: () => (
    <StoryPaper>
      <Field>
        <FieldHeader>
          <FieldLabel icon={HeedDomainIcon}>Domain</FieldLabel>
          <FieldDescription>The owner of this domain reviews it.</FieldDescription>
        </FieldHeader>
        <Select
          defaultValue="area_sales"
          defaultOpen
          items={areas.map((area) => ({ value: area.id, label: area.name }))}
        >
          <SelectTrigger size="lg" className="max-w-popover">
            <SelectValue>
              {(id: string) => {
                const area = areas.find((candidate) => candidate.id === id)
                return area ? <DomainBadge name={area.name} label={area.label} /> : null
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {areas.map((area) => (
              <SelectItem key={area.id} value={area.id}>
                <SelectItemText>
                  <DomainBadge name={area.name} label={area.label} form="bare" />
                </SelectItemText>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </StoryPaper>
  ),
}

/** Nothing to choose yet: the list says so instead of opening empty. */
export const EmptyOptions: Story = {
  render: () => (
    <StoryPaper>
      <Field>
        <FieldLabel>Owner</FieldLabel>
        <Select defaultOpen>
          <SelectTrigger size="lg" className="max-w-popover">
            <SelectValue placeholder="No owners yet" />
          </SelectTrigger>
          <SelectContent empty="This domain has no owner yet. An administrator names one in Settings.">
            {[]}
          </SelectContent>
        </Select>
      </Field>
    </StoryPaper>
  ),
}

/** The browser's own picker, for short lists on phones and with a coarse pointer. */
export const Native: Story = {
  render: () => (
    <StoryPaper>
      <Field>
        <FieldLabel>Domain</FieldLabel>
        <NativeSelect size="lg" defaultValue="area_sales" className="max-w-popover">
          {areas.map((area) => (
            <NativeSelectOption key={area.id} value={area.id}>
              {area.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field disabled>
        <FieldLabel>Domain, disabled</FieldLabel>
        <NativeSelect size="lg" disabled className="max-w-popover">
          <NativeSelectOption>Sales</NativeSelectOption>
        </NativeSelect>
      </Field>
    </StoryPaper>
  ),
}
