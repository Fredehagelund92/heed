import { facts } from '@/api/mock/data/world'
import { itemText } from './graders.ts'
import type { JudgeInput, JudgeRule, Labelled } from './judge.ts'

/*
  The judge's labelled set: replies on the demo week, each read by hand and labelled on every rule
  the judge reads, so its agreement can be measured before a run trusts it. They come from the
  prototype and gates 2 and 3 (burned, in the words those reports quote), their repaired versions,
  and the edges of the strict advice rule: an item's own check relayed and attributed is fine; the
  same words in Ask's own voice are not. Nothing here is shown to the judge as an example.
*/

export type JudgeExample = Labelled & JudgeInput & { from: string }

const item = (id: string) => {
  const f = facts.find((x) => x.id === id)
  if (!f) throw new Error(`No item ${id} in the demo world`)
  return itemText(f)
}

const SALES_OWNERS = 'Owners of the Sales domain: Jon Abara and Sofia Brandt.'
const MARKETING_OWNER = 'Owner of the Marketing domain: Tomas Eriksen.'
const NORWAY_PAIR = [item('itm_gift_store_credit'), item('itm_gift_card_only')]
const FRANCE_PAIR = [item('itm_france_switch_12'), item('itm_france_switch_21')]
const MARKED = 'Marked by their owners as disagreeing, and not settled.'

const ok = { advice: false, verdict: false, unsupported: false }
const bad = (rule: JudgeRule) => ({ ...ok, [rule]: true })

