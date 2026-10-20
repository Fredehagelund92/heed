import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { BlockedButton } from '@/components/ui/blocked-button'
import { DateField, DAY_FORMAT_MESSAGE } from '@/components/form/date-field'
import { ErrorSummary } from '@/components/form/error-summary'
import { FormErrorSummary } from '@/components/form/form-error-summary'
import { MarkdownField } from '@/components/form/markdown-field'
import { ValidityRange } from '@/components/form/validity-range'
import {
  Field,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { CalendarIcon } from '@/components/icons'
import { useZodForm } from '@/hooks/use-zod-form'
import { fieldControlId } from '@/lib/form-errors'
import type { StoredValidity } from '@/lib/validity-range'

describe('Field', () => {
  it('names the control with its label and describes it with the hint, counter and error', () => {
    render(
      <Field invalid>
        <FieldLabel icon={CalendarIcon} optional>
          Date you read it
        </FieldLabel>
        <FieldDescription>The day you read the source.</FieldDescription>
        <Input size="lg" defaultValue="tomorrow" />
        <FieldFooter>
          <FieldError>Enter a day like 4 Aug 2026.</FieldError>
          <FieldCounter count={8} max={10} />
        </FieldFooter>
      </Field>,
    )
    const input = screen.getByRole('textbox', { name: 'Date you read it (optional)' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    for (const part of [
      'The day you read the source.',
      '8 of 10 characters',
      'Enter a day like 4 Aug 2026.',
    ])
      expect(input).toHaveAccessibleDescription(expect.stringContaining(part))
    expect(input).toHaveClass('h-control-lg')
  })

  it('shows no error and no aria-invalid without a message', () => {
    render(
      <Field>
        <FieldLabel>Title</FieldLabel>
        <Input />
        <FieldError>{undefined}</FieldError>
      </Field>,
    )
    expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText(/Enter/)).toBeNull()
  })

  it('counts characters against the maximum and says by how much it is over', () => {
    const counter = (count: number, max: number) => (
      <Field>
        <FieldCounter count={count} max={max} />
      </Field>
    )
    const { rerender } = render(counter(96, 280))
    expect(screen.getByText('96 of 280 characters')).not.toHaveAttribute('data-over')
    rerender(counter(1204, 20000))
    expect(screen.getByText('1,204 of 20,000 characters')).toBeInTheDocument()
    rerender(counter(281, 280))
    expect(screen.getByText('281 of 280 characters, 1 too many')).toHaveAttribute('data-over')
  })
})

describe('NativeSelect', () => {
  it('is labelled and described by its field, and reports the choice', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Field>
        <FieldLabel>Domain</FieldLabel>
        <FieldDescription>The owner of this domain reviews it.</FieldDescription>
        <NativeSelect
          size="lg"
          defaultValue="a"
          onChange={(event) => {
            onChange(event.target.value)
          }}
        >
          <NativeSelectOption value="a">Commercial</NativeSelectOption>
          <NativeSelectOption value="b">Marketing</NativeSelectOption>
        </NativeSelect>
      </Field>,
    )
    const select = screen.getByRole('combobox', { name: 'Domain' })
    expect(select).toHaveAccessibleDescription('The owner of this domain reviews it.')
    await user.selectOptions(select, 'b')
    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('BlockedButton', () => {
  it('stays focusable, never acts, and says why', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <div onClick={onClick}>
        <BlockedButton reason="Answer tests on the whole domain are still running. About 9 minutes.">
          Accept
        </BlockedButton>
      </div>,
    )
    const button = screen.getByRole('button', { name: 'Accept' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveAccessibleDescription(/still running/)
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Accept is blocked')).toBeInTheDocument()
  })
})

describe('ErrorSummary', () => {
  it('takes focus, lists the problems and moves focus to a field from its link', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ErrorSummary
          errors={[
            { field: 'kind', message: 'Choose a kind.', label: 'Kind' },
            { field: 'summary', message: 'Say what happened.', label: 'What happened' },
            { field: 'areaId', message: 'Choose a domain.', label: 'Domain' },
          ]}
        />
        <input id={fieldControlId('summary')} aria-label="What happened" />
      </>,
    )
    const summary = screen.getByRole('alert')
    await waitFor(() => expect(summary).toHaveFocus())
    expect(summary).toHaveAccessibleName('Fix these 3 problems first')
    await user.click(screen.getByRole('link', { name: 'What happened: Say what happened.' }))
    expect(screen.getByRole('textbox', { name: 'What happened' })).toHaveFocus()
  })

  it('renders nothing without errors', () => {
    const { container } = render(<ErrorSummary errors={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

function ControlledDate({ initial = null as string | null, onChange = vi.fn() }) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  return (
    <Field invalid={Boolean(error)}>
      <FieldLabel>From</FieldLabel>
      <DateField
        value={value}
        onValueChange={(next) => {
          setValue(next)
          onChange(next)
        }}
        onTextError={setError}
      />
      <FieldError>{error}</FieldError>
    </Field>
  )
}

describe('DateField', () => {
  it('reads a typed day when the field is left, and writes it the app way', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledDate onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'From' })
    await user.type(input, '2026-08-04')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith('2026-08-04')
    expect(input).toHaveValue('4 Aug 2026')
  })

  it('says when the text is not a day, and keeps the text', async () => {
    const user = userEvent.setup()
    render(<ControlledDate initial="2026-08-04" />)
    const input = screen.getByRole('textbox', { name: 'From' })
    await user.clear(input)
    await user.type(input, '31 Feb 2026{Enter}')
    expect(input).toHaveValue('31 Feb 2026')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(DAY_FORMAT_MESSAGE)
  })

  it('opens a calendar from its button and picks a day with the keyboard', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledDate initial="2026-08-04" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Choose a day' }))
    const grid = await screen.findByRole('grid')
    expect(grid).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement?.closest('[role="grid"]')).toBe(grid))
    await user.keyboard('{ArrowRight}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('2026-08-05')
    expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue('5 Aug 2026')
  })

  it('opens the calendar from a click in the text, and typing still goes to the text', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledDate initial="2026-08-04" onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'From' })
    await user.click(input)
    expect(await screen.findByRole('grid')).toBeInTheDocument()
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, '9 Aug 2026{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('2026-08-09')
    await waitFor(() => expect(screen.queryByRole('grid')).not.toBeInTheDocument())
  })

  it('picks a day with a click after typing in the text', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledDate initial="2026-08-04" onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'From' })
    await user.click(input)
    await user.type(input, 'x')
    // Leaving the text re-renders the field; the calendar must keep its buttons under the click.
    await user.click(await screen.findByRole('button', { name: /August 12th, 2026/ }))
    expect(onChange).toHaveBeenLastCalledWith('2026-08-12')
    expect(input).toHaveValue('12 Aug 2026')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('opens the calendar from the text with the down arrow', async () => {
    const user = userEvent.setup()
    render(<ControlledDate initial="2026-08-04" />)
    screen.getByRole('textbox', { name: 'From' }).focus()
    await user.keyboard('{ArrowDown}')
    const grid = await screen.findByRole('grid')
    await waitFor(() => expect(document.activeElement?.closest('[role="grid"]')).toBe(grid))
  })
})

