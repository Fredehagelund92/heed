import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
} from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'

/**
 * The scripted mock model: the default in development and every test (MODELS=mock). It
 * behaves like a careful agent so the evaluation harness can be tested end to end without a key:
 * the answer model calls get_context with the question, then answers with what was delivered
 * (ids, titles, summaries) and the coverage statement; the judge model grades by fixed rules. A
 * deliberately wrong item therefore changes the answer in a way the judge sees. When get_related
 * is offered, it follows the links of the delivered items once and adds the neighbour items it
 * read, so a links run can show the instrument working. It never claims what a real model would
 * say.
 */

/** The judge's data block. The evaluation judge writes it; the scripted judge reads it. */
export const gradingTag = 'grading_input'
export type GradingInput = {
  answer: string
  caveat: string | null
  /** Each rubric with the id the judge grades it by (`rubric_1`, ...). */
  rubrics: { id: string; text: string }[]
}

const tokens = (text: string) => Math.max(1, Math.ceil(text.length / 4))
function result(
  content: LanguageModelV4Content[],
  prompt: LanguageModelV4Prompt,
  finish: 'stop' | 'tool-calls',
): LanguageModelV4GenerateResult {
  const input = tokens(JSON.stringify(prompt))
  const output = tokens(JSON.stringify(content))
  return {
    content,
    finishReason: { unified: finish, raw: finish },
    usage: {
      inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: output, text: output, reasoning: 0 },
    },
    warnings: [],
  }
}

function lastUserText(prompt: LanguageModelV4Prompt): string {
  for (const message of [...prompt].reverse())
    if (message.role === 'user')
      return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
  return ''
}

type Delivery = {
  status?: string
  items?: { id: string; title: string; summary: string }[]
  options?: { field: string; input: string; options: string[] }[]
  check_report?: { statements?: string[] }
}
type Neighbours = {
  nodes?: { id: string; type: string; status: string; label: string; summary?: string }[]
}
function results<T>(prompt: LanguageModelV4Prompt, tool: string, failed: T): T[] {
  const found: T[] = []
  for (const message of [...prompt].reverse()) {
    if (message.role !== 'tool') continue
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.toolName !== tool) continue
      const output = part.output
      if (output.type === 'json') found.push(output.value as T)
      else if (output.type === 'text') {
        try {
          found.push(JSON.parse(output.value) as T)
        } catch {
          found.push(failed)
        }
      } else found.push(failed)
    }
  }
  return found
}
const lastDelivery = (prompt: LanguageModelV4Prompt): Delivery | null =>
  results<Delivery>(prompt, 'get_context', { status: 'check_failed' })[0] ?? null

function answerFor(delivery: Delivery, neighbours: Neighbours[] = []): string {
  if (delivery.status === 'need_more_detail') {
    const asks = (delivery.options ?? []).map((o) =>
      o.options.length ? `${o.field} (${o.options.slice(0, 5).join(', ')})` : o.field,
    )
    return `Which ${asks.join(' and ') || 'metric, market and dates'} do you mean?`
  }
  const coverage = delivery.check_report?.statements?.join(' ') ?? ''
  if (delivery.status === 'check_failed') return `The context checks could not run. ${coverage}`
  const items = delivery.items ?? []
  if (!items.length) return `No governed context applies to this question. ${coverage}`
  const lines = items.map((item) => `- [${item.id}] ${item.title}: ${item.summary}`)
  // Only neighbour items in service carry a summary; a retired one is a marker, never cited.
  const shown = new Set(items.map((item) => item.id))
  const linked: string[] = []
  for (const node of neighbours.flatMap((n) => n.nodes ?? [])) {
    if (node.type !== 'item' || node.status !== 'current' || shown.has(node.id)) continue
    shown.add(node.id)
    linked.push(`- [${node.id}] ${node.label}: ${node.summary ?? ''}`)
  }
  return [
    `Governed context for this question:`,
    ...lines,
    ...(linked.length ? ['Linked context, which may not apply to this question:', ...linked] : []),
    coverage,
  ].join('\n')
}

function answer(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
  const prompt = options.prompt
  const delivery = lastDelivery(prompt)
  const canAsk = options.tools?.some((t) => t.name === 'get_context') ?? false
  if (!delivery && canAsk)
    return Promise.resolve(
      result(
        [
          {
            type: 'tool-call',
            toolCallId: 'call_get_context',
            toolName: 'get_context',
            input: JSON.stringify({ question: lastUserText(prompt) }),
          },
        ],
        prompt,
        'tool-calls',
      ),
    )
  const canFollow = options.tools?.some((t) => t.name === 'get_related') ?? false
  const neighbours = results<Neighbours>(prompt, 'get_related', {})
  const delivered = delivery?.items ?? []
  if (delivered.length && canFollow && !neighbours.length)
    return Promise.resolve(
      result(
        delivered.slice(0, 5).map((item, index) => ({
          type: 'tool-call' as const,
          toolCallId: `call_get_related_${index}`,
          toolName: 'get_related',
          input: JSON.stringify({ id: item.id }),
        })),
        prompt,
        'tool-calls',
      ),
    )
  const text = delivery ? answerFor(delivery, neighbours) : 'I cannot reach the context tools.'
  return Promise.resolve(result([{ type: 'text', text }], prompt, 'stop'))
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? []
/** A caveat counts as present when most of its meaningful words appear in the answer. */
export function mentions(answer: string, phrase: string): boolean {
  const have = new Set(words(answer))
  const need = words(phrase).filter((w) => w.length >= 4)
  if (!need.length) return answer.toLowerCase().includes(phrase.toLowerCase())
  return need.filter((w) => have.has(w)).length / need.length >= 0.8
}
const causal = /\b(because|caused|causes|due to|led to|leads to|resulted in|drove|driven by)\b/i
/**
 * The answer without its questions: a question claims no cause, such as the title of an example it
 * quotes ("Which markets drove the change in Orders?").
 */
const statements = (answer: string) => answer.replace(/[^.!?:\n]*\?/g, '')

function judge(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
  const prompt = options.prompt
  const text = lastUserText(prompt)
  const match = new RegExp(`<${gradingTag}>([\\s\\S]*)</${gradingTag}>`).exec(text)
  const input = match ? (JSON.parse(match[1]!) as GradingInput) : null
  const verdict = input
    ? {
        caveat_present: input.caveat === null ? null : mentions(input.answer, input.caveat),
        cause_claimed: causal.test(statements(input.answer)),
        asks_clarifying_question: input.answer.includes('?'),
        // A rubric passes when every phrase it quotes appears in the answer.
        rubrics: input.rubrics.map((rubric) => ({
          id: rubric.id,
          passed: [...rubric.text.matchAll(/"([^"]+)"/g)].every((q) =>
            input.answer.toLowerCase().includes(q[1]!.toLowerCase()),
          ),
        })),
        reason: 'Scripted judge: fixed rules, no model.',
      }
    : null
  return Promise.resolve(result([{ type: 'text', text: JSON.stringify(verdict) }], prompt, 'stop'))
}

export const scriptedAnswerModel = () =>
  new MockLanguageModelV4({ provider: 'mock', modelId: 'scripted-answer', doGenerate: answer })
export const scriptedJudgeModel = () =>
  new MockLanguageModelV4({ provider: 'mock', modelId: 'scripted-judge', doGenerate: judge })
