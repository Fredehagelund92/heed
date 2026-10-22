import { answerAsMarkdown, readQuestion, type AnswerView, type AskMessage } from '@/lib/assistant'
import { productName } from '@/lib/brand'
import type { TryItScope } from '@/lib/try-it'

/*
  Export chat: the conversation on screen as Markdown a person can paste into an email or a chat,
  and as JSON for debugging. It is built only from what the chat shows: each question and its
  scope, each answer's words, the steps it took, and the facts it read (a fact's id, title,
  status, domain and when it was accepted, never its body). It never reads a message's other
  parts or metadata, so a seal, an id, a tool's raw output or the scope line the model read
  cannot reach it. Heed never records who asked, so the person is "You" and no name is added.
  Pure: the time, the build and the names come in as arguments.
*/

/** What the facts of an answer are looked up in: the library row of a fact, when it has one. */
export type ExportFactRow = { status: string; domain: string }

export type ExportInput = {
  messages: readonly AskMessage[]
  /** Each assistant message's answer, by message id. */
  answers: ReadonlyMap<string, AnswerView>
  /** A fact's status and domain, as the library names them; null when it is not in the library. */
  factRow: (id: string) => ExportFactRow | null
  /** A scope in words ("Average order value, 1 to 30 Jun 2026"). */
  scopeWords: (scope: TryItScope) => string
  /** The app's version and build. */
  build: { version: string; build: string }
  /** The time of the export, ISO 8601. */
  exportedAt: string
  /** The address a fact's page is under, for the links of the text version. */
  origin: string
  /** Time zone for the times of the text version; the browser's when left out. */
  timeZone?: string
}

export type ExportFact = {
  id: string
  title: string
  status: string | null
  domain: string | null
  /** How it stands for the question: applies, applies in part, doesn't apply, or only read. */
  verdict: string
  reason: string | null
  /** The edition it was served in and the day it was accepted, from its review stamp. */
  edition: string | null
  asOf: string | null
}

export type ExportStep = { words: string; object: string | null; counts: string | null }

/** What a question or an answer is about: the scope in words, and the first and last day. */
export type ExportScope = { words: string; from: string | null; to: string | null }

export type ExportMessage =
  | { role: 'you'; at: string | null; text: string; asked: ExportScope | null }
  | {
      role: 'assistant'
      at: string | null
      text: string
      /** The scope the assistant read the facts for. */
      read: ExportScope | null
      edition: string | null
      model: string | null
      mode: 'mock' | 'real' | null
      steps: ExportStep[]
      facts: ExportFact[]
    }

export type ChatExport = {
  title: string
  exportedAt: string
  app: { version: string; build: string }
  /** The model of the latest answer and whether it is the scripted one. */
  model: string | null
  mode: 'mock' | 'real' | null
  /** The edition the latest answer read. */
  edition: string | null
  messages: ExportMessage[]
}

const TITLE_LENGTH = 80

/** The first question, shortened to one line: the chat's title. */
function titleOf(messages: readonly AskMessage[]): string {
  const first = messages.find((message) => message.role === 'user')
  const text = first ? readQuestion(first).text.replace(/\s+/g, ' ').trim() : ''
  if (!text) return 'Chat with the assistant'
  return text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : text
}

type Entry = { message: ExportMessage; answer?: AnswerView }

function entriesOf(input: ExportInput): Entry[] {
  const { messages, answers, factRow } = input
  const scopeOf = (scope: TryItScope | null): ExportScope | null =>
    scope && { words: input.scopeWords(scope), from: scope.from, to: scope.to }
  const entries: Entry[] = []
  messages.forEach((message, index) => {
    const at = message.metadata?.at ?? null
    if (message.role === 'user') {
      const question = readQuestion(message)
      entries.push({
        message: { role: 'you', at, text: question.text, asked: scopeOf(question.scope) },
      })
      return
    }
    const answer = answers.get(message.id)
    if (message.role !== 'assistant' || !answer) return
    const asked = messages.slice(0, index).findLast((m) => m.role === 'user')
    const model = message.metadata?.model ?? null
    entries.push({
      answer,
      message: {
        role: 'assistant',
        at,
        text: answer.plain,
        read: scopeOf(answer.scopeUsed ?? (asked ? readQuestion(asked).scope : null)),
        edition: answer.edition,
        model: model?.name ?? null,
        mode: model ? (model.mock ? 'mock' : 'real') : null,
        steps: answer.steps.map(({ words, object, counts }) => ({ words, object, counts })),
        facts: answer.facts.map((fact) => {
          const row = factRow(fact.id)
          return {
            id: fact.id,
            title: fact.title,
            status: row?.status ?? null,
            domain: row?.domain ?? null,
            verdict: fact.verdict,
            reason: fact.reason,
            edition: fact.reviewed?.edition ?? null,
            asOf: fact.reviewed?.acceptedOn.slice(0, 10) ?? null,
          }
        }),
      },
    })
  })
  return entries
}

