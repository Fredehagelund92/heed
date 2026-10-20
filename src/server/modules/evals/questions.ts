import { ORPCError } from '@orpc/client'
import { parse, stringify } from 'yaml'
import { canonicalJson } from '../../../domain/canonical.ts'
import { textFindings } from '../../../domain/draft.ts'
import {
  goldenQuestionSchema,
  questionFileSchema,
  type GoldenQuestion,
} from '../../../domain/golden-question.ts'
import type { Queryable } from '../../db/database.ts'

/**
 * Golden questions (FR-501, FR-504, FR-514, FR-520). Owners and deputies of the area and
 * administrators create, edit, retire and set them aside; every save is a new revision, so a run
 * names the exact text it used. Held-out questions are for checks and reports only (FR-503):
 * only those who maintain them can read them.
 */

export type StoredQuestion = GoldenQuestion & {
  revision: number
  setAsideReason: string | null
  updatedAt: string
}
type Row = {
  id: string
  area_id: string
  wordings: GoldenQuestion['wordings']
  scope: GoldenQuestion['scope']
  expected: GoldenQuestion['expected']
  rubrics: string[]
  risk: GoldenQuestion['risk']
  source: string
  status: GoldenQuestion['status']
  split: GoldenQuestion['split']
  as_of: string | null
  set_aside_reason: string | null
  revision: number
  updated_at: string
}
const columns = `id,area_id,wordings,scope,expected,rubrics,risk::text,source,status::text,split::text,
  as_of::text,set_aside_reason,revision,updated_at::text`

export const bodyOf = (q: StoredQuestion | GoldenQuestion): GoldenQuestion => ({
  id: q.id,
  area: q.area,
  wordings: q.wordings,
  scope: q.scope,
  expected: q.expected,
  rubrics: q.rubrics,
  risk: q.risk,
  source: q.source,
  status: q.status,
  split: q.split,
  ...(q.as_of ? { as_of: q.as_of } : {}),
})
function fromRow(row: Row): StoredQuestion {
  const { as_of, ...rest } = row
  const body = goldenQuestionSchema.parse({
    ...rest,
    area: row.area_id,
    ...(as_of ? { as_of } : {}),
  })
  return {
    ...body,
    revision: row.revision,
    setAsideReason: row.set_aside_reason,
    updatedAt: row.updated_at,
  }
}

async function maintains(tx: Queryable, area: string): Promise<boolean> {
  const [row] = await tx.query<{ ok: boolean }>(
    'select cl_is_owner_now($1) or cl_is_admin_now() as ok',
    [area],
  )
  return row?.ok ?? false
}
async function mustMaintain(tx: Queryable, area: string) {
  if (!(await maintains(tx, area)))
    throw new ORPCError('FORBIDDEN', {
      message: 'Only the owners of the domain and admins can change its test questions.',
    })
}

export async function listQuestions(
  tx: Queryable,
  filter: { area?: string | undefined; status?: GoldenQuestion['status'] | undefined },
): Promise<StoredQuestion[]> {
  const rows = await tx.query<Row>(
    `select ${columns} from golden_questions
      where ($1::text is null or area_id=$1) and ($2::text is null or status::text=$2)
        and (split='development' or cl_is_admin_now() or cl_is_owner_now(area_id))
      order by area_id,id`,
    [filter.area ?? null, filter.status ?? null],
  )
  return rows.map(fromRow)
}

export async function getQuestion(tx: Queryable, id: string): Promise<StoredQuestion> {
  const [row] = await tx.query<Row>(
    `select ${columns} from golden_questions
      where id=$1 and (split='development' or cl_is_admin_now() or cl_is_owner_now(area_id))`,
    [id],
  )
  if (!row)
    throw new ORPCError('NOT_FOUND', {
      message: "We couldn't find this test question. Someone may have deleted it.",
    })
  return fromRow(row)
}

function checkText(question: GoldenQuestion) {
  const findings = textFindings({
    wordings: question.wordings,
    rubrics: question.rubrics,
    caveat: question.expected.caveat,
    source: question.source,
  })
  if (findings.length)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message:
        "A test question can't hold an email address, phone number, secret or a question someone really asked.",
      data: { findings },
    })
}

async function areaExists(tx: Queryable, area: string) {
  const [row] = await tx.query('select 1 from areas where id=$1', [area])
  if (!row)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: `We couldn't find the domain ${area}.`,
    })
}

