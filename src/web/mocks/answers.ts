import { removedNotice } from '../../contract/assistant.ts'
import { productName } from '../lib/brand.ts'

/*
  Assistant answers as models write them, for the answer's stories and tests: every kind of
  Markdown an answer uses, and the ways a model gets it slightly wrong (a table straight after its
  sentence, lines after a table, a page's path as plain words). The first is a real answer, word
  for word. Names, numbers and ids are made up, except the one fact the stories read
  (`itm_wsd3duw0`, the mock's payment provider switch).
*/

export type AnswerFixture = { name: string; text: string }

/** The fact the fixtures cite, which the stories and tests give a read_item result for. */
export const FIXTURE_FACT = {
  id: 'itm_wsd3duw0',
  kind: 'event',
  title: 'Payment provider switched in the United Kingdom on 12 June 2026',
} as const

export const answerFixtures = {
  domains: {
    name: 'The five domains (a real answer)',
    text: [
      `${productName} has five domains, as of edition 2026-10-07.2.`,
      '| Domain | What it is | Facts | Owners | Needs checking | Open gaps |',
      '|---|---|---|---|---|---|',
      '| Sales | Orders, revenue and the basket | 323 | Jon Abara, Sofia Brandt | 26 | 4 |',
      '| Marketing | Acquisition and discounts | 342 | Tomas Eriksen | 31 | 1 |',
      '| Sandbox | The demo domain | 82 | Jon Abara | 9 | 0 |',
      '| Customer value | Customers over their lifetime | 290 | Noor Haddad (Alex Moreau) | 18 | 1 |',
      '| Paid media | Buying ads | 263 | Priya Nair | 12 | 1 |',
      'Marketing and Sales hold the most items, and Sandbox is invented examples to practise on.',
      'Marketing has the most items that need a look, at 31. You can open them in Needs a look (/library?view=attention).',
      "Do you want a closer look at one domain? If you don't say, I'll leave it here.",
    ].join('\n'),
  },
  prose: {
    name: 'Headings, bold and italic in prose',
    text: [
      '**Mostly, with one caveat.** Net revenue for the United Kingdom last week is comparable with earlier weeks, *except* for card orders.',
      '',
      '## What changed',
      '',
      `The payment provider switched on 12 June, so card orders before and after that day are counted differently [${FIXTURE_FACT.id}]. Bank transfers and e-wallets are _not_ affected.`,
      '',
      '### What to do',
      '',
      'Compare card orders only within the same side of 12 June, or use all payment methods together. ~~The weekly pack already says so.~~ The weekly pack does not say so yet.',
    ].join('\n'),
  },
  lists: {
    name: 'Ordered, unordered, nested and task lists',
    text: [
      'To write the caveat down, I need four things:',
      '1. What happened, in one or two plain sentences.',
      '2. Where it applies:',
      '   - the metrics, such as Orders and Net revenue',
      '   - the markets, such as the United Kingdom',
      '     - and a product, if only one is affected',
      '3. From when, and until when if it has ended.',
      '4. How you know: a link and a short quote.',
      '',
      'What you have given so far:',
      '- [x] What happened',
      '- [x] Where it applies',
      '- [ ] From when',
      '- [ ] How you know',
    ].join('\n'),
  },
  tables: {
    name: 'Tables: aligned, with links, code, pipes and a blank line before',
    text: [
      'Here are the three facts that apply, newest first:',
      '',
      '| Fact | Kind | From | Until | Markets |',
      '| :--- | :---: | ---: | ---: | --- |',
      `| Payment provider switched [${FIXTURE_FACT.id}] | Event | 12 Jun 2026 | open | United Kingdom |`,
      '| Discount rules changed (see [the notice](https://regulator.example/notices/2026-08)) | Note | 1 Aug 2026 | 31 Aug 2026 | United Kingdom, Poland |',
      '| Field `order_amount` counts fees (gross \\| net) | Guide | 1 Jan 2026 | open | All |',
      '',
      'Each one is in Needs checking until an owner checks it again.',
    ].join('\n'),
  },
  wide: {
    name: 'A wide table of numbers',
    text: [
      'Weekly test question pass rates by domain, last eight weeks:',
      '| Domain | W33 | W34 | W35 | W36 | W37 | W38 | W39 | W40 | Change |',
      '|---|---|---|---|---|---|---|---|---|---|',
      '| Sales | 91% | 92% | 92% | 93% | 90% | 94% | 95% | 95% | +4% |',
      '| Marketing | 84% | 85% | 83% | 86% | 88% | 87% | 89% | 90% | +6% |',
      '| Sandbox | 70% | 72% | 71% | 75% | 74% | 78% | 80% | 81% | +11% |',
      '| Customer value | 0% | 0% | 0% | 12% | 25% | 31% | 38% | 44% | +44% |',
      'Sandbox and Customer value improved the most. See Health (/health) for each run.',
    ].join('\n'),
  },
  code: {
    name: 'Code spans and a code block',
    text: [
      'An agent asks for `metric:net_revenue` with the market as a filter. What it sends:',
      '',
      '```json',
      '{ "metrics": ["metric:net_revenue"], "dimension_filters": { "market": ["val:market/united_kingdom"] }, "window": { "start": "2026-06-01", "end": "2026-07-01" } }',
      '```',
      '',
      'The window ends the day after the last day, so `end` is 1 July.',
    ].join('\n'),
  },
  links: {
    name: `Links, pages of ${productName} and paths`,
    text: [
      'You can see it three ways:',
      '- in [Try it](/try-it), with the same scope;',
      '- on the regulator’s page: https://regulator.example/notices/2026-08',
      '- or ask an owner: [owner@example.test](mailto:owner@example.test).',
      '',
      `Your own drafts are under Mine (/proposals?view=mine), and Connect your AI is at /settings?section=connect. A path ${productName} does not have, like /etc/passwd or //evil.example, stays text, and so does [a script](javascript:alert(1)).`,
    ].join('\n'),
  },
  quote: {
    name: 'A block quote',
    text: [
      'The fact says, word for word:',
      '',
      '> Card orders before 12 June were counted when authorised; from 12 June they are counted when settled.',
      '',
      'So an order authorised on 11 June and settled on 13 June is counted twice.',
    ].join('\n'),
  },
  breaks: {
    name: 'Line breaks and lines without a blank between them',
    text: [
      'Three things changed in edition 2026-10-07.2:',
      'The United Kingdom now has its own owner.  ',
      'Two facts about Poland were retired.\\',
      'One test question failed and passed again.',
      'That is everything.',
    ].join('\n'),
  },
  long: {
    name: 'Long words and emoji',
    text: [
      'The source table is analytics_prod.finance_reporting.daily_net_revenue_by_market_and_product_v2_snapshot, and its owner wrote 👍 on the change.',
      '',
      'Its documentation: https://wiki.example/display/FIN/Net+Revenue+Definitions+and+Reconciliation+Rules+for+2026+Reporting+Cycle',
      '',
      '| Table | Rows |',
      '|---|---|',
      '| analytics_prod.finance_reporting.daily_net_revenue_by_market_and_product_v2_snapshot | 1,204,331 |',
      '',
      '✅ Checked, ⚠️ one caveat, 🚫 no fact for Q1.',
    ].join('\n'),
  },
  unsafe: {
    name: 'Raw HTML and an image stay text',
    text: [
      'A pasted note had <b>bold</b> and <script>alert(1)</script> in it.',
      '',
      '<div onclick="alert(1)">a block of HTML</div>',
      '',
      '![a chart](https://example.com/chart.png)',
    ].join('\n'),
  },
  removed: {
    name: 'A table row the citation check removed',
    text: [
      'The facts about the United Kingdom in June:',
      '| Fact | Applies |',
      '|---|---|',
      `| [${FIXTURE_FACT.id}] | In part: only card orders |`,
      removedNotice.unknown_item,
      '| Discount rules changed | No: it is about Poland |',
      'One more fact is in Needs a look (/library?view=attention).',
    ].join('\n'),
  },
} satisfies Record<string, AnswerFixture>

export type AnswerFixtureName = keyof typeof answerFixtures
