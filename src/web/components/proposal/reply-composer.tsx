import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toApiError, type ProposalRecord } from '@/api'
import { proposalQuery, useApiWrite } from '@/api/queries'
import { LoaderCircleIcon, SendIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
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
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { refusedTextMessage } from '@/lib/proposals'

/** A comment is at most 2,000 characters (proposals.comment). */
const MAX = 2000

/**
 * The composer under a proposal's discussion (frame B, 3): the small Markdown of a comment,
 * sent to the proposer or the reviewer, who is told in the app. A comment moves the proposal's
 * revision on, so a reply written while the reviewer also commented is sent again on the newer
 * revision (gap G14), never lost. Command or Control Enter sends it from the field.
 */
export function ReplyComposer({
  proposal,
  title,
  notice,
  action = 'Send reply',
}: {
  proposal: Pick<ProposalRecord, 'id' | 'revision'>
  /** "Reply to Jon", "Comment for Maria". */
  title: string
  /** Who is told: "Jon is notified in the app." */
  notice: string
  /** The send button's words. */
  action?: string
}) {
  const queryClient = useQueryClient()
  const comment = useApiWrite('commentOnProposal')
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const sending = comment.isPending
  const showSpinner = usePendingIndicator(sending)
  const count = [...text].length

  const send = async () => {
    const reply = text.trim()
    if (!reply) return setProblem('Write a comment first.')
    if ([...reply].length > MAX)
      return setProblem(`Keep it to ${MAX.toLocaleString('en')} characters.`)
    setProblem(null)
    try {
      try {
        await comment.mutateAsync({ id: proposal.id, revision: proposal.revision, text: reply })
      } catch (error) {
        const failure = toApiError(error)
        if (failure.kind !== 'conflict') throw error
        // Someone else moved the proposal on; the reply does not depend on its content.
        const fresh =
          failure.current ??
          (await queryClient.fetchQuery({ ...proposalQuery(proposal.id), staleTime: 0 }))
        if (!fresh) throw error
        await comment.mutateAsync({ id: proposal.id, revision: fresh.revision, text: reply })
      }
      setText('')
    } catch (error) {
      const failure = toApiError(error)
      setProblem(
        refusedTextMessage(failure.findings) ??
          (failure.kind === 'invalid'
            ? 'Write it without @ mentions.'
            : failure.kind === 'conflict'
              ? 'The proposal is closed now, so it takes no more comments.'
              : failure.kind === 'forbidden'
                ? 'Only the proposer and the people who review it can comment.'
                : "We couldn't send your comment. Try again."),
      )
    }
  }

  return (
    <form
      aria-label={title}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <Field invalid={Boolean(problem)} disabled={sending}>
        <FieldLabel>{title}</FieldLabel>
        <FieldDescription>
          Markdown works: **bold**, _italic_, `code`, links and lists. Don't paste passwords or
          personal data.
        </FieldDescription>
        <FieldControl
          value={text}
          onValueChange={(next) => {
            setText(String(next))
            if (problem) setProblem(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void send()
            }
          }}
          render={<Textarea rows={3} className="resize-y text-body pointer-coarse:text-large" />}
        />
        <FieldFooter>
          <FieldError>{problem}</FieldError>
          <FieldCounter count={count} max={MAX} />
        </FieldFooter>
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={sending}>
          {showSpinner ? <LoaderCircleIcon className="animate-spin" /> : <SendIcon />}
          {action}
        </Button>
        <span className="text-caption text-muted-foreground">{notice}</span>
      </div>
    </form>
  )
}
