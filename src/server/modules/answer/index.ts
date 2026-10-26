/**
 * The answer engine on the service (src/domain/answer.ts): Ask's look-up, Asked this week, Try it
 * on a draft, the replay of a topic and the reach of a draft, each on the edition it needs, read
 * once and kept a short while. No model runs, and no question is stored.
 */
export {
  askedThisWeek,
  createBundleCache,
  lookupQuestion,
  reachOfDraft,
  replayTopic,
  tryItRun,
  type BundleCache,
} from './service.ts'
