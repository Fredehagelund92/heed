import { systemClock, type Clock } from '../../clock.ts'
import { createBundleCache } from '../answer/index.ts'
import type { ScheduledJob } from '../jobs/index.ts'
import { raiseAlerts } from './raise.ts'

/**
 * The alert rules (FR-621): every 15 minutes, beside gaps.detect, each rule that is on reads what
 * it is about and raises a card in the Inbox for what it finds, through the outbox. It runs as no
 * person and is safe to run twice: a raise is kept once for what it was about.
 */
export function alertsJob({ clock = systemClock() }: { clock?: Clock } = {}): ScheduledJob {
  const cache = createBundleCache()
  return {
    name: 'alerts.raise',
    cron: '*/15 * * * *',
    expectedEverySeconds: 60 * 60,
    async run({ database }) {
      return { raised: await raiseAlerts(database, clock, cache) }
    },
  }
}
