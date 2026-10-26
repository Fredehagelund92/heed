import type { CSSProperties } from 'react'
import type { Vocabulary } from '@/api'
import type { DomainId } from '@/model/items'
import type { Domains } from '@/model/people'

// One hue per kind of thing a chip names, and one per domain, so a tag reads at a glance in every
// place it appears (the editor, Details, the list, a mention, a filter). Colour is never the only
// cue: every chip also has its type's icon and its words.

export type Tone = 'neutral' | 'metric' | 'dimension' | 'market' | 'term' | 'domain' | 'warn'

export const toneHue: Record<Exclude<Tone, 'neutral' | 'domain'>, number> = {
  metric: 255,
  dimension: 210,
  market: 165,
  term: 300,
  warn: 70,
}

export const domainHue: Record<DomainId, number | null> = {
  sales: 255,
  marketing: 35,
  customer_value: 300,
  paid_media: 165,
  sandbox: null,
}

/** What a plain "applies to" word is: a metric, a market, a domain, or a word of the author's own. */
export function kindOfWhere(
  w: string,
  vocabulary: Vocabulary,
  domains: Domains,
): 'metric' | 'dimension' | 'market' | 'domain' | 'term' {
  if (vocabulary.metrics.some((m) => m.name === w)) return 'metric'
  if (vocabulary.markets.includes(w)) return 'market'
  if (vocabulary.dimensions.some((d) => d.name === w)) return 'dimension'
  if (Object.values(domains).some((d) => d.name === w)) return 'domain'
  return 'term'
}

export const domainIdByName = (name: string, domains: Domains) =>
  Object.values(domains).find((d) => d.name === name)?.id

const tinted = 'bg-chip text-chip-foreground'

/** A chip's tint as classes and its hue as a variable. */
export function chipTone(
  tone: Tone,
  hue?: number | null,
): { className: string; style?: CSSProperties } {
  const h = tone === 'domain' ? hue : tone === 'neutral' ? null : toneHue[tone]
  if (h === null || h === undefined) return { className: 'bg-muted text-foreground' }
  return { className: tinted, style: { '--chip-h': h } as CSSProperties }
}
