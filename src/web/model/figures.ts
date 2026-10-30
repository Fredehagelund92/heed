import type { FigureTryFailure } from '@contract/figures'
import type { ConnectorId } from './integrations'

// A figure in Ask as the app reads it (src/web/api): read from an integration at a time,
// unchanged, and never context: nobody here checked it.

export type Figure = {
  /** What was counted, said as people say it: "Orders in Norway, 1 to 31 Aug 2026". */
  label: string
  value: string
  /** The comparison: "down 89% from July (€412,600)". */
  change?: string
  /** The query, in words first. */
  words: string
  /** It does not fit a context item: the item, and the figure in one sentence. */
  against?: { contextId: string; figureSays: string }
}

export type FigureView =
  /** Figures are off for its source: a link into the tool instead, at its own address if known. */
  | { kind: 'link'; source: ConnectorId; scope: string; href?: string }
  /** One figure line. */
  | { kind: 'line'; source: ConnectorId; figure: Figure; asOf: string }
  /** A figure that does not fit a context item: both shown, no verdict. */
  | { kind: 'against'; source: ConnectorId; figure: Figure; asOf: string }
  /** It can't be answered from data: why, and the metrics closest to it. */
  | { kind: 'none'; why: string; closest: string[] }

/** What an answer asks of the data: its metric, markets and days, its state and its items. */
export type FigureAsk = {
  metric: string
  markets: string[]
  dates?: string
  state: string
  /** The answer's context items: a figure someone said doesn't fit one shows beside it. */
  sources?: string[]
}

/** A figure that doesn't fit a context item, as a report names it, and who hears about it. */
export type FigureReport = {
  source: ConnectorId
  to: 'owners' | 'contact' | 'both'
  metric: string
  markets: string[]
  dates?: string
}

/**
 * What Try a figure read, with the figures settings as they are saved: one measure of the tool's
 * first view with a single date, for the last 7 days, kept nowhere. Its value is null when the
 * tool answered with nothing for those days; a failure is a code the page says in words.
 */
export type FigureTry =
  | {
      kind: 'figure'
      source: ConnectorId
      /** What was read and for which days: "Orders, 17 to 23 Oct 2026". */
      label: string
      /** As the tool writes it: "€1,234"; null when it had nothing for those days. */
      value: string | null
      /** When the tool last refreshed its data: "today at 06:00". */
      asOf: string
      /** How long the read took, in milliseconds. */
      took: number
    }
  | { kind: 'failed'; source: ConnectorId; failure: FigureTryFailure }
