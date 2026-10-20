/**
 * The write and edit form of a test question (FR-501): its fields in plain words, the rules the
 * service applies (src/domain/golden-question.ts) with messages that say what to do, and the
 * conversions to and from the API's shape. A field the form does not show (a third wording, the
 * scope, link expectations, the expected delivery status) is kept as it was.
 */
import * as z from 'zod/mini'
import { questionIdSchema } from '@domain/golden-question'
import type { SaveTestQuestionInput, TestQuestion } from '@/api'

export const WORDING_MAX = 2000
export const CAVEAT_MAX = 500
export const SOURCE_MAX = 200
export const RUBRIC_MAX = 300
export const RUBRICS_MAX = 10
export const ITEMS_MAX = 20

const problem = (message: string) => ({ message })
const filled = (value: string) => value.trim() !== ''

export function questionFormSchema({
  isNew,
  takenIds,
}: {
  isNew: boolean
  takenIds: ReadonlySet<string>
}) {
  const wording = (what: string) =>
    z.string().check(
      z.refine(filled, problem(`Write the ${what} wording.`)),
      z.refine(
        (value) => !filled(value) || value.trim().length >= 3,
        problem('Use at least 3 characters.'),
      ),
      z.refine(
        (value) => value.trim().length <= WORDING_MAX,
        problem(`Shorten it to ${WORDING_MAX.toLocaleString('en')} characters.`),
      ),
    )
  return z
    .object({
      area: z.string().check(z.refine(filled, problem('Choose the domain the question tests.'))),
      id: z.string().check(
        z.refine((value) => !isNew || filled(value), problem('Give the question a short name.')),
        z.refine(
          (value) =>
            !isNew || !filled(value) || z.safeParse(questionIdSchema, value.trim()).success,
          problem(
            'Use 3 to 81 lowercase letters, digits and dashes, starting with a letter or digit.',
          ),
        ),
        z.refine(
          (value) => !isNew || !takenIds.has(value.trim()),
          problem('A test question has this name already. Choose another one.'),
        ),
      ),
      natural: wording('natural'),
      precise: wording('precise'),
      mustDeliver: z
        .array(z.string())
        .check(
          z.refine((ids) => ids.length <= ITEMS_MAX, problem(`Choose at most ${ITEMS_MAX} facts.`)),
        ),
      mustNotDeliver: z
        .array(z.string())
        .check(
          z.refine((ids) => ids.length <= ITEMS_MAX, problem(`Choose at most ${ITEMS_MAX} facts.`)),
        ),
      caveat: z.string().check(
        z.refine(
          (value) => !filled(value) || value.trim().length >= 3,
          problem('Use at least 3 characters, or leave it empty.'),
        ),
        z.refine(
          (value) => value.trim().length <= CAVEAT_MAX,
          problem(`Shorten it to ${CAVEAT_MAX} characters.`),
        ),
      ),
      noCauseClaim: z.boolean(),
      clarifyingQuestion: z.boolean(),
      rubrics: z.string().check(
        z.refine(
          (value) => rubricLines(value).length <= RUBRICS_MAX,
          problem(`Write at most ${RUBRICS_MAX} rubrics, one a line.`),
        ),
        z.refine(
          (value) =>
            rubricLines(value).every((line) => line.length >= 3 && line.length <= RUBRIC_MAX),
          problem(`Each rubric takes 3 to ${RUBRIC_MAX} characters.`),
        ),
      ),
      risk: z.enum(['low', 'normal', 'high']),
      split: z.enum(['development', 'held_out']),
      source: z.string().check(
        z.refine(filled, problem('Say where the question comes from, such as a team and a month.')),
        z.refine(
          (value) => value.trim().length <= SOURCE_MAX,
          problem(`Shorten it to ${SOURCE_MAX} characters.`),
        ),
      ),
    })
    .check(
      z.refine((values) => !values.mustDeliver.some((id) => values.mustNotDeliver.includes(id)), {
        message: "A fact can't be both expected and kept out.",
        path: ['mustNotDeliver'],
      }),
    )
}

export type QuestionFormValues = z.input<ReturnType<typeof questionFormSchema>>

/** The rubrics as the form holds them: one a line, blank lines left out. */
export const rubricLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

/** A new question's form, in a domain and optionally expecting one item already. */
export function newQuestionValues(area: string, itemId?: string): QuestionFormValues {
  return {
    area,
    id: '',
    natural: '',
    precise: '',
    mustDeliver: itemId ? [itemId] : [],
    mustNotDeliver: [],
    caveat: '',
    noCauseClaim: true,
    clarifyingQuestion: false,
    rubrics: '',
    risk: 'normal',
    split: 'development',
    source: '',
  }
}

const wordingOf = (question: TestQuestion, kind: 'natural' | 'precise') =>
  question.wordings.find((wording) => wording.kind === kind)?.text ?? ''

export function questionValues(question: TestQuestion): QuestionFormValues {
  return {
    area: question.area,
    id: question.id,
    natural: wordingOf(question, 'natural'),
    precise: wordingOf(question, 'precise'),
    mustDeliver: [...question.expected.must_deliver],
    mustNotDeliver: [...question.expected.must_not_deliver],
    caveat: question.expected.caveat ?? '',
    noCauseClaim: question.expected.no_cause_claim,
    clarifyingQuestion: question.expected.clarifying_question,
    rubrics: question.rubrics.join('\n'),
    risk: question.risk,
    split: question.split,
    source: question.source,
  }
}

/** A new question's name from its natural wording: lowercase words joined by dashes. */
export function questionIdFrom(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug.length >= 3 ? slug : ''
}

/**
 * The save the form asks for. The first natural and the first precise wording are the form's;
 * any other wording, the scope, the link expectations and the expected status stay as they were.
 * A new question takes `scope` when it has one: the scope of the gap it is written from.
 */
export function toSaveQuestionInput(
  values: QuestionFormValues,
  original: TestQuestion | null,
  scope: TestQuestion['scope'] = {},
): SaveTestQuestionInput {
  const id = original?.id ?? values.id.trim()
  const others = (original?.wordings ?? []).filter((wording, index, all) => {
    const first = all.findIndex((candidate) => candidate.kind === wording.kind)
    return first !== index
  })
  const caveat = values.caveat.trim()
  const expected = original?.expected
  return {
    id,
    ...(original ? { revision: original.revision } : {}),
    question: {
      id,
      area: values.area,
      wordings: [
        { kind: 'natural', text: values.natural.trim() },
        { kind: 'precise', text: values.precise.trim() },
        ...others,
      ],
      scope: original?.scope ?? scope,
      expected: {
        must_deliver: values.mustDeliver,
        must_not_deliver: values.mustNotDeliver,
        ...(expected?.reachable_via_link
          ? { reachable_via_link: expected.reachable_via_link }
          : {}),
        ...(expected?.forbidden_links ? { forbidden_links: expected.forbidden_links } : {}),
        ...(expected?.status ? { status: expected.status } : {}),
        ...(caveat ? { caveat } : {}),
        no_cause_claim: values.noCauseClaim,
        clarifying_question: values.clarifyingQuestion,
      },
      rubrics: rubricLines(values.rubrics),
      risk: values.risk,
      source: values.source.trim(),
      status: original?.status ?? 'active',
      split: values.split,
      // The form has no field for the day a question is asked on: a change keeps it.
      ...(original?.as_of ? { as_of: original.as_of } : {}),
    },
  }
}
