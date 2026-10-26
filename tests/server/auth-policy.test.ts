import { describe, expect, it } from 'vitest'
import { contract } from '../../src/contract/index.ts'
import type { Principal } from '../../src/contract/auth.ts'
import { can, createDevSignIn, policies } from '../../src/server/modules/auth/index.ts'

function operations(router: object, prefix = ''): string[] {
  return Object.entries(router).flatMap(([key, value]: [string, unknown]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (!value || typeof value !== 'object') return []
    return '~orpc' in value ? [path] : operations(value, path)
  })
}
const publicOperations = ['auth.people', 'auth.signIn', 'schema.item']
// Owners of any area, and administrators; the service narrows to their areas.
// Also the area dashboards, test question upkeep, runs other than a proposal's, transcripts,
// scorecards, editions and gap status and notes (Quality design G13).
const maintainOperations = [
  'evals.retrieval.latest',
  'evals.retrieval.edition',
  'evals.retrieval.trend',
  'quality.history',
  // The replay of a topic: the service narrows it to the owners of the topic's domains.
  'obs.replay',
  'quality.compare',
  'quality.feedback',
  'quality.ratings',
  'quality.apps',
  'quality.upkeep',
  'quality.untested',
  'quality.fixNext',
  'quality.compareQuestion',
  'quality.questionHistory',
  'evals.questions.save',
  'evals.questions.setAside',
  'evals.questions.import',
  'evals.questions.export',
  'evals.runs.list',
  'evals.runs.estimate',
  'evals.runs.start',
  'evals.runs.startLinks',
  'evals.transcript',
  'evals.scorecard',
  'editions.list',
  'editions.diff',
  'editions.feed',
  'editions.compare',
  'editions.compareItem',
  'editions.export',
  'areas.dashboard',
  'areas.describe',
  'gaps.setStatus',
  'gaps.addNote',
  'gaps.linkTest',
  'gaps.unlinkTest',
]
const adminOperations = [
  'vocabulary.candidates',
  'vocabulary.proposeBatch',
  'roles.list',
  'people.sheet',
  'roles.grant',
  'roles.revoke',
  'assignments.grant',
  'assignments.revoke',
  'grants.apply',
  'operations.overview',
  'operations.run',
  'editions.rollback',
  'editions.rollbackPreview',
  'serving.setStop',
  'bin.list',
  'bin.get',
  'bin.preview',
  'bin.move',
  'bin.rescuePreview',
  'bin.restore',
  'areas.get',
  'areas.create',
  'areas.removal',
  'areas.remove',
  'areas.archived',
  'areas.restore',
  'areas.update',
  'evals.runs.approve',
  'settings.list',
  'settings.history',
  'settings.set',
  'tools.list',
  'tools.set',
  'clients.list',
  'clients.save',
  'traffic.summary',
  // Every person's agents (security check F3): seen and disconnected by administrators only.
  'aiConnections.list',
  'aiConnections.disconnect',
  'aiConnections.disconnectPerson',
  // Sources an administrator adds: their settings, secrets and test reads.
  'sources.types',
  'sources.get',
  'sources.add',
  'sources.update',
  'sources.test',
]
/** FR-808: the history log is for administrators and auditors, and so is finding people for its filter. */
const auditOperations = ['audit.search', 'audit.export', 'audit.verify', 'people.search']
const readOperations = [
  // A person's own agents: every signed-in person answers their own sign-ins and lists and
  // disconnects their own apps (the service narrows to the person).
  'connections.request',
  'connections.decide',
  'connections.list',
  'connections.disconnect',
  'proposals.create',
  'proposals.list',
  'proposals.get',
  'proposals.saveDraft',
  'proposals.submit',
  'proposals.claim',
  'proposals.handOver',
  'proposals.withdraw',
  'proposals.discard',
  'proposals.comment',
  'proposals.events',
  'proposals.overlap',
  'proposals.preview',
  'proposals.tests',
  'proposals.attachTest',
  'proposals.detachTest',
  'review.queue',
  'review.get',
  'review.runChecks',
  'review.edit',
  'review.decide',
  'review.planDecisions',
  'review.decideMany',
  'review.assign',
  'review.retire',
  'review.proposeRetirement',
  'review.recheck',
  'vocabulary.propose',
  'vocabulary.decideBatch',
  'evals.questions.list',
  'evals.questions.get',
  'evals.runs.get',
  'evals.runs.cancel',
  'evals.runs.resume',
  'serving.stops',

  'auth.signOut',
  'auth.session',
  'me.get',
  'people.list',
  'areas.list',
  'gaps.list',
  'gaps.get',
  'gaps.report',
  'gaps.startDraft',
  'topics.counts',
  'topics.weekly',
  'sources.flags',
  'sources.staleLinks',
  'vocabulary.get',
  'vocabulary.search',
  'vocabulary.describe',
  'library.index',
  'library.freshness',
  'library.reviews',
  'catalogue.list',
  'catalogue.get',
  'items.list',
  'items.get',
  'items.history',
  'items.links',
  'inbox.list',
  'inbox.markRead',
  'inbox.markAllRead',
  'inbox.archive',
  'activity.list',
  'events.stream',
  'imports.items',
  'assistant.chat',
  'assistant.rate',
  'connect.get',
  'tryIt.read',
  'tryIt.run',
  // The answer engine: Ask's look-up and Asked this week, and the reach of a draft the person
  // may read (the service checks the draft).
  'ask.lookup',
  'ask.asked',
  'engine.reach',
]

describe('policy matrix', () => {
  it('declares a policy for every executable contract operation', () => {
    expect(operations(contract).sort()).toEqual(Object.keys(policies).sort())
    expect(
      [
        ...publicOperations,
        ...adminOperations,
        ...auditOperations,
        ...maintainOperations,
        ...readOperations,
      ].sort(),
    ).toEqual(Object.keys(policies).sort())
  })
  it.each(['anonymous', 'contributor', 'owner', 'approver', 'auditor', 'administrator'])(
    'evaluates every operation for %s',
    (role) => {
      const principal: Principal | null =
        role === 'anonymous'
          ? null
          : {
              id: 'person',
              name: 'Person',
              initials: 'P',
              permissions: {
                roles: role === 'administrator' || role === 'auditor' ? [role] : [],
                assignments:
                  role === 'owner' || role === 'approver' ? [{ areaId: 'finance', role }] : [],
              },
            }
      for (const operation of publicOperations)
        expect(can(principal, operation), operation).toBe(true)
      for (const operation of readOperations)
        expect(can(principal, operation), operation).toBe(role !== 'anonymous')
      for (const operation of adminOperations)
        expect(can(principal, operation), operation).toBe(role === 'administrator')
      for (const operation of auditOperations)
        expect(can(principal, operation), operation).toBe(
          role === 'administrator' || role === 'auditor',
        )
      for (const operation of maintainOperations)
        expect(can(principal, operation), operation).toBe(['administrator', 'owner'].includes(role))
      expect(can(principal, 'unregistered.operation')).toBe(false)
    },
  )
  it('refuses the dev adapter itself in production', () => {
    expect(() => createDevSignIn([], 'production')).toThrow(/refused/)
  })
})
