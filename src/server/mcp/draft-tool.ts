import { createHash, randomUUID } from 'node:crypto'
import { ORPCError } from '@orpc/client'
import * as z from 'zod'
import { deriveAgentDraft, summaryCut, type Derivation } from '../../domain/agent-draft.ts'
import { questionForm, readAnswers, type QuestionContext } from '../../domain/agent-questions.ts'
import { canonicalJson } from '../../domain/canonical.ts'
import { termDomain } from '../../domain/catalogue.ts'
import { textFindings, type Draft } from '../../domain/draft.ts'
import { questionIds, type QuestionId } from '../../domain/proposal-attributes.ts'
import { fieldValue, markedFields, type MarkedField } from '../../domain/provenance.ts'
import type { Term } from '../../domain/vocabulary.ts'
import type { Clock } from '../clock.ts'
import type { Database, Queryable } from '../db/database.ts'
import { principalFor } from '../modules/auth/index.ts'
import { createProposalsService, saveAgentDraft } from '../modules/proposals/index.ts'
import type { Principal } from './auth.ts'
import { draftInput, type DraftInput } from './schemas.ts'
import { resultFor, type ToolResult } from './service.ts'
import { ownerRole } from '../../domain/served-review.ts'
import { productName } from '../brand.ts'

/*
  `suggest_context` (FR-121, changed for the agent contract): after the person says yes, an agent
  sends a suggestion, as the person it acts for, to the owner of its domain. The agent's model
  writes the words; Heed calls no model here. It derives what it can derive exactly, marks every
  field, lists what only the person can answer, saves through the same write path as the
  assistant's drafts (saveAgentDraft), and then sends it for review through the same path as the
  person's own Send for review (proposals.submit), so it waits in the owner's queue with every
  field marked. If the review checks refuse it, it stays the person's draft and the reply says why.
  Nothing here accepts or publishes: only the owner does (docs/product.md, section 10).

  `draft_context`, its deprecated id, keeps what it did for one release: it saves the draft and
  never sends it; the person checks and sends it in Heed.

  It is the MCP write that names a person, as the proposer, on the proposal only. The request
  record keeps the shared client label and no person (FR-410); nothing here logs.

  When the person's agent can show forms (MCP 2026-07-28 multi round-trip elicitation), the open
  questions are asked there first and nothing is saved until the app retries the call with the
  answers and the sealed request state (`DraftRound`). The answers go through the same derivation
  and the same write path, marked `confirmed`. An app that cannot show forms gets the link and the
  question list, as before.
*/

/** One question round of a call, as the request state carries it. Signed, not secret. */
const roundSchema = z.strictObject({
  v: z.literal(1),
  /** Saves at most one draft: proposals.answers_round is unique. */
  round: z.uuid(),
  /** The call's arguments, so the answers apply to the call that asked. */
  args: z.string().regex(/^[0-9a-f]{64}$/),
  asked: z.array(z.enum(questionIds)).min(1).max(questionIds.length),
  /** When it was asked, in seconds, by the service's clock. */
  at: z.number().int(),
})
export type QuestionRound = z.infer<typeof roundSchema>

/** How long the person has to answer: the same as the signed state's own expiry. */
export const ROUND_SECONDS = 600

/** What the gateway knows about this round of a call (see gateway.ts). */
export type DraftRound = {
  /** The client declared form elicitation on this request, and Heed can seal state. */
  canAsk: boolean
  /**
   * The request state the client echoed: its verified payload, or `refused` when its signature,
   * binding to this person and app, or expiry failed. Undefined on a first call.
   */
  state?: { payload: unknown } | 'refused'
  /** The person's response to the form, when the client retried with one. */
  response?: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }
  /** Seals a round into the request state the client echoes back, bound to the person and app. */
  seal: (round: QuestionRound) => Promise<string>
}
/** The questions to ask in the person's AI agent, and the state to echo back with the answers. */
export type DraftQuestions = {
  ask: { message: string; requestedSchema: Record<string, unknown> }
  requestState: string
}
/** What a call does with the draft it saves: send it to the owner, or keep it as a draft. */
export type DraftMode = 'suggest' | 'draft'
export type DraftTool = (
  input: unknown,
  principal: Principal,
  round?: DraftRound,
  mode?: DraftMode,
) => Promise<ToolResult | DraftQuestions>

