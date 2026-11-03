import {
  BookOpenIcon,
  CloudIcon,
  DatabaseIcon,
  FileTextIcon,
  GitBranchIcon,
  ListIcon,
  PlugIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import type { Connector, ConnectorIcon } from '@/model/integrations'

/** The picture of each kind a connector's manifest may name. */
const pictures: Record<ConnectorIcon, typeof PlugIcon> = {
  database: DatabaseIcon,
  git: GitBranchIcon,
  file: FileTextIcon,
  list: ListIcon,
  cloud: CloudIcon,
  book: BookOpenIcon,
}

/**
 * A tool's real logo in a white tile, so it reads the same in light and dark. A tool the app has
 * no logo for shows the picture its manifest names, in a tile of the theme's own, or a plug.
 */
export function ToolLogo({
  c,
  size = 'md',
  className,
}: {
  c: Pick<Connector, 'logo' | 'icon'> | undefined
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const Picture = c?.icon ? pictures[c.icon] : PlugIcon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center border',
        c?.logo ? 'bg-logo-plate' : 'bg-muted text-muted-foreground',
        size === 'sm' && 'size-5 rounded-tile p-0.75',
        size === 'md' && 'size-8 rounded-md p-1.5',
        size === 'lg' && 'size-11 rounded-lg p-2',
        className,
      )}
    >
      {c?.logo ? (
        <img src={c.logo} alt="" className="size-full object-contain" />
      ) : (
        <Picture aria-hidden className="size-full" />
      )}
    </span>
  )
}
