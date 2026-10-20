import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { Area } from '@domain/item'
import { toApiError, type TermBatchInput, type TermBatchResult, type TermCandidate } from '@/api'
import { areasQuery, termCandidatesQuery, useApiWrite, vocabularyQuery } from '@/api/queries'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ListChecksIcon,
  ListIcon,
  LoaderCircleIcon,
  PlusIcon,
  XIcon,
} from '@/components/icons'
import { TermTile } from '@/components/catalogue/catalogue-marks'
import { GridFailed, GridLoading } from '@/components/page/grid-table'
import { PageContent } from '@/components/page/page'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { BlockedButton } from '@/components/ui/blocked-button'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldDescription, FieldHeader, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { proposeTermsSearch, sourceSearch, type Source } from '@/lib/sources'
import { cn } from '@/lib/utils'
import { TERM_BATCH_MAX } from '../../../contract/review.ts'
import { pastedValues } from '../../../domain/term-candidates.ts'
import { memberOf } from '../../../domain/vocabulary.ts'
import { SettingsBlock } from './settings-parts'

/*
  The source's members as vocabulary terms (the pilot walk's B1; FR-125, FR-136). Heed reads every
  public member of a definition source, but "Where it applies", the catalogue and agents know only
  terms, so a member reaches people once it is a term. An administrator proposes the members in
  one step, with the values a dimension has that the source does not list (markets, brands), and
  the terms wait for a decision like any proposal: nothing is served before an accept, and an
  administrator decides them, the proposer too (FR-206). Accept all on any of them accepts the whole batch as
  one edition.
*/

const inlineLink = 'text-brand-ink underline underline-offset-4 hover:no-underline'

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/** The candidates of one source: its members no term or open proposal links yet. */
const ofSource = (candidates: readonly TermCandidate[], source: string) =>
  candidates.filter((candidate) => candidate.source === source)

/** On a definition source's page: how many members are not terms yet, and the way to propose them. */
export function TermsBlock({ source }: { source: Source }) {
  const candidates = useQuery(termCandidatesQuery())
  if (source.kind !== 'definition_source' || !source.definitions.current) return null
  const open = candidates.data ? ofSource(candidates.data, source.id) : null
  // A live dimension offered again counts only the members it does not link yet.
  const members = open?.reduce(
    (sum, candidate) =>
      sum + candidate.definitionRefs.filter((ref) => !candidate.linked.includes(ref)).length,
    0,
  )
  return (
    <SettingsBlock
      title="Names we know"
      slot="source-terms"
      description={
        open === null
          ? `People, the Catalogue and AI apps find a metric or dimension of ${source.tool} once it's one of the names we know.`
          : members
            ? `People, the Catalogue and AI apps find a metric or dimension of ${source.tool} once it's one of the names we know. ${count(members, 'metric or dimension', 'metrics and dimensions')} ${members === 1 ? "isn't one" : "aren't"} yet.`
            : `Every metric and dimension we read from ${source.tool} is a name we know, or waits for a decision.`
      }
      action={
        open === null ? null : open.length ? (
          <Button
            variant="outline"
            render={<Link to="/admin" search={proposeTermsSearch(source.id)} />}
          >
            <ListChecksIcon aria-hidden />
            Propose names
          </Button>
        ) : (
          // The page stays reachable once every member is a term: values come later too.
          <Button
            variant="outline"
            render={<Link to="/admin" search={proposeTermsSearch(source.id)} />}
          >
            <ListIcon aria-hidden />
            Add values of a dimension
          </Button>
        )
      }
    >
      {candidates.isError ? (
        <GridFailed
          slot="source-terms"
          what="the metrics and dimensions that aren't names yet"
          retry={() => void candidates.refetch()}
        />
      ) : null}
    </SettingsBlock>
  )
}

type Row = { selected: boolean; name: string; areaId: string }
type ValueList = { id: number; dimension: string; text: string }

/** Where an error of the proposal belongs: `terms.3.name` is the fourth term's. */
const termIndex = (field: string) => {
  const match = /^terms\.(\d+)\./.exec(field)
  return match ? Number(match[1]) : null
}

/**
 * The page that proposes a source's members as terms (`terms=` on the source's page), and the
 * values of a dimension. It stays open once every member is a term, for values added later; with
 * `values` (a dimension's Values action) it proposes that dimension's values only, so no member
 * is proposed by the way.
 */
