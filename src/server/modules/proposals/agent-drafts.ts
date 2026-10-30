import { ORPCError } from '@orpc/client'
import type { ProposalRecord } from '../../../contract/proposals.ts'
import type { Draft } from '../../../domain/draft.ts'
import {
  provenanceOf,
  type ExternalSource,
  type FieldMark,
  type MarkedField,
} from '../../../domain/provenance.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { retryWrite } from './retry.ts'
import { createProposalsService } from './service.ts'
import { productName } from '../../brand.ts'

/*
  The one write path for a draft that someone other than the person wrote for them: an AI agent
  through the MCP tool `draft_context` (FR-121) and the built-in assistant's `create_draft`
  (FR-707). Both save an unsubmitted draft owned by the person through proposals.create, with a
  mark on every field; neither ever submits (FR-102, FR-122).
*/

export type AgentDraftRequest = {
  draft: Draft
  itemId?: string
  channel: 'mcp' | 'assistant'
  /** The mark of each field as the writer filled it; a field absent from the draft loses it. */
  marks: Partial<Record<MarkedField, FieldMark>>
  /** The assistant's own source words per field, kept on the draft's history (FR-707). */
  sources?: Record<string, string>
  /** Evidence the assistant took from web pages Heed read, with the automatic quote match. */
  external?: readonly ExternalSource[]
  /** The person was unsure of the dates, or gave none: the draft's dates are flagged. */
  datesUncertain?: boolean
  /** A resent request with the same key returns the same draft instead of a second one. */
  retryKey?: string
  /**
   * The question round whose answers the person gave in their agent (MCP elicitation). A round
   * saves one draft: a second save with it, a replayed request state, is refused.
   */
  answersRound?: string
}

/** The drafts an agent may save for one person (`limits.agent_drafts`, FR-809). */
async function agentDraftLimits(tx: Queryable) {
  const [setting] = await tx.query<{ perDay: number; open: number }>(
    `select (value->>'per_day')::int as "perDay",(value->>'open')::int as open
       from settings_current where key='limits.agent_drafts'`,
  )
  return { perDay: setting?.perDay ?? 10, open: setting?.open ?? 20 }
}

/**
 * Refuses another agent draft when the person's agents saved their day's share in the last 24
 * hours, or when too many of their agent drafts wait unsubmitted. A discarded draft still counts
 * for the day. Counted from the proposals themselves, so no counter names the person.
 */
async function checkLimits(tx: Queryable) {
  // One agent draft of a person at a time, so two at once cannot both pass the count.
  await tx.query(
    "select pg_advisory_xact_lock(hashtextextended('agent_draft:' || cl_person()::text,0))",
  )
  const limits = await agentDraftLimits(tx)
  const [used] = await tx.query<{ today: number; open: number }>(
    `select count(*) filter (where created_at > now() - interval '24 hours')::int as today,
            count(*) filter (where state='draft' and discarded_at is null)::int as open
       from proposals where proposer_id=cl_person() and channel='mcp'`,
  )
  if ((used?.today ?? 0) >= limits.perDay)
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: `Your agents saved ${limits.perDay} drafts in the last 24 hours, the most allowed. Finish or discard one in ${productName}, or try again tomorrow.`,
    })
  if ((used?.open ?? 0) >= limits.open)
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: `${limits.open} drafts from your agents wait unsubmitted. Submit or discard some in ${productName} first.`,
    })
}

/** Saves the draft as the person, with its marks. Never submits it. */
export async function saveAgentDraft(
  tx: Queryable,
  clock: Clock,
  personId: string,
  request: AgentDraftRequest,
): Promise<ProposalRecord> {
  if (request.channel === 'mcp') await checkLimits(tx)
  // Under the person's agent-draft lock taken above; the unique column backs it up.
  if (request.answersRound) {
    const [used] = await tx.query('select 1 from proposals where answers_round=$1', [
      request.answersRound,
    ])
    if (used)
      throw new ORPCError('CONFLICT', {
        message: `These answers already saved a draft. Open it in ${productName}, or call the tool again without them`,
      })
  }
  const proposals = createProposalsService(tx, clock, personId)
  const input = {
    draft: request.draft,
    ...(request.itemId ? { itemId: request.itemId } : {}),
    channel: request.channel,
  }
  const by = request.channel === 'mcp' ? 'agent' : 'assistant'
  const create = () =>
    proposals.create(input, {
      ...(request.sources ? { assisted: request.sources } : {}),
      provenance: (draft) =>
        provenanceOf(by, request.marks, draft, request.external, request.datesUncertain),
      ...(request.answersRound ? { answersRound: request.answersRound } : {}),
    })
  return request.retryKey
    ? retryWrite(
        tx,
        request.retryKey,
        request.channel === 'mcp' ? 'mcp.draft_context' : 'assistant.create_draft',
        input,
        create,
      )
    : create()
}
