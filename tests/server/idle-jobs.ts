import type { JobRunner } from '../../src/server/modules/jobs/index.ts'

/** A job runner that does nothing, for tests that drive the HTTP app without scheduled jobs. */
export function idleJobs(): JobRunner {
  return {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    runNow: () => Promise.resolve({ outcome: 'not_running' }),
    overview: () => Promise.reject(new Error('not used')),
  }
}
