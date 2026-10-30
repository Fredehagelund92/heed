// The documentation's pages, read at build time (scripts/docs-plugin.ts).
declare module 'virtual:help-docs' {
  import type { Docs } from '@domain/docs'
  const docs: Docs
  export default docs
}

// Each page's title by its slug, without the pages (scripts/docs-plugin.ts).
declare module 'virtual:help-docs-titles' {
  const titles: Record<string, string>
  export default titles
}
