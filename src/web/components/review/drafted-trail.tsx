import { StepTrail, type TrailStep } from '@/components/change/step-trail'
import {
  BotIcon,
  DatabaseIcon,
  GlobeIcon,
  ListChecksIcon,
  SendIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  UserRoundCheckIcon,
  UserRoundIcon,
  type Icon,
} from '@/components/icons'
import { draftedSteps, draftedSummary, type DraftedStep } from '@/lib/drafted-trail'
import { firstName, type ReviewModel } from './review-model'

/*
  How a proposal an AI app or the assistant drafted came to be, as a step trail under the
  review's people (contract 9.8): folded to one row ("Drafted with an AI app · 7 steps"), and
  open, the steps in the past tense, from the stored provenance, the proposal and the checks. The
  page itself is the change card at full size: the item as its title, what changes, the line
  beside each field the app wrote and one decision in the bar at the bottom.
*/

const icons: Record<DraftedStep['icon'], Icon> = {
  web: GlobeIcon,
  wrote: BotIcon,
  confirmed: UserRoundCheckIcon,
  derived: DatabaseIcon,
  default: SlidersHorizontalIcon,
  left: UserRoundIcon,
  flag: TriangleAlertIcon,
  submit: SendIcon,
  check: ListChecksIcon,
}

export function DraftedTrail({ model }: { model: ReviewModel }) {
  const { provenance, gate } = model.review
  if (!provenance || model.review.vocabulary) return null
  const drafted = draftedSteps(provenance, {
    proposer: model.author ? 'You' : firstName(model.proposerName),
    submittedAt: model.record.submittedAt,
    gate,
  })
  const steps: TrailStep[] = drafted.map((step) => ({
    ...step,
    icon: icons[step.icon],
    running: false,
    failed: false,
  }))
  return (
    <StepTrail
      steps={steps}
      label="How it was drafted"
      summary={draftedSummary(provenance, drafted)}
    />
  )
}
