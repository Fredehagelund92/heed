import { createCn } from 'cn/engine'
import tables from './cn-tables.gen'

/**
 * The class merge helper, taught the app's token names: cn-config.ts holds them, and
 * cn-tables.gen.ts is the tables compiled from it, so the first load carries no config compiler.
 */
export const cn = createCn(tables)

/** "Ada", "Ada and Jon", "Ada, Bo and Jon". */
export const and = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]

/** The names of days and months, which keep their capital inside a sentence. */
const CALENDAR = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/

/**
 * A time label inside a sentence: "Today, 09:31" reads "today, 09:31" and "Since 2 Oct" reads
 * "since 2 Oct", while a day or a month keeps its name as written: "Tue 20 Oct", "23 Oct", never
 * "tue 20 Oct" or "23 oct".
 */
export const midSentence = (label: string) =>
  label.replace(/^[A-Z][a-z]*\b/, (w) => (CALENDAR.test(w) ? w : w.toLowerCase()))
