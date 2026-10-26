import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider'
import { randomUUID } from 'node:crypto'
import { MockLanguageModelV4 } from 'ai/test'
import { SCOPE_LINE } from '../../../contract/assistant.ts'
import { longDayWords } from '../../../domain/dates.ts'
import { ABOUT_BUSINESS_END } from '../../../domain/about-business.ts'
import { domainsInText } from '../../../domain/domain-match.ts'
import { normalizeName } from '../../../domain/vocabulary.ts'
import {
  asksAboutChange,
  changeLead,
  changeSubject,
  demoFallback,
  followUpKind,
  followUpReply,
  helpQuestion,
  looksLikeDataQuestion,
  metaKind,
  metaReply,
  type MetaFacts,
} from '../../../domain/assistant-meta.ts'
import { productName } from '../../brand.ts'

/**
 * The scripted assistant: the default in development and every test (MODELS=mock). It
 * picks one tool from plain words in the person's message, then explains that tool's result,
 * citing only the item ids the result holds. Like a real model, it reads Heed's turn context:
 * "last week" is the week it names, and a draft goes to the domain its words name. It exists to
 * test the assistant's harness (tools, permissions, citations, confirmations, the turn context,
 * budgets and streaming) without a key; it never claims what a real model would say. A greeting,
 * thanks, "what can you do" and other messages about the assistant itself get a plain answer with
 * no tool (domain/assistant-meta.ts); a question about how Heed works is answered from Heed's help
 * pages (search_help), with a link to the page; a message it cannot place says it is the demo model.
 */

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

/** Streams a generate result: text in small pieces, other content as it is, then the finish. */
export function streamResult(
  generated: LanguageModelV4GenerateResult,
): LanguageModelV4StreamResult {
  const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }]
  generated.content.forEach((part, index) => {
    if (part.type === 'tool-call') {
      parts.push(part)
      return
    }
    if (part.type !== 'text') throw new Error(`The scripted stream has no ${part.type} parts`)
    const id = `text-${index}`
    parts.push({ type: 'text-start', id })
    for (const piece of part.text.match(/\S+\s*|\s+/g) ?? [])
      parts.push({ type: 'text-delta', id, delta: piece })
    parts.push({ type: 'text-end', id })
  })
  parts.push({
    type: 'finish',
    finishReason: generated.finishReason,
    usage: generated.usage,
  })
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      },
    }),
  }
}

const textOf = (content: { type: string; text?: string }[]) =>
  content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('\n')

type Output = Record<string, unknown>
type ToolResult = { toolName: string; output: Output | null; denied: boolean }

/** The person's last message, the tool results after it in this turn, and the system text. */
function turn(prompt: LanguageModelV4Prompt) {
  let last = -1
  prompt.forEach((message, index) => {
    if (message.role === 'user') last = index
  })
  const user = last >= 0 ? textOf(prompt[last]!.content as { type: string }[]) : ''
  // What the person said before, newest last: a follow-up ("draft it anyway") draws on it.
  const earlier = prompt
    .slice(0, Math.max(last, 0))
    .flatMap((message) =>
      message.role === 'user' ? [textOf(message.content as { type: string }[])] : [],
    )
  // What the assistant said last, before this question: a follow-up on it ("what do you mean?").
  const answered = prompt
    .slice(0, Math.max(last, 0))
    .findLast((message) => message.role === 'assistant')
  const reply = answered ? textOf(answered.content).trim() || null : null
  const system = prompt
    .flatMap((message) => (message.role === 'system' ? [message.content] : []))
    .join('\n')
  const results: ToolResult[] = []
  for (const message of prompt.slice(last + 1)) {
    if (message.role !== 'tool') continue
    for (const part of message.content) {
      if (part.type !== 'tool-result') continue
      const output = part.output
      const value =
        output.type === 'json'
          ? output.value
          : output.type === 'error-text'
            ? { error: output.value }
            : output.type === 'text'
              ? (() => {
                  try {
                    return JSON.parse(output.value) as unknown
                  } catch {
                    return null
                  }
                })()
              : null
      results.push({
        toolName: part.toolName,
        output: value && typeof value === 'object' ? (value as Output) : null,
        denied: output.type === 'execution-denied',
      })
    }
  }
  return { user, earlier, reply, results, system }
}

/**
 * What the turn context says: the days of last week, and each domain by name with the metrics its
 * line says it is mostly about.
 */
