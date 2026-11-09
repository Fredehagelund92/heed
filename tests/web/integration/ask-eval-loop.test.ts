import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on Ask's loop (docs/evaluations.md): one model on the read tools, run
  as the person asking, through the real service on the demo week. In every build the model's
  steps are those of the last real run (ask-eval-loop-steps.json), and the scripted reader takes
  any step the run did not record. What it breaks and misses there is listed below, by promise and
  by what a case must say: only ever shorter. The held-back cases are a count.

  Read by hand, the breaches listed are: V07, the person's own number said back to them ("more
  than 12?"); F10, GP06, H05 and H06, sentences that give each of several topics its own count,
  which the grader reads against every topic the sentence names; P04 and P05, the model's own
  advice ("Keep in mind that …"); and six must-nots. 25 steps follow tool results that are not the
  same from one run to the next (an Inbox card's id is made afresh each run), so no recorded step
  matches them, even on the code that recorded them: the scripted reader takes those in every build.
*/

askEvalSuite({
  answerer: 'loop',
  brokenToday: {
    hidden: ['V07', 'F10', 'GP06', 'H05', 'H06'],
    advice: ['P04', 'P05'],
    never: ['K03', 'V02', 'F12', 'G06', 'H04', 'H06'],
  },
  missingToday: [
    'C2',
    'K01',
    'K10',
    'K12',
    'V01',
    'V09',
    'V11',
    'F01',
    'F04',
    'F05',
    'F06',
    'F07',
    'F13',
    'F14',
    'F15',
    'F16',
    'F17',
    'F18',
    'F19',
    'F21',
    'F25',
    'F29',
    'FP01',
    'FP02',
    'FP03',
    'FP04',
    'FP10',
    'FP11',
    'FP12',
    'G01',
    'G03',
    'G05',
    'G07',
    'G12',
    'G13',
    'G14',
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
    'GP07',
    'GP11',
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
    'H26',
    'H28',
    'H29',
    'H30',
    'P04',
    'P05',
    'P10',
    'P13',
  ],
  heldPassingToday: 10,
})
