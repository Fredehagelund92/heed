import * as React from "react"
import { and } from "@/lib/utils"
import {
  ArchiveIcon,
  ArrowLeftRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  MessageSquareIcon,
  MessageSquareWarningIcon,
  PencilIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"
import { DockFrame, DockMissing, PeekBar } from "@/components/dock"
import { DockStepper } from "@/components/heed/list"
import { historyOf } from "@/data/history"
import { PeekAttention, PeekBand, PeekBands, PeekDetails, PeekFact, PeekFacts, PeekLink, PeekMeaning, PeekTitle } from "@/components/heed/peek"
import { Button } from "@/components/ui/button"
import { cards } from "@/data/inbox"
import { domains, factById, kindLabel, ownersOf } from "@/data/world"
import { Related } from "@/components/heed/related"
import { useRelated } from "@/hooks/use-related"
import { countComments } from "@/components/templates/comment-box/utils"
import { closeDock, openDock } from "@/lib/dock"
import { useComments } from "@/lib/comments"
import { href, navigate, useRoute } from "@/lib/router"
import { useFact, useMe, useStore } from "@/lib/store"
import { MentionText } from "@/components/heed/mention-chip"
import { WhereChip } from "@/components/heed/tag-chip"

// The context quick view: the note and one closed Details. Title once, the words, its domain, who
// owns it and whether it is still right, where it comes from, the one action. One attention line only when a
// decision is needed (a flag, an overlap, an overdue check), with one button; the choice itself is
// made on the page. What agents get, history and the full source are not here.

export function FactPeek({ id }: { id: string }) {
  const fact = useFact(id)
  const me = useMe()
  const { state, dispatch } = useStore()
  const { query } = useRoute()
  const comments = useComments(`context:${id}`)
  const related = useRelated(`context:${id}`)
  const flagCard = cards.find((c) => c.id === query.get("flag"))
  // Opened here counts as read: only items someone opened can be marked checked together.
  const found = !!fact
  React.useEffect(() => {
    if (found) dispatch({ type: "viewedFact", id })
  }, [found, id, dispatch])
  if (!fact)
    return (
      <DockFrame title="Context">
        <DockMissing>This context item isn't in Context any more. Close the panel and search for it by name.</DockMissing>
      </DockFrame>
    )
  const owner = me.owns.includes(fact.domain) || me.admin
  const owners = ownersOf(fact)
  const page = `/context/${fact.id}`
  const overlap = fact.disagreesWith ? factById(fact.disagreesWith) : undefined
  const flag = flagCard?.flag && !state.done[flagCard.id] ? flagCard : undefined
  const stale = fact.status === "Needs checking" || !!fact.outOfDate
  const question = `What should I know about ${fact.where[0]?.toLowerCase() ?? "this"}${fact.where[1] ? ` in ${fact.where[1]}` : ""}?`
  const nComments = countComments(comments)

  // One decision at most, the most pressing first.
  const attention = flag ? (
    <PeekAttention
      icon={MessageSquareWarningIcon}
      action={
        owner && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              dispatch({ type: "complete", card: flag.id, outcome: "Not a problem" })
              toast("Report closed", { description: "The context item stays as it is." })
              closeDock()
            }}
          >
            Not a problem
          </Button>
        )
      }
    >
      Reported {flag.flag!.reason}, {flag.flag!.when}: “{flag.flag!.note}”
    </PeekAttention>
  ) : overlap ? (
    <PeekAttention
      icon={ArrowLeftRightIcon}
      action={
        <Button variant="outline" size="sm" onClick={() => navigate(page)}>
          Compare
        </Button>
      }
    >
      Disagrees with “{overlap.title}”.
    </PeekAttention>
  ) : stale && fact.status !== "Archived" ? (
    <PeekAttention
      icon={TriangleAlertIcon}
      action={
        owner && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              dispatch({ type: "editFact", id: fact.id, patch: { status: "Live", outOfDate: undefined, checkedOn: "23 Oct 2026", checkedBy: me.name } })
              toast("Checked: still true", { description: "Checked today. The next check is due in 90 days." })
            }}
          >
            Still true
          </Button>
        )
      }
    >
      {fact.outOfDate ?? "Its check date has passed."}
    </PeekAttention>
  ) : null

  return (
    <DockFrame
      title="Context"
      quietTitle
      actions={
        <PeekBar onExpand={() => navigate(page)}>
          <DockStepper list="context" id={fact.id} onGo={(next) => openDock("context", next)} />
        </PeekBar>
      }
      footer={
        owner ? (
          <Button size="sm" nativeButton={false} render={<a href={href(`${page}/edit`)} />}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        ) : (
          <Button size="sm" nativeButton={false} render={<a href={href(`${page}/suggest`)} />}>
            <PencilIcon data-icon="inline-start" />
            Suggest a change
          </Button>
        )
      }
    >
      <PeekBands>
        <PeekBand first>
          <PeekTitle>{fact.title}</PeekTitle>
          <PeekMeaning>
            <p>
              <MentionText text={fact.summary} />
            </p>
          </PeekMeaning>
          {attention}
        </PeekBand>
        <PeekBand label="Who owns it and where it comes from">
          <PeekFacts>
            {fact.status === "Archived" ? (
              <PeekFact icon={ArchiveIcon}>
                <b>{domains[fact.domain].name}</b> - archived, agents don't get it
              </PeekFact>
            ) : fact.status === "Draft" ? (
              <PeekFact icon={CircleDashedIcon}>
                <b>{domains[fact.domain].name}</b> - a draft
                {fact.by && (
                  <>
                    {" "}
                    by <b>{fact.by}</b>
                  </>
                )}
                , agents don't get it until it is published
              </PeekFact>
            ) : (
              <PeekFact icon={CircleCheckIcon}>
                <b>{domains[fact.domain].name}</b> - owned by <b>{and(owners)}</b> - checked {fact.checkedOn}
              </PeekFact>
            )}
            {fact.source && (
              <PeekFact icon={ExternalLinkIcon}>
                <a href={fact.source} target="_blank" rel="noreferrer" className="font-medium break-all text-primary underline-offset-4 hover:underline">
                  {fact.source.replace("https://", "")}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </PeekFact>
            )}
          </PeekFacts>
        </PeekBand>
        <PeekBand flush>
          <PeekDetails
            rows={[
              [
                "Applies to",
                fact.where.length ? (
                  <span key="w" className="flex flex-wrap gap-1">
                    {fact.where.map((w) => (
                      <WhereChip key={w} w={w} />
                    ))}
                  </span>
                ) : (
                  "Read from the text"
                ),
              ],
              ["When", fact.when],
              ["Kind", kindLabel[fact.kind]],
              ["Status", fact.status],
              ...(fact.dontConclude ? ([["Don't conclude", fact.dontConclude]] as [string, string][]) : []),
              ...(related.length ? ([["Related", <Related key="v" id={`context:${fact.id}`} />]] as [string, React.ReactNode][]) : []),
              ...(fact.quote
                ? ([
                    [
                      "Quote",
                      <span key="v" className="block border-l-2 pl-3 text-muted-foreground italic">
                        {fact.quote}
                      </span>,
                    ],
                  ] as [string, React.ReactNode][])
                : []),
              ...(fact.origin ? ([["From", `${fact.origin.tool}: ${fact.origin.folder} / ${fact.origin.doc}, read ${fact.origin.read}`]] as [string, string][]) : []),
            ]}
            links={[
              <PeekLink key="history" icon={ClockIcon} href={href(page)}>
                History: {historyOf(fact, state.log).length} versions
              </PeekLink>,
              <PeekLink key="comments" icon={MessageSquareIcon} href={href(page)}>
                {nComments ? `Comments: ${nComments}` : "Comments"}
              </PeekLink>,
              <PeekLink key="try" icon={FlaskConicalIcon} onClick={() => openDock("ask", undefined, { q: question })}>
                Try it with a question
              </PeekLink>,
            ]}
          />
        </PeekBand>
      </PeekBands>
    </DockFrame>
  )
}
