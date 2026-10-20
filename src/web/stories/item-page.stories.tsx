import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen } from 'storybook/test'
import { StoryApp } from './story-app'

/** The real Item page: title, badges, note and a persistent Details column, in both themes. */
const meta = {
  title: 'Library/Item page',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const phone = { viewport: { value: 'phone', isRotated: false } }

/** A guide in Paid media, accepted: no note, Applies since its date, ongoing. */
export const Accepted: Story = { render: () => <StoryApp path="/library/itm_jyfuvl07" /> }

/** An event whose last day has passed: Ended, and how long ago. */
export const Ended: Story = { render: () => <StoryApp path="/library/itm_f8p9u98w" /> }

/** A high-risk note whose source is missing: the note says it may be withheld. */
export const SourceMissing: Story = { render: () => <StoryApp path="/library/itm_gjdvl50x" /> }

/** The same note seen by the area's owner: Mark as checked, solid, leads the action group. */
export const SourceMissingForTheOwner: Story = {
  render: () => <StoryApp path="/library/itm_gjdvl50x" person="per_jon" />,
}

/** An ended event whose source also changed: both conditions show, the list shows only Ended. */
export const EndedAndSourceChanged: Story = {
  render: () => <StoryApp path="/library/itm_4u2dvokn" />,
}

/** A note past its review date: Check due, and when the check was due beside the chip. */
export const RecheckDue: Story = { render: () => <StoryApp path="/library/itm_1x7tcmzs" /> }

/** Source changed, seen by the area's owner: Mark as checked leads the action group. */
export const SourceChangedForTheOwner: Story = {
  render: () => <StoryApp path="/library/itm_6n54lyca" person="per_tomas" />,
}

/** Retired: the chip says when; its detail says it is never given to agents; no Suggest a change. */
export const Retired: Story = { render: () => <StoryApp path="/library/itm_22ooyz66" /> }

/** High risk and accepted: the soft red risk badge in the header. */
export const HighRisk: Story = { render: () => <StoryApp path="/library/itm_pkzgvmhi" /> }

/** A title of more than 140 characters. */
export const LongTitle: Story = { render: () => <StoryApp path="/library/itm_j61anjl3" /> }

/** Four versions in the History tab, one row each. */
export const FourVersions: Story = {
  render: () => <StoryApp path="/library/itm_t01rt1yr?tab=history" />,
}

/** Source keeps evidence and explanations beside the persistent facts. */
export const SourceTab: Story = {
  render: () => <StoryApp path="/library/itm_gjdvl50x?tab=source" />,
}

/** The Links tab: what the text mentions and which items mention it. */
export const LinksTab: Story = {
  render: () => <StoryApp path="/library/itm_jyfuvl07?tab=links" />,
}

/** An open issue: a neutral chip with an amber triangle, the next check after 14 days. */
export const ActiveIssue: Story = { render: () => <StoryApp path="/library/itm_hp8rnz8i" /> }

/** An issue with an end date: the chip turns amber within 30 days of its last day. */
export const IssueWithAnEndDate: Story = {
  render: () => <StoryApp path="/library/itm_lnd2vv9k" />,
}

/** An open issue past its review date, seen by the owner: "Is this still going on?". */
export const IssueStillGoingOn: Story = {
  render: () => <StoryApp path="/library/itm_xw5lmhcy" person="per_jon" />,
}

/** Resolved is named once, followed by the applied period; the rail has a full-height edge. */
export const ResolvedIssue: Story = { render: () => <StoryApp path="/library/itm_l7x3lqic" /> }

export const FromNeedsALook: Story = {
  render: () => <StoryApp path="/library/itm_zgk6ael1?view=attention" />,
}

/** On a phone actions and Details fold under the reading content. */
export const Phone: Story = {
  render: () => <StoryApp path="/library/itm_gjdvl50x" person="per_jon" />,
  globals: phone,
}

export const PhoneIssue: Story = {
  render: () => <StoryApp path="/library/itm_hp8rnz8i" />,
  globals: phone,
}

export const NotFound: Story = { render: () => <StoryApp path="/library/itm_missing" /> }

export const PhoneSource: Story = {
  render: () => <StoryApp path="/library/itm_gjdvl50x?tab=source" />,
  globals: phone,
}

export const DarkDetails: Story = {
  render: () => <StoryApp path="/library/itm_jyfuvl07" />,
  globals: { theme: 'dark' },
}

/** Stacked Details use the same subtle edge as a top divider. */
export const PhoneResolvedIssue: Story = {
  render: () => <StoryApp path="/library/itm_l7x3lqic" />,
  globals: phone,
}

export const DarkResolvedIssue: Story = {
  render: () => <StoryApp path="/library/itm_l7x3lqic" />,
  globals: { theme: 'dark' },
}

export const DarkPhoneResolvedIssue: Story = {
  render: () => <StoryApp path="/library/itm_l7x3lqic" />,
  globals: { ...phone, theme: 'dark' },
}

/** An item still in review: its address says so and leads to its proposal, not to Page not found. */
export const WaitingForReview: Story = {
  render: () => <StoryApp path="/library/itm_mock000084" />,
  play: async () => {
    await expect(
      await screen.findByText('This fact is waiting for review', {}, { timeout: 5000 }),
    ).toBeVisible()
    await expect(screen.getByRole('link', { name: 'Open proposal #12' })).toBeVisible()
  },
}
