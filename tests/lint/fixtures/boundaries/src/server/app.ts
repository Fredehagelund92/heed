// Allowed: the service wires modules through their index.ts, and uses the domain.
import { describeAlpha } from './modules/alpha'
import { addDays } from '../domain/pure'

export const app = `${describeAlpha()} ${addDays('2026-10-07')}`