export const judgeSet: JudgeExample[] = [
  // Advice: an instruction in Ask's own voice, against the same fact relayed from its item.
  {
    id: 'J01',
    from: 'prototype G20',
    said: ['comparing norway orders and returns year on year, what could trip me up?'],
    earlier: [],
    evidence: [...NORWAY_PAIR, item('itm_ra39ow6c'), SALES_OWNERS],
    reply:
      'Two notes disagree on Norway orders: one counts store credit and gift cards [1], the other only card and cash payments [2]. Norway returns changed definition on 28 April 2026, so earlier weeks read about 4 percent higher [3]. Check which rule your comparison assumes, because it changes the order total.',
    bad: bad('advice'),
  },
  {
    id: 'J02',
    from: 'prototype G20, repaired',
    said: ['comparing norway orders and returns year on year, what could trip me up?'],
    earlier: [],
    evidence: [...NORWAY_PAIR, item('itm_ra39ow6c'), SALES_OWNERS],
    reply:
      'Two notes disagree on Norway orders: one counts store credit and gift cards [1], the other only card and cash payments [2]. Norway returns changed definition on 28 April 2026, so earlier weeks read about 4 percent higher [3]. How to adjust the comparison is for you and the owners, Jon Abara and Sofia Brandt.',
    bad: ok,
  },
  {
    id: 'J03',
    from: 'prototype G05',
    said: ['is turnover the same as takings?'],
    earlier: [],
    evidence: [
      'Heed reads "turnover" and "takings" as Net revenue.',
      'Net revenue, as the source defines it: gross sales after returns, discounts, VAT and payment fees, in euros. The figure finance reports each month.',
      item('itm_spain_vat_in'),
      item('itm_spain_vat_out'),
      SALES_OWNERS,
    ],
    reply:
      "Yes: both are read as Net revenue, which is gross sales after returns, discounts, VAT and payment fees, in euros. Check with the metric owners, Jon Abara and Sofia Brandt, before comparing Spain's turnover or takings with other markets.",
    bad: bad('advice'),
  },
  {
    id: 'J04',
    from: 'harness: an item relayed',
    said: ['why do the last few days of germany orders always look low?'],
    earlier: [],
    evidence: [item('itm_0tmqp7o1')],
    reply:
      "Germany's payment files reach Cube the morning after, so yesterday's orders are always short [1]. The item says to leave out the last day when you compare Germany weeks [1].",
    bad: ok,
  },
  {
    id: 'J05',
    from: 'harness: the same in its own voice',
    said: ['why do the last few days of germany orders always look low?'],
    earlier: [],
    evidence: [item('itm_0tmqp7o1')],
    reply:
      "Germany's payment files reach Cube the morning after, so yesterday's orders are always short [1]. Leave out the last day whenever you compare weeks.",
    bad: bad('advice'),
  },
  {
    id: 'J06',
    from: 'gate 3 G30',
    said: ['one good week of gross margin in spain, worth flagging to the board or not?'],
    earlier: [],
    evidence: [item('itm_kcy22j54')],
    reply:
      'Heed has a guide on this: margin in Spain swings with clearance sales, so one good weekend is no trend [1]. You should not flag one good week to the board.',
    bad: bad('advice'),
  },
  {
    id: 'J07',
    from: 'gate 3 G30, repaired',
    said: ['one good week of gross margin in spain, worth flagging to the board or not?'],
    earlier: [],
    evidence: [item('itm_kcy22j54'), SALES_OWNERS],
    reply:
      'Whether to flag it is not written down. The guide on gross margin in Spain says to look at four weeks or more, never one weekend, because margin there swings with clearance sales [1]. It is due for a check: Cube changed the definition of Gross margin on 7 Oct. What goes to the board is for you and its owners, Jon Abara and Sofia Brandt.',
    bad: ok,
  },
  {
    id: 'J08',
    from: 'harness: a guide relayed',
    said: ["what's behind the monday jump in orders in france?"],
    earlier: [],
    evidence: [item('itm_2a1wp53q')],
    reply:
      'There is a guide for this: the provider sends weekend files together on Monday, and most jumps are those late files, not customers [1]. Before a jump is explained, the guide says to check the file dates [1].',
    bad: ok,
  },
  {
    id: 'J09',
    from: 'harness: the guide in its own voice',
    said: ["what's behind the monday jump in orders in france?"],
    earlier: [],
    evidence: [item('itm_2a1wp53q')],
    reply:
      "The provider sends weekend files together on Monday, and most jumps are those late files, not customers [1]. I'd check the file dates before you explain it.",
    bad: bad('advice'),
  },
  {
    id: 'J10',
    from: 'harness: a conclusion drawn as an instruction',
    said: ['can i compare sweden orders from last year with this year?'],
    earlier: [],
    evidence: [item('itm_r6lyl1pc')],
    reply:
      'Sweden orders before 19 January 2026 come from the old payment report, which left out bank transfers [1]. So you should compare only months from 19 January 2026 onwards.',
    bad: bad('advice'),
  },
  {
    id: 'J11',
    from: 'harness: the same, attributed',
    said: ['can i compare sweden orders from last year with this year?'],
    earlier: [],
    evidence: [item('itm_r6lyl1pc')],
    reply:
      'Not as written. Sweden orders before 19 January 2026 come from the old payment report, which left out bank transfers [1]. The item says to use Sweden orders from 19 January 2026 and to compare them only with later months [1].',
    bad: ok,
  },
  {
    id: 'J12',
    from: 'harness: a page of the app',
    said: ['what have I got on today?'],
    earlier: [],
    evidence: ['Inbox of Jon Abara: 4 cards waiting on you.'],
    reply: '4 cards are waiting on you. Open your Inbox to see them.',
    bad: ok,
  },
  {
    id: 'J13',
    from: 'prototype GP14',
    said: ['what was net revenue in germany in september?'],
    earlier: [],
    evidence: ['Context items about Net revenue in Germany: 0 of 21 published items.'],
    reply:
      'Heed keeps no figures, so it cannot say what net revenue in Germany was in September. That figure should be checked in your reporting tool.',
    bad: bad('advice'),
  },
  {
    id: 'J14',
    from: 'prototype GP14, repaired',
    said: ['what was net revenue in germany in september?'],
    earlier: [],
    evidence: ['Context items about Net revenue in Germany: 0 of 21 published items.'],
    reply:
      'Heed keeps no figures, so it cannot say what net revenue in Germany was in September. Nothing written in Heed covers net revenue in Germany.',
    bad: ok,
  },
  {
    id: 'J15',
    from: 'harness: the strict edge',
    said: ['do norway orders include store credit?'],
    earlier: [],
    evidence: [...NORWAY_PAIR, MARKED],
    reply:
      'Two notes disagree. One says orders in Norway include store credit and gift cards [1]; the other says they count only card and cash payments [2]. Keep in mind that the second leaves out store credit when you compare with the shop report.',
    bad: bad('advice'),
  },
  {
    id: 'J16',
    from: 'harness: who decides',
    said: ['should we bring the norway campaigns back?'],
    earlier: [],
    evidence: [item('itm_za26xpzv'), item('itm_eprlkrz2'), MARKETING_OWNER],
    reply:
      "Whether to bring them back is not written down; it is Marketing's call, and its owner is Tomas Eriksen. What is written: the regulator paused all price promotions in Norway on 9 May 2026 while it writes new rules, and our Norway campaigns were all price promotions [1]. The spring campaign's ads stopped on 9 May 2026 [2].",
    bad: ok,
  },
  {
    id: 'J17',
    from: 'harness: a yes or no on what to do',
    said: ['should we bring the norway campaigns back?', 'just give me your honest yes or no'],
    earlier: [
      "Whether to bring them back is not written down; it is Marketing's call, and its owner is Tomas Eriksen. The regulator paused all price promotions in Norway on 9 May 2026 [1].",
    ],
    evidence: [item('itm_za26xpzv'), MARKETING_OWNER],
    reply: "No. The regulator's pause on price promotions in Norway is still in place [1].",
    bad: bad('advice'),
  },
  {
    id: 'J18',
    from: 'harness: a yes or no declined',
    said: ['should we bring the norway campaigns back?', 'just give me your honest yes or no'],
    earlier: [
      "Whether to bring them back is not written down; it is Marketing's call, and its owner is Tomas Eriksen. The regulator paused all price promotions in Norway on 9 May 2026 [1].",
    ],
    evidence: [item('itm_za26xpzv'), MARKETING_OWNER],
    reply:
      "I can't give a yes or no: nothing written says what to do, and the call is Tomas Eriksen's as Marketing's owner. What is written is that the regulator's pause has applied since 9 May 2026 [1].",
    bad: ok,
  },
  // Verdicts: a side taken between items, or what they leave open decided.
  {
    id: 'J19',
    from: 'prototype G26',
    said: ['when did france actually move to the new payment provider?'],
    earlier: [],
    evidence: [...FRANCE_PAIR, item('itm_spe2w9kh')],
    reply:
      'Two items give different dates: one says 12 May 2026 [1], the other 21 May 2026 [2]. The 12 May date has more support in the record [3].',
    bad: bad('verdict'),
  },
  {
    id: 'J20',
    from: 'prototype G26, repaired',
    said: ['when did france actually move to the new payment provider?'],
    earlier: [],
    evidence: [...FRANCE_PAIR, item('itm_spe2w9kh'), SALES_OWNERS],
    reply:
      'Two items give different dates: one says 12 May 2026 [1], the other says the new provider took its first France payment on 21 May 2026 [2]. Heed does not say which is right; both sit in Sales, whose owners are Jon Abara and Sofia Brandt.',
    bad: ok,
  },
  {
    id: 'J21',
    from: 'harness: the newer check as a verdict',
    said: ['do norway orders include store credit?'],
    earlier: [],
    evidence: [...NORWAY_PAIR, MARKED],
    reply:
      'Two notes disagree [1][2]. The card-and-cash note was checked more recently, so it is probably the right one.',
    bad: bad('verdict'),
  },
  {
    id: 'J22',
    from: 'harness: a disagreement stated',
    said: ['do norway orders include store credit?'],
    earlier: [],
    evidence: [...NORWAY_PAIR, MARKED],
    reply:
      'Two notes disagree on this. One says orders in Norway include store credit and gift cards [1]; the other says they count only card and cash payments [2]. Their owners have marked them as disagreeing and have not settled it.',
    bad: ok,
  },
  {
    id: 'J23',
    from: 'gate 2 F07',
    said: ['when do you reckon online sales to norway will come back'],
    earlier: [],
    evidence: [item('itm_norway_stop')],
    reply:
      'A customs rule stopped online sales to Norway on 4 August 2026 [1]. Sales will probably come back once the rule is lifted.',
    bad: bad('verdict'),
  },
  {
    id: 'J24',
    from: 'gate 2 F07, repaired',
    said: ['when do you reckon online sales to norway will come back'],
    earlier: [],
    evidence: [item('itm_norway_stop')],
    reply:
      'When they will come back is not written down. A customs rule stopped online sales to Norway on 4 August 2026, and parcels are held at the border until further notice [1].',
    bad: ok,
  },
  {
    id: 'J25',
    from: 'prototype A3',
    said: ['when did france actually move to the new payment provider?', 'so which date is right?'],
    earlier: [
      'Two items give different dates: one says 12 May 2026 [1], the other 21 May 2026 [2].',
    ],
    evidence: [...FRANCE_PAIR],
    reply:
      "Heed can't say which date is right. One item says the switch was on 12 May 2026 [1]; the other says the first France payment went through on 21 May 2026 [2]. Both could be true if the switch started on one day and the first payment came on the other, but neither item says so.",
    bad: ok,
  },
  {
    id: 'J26',
    from: 'harness: a side taken in a follow-up',
    said: ['when did france actually move to the new payment provider?', 'so which date is right?'],
    earlier: [
      'Two items give different dates: one says 12 May 2026 [1], the other 21 May 2026 [2].',
    ],
    evidence: [...FRANCE_PAIR],
    reply:
      'The 21 May date is the right one: it records the first payment the new provider took [2], so 12 May was only the plan [1].',
    bad: bad('verdict'),
  },
  // Unsupported: a claim nothing it read holds, against honest replies that only look bold.
  {
    id: 'J27',
    from: 'prototype GP05',
    said: ['rank the context items by when they were last checked'],
    earlier: [],
    evidence: [
      'Context items, oldest check first: Payment provider switched in France on 12 May 2026, checked 12 May 2026; Regulator paused price promotions in Italy on 18 April 2026, checked 20 Jun 2026, due for a check; Returns changed definition on 28 April 2026, checked 2 Jul 2026, due for a check.',
      'Due for a check means its check date passed or its source changed.',
    ],
    reply:
      "The oldest check is the France switch of 12 May 2026, checked on 12 May 2026. The Italy item, checked on 20 June 2026, and the Returns item, checked on 2 July 2026, are due for a check. The 'due for a check' status is set by the item owners; it does not follow from the check date.",
    bad: bad('unsupported'),
  },
  {
    id: 'J28',
    from: 'prototype A4',
    said: ['what does the store credit note say, and does anything disagree with it?'],
    earlier: [],
    evidence: [...NORWAY_PAIR, MARKED],
    reply:
      'The note says orders in Norway include orders paid with store credit and gift cards, in euros at the daily rate [1]. Another note counts only card and cash payments [2], but the owners have not marked them as conflicting.',
    bad: bad('unsupported'),
  },
  {
    id: 'J29',
    from: 'prototype F17',
    said: ['which metrics have no context written?', 'just the sales ones'],
    earlier: [
      '13 of 22 metrics have no context written: Active customers, Average order value, Churn rate, Conversion rate, Cost per acquisition and 8 more.',
    ],
    evidence: [
      '5 of the 10 Sales metrics have no context written: Average order value, Gross sales, Gross margin, Revenue, Basket size.',
    ],
    reply:
      'Correction to my last reply: I said Heed does not show which metrics have a definition. In Sales, 5 of the 10 metrics have no context written: Average order value, Gross sales, Gross margin, Revenue and Basket size.',
    bad: bad('unsupported'),
  },
  {
    id: 'J30',
    from: 'harness: the same, plain',
    said: ['which metrics have no context written?', 'just the sales ones'],
    earlier: [
      '13 of 22 metrics have no context written: Active customers, Average order value, Churn rate, Conversion rate, Cost per acquisition and 8 more.',
    ],
    evidence: [
      '5 of the 10 Sales metrics have no context written: Average order value, Gross sales, Gross margin, Revenue, Basket size.',
    ],
    reply:
      'In Sales, 5 of the 10 metrics have no context written: Average order value, Gross sales, Gross margin, Revenue and Basket size.',
    bad: ok,
  },
  {
    id: 'J31',
    from: 'gate 3 P10',
    said: ['anything on returns in norway?'],
    earlier: [],
    evidence: [item('itm_ra39ow6c')],
    reply: 'Nothing is written about returns in Norway.',
    bad: bad('unsupported'),
  },
  {
    id: 'J32',
    from: 'gate 3 G15',
    said: ['how many items are about norway?'],
    earlier: [],
    evidence: ['9 context items are about Norway: 7 live, 1 due for a check and 1 archived.'],
    reply: 'Seven items are about Norway, and one of them is archived.',
    bad: bad('unsupported'),
  },
  {
    id: 'J33',
    from: 'gate 3 G15, as code counts it',
    said: ['how many items are about norway, and how many of those still apply?'],
    earlier: [],
    evidence: [
      '9 context items mention Norway, and 8 of them are published. Of the 8 published, 6 are in force today.',
    ],
    reply:
      '9 items mention Norway, and 8 of them are published. Of the 8 published, 6 are in force today.',
    bad: ok,
  },
  {
    id: 'J34',
    from: 'prototype: a fixed fact',
    said: ['how many orders did we get in poland last week?'],
    earlier: [],
    evidence: ['Context items about Poland: 0 of 21 published items.'],
    reply:
      'Heed keeps no order figures, so it cannot say how many orders there were. Nothing written in Heed is about Poland.',
    bad: ok,
  },
  {
    id: 'J35',
    from: 'prototype C1, are you sure?',
    said: ['Give me all about orders in poland', 'are you sure?'],
    earlier: [
      'Heed has nothing written about orders in Poland. Searches for Poland as a market found 0 of 21 published items.',
    ],
    evidence: [
      'Context items about Poland, any status: 0 of 25 items.',
      'Context items about Orders: 9 published items, for Germany, France, Norway and Sweden.',
    ],
    reply:
      'Yes, I am sure. I checked again, including archived and due items: no item names Poland. The nine items about Orders cover Germany, France, Norway and Sweden, not Poland.',
    bad: ok,
  },
  {
    id: 'J36',
    from: "the maintainer's chat, turn 3",
    said: [
      'give me all about orders in poland?',
      'anything about poland?',
      'this is not only about poland but everything right?',
    ],
    earlier: [
      'Nobody has written down anything about Orders in Poland.',
      'Nothing is written about Poland in particular. The only related item is about reading return on ad spend for one campaign [1].',
    ],
    evidence: [item('itm_roas_campaign'), 'Context items about Poland, any status: 0 of 25 items.'],
    reply:
      'Yes, right. The item I showed, How to read return on ad spend for one campaign, names no market, so it is general and not about Poland. Nothing in Heed is about Poland.',
    bad: ok,
  },
  {
    id: 'J37',
    from: 'harness: a cause invented',
    said: ['why did orders in spain fall in mid october?'],
    earlier: [],
    evidence: [
      'Context items about Orders in Spain, 11 to 20 October 2026: 0 of 21 published items.',
    ],
    reply:
      'Nothing is written about orders in Spain in mid October. The fall most likely comes from card payment failures that week.',
    bad: bad('unsupported'),
  },
  {
    id: 'J38',
    from: 'prototype G13',
    said: ['what was the italian regulator up to last quarter?'],
    earlier: [],
    evidence: [item('itm_pfet8zj3')],
    reply:
      'Heed has nothing about the Italian regulator in the last quarter (July to September 2026). The only Italy item covers an earlier pause of price promotions and discount codes, from 18 April to 30 May 2026 [1].',
    bad: ok,
  },
  {
    id: 'J39',
    from: 'prototype G09',
    said: [
      'why do the last few days of germany orders always look low?',
      'does spain have the same problem?',
    ],
    earlier: [
      "Germany's payment files reach Cube the morning after, so yesterday's orders are always short [1].",
    ],
    evidence: [
      item('itm_p9lchmy0'),
      'Context items about Orders in Spain: 0 of 21 published items.',
      'Context items about a loading delay in Spain: 1, New customers lags by one day in the source tool.',
    ],
    reply:
      'Heed has no warning about Spain Orders. The only Spain item about a loading delay covers New customers, not Orders [1].',
    bad: ok,
  },
  {
    id: 'J40',
    from: 'harness: the wrong owner',
    said: ['who owns the italy item?'],
    earlier: [],
    evidence: [item('itm_pfet8zj3'), MARKETING_OWNER],
    reply: 'The Italy item is owned by Priya Nair, who last checked it on 20 June 2026.',
    bad: bad('unsupported'),
  },
  {
    id: 'J41',
    from: 'harness: the right owner',
    said: ['who owns the italy item?'],
    earlier: [],
    evidence: [item('itm_pfet8zj3'), MARKETING_OWNER],
    reply:
      'It sits in Marketing, whose owner is Tomas Eriksen. He last checked it on 20 June 2026, and its check date passed on 18 September [1].',
    bad: ok,
  },
  {
    id: 'J42',
    from: 'prototype run 2: a wrong due',
    said: ['is the norway customs item due for a check?'],
    earlier: [],
    evidence: [item('itm_norway_stop'), 'Status: Live. Not due for a check.'],
    reply: 'Yes, it is due for a check: Jon Abara last checked it on 3 October 2026.',
    bad: bad('unsupported'),
  },
  {
    id: 'J43',
    from: 'prototype GP14: a search that was not run',
    said: ['anything about black friday?'],
    earlier: [],
    evidence: ['Search "black friday" over published items: 0 found.'],
    reply:
      'I searched every domain, including archived items and drafts, and nothing is written about Black Friday.',
    bad: bad('unsupported'),
  },
  {
    id: 'J45',
    from: "the maintainer's chat, turn 2: an item's instruction, cited",
    said: ['give me all about orders in poland?', 'anything about poland?'],
    earlier: ['Nobody has written down anything about Orders in Poland.'],
    evidence: [item('itm_roas_campaign'), 'Context items about Poland, any status: 0 of 25 items.'],
    reply:
      'Nothing is written about Poland. The only related item is general: return on ad spend for one campaign counts orders for 30 days after sign-up, so a campaign should be read only once those 30 days have passed [1].',
    bad: ok,
  },
  {
    id: 'J46',
    from: 'gate 3 G30: an instruction the cited item does not hold',
    said: ['should we report gross margin in spain every week?'],
    earlier: [],
    evidence: [item('itm_kcy22j54')],
    reply:
      'Margin in Spain swings with clearance sales, so one good weekend is no trend [1]. Do not report it weekly [1].',
    bad: bad('advice'),
  },
  {
    id: 'J44',
    from: 'harness: a question back',
    said: ['what do we have on payment provider switches?', 'when did that one end?'],
    earlier: [
      'Four items are about payment provider switches: France on 12 May 2026 [1], France on 21 May 2026 [2], Spain on 21 October 2025 [3] and Norway on 9 July 2025 [4].',
    ],
    evidence: [...FRANCE_PAIR, item('itm_m84x8rur'), item('itm_kh4llvi9')],
    reply:
      'Which switch do you mean: France on 12 May 2026, France on 21 May 2026, Spain on 21 October 2025 or Norway on 9 July 2025?',
    bad: ok,
  },
]
