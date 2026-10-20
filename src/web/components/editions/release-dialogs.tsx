import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  toApiError,
  type BlockedVersion,
  type Edition,
  type LibraryItem,
  type RollbackPreview,
} from '@/api'
import { rollbackPreviewQuery } from '@/api/edition-queries'
import { areasQuery, libraryQuery, useApiWrite } from '@/api/queries'
import { ConfirmDialog, type ConfirmDone } from '@/components/form/confirm-dialog'
import {
  CircleAlertIcon,
  CircleStopIcon,
  CopyIcon,
  MinusIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  type Icon,
} from '@/components/icons'
import { DomainBadge, KindIcon } from '@/components/item/item-marks'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import {
  Field,
  FieldError,
  FieldItem,
  FieldItemContent,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { EditionChangeKind } from '@domain/editions'
import {
  blockedProblem,
  editionDay,
  goBackBlocked,
  goBackEffect,
  goBackOrder,
  goBackReaders,
  goBackRefusal,
  goBackSummary,
  resumeEffect,
  stopConfirmText,
  stopEffect,
  stopNow,
  stopReach,
  stopReaders,
  stopTargetWords,
  type StopTarget,
} from '@/lib/editions'
import { showToast } from '@/lib/toast'
import { goBackHistory, ReleaseHistoryLine, stopHistory } from './release-history'
import type { NamedStop } from './use-stops'

type Controlled = { open: boolean; onOpenChange: (open: boolean) => void }

/** What going back does to a fact, as a mark beside its effect. */
const goBackMarks: Record<EditionChangeKind, Icon> = {
  removed: MinusIcon,
  retired: MinusIcon,
  added: PlusIcon,
  changed: PencilIcon,
  checked: RotateCcwIcon,
  resaved: CopyIcon,
}

/**
 * Going back to an earlier edition (FR-217; Editions design, slice S5), in two steps. First the
 * real effect, read from the service before anything is done: the live edition compared with the
 * target, item by item, and any version that cannot be served again, which refuses the action
 * outright. Then the reason, which the history log keeps, and the edition number typed to
 * confirm (contract 9.4). Nothing is deleted: the content is served again as a new edition, and
 * the dialog ends on what happened, with the way to undo it, which is going back again.
 */
export function RollbackDialog({ label, open, onOpenChange }: Controlled & { label: string }) {
  // Undoing restarts the dialog on the edition that was live, so the target can move.
  const [target, setTarget] = useState(label)
  const [published, setPublished] = useState<{ edition: Edition; was: string | null } | null>(null)
  const [refusal, setRefusal] = useState<BlockedVersion[] | null>(null)
  const opened = useRef(open)
  useLayoutEffect(() => {
    if (open && !opened.current) {
      setTarget(label)
      setPublished(null)
      setRefusal(null)
    }
    opened.current = open
  }, [open, label])
  const rollback = useApiWrite('rollbackEdition')
  const preview = useQuery({
    ...rollbackPreviewQuery(target),
    enabled: open && published === null,
  })
  const blocked = refusal ?? preview.data?.blocked ?? []
  const state = preview.isError || blocked.length ? 'refused' : preview.data ? 'ready' : 'pending'

  const day = editionDay(target)
  const done: ConfirmDone | null = published
    ? {
        title: day ? `Went back to ${day}` : `Went back to edition ${target}`,
        content: (
          <div className="flex flex-col gap-3">
            <p className="text-body">
              From now on, AI apps get the facts of edition{' '}
              <span className="font-mono">{target}</span> again, saved as the new edition{' '}
              <span className="font-mono">{published.edition.label}</span>. Nothing was deleted.
            </p>
            <ReleaseHistoryLine filters={goBackHistory(published.edition.label)} />
            {published.was ? (
              <p className="text-dense text-muted-foreground">
                To undo this, go back to <span className="font-mono">{published.was}</span>, the
                edition AI apps got before. You&apos;ll see what that changes first, as you did
                here.
              </p>
            ) : null}
          </div>
        ),
        actions: published.was ? (
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              const was = published.was!
              setRefusal(null)
              setPublished(null)
              setTarget(was)
            }}
          >
            <RotateCcwIcon aria-hidden />
            Go back to {published.was}…
          </Button>
        ) : null,
      }
    : null

  return (
    <ConfirmDialog
      key={target}
      open={open}
      onOpenChange={onOpenChange}
      title={day ? `Go back to how it was on ${day}?` : `Go back to edition ${target}?`}
      effect={
        <>
          AI apps get the facts of edition <span className="font-mono">{target}</span> again.
          Nothing is deleted, and you can undo this.
        </>
      }
      review={{
        state,
        content: <RollbackPreviewBody target={target} preview={preview} blocked={blocked} />,
      }}
      // The second step keeps what was checked in view, in one sentence.
      children={
        preview.data ? (
          <p className="text-dense text-muted-foreground">
            {goBackSummary(preview.data.comparison)}
          </p>
        ) : null
      }
      done={done}
      action="Go back"
      actionIcon={RotateCcwIcon}
      tone="destructive"
      reason={{
        required: true,
        label: 'Why are you going back?',
        hint: 'The history log keeps it with the new edition.',
      }}
      confirmText={target}
      onConfirm={async ({ reason }) => {
        const was = preview.data?.live.label
        try {
          const edition = await rollback.mutateAsync({ label: target, note: reason })
          setPublished({ edition, was: was ?? null })
        } catch (error) {
          const refused = toApiError(error)
          // The safety rule refused it after the preview was read: say which versions.
          if (refused.kind === 'conflict' && refused.blocked?.length) {
            setRefusal(refused.blocked)
            throw new Error(goBackRefusal(target, refused.blocked.length), { cause: error })
          }
          throw error
        }
      }}
    />
  )
}

