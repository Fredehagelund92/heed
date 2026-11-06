import { normalizeName } from './vocabulary.ts'

/*
  Whether a question is plainly a read (FR-719, FR-720). The fixed rules answer a question only when
  it plainly asks what something is, what is written about it or why it moved: Ask's reads answer
  those, and nothing else. Any other question goes to the planner, so a limit or a cannot sentence
  can apply, even when it names a metric the rules could look up. This is the class, not a list of
  phrases: a new way to ask something a rule cannot answer falls out of the shapes below and is
  read by the planner, and with no planner it is said to be only partly read.

  Pure, so the service, the mock binding and the cases read a question alike.
*/

/** A question's words as the shapes read them: lower case, letters, digits and single spaces. */
const wordsOf = (text: string) =>
  normalizeName(text)
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** What happens next: a question about the future is no read of what is written. */
const FORECAST =
  /\b(?:will|won t|going to|gonna|shall|might|expect(?:ed|ing)?|likely|predict(?:ion|ed)?|forecast|outlook|next (?:week|month|quarter|year))\b/
/** Asking Ask to do something: writing, changing or sending, never a read. */
const ACTS =
  /^(?:please )?(?:write|rewrite|redefine|draft|compose|fix|update|edit|delete|remove|merge|rename|publish|archive|retire|approve|reject|assign|send|remind|notify)\b|\b(?:can|could|would|will) you (?!(?:please )?(?:show|list|tell|give|find|name|say)\b)|\b(?:help me|i (?:want|need) you to)\b/
/** A verdict on something, which no read gives. "Should I know" only asks what is written. */
const JUDGES =
  /\bshould\b(?! (?:i |we |an? \w+ )?(?:know|rule out|check before|read|look at|be aware))|\bought to\b|\b(?:recommend|suggest|advise|advice|opinion|trust|rely on|relied on)\b|\b(?:safe|wise|risky|fair|worth(?:while)?|acceptable|normal|ok|okay|fine|good|bad|wrong|reliable|trustworthy)\b|\bright\b(?! now)/

/**
 * Whether the words ask for what no read gives: what happens next, something done, or a verdict.
 * A word that only ends up in a name is not read here: take the names out first.
 */
export const reachesBeyond = (words: string) => {
  const t = wordsOf(words)
  return FORECAST.test(t) || ACTS.test(t) || JUDGES.test(t)
}

/** Whether the words ask Ask to write or change something, or what happens next. */
export const asksToActOrForecast = (words: string) => {
  const t = wordsOf(words)
  return FORECAST.test(t) || ACTS.test(t)
}

/**
 * The shapes a rule reads plainly, with each name and date as `x`. What is X, what it means and how
 * it is worked out; what is written about it; why it moved; how two compare; and a plain question
 * of fact about what it counts.
 */
const PLAIN_SHAPES = [
  /^(?:the |our )?x$/,
  /^(?:what|what s|whats)(?: (?:is|are|was|were))?(?: the| our| a)?(?: (?:definition|meaning) of)? x$/,
  /^(?:what|how) (?:does|do|did) x (?:mean|stand for)$/,
  /^how (?:is|are|was|were) x (?:calculated|worked out|defined|measured|counted|computed)$/,
  /^define x$/,
  /^(?:what s|what is|whats) the difference between x$/,
  /^compare x$/,
  /^how does x compare (?:to|with) x$/,
  /^what (?:do we (?:actually )?know|is written|have we written|do we have|context do we have|is there|should (?:i|we) know|do (?:i|we) need to know) (?:about|on|for) x$/,
  /^(?:tell me|anything) (?:about|on) x$/,
  /^what should (?:i|we|an? \w+) (?:know|rule out|check|read)\b.* x$/,
  /^what (?:do you think )?(?:is|s) going on (?:with|in) x$/,
  /^how (?:are|is) x(?: doing)?$/,
  /^how many x (?:did|do|have) we (?:get|got|have)$/,
  /^(?:why|how come)\b/,
  /^what (?:explains|explained|caused|causes|drove|is behind|s behind|happened (?:to|with|in))\b/,
  /^(?:do|does|did) x (?:include|exclude|count|cover)\b/,
  /^is x\b.*\b(?:before|after|including|excluding)\b/,
]

/** Where the reader found a name or a date in the question. */
type Span = { start: number; end: number }

/** The question with each name and date as `x`, a name in a name being one. */
function shapeOf(question: string, spans: readonly Span[]): string {
  let text = question
  for (const at of [...spans].sort((a, b) => b.start - a.start))
    text = `${text.slice(0, at.start)} xxname ${text.slice(at.end)}`
  const said = wordsOf(text).replace(/\bxxname\b/g, 'x')
  // "Orders in Norway in August", "Norway orders" and "Norway and Sweden" are one thing asked about.
  let shape = said
  for (;;) {
    const next = shape.replace(/\bx (?:(?:in|for|and|or|on|during|at) (?:the )?)?x\b/g, 'x')
    if (next === shape) return shape
    shape = next
  }
}

/**
 * Whether a question is plainly a read: it has one of the shapes, and asks for nothing beyond one.
 * `spans` are the names and dates the engine's reader found in it.
 */
export function readsPlainly(question: string, spans: readonly Span[]): boolean {
  const shape = shapeOf(question, spans)
  return !reachesBeyond(shape) && PLAIN_SHAPES.some((plain) => plain.test(shape))
}
