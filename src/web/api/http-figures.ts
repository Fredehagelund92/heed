/**
 * Figures in Ask on the Heed service (FR-716): what `figures.read` answers, as an answer shows it
 * (src/web/model/figures.ts), and the days an answer names, back as the days the service reads.
 * The service decides which integration answers, reads the figure and keeps it nowhere; the words
 * here say it as the mock's fixtures do: what was counted, the number and how it moved, from where
 * and how fresh.
 */
import type { FigureRead, FigureTry as FigureTried } from '@contract/figures'
import { comparisonWords, daysWords, type Days } from '@domain/figures'
import type { Figure, FigureTry, FigureView } from '@/model/figures'
import type { ConnectorId } from '@/model/integrations'

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
const pad = (n: number) => String(n).padStart(2, '0')
const day = (d: string, month: string, year: string) => {
  const m = MONTHS.indexOf(month)
  return m < 0 ? null : `${year}-${pad(m + 1)}-${pad(Number(d))}`
}

/**
 * The days an answer names, as the service reads them: "1 to 31 Aug 2026", "1 Jul to 30 Sep
 * 2026", "30 Dec 2025 to 2 Jan 2026", "14 Oct 2026", or "from 9 May 2026" (to today). Null for
 * anything else.
 */
export function daysOfDates(dates: string | undefined, today: string): Days | null {
  if (!dates) return null
  const words = dates.trim()
  let m = /^(\d{1,2}) to (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(words)
  if (m) {
    const from = day(m[1]!, m[3]!, m[4]!)
    const to = day(m[2]!, m[3]!, m[4]!)
    return from && to ? { from, to } : null
  }
  m = /^(\d{1,2}) ([A-Z][a-z]{2}) to (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(words)
  if (m) {
    const from = day(m[1]!, m[2]!, m[5]!)
    const to = day(m[3]!, m[4]!, m[5]!)
    return from && to ? { from, to } : null
  }
  m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) to (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(words)
  if (m) {
    const from = day(m[1]!, m[2]!, m[3]!)
    const to = day(m[4]!, m[5]!, m[6]!)
    return from && to ? { from, to } : null
  }
  m = /^(from )?(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(words)
  if (m) {
    const from = day(m[2]!, m[3]!, m[4]!)
    if (!from) return null
    return { from, to: m[1] ? today : from }
  }
  return null
}

/** A figure as its integration writes it: "€43,600", "12.5%", "1,204". */
export function figureValue(
  value: number,
  format: Extract<FigureRead, { state: 'figure' }>['format'],
): string {
  if (format.kind === 'currency')
    try {
      return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: format.currency,
        maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
      }).format(value)
    } catch {
      // A currency code the browser doesn't know is written after the number.
      return `${value.toLocaleString('en-GB')} ${format.currency}`
    }
  if (format.kind === 'percent')
    return `${value.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 })
}

/** When the data was refreshed, as the line says it: "today at 06:00", "21 Oct at 06:00". */
export function asOfWords(iso: string, now: Date): string {
  const at = new Date(iso)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(now) - start(at)) / 86_400_000)
  if (days === 0) return `today at ${time}`
  if (days === 1) return `yesterday at ${time}`
  const year = at.getFullYear() === now.getFullYear() ? '' : ` ${at.getFullYear()}`
  return `${at.getDate()} ${MONTHS[at.getMonth()]}${year} at ${time}`
}

/** "down 89%", "up 4%", or "the same". */
const moved = (now: number, before: number) => {
  const pct = Math.round(((now - before) / before) * 100)
  return pct === 0 ? 'the same' : pct < 0 ? `down ${Math.abs(pct)}%` : `up ${pct}%`
}

/** The answer a figure belongs to: its metric, its markets and its days, as it shows them. */
type Asked = { metric: string; markets: string[]; dates?: string }

/** Why there is no figure, in words. */
function whyNot(read: Extract<FigureRead, { state: 'none' }>, metric: string, scope: string) {
  const tool = read.source?.tool ?? 'The integration'
  const what = metric.toLowerCase()
  switch (read.reason) {
    case 'undefined':
      return `No connected integration defines ${what}, so no figure is read for it.`
    case 'ambiguous':
      return `More than one integration defines ${what}, so none is picked to read it.`
    case 'no_date':
      return `${tool} has no single date for ${what}, so no figure is read for these days.`
    case 'no_split':
      return `${tool} can't split ${what} the way the question does, so no figure is read for it.`
    case 'no_value':
      return `${tool} returned no figure for ${scope}.`
    case 'failed':
      return read.failure === 'not_set_up'
        ? `Figures from ${tool} aren't set up yet: an admin sets the data endpoint and its token.`
        : `Couldn't read the figure from ${tool} just now. Ask again in a minute.`
  }
}

/**
 * What an answer shows of the data, from the service's read: one figure line, the figure beside
 * the context item someone said it doesn't fit, a link into the tool while figures are off, or
 * why there is none. Null when there is nothing to show.
 */
export function figureViewOf(
  read: FigureRead,
  asked: Asked,
  source: (type: string) => ConnectorId | undefined,
  now: Date,
): FigureView | null {
  const scope = `${asked.metric}${asked.markets.length ? ` in ${asked.markets.join(' and ')}` : ''}`
  if (read.state === 'none')
    return {
      kind: 'none',
      why: whyNot(read, asked.metric, `${scope}, ${asked.dates ?? ''}`),
      closest: [],
    }
  const id = source(read.source.type)
  if (!id) return null
  if (read.state === 'off')
    return read.link
      ? {
          kind: 'link',
          source: id,
          scope: `${scope}${asked.dates ? `, ${asked.dates}` : ''}`,
          href: read.link,
        }
      : null
  const days = { from: read.from, to: read.to }
  const value = figureValue(read.value, read.format)
  const before = read.comparison?.value
  const figure: Figure = {
    label: `${scope}, ${daysWords(days)}`,
    value,
    ...(before !== null && before !== undefined && before !== 0
      ? {
          change: `${moved(read.value, before)} from ${comparisonWords(days)} (${figureValue(before, read.format)})`,
        }
      : {}),
    words: read.queryInWords,
    ...(read.against
      ? {
          against: {
            contextId: read.against.itemId,
            figureSays: `${scope} from ${daysWords(days)} was ${value}.`,
          },
        }
      : {}),
  }
  const asOf = asOfWords(read.asOf, now)
  return read.against
    ? { kind: 'against', source: id, figure, asOf }
    : { kind: 'line', source: id, figure, asOf }
}

/**
 * What Try a figure read, as the integration's page says it: the measure and its days, the value as
 * the tool writes it (null when it had nothing for those days) and how fresh the data is, or the
 * failure's code. Null for a tool the app doesn't know.
 */
export function figureTryOf(
  tried: FigureTried,
  source: (type: string) => ConnectorId | undefined,
  now: Date,
): FigureTry | null {
  const id = source(tried.source.type)
  if (!id) return null
  if (tried.state === 'failed') return { kind: 'failed', source: id, failure: tried.failure }
  return {
    kind: 'figure',
    source: id,
    label: `${tried.measure.title}, ${daysWords(tried)}`,
    value: tried.value === null ? null : figureValue(tried.value, tried.format),
    asOf: asOfWords(tried.asOf, now),
    took: tried.took,
  }
}
