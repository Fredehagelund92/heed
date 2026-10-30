/**
 * The answer engine on the service (src/domain/answer.ts): Ask's look-up, Asked this week, the
 * replay of a topic and the reach of a draft, each on the edition it needs, read
 * once and kept a short while. No model decides anything, and no question is stored; with a real
 * model, the assistant's model only writes Ask's words from the items the engine gave.
 */
export {
  askForWords,
  planWords,
  readWordsModel,
  writeWords,
  wordsInputOf,
  type WordsPlan,
} from './words.ts'
export { wordsCases, wordsProblems, type WordsCase } from './words-cases.ts'
export {
  askedThisWeek,
  createBundleCache,
  liveBundle as liveServingBundle,
  lookupQuestion,
  minimumCount,
  reachOfDraft,
  replayTopic,
  type BundleCache,
} from './service.ts'
export type { RecordsReads } from './records.ts'
