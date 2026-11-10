import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on today's main (docs/evaluations.md): the router, the planner and the
  words, through the real service on the demo week, on the plans of the last real run in every
  build. What it breaks and misses there is listed below, by promise and by what a case must say:
  only ever shorter. The held-back cases are a count.
*/

askEvalSuite({
  answerer: 'main',
  brokenToday: { never: ['C1', 'K01', 'K13', 'F30'] },
  missingToday: [
    'C1',
    'C2',
    'K01',
    'K15',
    'V01',
    'V04',
    'V07',
    'V09',
    'F05',
    'F07',
    'F19',
    'F25',
    'F28',
    'F30',
    'FP04',
    'G13',
    'G15',
    'G18',
    'G25',
    'G29',
    'GP05',
    'H05',
  ],
  heldPassingToday: 19,
})
