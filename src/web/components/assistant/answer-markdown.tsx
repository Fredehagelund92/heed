import { Fragment, useState, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { plainClick } from '@/components/app-shell/trail'
import type { MentionRenderer } from '@/components/form/markdown'
import { ExternalLinkIcon, SquareCheckIcon, SquareIcon } from '@/components/icons'
import {
  readStreaming,
  type AnswerBlock,
  type AnswerInline,
  type AnswerTable,
  type Arrive,
  type TableAlign,
} from '@/lib/answer-markdown'
import { cn } from '@/lib/utils'
import './answer-motion.css'

/*
  An assistant answer as people read it (`lib/answer-markdown.ts`): GitHub-flavoured Markdown in
  the answer's scale, its prose in the reading role (15/24), drawn with React elements only. A
  table scrolls sideways inside the answer when it is wider than the panel, with its first column
  kept in view. A page of Heed opens in the app; any other link opens in a new tab with an
  external icon. While the answer streams, each checked sentence settles in as it arrives
  (contract 10): a new block rises into place as it fades in, new words at the end of a block fade
  in. What was already there does not move.

  The help pages draw their blocks with the same parts (`MarkdownBlocks`, look `docs`): their
  headings are the page's own outline under its title, with the ids links point at, their lists
  have room between steps, and a figure is drawn by the page.
*/

/** How the blocks read: inside an answer, or as a help page with its own outline. */
export type MarkdownLook = 'answer' | 'docs'

type Draw = {
  mention: MentionRenderer
  /** Going to a page of Heed from the answer: the phone's full-screen panel closes. */
  onLeave: (() => void) | undefined
  look: MarkdownLook
  figure: ((figure: Extract<AnswerBlock, { type: 'figure' }>) => ReactNode) | undefined
}

export function AnswerMarkdown({
  source,
  streaming = false,
  renderMention,
  onLeave,
  className,
}: {
  source: string
  /** The answer is still arriving: a table shows once its header and delimiter lines have. */
  streaming?: boolean
  renderMention: MentionRenderer
  onLeave?: () => void
  className?: string
}) {
  // Each update is read against the one before it, so what it added is marked (React's way of
  // keeping what a render needs from the one before).
  const [reading, setReading] = useState(() => readStreaming(source, { streaming, before: null }))
  let current = reading
  if (reading.source !== source || reading.streaming !== streaming) {
    current = readStreaming(source, { streaming, before: reading })
    setReading(current)
  }
  const draw: Draw = { mention: renderMention, onLeave, look: 'answer', figure: undefined }
  return (
    <div
      data-slot="answer-markdown"
      className={cn('flex min-w-0 flex-col gap-3 text-reading break-words', className)}
    >
      <Blocks blocks={current.blocks} draw={draw} />
    </div>
  )
}

/**
 * Blocks read by `parseGfm`, drawn as an answer draws them or, with look `docs`, as a help
 * page: `##` an `h2` under the page's title, with its id. The caller sets the column and its gap.
 */
export function MarkdownBlocks({
  blocks,
  look,
  renderMention,
  figure,
}: {
  blocks: AnswerBlock[]
  look: MarkdownLook
  renderMention: MentionRenderer
  /** Draws a figure; without it a figure is left out. */
  figure?: Draw['figure']
}) {
  return (
    <Blocks blocks={blocks} draw={{ mention: renderMention, onLeave: undefined, look, figure }} />
  )
}

const docsHeadingTag = { 2: 'h2', 3: 'h3', 4: 'h4' } as const

const docsHeading = {
  2: 'text-title font-bold tracking-title text-balance',
  3: 'text-large font-bold tracking-large text-balance',
  4: 'text-body font-bold text-balance',
} as const

function Blocks({ blocks, draw }: { blocks: AnswerBlock[]; draw: Draw }) {
  return blocks.map((block, index) => <Block key={index} block={block} draw={draw} />)
}

/** A part that has just come in settles in (`lib/answer-markdown.ts`, `Arrive`). */
const arriving = (part: Arrive) => (part.arrive === undefined ? undefined : 'animate-arrive')

function Block({ block, draw }: { block: AnswerBlock; draw: Draw }) {
  const enter = arriving(block)
  switch (block.type) {
    case 'heading': {
      if (draw.look === 'docs') {
        // The page's title is its h1, so a page's `##` is an h2.
        const depth = Math.min(Math.max(block.depth, 2), 4) as 2 | 3 | 4
        const Heading = docsHeadingTag[depth]
        return (
          <Heading id={block.id} className={cn(docsHeading[depth], enter)}>
            <Inline nodes={block.children} draw={draw} />
          </Heading>
        )
      }
      // Under the answer's own place in the page: the largest is a section heading.
      const Heading = block.depth <= 2 ? 'h3' : 'h4'
      return (
        <Heading
          className={cn(
            'font-bold text-balance',
            block.depth <= 2 ? 'text-large' : 'text-reading',
            enter,
          )}
        >
          <Inline nodes={block.children} draw={draw} />
        </Heading>
      )
    }
    case 'paragraph':
      // Lines the model wrote one under another read as written: pretty wrapping (the page's
      // own, for prose) would even their ends across the breaks and pull a word down from a
      // line that has room for it.
      return (
        <p
          className={cn(
            block.children.some((node) => node.type === 'break') ? 'text-wrap' : 'text-pretty',
            enter,
          )}
        >
          <Inline nodes={block.children} draw={draw} />
        </p>
      )
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul'
      const tasks = block.items.some((item) => item.checked !== null)
      return (
        <List
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={cn(
            'flex flex-col',
            // A page's steps have room between them, each with its result under it.
            draw.look === 'docs' ? (block.ordered ? 'gap-4' : 'gap-2') : 'gap-1',
            tasks ? 'list-none' : cn('pl-6', block.ordered ? 'list-decimal' : 'list-disc'),
            enter,
          )}
        >
          {block.items.map((item, index) =>
            item.checked === null ? (
              <li key={index} className={cn('pl-1', arriving(item))}>
                <ItemBody blocks={item.children} draw={draw} />
              </li>
            ) : (
              <li key={index} className={cn('flex gap-2', arriving(item))}>
                <TaskMark done={item.checked} />
                <div className="min-w-0 flex-1">
                  <ItemBody blocks={item.children} draw={draw} />
                </div>
              </li>
            ),
          )}
        </List>
      )
    }
    case 'quote':
      return (
        <blockquote
          className={cn(
            'flex flex-col gap-3 border-l-2 border-border pl-4 text-muted-foreground',
            enter,
          )}
        >
          <Blocks blocks={block.children} draw={draw} />
        </blockquote>
      )
    case 'code':
      return (
        <pre
          tabIndex={0}
          aria-label="Code"
          className={cn(
            'overflow-x-auto rounded-md bg-muted p-3 font-mono text-dense break-normal focus-visible:outline-2 focus-visible:outline-ring',
            enter,
          )}
        >
          <code>{block.text}</code>
        </pre>
      )
    case 'rule':
      return <hr className={cn('border-border', enter)} />
    case 'table':
      return <AnswerTableView table={block} draw={draw} className={enter} />
    case 'figure':
      return draw.figure?.(block) ?? null
  }
}

