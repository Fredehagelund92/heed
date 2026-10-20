import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { StoryApp } from './story-app'

/**
 * What changed between two editions (Editions design, slice S2) in the real shell with the
 * mock: the overall result grouped by the kind of change, an item open in the docked panel field
 * by field, edition by edition, and the page's states (loading, nothing different, an unknown
 * edition, a failed read and a long range). Ravi Kapoor, the administrator, reads it.
 */
const meta = {
  title: 'Release/What changed between editions',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const admin = 'per_ravi'
const phone = { viewport: { value: 'phone', isRotated: false } }

/** Ten editions of the mock: eight items added, the demo's regression changed, one saved again. */
const RANGE = 'since=2026-09-10.2&until=2026-10-07.1'
/** The demo's one regression: its second version ended the note. */
const REGRESSION = 'itm_q2upr28v'

const page = (query = RANGE) => `/editions/compare?${query}`

/** The overall result: a sentence, the counts, the groups, Filter and the Viewed boxes. */
export const OverallResult: Story = {
  render: () => <StoryApp path={page()} person={admin} />,
  play: async () => {
    const list = await screen.findByRole('table', { name: 'Changed facts' }, { timeout: 10_000 })
    await expect(within(list).getByRole('button', { name: /^Changed, 1 fact/ })).toBeVisible()
    await expect(screen.getByText(/10 items in /)).toBeVisible()
  },
}

/** Marking an item viewed with its box: the row turns quiet and the count moves. */
export const Viewed: Story = {
  render: () => (
    <StoryApp path={page()} person={admin} preferences={{ 'cl.editions.viewed': [] }} />
  ),
  play: async () => {
    const list = await screen.findByRole('table', { name: 'Changed facts' }, { timeout: 10_000 })
    const box = within(list).getAllByRole('checkbox')[0]!
    await userEvent.click(box)
    await expect(box).toBeChecked()
    await waitFor(() => expect(screen.getByText(/of 10 viewed/)).toBeVisible())
  },
}

/** The demo's regression open in the docked panel: the end date it gained, who and why. */
export const ItemOpen: Story = {
  render: () => <StoryApp path={page(`${RANGE}&item=${REGRESSION}`)} person={admin} />,
  play: async () => {
    const panel = await screen.findByRole(
      'region',
      { name: 'Net revenue excludes test accounts' },
      { timeout: 10_000 },
    )
    await expect(
      await within(panel).findByRole('article', {
        name: 'What changed in Net revenue excludes test accounts',
      }),
    ).toBeVisible()
  },
}

/** Edition by edition: each edition in the range, newest first, with its sentence and items. */
export const EditionByEdition: Story = {
  render: () => <StoryApp path={page(`${RANGE}&view=steps`)} person={admin} />,
  play: async () => {
    await expect(
      await screen.findByRole(
        'list',
        { name: 'Editions in this range, newest first' },
        { timeout: 10_000 },
      ),
    ).toBeVisible()
  },
}

/** The whole history since the first edition: a long list, the closed "saved again" group. */
export const LongRange: Story = {
  render: () => <StoryApp path={page('since=2024-01-01.1&until=2026-10-07.1')} person={admin} />,
}

/** Filtered to one domain, with its chip. */
export const Filtered: Story = {
  render: () => <StoryApp path={page(`${RANGE}&area=area_sales`)} person={admin} />,
}

/** One edition against itself: nothing can differ, and the page says why. */
export const NothingDifferent: Story = {
  render: () => <StoryApp path={page('since=2026-10-07.1&until=2026-10-07.1')} person={admin} />,
}

/** A number that is not an edition. */
export const UnknownEdition: Story = {
  render: () => <StoryApp path={page('since=2020-01-01.9&until=2026-10-07.1')} person={admin} />,
}

/** While it loads: the summary and the rows as skeletons at their real height. */
export const Loading: Story = {
  render: () => <StoryApp path={page()} scenario="slow" person={admin} />,
}

/** The read failed: what failed, and Try again. */
export const Failed: Story = {
  render: () => <StoryApp path={page()} scenario="error" person={admin} />,
}

/** A contributor is told whose page it is. */
export const Contributor: Story = {
  render: () => <StoryApp path={page()} />,
}

export const Phone: Story = {
  globals: phone,
  render: () => <StoryApp path={page()} person={admin} />,
}

export const PhoneItemOpen: Story = {
  globals: phone,
  render: () => <StoryApp path={page(`${RANGE}&item=${REGRESSION}`)} person={admin} />,
}