const firstCall: DraftRound = { canAsk: false, seal: () => Promise.reject(new Error('no key')) }
const digestOf = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const instructions = `Show the person the questions and the link. They check every field marked prefilled and send the draft for review in ${productName} themselves. Don't send it for them, and don't save the same draft twice.`
const sentInstructions =
  "Tell the person the suggestion waits for the owner, who checks it and publishes it, and give them the link. Don't send the same suggestion twice."
const keptInstructions = `Tell the person why it was kept as their draft, and give them the link: they can fix it and send it for review in ${productName}. Don't send it again as it is.`

/** The open questions as the result lists them: what to ask, and the choices when closed. */
const listed = (questions: Derivation['questions']) =>
  questions.map(({ field, question, options }) => ({
    field,
    question,
    ...(options ? { options } : {}),
  }))

/** A refusal the agent can act on: a reason, never a stack or another person's data. */
const refusal = (message: string, extra: Record<string, unknown> = {}) =>
  resultFor({ status: 'refused', saved: false, message, ...extra }, true)

/** A possible duplicate: it overlaps in scope and dates and reads alike, or reads very alike. */
const duplicate = (match: { overlaps: boolean; score: number | null }) =>
  (match.overlaps && (match.score ?? 0) >= 0.3) || (match.score ?? 0) >= 0.6

/**
 * What a draft's names resolve against: the live vocabulary, each metric's domain and the active
 * domains. The assistant's drafts resolve against the same (assistant/tools.ts).
 */
export async function draftVocabulary(tx: Queryable) {
  const terms = await tx.query<Term>(
    `select key,kind::text as kind,parent_key as "parentKey",name,aliases,area_id as "areaId",
       definition_refs as "definitionRefs"
     from serving_vocabulary((select seq from live_edition)) order by key`,
  )
  // The domain the source gave each term, as the live edition carries it.
  const hints = await tx.query<{ key: string; area: string }>(
    'select key,area_id as area from serving_source_domains((select seq from live_edition))',
  )
  const hint = new Map(hints.map((row) => [row.key, row.area]))
  const byKey = new Map(terms.map((term) => [term.key, term]))
  const areas = await tx.query<{ id: string; name: string }>(
    'select id,name from areas where archived_at is null order by id',
  )
  return {
    terms,
    areas,
    // The one domain rule serving and gap topics apply (CON-206).
    areaOf: (key: string) => {
      const term = byKey.get(key)
      return term ? termDomain(term.areaId, hint.get(key) ?? null).areaId : null
    },
  }
}

/** For a change to an accepted item: only what the agent gave replaces the accepted version. */
function asChange(derived: Derivation, args: DraftInput): Derivation {
  const kept: MarkedField[] = ['summary', 'body', 'title']
  const scope = derived.draft.scope
  if (scope?.metrics.length || scope?.dimensions.length || scope?.dimensionValues.length)
    kept.push('scope')
  if (derived.draft.validity) kept.push('validity')
  if (args.evidence) kept.push('evidence')
  if (args.not_to_conclude) kept.push('notToConclude')
  const draft: Draft = {}
  const marks: Derivation['marks'] = {}
  for (const field of kept) {
    if (field === 'title' && !args.title) continue
    if (derived.marks[field]) marks[field] = derived.marks[field]
    const value = derived.draft[field]
    if (value !== undefined) Object.assign(draft, { [field]: value })
  }
  return {
    ...derived,
    draft,
    marks,
    areaCandidates: null,
    questions: derived.questions.filter((q) => q.field !== 'areaId' && q.field !== 'kind'),
  }
}

