import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { StoryApp } from './story-app'

/**
 * Release and editions (slice W6, plan frames D1 and D2; Editions design slices S3 and S5) in the
 * real shell with the mock: the editions as release notes with the live edition, an edition open
 * in the docked panel with what it changed, the table, the edition page, the guarded release
 * dialogs (go back and stop delivery, each with the real effect first, the confirmation, and what
 * happened with its undo; a refused go back), switching delivery back on, and the banner everyone
 * sees while delivery is stopped. Editions sit under Admin: Ravi Kapoor, the administrator, runs
 * them; Maria Lindqvist, a contributor, is told whose page it is.
 */
const meta = {
  title: 'Release/Editions',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const admin = 'per_ravi'
const phone = { viewport: { value: 'phone', isRotated: false } }

/** A contributor does not see Editions in the menu; the address opened anyway is refused. */
export const Contributor: Story = { render: () => <StoryApp path="/editions" /> }

/** The feed: the live edition with What changed first, then each edition as a release note. */
export const Feed: Story = {
  render: () => <StoryApp path="/editions" person={admin} />,
}

/** An earlier edition open in the docked panel: what it changed, field by field. */
export const Administrator: Story = {
  render: () => <StoryApp path="/editions?edition=2026-10-02.1" person={admin} />,
}

/** The table, the feed's other view. */
export const Table: Story = {
  render: () => <StoryApp path="/editions?view=table" person={admin} />,
}

/** An edition open from the table. */
export const TableEditionOpen: Story = {
  render: () => <StoryApp path="/editions?view=table&edition=2026-10-07.1" person={admin} />,
}

/** The second page of the table, which ends with the first edition. */
export const SecondPage: Story = {
  render: () => <StoryApp path="/editions?view=table&page=2" person={admin} />,
}

/** The list while it loads: skeleton rows keep the row height. */
export const Loading: Story = {
  render: () => <StoryApp path="/editions" scenario="slow" person={admin} />,
}

/** One edition: its facts, every change and export. */
export const EditionPage: Story = {
  render: () => <StoryApp path="/editions/2026-10-07.1" person={admin} />,
}

/** An earlier edition, for the administrator: going back is in its overflow menu. */
export const EarlierEditionPage: Story = {
  render: () => <StoryApp path="/editions/2026-09-27.1" person={admin} />,
}

/** A number that is not an edition. */
export const UnknownEdition: Story = {
  render: () => <StoryApp path="/editions/2020-01-01.9" person={admin} />,
}

export const PhoneList: Story = {
  globals: phone,
  render: () => <StoryApp path="/editions" person={admin} />,
}

/** On a phone an edition opens as a full-screen sheet. */
export const PhoneEditionOpen: Story = {
  globals: phone,
  render: () => <StoryApp path="/editions?edition=2026-10-07.1" person={admin} />,
}

/** Opens the go back dialog of an edition from its overflow menu in the docked panel. */
async function openGoBack(label: string) {
  const panel = await screen.findByRole('region', { name: `Edition ${label}` }, { timeout: 10_000 })
  await userEvent.click(within(panel).getByRole('button', { name: `Actions for edition ${label}` }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Go back to this edition…' }))
  return screen.findByRole('alertdialog', { name: /^Go back to how it was on / })
}

/** Go back, step 1: what changes for AI apps, fact by fact, read before anything is done. */
export const GoBackDialog: Story = {
  render: () => <StoryApp path="/editions?edition=2026-10-02.1" person={admin} />,
  play: async () => {
    const dialog = await openGoBack('2026-10-02.1')
    await waitFor(() =>
      expect(dialog).toHaveTextContent('2 facts change for AI apps: 2 stop being shared.'),
    )
  },
}

/** Go back, step 2: the reason for the history log and the edition number typed to confirm. */
export const GoBackConfirm: Story = {
  render: () => <StoryApp path="/editions?edition=2026-10-02.1" person={admin} />,
  play: async () => {
    const dialog = await openGoBack('2026-10-02.1')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Continue' }))
    await expect(
      within(dialog).getByRole('textbox', { name: 'Type 2026-10-02.1 to confirm' }),
    ).toBeVisible()
  },
}

/** Go back, done: what happened, from the history log, and the way to undo it. */
export const GoBackDone: Story = {
  render: () => <StoryApp path="/editions?edition=2026-10-02.1" person={admin} />,
  play: async () => {
    const dialog = await openGoBack('2026-10-02.1')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Continue' }))
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Why are you going back?' }),
      'The Spain outage note was wrong.',
    )
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Type 2026-10-02.1 to confirm' }),
      '2026-10-02.1',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Go back' }))
    const done = await screen.findByRole('alertdialog', { name: 'Went back to 2 October 2026' })
    await waitFor(() => expect(done).toHaveTextContent('Ravi Kapoor went back to 2026-10-02.1'))
  },
}

/** Going back refused: a version in the edition can't be shared again, and it is named. */
export const GoBackBlocked: Story = {
  render: () => (
    <StoryApp path="/editions?edition=2026-08-02.1" scenario="rollback-blocked" person={admin} />
  ),
  play: async () => {
    const dialog = await openGoBack('2026-08-02.1')
    await waitFor(() => expect(dialog).toHaveTextContent("You can't go back to this edition"))
    await expect(
      within(dialog).getByRole('list', { name: "Versions that can't be shared again" }),
    ).toHaveTextContent("A check this version needs hasn't passed.")
  },
}

/** Opens Stop sharing from the overflow menu of the card of what AI apps get today. */
async function openStop() {
  await userEvent.click(
    await screen.findByRole(
      'button',
      { name: 'More actions for this edition' },
      { timeout: 10_000 },
    ),
  )
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop sharing…' }))
  return screen.findByRole('alertdialog', { name: 'Stop sharing with AI apps?' })
}

/** Stop sharing, step 1: one domain by default, and how many facts AI apps stop getting. */
export const StopDialog: Story = {
  render: () => <StoryApp path="/editions" person={admin} />,
  play: async () => {
    const dialog = await openStop()
    await expect(within(dialog).getByRole('radio', { name: 'One domain' })).toBeChecked()
    await waitFor(() =>
      expect(dialog).toHaveTextContent('facts in Sales. Other domains stay as they are.'),
    )
  },
}

/** Stop sharing, done: what happened, from the history log, and starting again. */
export const StopDone: Story = {
  render: () => <StoryApp path="/editions" person={admin} />,
  play: async () => {
    const dialog = await openStop()
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Continue' }))
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Why are you stopping it?' }),
      'A wrong caveat is reaching answers.',
    )
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Type Sales to confirm' }),
      'Sales',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop sharing' }))
    const done = await screen.findByRole('alertdialog', { name: 'Stopped for Sales' })
    await expect(within(done).getByRole('button', { name: 'Start again…' })).toBeVisible()
  },
}

/** Sharing stopped for a domain: the banner on every page, Start again on the card. */
export const DeliveryStopped: Story = {
  render: () => <StoryApp path="/editions" person={admin} />,
  play: async (context) => {
    await StopDone.play!(context)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await expect(await screen.findByRole('region', { name: 'Sharing stopped' })).toHaveTextContent(
      'AI apps get no facts from Sales for now.',
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  },
}

/** Starting again: a reason, no typing. */
export const SwitchOnDialog: Story = {
  render: () => <StoryApp path="/editions" person={admin} />,
  play: async (context) => {
    await DeliveryStopped.play!(context)
    await userEvent.click(screen.getByRole('button', { name: 'Start again…' }))
    await expect(
      await screen.findByRole('alertdialog', { name: 'Start sharing Sales again?' }),
    ).toBeVisible()
  },
}
