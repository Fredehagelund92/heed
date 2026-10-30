/**
 * Evaluations (slice S13): golden questions, answer tests through the real MCP wire with judges,
 * the cell cache, the impact set from replay, baselines, scorecards and spend caps. The review
 * gate needs levels 1 to 3 only (FR-513), so no suggestion waits for an answer test. The
 * retrieval pass scores every edition without a model, and full runs follow changes outside the
 * gate.
 */
export { evalJobs } from './jobs.ts'
export { goldenL1, type GoldenCheck, type GoldenL1Result } from './golden.ts'
export { deliver, deliveredIds, runRetrievalPass, workRetrieval } from './retrieval.ts'
export { queueTriggeredRuns } from './triggers.ts'
export {
  liveHead,
  modelsFor,
  queueAreaRun,
  resumeRun,
  stopRun,
  type EvalDeps,
  type RunSummary,
} from './runs.ts'
export { readEvalSettings } from './settings.ts'
export { createEvalsService, type EvalsService } from './service.ts'
export { CEILING_MARGIN, workEvaluations, type WorkSummary } from './worker.ts'
export {
  estimateWithheld,
  runWithheld,
  type WithheldOptions,
  type WithheldRun,
} from './withheld.ts'
