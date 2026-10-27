import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { parse } from 'yaml'
import { docsFolder, type DocFile, type Docs } from '../src/domain/docs.ts'
import { readDocs } from './docs-read.ts'

/*
  The documentation's pages (docs/help) for the app, the static docs site and their tests, read
  once at build time into the page model (src/domain/docs.ts), so neither carries a Markdown
  reader. `import docs from 'virtual:help-docs'` gives the pages and What's new; a page that
  cannot be read fails the build with its reason.
*/

const id = 'virtual:help-docs'
const resolved = `\0${id}`
const folder = fileURLToPath(new URL(`../${docsFolder}/`, import.meta.url))

/** Every page's file, by its slug. README.md is about the pages, not one of them. */
export function docFiles(): DocFile[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => ({
      slug: name.replace(/\.md$/, ''),
      source: readFileSync(join(folder, name), 'utf8'),
    }))
}

export function loadDocs(files = docFiles()): Docs {
  const read = readDocs(files, (yaml) => parse(yaml))
  if (!read.ok) throw new Error(`${docsFolder}/${read.reason}`)
  return read.value
}

export function helpDocs(): Plugin {
  return {
    name: 'heed:help-docs',
    resolveId: (source) => (source === id ? resolved : undefined),
    load(module) {
      if (module !== resolved) return
      for (const file of readdirSync(folder)) this.addWatchFile(join(folder, file))
      return `export default ${JSON.stringify(loadDocs())}`
    },
    // A page saved while the app runs shows at once.
    configureServer(server) {
      server.watcher.add(folder)
      const reload = (path: string) => {
        if (!path.startsWith(folder)) return
        const module = server.moduleGraph.getModuleById(resolved)
        if (!module) return
        server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('change', reload)
      server.watcher.on('add', reload)
      server.watcher.on('unlink', reload)
    },
  }
}
