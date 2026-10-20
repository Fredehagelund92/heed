/** Gaps, counts and privacy: topics, week counts, gap detection, notes, dashboards and verification. */
export { gapDetectionJob } from './detection.ts'
export { createGapsService, gapReportsPerMinute, type GapsService } from './service.ts'
export { verifyGapsByRun, type VerifiedGap } from './verify.ts'
