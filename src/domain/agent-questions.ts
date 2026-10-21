import * as z from 'zod/mini'
import type { Draft } from './draft.ts'
import { itemKinds, type ItemKind } from './item.ts'
import {
  limits,
  proposalAttributes,
  questionIds,
  type MarkedField,
  type ProposalAttribute,
  type QuestionId,
} from './proposal-attributes.ts'
import { isCalendarDate, shiftDate } from './validity.ts'

/*
  The questions only the person can answer about an agent's draft (FR-121), and how each is asked
  in the person's agent when it supports MCP elicitation (protocol 2026-07-28, form mode: a flat
  object of strings, dates, booleans and closed choices). Every answer arrives from the client,
  so it is read as untrusted data: a value outside the choices offered, a malformed date or link,
  or text past its limit counts as no answer, and the question stays open for Heed's own form.
*/

/** One question for the person, in the tool's result and, when the client can, in a form. */
export type AgentQuestion = {
  id: QuestionId
  field: MarkedField
  question: string
  /** The closed choices, when there are any: area ids, kinds or vocabulary keys. */
  options?: string[]
}

/** What the person answered in their agent, ready for the derivation. */
export type AgentAnswers = {
  area?: string
  kind?: ItemKind
  /** Vocabulary keys from the choices offered. */
  scope?: string[]
  /** The end is the day after the last day (NFR-048), or null while it goes on. */
  validity?: { start: string; end: string | null }
  evidence?: { url: string; quote: string }
}

/** The attribute each question asks about: the one whose `asks` names it. */
export const questionFields = Object.fromEntries(
  questionIds.map((id) => {
    const owner = (Object.keys(proposalAttributes) as ProposalAttribute[]).find((name) =>
      (proposalAttributes[name].agent as { asks?: readonly QuestionId[] }).asks?.includes(id),
    )
    return [id, owner]
  }),
) as Record<QuestionId, MarkedField>

/** A question with the field it asks about. */
export const question = (
  id: QuestionId,
  text: string,
  options?: readonly string[],
): AgentQuestion => ({
  id,
  field: questionFields[id],
  question: text,
  ...(options ? { options: [...options] } : {}),
})

/** One property of a form-mode elicitation: the flat primitives the protocol allows. */
export type FormProperty =
  | {
      type: 'string'
      title: string
      description?: string
      format?: 'date' | 'uri'
      minLength?: number
      maxLength?: number
      default?: string
      oneOf?: { const: string; title: string }[]
    }
  | { type: 'boolean'; title: string; description?: string; default?: boolean }
  | {
      type: 'array'
      title: string
      description?: string
      minItems?: number
      maxItems?: number
      items: { anyOf: { const: string; title: string }[] }
    }

export type QuestionContext = {
  /** The draft as derived so far: the defaults of dates come from it. */
  draft: Draft
  today: string
  /** A person's name for a choice: an area's name, a vocabulary term's name. */
  titleOf: (value: string) => string
}

type Definition = {
  /** The properties that ask it, or null when it cannot be asked as a form (no closed choices). */
  properties: (q: AgentQuestion, context: QuestionContext) => Record<string, FormProperty> | null
  /** Must be answered for the draft to be saved at all. */
  required?: readonly string[]
  /** The answer in the form's content, or null when it is missing or not valid. */
  read: (
    content: Record<string, unknown>,
    q: AgentQuestion,
    context: QuestionContext,
  ) => AgentAnswers | null
}

const choice = (values: readonly string[], context: QuestionContext) =>
  values.map((value) => ({ const: value, title: context.titleOf(value) }))
