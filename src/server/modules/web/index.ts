/**
 * The public web, for a draft from what someone saw: reading a page a person links when they
 * write context from its address. Heed reaches public https addresses only and keeps no copy of a
 * page (FR-116).
 */
export {
  createPageReader,
  PageReadError,
  readableAddress,
  type PageRead,
  type PageReader,
  type PageReaderOptions,
  type ReadFailure,
} from './read.ts'
export { charsetOf, decodeEntities, decodePage, pageText } from './page-text.ts'
