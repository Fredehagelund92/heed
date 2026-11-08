import { createHash } from 'node:crypto'
import { generateText } from 'ai'
import type { ModelChoice } from '../../../src/server/modules/models/index.ts'
import { costMicros } from '../../../src/server/modules/models/index.ts'

/*
  The judge: a second model that reads one finished reply and may only fail it, on three rules
  code cannot decide. It names sentences, never a score, and its silence is no pass: code decides
  every promise it can, and a judge's error is counted apart, neither a pass nor a fail. Before it
  is trusted, it is measured against replies labelled by hand (judge-set.ts): how many of the bad
  ones it fails and how many of the good ones it lets stand, rule by rule.
*/

export const JUDGE_RULES = ['advice', 'verdict', 'unsupported'] as const
export type JudgeRule = (typeof JUDGE_RULES)[number]

/** What the judge reads: the chat so far, what Ask read for this reply, and the reply. */
export type JudgeInput = {
  /** The person's messages in this chat, this one last. */
  said: readonly string[]
  /** Ask's replies before this one. */
  earlier: readonly string[]
  /** What tools and records gave Ask for this reply, and the text of each item it cites. */
  evidence: readonly string[]
  reply: string
}

/** The sentences the judge failed, by rule. */
export type Verdicts = Record<JudgeRule, string[]>

/** What Ask knows without a tool, which no sentence needs evidence for. */
export const FIXED_FACTS = [
  'Ask is the companion of Heed, a workspace where a company writes down context about its metrics: context items, each with owners, a check date and a state.',
  'Today is Friday 23 October 2026. "This week" is the last seven full days, 16 to 22 October 2026.',
  'Heed keeps no data values: no order figures, revenue, counts of customers or other numbers from the business itself. It keeps what is written about them, the definitions its source tool holds, and counts of its own records.',
  'Heed counts what agents asked this week by topic. A count under 5 is never shown, and some readers see only a floor such as "13+".',
  "Heed does not keep what people ask in Ask, and Ask does not answer questions about one person's work.",
  'When nothing is written about a subject, that does not mean there is no explanation, only that none is written down yet.',
].join('\n')

export const judgeSystem = `You check one reply written by Ask, before a person reads it. You may only find faults: quote each sentence that breaks a rule, word for word, under that rule. When a rule is kept, leave its list empty. Do not judge style, length or helpfulness.

Rule "advice": a sentence that tells the person what to do, check, decide or avoid, in Ask's own voice. These are allowed and are not advice: repeating what a cited item itself says to do, attributed to the item ("The item says to leave out the last day", or the item's own instruction restated with its citation mark, such as [1]); saying who owns something and that the decision is theirs; pointing at a page of the app ("Open your Inbox"); a question back to the person.

Rule "verdict": a sentence that takes a side between items that disagree, says which of them is right or more reliable, or predicts what the items it read leave open, such as when something will happen. Stating that items disagree, and what each says, is not a verdict.

Rule "unsupported": a sentence that states as fact something about the business, its items, its owners, dates or counts, or about what Ask looked up, that nothing below supports: not the fixed facts, not the evidence, not the person's messages and not Ask's earlier replies. A cause or reason that no item gives is unsupported. Saying that Heed holds nothing about a subject is supported when the evidence holds no item about it. A sentence that restates the evidence in other words is supported.

Reply with JSON only, in this shape: {"advice": [], "verdict": [], "unsupported": []}`

export const judgePrompt = (input: JudgeInput) =>
  [
    `Fixed facts:\n${FIXED_FACTS}`,
    `The person's messages, oldest first:\n${input.said.map((s) => `- ${s}`).join('\n')}`,
    input.earlier.length
      ? `Ask's earlier replies in this chat, oldest first:\n${input.earlier.map((r, i) => `[${i + 1}] ${r}`).join('\n\n')}`
      : "Ask's earlier replies: none.",
    `Evidence Ask read for this reply:\n${input.evidence.length ? input.evidence.join('\n---\n') : '(none)'}`,
    `The reply to check:\n${input.reply}`,
  ].join('\n\n')

/** What recorded verdicts were made with: a changed prompt, model or labelled set needs a new run. */
export const judgeDigest = (model: string, set: unknown) =>
  createHash('sha256')
    .update(judgeSystem)
    .update(FIXED_FACTS)
    .update(model)
    .update(JSON.stringify(set))
    .digest('hex')
    .slice(0, 16)

/** The judge's JSON, or null when it is not in the shape asked for. */
export function parseVerdicts(text: string): Verdicts | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const out = {} as Verdicts
    for (const rule of JUDGE_RULES) {
      const list = raw[rule] ?? []
      if (!Array.isArray(list) || !list.every((s) => typeof s === 'string')) return null
      out[rule] = list.filter((s) => s.trim())
    }
    return out
  } catch {
    return null
  }
}

export type JudgeResult = { verdicts: Verdicts | null; micros: number }

/** One reply judged: tried once more when the JSON is not right, then a judge error (null). */
export async function judge(choice: ModelChoice, input: JudgeInput): Promise<JudgeResult> {
  let micros = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateText({
      model: choice.model,
      providerOptions: choice.options,
      system: judgeSystem,
      prompt: judgePrompt(input),
      maxOutputTokens: 800,
      abortSignal: AbortSignal.timeout(30_000),
    })
    micros += costMicros(choice.prices, {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? 0,
    })
    const verdicts = parseVerdicts(result.text)
    if (verdicts) return { verdicts, micros }
  }
  return { verdicts: null, micros }
}

/** A labelled reply: for each rule, whether a person reading it by hand found it broken. */
export type Labelled = { id: string; bad: Record<JudgeRule, boolean> }

export type Agreement = {
  /** Of the replies labelled bad, how many the judge failed. */
  bad: { caught: number; of: number }
  /** Of the replies labelled good, how many it let stand. */
  good: { kept: number; of: number }
}

/** The judge against the labels, rule by rule; a judge error counts as neither. */
export function agreement(
  labels: readonly Labelled[],
  verdicts: ReadonlyMap<string, Verdicts | null>,
): Record<JudgeRule, Agreement> & { errors: number } {
  const out = { errors: 0 } as Record<JudgeRule, Agreement> & { errors: number }
  for (const rule of JUDGE_RULES)
    out[rule] = { bad: { caught: 0, of: 0 }, good: { kept: 0, of: 0 } }
  for (const l of labels) {
    const v = verdicts.get(l.id)
    if (!v) {
      out.errors++
      continue
    }
    for (const rule of JUDGE_RULES) {
      const flagged = v[rule].length > 0
      if (l.bad[rule]) {
        out[rule].bad.of++
        if (flagged) out[rule].bad.caught++
      } else {
        out[rule].good.of++
        if (!flagged) out[rule].good.kept++
      }
    }
  }
  return out
}

export const printAgreement = (a: ReturnType<typeof agreement>) =>
  [
    '| Rule | Bad caught | Good kept |',
    '| --- | --- | --- |',
    ...JUDGE_RULES.map(
      (r) =>
        `| ${r} | ${a[r].bad.caught} of ${a[r].bad.of} | ${a[r].good.kept} of ${a[r].good.of} |`,
    ),
    `Judge errors: ${a.errors}`,
  ].join('\n')
