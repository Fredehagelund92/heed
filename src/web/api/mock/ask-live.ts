import type { Answer } from '@/model/ask'
import type { AskLive } from '@/model/ask-turn'

// How the mock's answers arrive in a live chat, so Ask on the mock reads as it does on the service
// with a real model: a look-up, what it found, the engine's answer with its state and sources, then
// the words a sentence at a time. The times are the mock's, named here so they can be tuned; the
// service's come from the real work.

/** Looking up, before the look-up has found its context items. */
export const MOCK_LOOK_MS = 400
/** Reading what it found, before the engine's answer. */
export const MOCK_READ_MS = 400
/** Each sentence of the words, as a model writes it. */
export const MOCK_SENTENCE_MS = 350

/** The states a model writes words for, as on the service: an answer with items. */
const written: readonly (Answer['state'] & string)[] = ['grounded', 'partial', 'conflict', 'stale']

/** An answer's words as sentences, each with the citations after its stop. */
const sentences = (text: string) =>
  text
    .trim()
    .split(/(?<=[.!?](?:\s*\[\d+\])*)\s+(?=[^\s[])/)
    .filter(Boolean)

/** The answer's way in: its events in time, stopped by `live.signal`; then the answer itself. */
export async function playAnswer(answer: Answer, live: AskLive): Promise<Answer> {
  const wait = (ms: number) =>
    new Promise<void>((done, fail) => {
      const stopped = () => fail(new DOMException('The answer was stopped.', 'AbortError'))
      if (live.signal?.aborted) return stopped()
      const timer = setTimeout(done, ms)
      live.signal?.addEventListener('abort', () => (clearTimeout(timer), stopped()), {
        once: true,
      })
    })
  const tell = live.onEvent ?? (() => undefined)
  await wait(MOCK_LOOK_MS)
  // A records answer is counted, not looked up: it comes whole.
  if (answer.records) return answer
  tell({ type: 'found', items: answer.sources.length })
  await wait(MOCK_READ_MS)
  // The engine's answer comes first; the words a model writes follow it.
  tell({ type: 'answer', answer })
  if (answer.state && written.includes(answer.state) && answer.sources.length)
    for (const text of sentences(answer.text)) {
      await wait(MOCK_SENTENCE_MS)
      tell({ type: 'sentence', text })
    }
  return answer
}
