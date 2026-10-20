import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, within } from 'storybook/test'
import { StoryApp } from './story-app'

/**
 * The release actions on the fact page (slice W6): the owner's check, Archive fact for an owner
 * or admin, and Suggest archiving for everyone else, each in the one confirmation dialog (plan
 * frame D2).
 */
const meta = {
  title: 'Release/Item actions',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const openMenuItem = (name: string) => async () => {
  await userEvent.click(
    await screen.findByRole('button', { name: 'More actions' }, { timeout: 10_000 }),
  )
  await userEvent.click(await screen.findByRole('menuitem', { name }))
}

/** An owner archives at once: the effect says how many facts mention it. */
export const Retire: Story = {
  render: () => <StoryApp path="/library/itm_gjdvl50x" person="per_jon" />,
  play: async () => {
    await openMenuItem('Archive fact')()
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive this fact?' })
    await expect(within(dialog).getByRole('button', { name: 'Archive fact' })).toBeVisible()
  },
}

/** A contributor suggests it instead; an owner of the domain decides. */
export const ProposeRetirement: Story = {
  render: () => <StoryApp path="/library/itm_jyfuvl07" />,
  play: async () => {
    await openMenuItem('Suggest archiving')()
    await expect(
      await screen.findByRole('alertdialog', { name: 'Suggest archiving this fact?' }),
    ).toHaveTextContent('An owner of Paid media decides.')
  },
}

/** Checked, still correct: what asks for the check, then what the owner checked. */
export const Recheck: Story = {
  render: () => <StoryApp path="/library/itm_6n54lyca" person="per_tomas" />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark as checked' }, { timeout: 10_000 }),
    )
    await expect(
      await screen.findByRole('alertdialog', { name: 'Checked, still correct?' }),
    ).toHaveTextContent('Source changed')
  },
}

/** An open issue past its review date: "Is this still going on?". */
export const StillGoingOn: Story = {
  render: () => <StoryApp path="/library/itm_xw5lmhcy" person="per_jon" />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Yes, still going on' }, { timeout: 10_000 }),
    )
    await expect(
      await screen.findByRole('alertdialog', { name: 'Is this still going on?' }),
    ).toBeVisible()
  },
}

/** A definition the item uses is missing: the dialog warns before the service refuses. */
export const RecheckSourceMissing: Story = {
  render: () => <StoryApp path="/library/itm_gjdvl50x" person="per_jon" />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark as checked' }, { timeout: 10_000 }),
    )
    await expect(
      await screen.findByRole('alertdialog', { name: 'Checked, still correct?' }),
    ).toHaveTextContent('A definition this fact uses is gone')
  },
}
