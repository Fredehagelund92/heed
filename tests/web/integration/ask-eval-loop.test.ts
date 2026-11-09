import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on Ask's loop (docs/evaluations.md): one model on the read tools, run
  as the person asking, through the real service on the demo week. In every build the model's
  steps are those of the last real run (ask-eval-loop-steps.json), and the scripted reader takes
  any step the run did not record. What it breaks and misses there is listed below, by promise and
  by what a case must say: only ever shorter. The held-back cases are a count.

  Read by hand, the breaches listed are: V04, a decline the advice pattern reads as advice ("Ask
  does not answer questions about what you should do"); H30, the model's own advice ("which you
  may want to see"); FP08, the model citing an item as a reference to its id ([#r1.items.0.id]),
  which no number is, so the sentence that held the citation is left out and the state has no
  source; and five must-nots. 26 steps follow tool results that are not the same from one run to
  the next (an Inbox card's id is made afresh each run), so no recorded step matches them, even on
  the code that recorded them: the scripted reader takes those in every build.
*/

askEvalSuite({
  answerer: 'loop',
  brokenToday: {
    advice: ['V04', 'H30'],
    state: ['FP08'],
    never: ['F12', 'G06', 'H04', 'H06', 'H13'],
  },
  missingToday: [
    'C2',
    'K01',
    'K08',
    'K10',
    'K12',
    'K15',
    'V01',
    'V04',
    'V09',
    'F01',
    'F05',
    'F06',
    'F07',
    'F09',
    'F12',
    'F14',
    'F15',
    'F16',
    'F17',
    'F18',
    'F19',
    'F21',
    'F29',
    'FP01',
    'FP02',
    'FP03',
    'FP04',
    'FP07',
    'FP08',
    'FP11',
    'FP12',
    'G01',
    'G03',
    'G05',
    'G07',
    'G12',
    'G13',
    'G15',
    'G18',
    'G21',
    'G22',
    'G23',
    'G27',
    'G29',
    'G30',
    'GP01',
    'GP04',
    'GP06',
    'GP07',
    'GP11',
    'GP12',
    'GP15',
    'H02',
    'H03',
    'H04',
    'H05',
    'H06',
    'H07',
    'H08',
    'H10',
    'H13',
    'H14',
    'H15',
    'H16',
    'H18',
    'H20',
    'H24',
    'H25',
    'H28',
    'H29',
    'H30',
    'P04',
    'P05',
    'P10',
    'P13',
  ],
  heldPassingToday: 8,
})
