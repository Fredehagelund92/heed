import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { Markdown } from '@/components/form/markdown'
import { MarkdownField } from '@/components/form/markdown-field'
import { Field, FieldDescription, FieldHeader, FieldLabel } from '@/components/ui/field'
import { FileTextIcon } from '@/components/icons'
import { StoryPaper } from './form-story-parts'

const meta = {
  title: 'Forms/Markdown field',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const sampleGuide = [
  '## How to check',
  '',
  '1. Compare @[Norway](val:market/norway) with @[Spain](val:market/spain).',
  '2. Use @[Orders](metric:orders), not the **old** tool.',
  '',
  '> The regulator paused advertising from 15 June.',
  '',
  'Read [the notice](https://regulator.example/notices/2026-06) and keep `net_revenue` in mind.',
  '',
  '### What is not shown',
  '',
  '![a chart](https://example.com/chart.png) and <b>raw HTML</b> stay as typed.',
  '',
  '| Market | Share |',
  '| --- | --- |',
  '| Norway | 40% |',
  '',
  '[A javascript link](javascript:alert(1)) is not a link.',
].join('\n')

function ItemText({
  initial = '',
  max = 20000,
  tab,
  label = 'Longer explanation',
}: {
  initial?: string
  max?: number
  tab?: 'write' | 'preview'
  label?: string
}) {
  const [value, setValue] = useState(initial)
  return (
    <Field>
      <FieldHeader>
        <FieldLabel icon={FileTextIcon} optional>
          {label}
        </FieldLabel>
        <FieldDescription>Markdown works: headings, lists, links and quotes.</FieldDescription>
      </FieldHeader>
      <MarkdownField
        value={value}
        onValueChange={setValue}
        max={max}
        defaultTab={tab}
        error={
          [...value].length > max
            ? `Shorten it by ${[...value].length - max} characters.`
            : undefined
        }
      />
    </Field>
  )
}

export const Empty: Story = {
  render: () => (
    <StoryPaper>
      <ItemText />
    </StoryPaper>
  ),
}

/** Write, then Preview with the arrow keys: the text survives the switch. */
export const Write: Story = {
  render: () => (
    <StoryPaper>
      <ItemText initial={sampleGuide} />
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const write = canvas.getByRole('tab', { name: 'Write' })
    await userEvent.click(write)
    await userEvent.keyboard('{ArrowRight}{Enter}')
    await expect(canvas.getByRole('tab', { name: 'Preview' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getByRole('heading', { name: 'How to check' })).toBeVisible()
    await expect(canvasElement.querySelector('img, table, script')).toBeNull()
    await userEvent.click(canvas.getByRole('tab', { name: 'Write' }))
    await expect(canvas.getByRole('textbox', { name: /Longer explanation/ })).toHaveValue(
      sampleGuide,
    )
  },
}

/** The safe subset drawn, and what is refused left as the typed text. */
export const Preview: Story = {
  render: () => (
    <StoryPaper>
      <ItemText initial={sampleGuide} tab="preview" />
    </StoryPaper>
  ),
}

export const OverTheMaximum: Story = {
  render: () => (
    <StoryPaper>
      <ItemText initial={sampleGuide} max={400} />
    </StoryPaper>
  ),
}

/** The renderer alone, as the item page and the review diff will use it. */
export const Renderer: Story = {
  render: () => (
    <StoryPaper>
      <Markdown source={sampleGuide} />
    </StoryPaper>
  ),
}