function Range({
  kind = 'standing' as 'standing' | 'issue',
  initial = { start: '2026-09-25', end: null } as StoredValidity,
  onChange = vi.fn(),
}) {
  const [value, setValue] = useState(initial)
  return (
    <ValidityRange
      kind={kind}
      value={value}
      onValueChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

describe('ValidityRange', () => {
  it('shows the last day and reports the stored, exclusive end', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Range initial={{ start: '2026-09-25', end: '2026-10-07' }} onChange={onChange} />)
    const until = screen.getByRole('textbox', { name: 'Until' })
    expect(until).toHaveValue('6 Oct 2026')
    await user.clear(until)
    await user.type(until, '10 Oct 2026')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-09-25', end: '2026-10-11' })
  })

  it('allows no end date, and removes one with its button', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Range initial={{ start: '2026-09-25', end: '2026-10-07' }} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Remove the end date' }))
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-09-25', end: null })
    expect(screen.getByRole('textbox', { name: 'Until' })).toHaveValue('')
  })

  it('says when the last day is before the first', async () => {
    const user = userEvent.setup()
    render(<Range />)
    const until = screen.getByRole('textbox', { name: 'Until' })
    await user.type(until, '20 Sep 2026')
    await user.tab()
    expect(until).toHaveAccessibleDescription('The last day must be on or after the first day.')
  })

  it('asks an issue whether it is still going on, and for the last day once it ended', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Range kind="issue" onChange={onChange} />)
    expect(screen.getByRole('textbox', { name: 'Started' })).toHaveValue('25 Sept 2026')
    expect(screen.getByRole('radio', { name: 'Still going on' })).toBeChecked()
    expect(screen.queryByRole('textbox', { name: 'Last day' })).toBeNull()
    expect(screen.getByText(/we ask again in 14 days/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'It ended' }))
    const last = screen.getByRole('textbox', { name: 'Last day' })
    await user.type(last, '6 Oct 2026')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-09-25', end: '2026-10-07' })
    expect(
      screen.getByText(/questions about 25 September 2026 to 6 October 2026/),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Still going on' }))
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-09-25', end: null })
  })

  it('does not bring back a Last day error after switching away and back', async () => {
    const user = userEvent.setup()
    render(<Range kind="issue" />)
    await user.click(screen.getByRole('radio', { name: 'It ended' }))
    await user.type(screen.getByRole('textbox', { name: 'Last day' }), 'whenever')
    await user.tab()
    expect(screen.getByText('Enter a day like 4 Aug 2026.')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Still going on' }))
    await user.click(screen.getByRole('radio', { name: 'It ended' }))
    expect(screen.getByRole('textbox', { name: 'Last day' })).toHaveValue('')
    expect(screen.queryByText('Enter a day like 4 Aug 2026.')).toBeNull()
  })
})

