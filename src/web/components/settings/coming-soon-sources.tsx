import type { ConnectorManifest } from '@domain/connector-manifest'
import {
  BookOpenIcon,
  CloudIcon,
  DatabaseIcon,
  FileTextIcon,
  GitBranchIcon,
  ListIcon,
  type Icon,
} from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { comingSoonRequestUrl, comingSoonSources } from '@/lib/coming-soon-sources'
import { SettingsBlock } from './settings-parts'

/** A connector's picture, from the few its manifest may name; shared with the connector list. */
export const connectorIcons: Record<NonNullable<ConnectorManifest['icon']>, Icon> = {
  database: DatabaseIcon,
  git: GitBranchIcon,
  file: FileTextIcon,
  list: ListIcon,
  cloud: CloudIcon,
  book: BookOpenIcon,
}

const kindLabel: Record<ConnectorManifest['kind'], string> = {
  definitions: 'Definition source',
  content: 'Content source',
}

const inlineLink = 'text-brand-ink underline underline-offset-4 hover:decoration-2'

function RequestLink() {
  return (
    <a href={comingSoonRequestUrl} target="_blank" rel="noreferrer" className={inlineLink}>
      Tell us which one you need
      <span className="sr-only"> (opens GitHub in a new tab)</span>
    </a>
  )
}

/**
 * The tools planned but not built, on the Sources page. A plain list: nothing here can be added
 * or opened, and no date is promised.
 */
export function ComingSoonBlock() {
  return (
    <SettingsBlock
      title="Coming soon"
      slot="sources-coming-soon"
      description="Tools we plan to read from. You can't add them yet, and we haven't set a date."
    >
      <ul
        aria-label="Sources coming soon"
        className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card"
      >
        {comingSoonSources.map((source) => {
          const Glyph = connectorIcons[source.icon]
          return (
            <li
              key={source.id}
              data-coming-soon={source.id}
              className="flex min-w-0 items-start gap-4 px-4 py-3"
            >
              <span
                aria-hidden="true"
                className="flex size-control-lg shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground"
              >
                <Glyph className="size-5" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-body font-bold">{source.name}</span>
                  <Badge form="outline" size="sm" data-slot="coming-soon-kind">
                    {kindLabel[source.kind]}
                  </Badge>
                </span>
                <span className="text-dense text-muted-foreground">{source.summary}</span>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="max-w-reading text-dense text-muted-foreground">
        <RequestLink />. It opens a new request on GitHub.
      </p>
    </SettingsBlock>
  )
}

/** The short version for the Add a connector step: the names, and the way to ask. */
export function ComingSoonNote() {
  return (
    <p
      className="max-w-reading text-dense text-muted-foreground"
      data-slot="connectors-coming-soon"
    >
      Coming soon: {comingSoonSources.map((source) => source.name).join(', ')}. <RequestLink />.
    </p>
  )
}
