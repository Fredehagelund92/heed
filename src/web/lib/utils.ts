import { createCn } from 'cn/engine'
import tables from './cn-tables.gen'

/**
 * The class merge helper, taught the design contract's names (tokens.css): cn-config.ts holds
 * them, and cn-tables.gen.ts is the tables compiled from it, so the first load carries no config
 * compiler. Every component imports `cn` from here.
 */
export const cn = createCn(tables)
