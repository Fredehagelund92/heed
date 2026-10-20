import type { AssistantGoldenCase } from '../../../domain/golden-set.ts'
import type { AssistantCase, CaseTurn, Expectations } from './cases.ts'

/**
 * The golden set's assistant cases (db/seed/golden-set.yml, `assistant:`) as cases the runner
 * makes: each turn of a conversation in order, with its own checks and rubrics, on the case's
 * as-of day. They name fixed items of the golden library, so they run only on a database that
 * has it live; the runner skips a case whose items are not there.
 */
export function goldenAssistantCases(cases: readonly AssistantGoldenCase[]): AssistantCase[] {
  return cases.map((c) => {
    const [first, ...then] = c.turns.map(turnOf)
    const items = [
      ...new Set(
        c.turns.flatMap((t) => [
          ...(t.expect.cites ?? []),
          ...(t.say.match(/\bitm_[a-z0-9]+/g) ?? []),
        ]),
      ),
    ]
    return {
      id: c.id,
      ...first!,
      asOf: c.as_of,
      ...(items.length ? { items } : {}),
      ...(then.length ? { then } : {}),
    }
  })
}

function turnOf(turn: AssistantGoldenCase['turns'][number]): CaseTurn {
  const e = turn.expect
  const expect: Expectations = {
    ...(e.tools_any ? { someTool: e.tools_any } : {}),
    ...(e.tools_none ? { notTools: e.tools_none } : {}),
    ...(e.confirmation ? { confirmation: e.confirmation } : {}),
    ...(e.confirmation_or_question ? { confirmationOrQuestion: e.confirmation_or_question } : {}),
    ...(e.cites?.length ? { citesAll: e.cites } : {}),
    ...(e.cites_any ? { cites: true as const } : {}),
    ...(e.forbidden_phrases.length ? { forbiddenPhrases: e.forbidden_phrases } : {}),
    ...(e.canaries.length ? { canaries: e.canaries } : {}),
    ...(e.asks_no_identity ? { asksNoIdentity: true as const } : {}),
    ...(e.asks_no_scope ? { asksNoScope: true as const } : {}),
    ...(e.links_any ? { linksAny: e.links_any } : {}),
    ...(e.unchanged ? { unchanged: true as const } : {}),
  }
  return {
    say: () => turn.say,
    text: turn.say,
    expect,
    ...(turn.rubrics.length ? { rubrics: turn.rubrics } : {}),
  }
}
