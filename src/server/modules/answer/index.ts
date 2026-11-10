/**
 * The answer engine on the service (src/domain/answer.ts): Ask's look-up, Asked this week, the
 * replay of a topic and the reach of a draft, each on the edition it needs, read
 * once and kept a short while. No model decides a state, an item or what agents are told, and no
 * question is stored; with a real model, the assistant's model chooses Ask's reads for a question
 * the rules cannot read (the planner, FR-719) and writes Ask's words from the items read.
 */
export {
  askForWords,
  planWords,
  readWordsModel,
  writeWords,
  wordsInputOf,
  type WordsMiss,
  type WordsPlan,
  type WordsReply,
} from './words.ts'
export { wordsCases, wordsProblems, type WordsCase } from './words-cases.ts'
export {
  askPlanCase,
  planCases,
  planProblems,
  runPlanCases,
  type PlanCase,
  type PlanOutcome,
  type PlanRoute,
} from './plan-cases.ts'
export { classCases } from './class-cases.ts'
export { gateCases } from './gate-cases.ts'
export { stewardCases } from './steward-cases.ts'
export {
  classOf,
  OWN_VOICE,
  engineDigest,
  GATE_BUDGETS,
  gatePasses,
  heldIds,
  plannerDigest,
  recordedPlansFile,
  scoreRun,
} from './plan-gate.ts'
export { PLAN_NOW, PLAN_TODAY, planAreas, planBundle } from './plan-world.ts'
export {
  askForPlan,
  planQuestion,
  scriptedPlan,
  PLAN_MAX_TOKENS,
  PLAN_TIMEOUT_MS,
  type PlanCall,
  type PlannerMiss,
  type PlannerReply,
} from './plan.ts'
export { demoCases, type DemoCase } from './burned-cases.ts'
export {
  askedFor,
  askedThisWeek,
  createBundleCache,
  liveBundle as liveServingBundle,
  lookupQuestion,
  minimumCount,
  reachOfDraft,
  replayTopic,
  type AskTrace,
  type BundleCache,
  type LookupDeps,
} from './service.ts'
export type { RecordsReads } from './records.ts'
export {
  askToolDefinitions,
  askToolNames,
  createAskTools,
  toolErrorSchema,
  type AskToolInput,
  type AskToolName,
  type AskToolOutput,
  type AskToolResult,
  type AskTools,
} from './tools.ts'
export { toolReadsIn, type ToolReads, type ToolServices } from './tool-reads.ts'
export {
  askLoop,
  footerOf,
  LOOP_MAX_TOKENS,
  LOOP_SECONDS,
  LOOP_STEPS,
  loopSystem,
  overviewTurn,
  progressOf,
  readLines,
  readLoopLimits,
  stateOf,
  stoppedSentence,
  turnOf,
  type Asker,
  type LoopDeps,
  type MadeRead,
} from './loop.ts'
export {
  scriptedLoopChoice,
  scriptedLoopModel,
  scriptedPrompt,
  type ScriptedPrompt,
  type ScriptedStep,
} from './loop-mock.ts'