/** Creates (revision absent) or replaces (revision is the one read) a question. */
export async function saveQuestion(
  tx: Queryable,
  question: GoldenQuestion,
  revision: number | null,
): Promise<StoredQuestion> {
  checkText(question)
  await areaExists(tx, question.area)
  await mustMaintain(tx, question.area)
  const [current] = await tx.query<Row>(
    `select ${columns} from golden_questions where id=$1 for update`,
    [question.id],
  )
  if (current) {
    if (revision === null)
      throw new ORPCError('CONFLICT', { message: 'A test question with this id already exists.' })
    if (current.revision !== revision)
      throw new ORPCError('CONFLICT', {
        message:
          'Someone changed this test question after you opened it. Look at the latest version, then try again.',
      })
    if (current.area_id !== question.area) await mustMaintain(tx, current.area_id)
  } else if (revision !== null) {
    throw new ORPCError('NOT_FOUND', {
      message: "We couldn't find this test question. Someone may have deleted it.",
    })
  }
  const next = (current?.revision ?? 0) + 1
  const values = [
    question.id,
    question.area,
    JSON.stringify(question.wordings),
    JSON.stringify(question.scope),
    JSON.stringify(question.expected),
    JSON.stringify(question.rubrics),
    question.risk,
    question.source,
    question.status,
    question.split,
    next,
    question.as_of ?? null,
  ]
  if (current)
    await tx.query(
      `update golden_questions set area_id=$2,wordings=$3,scope=$4,expected=$5,rubrics=$6,risk=$7,source=$8,
         status=$9,split=$10,revision=$11,as_of=$12,updated_at=now() where id=$1`,
      values,
    )
  else
    await tx.query(
      `insert into golden_questions(id,area_id,wordings,scope,expected,rubrics,risk,source,status,split,revision,as_of,created_by)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,cl_person())`,
      values,
    )
  await tx.query(
    `insert into golden_question_revisions(question_id,revision,body,saved_by) values($1,$2,$3,cl_person())`,
    [question.id, next, JSON.stringify(question)],
  )
  await tx.query(
    `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
     values(cl_person(),'person',$1,$2,'golden_question',$3,$4)`,
    [
      current ? 'golden_question.changed' : 'golden_question.created',
      question.area,
      question.id,
      JSON.stringify({ revision: next, status: question.status }),
    ],
  )
  return getQuestion(tx, question.id)
}

/** FR-514: an owner sets a question aside with a reason (or takes it back); runs skip and count it. */
export async function setAside(
  tx: Queryable,
  id: string,
  revision: number,
  reason: string | null,
): Promise<StoredQuestion> {
  const question = await getQuestion(tx, id)
  await mustMaintain(tx, question.area)
  if (reason !== null) checkText({ ...question, source: reason })
  const rows = await tx.query(
    'update golden_questions set set_aside_reason=$3,updated_at=now() where id=$1 and revision=$2 returning id',
    [id, revision, reason],
  )
  if (!rows.length)
    throw new ORPCError('CONFLICT', {
      message:
        'Someone changed this test question after you opened it. Look at the latest version, then try again.',
    })
  await tx.query(
    `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
     values(cl_person(),'person',$1,$2,'golden_question',$3,$4)`,
    [
      reason === null ? 'golden_question.restored' : 'golden_question.set_aside',
      question.area,
      id,
      JSON.stringify({ reason }),
    ],
  )
  return getQuestion(tx, id)
}

export type ImportReport = {
  applied: boolean
  created: string[]
  updated: string[]
  unchanged: string[]
  errors: { index: number; id: string | null; message: string }[]
}

/** FR-504: a file of questions (YAML or JSON), checked whole; nothing is saved unless all are valid. */
export async function importQuestions(
  tx: Queryable,
  content: string,
  dryRun: boolean,
): Promise<ImportReport> {
  const report: ImportReport = {
    applied: false,
    created: [],
    updated: [],
    unchanged: [],
    errors: [],
  }
  let document: unknown
  try {
    document = parse(content, { maxAliasCount: 0 })
  } catch {
    report.errors.push({
      index: -1,
      id: null,
      message: "We couldn't read this file. Use YAML or JSON.",
    })
    return report
  }
  const file = questionFileSchema.safeParse(document)
  if (!file.success) {
    report.errors.push({
      index: -1,
      id: null,
      message: 'The file should hold a list of test questions.',
    })
    return report
  }
  const entries = Array.isArray(file.data) ? file.data : file.data.questions
  const plan: { question: GoldenQuestion; revision: number | null }[] = []
  const seen = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    const parsed = goldenQuestionSchema.safeParse(entry)
    const id =
      entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string'
        ? entry.id
        : null
    if (!parsed.success) {
      report.errors.push({
        index,
        id,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      })
      continue
    }
    const question = parsed.data
    if (seen.has(question.id)) {
      report.errors.push({ index, id, message: 'This id is in the file twice.' })
      continue
    }
    seen.add(question.id)
    const findings = textFindings(question)
    if (findings.length) {
      report.errors.push({
        index,
        id,
        message:
          'It holds an email address, phone number, secret or a question someone really asked.',
      })
      continue
    }
    const [area] = await tx.query('select 1 from areas where id=$1', [question.area])
    if (!area || !(await maintains(tx, question.area))) {
      report.errors.push({
        index,
        id,
        message: `You can't change the test questions of ${question.area}.`,
      })
      continue
    }
    const [current] = await tx.query<Row>(`select ${columns} from golden_questions where id=$1`, [
      question.id,
    ])
    if (current && current.area_id !== question.area && !(await maintains(tx, current.area_id))) {
      report.errors.push({
        index,
        id,
        message: `You can't change the test questions of ${current.area_id}.`,
      })
      continue
    }
    if (current && canonicalJson(bodyOf(fromRow(current))) === canonicalJson(question))
      report.unchanged.push(question.id)
    else {
      ;(current ? report.updated : report.created).push(question.id)
      plan.push({ question, revision: current?.revision ?? null })
    }
  }
  if (report.errors.length || dryRun) return report
  for (const step of plan) await saveQuestion(tx, step.question, step.revision)
  report.applied = true
  return report
}

export async function exportQuestions(tx: Queryable, area: string | undefined): Promise<string> {
  const questions = await listQuestions(tx, { area })
  return stringify({ questions: questions.map(bodyOf) }, { lineWidth: 0 })
}
