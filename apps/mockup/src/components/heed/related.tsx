import { MentionChip } from "@/components/heed/mention-chip"
import { domains } from "@/data/world"
import { relLabel, type Link } from "@/lib/links"
import { useRelated } from "@/hooks/use-related"
import { useLinksEnabled } from "@/lib/links-switch"

// Related: what an agent can follow from here with get_related, so people see it too. The links
// written in the text, both ways, and the two relations an owner sets (replaces, disagrees with),
// each as the shared mention chip with its type icon. A retired target says it is not followed; a
// definition another domain owns says whose it is.

function LinkLine({ link }: { link: Link }) {
  const typed = link.rel === "replaces" || link.rel === "replaced_by" || link.rel === "disagrees"
  const note = link.to.retired ? "not followed" : link.otherDomain && link.to.domain ? `from ${domains[link.to.domain].name}` : undefined
  // The relation before the chip, a note under it: both belong to this link, never to the next one.
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-1.5">
        {typed && <span className="shrink-0 text-xs text-muted-foreground">{relLabel[link.rel]}</span>}
        <MentionChip mention={{ id: link.to.id, label: link.to.label }} className="min-w-0" />
      </span>
      {note && <span className="pl-1 text-xs text-muted-foreground">{note}</span>}
    </li>
  )
}

/** Links to and linked from, in the fixed order agents follow them; nothing when there are none. */
export function Related({ id }: { id: string }) {
  const links = useRelated(id)
  const enabled = useLinksEnabled()
  if (!links.length) return null
  const out = links.filter((l) => l.rel !== "mentioned_by" && l.rel !== "replaced_by")
  const back = links.filter((l) => l.rel === "mentioned_by" || l.rel === "replaced_by")
  return (
    <div className="flex min-w-0 flex-col gap-2 py-1">
      {out.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">Links to</p>
          <ul aria-label="Links to" className="flex flex-col gap-2">
            {out.map((l) => (
              <LinkLine key={l.to.id} link={l} />
            ))}
          </ul>
        </div>
      )}
      {back.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">Linked from</p>
          <ul aria-label="Linked from" className="flex flex-col gap-2">
            {back.map((l) => (
              <LinkLine key={l.to.id} link={l} />
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {enabled
          ? "An agent can follow these, one step at a time. It never changes what an answer includes, and never reads comments."
          : "Agents don't follow links: it is switched off in Agents and access."}
      </p>
    </div>
  )
}