const kindTitles: Record<ItemKind, string> = {
  note: 'Note: a lasting remark',
  event: 'Event: something that happened on a day',
  guide: 'Guide: how to investigate',
  example: 'Example: a checked answer to a question',
  issue: 'Issue: a data problem that lasts a while',
}
const day = z.string().check(z.refine(isCalendarDate))
const link = z.string().check(
  z.maxLength(limits.url),
  z.refine((url) => /^https?:\/\//.test(url) && URL.canParse(url)),
)
const quote = z
  .string()
  .check(z.refine((text) => text.trim().length > 0 && [...text].length <= limits.quote))
const offered = (q: AgentQuestion, value: unknown): value is string =>
  typeof value === 'string' && (q.options ?? []).includes(value)

/** The definition of every question: a new question id fails to compile until it has one. */
export const questionDefinitions: Record<QuestionId, Definition> = {
  area: {
    properties: (q, context) =>
      q.options?.length
        ? {
            area: {
              type: 'string',
              title: 'Domain',
              description: q.question,
              oneOf: choice(q.options, context),
            },
          }
        : null,
    required: ['area'],
    read: (content, q) => (offered(q, content.area) ? { area: content.area } : null),
  },
  kind: {
    properties: (q) =>
      q.options?.length
        ? {
            kind: {
              type: 'string',
              title: 'Kind',
              description: q.question,
              oneOf: q.options
                .filter((kind): kind is ItemKind => (itemKinds as readonly string[]).includes(kind))
                .map((kind) => ({ const: kind, title: kindTitles[kind] })),
            },
          }
        : null,
    read: (content, q) =>
      offered(q, content.kind) && (itemKinds as readonly string[]).includes(content.kind)
        ? { kind: content.kind as ItemKind }
        : null,
  },
  scope: {
    properties: (q, context) =>
      q.options?.length
        ? {
            scope: {
              type: 'array',
              title: 'Where it applies',
              description: q.question,
              minItems: 1,
              maxItems: q.options.length,
              items: { anyOf: choice(q.options, context) },
            },
          }
        : null,
    read: (content, q) => {
      const keys = Array.isArray(content.scope) ? content.scope : []
      const chosen = [...new Set(keys.filter((key) => offered(q, key)))]
      return chosen.length && chosen.length === keys.length ? { scope: chosen } : null
    },
  },
  start: {
    properties: (q, context) => ({
      first_day: {
        type: 'string',
        format: 'date',
        title: 'First day',
        description: q.question,
        default: context.draft.validity?.start || context.today,
      },
    }),
    read: (content, _q, context) =>
      day.safeParse(content.first_day).success
        ? {
            validity: {
              start: content.first_day as string,
              end: context.draft.validity?.end ?? null,
            },
          }
        : null,
  },
  end: {
    properties: (q, context) => ({
      first_day: {
        type: 'string',
        format: 'date',
        title: 'First day',
        default: context.draft.validity?.start || context.today,
      },
      still_going_on: {
        type: 'boolean',
        title: 'Still going on',
        description: q.question,
        default: true,
      },
      last_day: {
        type: 'string',
        format: 'date',
        title: 'Last day, if it has ended',
      },
    }),
    read: (content, _q, context) => {
      const start = day.safeParse(content.first_day).success
        ? (content.first_day as string)
        : context.draft.validity?.start
      if (!start || !isCalendarDate(start)) return null
      // A client may send an empty field as an empty string.
      const last = content.last_day === '' ? undefined : content.last_day
      if (content.still_going_on === true && last === undefined)
        return { validity: { start, end: null } }
      if (content.still_going_on === false && day.safeParse(last).success)
        return (last as string) >= start
          ? { validity: { start, end: shiftDate(last as string, 1) } }
          : null
      return null
    },
  },
  evidence: {
    properties: (q) => ({
      source_link: {
        type: 'string',
        format: 'uri',
        title: 'Source link',
        description: q.question,
        maxLength: limits.url,
      },
      source_quote: {
        type: 'string',
        title: 'One sentence from it, copied exactly',
        minLength: 1,
        maxLength: limits.quote,
      },
    }),
    read: (content) =>
      link.safeParse(content.source_link).success && quote.safeParse(content.source_quote).success
        ? {
            evidence: {
              url: (content.source_link as string).trim(),
              quote: content.source_quote as string,
            },
          }
        : null,
  },
}

/** The most fields one form asks for: the open questions stay few (requirements, FR-121). */
export const MAX_ASKED = 4

/**
 * The form that asks the open questions in the person's agent, or null when none can be asked
 * there. Only questions with a form are asked; the rest stay in the tool's result.
 */
export function questionForm(questions: readonly AgentQuestion[], context: QuestionContext) {
  const asked: AgentQuestion[] = []
  const properties: Record<string, FormProperty> = {}
  const required: string[] = []
  for (const q of questions) {
    if (asked.length === MAX_ASKED) break
    const definition = questionDefinitions[q.id]
    const own = definition.properties(q, context)
    if (!own) continue
    asked.push(q)
    // Two questions about the dates share the first day: the first to ask it words it.
    for (const [name, property] of Object.entries(own)) properties[name] ??= property
    for (const name of definition.required ?? []) if (!required.includes(name)) required.push(name)
  }
  if (!asked.length) return null
  return {
    asked: asked.map((q) => q.id),
    message: `${asked.length === 1 ? 'One question comes' : `${asked.length} questions come`} before this draft is saved for you. ${asked.map((q) => q.question).join(' ')} Nothing is sent: you check the draft and send it for review yourself. Leave a field empty to answer it in the form instead.`,
    requestedSchema: {
      type: 'object' as const,
      properties,
      ...(required.length ? { required } : {}),
    },
  }
}

/**
 * The answers in a form's content to the questions that were asked, and which of them were
 * answered. A question whose answer is missing or not valid stays open.
 */
export function readAnswers(
  content: Record<string, unknown>,
  questions: readonly AgentQuestion[],
  asked: readonly QuestionId[],
  context: QuestionContext,
): { answers: AgentAnswers; answered: QuestionId[] } {
  const answers: AgentAnswers = {}
  const answered: QuestionId[] = []
  for (const q of questions) {
    if (!asked.includes(q.id)) continue
    const answer = questionDefinitions[q.id].read(content, q, context)
    if (!answer) continue
    // Two questions about the dates answer one window: the one asked last wins, as it is fuller.
    Object.assign(answers, answer)
    answered.push(q.id)
  }
  return { answers, answered }
}