export function ProposeTermsPage({ source, values }: { source: Source; values?: string }) {
  const candidates = useQuery(termCandidatesQuery())
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: vocabulary } = useQuery(vocabularyQuery())
  const [result, setResult] = useState<TermBatchResult | null>(null)
  if (result) return <Proposed source={source} result={result} />
  if (candidates.isPending)
    return (
      <PageContent width="overview">
        <GridLoading slot="propose-terms" label="Loading the metrics and dimensions" />
      </PageContent>
    )
  if (candidates.isError)
    return (
      <PageContent width="overview">
        <GridFailed
          slot="propose-terms"
          what="the metrics and dimensions that aren't names yet"
          retry={() => void candidates.refetch()}
        />
      </PageContent>
    )
  return (
    <ProposeTermsForm
      source={source}
      candidates={values ? [] : ofSource(candidates.data, source.id)}
      valuesOnly={values !== undefined}
      initialDimension={values}
      areas={areas}
      liveDimensions={(vocabulary?.dimensions ?? []).map((dimension) => ({
        key: `dim:${dimension.id}`,
        name: dimension.name,
      }))}
      onProposed={setResult}
    />
  )
}

function ProposeTermsForm({
  source,
  candidates,
  valuesOnly,
  initialDimension,
  areas,
  liveDimensions,
  onProposed,
}: {
  source: Source
  candidates: readonly TermCandidate[]
  valuesOnly: boolean
  /** The dimension whose list of values starts open. */
  initialDimension: string | undefined
  areas: readonly Area[]
  liveDimensions: readonly { key: string; name: string }[]
  onProposed: (result: TermBatchResult) => void
}) {
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      candidates.map((candidate) => [
        candidate.key,
        { selected: candidate.suggested, name: candidate.name, areaId: candidate.areaId ?? '' },
      ]),
    ),
  )
  const [lists, setLists] = useState<ValueList[]>(() =>
    initialDimension ? [{ id: 1, dimension: initialDimension, text: '' }] : [],
  )
  const [failure, setFailure] = useState<{ title: string; messages: string[] } | null>(null)
  const [problems, setProblems] = useState<Record<string, string[]>>({})
  const write = useApiWrite('proposeTerms')
  const spinning = usePendingIndicator(write.isPending)

  const change = (key: string, patch: Partial<Row>) =>
    setRows((current) => ({ ...current, [key]: { ...current[key]!, ...patch } }))
  const chosen = candidates.filter((candidate) => rows[candidate.key]?.selected)
  // A dimension proposed here, or one already in the vocabulary, can take pasted values.
  const dimensions = [
    ...chosen
      .filter((candidate) => candidate.kind === 'dimension')
      .map((candidate) => ({
        key: candidate.key,
        name: rows[candidate.key]!.name || candidate.name,
      })),
    ...liveDimensions.filter((live) => !chosen.some((candidate) => candidate.key === live.key)),
  ]
  const valueTerms = lists.flatMap((list) => {
    if (!list.dimension) return []
    const parent = chosen.find((candidate) => candidate.key === list.dimension)
    return pastedValues(list.dimension, list.text).values.map((value) => ({
      key: value.key,
      kind: 'dimension_value' as const,
      parentKey: list.dimension,
      name: value.name,
      aliases: value.aliases,
      areaId: parent ? rows[parent.key]!.areaId || null : null,
      definitionRefs: [],
    }))
  })
  const terms: TermBatchInput['terms'] = [
    ...chosen.map((candidate) => ({
      key: candidate.key,
      kind: candidate.kind,
      parentKey: null,
      name: rows[candidate.key]!.name.trim(),
      aliases: candidate.aliases,
      areaId: rows[candidate.key]!.areaId || null,
      definitionRefs: candidate.definitionRefs,
    })),
    ...valueTerms,
  ]
  const unnamed = chosen.filter((candidate) => !rows[candidate.key]!.name.trim())
  const blocked = !terms.length
    ? candidates.length
      ? 'Choose at least one metric or dimension, or paste values of a dimension.'
      : 'Paste values of a dimension first.'
    : terms.length > TERM_BATCH_MAX
      ? `You can propose at most ${count(TERM_BATCH_MAX, 'name')} at once. Leave out ${count(terms.length - TERM_BATCH_MAX, 'name')}, then propose the rest in a second step.`
      : unnamed.length
        ? 'Give every row you chose a name first.'
        : null
  const allSelected = chosen.length === candidates.length
  // Metrics the source gives no domain are their own group, at the top: each needs a domain
  // chosen here, or its view needs one in the source, to be filed and reviewed where it belongs.
  const homeless = candidates.filter(
    (candidate) => candidate.kind === 'metric' && !candidate.areaId,
  )
  const housed = candidates.filter((candidate) => !homeless.includes(candidate))
  const rowsOf = (list: readonly TermCandidate[]) =>
    list.map((candidate) => (
      <MemberRow
        key={candidate.key}
        tool={source.tool}
        candidate={candidate}
        row={rows[candidate.key]!}
        areas={areas}
        problems={problems[candidate.key] ?? []}
        onChange={(patch) => change(candidate.key, patch)}
      />
    ))
  const chooseAll = (
    <Button
      variant="outline"
      onClick={() =>
        setRows((current) =>
          Object.fromEntries(
            Object.entries(current).map(([key, row]) => [key, { ...row, selected: !allSelected }]),
          ),
        )
      }
    >
      <ListChecksIcon aria-hidden />
      {allSelected ? 'Choose none' : 'Choose all'}
    </Button>
  )

  const propose = async () => {
    setFailure(null)
    setProblems({})
    try {
      onProposed(
        await write.mutateAsync({ terms, sourceName: `${source.tool} metrics and dimensions` }),
      )
    } catch (error) {
      const refused = toApiError(error)
      const byKey: Record<string, string[]> = {}
      const general: string[] = []
      for (const finding of refused.findings.filter((f) => f.severity === 'error')) {
        const index = termIndex(finding.field)
        const key = index === null ? undefined : terms[index]?.key
        if (key && rows[key]) byKey[key] = [...(byKey[key] ?? []), finding.message]
        else general.push(finding.message)
      }
      setProblems(byKey)
      setFailure({
        title: refused.findings.length ? 'No name was proposed' : "The names weren't proposed",
        messages: refused.findings.length
          ? general.length
            ? general
            : ['Fix the rows marked below, then propose again.']
          : [refused.message || 'Try again.'],
      })
    }
  }

  return (
    <PageContent width="overview" className="gap-8" data-slot="propose-terms">
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-bold tracking-title">
          {valuesOnly ? 'Add values' : 'Propose names'}
        </h1>
        <p className="max-w-reading text-dense text-muted-foreground">
          Each {valuesOnly ? 'value' : 'metric or dimension you keep'} becomes a proposal for a
          name, so people can say a fact applies to it and AI apps can ask about it. AI apps get it
          once it&apos;s accepted. An owner of its domain, or any admin, decides. Accept all on any
          of them accepts every name proposed here at once.
        </p>
      </header>

      {failure ? (
        <Alert variant="danger" role="alert" className="max-w-reading">
          <CircleAlertIcon aria-hidden />
          <AlertContent>
            <AlertTitle>{failure.title}</AlertTitle>
            <AlertDescription>
              {failure.messages.slice(0, 6).map((message) => (
                <p key={message}>{message}</p>
              ))}
            </AlertDescription>
          </AlertContent>
        </Alert>
      ) : null}

      {valuesOnly || candidates.length ? null : (
        <SettingsBlock
          title={`Metrics and dimensions of ${source.tool}`}
          slot="propose-terms-members"
          description={`Every metric and dimension we read from ${source.tool} is a name we know, or waits for a decision in Proposals. One added to the model shows here after the next read.`}
        >
          {null}
        </SettingsBlock>
      )}

      {homeless.length ? (
        <SettingsBlock
          title="Metrics without a domain"
          slot="propose-terms-no-domain"
          description={`${source.tool} gives ${homeless.length === 1 ? 'this metric' : `these ${homeless.length} metrics`} no domain. A metric needs one: facts people write about it go to that domain, and its owner reviews them. Choose a domain for each here, or give ${homeless.length === 1 ? 'its view' : 'their views'} a domain in the model or the server's domain names and read ${source.tool} again. Without a domain, a proposal reaches no owner, and an admin decides it.`}
          action={
            <span className="flex flex-wrap items-center gap-2">
              {housed.length ? null : chooseAll}
              {areas.length ? (
                <NativeSelect
                  value=""
                  aria-label="Put every metric without a domain in"
                  onChange={(event) => {
                    const areaId = event.target.value
                    if (!areaId) return
                    setRows((current) => ({
                      ...current,
                      ...Object.fromEntries(
                        homeless.map((candidate) => [
                          candidate.key,
                          { ...current[candidate.key]!, areaId },
                        ]),
                      ),
                    }))
                  }}
                  className="@2xl:w-column-domain"
                >
                  <NativeSelectOption value="">Put them all in…</NativeSelectOption>
                  {areas.map((area) => (
                    <NativeSelectOption key={area.id} value={area.id}>
                      {area.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <Button
                  variant="outline"
                  render={<Link to="/admin" search={{ section: 'domains' }} />}
                >
                  Create a domain
                </Button>
              )}
            </span>
          }
        >
          <ul
            aria-label="Metrics without a domain"
            className="@container flex flex-col divide-y divide-border-subtle rounded-lg border bg-card"
          >
            {rowsOf(homeless)}
          </ul>
        </SettingsBlock>
      ) : null}

      {housed.length ? (
        <SettingsBlock
          title={`Metrics and dimensions of ${source.tool}`}
          slot="propose-terms-members"
          description="The name is what people read and search for. A metric takes the domain of its view. A dimension is one name however many views have it. If its views are in different domains, it takes none, and an admin reviews it. We leave out dates and ids unless you choose them."
          action={chooseAll}
        >
          <ul
            aria-label={`Metrics and dimensions of ${source.tool}`}
            className="@container flex flex-col divide-y divide-border-subtle rounded-lg border bg-card"
          >
            {rowsOf(housed)}
          </ul>
        </SettingsBlock>
      ) : null}

      <SettingsBlock
        title="Values of a dimension"
        slot="propose-terms-values"
        description={`${source.tool} lists dimensions, not their values. To say a fact applies to a market or a brand, paste its values, one per line. Put any other names after a comma, such as "Norway, Norge".`}
      >
        {lists.map((list, index) => (
          <ValueListField
            key={list.id}
            list={list}
            index={index}
            dimensions={dimensions}
            onChange={(next) =>
              setLists((current) => current.map((other) => (other.id === list.id ? next : other)))
            }
            onRemove={() => setLists((current) => current.filter((other) => other.id !== list.id))}
          />
        ))}
        <Button
          variant="outline"
          className="self-start"
          aria-disabled={!dimensions.length || undefined}
          onClick={() => {
            if (!dimensions.length) return
            setLists((current) => [
              ...current,
              {
                id: Math.max(0, ...current.map((list) => list.id)) + 1,
                dimension:
                  dimensions.find(
                    (dimension) => !current.some((l) => l.dimension === dimension.key),
                  )?.key ?? '',
                text: '',
              },
            ])
          }}
        >
          <PlusIcon aria-hidden />
          {lists.length ? 'Add values of another dimension' : 'Add values of a dimension'}
        </Button>
      </SettingsBlock>

      <div className="flex flex-wrap items-center gap-2" data-slot="propose-terms-actions">
        {blocked ? (
          <BlockedButton reason={blocked} title="You can't propose yet">
            <ListChecksIcon aria-hidden />
            Propose names
          </BlockedButton>
        ) : (
          <Button aria-disabled={write.isPending || undefined} onClick={() => void propose()}>
            {spinning ? (
              <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
            ) : (
              <ListChecksIcon aria-hidden />
            )}
            Propose {count(terms.length, 'name')}
          </Button>
        )}
        <Button variant="outline" render={<Link to="/admin" search={sourceSearch(source.id)} />}>
          Cancel
        </Button>
      </div>
    </PageContent>
  )
}

function MemberRow({
  tool,
  candidate,
  row,
  areas,
  problems,
  onChange,
}: {
  tool: string
  candidate: TermCandidate
  row: Row
  areas: readonly Area[]
  problems: readonly string[]
  onChange: (patch: Partial<Row>) => void
}) {
  const members = candidate.definitionRefs.map(memberOf)
  const adds = candidate.definitionRefs
    .filter((ref) => !candidate.linked.includes(ref))
    .map(memberOf)
  const member = (candidate.linked.length ? adds : members)[0] ?? candidate.key
  return (
    <li
      data-term={candidate.key}
      className="flex flex-col gap-2 px-3 py-2 @2xl:flex-row @2xl:items-center @2xl:gap-3"
    >
      <span className="flex min-w-0 items-center gap-3 @2xl:flex-1">
        <Checkbox
          checked={row.selected}
          onCheckedChange={(checked) => onChange({ selected: Boolean(checked) })}
          aria-label={`Propose ${row.name || candidate.name}`}
        />
        <TermTile kind={candidate.kind} size="md" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <Input
            value={row.name}
            onChange={(event) => onChange({ name: event.target.value })}
            aria-label={`Name of ${member}`}
            aria-invalid={problems.length || (row.selected && !row.name.trim()) ? true : undefined}
            disabled={!row.selected}
            autoComplete="off"
          />
          <span
            className="truncate text-caption text-muted-foreground"
            title={members.join(', ')}
            data-slot="propose-terms-member-names"
          >
            {candidate.linked.length
              ? `A name we know already. It also links ${count(adds.length, `more ${tool} name`)}: `
              : null}
            <span className="font-mono" translate="no">
              {(candidate.linked.length ? adds : members).join(', ')}
            </span>
          </span>
          {candidate.aliases.length ? (
            <span
              className="truncate text-caption text-muted-foreground"
              data-slot="propose-terms-other-names"
            >
              Other names: {candidate.aliases.join(', ')}
            </span>
          ) : null}
          {problems.map((problem) => (
            <span
              key={problem}
              role="alert"
              className="flex items-start gap-1 text-caption text-status-danger-fg"
            >
              <CircleAlertIcon aria-hidden className="size-icon-sm shrink-0 translate-y-px" />
              <span className="min-w-0">{problem}</span>
            </span>
          ))}
        </span>
      </span>
      <NativeSelect
        value={row.areaId}
        onChange={(event) => onChange({ areaId: event.target.value })}
        aria-label={`Domain of ${row.name || candidate.name}`}
        disabled={!row.selected}
        className={cn('@2xl:w-column-domain')}
      >
        <NativeSelectOption value="">No domain</NativeSelectOption>
        {areas.map((area) => (
          <NativeSelectOption key={area.id} value={area.id}>
            {area.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </li>
  )
}

function ValueListField({
  list,
  index,
  dimensions,
  onChange,
  onRemove,
}: {
  list: ValueList
  index: number
  dimensions: readonly { key: string; name: string }[]
  onChange: (list: ValueList) => void
  onRemove: () => void
}) {
  const read = list.dimension ? pastedValues(list.dimension, list.text) : null
  const name = dimensions.find((dimension) => dimension.key === list.dimension)?.name
  return (
    <FieldSet className="max-w-reading gap-2" data-slot="propose-terms-value-list">
      <FieldHeader>
        <FieldLegend icon={ListIcon}>
          {name ? `Values of ${name}` : `Values ${index + 1}`}
        </FieldLegend>
        <FieldDescription>
          {read
            ? `${count(read.values.length, 'value')}${read.unreadable.length ? `. We can't read a name on ${count(read.unreadable.length, 'line')}: ${read.unreadable.slice(0, 3).join(', ')}` : ''}.`
            : 'Choose the dimension they belong to.'}
        </FieldDescription>
      </FieldHeader>
      <span className="flex items-center gap-2">
        <NativeSelect
          value={list.dimension}
          onChange={(event) => onChange({ ...list, dimension: event.target.value })}
          aria-label={`Dimension of values ${index + 1}`}
          className="min-w-0 flex-1"
        >
          <NativeSelectOption value="">Choose a dimension</NativeSelectOption>
          {dimensions.map((dimension) => (
            <NativeSelectOption key={dimension.key} value={dimension.key}>
              {dimension.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove values ${index + 1}`}
          onClick={onRemove}
        >
          <XIcon aria-hidden />
        </Button>
      </span>
      <Textarea
        value={list.text}
        onChange={(event) => onChange({ ...list, text: event.target.value })}
        aria-label={`Values ${index + 1}, one per line`}
        placeholder={'Norway, Norge\nPoland, Polska'}
        rows={5}
        spellCheck={false}
      />
    </FieldSet>
  )
}

/** What happened: the terms wait for a decision, and who makes it. */
function Proposed({ source, result }: { source: Source; result: TermBatchResult }) {
  const first = result.proposals[0]
  const withoutDomain = result.proposals.filter((proposal) => proposal.areaId === null).length
  return (
    <PageContent width="overview" className="gap-8" data-slot="propose-terms-done">
      <Alert className="max-w-reading">
        <CircleCheckIcon aria-hidden />
        <AlertContent>
          <AlertTitle>{count(result.proposals.length, 'name')} proposed</AlertTitle>
          <AlertDescription>
            <p>
              They wait for a decision, and AI apps get them once they&apos;re accepted. An owner of
              each name&apos;s domain or any admin decides, you included
              {withoutDomain
                ? `. ${withoutDomain === 1 ? 'The one' : `The ${withoutDomain}`} without a domain ${withoutDomain === 1 ? 'needs' : 'need'} an admin`
                : ''}
              . Accept all on any of them accepts every name they can decide at once.
            </p>
            {first ? (
              <Link
                to="/proposals/$proposalId"
                params={{ proposalId: first.id }}
                className={inlineLink}
              >
                Open the first name
              </Link>
            ) : null}
          </AlertDescription>
        </AlertContent>
      </Alert>
      <Button
        variant="outline"
        className="self-start"
        render={<Link to="/admin" search={sourceSearch(source.id)} />}
      >
        Back to {source.name}
      </Button>
    </PageContent>
  )
}
