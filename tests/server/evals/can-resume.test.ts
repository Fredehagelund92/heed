import { expect, it } from 'vitest'
import { canResume } from '../../../src/server/modules/evals/runs.ts'

/*
  Which run may be queued again (#194): only one that stopped before it finished, and only of a
  kind the worker takes. A run only its command works, queued again, would wait for nobody.
*/

it('resumes only an incomplete run of a kind the worker takes', () => {
  const kinds = [
    'impact',
    'full',
    'scheduled',
    'replay',
    'links',
    'assistant_mock',
    'assistant_real',
    'held_out',
  ]
  expect(kinds.filter((kind) => canResume({ kind, state: 'incomplete' }).resume)).toEqual([
    'impact',
    'full',
    'scheduled',
    'replay',
    'links',
  ])
  const heldOut = canResume({ kind: 'held_out', state: 'incomplete' })
  expect(heldOut.resume || heldOut.why).toContain('npm run held-out -- eval')
  for (const state of ['queued', 'running', 'finished', 'failed', 'cancelled'])
    expect(canResume({ kind: 'full', state })).toMatchObject({
      resume: false,
      why: 'Only a test run that stopped before it finished can be resumed.',
    })
})
