import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import {
  Field,
  FieldControl,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldGroup,
  FieldHeader,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AlignLeftIcon, CalendarIcon, LinkIcon } from '@/components/icons'
import { LONG_LABEL, StateRow, StoryPaper, stateParameters } from './form-story-parts'

const meta = {
  title: 'Forms/Field',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function TextField({
  label,
  invalid,
  ...props
}: { label: string; invalid?: string } & React.ComponentProps<typeof Input>) {
  return (
    <Field invalid={Boolean(invalid)}>
      <FieldLabel>{label}</FieldLabel>
      <Input size="lg" {...props} />
      <FieldError>{invalid}</FieldError>
    </Field>
  )
}

/** The parts of a field: label with its field icon, hint, control, error and counter. */
export const Anatomy: Story = {
  render: () => (
    <StoryPaper>
      <Field invalid>
        <FieldHeader>
          <FieldLabel icon={AlignLeftIcon}>What happened</FieldLabel>
          <FieldDescription>One or two sentences, in plain words.</FieldDescription>
        </FieldHeader>
        <FieldControl
          defaultValue="Online sales to Norway stopped on 4 August 2026 after a new customs rule. The rule holds every parcel from a webshop outside Norway at the border, and it applies to footwear, clothing and climbing alike, with no end date yet."
          render={<Textarea rows={3} />}
        />
        <FieldFooter>
          <FieldError>Shorten it by 1 character.</FieldError>
          <FieldCounter count={281} max={280} />
        </FieldFooter>
      </Field>
      <Field>
        <FieldLabel icon={CalendarIcon} optional>
          Date you read it
        </FieldLabel>
        <Input size="lg" placeholder="For example 4 Aug 2026" />
      </Field>
    </StoryPaper>
  ),
}

/** Default, hover, focus-visible, disabled, read only, invalid, a 200 character label, no label. */
export const States: Story = {
  parameters: stateParameters,
  render: () => (
    <StoryPaper>
      <StateRow name="Default">
        <TextField label="Link" placeholder="https://www.customs.example/notices/2026-08" />
      </StateRow>
      <StateRow name="Hover" id="state-hover">
        <TextField label="Link" defaultValue="https://www.customs.example/notices/2026-08" />
      </StateRow>
      <StateRow name="Focus visible" id="state-focus">
        <TextField label="Link" defaultValue="https://www.customs.example/notices/2026-08" />
      </StateRow>
      <StateRow name="Disabled">
        <TextField
          label="Link"
          disabled
          defaultValue="https://www.customs.example/notices/2026-08"
        />
      </StateRow>
      <StateRow name="Read only">
        <TextField
          label="Link"
          readOnly
          defaultValue="https://www.customs.example/notices/2026-08"
        />
      </StateRow>
      <StateRow name="Invalid">
        <TextField
          label="Link"
          invalid="Add a link that starts with https://"
          defaultValue="customs notice"
        />
      </StateRow>
      <StateRow name="200 character label">
        <TextField label={LONG_LABEL} defaultValue="15 June 2026" />
      </StateRow>
      <StateRow name="Empty label">
        <Field>
          <FieldLabel>{''}</FieldLabel>
          <Input size="lg" aria-label="Search the library" placeholder="No visible label" />
        </Field>
      </StateRow>
    </StoryPaper>
  ),
}

function CountedQuote() {
  const [value, setValue] = useState('Webshops must stop parcels into Norway from 4 August 2026.')
  const length = [...value].length
  return (
    <Field invalid={length > 80}>
      <FieldLabel>Quote</FieldLabel>
      <FieldControl value={value} onValueChange={setValue} render={<Textarea rows={2} />} />
      <FieldFooter>
        <FieldError>
          {length > 80 ? `Shorten it by ${length - 80} characters.` : undefined}
        </FieldError>
        <FieldCounter count={length} max={80} />
      </FieldFooter>
    </Field>
  )
}

/** The counter follows the text and says by how much it is over; the error follows. */
export const CharacterCount: Story = {
  render: () => (
    <StoryPaper>
      <CountedQuote />
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const quote = canvas.getByRole('textbox', { name: 'Quote' })
    await expect(quote).toHaveAccessibleDescription(expect.stringContaining('61 of 80 characters'))
    await userEvent.type(quote, ' It covers footwear and clothing.')
    await expect(canvas.getByText(/94 of 80 characters, 14 too many/)).toBeInTheDocument()
    await expect(quote).toHaveAttribute('aria-invalid', 'true')
  },
}

/** Related fields under one legend, with a hint read when focus enters the group. */
export const Group: Story = {
  render: () => (
    <StoryPaper>
      <FieldSet>
        <FieldHeader>
          <FieldLegend icon={LinkIcon}>Where this comes from</FieldLegend>
          <FieldDescription>
            A link to where you read it and a sentence copied from it.
          </FieldDescription>
        </FieldHeader>
        <FieldGroup>
          <TextField label="Link" defaultValue="https://www.customs.example/notices/2026-08" />
          <Field>
            <FieldLabel optional>Quote</FieldLabel>
            <FieldControl render={<Textarea rows={2} />} />
            <FieldFooter>
              <FieldCounter count={0} max={500} />
            </FieldFooter>
          </Field>
        </FieldGroup>
      </FieldSet>
    </StoryPaper>
  ),
}
