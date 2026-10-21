import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent } from 'storybook/test'
import { ChangeCard } from '@/components/change/change-card'
import { StepTrail, type TrailStep } from '@/components/change/step-trail'
import {
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  SearchIcon,
} from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/*
  One grammar for an agent's change (contract 7.2, 9.8, section 10): the step trail and the
  change card on their own. The trail while it works (a step in the present with its spinner),
  done and folded, opened, with a step that did not work, and replayed so the tense flips and the
  rows arrive; the card asking for a decision, saving,
  saved, not saved, and with a long title. The assistant's draft card (Assistant/Ask) is built from these. Use the viewport
  menu for 1440, 1024 and 390 and the theme menu for dark.
*/

const meta = {
  title: 'Parts/Agent changes',
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-dock">
        <Story />
      </div>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const base = { running: false, failed: false }
const read: TrailStep = {
  ...base,
  id: 'read',
  icon: GlobeIcon,
  words: 'Read',
  object: 'consumer.example',
}
const looked: TrailStep = {
  ...base,
  id: 'facts',
  icon: SearchIcon,
  words: 'Looked up facts',
  counts: '4 checked, 2 apply',
  opens: (
    <ul className="flex flex-col gap-1">
      <li>Payment provider switched in the United Kingdom on 12 June 2026</li>
      <li>United Kingdom launch campaign started on 21 February 2025</li>
    </ul>
  ),
}
const wrote: TrailStep = {
  ...base,
  id: 'draft',
  icon: FilePenIcon,
  words: 'Wrote a draft for you to check',
}
const summary = (
  <>
    3 steps · read <span className="text-foreground tabular-nums">2 facts, 1 page</span>
  </>
)

/** While it works: done steps in the past, the running one in the present with its spinner. */
export const TrailWorking: Story = {
  render: () => (
    <StepTrail
      working
      live
      label="What the assistant did"
      summary={summary}
      steps={[read, { ...looked, words: 'Looking up facts', counts: null, running: true }]}
    />
  ),
}

/** Done: folded into one row that says how many steps and what they read. */
export const TrailDone: Story = {
  render: () => (
    <StepTrail label="What the assistant did" summary={summary} steps={[read, looked, wrote]} />
  ),
  play: async () => {
    await expect(
      screen.getByRole('button', { name: /^What the assistant did: 3 steps/ }),
    ).toHaveAttribute('aria-expanded', 'false')
  },
}

/** Opened: each step in the past tense, the object in the foreground colour. */
export const TrailOpened: Story = {
  ...TrailDone,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: /^What the assistant did: 3 steps/ }))
    await expect(screen.getByRole('list', { name: 'What the assistant did' })).toBeVisible()
  },
}

/** A step that did not work keeps the trail open and says so. */
export const TrailFailed: Story = {
  render: () => (
    <StepTrail
      label="What the assistant did"
      summary={summary}
      steps={[
        { ...read, words: 'Tried to read', object: '10.0.0.1', failed: true },
        {
          ...base,
          id: 'checks',
          icon: ListChecksIcon,
          words: 'Ran the fixed checks',
          counts: '4 of 4 passed',
        },
      ]}
    />
  ),
}

/** Long words wrap inside the trail's width. */
export const TrailLong: Story = {
  render: () => (
    <StepTrail
      label="What the assistant did"
      summary={summary}
      steps={[
        {
          ...base,
          id: 'long',
          icon: FileTextIcon,
          words: 'Read the help pages',
          counts:
            'What is an MCP, and how it all connects, Glossary, Writing a good item, Domains and their owners',
        },
      ]}
    />
  ),
}

/** One run of the trail as an answer arrives: each step enters in the present, then flips. */
function ReplayRun() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const timers = [1, 2, 3, 4, 5, 6].map((n) => window.setTimeout(() => setCount(n), n * 700))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [])
  const plan: [TrailStep, string][] = [
    [read, 'Reading'],
    [looked, 'Looking up facts'],
    [wrote, 'Writing a draft for you to check'],
  ]
  const steps = plan.flatMap(([step, now], index) => {
    if (count < index * 2 + 1) return []
    const running = count === index * 2 + 1
    return [running ? { ...step, words: now, counts: null, opens: undefined, running } : step]
  })
  return (
    <StepTrail
      live
      working={count < 6}
      label="What the assistant did"
      summary={summary}
      steps={steps}
    />
  )
}

