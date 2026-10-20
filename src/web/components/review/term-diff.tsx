import type { Area } from '@domain/item'
import {
  HeedDomainIcon,
  LayersIcon,
  MinusIcon,
  PlusIcon,
  ShapesIcon,
  SigmaIcon,
  SplitIcon,
  TagIcon,
  TypeIcon,
  type Icon,
} from '@/components/icons'
import { TermDomainBadge } from '@/components/catalogue/catalogue-marks'
import { Badge } from '@/components/ui/badge'
import type { MentionOption } from '@/lib/mention-targets'
import { chipDiff, type DiffKind } from '@/lib/field-diff'
import {
  modelMembers,
  termDiff,
  termRowNames,
  type TermRowId,
  type VocabularyTerm,
} from '@/lib/term-diff'
import { cn } from '@/lib/utils'
import { DiffTable, DiffTableRow, TextSide, UnchangedFields } from './field-diff'

/*
  A proposed term against the term in service (FR-125), in the same frame as an item's field
  diff: a change shows only the fields it changes, the term in service beside the proposed one;
  a new term shows the fields it sets, in one column. The name is a word diff, other names are
  chips added and removed, the domain is its badge, and the model link is the member's name in
  the model. Nothing is shown for a field that is empty on both sides.
*/

// The kinds of a name as the Catalogue says them: only an admin decides a proposed name.
const kindLook: Record<VocabularyTerm['kind'], { name: string; glyph: Icon }> = {
  metric: { name: 'Metric', glyph: SigmaIcon },
  metric_group: { name: 'Metric group', glyph: LayersIcon },
  // eslint-disable-next-line heed/plain-words -- a kind of name, as the Catalogue and Administration say it
  dimension: { name: 'Dimension', glyph: SplitIcon },
  // eslint-disable-next-line heed/plain-words -- a kind of name, as the Catalogue and Administration say it
  dimension_value: { name: 'Value of a dimension', glyph: TagIcon },
}

const rowIcons: Record<TermRowId, Icon> = {
  kind: ShapesIcon,
  name: TypeIcon,
  aliases: TagIcon,
  parent: SplitIcon,
  domain: HeedDomainIcon,
  model: LayersIcon,
}

function Quiet({ children }: { children: string }) {
  return <span className="text-dense text-muted-foreground">{children}</span>
}

/** An other name as a chip: plain when it stays, signed and tinted when it comes or goes. */
function NameChip({ name, kind }: { name: string; kind: DiffKind }) {
  const changed = kind !== 'same'
  return (
    <Badge
      form={changed ? 'soft' : 'outline'}
      tone={kind === 'added' ? 'success' : kind === 'removed' ? 'danger' : 'neutral'}
      icon={kind === 'added' ? PlusIcon : kind === 'removed' ? MinusIcon : undefined}
      data-diff={changed ? kind : undefined}
      className={cn(kind === 'removed' && '[&_[data-slot=badge-label]]:line-through')}
    >
      {changed ? (
        <span className="sr-only">{kind === 'added' ? 'Added: ' : 'Removed: '}</span>
      ) : null}
      {name}
    </Badge>
  )
}

function Side({
  id,
  term,
  other,
  which,
  areas,
  targets,
  change,
}: {
  id: TermRowId
  term: VocabularyTerm
  /** The other side, for what changed; the same term for a new one. */
  other: VocabularyTerm
  which: 'before' | 'after'
  areas: readonly Area[]
  targets: ReadonlyMap<string, MentionOption>
  change: boolean
}) {
  switch (id) {
    case 'kind': {
      const { name, glyph: Glyph } = kindLook[term.kind]
      return (
        <span className="inline-flex items-center gap-2 text-body">
          <Glyph aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {name}
        </span>
      )
    }
    case 'name':
      return change ? (
        <TextSide
          before={which === 'before' ? term.name : other.name}
          after={which === 'after' ? term.name : other.name}
          which={which}
          targets={targets}
        />
      ) : (
        <span className="text-body font-bold">{term.name}</span>
      )
    case 'aliases': {
      const before = which === 'before' ? term.aliases : other.aliases
      const after = which === 'after' ? term.aliases : other.aliases
      const diff = change ? chipDiff(before, after) : chipDiff(after, after)
      const chips = which === 'before' ? diff.before : diff.after
      return chips.length ? (
        <ul aria-label="Other names" className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li key={chip.key}>
              <NameChip name={chip.key} kind={chip.kind} />
            </li>
          ))}
        </ul>
      ) : (
        <Quiet>None</Quiet>
      )
    }
    case 'parent':
      return term.parentKey ? (
        <span className="text-body">{targets.get(term.parentKey)?.name ?? term.parentKey}</span>
      ) : (
        <Quiet>None</Quiet>
      )
    case 'domain': {
      const area = areas.find((candidate) => candidate.id === term.areaId)
      const kind = term.kind === 'dimension' || term.kind === 'dimension_value'
      return (
        <TermDomainBadge
          name={area?.name ?? (kind ? 'All domains' : 'No domain')}
          label={area?.label ?? null}
          none={area ? null : kind ? 'dimension' : 'metric'}
        />
      )
    }
    case 'model': {
      const members = modelMembers(term.definitionRefs, change ? other.definitionRefs : [])
      return members.length ? (
        <span className="flex flex-col font-mono text-dense break-all" translate="no">
          {members.map((member) => (
            <span key={member}>{member}</span>
          ))}
        </span>
      ) : (
        <Quiet>Not linked</Quiet>
      )
    }
  }
}

/** What changed in a term: the rows that changed, or what a new term sets. */
export function TermDiff({
  term,
  areas,
  targets,
}: {
  term: NonNullable<{ before: VocabularyTerm | null; after: VocabularyTerm }>
  areas: readonly Area[]
  targets: ReadonlyMap<string, MentionOption>
}) {
  const { before, after } = term
  const { rows, unchanged } = termDiff(before, after)
  const change = before !== null
  if (!rows.length)
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-lg border bg-card px-4 py-3 text-dense text-muted-foreground">
          Nothing changed. The proposal keeps the name as it is.
        </p>
        <UnchangedFields names={unchanged} />
      </div>
    )
  return (
    <div className="flex flex-col gap-3">
      <DiffTable
        label={change ? 'What changed' : 'The new name'}
        slot="term-diff"
        before={change ? 'Today' : null}
        after={change ? 'Proposed' : 'New name'}
      >
        {rows.map((id) => (
          <DiffTableRow
            key={id}
            row={id}
            name={termRowNames[id]}
            icon={rowIcons[id]}
            before={
              before ? (
                <Side
                  id={id}
                  term={before}
                  other={after}
                  which="before"
                  areas={areas}
                  targets={targets}
                  change
                />
              ) : undefined
            }
            after={
              <Side
                id={id}
                term={after}
                other={before ?? after}
                which="after"
                areas={areas}
                targets={targets}
                change={change}
              />
            }
          />
        ))}
      </DiffTable>
      <UnchangedFields names={unchanged} />
    </div>
  )
}
