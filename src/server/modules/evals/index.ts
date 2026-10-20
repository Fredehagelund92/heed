/**
 * Evaluations (slice S13): golden questions, answer tests through the real MCP wire with judges,
 * the cell cache, the impact set from replay, baselines, scorecards and spend caps. Records
 * levels 4 and 5 (`answer_impact`, `answer_full`) for the review gate. The retrieval pass scores
 * every edition without a model, and full runs follow changes outside the gate.
 */
export { judgeAnswer, UnreadableVerdict } from './answer.ts'
export { evalJobs } from './jobs.ts'
export { goldenL1, type GoldenCheck, type GoldenL1Result } from './golden.ts'
export {
  createRetrievalService,
  deliver,
  deliveredIds,
  readableAreas,
  runRetrievalPass,
  workRetrieval,
  type RetrievalService,
} from './retrieval.ts'
export { typicalJudgeCall } from './plan.ts'
export { queueTriggeredRuns } from './triggers.ts'
export {
  estimateDraftRun,
  judgeFor,
  liveHead,
  modelsFor,
  queueAreaRun,
  queueVersionRun,
  resumeRun,
  stopRun,
  type EvalDeps,
  type RunSummary,
} from './runs.ts'
export { readEvalSettings } from './settings.ts'
export {
  answerLevelView,
  createEvalsService,
  heldOutLabel,
  hiddenQuestions,
  type EvalsService,
} from './service.ts'
export { CEILING_MARGIN, workEvaluations, type WorkSummary } from './worker.ts'
export {
  estimateWithheld,
  runWithheld,
  type WithheldOptions,
  type WithheldRun,
} from './withheld.ts'