export function turnContextOf(system: string) {
  const week = /Last week: (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(system)
  // The domains are listed before About our business, whose lines are an administrator's.
  const listed = system.split(ABOUT_START)[0]!
  return {
    lastWeek: week ? { from: week[1]!, to: week[2]! } : null,
    today: /^Today is .+? \((\d{4}-\d{2}-\d{2}),/m.exec(system)?.[1] ?? null,
    /** What the turn context says when web search is off: who switches it on, and where. */
    searchOff: /^Web search is off: you have no search_web\. (.+)$/m.exec(system)?.[1] ?? null,
    person: /^You are talking to (.+?), signed in to Heed/m.exec(system)?.[1] ?? null,
    domains: [...listed.matchAll(/^- (.+?) \(([a-z][a-z0-9_]*)\): (.*)$/gm)].map((m) => ({
      id: m[2]!,
      name: m[1]!,
      line: m[3]!,
      metrics: (/mostly about ([^.]+)\./.exec(m[3]!)?.[1] ?? '').split(', ').filter(Boolean),
    })),
  }
}

const ABOUT_START = '\nAbout our business, '

/**
 * The lines of About our business, in the turn context, that explain a term the person's words
 * name, such as "- First-time buyer: a customer whose first paid order...": none when the turn
 * has no such text or no line names one of their words. A real model reads the same lines as
 * background.
 */
export function backgroundOf(user: string, system: string): string[] {
  const start = system.indexOf(ABOUT_START)
  if (start < 0) return []
  const end = system.indexOf(`\n${ABOUT_BUSINESS_END}`, start)
  const lines = system
    .slice(start + 1, end < 0 ? undefined : end)
    .split('\n')
    .slice(1)
  return lines.flatMap((line) => {
    const term = /^- ([^:]{1,40}):\s*(.+)$/.exec(line)
    if (!term) return []
    const words = term[1]!
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '[\\s-]+')
    return new RegExp(`\\b${words}s?\\b`, 'i').test(user) ? [`${term[1]!.trim()}: ${term[2]!}`] : []
  })
}

/**
 * The header of the block that names the scope of the person's question: what they attached, or
 * what the composer read and showed (assistant/attachments.ts).
 */
const ATTACHED = /^(Attached to|The scope of) the person's latest question/

/**
 * What the person attached to their latest question, as the block after the turn context names
 * it: one line each, without the leading dash. None when nothing was attached.
 */
export function attachedOf(system: string): string[] {
  const lines = system.split('\n')
  const start = lines.findIndex((line) => ATTACHED.test(line))
  if (start < 0) return []
  return lines
    .slice(start + 1)
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2))
}

/**
 * Whether the person's words ask what the attachment is ("What is this?", "Explain it"), not
 * which facts apply to it: a real model answers the first from the block, and looks up the second.
 */
const asksWhatItIs = (words: string) =>
  /\b(this|these|that|it|them)\b/i.test(words) &&
  /^\s*(what|explain|define|describe|tell me|meaning)\b|\bmeans?\b/i.test(words) &&
  !/\b(apply|applies|facts?|context|changed|happened|caveats?|why)\b/i.test(words)

/**
 * One attached line of the block, as a reply says it: what it is, its definition in its source's
 * own words, and how many facts are about it. The block is written for the model, as a real
 * model reads it; the reply is for the person.
 */
export function attachedWords(line: string): string {
  const name = /^([^:]+):/.exec(line)?.[1] ?? line
  const value = /: a value of the dimension ([^.]+)\./.exec(line)?.[1]
  const what = /: a dimension, attached with any value/.test(line)
    ? `every ${name}, not one in particular.`
    : value
      ? `a ${value.toLowerCase()}.`
      : /: a domain\b/.test(line)
        ? 'a domain.'
        : /: a context item\b/.test(line)
          ? 'a fact.'
          : ''
  const definition = /Its definition, from the definition source: ("[^"]*")/.exec(line)?.[1]
  const values = /Its values: ([^.]+)\./.exec(line)?.[1]
  const count = /(\d[\d,]*) items? of the live edition (?:is|are) about it/.exec(line)?.[1]
  const facts = count
    ? ` ${factsAbout(count, line, 'it')}`
    : /No item of the live edition is about it yet\./.test(line)
      ? ' No fact is about it yet.'
      : ''
  return `${name}: ${what}${definition ? ` Its definition: ${definition}` : ''}${values ? ` Its values: ${values}.` : ''}${facts}`.trim()
}

/**
 * How many facts are about a name, and how many of them AI agents get, from the counts the tools
 * give ("AI agents get 5 of them, not the other 2 yet: ..."): "7 facts are about it, and AI agents
 * get 5 of them. The other 2 wait for now."
 */
export function factsAbout(count: string, words: string, name: string): string {
  const about = `${count} ${count === '1' ? 'fact is' : 'facts are'} about ${name}`
  const some = /AI agents get ([\d,]+) of them, not the other ([\d,]+) yet/.exec(words)
  if (some)
    return `${about}, and AI agents get ${some[1]} of them. The other ${some[2]} wait for now.`
  if (/AI agents get none of/.test(words)) return `${about}, and AI agents get none of them yet.`
  return `${about}, and AI agents get ${count === '1' ? 'it' : 'all of them'}.`
}

/** The answer about what is attached, from the block: what each one is. */
const aboutAttached = (attached: string[]) =>
  ['You attached:', ...attached.map((line) => `- ${attachedWords(line)}`)].join('\n')

/** Whether the text names it as a whole, so "Practice (invented)" counts as much as "Sandbox". */
const named = (name: string, text: string) =>
  new RegExp(`(?<!\\w)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`, 'i').test(text)

/**
 * The domain a text is about: the one it names, or else the only one whose line names a metric
 * the text names; with that metric, by name. None when the text leaves it open.
 */
