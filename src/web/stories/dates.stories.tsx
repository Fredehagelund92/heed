import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { DateField } from '@/components/form/date-field'
import { ValidityRange } from '@/components/form/validity-range'
import { Calendar } from '@/components/ui/calendar'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldHeader,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { HeedValidUntilIcon } from '@/components/icons'
import { isoToDate, type StoredValidity } from '@/lib/validity-range'
import { LONG_LABEL, StateRow, StoryPaper, stateParameters } from './form-story-parts'

const meta = {
  title: 'Forms/Dates',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function Range({
  kind = 'standing',
  initial,
  errors,
}: {
  kind?: 'standing' | 'issue'
  initial: StoredValidity
  errors?: { start?: string; end?: string }
}) {
  const [value, setValue] = useState(initial)
  return (
    <FieldSet>
      <FieldHeader>
        <FieldLegend icon={HeedValidUntilIcon}>When it applies</FieldLegend>
        <FieldDescription>
          The last day is included. Leave it open if you do not know when it ends.
        </FieldDescription>
      </FieldHeader>
      <ValidityRange kind={kind} value={value} onValueChange={setValue} errors={errors} />
      <p className="font-mono text-caption text-muted-foreground">
        Stored: start {value.start ?? 'none'}, end {value.end ?? 'none'} (exclusive)
      </p>
    </FieldSet>
  )
}

/** From and Until. The screen shows the last day; the stored end is the day after. */
export const ValidityRangeStanding: Story = {
  name: 'ValidityRange',
  render: () => (
    <StoryPaper>
      <Range initial={{ start: '2026-08-04', end: '2026-10-07' }} />
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const until = canvas.getByRole('textbox', { name: 'Until' })
    await expect(until).toHaveValue('6 Oct 2026')
    await userEvent.clear(until)
    await userEvent.type(until, '31 Dec 2026')
    await userEvent.tab()
    await expect(canvas.getByText(/end 2027-01-01 \(exclusive\)/)).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove the end date' }))
    await expect(canvas.getByText(/end none/)).toBeInTheDocument()
  },
}

export const ValidityRangeStates: Story = {
  render: () => (
    <StoryPaper>
      <StateRow name="Empty">
        <Range initial={{ start: null, end: null }} />
      </StateRow>
      <StateRow name="No end date">
        <Range initial={{ start: '2026-08-04', end: null }} />
      </StateRow>
      <StateRow name="Invalid range">
        <Range initial={{ start: '2026-08-04', end: '2026-08-02' }} />
      </StateRow>
      <StateRow name="Errors from the form">
        <Range
          initial={{ start: null, end: null }}
          errors={{ start: 'Enter the first day it applies.' }}
        />
      </StateRow>
    </StoryPaper>
  ),
}

/** An issue: still going on (the default), or it ended with a last day. */
export const IssueStillGoingOn: Story = {
  render: () => (
    <StoryPaper>
      <Range kind="issue" initial={{ start: '2026-09-25', end: null }} />
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'Still going on' }))
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('radio', { name: 'It ended' })).toBeChecked()
    await expect(canvas.getByRole('textbox', { name: 'Last day' })).toBeInTheDocument()
  },
}

export const IssueEnded: Story = {
  render: () => (
    <StoryPaper>
      <Range kind="issue" initial={{ start: '2026-09-25', end: '2026-10-07' }} />
    </StoryPaper>
  ),
}

function OneDay({
  label = 'Date you read it',
  initial = '2026-08-05',
  disabled = false,
  error,
}: {
  label?: string
  initial?: string | null
  disabled?: boolean
  error?: string
}) {
  const [value, setValue] = useState(initial)
  const [textError, setTextError] = useState<string | null>(null)
  const shown = textError ?? error
  return (
    <Field invalid={Boolean(shown)} disabled={disabled} className="max-w-popover">
      <FieldLabel>{label}</FieldLabel>
      <DateField
        value={value}
        onValueChange={setValue}
        onTextError={setTextError}
        disabled={disabled}
      />
      <FieldError>{shown}</FieldError>
    </Field>
  )
}

/** Type a day ("4 Aug 2026", "2026-08-04", "4/8/2026") or pick one from the calendar. */
export const DateFieldStates: Story = {
  name: 'DateField',
  parameters: stateParameters,
  render: () => (
    <StoryPaper>
      <StateRow name="Default">
        <OneDay />
      </StateRow>
      <StateRow name="Empty">
        <OneDay initial={null} />
      </StateRow>
      <StateRow name="Hover" id="state-hover">
        <OneDay />
      </StateRow>
      <StateRow name="Focus visible" id="state-focus">
        <OneDay />
      </StateRow>
      <StateRow name="Disabled">
        <OneDay disabled />
      </StateRow>
      <StateRow name="Invalid">
        <OneDay initial={null} error="Enter a day like 4 Aug 2026." />
      </StateRow>
      <StateRow name="200 character label">
        <OneDay label={LONG_LABEL} />
      </StateRow>
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [field] = canvas.getAllByRole('textbox', { name: 'Date you read it' })
    if (!field) throw new Error('No date field')
    await userEvent.clear(field)
    await userEvent.type(field, '2026-08-04{Enter}')
    await expect(field).toHaveValue('4 Aug 2026')
    await userEvent.clear(field)
    await userEvent.type(field, 'yesterday{Enter}')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription('Enter a day like 4 Aug 2026.')
  },
}

/** The calendar on its own: single day, a range, disabled days. */
export const CalendarParts: Story = {
  name: 'Calendar',
  render: () => (
    <StoryPaper>
      <div className="flex flex-wrap gap-8">
        <Calendar
          mode="single"
          selected={isoToDate('2026-08-04')}
          defaultMonth={isoToDate('2026-08-04')}
        />
        <Calendar
          mode="range"
          selected={{ from: isoToDate('2026-09-25'), to: isoToDate('2026-10-06') }}
          defaultMonth={isoToDate('2026-10-01')}
          disabled={{ before: isoToDate('2026-09-25') }}
        />
      </div>
    </StoryPaper>
  ),
}
