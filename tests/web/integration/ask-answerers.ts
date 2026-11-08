import { chatTurnOf, type Answer, type AskInput } from '@/model/ask'
import { asksAgain } from '@domain/ask-again'
import { fitChat } from '@domain/ask-chat'
import { recordsText } from '../../../src/server/modules/answer/plan-cases.ts'
import { JUDGE_MARK } from '../ask-eval/run.ts'
import type { Answerer, CaseRun, Reply } from '../ask-eval/types.ts'
import type { Verdicts } from '../ask-eval/judge.ts'

/*
  The answerers the evaluation harness can run. Today's main asks the service the way the Ask page
  does: each message with the chat's answered turns before it, within the caps, and "try again"
  as the last question asked again (src/web/pages/ask.tsx). A model in a tool loop will be another
  answerer here, graded the same way.
*/

/** The lines code wrote for an answer: how it read the question, its tables, definitions and footer. */
function recordedLines(a: Answer): string[] {
  return [
    // What the look-up found, as the answer's "Looked up" line says it.
    a.state !== null && !a.records
      ? `Context items found for this question: ${a.sources.length}.`
      : null,
    a.alias ? `"${a.alias.asked}" is read as ${a.alias.is}.` : null,
    a.dates,
    a.reading?.words,
    a.limit?.sentence,
    ...(a.records ? recordsText(a.records) : []),
    ...(a.definitions ?? []).flatMap((d) => [d.name, d.words ?? '']),
    ...Object.values(a.cited ?? {}).flatMap((c) => [c.quote, c.dontConclude]),
    ...(a.reading?.facts ?? []),
    a.footer?.denominator,
    a.footer?.notSeen,
    a.footer?.stale,
  ].filter((l): l is string => !!l)
}

/** An answer of today's main as the person reads it. */
export function replyOfAnswer(a: Answer): Reply {
  const lines = [
    a.limit?.sentence,
    ...(a.records ? recordsText(a.records) : [a.text]),
    ...(a.definitions ?? []).flatMap((d) => [d.name, d.words ?? '']),
    ...(a.reading?.facts ?? []),
    a.reading?.left ? `Not answered here: ${a.reading.left}` : null,
    a.footer?.denominator,
    a.footer?.notSeen,
    a.footer?.stale,
  ].filter((l): l is string => !!l)
  return {
    text: lines.join('\n'),
    state: a.state,
    sources: a.sources,
    evidence: recordedLines(a),
    // A records answer and a fixed reply are code's; the words of a look-up, or a question back, a model's.
    modelWords: !a.records && (a.reply === 'clarify' || (!a.reply && a.state !== null)),
  }
}

/** The words a turn asked: the ones it repeated, when it was asked again in words. */
const askedWords = ({ again, question, parts, scope }: Answer) =>
  again ?? { question, parts, scope }

/** Today's main: the router, the planner and the words, through the person's own binding. */
export const mainAnswerer: Answerer = {
  name: "today's main",
  open(reader) {
    const answered: Answer[] = []
    const chatOf = (turns: readonly Answer[]) =>
      fitChat(
        turns.flatMap((a) => {
          const turn = chatTurnOf(a)
          return turn ? [turn] : []
        }),
      )
    return {
      async send(message) {
        const last = answered.findLastIndex((a) => a.reply !== 'nothing_asked')
        let input: AskInput
        if (asksAgain(message) && last >= 0) {
          const before = answered[last]!
          const chat = chatOf(answered.slice(0, last))
          input = {
            ...askedWords(before),
            ...(chat.length ? { turns: chat } : {}),
            ...(before.state === 'failed' ? { reread: { dates: before.dates } } : {}),
          }
        } else {
          const chat = chatOf(answered)
          input = { question: message, ...(chat.length ? { turns: chat } : {}) }
        }
        const a = await reader.api.ask(input)
        answered.push(a)
        return replyOfAnswer(a)
      },
    }
  },
}

/**
 * The replies of a recorded run, given again: what lets a run be graded afresh, with changed
 * graders, at no model's cost. A chat gets the replies the run's chat of the same reader and the
 * same messages got, in the order the run asked them, and the judge's findings come back with them.
 */
export function replayed(
  runs: readonly CaseRun[],
  askerOf: (id: string) => string,
): {
  answerer: Answerer
  judged: (reply: string) => Verdicts
} {
  const queues = new Map<string, Reply[]>()
  const verdicts = new Map<string, Verdicts>()
  for (const run of runs) {
    const said: string[] = []
    for (const t of run.turns) {
      said.push(t.ask)
      const key = [askerOf(run.id), ...said].join('\n')
      queues.set(key, [...(queues.get(key) ?? []), t.reply])
      const found = (rule: keyof Verdicts) =>
        (t.grade.breaches[rule] ?? [])
          .filter((b) => b.startsWith(JUDGE_MARK))
          .map((b) => b.slice(JUDGE_MARK.length, -1))
      verdicts.set(t.reply.text, {
        advice: found('advice'),
        verdict: found('verdict'),
        unsupported: found('unsupported'),
      })
    }
  }
  return {
    answerer: {
      name: "today's main, as recorded",
      open: (reader) => {
        const said: string[] = []
        return {
          send: (message) => {
            said.push(message)
            const key = [reader.name, ...said].join('\n')
            const reply = queues.get(key)?.shift()
            return reply
              ? Promise.resolve(reply)
              : Promise.reject(new Error('Not in the recorded run.'))
          },
        }
      },
    },
    judged: (reply) => verdicts.get(reply) ?? { advice: [], verdict: [], unsupported: [] },
  }
}