function domainOf(text: string, domains: ReturnType<typeof turnContextOf>['domains']) {
  const byName = domains.find((domain) => named(domain.name, text))
  if (byName) return { area: byName.name, metrics: [] }
  // A domain named by another spelling ("stores and suppliers" for "Stores & Suplliers") is
  // passed on in the person's words, as a model does, for Heed to read.
  const words = normalizeName(text)
  const [spelt] = domainsInText(words, domains)
  if (spelt) return { area: words.slice(spelt.start, spelt.end), metrics: [] }
  const byMetric = domains.flatMap((domain) => {
    const metrics = domain.metrics.filter((metric) => named(metric, text))
    return metrics.length ? [{ area: domain.name, metrics }] : []
  })
  return byMetric.length === 1 ? byMetric[0]! : null
}

/** A web address in the person's words, with its scheme or starting www. */
const webLink = /\b(?:https?:\/\/|www\.)[^\s<>"'`()[\]{}]+/i
/** Words that ask for context to be drafted, from a page or from what the person saw. */
const asksDraft = /\b(draft|propose|write (it|this) up|turn this|guide|context|caveat)\b/i
/** Words that say the person saw something somewhere, without a link. */
const sawIt = /\b(i saw|i read|saw this|in the news|on the news|online)\b/i
/**
 * What the scripted model says when asked to look something up while web search is off: who
 * switches it on and where, in the turn context's words, and that a pasted link works now.
 */
export function searchOffReply(searchOff: string | null): string {
  const setting =
    /switch it on (?:themselves )?(in Administration[^(.]*?)(?: \((\/admin[^)]*)\))?\./.exec(
      searchOff ?? '',
    )
  const where = setting
    ? setting[2]
      ? `You can switch it on yourself ${setting[1]} ([Limits](${setting[2]})).`
      : `An admin can switch it on ${setting[1]}.`
    : 'An admin can switch it on.'
  return `Web search is off here, so I can't look it up. ${where} Paste a link to the source and I'll read it now. If you're not sure when it happened, I can draft it anyway with the dates marked as uncertain.`
}

/** Words that ask the assistant to find something on the web. */
const lookUp =
  /\b(look (?:it |this )?up|search (?:the web|online|for it)|find (?:it|the source))\b/i

const itemId = /\bitm_[a-z0-9]{8,16}\b/
const proposalId = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/
/** A draft named by its number, as Heed shows it: "draft 2141" or "#2141". */
const draftNumber = /(?:\bdraft\s+#?|#)(\d{1,9})\b/i

/** The text a person pasted after a colon, or the whole message. */
function pasted(text: string) {
  const at = text.indexOf(':')
  return (at >= 0 ? text.slice(at + 1) : text).trim()
}

/**
 * The scope the person picked in the Ask tab (SCOPE_LINE and get_facts's fields as JSON), and
 * their words without that line. A real model passes the fields on as given; so does this one.
 */
export function pickedScope(user: string): { words: string; scope: Record<string, unknown> } {
  const lines = user.split('\n')
  const line = lines.findIndex((text) => text.startsWith(SCOPE_LINE))
  if (line < 0) return { words: user, scope: {} }
  try {
    const parsed: unknown = JSON.parse(lines[line]!.slice(SCOPE_LINE.length))
    const scope =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.fromEntries(
            Object.entries(parsed).filter(([key]) =>
              ['metrics', 'dimension_filters', 'window'].includes(key),
            ),
          )
        : {}
    return { words: lines.filter((_, i) => i !== line).join('\n'), scope }
  } catch {
    return { words: user, scope: {} }
  }
}

/**
 * What a meta answer says of this install, from the turn context: the person's name, the domains,
 * and a question to try that names a metric the domains are about.
 */
export function metaFactsOf(system: string): MetaFacts {
  const context = turnContextOf(system)
  const metric = context.domains.flatMap((domain) => domain.metrics)[0]
  const domain = context.domains[0]?.name
  return {
    product: productName,
    name: context.person,
    domains: context.domains.map((d) => d.name),
    // What a person asks about: what the domain is, what it holds and who owns it, without the
    // names and source counts the turn context adds for the model.
    lines: context.domains.map(
      (d) =>
        `${d.name}: ${d.line
          .split(/(?<=\.) /)
          .filter(
            (sentence) =>
              !/^(?:Names it knows|No names of its own|The domain's stored name|Example content)\b/.test(
                sentence,
              ) && !/\bcall its items\b|\bas its id\b/.test(sentence),
          )
          .join(' ')}`,
    ),
    example: metric
      ? `Which facts apply to ${metric} last week?`
      : domain
        ? `What does the ${domain} domain cover?`
        : 'What changed this week?',
  }
}

/** A tool to call, and what to say instead when the tool is not offered; or an answer at once. */
type Choice =
  | {
      tool: string
      input: Record<string, unknown>
      otherwise?: string
      /** Words before a call that waits for the person to confirm it. */
      words?: string
    }
  | { text: string }

/** Words that say the person does not know when it happened. */
const unsureDate =
  /\b(?:not sure|unsure|no idea|don'?t know|do not know|can'?t remember|cannot remember)\b[^.?!]{0,40}\b(?:date|day|when)\b/i

/**
 * The summary and the body from a text, as the drafting guide asks: whole sentences up to the
 * summary's limit, the rest in the body.
 */
function summaryAndBody(text: string): { summary: string; body?: string } {
  let summary = ''
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const next = summary ? `${summary} ${sentence}` : sentence
    if ([...next].length > SUMMARY_LIMIT) break
    summary = next
  }
  if (!summary) summary = [...text].slice(0, SUMMARY_LIMIT).join('')
  const body = text.slice(summary.length).trim()
  return body ? { summary, body } : { summary }
}
const SUMMARY_LIMIT = 280

/**
 * A draft from the person's own text: every field from their words. When they are unsure of the
 * date, it is drafted anyway from today, flagged, with a line that says so.
 */
function draftFromText(user: string, system: string, uncertain = false): Choice {
  const text = pasted(pickedScope(user).words).slice(0, 2000)
  const title = [...(text.split(/(?<=[.!?])\s/)[0] ?? text)].slice(0, 120).join('')
  // The domain its words name, by the names Heed gives it; Heed matches the names.
  const context = turnContextOf(system)
  const about = domainOf(text, context.domains)
  const words = summaryAndBody(text)
  const today = uncertain ? context.today : null
  return {
    tool: 'create_draft',
    input: {
      draft: {
        kind: 'note',
        title,
        ...words,
        ...(about ? { areaId: about.area } : {}),
        ...(about?.metrics.length
          ? { scope: { metrics: about.metrics, dimensionValues: [] } }
          : {}),
        ...(today ? { validity: { start: today, end: null } } : {}),
      },
      sources: {
        title: 'your_text',
        summary: 'your_text',
        ...(words.body ? { body: 'your_text' } : {}),
        ...(about ? { areaId: 'your_text' } : {}),
        ...(about?.metrics.length ? { scope: 'your_text' } : {}),
        ...(today ? { validity: 'suggested' } : {}),
      },
      ...(today ? { dates_uncertain: true } : {}),
    },
    ...(today
      ? {
          words: `You weren't sure of the date, so I drafted it from today, ${longDayWords(today)}, and marked the dates as uncertain for the owner. Change them if you find the day.`,
        }
      : {}),
  }
}

/** Whether the person's words quote their source themselves: a quotation of 20 or more characters. */
const quotesSource = (user: string) => /["“][^"”]{20,}["”]/.test(user)

function choose(
  message: string,
  system: string,
  earlier: readonly string[] = [],
  reply: string | null = null,
): Choice {
  const { words: user, scope: picked } = pickedScope(message)
  const context = turnContextOf(system)
  const attached = attachedOf(system)
  // "What do you mean?", "say it simpler", "shorter", "why?": about the last reply, so answered
  // from it, with no lookup. What the person attached or picked for the question is more than
  // that, and is read as a question.
  const followUp = followUpKind(user)
  if (followUp && !attached.length && !Object.keys(picked).length)
    return { text: followUpReply(followUp, reply, metaFactsOf(system)) }
  // "Last week" is the week the turn context names, unless the person picked dates.
  const scope =
    context.lastWeek && !picked.window && /\blast week\b/i.test(user)
      ? { ...picked, window: context.lastWeek }
      : picked
  // How Heed works, or how to do something in it: from Heed's help pages, with the page linked.
  // "How does this work?" and "how do I add something?" are asked in the pages' own words, as a
  // real model would search for them.
  const meta = metaKind(user)
  if (meta === 'how' || meta === 'add' || (!meta && helpQuestion(user)))
    return {
      tool: 'search_help',
      input: {
        query:
          meta === 'how'
            ? `What is ${productName}?`
            : meta === 'add'
              ? 'Add a piece of context'
              : [...user].slice(0, 300).join(''),
      },
      ...(meta ? { otherwise: metaReply(meta, metaFactsOf(system)) } : {}),
    }
  // A greeting, thanks or "what can you do": answered at once, with no tool and no scope question.
  if (meta) return { text: metaReply(meta, metaFactsOf(system)) }
  const item = itemId.exec(user)?.[0]
  const numbered = draftNumber.exec(user)?.[1]
  const proposal = proposalId.exec(user)?.[0] ?? (numbered ? Number(numbered) : undefined)
  if (proposal && /\bcheck/i.test(user))
    return { tool: 'check_draft', input: { draft_number: proposal } }
  if (proposal && /\boverlap|duplicate|conflict/i.test(user))
    return { tool: 'find_overlaps', input: { draft_number: proposal } }
  if (proposal && /\bimpact|cost|preview/i.test(user))
    return { tool: 'estimate_impact', input: { draft_number: proposal, question: user } }
  if (/\bwhat(?:'s| has| is)? (?:changed|new)\b/i.test(user)) {
    const about = domainOf(user, context.domains)
    return { tool: 'what_changed', input: about ? { domain: about.area } : {} }
  }
  // A link to draft from: read it first, as a real model would, and never ask for a quote.
  const link = webLink.exec(user)?.[0]?.replace(/[.,;:!?]+$/, '')
  if (link && asksDraft.test(user) && !quotesSource(user)) {
    // The words around the link say what to look for on the page.
    const words = user.replace(new RegExp(webLink.source, 'gi'), ' ').replace(/\s+/g, ' ').trim()
    return {
      tool: 'read_source',
      input: { url: link, ...(words ? { look_for: [...words].slice(0, 200).join('') } : {}) },
    }
  }
  // Unsure of the date: drafted anyway, from what they said now or, for "draft it anyway", before.
  if (!link && unsureDate.test(user)) {
    const facts = asksDraft.test(user) && !earlier.length ? user : earlier.at(-1)
    if (facts) return draftFromText(facts, system, true)
  }
  // Something seen without a link: search for it, when search is offered. Without search, say
  // so as the turn context does: who switches it on, and that a pasted link works now.
  if (!link && (sawIt.test(user) || lookUp.test(user)) && asksDraft.test(user))
    return {
      tool: 'search_web',
      input: {
        query: pasted(user)
          .replace(/[%$€£]/g, '')
          .slice(0, 200),
      },
      otherwise: searchOffReply(context.searchOff),
    }
  if (/\b(draft|propose|write (it|this) up|turn this)\b/i.test(user))
    return draftFromText(user, system)
  if (item && /\b(apply|applies|why)\b/i.test(user))
    return { tool: 'explain_item', input: { id: item, question: user, ...scope } }
  if (item) return { tool: 'read_item', input: { id: item } }
  // "What is this?" about what the person attached: the block says, no tool is needed.
  if (attached.length && asksWhatItIs(user)) return { text: aboutAttached(attached) }
  if (/\b(improve|clearer|rephrase|coach)\b/i.test(user))
    return { tool: 'improve_question', input: { question: user, ...scope } }
  if (
    /\b(cover|covers|look at first|needs? a look|overview)\b/i.test(user) ||
    // "show me X metrics", or a correction that names the domain again ("I meant X").
    (/\b(metrics?|dimensions?|show|meant|ment|said)\b/i.test(user) &&
      domainOf(user, context.domains))
  ) {
    const about = domainOf(user, context.domains)
    return { tool: 'domain_overview', input: about ? { domain: about.area } : {} }
  }
  if (/\b(search|find|list|what is|what are|defined|definition|mean)\b/i.test(user))
    return { tool: 'find_facts', input: { query: pasted(user) } }
  return { tool: 'get_facts', input: { question: user, ...scope } }
}

type Item = {
  id?: string
  title?: string
  summary?: string
  validity?: { start?: string; end?: string | null }
}
/** A fact as a reply names it: its title, then its citation, which the app draws as a link. */
const cite = (item: Item) => `${item.title ?? 'A fact'} [${item.id}]`
/** A fact said in full: its summary, after its title only when the summary does not repeat it. */
const factLine = (item: Item) => {
  const title = (item.title ?? '').replace(/[.?!]$/, '')
  const summary = item.summary ?? ''
  const said = !title || summary.startsWith(title) ? summary : `${title}: ${summary}`
  return `${said || 'A fact'} [${item.id}]`
}
/** The most facts a reply lists: a real model picks what matters, and so does this one. */
const FACTS_SHOWN = 5

/**
 * The metrics and the values a get_facts reply read, as words: its keys without their kind
 * ("metric:average_order_value" is "average order value", "val:market/united_kingdom" is "United
 * Kingdom"), for the sentence that says what the facts cannot show.
 */
function subjectOf(output: Output): [string[], string[]] {
  const used = (output.scope_used ?? {}) as {
    metrics?: string[]
    filters?: Record<string, string[]>
  }
  const nice = (key: string) =>
    key
      .slice(key.lastIndexOf(':') + 1)
      .split('/')
      .pop()!
      .replace(/_/g, ' ')
  const title = (words: string) => words.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
  return [
    (used.metrics ?? []).map(nice),
    Object.values(used.filters ?? {})
      .flat()
      .map((key) => title(nice(key))),
  ]
}

/** The sentence for the day a question without dates was read at: the demo's date, or today. */
function assumedWords(assumed: unknown, system: string): string {
  const { date, sentence } = (assumed ?? {}) as { date?: string; sentence?: string }
  if (date && /The clock here is fixed for the demo/.test(system))
    return `I used the demo's date, ${longDayWords(date)}, because you gave no dates. Tell me if you meant a different period.`
  return sentence ?? ''
}

/** Which of the metric, the market and the dates a get_facts reply says the question lacks. */
function missingScope(output: Output): string {
  const fields = ((output.options as { field?: string }[] | undefined) ?? []).map((o) => o.field)
  const missing = [
    ...(fields.includes('scope') ? ['metric', 'market'] : []),
    ...(fields.includes('dates') ? ['dates'] : []),
  ]
  const named = missing.length ? missing : ['metric', 'market', 'dates']
  return named.length < 2 ? named[0]! : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
}

/**
 * Why a draft was not saved, in the person's words: Heed's reason is written for the model (its
 * field names, "the person"), so the mock asks what a real model would, never pasting it.
 */
export function draftRefused(error: string): string {
  const reason = error
    .replace(/\s*Nothing was saved, and the person was not asked to confirm\./, '')
    .trim()
  const domain = /^Say which domain it is about, as areaId: (.+)\.$/.exec(reason)
  if (domain)
    return `I couldn't draft it yet, so nothing is saved. Which domain is it about: ${domain[1]}?`
  // A name Heed cannot match reads plainly already; anything else is not repeated.
  if (/^(There is no single term called|No domain is called) /.test(reason))
    return `I couldn't draft it yet, so nothing is saved. ${reason} Which should I use?`
  return "I couldn't draft it yet, so nothing is saved. Tell me the domain and what happened, and I'll try again."
}

function explain(result: ToolResult, attached: string[], user: string, system: string): string {
  const output = result.output ?? {}
  if (result.denied) return "Okay, I didn't save it. Tell me what to change, and I'll try again."
  // A draft Heed could not match yet: the person is asked, as a real model would.
  if (typeof output.error === 'string' && result.toolName === 'create_draft')
    return draftRefused(output.error)
  // A page it could not read: the draft goes on from the person's own words.
  if (typeof output.error === 'string' && result.toolName === 'read_source')
    return "I couldn't read that page, so I used what you wrote."
  if (typeof output.error === 'string') return `That didn't work: ${output.error}`
  // A name Heed does not know comes back with the closest one: the person is asked.
  if (output.status === 'need_more_detail' && typeof output.message === 'string')
    return output.message
  switch (result.toolName) {
    case 'get_facts': {
      if (output.status === 'need_more_detail')
        // With something attached, the person is told about it and what would narrow it, never
        // asked which metric, market and dates they mean. Without, only a data question is asked
        // for what it lacks; words it cannot place get the demo model's plain answer.
        return attached.length
          ? `${aboutAttached(attached)}\nFacts apply to a metric and dates as well: name them to see which facts apply.`
          : looksLikeDataQuestion(pickedScope(user).words)
            ? `Which ${missingScope(output)} do you mean?`
            : demoFallback(metaFactsOf(system))
      const items = (output.items as Item[] | undefined) ?? []
      // Read at today because nothing gave dates: what is attached comes first, as above.
      const about = attached.length && output.assumed_date ? [aboutAttached(attached)] : []
      // A question about a change or its cause: the facts are notes, never the numbers, so the
      // answer says first what they cannot show.
      const question = pickedScope(user).words
      const lead = asksAboutChange(question)
        ? [changeLead(question, changeSubject(...subjectOf(output)))]
        : []
      // The day it was read at when no dates were given, as the turn context says it is called.
      const assumed = output.assumed_date ? [assumedWords(output.assumed_date, system)] : []
      // The check's own statements are written for AI agents; a reply says what they mean.
      if (!items.length)
        return [
          ...about,
          ...lead,
          'Nothing is written down for that. Nobody has added a fact about it yet. If you know of something, I can help you write it down.',
          ...assumed,
        ].join('\n')
      const shown = items.slice(0, FACTS_SHOWN)
      return [
        ...about,
        ...lead,
        items.length === 1
          ? 'One fact may be related:'
          : `${items.length} facts apply.${items.length > shown.length ? ` These ${shown.length} come first:` : ''}`,
        ...shown.map((item) => `- ${factLine(item)}`),
        ...assumed,
      ].join('\n')
    }
    case 'read_item': {
      const item = (output.item as Item | undefined) ?? null
      if (!item) return "I couldn't find that fact."
      const start = item.validity?.start
      const end = item.validity?.end ? ` to ${longDayWords(item.validity.end)}` : ''
      return `${factLine(item)}\n\nIt applies ${start ? `from ${longDayWords(start)}` : 'from its start date'}${end}.`
    }
    case 'explain_item':
      if (output.status === 'not_found')
        return "I couldn't find that fact in what AI agents get today."
      return `${output.applies ? 'It applies here' : "It doesn't apply here"} [${String(output.id)}]. ${String(output.reason)}`
    case 'find_facts': {
      const items = (output.items as Item[] | undefined) ?? []
      // A definition with where it comes from and what Heed adds, counts and all, as a model says it.
      const definitions = (
        (output.definitions as
          | {
              term?: string
              definition?: string | null
              origin_words?: string
              heed_adds?: string
            }[]
          | undefined) ?? []
      ).map((d) => {
        // Where it comes from, by the tool's own name ("Cube defines it ..."), never its key.
        const origin = /^(\S+) defines it\b/.exec(d.origin_words ?? '')?.[1]
        const from = origin ? ` It comes from ${origin}.` : ''
        const defined = d.definition
          ? `${origin ?? 'Its source'} defines ${d.term ?? 'it'} as "${d.definition}"`
          : `${d.term ?? 'It'} has no definition in its source yet.${from}`
        // How many facts are about it, as the catalogue counts them, and how many AI agents get.
        const shelf = /holds ([\d,]+) (?:items?|facts?) about /.exec(d.heed_adds ?? '')?.[1]
        const counts = shelf ? ` ${factsAbout(shelf, d.heed_adds ?? '', d.term ?? 'it')}` : ''
        return `${defined}${counts}`
      })
      // What About our business says of the words, as background and never as an item.
      const background = backgroundOf(user, system)
      const aside = background.length
        ? [
            "Some background about our business, which isn't a fact or a source:",
            ...background.map((line) => `- ${line}`),
          ]
        : []
      if (!items.length)
        return [
          [
            "I couldn't find anything about that.",
            ...((output.why as string[] | undefined) ?? []),
            ...((output.try as string[] | undefined) ?? []).slice(0, 1),
          ].join(' '),
          ...aside,
        ].join('\n')
      return [
        ...definitions,
        'I found these facts:',
        ...items.map((item) => `- ${cite(item)}`),
        ...aside,
      ].join('\n')
    }
    case 'domain_overview': {
      const domain = output.domain as { name?: string; about?: string } | undefined
      if (!domain)
        return `There are ${((output.domains as unknown[] | undefined) ?? []).length} domains.`
      // The domain Heed read the words as, once, when they were not its name.
      const readAs = (output.domain_read_as as { domain?: string } | undefined)?.domain
        ? [`I read that as ${String(domain.name)}.`]
        : []
      // A domain that holds nothing yet, in two sentences: what it has, what is missing and the
      // one next step.
      const items = (output.coverage as { items?: number } | undefined)?.items ?? 0
      const count = (output.vocabulary as { count?: { metrics: number; dimensions: number } })
        ?.count
      if (!items && count && !count.metrics && !count.dimensions)
        return [
          ...readAs,
          `${String(domain.name)} has no facts or names of its own yet.`,
          ...waitingWords(String(domain.name), output.waiting_in_source),
        ].join(' ')
      const looks = (output.needs_a_look as { items?: Item[] } | undefined)?.items ?? []
      return [
        ...readAs,
        domain.about ?? '',
        ...(looks.length
          ? ['These facts need checking:', ...looks.map((item) => `- ${cite(item)}`)]
          : ['Nothing needs checking.']),
      ].join('\n')
    }
    case 'what_changed':
      return Array.isArray(output.changes)
        ? changedWords(output.changes as { change?: string; id?: string; title?: string }[])
        : typeof output.message === 'string'
          ? output.message
          : "I couldn't compare what AI agents got then and now."
    case 'improve_question':
      return ((output.suggestions as string[] | undefined) ?? []).join(' ')
    case 'check_draft':
      return `The checks say: ${String(output.summary)}`
    case 'find_overlaps': {
      const accepted = (output.accepted as Item[] | undefined) ?? []
      return accepted.length
        ? ['These facts overlap it:', ...accepted.map((item) => `- ${cite(item)}`)].join('\n')
        : 'No fact overlaps this draft.'
    }
    case 'estimate_impact':
      return String(output.summary)
    case 'create_draft':
      return [
        `I saved it as a draft for you, "${String(output.title)}". Check each part, then send it for review.`,
        ...(output.external
          ? [
              'It comes from a web page I read, so the owner of its domain checks it before AI agents get it.',
            ]
          : []),
        ...(typeof output.warning === 'string'
          ? ["I couldn't find the quoted sentence on the page, so check it against the page."]
          : []),
      ].join(' ')
    case 'read_source':
      return `I read ${String(output.title || output.url)} (${String(output.url)}) on ${typeof output.read_on === 'string' ? longDayWords(output.read_on) : 'the day it was read'}.`
    case 'search_web': {
      const found =
        (output.results as { url?: string; title?: string; official?: boolean }[] | undefined) ?? []
      return found.length
        ? [
            'I found these pages, official sources first:',
            ...found.map(
              (r) => `- ${r.title ?? r.url}: ${r.url}${r.official ? ' (official)' : ''}`,
            ),
          ].join('\n')
        : 'I found no pages about that.'
    }
    case 'search_help': {
      // The page's own words, then the page to read: the same answer as the Docs area.
      const [first] = (Array.isArray(output.results) ? output.results : []) as {
        page?: string
        text?: string
        url?: string
      }[]
      if (!first?.text || !first.url)
        return "The help pages don't cover that yet. You can look through them in [Docs](/docs)."
      // The first paragraph, with the list it leads into when it ends on a colon.
      const [lead = '', next = ''] = first.text.split(/\n\s*\n/)
      const opening = (lead.trimEnd().endsWith(':') ? `${lead}\n\n${next}` : lead).trim()
      return `${opening}\n\nRead more in [${first.page ?? 'the help page'}](${first.url}).`
    }
    case 'read_gap':
      return `The gap is ${String(output.status)}.`
    default:
      return 'Done.'
  }
}

/** Names as a sentence lists them: "A, B and C". */
const list = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * What a domain's source has that has no name here yet, from the tool's counts: the tool, how
 * many, a few of them, and who adds them. The tool's own sentence is written for the model.
 */
function waitingWords(domain: string, waiting: unknown): string[] {
  const w = waiting as
    { metrics?: number; dimensions?: number; examples?: string[]; words?: string } | undefined
  if (!w?.words) return []
  const tool = /^(\S+) has\b/.exec(w.words)?.[1] ?? 'Its source'
  const admin = /administrator is ([^.]+)\.$/.exec(w.words)?.[1]
  const counts = [
    ...(w.metrics ? [`${w.metrics} ${w.metrics === 1 ? 'metric' : 'metrics'}`] : []),
    ...(w.dimensions
      ? [`${w.dimensions} ${w.dimensions === 1 ? 'way' : 'ways'} to split them`]
      : []),
  ].join(' and ')
  const examples = w.examples?.length ? `, such as ${list(w.examples)}` : ''
  return [
    `${tool} has ${counts || 'names'} for ${domain} that I don't know by name yet${examples}.`,
    `An admin adds them in Administration › Sources${admin ? `, and your admin is ${admin}` : ''}.`,
  ]
}

/** What changed, in a sentence and the facts themselves, newest first as the tool gives them. */
function changedWords(changes: { change?: string; id?: string; title?: string }[]): string {
  if (!changes.length) return 'Nothing changed in what AI agents get.'
  const verbs: Record<string, string> = { added: 'Added', changed: 'Changed', retired: 'Archived' }
  const shown = changes.slice(0, FACTS_SHOWN)
  return [
    `${changes.length === 1 ? 'One fact' : `${changes.length} facts`} changed in what AI agents get:`,
    ...shown.map(
      (c) => `- ${verbs[c.change ?? ''] ?? 'Changed'}: ${c.title ?? 'a fact'} [${c.id}]`,
    ),
  ].join('\n')
}

/** The sentence of a page's passages that shares most words with the person's message. */
function sentenceFor(passages: string[], user: string): string {
  const words = new Set(user.toLowerCase().match(/\p{L}{4,}/gu) ?? [])
  const sentences = passages
    .flatMap((passage) => passage.split(/(?<=[.!?])\s+/))
    .filter((sentence) => sentence.length >= 20)
  const score = (sentence: string) =>
    (sentence.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((word) => words.has(word)).length
  const best = [...sentences].sort((a, b) => score(b) - score(a))[0] ?? passages[0] ?? ''
  return [...best].slice(0, 400).join('')
}

/**
 * A draft from a page read_source read: its title, one of its sentences as the evidence with the
 * link and the day Heed read it, and the domain the person's words name.
 */
function draftFromPage(page: Output, user: string, system: string): Choice {
  const passages = ((page.passages as unknown[] | undefined) ?? []).filter(
    (entry): entry is string => typeof entry === 'string',
  )
  const quote = sentenceFor(passages, user)
  const about = domainOf(user, turnContextOf(system).domains)
  const title = [...((typeof page.title === 'string' && page.title) || quote || 'From the page')]
    .slice(0, 120)
    .join('')
  return {
    tool: 'create_draft',
    input: {
      draft: {
        kind: /\b(law|regulation|ban|measure|lei|medida|decreto)\b/i.test(`${user} ${title}`)
          ? 'event'
          : 'note',
        title,
        summary: [...quote].slice(0, 280).join(''),
        evidence: [{ url: String(page.url), quote, date: String(page.read_on) }],
        ...(about ? { areaId: about.area } : {}),
        ...(about?.metrics.length
          ? { scope: { metrics: about.metrics, dimensionValues: [] } }
          : {}),
      },
      sources: {
        kind: 'suggested',
        title: 'suggested',
        summary: 'suggested',
        evidence: 'suggested',
        ...(about ? { areaId: 'your_text' } : {}),
        ...(about?.metrics.length ? { scope: 'your_text' } : {}),
      },
    },
  }
}

function assist(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
  const prompt = options.prompt
  const { user, earlier, reply, results, system } = turn(prompt)
  // A page read for a draft, and no draft proposed yet: the draft comes next, from the page, or
  // from the person's own words when the page could not be read.
  const read = results.find((r) => r.toolName === 'read_source')
  if (read && asksDraft.test(user) && !results.some((r) => r.toolName === 'create_draft')) {
    const chosen = Array.isArray(read.output?.passages)
      ? draftFromPage(read.output, user, system)
      : draftFromText(user, system)
    if ('tool' in chosen && options.tools?.some((t) => t.name === chosen.tool))
      return Promise.resolve(
        result(
          [
            {
              type: 'tool-call',
              toolCallId: `call_${chosen.tool}_${randomUUID().slice(0, 8)}`,
              toolName: chosen.tool,
              input: JSON.stringify(chosen.input),
            },
          ],
          prompt,
          'tool-calls',
        ),
      )
  }
  if (results.length) {
    const attached = attachedOf(system)
    const text = results.map((r) => explain(r, attached, user, system)).join('\n\n')
    return Promise.resolve(result([{ type: 'text', text }], prompt, 'stop'))
  }
  const chosen = choose(user, system, earlier, reply)
  if ('text' in chosen)
    return Promise.resolve(result([{ type: 'text', text: chosen.text }], prompt, 'stop'))
  const { tool, input, words } = chosen
  if (!options.tools?.some((t) => t.name === tool))
    return Promise.resolve(
      result(
        [{ type: 'text', text: chosen.otherwise ?? "I can't reach what I need for that here." }],
        prompt,
        'stop',
      ),
    )
  return Promise.resolve(
    result(
      [
        ...(words ? [{ type: 'text' as const, text: words }] : []),
        {
          type: 'tool-call',
          // Unique per call, like a real model's: a confirmed draft is saved once per call id.
          toolCallId: `call_${tool}_${randomUUID().slice(0, 8)}`,
          toolName: tool,
          input: JSON.stringify(input),
        },
      ],
      prompt,
      'tool-calls',
    ),
  )
}

export const scriptedAssistantModel = () =>
  new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'scripted-assistant',
    doGenerate: assist,
    doStream: async (options) => streamResult(await assist(options)),
  })