/** A list item's blocks: a tight item's one paragraph reads as the item itself. */
function ItemBody({ blocks, draw }: { blocks: AnswerBlock[]; draw: Draw }) {
  if (blocks.length === 1 && blocks[0]?.type === 'paragraph')
    return <Inline nodes={blocks[0].children} draw={draw} />
  return (
    <div className={cn('flex flex-col', draw.look === 'docs' ? 'gap-2' : 'gap-1')}>
      <Blocks blocks={blocks} draw={draw} />
    </div>
  )
}

/** A task's box: a mark and a word, never a control, since an answer cannot be changed. */
function TaskMark({ done }: { done: boolean }) {
  const Mark = done ? SquareCheckIcon : SquareIcon
  return (
    <span className="flex h-5 shrink-0 items-center">
      <Mark aria-hidden="true" className="size-4 text-muted-foreground" />
      <span className="sr-only">{done ? 'Done: ' : 'Not done: '}</span>
    </span>
  )
}

const alignClass: Record<NonNullable<TableAlign>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

/**
 * A table on the 40 row of the app's tables (contract 6.5): cells in 13, the header muted. Wider
 * than the answer, it scrolls sideways in its frame and the keyboard can scroll it. Short values
 * stay on one line and a column of sentences wraps; a short first column, each row's name, stays
 * in view as the rest scrolls under it.
 */
