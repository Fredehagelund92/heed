import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { deriveAgentDraft, type AgentDraftInput } from '../src/domain/agent-draft.ts'
import type { ContextItem, ItemKind } from '../src/domain/item.ts'
import { itemKinds } from '../src/domain/item.ts'
import type { Term } from '../src/domain/vocabulary.ts'
import { demoDefinitions, definitionRefsOf, termAreas } from '../src/web/mocks/cube-model.ts'
import { generateItems } from '../src/web/mocks/items.ts'
import { areas, FIXTURE_TODAY, vocabulary } from '../src/web/mocks/reference-data.ts'

/*
  The offline evaluation of the MCP draft tool's derivation (FR-121; the agent capture report,
  sections 6 and 7): the 1,500 seeded items, a third held out by a hash of the id, and per
  attribute how often the derivation gets back what the item holds. No model and no database, so
  it runs in every build (`npm test`) and on request (`npm run eval:drafts`).

  The seed is generated from templates: its area, risk, claim level and audience are drawn at
  random, apart from the text. It is a regression check of the deterministic parts, not a
  measure of quality on real context; that needs a labelled set written by people.
*/

/** The vocabulary as the bulk seed stores it (db/seed/bulk.ts), with the Cube domains. */
export function seededTerms(): Term[] {
  const terms: Term[] = []
  const term = (
    key: string,
    kind: Term['kind'],
    parentKey: string | null,
    name: string,
    aliases: string[] = [],
    definitionRefs: string[] = [],
  ) =>
    terms.push({
      key,
      kind,
      parentKey,
      name,
      aliases,
      areaId: termAreas[key] ?? null,
      definitionRefs,
    })
  for (const group of new Set(vocabulary.metrics.map((m) => m.group)))
    term('group:' + group.toLowerCase(), 'metric_group', null, group)
  for (const m of vocabulary.metrics) {
    const key = 'metric:' + m.id
    term(
      key,
      'metric',
      'group:' + m.group.toLowerCase(),
      m.name,
      [],
      definitionRefsOf({ key, group: m.group }),
    )
  }
  for (const d of vocabulary.dimensions) {
    const key = 'dim:' + d.id
    term(key, 'dimension', null, d.name, [], definitionRefsOf({ key }))
    for (const v of d.values) term(`val:${d.id}/${v.id}`, 'dimension_value', key, v.name, v.aliases)
  }
  return terms
}

/** A rate with its Wilson 95% interval, as counts (requirements 1.7). */
export type Rate = { hits: number; of: number; rate: number; low: number; high: number }
export function wilson(hits: number, of: number): Rate {
  if (!of) return { hits, of, rate: 0, low: 0, high: 0 }
  const z = 1.959964
  const p = hits / of
  const centre = (p + (z * z) / (2 * of)) / (1 + (z * z) / of)
  const spread = (z * Math.sqrt((p * (1 - p)) / of + (z * z) / (4 * of * of))) / (1 + (z * z) / of)
  return {
    hits,
    of,
    rate: p,
    low: Math.max(0, centre - spread),
    high: Math.min(1, centre + spread),
  }
}

/** One third of the items, chosen by a hash of the id: never shown to whoever tunes the rules. */
export const heldOut = (item: Pick<ContextItem, 'id'>) =>
  createHash('sha256').update(item.id).digest()[0]! % 3 === 0

/** What the person would say, and what the agent was working with: never the item's own fields. */
export function inputFor(item: ContextItem, working: boolean): AgentDraftInput {
  const metric = vocabulary.metrics.find(
    (m) => `metric:${m.id}` === item.scope.metrics[0] || m.id === item.scope.metrics[0],
  )
  return {
    text: [item.summary, item.body].filter(Boolean).join('\n\n'),
    ...(working && metric ? { scope: { metrics: [metric.name] } } : {}),
  }
}

type Counts = { tp: number; predicted: number; truth: number; exact: number; of: number }
const counts = (): Counts => ({ tp: 0, predicted: 0, truth: 0, exact: 0, of: 0 })
function tally(c: Counts, predicted: readonly string[], truth: readonly string[]) {
  const wanted = new Set(truth)
  const found = new Set(predicted)
  c.tp += [...found].filter((key) => wanted.has(key)).length
  c.predicted += found.size
  c.truth += wanted.size
  c.of += 1
  if (found.size === wanted.size && [...found].every((key) => wanted.has(key))) c.exact += 1
}
const setReport = (c: Counts) => ({
  precision: wilson(c.tp, c.predicted),
  recall: wilson(c.tp, c.truth),
  exactSet: wilson(c.exact, c.of),
})

