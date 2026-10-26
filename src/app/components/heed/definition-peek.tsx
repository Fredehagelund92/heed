import * as React from 'react'
import { ArrowLeftRightIcon, FlaskConicalIcon, LockIcon, PencilIcon, PlusIcon } from 'lucide-react'
import { cn } from 'cn'
import { DockFrame, DockMissing, PeekBar } from '@/components/dock'
import { AnotherNameFor, SynonymTags, TypeTile } from '@/components/heed/definition'
import { DockStepper } from '@/components/heed/list'
import {
  PeekAttention,
  PeekBand,
  PeekBands,
  PeekDetails,
  PeekFact,
  PeekFacts,
  PeekLabel,
  PeekLink,
  PeekMeaning,
  PeekTitle,
} from '@/components/heed/peek'
import { Button } from '@/components/ui/button'
import { domains } from '@/data/world'
import {
  conflictOf,
  contextAbout,
  cubeRef,
  findDefinition,
  kindName,
  meaningOf,
  sourceUrl,
  SYNCED_AT,
  synonymsOf,
  useDefinitions,
} from '@/lib/definitions'
import { openDock } from '@/lib/dock'
import { href, navigate } from '@/lib/router'
import { useFacts, useMe } from '@/lib/store'
import { MentionText } from '@/components/heed/mention-chip'
import { mentionId } from '@/lib/mentions'
import { Related } from '@/components/heed/related'
import { useRelated } from '@/hooks/use-related'
import { DEFINITIONS_TOOL } from '@/data/integrations'

// The definition quick view: the note and one closed Details, as the context one. Title once (with
// its type as the tile), the meaning, its domain and where it comes from in one quiet line (a
// synced item says read-only, when it was read and links to the source), the other words as one
// row, and the one action. A word that means two things is the one attention line.

export function DefinitionPeek({ name }: { name: string }) {
  useDefinitions()
  const facts = useFacts()
  const me = useMe()
  const d = findDefinition(name)
  const related = useRelated(d ? mentionId(d.type, d.name) : '')
  if (!d)
    return (
      <DockFrame title="Definition">
        <DockMissing>
          There is no definition by this name. It may have been renamed; search Definitions for it.
        </DockMissing>
      </DockFrame>
    )
  const subject = meaningOf(d)
  const target = d.sameAs ? findDefinition(d.sameAs) : undefined
  // A conflict on this word, or on one of the words that mean it: one short line, settled on the page.
  const own = conflictOf(d)
  const word = own ? d : synonymsOf(d.name).find((s) => conflictOf(s))
  const theirs = word && !own ? conflictOf(word) : undefined
  const conflictLine = own
    ? own.short
    : theirs?.kind === 'two-things'
      ? `“${word!.name}” is also used for ${theirs.other}.`
      : theirs?.kind === 'chain'
        ? `“${word!.name}” points here; point it at ${subject.name} instead.`
        : theirs?.short
  const about = subject.type === 'dimension' ? undefined : contextAbout(subject, facts)
  const page = `/definitions/${encodeURIComponent(d.name)}`
  const domain = d.domain ? domains[d.domain].name : 'All domains'
  const values = d.values?.split(', ')
  // Other names are added by an admin or an owner of the definition's domain.
  const canEdit = me.admin || (!!d.domain && me.owns.includes(d.domain))

  return (
    <DockFrame
      title="Definition"
      quietTitle
      actions={
        <PeekBar onExpand={() => navigate(page)}>
          <DockStepper list="definitions" id={d.name} onGo={(n) => openDock('def', n)} />
        </PeekBar>
      }
      footer={
        d.synced ? (
          subject.type === 'metric' && (
            // The footer's one action, so always the filled primary; the name is in the title right above.
            <Button
              size="sm"
              nativeButton={false}
              render={<a href={href('/context/new', { metric: d.name })} />}
            >
              <PlusIcon data-icon="inline-start" />
              Write context
            </Button>
          )
        ) : (
          <Button size="sm" nativeButton={false} render={<a href={href(`${page}/edit`)} />}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        )
      }
    >
      <PeekBands>
        <PeekBand first>
          <PeekTitle lead={<TypeTile d={d} size="lg" />}>{d.name}</PeekTitle>
          <PeekMeaning>
            {target && <AnotherNameFor target={target} className="mb-2" />}
            <p className={cn(!subject.definition && 'text-muted-foreground')}>
              {subject.definition ? (
                <MentionText text={subject.definition} />
              ) : (
                'No meaning written yet.'
              )}
            </p>
          </PeekMeaning>
          {conflictLine && word && (
            <PeekAttention
              icon={ArrowLeftRightIcon}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/definitions/${encodeURIComponent(word.name)}`)}
                >
                  Resolve
                </Button>
              }
            >
              {conflictLine}
            </PeekAttention>
          )}
        </PeekBand>
        <PeekBand label="Where it comes from">
          <PeekFacts>
            {d.synced ? (
              <PeekFact icon={LockIcon}>
                <b>{domain}</b> - read-only, synced from {DEFINITIONS_TOOL} {SYNCED_AT} -{' '}
                <a
                  href={sourceUrl(d)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline"
                >
                  Open in source
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </PeekFact>
            ) : (
              <PeekFact icon={PencilIcon}>
                <b>{domain}</b> - written by <b>{d.by}</b> - {d.updated}
              </PeekFact>
            )}
          </PeekFacts>
        </PeekBand>
        {!d.sameAs && (
          <PeekBand label="Also called">
            <SynonymTags d={d} canEdit={canEdit} />
          </PeekBand>
        )}
        {related.length > 0 && (
          <PeekBand label="Related">
            <PeekLabel>Related</PeekLabel>
            <Related id={mentionId(d.type, d.name)} />
          </PeekBand>
        )}
        <PeekBand flush>
          <PeekDetails
            rows={[
              ['Type', kindName(d)],
              ...(values
                ? ([
                    [
                      'Values',
                      values.length > 5
                        ? `${values.slice(0, 5).join(', ')} and ${values.length - 5} more`
                        : values.join(', '),
                    ],
                  ] as [string, string][])
                : []),
              ...(d.synced
                ? ([
                    [
                      `${DEFINITIONS_TOOL} name`,
                      <span key="v" className="font-mono text-xs">
                        {cubeRef(d)}
                      </span>,
                    ],
                  ] as [string, React.ReactNode][])
                : []),
              ...(d.changed
                ? ([['Changed', `In ${DEFINITIONS_TOOL} on ${d.changed}`]] as [string, string][])
                : []),
              ...(about
                ? ([
                    [
                      'Context about it',
                      about.length ? (
                        <a
                          key="v"
                          href={href(page)}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {about.length} context {about.length === 1 ? 'item' : 'items'}
                        </a>
                      ) : (
                        <span key="v" className="text-muted-foreground">
                          None yet
                        </span>
                      ),
                    ],
                  ] as [string, React.ReactNode][])
                : []),
            ]}
            links={[
              <PeekLink
                key="try"
                icon={FlaskConicalIcon}
                onClick={() =>
                  openDock('ask', undefined, {
                    q:
                      subject.type === 'dimension'
                        ? `How did orders change by ${subject.name.toLowerCase()} last month?`
                        : `How did ${subject.name} change last month?`,
                  })
                }
              >
                Try it with a question
              </PeekLink>,
            ]}
          />
        </PeekBand>
      </PeekBands>
    </DockFrame>
  )
}
