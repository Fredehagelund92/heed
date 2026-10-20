import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import {
  Field,
  FieldDescription,
  FieldItem,
  FieldItemContent,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { DomainBadge } from '@/components/item/item-marks'
import { ScaleIcon } from '@/components/icons'
import { LONG_LABEL, StateRow, StoryPaper, stateParameters } from './form-story-parts'

const meta = {
  title: 'Forms/Radio group and switch',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function ScopeChoice({
  legend = 'What to stop',
  defaultValue = 'domain',
  disabled = false,
}: {
  legend?: string
  defaultValue?: string
  disabled?: boolean
}) {
  return (
    <Field disabled={disabled}>
      <FieldSet render={<RadioGroup defaultValue={defaultValue} disabled={disabled} />}>
        <FieldLegend>{legend}</FieldLegend>
        <FieldItem>
          <RadioGroupItem value="domain" />
          <FieldItemContent>
            <FieldLabel>One domain</FieldLabel>
            <DomainBadge name="Sales" label="teal" size="sm" />
          </FieldItemContent>
        </FieldItem>
        <FieldItem>
          <RadioGroupItem value="everything" />
          <FieldItemContent>
            <FieldLabel>Everything</FieldLabel>
            <FieldDescription>Every domain stops at once.</FieldDescription>
          </FieldItemContent>
        </FieldItem>
        <FieldItem>
          <RadioGroupItem value="item" />
          <FieldItemContent>
            <FieldLabel>One item</FieldLabel>
          </FieldItemContent>
        </FieldItem>
      </FieldSet>
    </Field>
  )
}

/** One tab stop for the group; the arrow keys move and choose. */
export const Radios: Story = {
  render: () => (
    <StoryPaper>
      <ScopeChoice />
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const domain = canvas.getByRole('radio', { name: 'One domain' })
    await expect(domain).toBeChecked()
    await expect(canvas.getByRole('radio', { name: 'Everything' })).toHaveAccessibleDescription(
      'Every domain stops at once.',
    )
    await userEvent.click(domain)
    await userEvent.keyboard('{ArrowDown}')
    await expect(canvas.getByRole('radio', { name: 'Everything' })).toBeChecked()
    await expect(canvas.getByRole('radio', { name: 'Everything' })).toHaveFocus()
  },
}

export const RadioStates: Story = {
  parameters: stateParameters,
  render: () => (
    <StoryPaper>
      <StateRow name="Default">
        <ScopeChoice />
      </StateRow>
      <StateRow name="Hover" id="state-hover">
        <ScopeChoice />
      </StateRow>
      <StateRow name="Focus visible" id="state-focus">
        <ScopeChoice />
      </StateRow>
      <StateRow name="Disabled">
        <ScopeChoice disabled />
      </StateRow>
      <StateRow name="200 character legend">
        <ScopeChoice legend={LONG_LABEL} />
      </StateRow>
    </StoryPaper>
  ),
}

function Setting({
  label = 'Tell me when an owner decides',
  checked,
  disabled = false,
}: {
  label?: string
  checked: boolean
  disabled?: boolean
}) {
  return (
    <Field disabled={disabled}>
      <FieldItem>
        <Switch defaultChecked={checked} disabled={disabled} />
        <FieldItemContent>
          <FieldLabel>{label}</FieldLabel>
          <FieldDescription>In the bell and by email.</FieldDescription>
        </FieldItemContent>
      </FieldItem>
    </Field>
  )
}

/** A setting that takes effect at once. Space toggles it. */
export const Switches: Story = {
  render: () => (
    <StoryPaper>
      <Setting checked />
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('switch', { name: 'Tell me when an owner decides' })
    await expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    await expect(toggle).not.toBeChecked()
    await userEvent.keyboard(' ')
    await expect(toggle).toBeChecked()
  },
}

export const SwitchStates: Story = {
  parameters: stateParameters,
  render: () => (
    <StoryPaper>
      <StateRow name="On">
        <Setting checked />
      </StateRow>
      <StateRow name="Off">
        <Setting checked={false} />
      </StateRow>
      <StateRow name="Hover" id="state-hover">
        <Setting checked={false} />
      </StateRow>
      <StateRow name="Focus visible" id="state-focus">
        <Setting checked />
      </StateRow>
      <StateRow name="Disabled">
        <Setting checked disabled />
      </StateRow>
      <StateRow name="200 character label">
        <Setting checked label={LONG_LABEL} />
      </StateRow>
    </StoryPaper>
  ),
}

/** A radio group under a legend with a field icon, as in the sample form. */
export const WithHints: Story = {
  render: () => (
    <StoryPaper>
      <Field>
        <FieldSet render={<RadioGroup defaultValue="fact_only" />}>
          <FieldLegend icon={ScaleIcon}>What the source says</FieldLegend>
          <FieldItem>
            <RadioGroupItem value="fact_only" />
            <FieldItemContent>
              <FieldLabel>A fact only</FieldLabel>
              <FieldDescription>
                An agent says it might be related, never that it caused a change.
              </FieldDescription>
            </FieldItemContent>
          </FieldItem>
          <FieldItem>
            <RadioGroupItem value="effect_stated" />
            <FieldItemContent>
              <FieldLabel>A named authority states the effect</FieldLabel>
              <FieldDescription>Quote the sentence that states it.</FieldDescription>
            </FieldItemContent>
          </FieldItem>
        </FieldSet>
      </Field>
    </StoryPaper>
  ),
}
