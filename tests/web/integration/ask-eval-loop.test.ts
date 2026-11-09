import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on Ask's loop (docs/evaluations.md): one model on the read tools, run
  as the person asking, through the real service on the demo week. In every build the model's
  steps are those of the last real run (ask-eval-loop-steps.json), and the scripted reader takes
  any step the run did not record. What it breaks and misses there is listed below, by promise and
  by what a case must say: only ever shorter. The held-back cases are a count.

  Read by hand, the breaches listed are: F02, the model's own sentence that gives the count of
  published items next to the subject ("None of the 21 published context items you may read
  applies to Orders in Spain"), which the grader reads as how often agents asked about it; FP13
  and GP10, the model citing an item as a reference to its id ([#r1.items.0.id]), which no number
  is, so the sentence that held the citation is left out and the state has none; and five
  must-nots. 27 steps follow tool results that are not the same from one run to the next (an
  Inbox card's id is made afresh each run), so no recorded step matches them, even on the code
  that recorded them: the scripted reader takes those in every build.
*/

askEvalSuite({
  answerer: 'loop',
  brokenToday: {
    hidden: ['F02'],
    state: ['FP13', 'GP10'],
    never: ['G06', 'H04', 'H06', 'H13', 'H24'],
  },
  missingToday: [
    'C2',
    'K01',
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
    'F10',
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
    'FP11',
    'FP12',
    'G03',
    'G05',
    'G07',
    'G08',
    'G12',
    'G13',
    'G14',
    'G15',
    'G18',
    'G21',
    'G22',
    'G23',
    'G25',
    'G29',
    'GP01',
    'GP04',
    'GP07',
    'GP10',
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
    'H18',
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
  heldPassingToday: 11,
})