/**
 * The first step of going back: what it changes for AI apps, in a sentence and fact by fact, or
 * why it can't go ahead. Only the preview's first page of facts is listed; the rest are a link
 * away, in What changed between the live edition and the target.
 */
function RollbackPreviewBody({
  target,
  preview,
  blocked,
}: {
  target: string
  preview: UseQueryResult<RollbackPreview>
  blocked: BlockedVersion[]
}) {
  if (preview.isError)
    return (
      <Alert variant="danger" role="alert">
        <TriangleAlertIcon aria-hidden />
        <AlertContent>
          <AlertTitle>We couldn&apos;t load what going back changes</AlertTitle>
          <AlertDescription>
            <p>Nothing has changed. You can go back once you can see what it changes.</p>
            <div>
              <Button variant="outline" onClick={() => void preview.refetch()}>
                Try again
              </Button>
            </div>
          </AlertDescription>
        </AlertContent>
      </Alert>
    )
  if (!preview.data)
    return (
      <div
        role="status"
        aria-label="Loading what going back changes"
        className="flex flex-col gap-2"
      >
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-row w-full" />
        <Skeleton className="h-row w-full" />
        <Skeleton className="h-row w-full" />
      </div>
    )
  const { comparison, live } = preview.data
  if (blocked.length)
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="danger" role="alert">
          <CircleAlertIcon aria-hidden />
          <AlertContent>
            <AlertTitle>You can&apos;t go back to this edition</AlertTitle>
            <AlertDescription>
              <p>{goBackBlocked(blocked.length, live.label)}</p>
            </AlertDescription>
          </AlertContent>
        </Alert>
        <ul
          aria-label="Versions that can't be shared again"
          className="flex flex-col divide-y divide-border-subtle rounded-sm border"
        >
          {blocked.map((version) => (
            <li
              key={`${version.itemId}.${version.version}`}
              className="flex min-h-row flex-col justify-center gap-1 px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2 text-dense">
                <span className="min-w-0 truncate font-bold">
                  {version.title ?? 'A fact only some groups can see'}
                </span>
                <span className="shrink-0 text-muted-foreground">Version {version.version}</span>
              </span>
              <span className="text-dense text-muted-foreground">
                {blockedProblem(version.problem)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-dense text-muted-foreground">
          A version AI apps get again must pass today&apos;s checks and have an owner&apos;s yes.
          Pick another edition, or ask the owner of the fact&apos;s domain to fix it first.
        </p>
      </div>
    )
  const items = [...comparison.items].sort(
    (a, b) =>
      goBackOrder.indexOf(a.change) - goBackOrder.indexOf(b.change) ||
      a.title.localeCompare(b.title, 'en'),
  )
  const more = comparison.total - items.length
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body break-words">{goBackSummary(comparison)}</p>
      <p className="text-dense text-muted-foreground">{goBackReaders}</p>
      {items.length ? (
        <ul
          aria-label={`What changes for AI apps, from edition ${live.label} back to ${target}`}
          tabIndex={0}
          className="flex max-h-list flex-col divide-y divide-border-subtle overflow-y-auto rounded-sm border outline-ring focus-visible:outline-2"
        >
          {items.map((item) => (
            <li
              key={item.itemId}
              className="flex min-h-row items-center gap-3 px-3 @max-md/viewport:py-2"
            >
              <KindIcon kind={item.kind} />
              <span className="flex min-w-0 flex-1 items-center gap-3 @max-md/viewport:flex-col @max-md/viewport:items-start @max-md/viewport:gap-1">
                <span className="min-w-0 flex-1 truncate text-dense @max-md/viewport:w-full">
                  {item.title}
                </span>
                <Badge form="outline" size="sm" icon={goBackMarks[item.change]}>
                  {goBackEffect(item)}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {more > 0 ? (
        <Link
          to="/editions/compare"
          search={{ since: live.label, until: target }}
          className="w-fit text-dense font-bold underline-offset-4 hover:underline"
        >
          See all {comparison.total.toLocaleString('en')} facts in What changed
        </Link>
      ) : null}
    </div>
  )
}

type Scope = StopTarget['scope']

/**
 * The stop switch (FR-805; Editions design, slice S5), for an admin, in two steps. First what to
 * stop and how far it reaches: one domain, everything or one fact, counted from the facts AI apps
 * get today. Then the reason, which everyone signed in sees in the banner, and the domain's name
 * or "everything" typed to confirm. It makes no edition and loses nothing; the dialog ends on
 * what happened, with the way to start again.
 */
export function StopDeliveryDialog({ open, onOpenChange }: Controlled) {
  const setStop = useApiWrite('setStop')
  const { data: areas = [] } = useQuery(areasQuery())
  const [scope, setScope] = useState<Scope>('area')
  const [areaId, setAreaId] = useState<string | null>(null)
  const [item, setItem] = useState<LibraryItem | null>(null)
  const [missingItem, setMissingItem] = useState(false)
  const [stopped, setStopped] = useState<NamedStop | null>(null)
  const [resuming, setResuming] = useState<NamedStop | null>(null)
  const library = useQuery({ ...libraryQuery(), enabled: open })
  const area = areas.find((candidate) => candidate.id === areaId) ?? areas[0]
  const target: StopTarget = { scope, areaName: area?.name, itemTitle: item?.title }
  const served = (library.data?.items ?? []).filter((entry) => entry.status !== 'retired')
  const reach = !library.data
    ? undefined
    : scope === 'all'
      ? served.length
      : scope === 'area' && area
        ? served.filter((entry) => entry.areaId === area.id).length
        : undefined
  const itemField = useRef<HTMLInputElement>(null)

  // Each time it opens, it starts again from one domain.
  const opened = useRef(open)
  useLayoutEffect(() => {
    if (open && !opened.current) {
      setScope('area')
      setItem(null)
      setMissingItem(false)
      setStopped(null)
    }
    opened.current = open
  }, [open])

  return (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Stop sharing with AI apps?"
        effect={stopEffect(target)}
        review={{
          label: 'Choose what to stop',
          state: library.isPending ? 'pending' : 'ready',
          onContinue: () => {
            if (scope !== 'item' || item) return true
            setMissingItem(true)
            itemField.current?.focus()
            return false
          },
          content: (
            <div className="flex flex-col gap-4">
              <Field>
                <FieldSet
                  render={
                    <RadioGroup
                      value={scope}
                      onValueChange={(value) => {
                        setScope(value as Scope)
                        setMissingItem(false)
                      }}
                    />
                  }
                >
                  <FieldLegend>What to stop</FieldLegend>
                  <FieldItem>
                    <RadioGroupItem value="area" />
                    <FieldItemContent>
                      <FieldLabel>One domain</FieldLabel>
                    </FieldItemContent>
                  </FieldItem>
                  <FieldItem>
                    <RadioGroupItem value="all" />
                    <FieldItemContent>
                      <FieldLabel>Everything</FieldLabel>
                    </FieldItemContent>
                  </FieldItem>
                  <FieldItem>
                    <RadioGroupItem value="item" />
                    <FieldItemContent>
                      <FieldLabel>One fact</FieldLabel>
                    </FieldItemContent>
                  </FieldItem>
                </FieldSet>
              </Field>
              {scope === 'area' && area ? (
                <Field>
                  <FieldLabel>Domain</FieldLabel>
                  <Select value={area.id} onValueChange={(next) => setAreaId(next)}>
                    <SelectTrigger size="lg">
                      <SelectValue>
                        <DomainBadge name={area.name} label={area.label} />
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          <SelectItemText>
                            <DomainBadge name={candidate.name} label={candidate.label} />
                          </SelectItemText>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              {scope === 'item' ? (
                <Field invalid={missingItem}>
                  <FieldLabel>Fact</FieldLabel>
                  <Combobox
                    items={served}
                    value={item}
                    onValueChange={(next: LibraryItem | null) => {
                      setItem(next)
                      if (next) setMissingItem(false)
                    }}
                    itemToStringLabel={(entry: LibraryItem) => entry.title}
                    isItemEqualToValue={(a: LibraryItem, b: LibraryItem) => a.id === b.id}
                    limit={50}
                  >
                    <ComboboxInput
                      ref={itemField}
                      size="lg"
                      placeholder="Find a fact by its title"
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>No fact has that title.</ComboboxEmpty>
                      <ComboboxList>
                        {(entry: LibraryItem) => (
                          <ComboboxItem key={entry.id} value={entry}>
                            <KindIcon kind={entry.kind} />
                            <span className="truncate">{entry.title}</span>
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldError>{missingItem ? 'Choose the fact to stop.' : null}</FieldError>
                </Field>
              ) : null}
              <Alert variant="warning">
                <CircleStopIcon aria-hidden />
                <AlertContent>
                  <AlertTitle>{stopReach(target, reach)}</AlertTitle>
                  <AlertDescription>
                    <p>{stopReaders}</p>
                  </AlertDescription>
                </AlertContent>
              </Alert>
            </div>
          ),
        }}
        done={
          stopped
            ? {
                title: `Stopped for ${stopTargetWords(stopped.target)}`,
                content: (
                  <div className="flex flex-col gap-3">
                    <p className="text-body">{stopNow(stopped.target)} Nothing was deleted.</p>
                    <ReleaseHistoryLine
                      filters={stopHistory(stopped.scope, stopped.itemId ?? stopped.areaId, true)}
                    />
                    <p className="text-dense text-muted-foreground">
                      To undo this, choose Start again. It stays on the Editions page while the stop
                      is on.
                    </p>
                  </div>
                ),
                actions: (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      setResuming(stopped)
                      onOpenChange(false)
                    }}
                  >
                    <PlayIcon aria-hidden />
                    Start again…
                  </Button>
                ),
              }
            : null
        }
        action="Stop sharing"
        actionIcon={CircleStopIcon}
        tone="destructive"
        reason={{
          required: true,
          label: 'Why are you stopping it?',
          hint: 'Everyone sees your reason in a banner.',
        }}
        confirmText={stopConfirmText(target)}
        // The second step keeps what was chosen in view, in one sentence.
        children={<p className="text-dense text-muted-foreground">{stopReach(target, reach)}</p>}
        onConfirm={async ({ reason }) => {
          if (scope === 'item' && !item) throw new Error('Choose the fact to stop.')
          const input = {
            scope,
            on: true,
            reason,
            ...(scope === 'area' && area ? { areaId: area.id } : {}),
            ...(scope === 'item' && item ? { itemId: item.id } : {}),
          }
          const stops = await setStop.mutateAsync(input)
          const stop = stops.find(
            (candidate) =>
              candidate.scope === scope &&
              candidate.areaId === (input.areaId ?? null) &&
              candidate.itemId === (input.itemId ?? null),
          )
          if (!stop)
            throw new Error(
              "We couldn't confirm the stop. Check the Editions page, then try again.",
            )
          setStopped({ ...stop, target })
        }}
      />
      {resuming ? (
        <ResumeDeliveryDialog
          stop={resuming}
          open
          onOpenChange={(next) => {
            if (!next) setResuming(null)
          }}
        />
      ) : null}
    </>
  )
}

/** Starting again after a stop that is on. No typing: it restores what was there. */
export function ResumeDeliveryDialog({
  stop,
  open,
  onOpenChange,
}: Controlled & { stop: NamedStop }) {
  const setStop = useApiWrite('setStop')
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Start sharing ${stopTargetWords(stop.target)} again?`}
      effect={resumeEffect(stop.target)}
      action="Start again"
      actionIcon={PlayIcon}
      reason={{
        required: true,
        hint: 'The history log keeps your reason.',
      }}
      onConfirm={async ({ reason }) => {
        await setStop.mutateAsync({
          scope: stop.scope,
          on: false,
          reason,
          ...(stop.areaId ? { areaId: stop.areaId } : {}),
          ...(stop.itemId ? { itemId: stop.itemId } : {}),
        })
        showToast('Started again', `AI apps get ${stopTargetWords(stop.target)} again.`)
      }}
    />
  )
}
