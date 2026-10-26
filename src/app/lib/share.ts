import { stateLabel, stateSentence, type Answer } from '@/data/ask'
import { TODAY } from '@/data/history'
import { WORKSPACE_NAME, type Fact } from '@/data/world'

// Copy for Slack, and the answer card: what an answer keeps when it leaves the product. Only what
// the answer already says: its state, its words, and each source with who checked it and when.
// There is no link: a link would show the context to whoever opens it, and that comes later.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "23 Oct 2026", from the demo world's today. */
export const answeredOn = (iso: string = TODAY) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** The state line as it travels: "Checked (2 items)", "Partial (1 item). Only part of this is written down." */
export function stateLineOf(answer: Pick<Answer, 'state'>, sources: number) {
  const items = sources ? ` (${sources} ${sources === 1 ? 'item' : 'items'})` : ''
  return answer.state === 'grounded'
    ? `${stateLabel.grounded}${items}`
    : `${stateLabel[answer.state]}${items}. ${stateSentence[answer.state]}`
}

/** The answer's own words, with its citation numbers kept so each sentence still points at its source. */
export const plainAnswer = (text: string) =>
  text
    .replace(/\s+(\[\d+\])/g, ' $1')
    .replace(/\s{2,}/g, ' ')
    .trim()

/** One source as it travels: "1 Online sales to Norway stopped on 4 August 2026 - Jon Abara, checked 3 Oct 2026". */
export const sourceLine = (f: Fact, i: number) =>
  `${i + 1} ${f.title} - ${f.checkedBy}, checked ${f.checkedOn}`

/** The Slack message: the question in bold, the state line second, the answer, then the sources. */
export function slackText(answer: Pick<Answer, 'question' | 'state' | 'text'>, facts: Fact[]) {
  return [
    `*${answer.question}*`,
    stateLineOf(answer, facts.length),
    '',
    plainAnswer(answer.text),
    ...(facts.length ? ['', ...facts.map(sourceLine)] : []),
  ].join('\n')
}

/** The card's footer: where it is from, and when it was answered. */
export const cardFooter = (iso?: string) => `${WORKSPACE_NAME} - answered ${answeredOn(iso)}`
