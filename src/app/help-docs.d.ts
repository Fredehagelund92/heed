// The documentation's pages, read at build time (scripts/docs-plugin.ts).
declare module 'virtual:help-docs' {
  import type { Docs } from '@domain/docs'
  const docs: Docs
  export default docs
}