function Markdown({ initial = '', max = 20000 }) {
  const [value, setValue] = useState(initial)
  return (
    <Field>
      <FieldLabel>Longer explanation</FieldLabel>
      <MarkdownField value={value} onValueChange={setValue} max={max} />
    </Field>
  )
}

describe('MarkdownField', () => {
  it('writes plain text and previews the safe subset, keeping the text', async () => {
    const user = userEvent.setup()
    render(<Markdown />)
    const text = screen.getByRole('textbox', { name: 'Longer explanation' })
    await user.type(text, '## How to check')
    expect(text).toHaveAccessibleDescription('15 of 20,000 characters')
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByRole('heading', { name: 'How to check' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Write' }))
    expect(screen.getByRole('textbox', { name: 'Longer explanation' })).toHaveValue(
      '## How to check',
    )
  })

  it('says when there is nothing to preview, and marks a text over the maximum', async () => {
    const user = userEvent.setup()
    render(<Markdown initial="Too long" max={5} />)
    expect(screen.getByText('8 of 5 characters, 3 too many')).toHaveAttribute('data-over')
    await user.clear(screen.getByRole('textbox', { name: 'Longer explanation' }))
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByText('Nothing to preview yet.')).toBeInTheDocument()
  })

  it('moves between Write and Preview with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<Markdown />)
    await user.click(screen.getByRole('tab', { name: 'Write' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveFocus()
  })
})

const schema = z.object({
  title: z.string().check(z.minLength(1, 'Give it a title.')),
  domain: z.string().check(z.minLength(1, 'Choose a domain.')),
  quote: z.string().check(z.minLength(1, 'Add a short quote.')),
})

function ExampleForm({ onSubmit = vi.fn() }) {
  const form = useZodForm(schema, { defaultValues: { title: '', domain: '', quote: '' } })
  const field = (name: 'title' | 'domain' | 'quote', label: string) => {
    const error = form.formState.errors[name]?.message
    return (
      <Field invalid={Boolean(error)}>
        <FieldLabel>{label}</FieldLabel>
        <Input id={fieldControlId(name)} {...form.register(name)} />
        <FieldError>{error}</FieldError>
      </Field>
    )
  }
  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
      <FormErrorSummary
        control={form.control}
        order={['title', 'domain', 'quote']}
        labels={{ title: 'Title', domain: 'Domain', quote: 'Quote' }}
      />
      {field('title', 'Title')}
      {field('domain', 'Domain')}
      {field('quote', 'Quote')}
      <button type="submit">Send for review</button>
    </form>
  )
}

describe('form validation timing (contract 9.9)', () => {
  it('checks a field when it is left, then on every change once it has an error', async () => {
    const user = userEvent.setup()
    render(<ExampleForm />)
    const title = screen.getByRole('textbox', { name: 'Title' })
    await user.type(title, 'x')
    await user.clear(title)
    expect(screen.queryByText('Give it a title.')).toBeNull()
    await user.tab()
    expect(await screen.findByText('Give it a title.')).toBeInTheDocument()
    await user.click(title)
    await user.type(title, 'A')
    await waitFor(() => expect(screen.queryByText('Give it a title.')).toBeNull())
  })

  it('lists three or more problems at the top after a submit, in page order', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ExampleForm onSubmit={onSubmit} />)
    await user.click(screen.getByRole('button', { name: 'Send for review' }))
    const summary = await screen.findByRole('alert')
    expect(onSubmit).not.toHaveBeenCalled()
    expect([...summary.querySelectorAll('a')].map((link) => link.textContent)).toEqual([
      'Title: Give it a title.',
      'Domain: Choose a domain.',
      'Quote: Add a short quote.',
    ])
    await waitFor(() => expect(summary).toHaveFocus())
  })

  it('keeps one or two problems next to their fields only', async () => {
    const user = userEvent.setup()
    render(<ExampleForm />)
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Regulator pause')
    await user.click(screen.getByRole('button', { name: 'Send for review' }))
    expect(await screen.findByText('Choose a domain.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
