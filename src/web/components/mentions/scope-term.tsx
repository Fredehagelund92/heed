import { SigmaIcon, SplitIcon } from '@/components/icons'
import { anyValueInSentence, anyValueWords } from '@/lib/library-core'
import { cn } from '@/lib/utils'

/*
  How one term of an item's scope reads, wherever it is shown: a metric by its name, a value with
  its dimension before it ("Market Norway"), and a dimension with any value as "Market any
  value" (FR-126). The same words go to a screen reader, with what the term is.
*/

export type ScopeTermView = {
  kind: 'metric' | 'dimension' | 'dimension_value'
  name: string
  /** The dimension of a value. */
  dimensionName?: string | null
}

/** The kind of a stored scope key, from its prefix. */
export function scopeTermKind(key: string): ScopeTermView['kind'] {
  return key.startsWith('dim:')
    ? 'dimension'
    : key.startsWith('val:')
      ? 'dimension_value'
      : 'metric'
}

const kindWords: Record<ScopeTermView['kind'], string | null> = {
  metric: 'metric',
  dimension: null,
  dimension_value: 'value',
}

/** What a screen reader says: "Orders, metric", "Norway, Market value", "Any market". */
export function scopeTermSpoken(term: ScopeTermView): string {
  if (term.kind === 'dimension') return anyValueWords(term.name)
  if (term.kind === 'dimension_value')
    return term.dimensionName ? `${term.name}, ${term.dimensionName} value` : `${term.name}, value`
  return `${term.name}, metric`
}

/** The words of a scope term as a sentence fragment: "Orders", "Market Norway", "any market". */
export function scopeTermWords(term: ScopeTermView): string {
  if (term.kind === 'dimension') return anyValueInSentence(term.name)
  if (term.kind === 'dimension_value' && term.dimensionName)
    return `${term.dimensionName} ${term.name}`
  return term.name
}

/**
 * The visible label: a sigma and the name for a metric, the dimension quiet and the value bold,
 * and a split mark and "Any market" in bold for a dimension with any value. The
 * spoken words are in the text, so a chip is never told by its look alone.
 */
export function ScopeTermLabel({ term, className }: { term: ScopeTermView; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      {term.kind === 'metric' ? (
        <SigmaIcon aria-hidden="true" className="size-icon-sm shrink-0 text-muted-foreground" />
      ) : term.kind === 'dimension' ? (
        <SplitIcon aria-hidden="true" className="size-icon-sm shrink-0 text-muted-foreground" />
      ) : null}
      <span className="min-w-0 truncate">
        {term.kind === 'metric' ? (
          term.name
        ) : term.kind === 'dimension' ? (
          <b className="font-bold">{anyValueWords(term.name)}</b>
        ) : (
          <>
            {term.dimensionName ? (
              <>
                <span className="text-muted-foreground">{term.dimensionName}</span>{' '}
              </>
            ) : null}
            <b className="font-bold">{term.name}</b>
          </>
        )}
        {kindWords[term.kind] ? (
          <span className="sr-only">{`, ${kindWords[term.kind]}`}</span>
        ) : null}
      </span>
    </span>
  )
}