/** The trail at rest; Replay plays it as an answer arrives, from the start. */
function Replay() {
  const [run, setRun] = useState(0)
  return (
    <div className="flex flex-col gap-4">
      <Button variant="outline" className="w-fit" onClick={() => setRun((n) => n + 1)}>
        Replay
      </Button>
      {run ? (
        <ReplayRun key={run} />
      ) : (
        <StepTrail label="What the assistant did" summary={summary} steps={[read, looked, wrote]} />
      )}
    </div>
  )
}

export const TrailReplay: Story = { render: () => <Replay /> }

const fields = (
  <dl className="flex flex-col gap-3">
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-muted-foreground">What happened</dt>
      <dd className="text-dense">
        Orders in the United Kingdom come through a new payment provider.
      </dd>
    </div>
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-muted-foreground">When</dt>
      <dd className="text-dense">From 12 Jun 2026, still going on</dd>
    </div>
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-muted-foreground">Domain</dt>
      <dd className="text-dense">Sales</dd>
    </div>
  </dl>
)
const unreviewed = (
  <Badge tone="warning" icon={FilePenIcon}>
    Draft
  </Badge>
)
const decision = (
  <>
    <Button variant="ghost">Not now</Button>
    <Button>Create draft</Button>
  </>
)

/** Asking for one decision: the object, what changes and what is left for the person. */
export const CardAsking: Story = {
  render: () => (
    <ChangeCard
      label="New draft"
      kind="event"
      title="Payment provider switched in the United Kingdom on 12 June 2026"
      badges={unreviewed}
      meta={<span>New fact · not saved yet</span>}
      note="Left for you: when it applies."
      actions={decision}
    >
      {fields}
    </ChangeCard>
  ),
}

export const CardSaving: Story = {
  render: () => (
    <ChangeCard
      label="New draft"
      kind="event"
      title="Payment provider switched in the United Kingdom on 12 June 2026"
      badges={unreviewed}
      meta={<span>New fact · not saved yet</span>}
      status={
        <>
          <LoaderCircleIcon aria-hidden="true" className="size-icon-sm motion-safe:animate-spin" />
          Saving the draft
        </>
      }
    >
      {fields}
    </ChangeCard>
  ),
}

export const CardSaved: Story = {
  render: () => (
    <ChangeCard
      label="New draft"
      kind="event"
      title="Payment provider switched in the United Kingdom on 12 June 2026"
      badges={unreviewed}
      meta={<span>New fact · only you can see it</span>}
      note="Open it, check each part, then send it for review. The owner of its domain checks it before AI apps get it."
      status="Saved as your draft #42"
      actions={<Button>Open draft #42</Button>}
    >
      <p className="text-caption text-muted-foreground">What was saved</p>
    </ChangeCard>
  ),
}

export const CardNotSaved: Story = {
  render: () => (
    <ChangeCard
      label="New draft"
      kind="event"
      title="Payment provider switched in the United Kingdom on 12 June 2026"
      badges={unreviewed}
      meta={<span>New fact · not saved</span>}
      note="Nothing was saved. The answer says why; ask again, or write it in Add context."
      status="The draft wasn’t saved"
    >
      {fields}
    </ChangeCard>
  ),
}

/** A long title wraps beside its kind glyph; the meta lines up under the words. */
export const CardLongTitle: Story = {
  render: () => (
    <ChangeCard
      label="New draft"
      kind="issue"
      title="Customers in every Norway store and on every marketplace have 14 days to send back what they buy online, without giving any reason"
      badges={unreviewed}
      meta={<span>A change to a fact · not saved yet</span>}
      actions={decision}
    >
      {fields}
    </ChangeCard>
  ),
}
