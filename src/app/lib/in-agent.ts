import type { AnswerState } from '@/model/ask'

// How the same answers read inside a person's own agent: a static transcript for the agent
// preview, each answer ending in the one line that names its state. Copy, not data.

/** The same states as an agent shows them: a static transcript in Claude. */
export const inAgent = [
  {
    state: 'grounded' as AnswerState,
    you: 'Why did orders drop in Norway in August?',
    agent: `Orders in Norway fell 31% from July (from your data tool). The team has 2 checked context items: online sales to Norway stopped on 4 August 2026, and price promotions there have been paused since 9 May. Neither says how much each moved orders.`,
    line: 'Context: based on 2 checked items (owners of Sales and Marketing, Sep and Oct 2026).',
  },
  {
    state: 'partial' as AnswerState,
    you: 'And Spain, last quarter?',
    agent:
      'The checked context covers part of this: there is context for Norway and nothing for Spain. I read “last quarter” as 1 July to 30 September 2026; tell me if you meant other dates.',
    line: 'Context: covers part of it (Norway only).',
  },
  {
    state: 'missing' as AnswerState,
    you: 'How did orders in Spain change in October?',
    agent:
      "Nothing is written down for Orders in Spain in October 2026. That doesn't rule out an explanation. Shall I tell the owner of Sales it's missing?",
    line: 'Context: nothing written down.',
  },
  {
    state: 'conflict' as AnswerState,
    you: 'Do Norway orders include gift-card money?',
    agent:
      "Two context items disagree. Jon Abara's says Norway orders count store credit and gift cards; Sofia Brandt's says they count card and cash payments only. I can't pick one for you.",
    line: 'Context: disagrees (2 items, owner of Sales).',
  },
  {
    state: 'stale' as AnswerState,
    you: 'Why did Norway returns drop at the end of April?',
    agent:
      "From 28 April 2026, Norway returns count only refunds that reached the customer's bank. This context item may be out of date: its check date passed on 2 October.",
    line: 'Context: may be out of date (1 item).',
  },
  {
    state: 'failed' as AnswerState,
    you: 'What changed in returns in the United Kingdom this week?',
    agent:
      "I couldn't check the context just now, so I can't say whether anything is written down. Ask me again in a minute.",
    line: "Context: couldn't check.",
  },
]

export const correctionInAgent = [
  { who: 'you', text: "The test account number you quoted is wrong, it's 340 now." },
  { who: 'agent', text: 'Shall I send that correction to the owner of Sales, with your words?' },
  { who: 'you', text: 'Yes.' },
  { who: 'agent', text: 'Sent. Agents get it once Jon Abara, the owner, publishes it.' },
]
