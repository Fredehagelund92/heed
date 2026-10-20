import type {
  EditionBundle,
  Match,
  ResolveRequest,
  Withheld,
} from '../../../src/domain/resolver.ts'

/** Deliberately scans every row and removes in ascending priority, independently of the index. */
export function oracle(bundle: EditionBundle, request: ResolveRequest) {
  const empty = { items: [] as Match[], withheld: [] as Withheld[], cut: [] as string[] }
  if (!request.dependenciesAvailable) return { ...empty, status: 'check_failed' }
  if (request.scope.status !== 'resolved') return { ...empty, status: 'need_more_detail' }
  const scope = request.scope.scope
  // An asked group stands for every metric in it.
  const asked = scope.metrics.flatMap((key) => [
    key,
    ...Object.entries(bundle.groupsOfMetric)
      .filter(([, groups]) => groups.includes(key))
      .map(([metric]) => metric),
  ])
  const rows = bundle.items.filter((item) => {
    if (
      item.scope.metrics.length &&
      !item.scope.metrics.some((key) =>
        asked.some((metric) => metric === key || bundle.groupsOfMetric[metric]?.includes(key)),
      )
    )
      return false
    // An item about any value of a dimension needs a question that names the dimension.
    if (item.scope.dimensions.some((dimension) => scope.filters[dimension] === undefined))
      return false
    if (scope.window.end !== null && item.validity.start >= scope.window.end) return false
    if (item.validity.end !== null && scope.window.start >= item.validity.end) return false
    return [...new Set(item.scope.dimensionValues.map((value) => value.dimension))].every(
      (dimension) => {
        const filter = scope.filters[dimension]
        return (
          !filter?.length ||
          item.scope.dimensionValues
            .filter((value) => value.dimension === dimension)
            .some((value) => filter.includes(value.value))
        )
      },
    )
  })
  const withheld: Withheld[] = []
  const eligible = rows
    .filter((item) => {
      if (
        item.status === 'proposal' &&
        (!request.preview ||
          (!request.preview.testRun &&
            !request.preview.administrator &&
            !request.preview.ownerAreas.includes(item.areaId) &&
            request.preview.personId !== item.proposerId))
      )
        return false
      let reason: Withheld['reason'] | undefined
      if (
        item.audience.kind === 'groups' &&
        !request.groups.some(
          (group) => item.audience.kind === 'groups' && item.audience.groups.includes(group),
        )
      )
        reason = 'audience'
      else {
        const metrics = Object.keys(bundle.groupsOfMetric).filter((metric) =>
          item.scope.metrics.some((key) => bundle.groupsOfMetric[metric]?.includes(key)),
        )
        metrics.push(...item.scope.metrics.filter((key) => !key.startsWith('group:')))
        if (
          metrics.length > 0 &&
          metrics.filter((metric) => !request.hiddenMetrics.includes(metric)).length === 0
        )
          reason = 'source_visibility'
      }
      if (!reason && item.status === 'retired') return false
      if (
        !reason &&
        (bundle.stopped.all ||
          bundle.stopped.areas.indexOf(item.areaId) >= 0 ||
          bundle.stopped.items.indexOf(item.id) >= 0)
      )
        reason = 'stopped'
      if (
        !reason &&
        item.riskLevel === 'high' &&
        (item.checkFlag !== null || (item.reviewDate !== null && item.reviewDate < request.today))
      )
        reason = 'high_risk_unverified'
      if (reason) withheld.push({ id: item.id, reason })
      return reason === undefined
    })
    .map((item) => {
      const restrictions = [...new Set(item.scope.dimensionValues.map((row) => row.dimension))]
        .filter((dimension) => !scope.filters[dimension]?.length)
        .sort()
        .map((dimension) => ({
          dimension,
          values: [
            ...new Set(
              item.scope.dimensionValues
                .filter((row) => row.dimension === dimension)
                .map((row) => row.value),
            ),
          ].sort(),
        }))
      const match: Match = {
        id: item.id,
        version: item.version,
        match: restrictions.length ? 'partial' : 'exact',
        restrictions,
        unverified:
          item.checkFlag !== null || (item.reviewDate !== null && item.reviewDate < request.today),
        checkFlag: item.checkFlag,
        startsAfterQuestion: scope.window.start < item.validity.start,
      }
      return { item, match, size: Array.from(item.summary + (item.body ?? '')).length }
    })
  eligible.sort((a, b) => {
    if (a.match.match !== b.match.match) return a.match.match === 'partial' ? -1 : 1
    const risks = ['low', 'normal', 'high']
    if (a.item.riskLevel !== b.item.riskLevel)
      return risks.indexOf(a.item.riskLevel) - risks.indexOf(b.item.riskLevel)
    if (a.item.validity.start !== b.item.validity.start)
      return a.item.validity.start < b.item.validity.start ? -1 : 1
    return a.item.id < b.item.id ? 1 : a.item.id === b.item.id ? 0 : -1
  })
  const cut: string[] = []
  while (eligible.reduce((sum, row) => sum + row.size, 0) > request.sizeLimit)
    cut.push(eligible.shift()!.item.id)
  eligible.reverse()
  const conflict = eligible.some((a) => eligible.some((b) => a.item.conflicts.includes(b.item.id)))
  return {
    status: eligible.length ? (conflict ? 'conflict' : 'matched') : 'no_match',
    items: eligible.map((row) => row.match),
    withheld: withheld.sort((a, b) => (a.id < b.id ? -1 : a.id === b.id ? 0 : 1)),
    cut,
  }
}
