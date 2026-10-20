import { contentDigest } from '../../domain/canonical.ts'
import { defineRuntime, SourceError } from '../../domain/connector-runtime.ts'
import { manifest } from './manifest.ts'
import {
  parseStaticEntries,
  staticCheckReport,
  staticDomainOf,
  type StaticEntry,
} from './entries.ts'

interface Config {
  definitions: string
  domainNames?: Record<string, string>
}

const DESCRIPTION_MAX = 500
const domainId = /^[a-z][a-z0-9_]{1,39}$/

const entriesOf = (config: Config): StaticEntry[] => {
  const parsed = parseStaticEntries(config.definitions)
  // The core checks the settings with `parse` first; this is a list kept before a rule changed.
  if ('problem' in parsed)
    throw new SourceError({
      code: `${manifest.id}.unreadable_list`,
      target: 'definitions',
      class: 'config',
    })
  return parsed.entries
}

/** The runtime of the static list: it reads the settings it is given, nothing else. */
export const runtime = defineRuntime<Config>({
  parse(config) {
    const parsed = parseStaticEntries(config.definitions)
    return 'problem' in parsed ? [{ field: 'definitions', message: parsed.problem }] : []
  },

  check({ config }) {
    return Promise.resolve().then(() =>
      staticCheckReport(entriesOf(config), config.domainNames ?? {}),
    )
  },

  async *read({ config }) {
    const entries = entriesOf(config)
    const names = config.domainNames ?? {}
    for (const entry of entries) {
      const domain = staticDomainOf(entry, names)
      const areaHint = domain !== null && domainId.test(domain) ? domain : null
      if (domain !== null && areaHint === null)
        yield { type: 'warning', code: 'invalid_domain', target: entry.name }
      const description = entry.description === null ? null : [...entry.description]
      if (description && description.length > DESCRIPTION_MAX)
        yield { type: 'warning', code: `${manifest.id}.description_cut`, target: entry.name }
      // The mark is the meaning: what it is called and what it says, never where it sits.
      const meaning = {
        kind: entry.kind,
        name: entry.name,
        title: entry.title,
        description: entry.description,
        type: entry.type,
      }
      yield {
        type: 'definition',
        definition: {
          ref: `${manifest.refPrefix}:${entry.name}`,
          kind: entry.kind,
          name: entry.name,
          title: entry.title,
          descriptionCopy: description ? description.slice(0, DESCRIPTION_MAX).join('') : null,
          valueType: entry.type,
          visibleGroups: null,
          areaHint,
          domainSource: areaHint === null ? 'none' : 'source',
          modelFile: null,
          changeMark: await contentDigest(meaning),
        },
      }
    }
    yield { type: 'end', version: await contentDigest({ entries, names }), complete: true }
  },
})
