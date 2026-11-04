import { MentionChip } from '@/components/heed/mention-chip'
import { Mark } from '@/components/heed/mark'
import { relLabel, type Link } from '@/lib/links'
import { useRelated } from '@/hooks/use-related'
import { cn } from '@/lib/utils'

// Related: what an agent can follow from here with get_related, so people see it too. Two groups,
// Links to and Linked from, one clean line per link: the relation an owner set (replaces, replaced
// by, disagrees with), the shared mention chip with its type icon, and the word Archived when the
// target is. Nothing else: the chip opens the target, and that view says the rest.

const relWord = (link: Link) => {
  const word = relLabel[link.rel]
  return word.charAt(0).toUpperCase() + word.slice(1)
}

const typed = (link: Link) =>
  link.rel === 'replaces' || link.rel === 'replaced_by' || link.rel === 'disagrees'

/**
 * `mark`: this is the link that needs a look, an item that says something else (one per list).
 * `lead`: a link of the group has a relation, so every chip starts after the longest word.
 */
function LinkLine({ link, mark, lead }: { link: Link; mark?: boolean; lead: boolean }) {
  return (
    <li
      className={cn(
        'min-h-7 min-w-0 items-center pointer-coarse:min-h-11',
        lead ? 'col-span-full grid grid-cols-subgrid' : 'flex',
      )}
    >
      {lead &&
        (typed(link) ? (
          mark ? (
            <Mark role="needs" className="w-fit text-xs">
              {relWord(link)}
            </Mark>
          ) : (
            <span className="text-xs text-muted-foreground">{relWord(link)}</span>
          )
        ) : (
          <span />
        ))}
      <span className="flex min-w-0 items-center gap-2">
        <MentionChip mention={{ id: link.to.id, label: link.to.label }} className="min-w-0" />
        {link.to.retired && link.to.kind === 'context' && (
          <span className="shrink-0 text-xs text-muted-foreground">Archived</span>
        )}
      </span>
    </li>
  )
}

function LinkGroup({ name, links }: { name: string; links: Link[] }) {
  // An item that disagrees with this one needs a look: the first such link is marked.
  const disagrees = links.find((l) => l.rel === 'disagrees')
  const lead = links.some(typed)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs font-semibold text-muted-foreground">{name}</p>
      <ul
        aria-label={name}
        className={cn(lead ? 'grid grid-cols-(--cols-lead-auto) gap-x-2.5' : 'flex flex-col')}
      >
        {links.map((l) => (
          <LinkLine key={l.to.id} link={l} mark={l === disagrees} lead={lead} />
        ))}
      </ul>
    </div>
  )
}

/** Links to and linked from, in the fixed order agents follow them; nothing when there are none. */
export function Related({ id }: { id: string }) {
  const { links, following } = useRelated(id)
  if (!links.length) return null
  const out = links.filter((l) => l.rel !== 'mentioned_by' && l.rel !== 'replaced_by')
  const back = links.filter((l) => l.rel === 'mentioned_by' || l.rel === 'replaced_by')
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {out.length > 0 && <LinkGroup name="Links to" links={out} />}
      {back.length > 0 && <LinkGroup name="Linked from" links={back} />}
      {!following && (
        <p className="text-xs text-muted-foreground">
          Agents don&apos;t follow links: it is switched off in Agents and access.
        </p>
      )}
    </div>
  )
}
