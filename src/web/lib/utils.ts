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

/**
 * A time label inside a sentence: "Today, 09:31" reads "today, 09:31" and "Since 2 Oct" reads
 * "since 2 Oct", while a date keeps its month as written: "23 Oct", never "23 oct".
 */
export const midSentence = (label: string) =>
  label.replace(/^[A-Z][a-z]*\b/, (w) => w.toLowerCase())