function AnswerTableView({
  table,
  draw,
  className,
}: {
  table: AnswerTable
  draw: Draw
  className: string | undefined
}) {
  const pinned = table.short[0] === true
  const cell = (column: number, header = false) =>
    cn(
      'px-3 py-2 align-top',
      (header || table.short[column]) && 'whitespace-nowrap',
      table.align[column] ? alignClass[table.align[column]] : 'text-left',
      table.numeric[column] && 'tabular-nums',
      column === 0
        ? cn('border-r', pinned && 'sticky left-0 bg-background')
        : column > 1 && 'border-l',
    )
  return (
    <div
      data-slot="answer-table"
      tabIndex={0}
      role="group"
      aria-label="Table"
      className={cn(
        'max-w-full overflow-x-auto overscroll-x-contain rounded-md border focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      <table className="w-full border-separate border-spacing-0 text-dense">
        <thead className="text-muted-foreground">
          <tr className="h-row">
            {table.head.map((nodes, column) => (
              <th key={column} scope="col" className={cn(cell(column, true), 'font-normal')}>
                <Inline nodes={nodes} draw={draw} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index} className={cn('h-row', arriving(row))}>
              {row.span ? (
                <td colSpan={table.head.length} className="border-t px-3 py-2 align-top">
                  <Inline nodes={row.cells[0] ?? []} draw={draw} />
                </td>
              ) : (
                row.cells.map((nodes, column) =>
                  column === 0 ? (
                    <th
                      key={column}
                      scope="row"
                      className={cn(cell(column), 'border-t font-normal')}
                    >
                      <Inline nodes={nodes} draw={draw} />
                    </th>
                  ) : (
                    <td key={column} className={cn(cell(column), 'border-t')}>
                      <Inline nodes={nodes} draw={draw} />
                    </td>
                  ),
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A page of Heed by its path, search and all: a plain click opens it in the app, a modified one
 * as links do (a new tab, a new window).
 */
function PageLink({
  href,
  onLeave,
  children,
}: {
  href: string
  onLeave: (() => void) | undefined
  children: ReactNode
}) {
  const router = useRouter()
  return (
    <a
      href={href}
      className={linkClass}
      onClick={(event) => {
        if (!plainClick(event)) return
        event.preventDefault()
        onLeave?.()
        void router.navigate({ href })
      }}
    >
      {children}
    </a>
  )
}

const linkClass =
  'text-brand-ink underline underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-ring'

function Inline({ nodes, draw }: { nodes: AnswerInline[]; draw: Draw }) {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>
      case 'break':
        return <br key={index} />
      case 'strong':
        return (
          <strong key={index} className="font-bold">
            <Inline nodes={node.children} draw={draw} />
          </strong>
        )
      case 'emphasis':
        return (
          <em key={index}>
            <Inline nodes={node.children} draw={draw} />
          </em>
        )
      case 'delete':
        return (
          <del key={index}>
            <Inline nodes={node.children} draw={draw} />
          </del>
        )
      case 'code':
        return (
          <code key={index} className="rounded-sm bg-muted px-1 font-mono text-dense">
            {node.text}
          </code>
        )
      case 'link':
        return node.internal ? (
          <PageLink key={index} href={node.href} onLeave={draw.onLeave}>
            <Inline nodes={node.children} draw={draw} />
          </PageLink>
        ) : (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            <Inline nodes={node.children} draw={draw} />{' '}
            <ExternalLinkIcon aria-hidden className="inline size-icon-sm align-middle" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )
      case 'mention':
        return (
          <Fragment key={index}>
            {draw.mention({ label: node.label, target: node.target })}
          </Fragment>
        )
      case 'arrive':
        // Keyed by where its update starts, so each update's words settle in once.
        return (
          <span key={`arrive-${node.at}`} className="animate-arrive">
            <Inline nodes={node.children} draw={draw} />
          </span>
        )
    }
  })
}
