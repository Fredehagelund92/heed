import type { ChatTurn } from './ask-chat.ts'
import { normalizeName } from './vocabulary.ts'

/*
  What is settled about a message before any model is called (FR-719): one that only asks to repeat
  the last question, which the browser asks again as Ask again does, and one with no subject of its
  own, which gets one plain sentence and no search. Pure, so the browser, the service and the mock
  read a message alike.
*/

/** A message's words, as they are matched here: lower case, no marks, no courtesies around them. */
function bareWords(message: string) {
  const words = normalizeName(message)
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return words
    .replace(/^(?:(?:please|pls|ok|okay|hey|hi|sorry|just|can you|could you|would you|lets) )+/, '')
    .replace(/(?: (?:please|pls|thanks|thank you|now))+$/, '')
}

/** A message that only asks for the last question again. English is the language Ask reads. */
const ONLY_AGAIN =
  /^(?:(?:try|ask|run|do|go|check|look|search)(?: (?:it|that|this|the question))? (?:again|once more|one more time)|again|retry|re try|rerun|re run|reask|re ask|redo|re do|repeat(?: (?:it|that|the question))?|once more|one more time|(?:the )?same (?:question|again|thing)(?: again)?|(?:another|one more) (?:try|go|attempt))$/

/** Words that say nothing to look up, however many of them a message has. */
const SAYS_NOTHING = new Set(
  'ok okay k yes yeah yep yup no nope nah sure fine cool great good nice thanks thank you thx ty hmm hm huh uh um ah oh what hello hi hey please pls sorry wow lol'.split(
    ' ',
  ),
)

/** A message whose only subject is the chat's last turn: with no chat, it has none. */
const LEANS_ON_CHAT =
  /^(?:why|why not|how come|how so|and|and then|then|so|so what|more|more details|details|tell me more|go on|continue|keep going|explain|explain that|what about it|what about that|what else|anything else)$/

/** Whether a message only asks for the last question again ("try again", "same question"). */
export const asksAgain = (message: string) => ONLY_AGAIN.test(bareWords(message))

/**
 * Whether a message asks nothing Ask could read: it has no subject of its own and no question in
 * the chat fits it. A word after a question back is its answer, so that goes on to the planner.
 * A message that asks again gets here only with no question to repeat: the browser repeats one.
 */
export function asksNothing(message: string, turns: readonly ChatTurn[]): boolean {
  const words = bareWords(message)
  if (!words || ONLY_AGAIN.test(words)) return true
  if (turns.at(-1)?.asked) return false
  if (words.split(' ').every((word) => SAYS_NOTHING.has(word))) return true
  return !turns.length && LEANS_ON_CHAT.test(words)
}

/** The one sentence a message that asks nothing gets, with no search and nothing to press. */
export function nothingAskedSaid(message: string, turns: readonly ChatTurn[]): string {
  if (turns.length) return 'What should Ask look at, or which question should it repeat?'
  return asksAgain(message)
    ? 'There is no earlier question to repeat, so what should Ask look at?'
    : 'What should Ask look at?'
}
