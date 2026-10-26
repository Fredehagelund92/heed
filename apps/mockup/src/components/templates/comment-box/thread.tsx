import * as React from "react"
import type { JSONContent } from "@tiptap/core"
import { generateText } from "@tiptap/core"
import { CornerUpLeftIcon, MoreHorizontalIcon, PencilIcon, SmilePlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { PersonAvatar } from "@/components/heed/bits"
import { StaticRenderer } from "@/components/static-renderer"
import { MentionChip } from "@/components/heed/mention-chip"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Composer } from "./composer"
import type { CommentItem, CommentReaction, CommentReply, ReactionEmoji } from "./types"
import { EXTENSIONS } from "./extensions"
import { names, REACTIONS, reactionLabel } from "./utils"

// From the editorcn Comment Box's thread, restyled flat: no bubbles and no card, a hairline between
// threads and a hairline stem for replies, replies always open. Chips are quiet: the count shows
// from two, the tooltip names who. The add-reaction button shows on hover or focus (always on
// touch), and offers the five reactions only.

export type ThreadActions = {
  me: string
  owners: string[]
  post: (content: JSONContent, parentId?: string) => void
  react: (id: string, emoji: ReactionEmoji) => void
  edit: (id: string, content: JSONContent) => void
  remove: (id: string) => void
}

const reveal = "opacity-0 transition-opacity group-hover/entry:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"

/** The chips for the reactions given, each a toggle for you. */
export function ReactionChips({ reactions, me, onReact }: { reactions: CommentReaction[]; me: string; onReact: (emoji: ReactionEmoji) => void }) {
  return (
    <>
      {reactions.map((r) => {
        const mine = r.by.includes(me)
        const label = reactionLabel(r.emoji)
        return (
          <Tooltip key={r.emoji}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-pressed={mine}
                  aria-label={`${label}, ${r.by.length}: ${names(r.by, me)}`}
                  onClick={() => onReact(r.emoji)}
                  className={cn(
                    "flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
                    mine ? "border-primary/40 bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted"
                  )}
                />
              }
            >
              <span aria-hidden className="text-[13px] leading-none">
                {r.emoji}
              </span>
              {r.by.length > 1 && <span aria-hidden>{r.by.length}</span>}
            </TooltipTrigger>
            <TooltipContent>
              {label}: {names(r.by, me)}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </>
  )
}

/** The add-reaction button and its five choices. */
export function ReactionPicker({ onPick, className }: { onPick: (emoji: ReactionEmoji) => void; className?: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<Button aria-label="Add a reaction" variant="ghost" size="icon-xs" className={cn("size-6 rounded-full text-muted-foreground", className)} />}
            />
          }
        >
          <SmilePlusIcon />
        </TooltipTrigger>
        <TooltipContent>Add a reaction</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" sideOffset={6} className="w-auto flex-row gap-0.5 p-1">
        {REACTIONS.map((r) => (
          <Tooltip key={r.emoji}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={r.label}
                  onClick={() => {
                    onPick(r.emoji)
                    setOpen(false)
                  }}
                  className="flex size-8 items-center justify-center rounded-md text-base outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
                />
              }
            >
              <span aria-hidden>{r.emoji}</span>
            </TooltipTrigger>
            <TooltipContent>{r.label}</TooltipContent>
          </Tooltip>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function Entry({ comment, actions, small, onReply }: { comment: CommentReply; actions: ThreadActions; small?: boolean; onReply?: () => void }) {
  const [editing, setEditing] = React.useState(false)
  const mine = comment.author === actions.me
  if (comment.deleted)
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span aria-hidden className={cn("shrink-0 rounded-full border border-dashed", small ? "size-5" : "size-7")} />
        <p>
          Comment deleted<span className="sr-only"> by {comment.author}</span>, {comment.when}
        </p>
      </div>
    )
  return (
    <article aria-label={`${comment.author}, ${comment.when}`} className="group/entry flex gap-3">
      <PersonAvatar name={comment.author} size={small ? 20 : 28} className={small ? "mt-0.5" : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-6 items-center gap-2 text-sm">
          <span className="truncate font-medium">{comment.author}</span>
          {actions.owners.includes(comment.author) && <span className="shrink-0 text-xs text-muted-foreground">Owner</span>}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {comment.when}
            {comment.edited && ", edited"}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`More for ${comment.author}'s comment`}
                  className={cn("ml-auto size-6 text-muted-foreground", reveal)}
                />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard?.writeText(generateText(comment.content, EXTENSIONS)).catch(() => undefined)
                  toast("Copied")
                }}
              >
                Copy text
              </DropdownMenuItem>
              {mine && (
                <>
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <PencilIcon />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      actions.remove(comment.id)
                      toast("Comment deleted")
                    }}
                  >
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {comment.returned && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CornerUpLeftIcon className="size-3" aria-hidden />
            Returned with a note
          </p>
        )}
        {editing ? (
          <Composer
            className="mt-1"
            author={actions.me}
            avatar={false}
            autoFocus
            label="Edit your comment"
            placeholder="Your comment"
            initialContent={comment.content}
            submitLabel="Save"
            onPost={(content) => {
              actions.edit(comment.id, content)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <StaticRenderer
            className="text-sm leading-relaxed text-foreground/90 [&_code]:text-[0.85em]"
            content={comment.content}
            extensions={EXTENSIONS}
            options={{ nodeMapping: { mention: ({ node }) => <MentionChip mention={{ id: node.attrs.id, label: node.attrs.label }} /> } }}
          />
        )}
        {!editing && (
          <div className="mt-1 flex min-h-6 flex-wrap items-center gap-1">
            <ReactionChips reactions={comment.reactions ?? []} me={actions.me} onReact={(e) => actions.react(comment.id, e)} />
            {onReply && (
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onReply}>
                Reply
              </Button>
            )}
            <ReactionPicker onPick={(e) => actions.react(comment.id, e)} className={reveal} />
          </div>
        )}
      </div>
    </article>
  )
}

/** One comment and its replies, one level deep. */
export function CommentThread({ comment, actions }: { comment: CommentItem; actions: ThreadActions }) {
  const [replying, setReplying] = React.useState(false)
  const replies = comment.replies ?? []
  const first = comment.author.split(" ")[0]
  return (
    <li className="flex flex-col gap-3 border-t py-4 first:border-t-0">
      <Entry comment={comment} actions={actions} onReply={comment.deleted ? undefined : () => setReplying(true)} />
      {(replies.length > 0 || replying) && (
        <div className="ml-3.5 flex flex-col gap-3 border-l pl-4">
          {replies.map((r) => (
            <Entry key={r.id} comment={r} actions={actions} small onReply={() => setReplying(true)} />
          ))}
          {replying && (
            <Composer
              author={actions.me}
              avatar={false}
              autoFocus
              label={`Reply to ${first}`}
              placeholder={`Reply to ${first}`}
              submitLabel="Reply"
              onCancel={() => setReplying(false)}
              onPost={(content) => {
                actions.post(content, comment.id)
                setReplying(false)
              }}
            />
          )}
        </div>
      )}
    </li>
  )
}
