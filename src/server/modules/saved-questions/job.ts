import { systemClock, type Clock } from '../../clock.ts'
import { createBundleCache } from '../answer/index.ts'
import type { ScheduledJob } from '../jobs/index.ts'
import { checkIfMoved } from './service.ts'

/**
 * The free check after every change (FR-526): each minute, once what agents get has moved (a
 * publish, an archive, a restore, a sync's stops and flags, or a new day, on which a check date
 * passes), every saved question is answered again and its result kept. It runs as no person,
 * after the change and apart from it, so it never blocks a publish, and it is safe to run twice:
 * a second run finds nothing moved.
 */
export function savedCheckJob({ clock = systemClock() }: { clock?: Clock } = {}): ScheduledJob {
  const cache = createBundleCache()
  return {
    name: 'saved.check',
    cron: '* * * * *',
    expectedEverySeconds: 15 * 60,
    async run({ database }) {
      const done = await checkIfMoved(database, clock, cache)
      return done ? { trigger: done.trigger, checked: done.checked } : { checked: 0 }
    },
  }
}
