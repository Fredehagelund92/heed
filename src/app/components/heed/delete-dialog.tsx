import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { count, needsTyping, skippedLine, type Skip } from '@/lib/bulk'

// The one confirmation before something is deleted for good: from a list's bar, the Delete key on a
// selection, or an item's own menu. It names what goes (titles and a count), says what that means,
// and above ten items asks for the number to be typed. Published items are never deleted: when the
// selection holds only those, it says so and offers Archive, which is the safe default.

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What is deleted, as a word: "draft", "term". */
  noun: string
  titles: string[]
  /** What deleting them means, in a sentence. */
  consequence: string
  /** What goes with them, said before it happens: "Their other names go too: GMV, Gross sales." */
  also?: string
  /** What the selection held that this won't delete, and why. */
  skipped?: Skip[]
  /** Published items in the selection: archived instead, never deleted. */
  archive?: { count: number; onArchive: () => void }
  onDelete: () => void
}

export function DeleteDialog(props: Props) {
  const cancel = React.useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent initialFocus={cancel} className="sm:max-w-md">
        {/* Mounted only while open, so the typed number starts empty each time. */}
        <Body {...props} cancel={cancel} />
      </DialogContent>
    </Dialog>
  )
}

function Body({
  onOpenChange,
  noun,
  titles,
  consequence,
  also,
  skipped = [],
  archive,
  onDelete,
  cancel,
}: Props & { cancel: React.RefObject<HTMLButtonElement | null> }) {
  const [typed, setTyped] = React.useState('')
  const n = titles.length
  const typing = needsTyping(n)
  const ready = !typing || typed.trim() === String(n)
  const onlyPublished = n === 0 && !!archive?.count
  const others = skipped.filter((s) => s.why !== 'published')

  if (onlyPublished)
    return (
      <>
        <DialogHeader>
          <DialogTitle>Published items are archived, not deleted</DialogTitle>
          <DialogDescription>
            Archiving keeps their history, and agents stop getting them from the next question. You
            can undo it, or publish them again later.
          </DialogDescription>
        </DialogHeader>
        {others.length > 0 && <SkippedList skipped={others} />}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" ref={cancel} />}>Cancel</DialogClose>
          <Button
            onClick={() => {
              onOpenChange(false)
              archive.onArchive()
            }}
          >
            Archive {count(archive.count, 'item')}
          </Button>
        </DialogFooter>
      </>
    )

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        onOpenChange(false)
        onDelete()
      }}
    >
      <DialogHeader>
        <DialogTitle>Delete {count(n, noun)}?</DialogTitle>
        <DialogDescription>{consequence}</DialogDescription>
      </DialogHeader>
      <ul aria-label="To delete" className="max-h-48 overflow-y-auto rounded-md border text-sm">
        {titles.map((t) => (
          <li key={t} className="border-b px-3 py-2 last:border-b-0">
            {t}
          </li>
        ))}
      </ul>
      {also && <p className="text-sm text-muted-foreground">{also}</p>}
      {archive && archive.count > 0 && (
        <p className="text-sm text-muted-foreground">
          {count(archive.count, 'published item')} {archive.count === 1 ? 'stays' : 'stay'}:
          published items are archived, not deleted.{' '}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-4"
            onClick={() => {
              onOpenChange(false)
              archive.onArchive()
            }}
          >
            Archive {archive.count === 1 ? 'it' : 'them'} instead
          </button>
        </p>
      )}
      {others.length > 0 && <SkippedList skipped={others} />}
      {typing && (
        <Field>
          <FieldLabel htmlFor="delete-count">Type {n} to delete them</FieldLabel>
          <Input
            id="delete-count"
            inputMode="numeric"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>
      )}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" ref={cancel} />}>Cancel</DialogClose>
        <Button type="submit" variant="destructive" aria-disabled={!ready || undefined}>
          Delete {count(n, noun)}
        </Button>
      </DialogFooter>
    </form>
  )
}

function SkippedList({ skipped }: { skipped: Skip[] }) {
  return (
    <div className="text-sm">
      <p className="font-medium">{skippedLine(skipped)}</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
        {skipped.slice(0, 5).map((s) => (
          <li key={s.id}>
            <span className="text-foreground">{s.title}</span> - {s.reason}
          </li>
        ))}
        {skipped.length > 5 && <li>And {skipped.length - 5} more.</li>}
      </ul>
    </div>
  )
}
