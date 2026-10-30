import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { CHANGELOG, llmsFullTxt, llmsTxt } from '../src/domain/docs.ts'
import { docFiles, loadDocs } from './docs-plugin.ts'
import { docsBase } from '../vite.docs.config.ts'

/*
  npm run docs:build: the documentation (docs/help) as a static site in dist/docs, to host on
  its own or beside the app. Every page is drawn ahead of time, so it reads with no script; the
  script that follows adds the search. Beside the pages: llms.txt, the index an agent reads, and
  llms-full.txt, every page as Markdown in one file. `npm run docs:preview` serves the result.
*/

const root = fileURLToPath(new URL('..', import.meta.url))
const configFile = join(root, 'vite.docs.config.ts')
const out = join(root, 'dist/docs')
const ssrOut = join(root, 'dist/docs-render')

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

await build({ configFile, logLevel: 'warn' })
await build({
  configFile,
  logLevel: 'warn',
  build: { ssr: join(root, 'src/web/docs/render.tsx'), outDir: ssrOut, emptyOutDir: true },
})

/** What src/web/docs/render.tsx gives, once built. */
type Render = {
  slugs: (string | undefined)[]
  headOf: (slug: string | undefined) => { title: string; line: string }
  render: (slug: string | undefined) => string
}
const { headOf, render, slugs } = (await import(
  pathToFileURL(join(ssrOut, 'render.js')).href
)) as Render

const template = readFileSync(join(out, 'index.html'), 'utf8')
for (const slug of slugs) {
  const { title, line } = headOf(slug)
  const html = template
    .replace(/<title>Docs - (.*?)<\/title>/, (_all, product: string) =>
      slug
        ? `<title>${escape(title)} - Docs - ${product}</title>`
        : `<title>Docs - ${product}</title>`,
    )
    .replace(
      '<!--docs-head-->',
      [
        `<meta name="description" content="${escape(line)}" />`,
        `<link rel="alternate" type="text/plain" title="The docs for agents" href="${docsBase}/llms.txt" />`,
      ].join('\n    '),
    )
    .replace('<!--docs-page-->', () => render(slug))
  const file = join(out, slug ? `${slug}.html` : 'index.html')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
}

const files = docFiles()
const docs = loadDocs(files)
writeFileSync(join(out, 'llms.txt'), llmsTxt(docs, docsBase))
writeFileSync(join(out, 'llms-full.txt'), llmsFullTxt(docs, files, docsBase))
rmSync(ssrOut, { recursive: true, force: true })

console.log(
  `The docs: ${docs.pages.length} pages and ${docs.changelog.title} (${CHANGELOG}.html), llms.txt and llms-full.txt, in dist/docs, served under ${docsBase || '/'}.`,
)