function chatOf(input: ExportInput, entries: Entry[]): ChatExport {
  const latest = entries.findLast((entry) => entry.message.role === 'assistant')?.message
  const assistant = latest?.role === 'assistant' ? latest : null
  return {
    title: titleOf(input.messages),
    exportedAt: input.exportedAt,
    app: input.build,
    model: assistant?.model ?? null,
    mode: assistant?.mode ?? null,
    edition: assistant?.edition ?? null,
    messages: entries.map((entry) => entry.message),
  }
}

/** The chat as the structured export holds it. */
export function buildChatExport(input: ExportInput): ChatExport {
  return chatOf(input, entriesOf(input))
}

/** The export as the JSON file holds it. */
export function exportAsJson(chat: ChatExport): string {
  return `${JSON.stringify(chat, null, 2)}\n`
}

const modeWords = { mock: 'demo data', real: 'live' } as const

/**
 * The chat as Markdown for a person: the title, then each message as "You" or "Assistant" with
 * its time, the answer with each fact a link to its page, and what the assistant read.
 */
export function exportAsMarkdown(input: ExportInput): string {
  const { origin, timeZone } = input
  const entries = entriesOf(input)
  const chat = chatOf(input, entries)
  const at = (iso: string | null) => (iso ? ` · ${moment(iso, timeZone)}` : '')
  const head = [
    `# ${chat.title}`,
    [
      `Exported ${moment(chat.exportedAt, timeZone)}`,
      `${productName} ${chat.app.version}, build ${chat.app.build}`,
      chat.model && chat.mode ? `Assistant: ${chat.model} (${modeWords[chat.mode]})` : null,
      chat.edition ? `What agents got: ${chat.edition}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  ].join('\n\n')
  const blocks = entries.map(({ message, answer }) => {
    if (message.role === 'you')
      return [
        `## You${at(message.at)}`,
        message.text,
        message.asked?.words ? `About: ${message.asked.words}.` : null,
      ]
        .filter(Boolean)
        .join('\n\n')
    const titleOfFact = (id: string) => message.facts.find((f) => f.id === id)?.title ?? id
    const text = answer
      ? answerAsMarkdown(answer, { origin, titleOf: titleOfFact, scopeWords: null })
      : message.text
    return [
      `## Assistant${at(message.at)}`,
      text,
      message.read?.words ? `Read for: ${message.read.words}.` : null,
      message.steps.length
        ? `Steps:\n${message.steps
            .map((s) => `- ${[s.words, s.object, s.counts].filter(Boolean).join(' · ')}`)
            .join('\n')}`
        : null,
      message.facts.length
        ? `Facts read:\n${message.facts.map((fact) => factLine(fact, origin)).join('\n')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n\n')
  })
  return `${[head, ...blocks].join('\n\n---\n\n')}\n`
}

function factLine(fact: ExportFact, origin: string): string {
  const detail = [
    fact.status,
    fact.domain,
    fact.verdict,
    fact.asOf ? `accepted ${moment(fact.asOf, 'UTC', false)}` : null,
    fact.edition ? `Agents got it in ${fact.edition}` : null,
  ]
    .filter(Boolean)
    .join(', ')
  return `- [${fact.title.replace(/[[\]]/g, '')}](${origin}/library/${fact.id})${detail ? `: ${detail}` : ''}`
}

/** "20 October 2026, 14:03" in the zone; a day alone when `time` is false. */
function moment(iso: string, timeZone?: string, time = true): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  }).format(date)
  if (!time) return day
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).format(date)
  return `${day}, ${clock}`
}

/** The JSON file's name: "heed-chat-2026-10-20-1403.json", in the person's time. */
export function exportFileName(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `heed-chat-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`
}
