import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on Ask's loop (docs/evaluations.md): one model on the read tools, run
  as the person asking, through the real service on the demo week. In every build the model's
  steps are those of the last real run (ask-eval-loop-steps.json), and the scripted reader takes
  any step the run did not record. What it breaks and misses there is listed below, by promise and
  by what a case must say: only ever shorter. The held-back cases are a count.

  Read by hand, the breaches listed are: K13 and G15, the model adding two counts itself; V04, a
  Conflict state from the chat's earlier read beside words that name the conflict and cite one
  side; F17, FP07 and GP06, sentences that give each of several topics its own count, which the
  grader reads against every topic the sentence names; and five must-nots.
*/

askEvalSuite({
  answerer: 'loop',
  brokenToday: {
    numbers: ['K13', 'G15'],
    hidden: ['F17', 'FP07', 'GP06'],
    state: ['V04'],
    never: ['V02', 'G06', 'H04', 'H06', 'H13'],
  },
  missingToday: [
    'C2',
    'K10',
    'K12',
    'V09',
    'F01',
    'F03',
    'F04',
    'F05',
    'F06',
    'F07',
    'F09',
    'F12',
    'F13',
    'F14',
    'F15',
    'F16',
    'F17',
    'F18',
    'F19',
    'F21',
    'F24',
    'F28',
    'F29',
    'F30',
    'FP01',
    'FP02',
    'FP03',
    'FP04',
    'FP11',
    'FP12',
    'G01',
    'G03',
    'G05',
    'G07',
    'G08',
    'G12',
    'G13',
    'G15',
    'G18',
    'G21',
    'G22',
    'G23',
    'G29',
    'G30',
    'GP01',
    'GP02',
    'GP04',
    'GP06',
    'GP07',
    'GP11',
    'GP15',
    'H02',
    'H04',
    'H06',
    'H07',
    'H08',
    'H13',
    'H14',
    'H15',
    'H18',
    'H20',
    'H24',
    'H25',
    'H26',
    'H28',
    'H30',
    'P03',
    'P04',
    'P05',
    'P10',
    'P13',
  ],
  heldPassingToday: 10,
})