export function createDraftTool(options: {
  database: Database
  clock: Clock
  /** The web app's address, for the link to the draft. */
  web: string | null
}): DraftTool {
  const { database, clock, web } = options
  const linkTo = (p: { id: string; itemId: string | null; action: string }) =>
    web
      ? p.action === 'change' && p.itemId
        ? `${web}/library/${p.itemId}/suggest?draft=${p.id}`
        : `${web}/library/new?draft=${p.id}`
      : null
  return async (input, principal, round = firstCall, mode = 'suggest') => {
    const tool = mode === 'suggest' ? 'suggest_context' : 'draft_context'
    // A dev or service token names no person, so there is nobody to own or submit the draft.
    if (!principal.subject)
      return refusal(
        `${tool} needs a person signed in to ${productName} through an AI agent. A dev or service token names no person.`,
      )
    if (!uuid.test(principal.subject))
      return refusal("This sign-in doesn't name a person, so no draft was saved.")
    const personId = principal.subject
    const parsed = draftInput.safeParse(input)
    if (!parsed.success) return refusal("The draft's fields aren't valid.")
    const args = parsed.data
    // A text whose first sentence would be cut to make the summary: the agent writes one.
    const cut = summaryCut(args)
    if (cut) return refusal(`${cut} Nothing was saved.`, { reason: 'summary_too_long' })
    const digest = digestOf(args)
    // A retried call carries the state of the round that asked: it must be Heed's own, for this
    // person, app and call, fresh, and unused. Anything else saves nothing.
    let answering: QuestionRound | null = null
    if (round.state !== undefined) {
      const payload = round.state === 'refused' ? null : roundSchema.safeParse(round.state.payload)
      if (!payload?.success || payload.data.args !== digest)
        return refusal(
          `These answers do not belong to this call: they were for another call, person or agent, or were changed on the way. Nothing was saved. Call ${tool} again without them.`,
          { reason: 'request_state_invalid' },
        )
      const now = Math.floor(clock.now().getTime() / 1000)
      if (now - payload.data.at > ROUND_SECONDS || payload.data.at > now + 60)
        return refusal(
          `The questions expired before the answers came back. Nothing was saved. Call ${tool} again.`,
          { reason: 'request_state_expired' },
        )
      answering = payload.data
    }
    try {
      return await database.transaction(personId, async (tx) => {
        if (!(await principalFor(tx, personId)))
          return refusal("Your account isn't active, so no draft was saved.")
        const context = await draftVocabulary(tx)
        const today = clock.today()
        const names = new Map<string, string>([
          ...context.areas.map((area): [string, string] => [area.id, area.name]),
          ...context.terms.map((term): [string, string] => [term.key, term.name]),
        ])
        const asking = (draft: Draft): QuestionContext => ({
          draft,
          today,
          titleOf: (value) => names.get(value) ?? value,
        })
        let derived = deriveAgentDraft(args, { ...context, today })
        // The person's answers replace what the agent suggested, through the same derivation.
        let answered: QuestionId[] = []
        if (answering && round.response?.action === 'accept' && round.response.content) {
          const read = readAnswers(
            round.response.content,
            derived.questions,
            answering.asked,
            asking(derived.draft),
          )
          answered = read.answered
          if (answered.length) derived = deriveAgentDraft(args, { ...context, today }, read.answers)
        }
        if (args.item_id) derived = asChange(derived, args)
        // FR-117: text that looks like a secret or personal data is refused, by pattern only.
        const sensitive = textFindings(derived.draft)
        if (sensitive.length)
          return refusal(
            'Remove what looks like personal data or a secret, then try again. Nothing was saved.',
            { findings: sensitive.map(({ code, field }) => ({ code, field })) },
          )
        // Ask in the person's app only on a first call: one round, then the draft is saved.
        const form =
          round.canAsk && !answering ? questionForm(derived.questions, asking(derived.draft)) : null
        if (derived.areaCandidates && !form)
          return resultFor({
            status: 'needs_area',
            saved: false,
            message:
              "It isn't clear which domain this is about. Ask the person, then call again with the domain in area.",
            areas: context.areas.filter((area) => derived.areaCandidates!.includes(area.id)),
            questions: listed(derived.questions),
            not_in_vocabulary: derived.unresolved,
            instructions: 'Ask the person which domain it is about. Nothing was saved.',
          })
        const proposals = createProposalsService(tx, clock, personId)
        const matches = await proposals.matches(
          {
            ...derived.draft,
            title: derived.draft.title ?? [...(derived.draft.summary ?? '')].slice(0, 200).join(''),
          },
          args.item_id ?? null,
        )
        const possible = matches.accepted.filter(duplicate)
        if (possible.length && !args.item_id && !args.new_item)
          return resultFor({
            status: 'possible_duplicate',
            saved: false,
            message:
              'Accepted facts already cover something similar. Ask the person whether this changes one of them or is new.',
            possible_duplicates: possible.map(({ id, title, kind }) => ({ id, title, kind })),
            instructions:
              'To suggest a change to one of them, call again with its id as item_id. If the person says it is new, call again with new_item: true. Nothing was saved.',
          })
        if (form)
          return {
            ask: { message: form.message, requestedSchema: form.requestedSchema },
            requestState: await round.seal({
              v: 1,
              round: randomUUID(),
              args: digest,
              asked: form.asked,
              at: Math.floor(clock.now().getTime() / 1000),
            }),
          }
        const saved = await saveAgentDraft(tx, clock, personId, {
          draft: derived.draft,
          ...(args.item_id ? { itemId: args.item_id } : {}),
          channel: 'mcp',
          marks: derived.marks,
          ...(args.window?.uncertain ? { datesUncertain: true } : {}),
          ...(answering ? { answersRound: answering.round } : {}),
        })
        // suggest_context sends it to the owner as the person's own Send for review would; a
        // refusal by the review checks keeps it as their draft, with why.
        let kept: { message: string; findings?: { code: string; field: string }[] } | null = null
        let sent = false
        if (mode === 'suggest') {
          await tx.query('savepoint suggest_submit')
          try {
            await proposals.submit(saved.id, saved.revision)
            await tx.query('release savepoint suggest_submit')
            sent = true
          } catch (error) {
            await tx.query('rollback to savepoint suggest_submit')
            if (!(error instanceof ORPCError)) throw error
            const data = error.data as { findings?: { code: string; field: string }[] } | undefined
            kept = {
              message: `It was kept as your draft and not sent: ${error.message.replace(/\.$/, '')}.`,
              ...(data?.findings
                ? { findings: data.findings.map(({ code, field }) => ({ code, field })) }
                : {}),
            }
          }
        }
        const domainName = context.areas.find((area) => area.id === saved.draft.areaId)?.name
        const fields = Object.fromEntries(
          markedFields
            .filter((field) => saved.provenance?.fields[field])
            .map((field) => {
              const value =
                field === 'areaId'
                  ? domainName
                  : field === 'ownerId'
                    ? domainName
                      ? ownerRole(domainName)
                      : undefined
                    : fieldValue(saved.draft, field)
              return [
                field,
                {
                  value: value ?? null,
                  mark: saved.provenance!.fields[field],
                  ...(derived.reasons[field] ? { reason: derived.reasons[field] } : {}),
                },
              ]
            }),
        )
        return resultFor({
          status: sent ? 'suggestion_sent' : 'draft_saved',
          saved: true,
          submitted: sent,
          ...(sent
            ? {
                message: `Sent to ${domainName ? ownerRole(domainName) : 'the owner of its domain'}. It waits for their check, and nothing changes until they publish it.`,
              }
            : kept
              ? { message: kept.message }
              : {}),
          draft_id: saved.id,
          number: saved.number,
          title: saved.draft.title ?? saved.title,
          url: sent ? (web ? `${web}/proposals/${saved.id}` : null) : linkTo(saved),
          fields,
          questions: listed(derived.questions),
          ...(answering ? { answered } : {}),
          not_in_vocabulary: derived.unresolved,
          overlaps: {
            accepted: matches.accepted
              .filter((match) => match.overlaps)
              .map(({ id, title, kind }) => ({ id, title, kind })),
            own_proposals: matches.ownProposals.filter((own) => own.id !== saved.id),
          },
          flags: saved.provenance?.flags ?? [],
          findings: saved.findings
            .filter((finding) => finding.severity === 'warning' || finding.code !== 'format')
            .map(({ code, field, message, severity }) => ({ code, field, message, severity })),
          ...(kept?.findings ? { blocking: kept.findings } : {}),
          instructions: sent ? sentInstructions : kept ? keptInstructions : instructions,
        })
      })
    } catch (error) {
      if (error instanceof ORPCError) {
        const data = error.data as { findings?: { code: string; field: string }[] } | undefined
        return refusal(
          error.code === 'NOT_FOUND'
            ? 'No accepted fact has that item_id. Nothing was saved.'
            : `${error.message.replace(/\.$/, '')}. Nothing was saved.`,
          data?.findings
            ? { findings: data.findings.map(({ code, field }) => ({ code, field })) }
            : error.code === 'CONFLICT' && answering
              ? { reason: 'request_state_used' }
              : {},
        )
      }
      return refusal("The draft couldn't be saved. Try again in a minute.")
    }
  }
}
