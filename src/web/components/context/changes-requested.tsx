import { useQuery } from '@tanstack/react-query'
import type { ProposalRecord } from '@/api'
import { peopleQuery, proposalEventsQuery } from '@/api/queries'
import { MessageSquareIcon } from '@/components/icons'
import { Quote, Said } from '@/components/proposal/said'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Field,
  FieldControl,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldLabel,
} from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { latestDecision } from '@/lib/proposal-activity'

/** A comment is at most 2,000 characters (proposals.comment). */
export const CHANGE_NOTE_MAX = 2000

/**
 * The reviewer's request, at the top of the editor while a proposal waits for changes, so the
 * person edits with it in view; and an optional line on what they changed, sent to the reviewer
 * as a reply when they resubmit.
 */
export function ChangesRequested({
  proposal,
  note,
  onNoteChange,
  error,
  disabled,
}: {
  proposal: Pick<ProposalRecord, 'id'>
  note: string
  onNoteChange: (note: string) => void
  error: string | null
  disabled: boolean
}) {
  const events = useQuery(proposalEventsQuery(proposal.id))
  const people = useQuery(peopleQuery()).data
  const asked = latestDecision(events.data ?? [], 'request_changes')
  if (!asked) return null
  const name = people?.find((person) => person.id === asked.actorId)?.name
  const first = name?.split(' ')[0]
  return (
    <Alert variant="warning" data-slot="changes-requested">
      <MessageSquareIcon aria-hidden="true" />
      <AlertContent>
        <AlertTitle>
          <Said who={name ?? 'The owner'} what="asked for changes" at={asked.at} />
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          {asked.reason ? <Quote>{asked.reason}</Quote> : null}
          <Field invalid={Boolean(error)} disabled={disabled}>
            <FieldLabel optional>What you changed</FieldLabel>
            <FieldDescription>
              {`Sent to ${first ?? 'the owner'} as a reply when you send it again.`}
            </FieldDescription>
            <FieldControl
              value={note}
              onValueChange={(next) => onNoteChange(String(next))}
              render={
                <Textarea
                  id="context-changeNote"
                  rows={2}
                  className="resize-y bg-background text-body pointer-coarse:text-large"
                />
              }
            />
            <FieldFooter>
              <FieldError>{error}</FieldError>
              <FieldCounter count={[...note].length} max={CHANGE_NOTE_MAX} />
            </FieldFooter>
          </Field>
        </AlertDescription>
      </AlertContent>
    </Alert>
  )
}
