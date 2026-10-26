import type { ConnectorId } from './integrations'

// A figure in Ask as the app reads it (src/app/api): read from an integration at a time,
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
  /** Figures are off for its source: a link into the tool instead. */
  | { kind: 'link'; source: ConnectorId; scope: string }
  /** One figure line. */
  | { kind: 'line'; source: ConnectorId; figure: Figure; asOf: string }
  /** A figure that does not fit a context item: both shown, no verdict. */
  | { kind: 'against'; source: ConnectorId; figure: Figure; asOf: string }
  /** It can't be answered from data: why, and the metrics closest to it. */
  | { kind: 'none'; why: string; closest: string[] }