/** The report for a set of items: per attribute, against what the seeded item holds. */
export function evaluate(items: readonly ContextItem[], terms: readonly Term[] = seededTerms()) {
  const definitionArea = new Map(demoDefinitions.map((d) => [d.ref, d.areaHint]))
  const areaOf = (key: string) => {
    const term = terms.find((t) => t.key === key)
    return (
      term?.areaId ??
      (term?.definitionRefs[0] ? (definitionArea.get(term.definitionRefs[0]) ?? null) : null)
    )
  }
  const context = {
    terms,
    areaOf,
    areas: areas.map((a) => ({ id: a.id, name: a.name })),
    today: FIXTURE_TODAY,
  }
  const keyOf = (id: string, prefix: string) => (id.includes(':') ? id : `${prefix}:${id}`)
  const confusion = Object.fromEntries(
    itemKinds.map((kind) => [kind, Object.fromEntries(itemKinds.map((k) => [k, 0]))]),
  ) as Record<ItemKind, Record<ItemKind, number>>
  let kindHits = 0
  const metricsText = counts()
  const metricsWorking = counts()
  const valuesWorking = counts()
  let domainDecided = 0
  let domainRight = 0
  let startNamed = 0
  let startRight = 0
  let startAsked = 0
  let endRight = 0
  let highRisk = 0
  let highFlagged = 0
  let flagged = 0
  let riskAboveDefault = 0
  let inventedKeys = 0
  let inventedEvidence = 0
  let asked = 0
  const known = new Set(terms.map((t) => t.key))
  for (const item of items) {
    const alone = deriveAgentDraft(inputFor(item, false), context)
    const derived = deriveAgentDraft(inputFor(item, true), context)
    const draft = derived.draft
    const kind = draft.kind!
    confusion[item.kind][kind] += 1
    if (kind === item.kind) kindHits += 1
    const truthMetrics = item.scope.metrics.map((m) => keyOf(m, 'metric'))
    tally(metricsText, alone.draft.scope!.metrics, truthMetrics)
    tally(metricsWorking, draft.scope!.metrics, truthMetrics)
    tally(
      valuesWorking,
      draft.scope!.dimensionValues.map((v) => v.value),
      item.scope.dimensionValues.map((v) =>
        v.value.includes(':') ? v.value : `val:${v.dimension}/${v.value}`,
      ),
    )
    if (draft.areaId) {
      domainDecided += 1
      if (draft.areaId === item.areaId) domainRight += 1
    }
    if (draft.validity) {
      startNamed += 1
      if (draft.validity.start === item.validity.start) startRight += 1
      if (draft.validity.end === item.validity.end) endRight += 1
    } else startAsked += 1
    const mayBeHigh = derived.flags.some((f) => f.code === 'may_be_high_risk')
    if (mayBeHigh) flagged += 1
    if (item.riskLevel === 'high') {
      highRisk += 1
      if (mayBeHigh) highFlagged += 1
    }
    if (
      draft.riskLevel !== undefined ||
      draft.claimLevel !== undefined ||
      draft.audience !== undefined
    )
      riskAboveDefault += 1
    const keys = [
      ...draft.scope!.metrics,
      ...draft.scope!.dimensions,
      ...draft.scope!.dimensionValues.flatMap((v) => [v.dimension, v.value]),
    ]
    if (keys.some((key) => !known.has(key))) inventedKeys += 1
    if (draft.evidence?.length) inventedEvidence += 1
    asked += derived.questions.length
  }
  const f1 = itemKinds.map((kind) => {
    const tp = confusion[kind][kind]
    const predicted = itemKinds.reduce((sum, k) => sum + confusion[k][kind], 0)
    const truth = itemKinds.reduce((sum, k) => sum + confusion[kind][k], 0)
    const precision = predicted ? tp / predicted : 0
    const recall = truth ? tp / truth : 0
    return {
      kind,
      truth,
      f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    }
  })
  const present = f1.filter((row) => row.truth > 0)
  return {
    items: items.length,
    kind: {
      accuracy: wilson(kindHits, items.length),
      macroF1: present.reduce((sum, row) => sum + row.f1, 0) / (present.length || 1),
      confusion,
    },
    scope: {
      metricsFromText: setReport(metricsText),
      metricsWithWorkingScope: setReport(metricsWorking),
      dimensionValues: setReport(valuesWorking),
    },
    domain: {
      decided: wilson(domainDecided, items.length),
      rightWhenDecided: wilson(domainRight, domainDecided),
      majorityShare:
        Math.max(...areas.map((a) => items.filter((i) => i.areaId === a.id).length)) /
        (items.length || 1),
    },
    validity: {
      startRightWhenNamed: wilson(startRight, startNamed),
      startAsked: wilson(startAsked, items.length),
      endRightWhenNamed: wilson(endRight, startNamed),
    },
    risk: {
      highRiskItems: highRisk,
      flaggedMayBeHigh: wilson(highFlagged, highRisk),
      flaggedShare: wilson(flagged, items.length),
    },
    /** Never anything but zero: the rules hold by construction, the counts prove it. */
    guarantees: {
      riskClaimOrAudienceSet: riskAboveDefault,
      keysOutsideVocabulary: inventedKeys,
      evidenceWithoutALink: inventedEvidence,
    },
    questionsPerItem: asked / (items.length || 1),
  }
}
export type DraftEvaluation = ReturnType<typeof evaluate>

