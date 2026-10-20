import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { ErrorSummary } from '@/components/form/error-summary'
import { SaveStatus } from '@/components/form/save-status'
import { Button } from '@/components/ui/button'
import { Field, FieldControl, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { FormKitSample, useFormKitSample } from './form-kit-sample'
import { useAutosave } from '@/hooks/use-autosave'
import { StateRow, StoryPaper } from './form-story-parts'

const meta = {
  title: 'Forms/Validation and autosave',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/**
 * The sample form: every part, checked on leaving a field and then on every change, with the
 * error summary after a submit with three or more problems.
 */
export const SampleForm: Story = {
  render: function Render() {
    const { form, autosave } = useFormKitSample()
    return (
      <StoryPaper>
        <SaveStatus
          status={autosave.status}
          savedAt={autosave.savedAt}
          retrying={autosave.retrying}
          onRetry={autosave.retry}
        />
        <FormKitSample form={form} />
      </StoryPaper>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Send for review' }))
    const summary = await canvas.findByRole('alert')
    await waitFor(() => expect(summary).toHaveFocus())
    await userEvent.click(within(summary).getByRole('link', { name: /What happened/ }))
    const summaryField = canvas.getByRole('textbox', { name: 'What happened' })
    await expect(summaryField).toHaveFocus()
    await userEvent.type(summaryField, 'Online sales to Norway stopped on 4 August 2026.')
    await waitFor(() => expect(summaryField).not.toHaveAttribute('aria-invalid'))
    await expect(await canvas.findByText(/^Saved \d\d:\d\d$/)).toBeVisible()
  },
}

export const Summary: Story = {
  render: () => (
    <StoryPaper>
      <ErrorSummary
        errors={[
          {
            field: 'summary',
            label: 'What happened',
            message: 'Say what happened in a sentence or two.',
          },
          {
            field: 'scope',
            label: 'Where it applies',
            message: 'Add at least one metric or market.',
          },
          { field: 'areaId', label: 'Domain', message: 'Choose the domain that reviews it.' },
        ]}
      />
    </StoryPaper>
  ),
}

/** Every save state, as the header of a write page shows it. */
export const SaveStates: Story = {
  render: () => (
    <StoryPaper>
      <StateRow name="Nothing saved yet">
        <SaveStatus status="idle" savedAt={null} retrying={false} />
      </StateRow>
      <StateRow name="Saving">
        <SaveStatus status="saving" savedAt={null} retrying={false} />
      </StateRow>
      <StateRow name="Saved">
        <SaveStatus status="saved" savedAt={new Date(2026, 9, 8, 9, 41)} retrying={false} />
      </StateRow>
      <StateRow name="Not saved, trying again">
        <SaveStatus status="failed" savedAt={null} retrying onRetry={() => undefined} />
      </StateRow>
      <StateRow name="Not saved, needs you">
        <SaveStatus status="failed" savedAt={null} retrying={false} onRetry={() => undefined} />
      </StateRow>
    </StoryPaper>
  ),
}

/** Live: every second save fails, so "Not saved. Trying again" and the recovery can be watched. */
export const AutosaveLive: Story = {
  render: function Render() {
    const [text, setText] = useState('')
    const [online, setOnline] = useState(true)
    const autosave = useAutosave({
      value: text,
      save: () =>
        new Promise((resolve, reject) =>
          window.setTimeout(
            () => (online ? resolve(undefined) : reject(new Error('Offline'))),
            300,
          ),
        ),
      retryDelays: [2000],
    })
    return (
      <StoryPaper>
        <div className="flex items-center justify-between gap-4">
          <SaveStatus
            status={autosave.status}
            savedAt={autosave.savedAt}
            retrying={autosave.retrying}
            onRetry={autosave.retry}
          />
          <Button variant="outline" onClick={() => setOnline((now) => !now)}>
            {online ? 'Go offline' : 'Go online'}
          </Button>
        </div>
        <Field>
          <FieldLabel>What happened</FieldLabel>
          <FieldControl value={text} onValueChange={setText} render={<Textarea rows={3} />} />
        </Field>
      </StoryPaper>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'What happened' }), 'Paused')
    await expect(await canvas.findByText(/^Saved \d\d:\d\d$/, {}, { timeout: 3000 })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Go offline' }))
    await userEvent.type(canvas.getByRole('textbox', { name: 'What happened' }), ' in Norway')
    await expect(
      await canvas.findByText('Not saved. Trying again', {}, { timeout: 3000 }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Go online' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Try now' }))
    await expect(await canvas.findByText(/^Saved \d\d:\d\d$/, {}, { timeout: 3000 })).toBeVisible()
  },
}
