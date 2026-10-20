import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { FilePlusIcon, FlagIcon } from '@/components/icons'
import { ReviewStamp } from '@/components/item/review-stamp'
import { AbsenceLine } from '@/components/page/absence-line'
import { Button } from '@/components/ui/button'
import type { ReviewStampView } from '@/lib/review-stamp'

/*
  Reviewed before served (contract 7.2, 9.5): the review stamp under every fact shown as served,
  and the absence line for a scope with nothing written down. Every state, in both themes (theme
  menu) and at 1440, 1024 and 390 (viewport menu).
*/

const meta = {
  title: 'Library/Review stamp and absence line',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const accepted: ReviewStampView = {
  acceptedOn: '2026-08-04',
  person: 'Jon Abara',
  role: 'owner of Sales',
  edition: '2026-08-04.2',
  checks: ['format', 'matching', 'delivery', 'answer_impact'],
}
const long = 'A very long name that keeps going '.repeat(6).trim()

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex max-w-reading flex-col gap-2 rounded-lg border bg-card p-4">
      <p className="text-dense font-bold">{title}</p>
      <p className="text-caption text-muted-foreground">
        Online sales to Norway stopped on 4 August 2026.
      </p>
      {children}
    </div>
  )
}

/** Each state of the stamp: named, the role alone, an admin, not reviewed yet, long text. */
export const Stamp: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Fact title="Accepted, named behind sign-in">
        <ReviewStamp view={accepted} />
      </Fact>
      <Fact title="The role alone, as an AI app reads it, until who is read">
        <ReviewStamp view={{ ...accepted, person: null, checks: null }} />
      </Fact>
      <Fact title="Accepted by an admin">
        <ReviewStamp view={{ ...accepted, person: 'Per Ravi', role: 'admin' }} />
      </Fact>
      <Fact title="A draft: not reviewed yet">
        <ReviewStamp view={null} draft domain="Sales" />
        <ReviewStamp view={null} />
      </Fact>
      <Fact title="Long name and domain">
        <ReviewStamp view={{ ...accepted, person: long, role: `owner of ${long}` }} />
      </Fact>
      <Fact title="Empty name">
        <ReviewStamp view={{ ...accepted, person: '' }} />
      </Fact>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const stamps = canvasElement.querySelectorAll('[data-slot="review-stamp"]')
    await expect(stamps).toHaveLength(6)
    await expect(stamps[0]).toHaveTextContent(
      /^Accepted 4 August 2026 by Jon Abara, owner of Sales.*Checks passed$/,
    )
    await expect(stamps[1]).toHaveTextContent(/^Accepted 4 August 2026 by the owner of Sales/)
    await expect(stamps[1]).not.toHaveTextContent('Checks passed')
    await expect(
      canvas.getByText(/Not reviewed yet. AI apps get it once the owner of Sales/),
    ).toBeVisible()
  },
}

/** The absence line: a plain statement, with its next steps, and with long text. */
export const Absence: Story = {
  render: () => (
    <div className="flex max-w-reading flex-col gap-4">
      <AbsenceLine title="Nothing written down for this yet" />
      <AbsenceLine
        title="Nothing written down for this yet"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline">
              <FilePlusIcon />
              Start a draft
            </Button>
            <Button variant="outline">
              <FlagIcon />
              Report a gap
            </Button>
          </div>
        }
      >
        No reviewed fact applies to Orders, Norway, 1 to 31 August 2026. AI apps are told that
        nothing is written down for this.
      </AbsenceLine>
      <AbsenceLine title={`Nothing written down for ${long}`}>{long}</AbsenceLine>
    </div>
  ),
}
