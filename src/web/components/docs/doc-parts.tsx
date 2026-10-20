import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'
import { MarkdownBlocks } from '@/components/assistant/answer-markdown'
import type { MentionRenderer } from '@/components/form/markdown'
import {
  BookOpenIcon,
  ClockIcon,
  FileTextIcon,
  ListChecksIcon,
  SparklesIcon,
  type Icon,
} from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import type { AnswerBlock } from '@/lib/answer-markdown'
import { docKindNames, docPicture, type DocKind } from '@/lib/docs'
import { cn } from '@/lib/utils'

/*
  The parts of the Docs area (docs/help/README.md): a page's blocks in the page's reading type,
  its pictures drawn inline in the app's tokens, the kind badge and the reading time.
*/

export const docKindIcons: Record<DocKind, Icon> = {
  concept: BookOpenIcon,
  guide: ListChecksIcon,
  tour: SparklesIcon,
  reference: FileTextIcon,
  glossary: FileTextIcon,
  faq: FileTextIcon,
}

/** The kind of a page as a plain fact: an outline badge with its glyph. */
export function DocKindBadge({ kind, size = 'md' }: { kind: DocKind; size?: 'md' | 'sm' }) {
  return (
    <Badge form="outline" size={size} icon={docKindIcons[kind]}>
      {docKindNames[kind]}
    </Badge>
  )
}

/** How long a page takes to read: "5 min", or "5 min read" on the page itself. */
export function ReadingTime({
  minutes,
  read = false,
  className,
}: {
  minutes: number
  read?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1 tabular-nums', className)}>
      <ClockIcon aria-hidden="true" className="size-icon-sm" />
      {minutes} min{read ? ' read' : ''}
    </span>
  )
}

/** A mention never appears in the pages; their words are drawn as written. */
const plainMention: MentionRenderer = ({ label }) => label

/**
 * A picture of the pages: the SVG drawn inline, so it takes the app's colours in light and dark,
 * with the alt text as its name and the caption under it. On a narrow page it scrolls sideways
 * in its frame rather than shrinking its words.
 */
function DocFigure({ figure }: { figure: Extract<AnswerBlock, { type: 'figure' }> }) {
  const svg = docPicture(figure.src)
  if (!svg) return null
  return (
    <figure data-slot="doc-figure" className="flex min-w-0 flex-col gap-2">
      <div
        tabIndex={0}
        role="group"
        aria-label="Picture"
        className="overflow-x-auto overscroll-x-contain rounded-lg border p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <div
          role="img"
          aria-label={figure.alt}
          className="w-fit"
          // A file of the repository, checked by the docs test: no script, link or handler.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {figure.caption ? (
        <figcaption className="text-dense text-muted-foreground">{figure.caption}</figcaption>
      ) : null}
    </figure>
  )
}

const drawFigure = (figure: Extract<AnswerBlock, { type: 'figure' }>) => (
  <DocFigure figure={figure} />
)

/**
 * A page's blocks in its reading type (15/24), grouped as the page is outlined: 32 between its
 * sections, 16 inside one, and a heading of the third level close to its text, as a glossary
 * term is.
 */
export function DocBlocks({
  blocks,
  className,
  ...props
}: ComponentProps<'div'> & { blocks: AnswerBlock[] }) {
  return (
    <div
      data-slot="doc-body"
      className={cn('flex min-w-0 flex-col gap-8 text-reading break-words', className)}
      {...props}
    >
      {outline(blocks).map((section, index) => (
        <section
          key={index}
          aria-labelledby={section.heading?.id}
          className="flex min-w-0 flex-col gap-4"
        >
          {section.heading ? <Blocks blocks={[section.heading]} /> : null}
          {section.groups.map((group, at) =>
            group.heading ? (
              <div key={at} className="flex min-w-0 flex-col gap-2">
                <Blocks blocks={[group.heading]} />
                <div className="flex min-w-0 flex-col gap-3">
                  <Blocks blocks={group.blocks} />
                </div>
              </div>
            ) : (
              <Blocks key={at} blocks={group.blocks} />
            ),
          )}
        </section>
      ))}
    </div>
  )
}

function Blocks({ blocks }: { blocks: AnswerBlock[] }) {
  return (
    <MarkdownBlocks blocks={blocks} look="docs" renderMention={plainMention} figure={drawFigure} />
  )
}

type Heading = Extract<AnswerBlock, { type: 'heading' }>
type Section = {
  heading: Heading | null
  groups: { heading: Heading | null; blocks: AnswerBlock[] }[]
}

/** A page's blocks as sections under each `##`, and groups under each `###` inside them. */
function outline(blocks: readonly AnswerBlock[]): Section[] {
  const sections: Section[] = []
  for (const block of blocks) {
    if (block.type === 'heading' && block.depth <= 2) {
      sections.push({ heading: block, groups: [] })
      continue
    }
    const section = sections.at(-1) ?? sections[sections.push({ heading: null, groups: [] }) - 1]!
    if (block.type === 'heading' && block.depth === 3) {
      section.groups.push({ heading: block, blocks: [] })
      continue
    }
    const group =
      section.groups.at(-1) ??
      section.groups[section.groups.push({ heading: null, blocks: [] }) - 1]!
    group.blocks.push(block)
  }
  return sections
}

/** A link to a page of the docs, as the cards and the pager draw it. */
export function DocLink({ slug, ...props }: Omit<ComponentProps<'a'>, 'href'> & { slug: string }) {
  return <Link to="/docs/$slug" params={{ slug }} {...props} />
}
