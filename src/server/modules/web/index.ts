/**
 * The public web, for the assistant's drafts from what people saw: reading a page a person
 * linked (read_source) and searching once an administrator turns it on (search_web). Heed reaches
 * public https addresses only and keeps no copy of a page (FR-116).
 */
export {
  createPageReader,
  PageReadError,
  readableAddress,
  readFailures,
  type PageRead,
  type PageReader,
  type PageReaderOptions,
  type ReadFailure,
} from './read.ts'
export { charsetOf, decodeEntities, decodePage, pageText, passages } from './page-text.ts'
export { isOfficial } from './official.ts'
export { searchWeb, searchWordsProblem, type SearchResult } from './search.ts'