/** Both halves of the seeded library: what the rules were tuned on, and the held-out third. */
export function evaluateSeed() {
  const items = generateItems()
  const terms = seededTerms()
  return {
    tuned: evaluate(
      items.filter((item) => !heldOut(item)),
      terms,
    ),
    heldOut: evaluate(items.filter(heldOut), terms),
  }
}

const percent = (rate: Rate) =>
  `${(rate.rate * 100).toFixed(1)}% (${rate.hits}/${rate.of}, 95% ${(rate.low * 100).toFixed(1)} to ${(rate.high * 100).toFixed(1)})`

/** The held-out report as plain lines. */
export function reportLines(result: DraftEvaluation): string[] {
  return [
    `items ${result.items}`,
    `kind accuracy ${percent(result.kind.accuracy)}, macro F1 ${result.kind.macroF1.toFixed(3)}`,
    `metrics from the words: precision ${percent(result.scope.metricsFromText.precision)}, recall ${percent(result.scope.metricsFromText.recall)}`,
    `metrics with the working scope: exact set ${percent(result.scope.metricsWithWorkingScope.exactSet)}, recall ${percent(result.scope.metricsWithWorkingScope.recall)}`,
    `dimension values: precision ${percent(result.scope.dimensionValues.precision)}, recall ${percent(result.scope.dimensionValues.recall)}`,
    `domain decided ${percent(result.domain.decided)}, right when decided ${percent(result.domain.rightWhenDecided)}, majority area ${(result.domain.majorityShare * 100).toFixed(1)}% (the seed's areas are random)`,
    `validity start right when the words name one ${percent(result.validity.startRightWhenNamed)}, asked ${percent(result.validity.startAsked)}`,
    `high-risk items ${result.risk.highRiskItems}, flagged "may be high risk" ${percent(result.risk.flaggedMayBeHigh)}; the risk level itself is never raised`,
    `guarantees: risk, claim or audience set ${result.guarantees.riskClaimOrAudienceSet}, keys outside the vocabulary ${result.guarantees.keysOutsideVocabulary}, evidence without a link ${result.guarantees.evidenceWithoutALink}`,
    `questions per item ${result.questionsPerItem.toFixed(2)}`,
  ]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { tuned, heldOut: held } = evaluateSeed()
  console.log('Held out (one third of the seeded items):')
  for (const line of reportLines(held)) console.log(`  ${line}`)
  console.log('Tuned on (the other two thirds):')
  for (const line of reportLines(tuned)) console.log(`  ${line}`)
  if (process.argv.includes('--json'))
    console.log(JSON.stringify({ tuned, heldOut: held }, null, 2))
}
