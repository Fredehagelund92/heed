import { Fragment, type ReactNode, useMemo } from 'react'
import { ExternalLinkIcon } from '@/components/icons'
import { MentionChip } from '@/components/item/mention-chip'
import { PreviewLink } from '@/components/preview/preview-link'
import { type MarkdownBlock, type MarkdownInline, parseMarkdown } from '@/lib/markdown'
import { previewTargetOf } from '@/lib/preview'
import { cn } from '@/lib/utils'

/**
 * Draws one @ mention. The default shows a metric, dimension or value as its chip, a link to its
 * catalogue page that previews it.
 */
export type MentionRenderer = (mention: { label: string; target: string }) => ReactNode

const defaultMention: MentionRenderer = ({ label, target }) => {
  const type = target.slice(0, target.indexOf(':'))
  const preview = previewTargetOf(target)
  if ((type === 'metric' || type === 'dim' || type === 'val') && preview)
    return (
      <PreviewLink
        preview={preview}
        className="rounded-badge outline-none focus-visible:outline-2 focus-visible:outline-ring hover:[&>[data-slot=mention-chip]]:bg-accent"
      >
        <MentionChip target={{ type }} name={label} hint={false} />
      </PreviewLink>
    )
  return <span className="font-bold">{label}</span>
}

/**
 * Item text as people read it: the safe Markdown subset of `lib/markdown.ts`, drawn with React
 * elements only. Links open in a new tab with `rel="noopener noreferrer"` and an external icon.
 * Headings 2 and 3 become `h2` and `h3` unless `headingOffset` shifts them under the page's own
 * outline.
 */
export function Markdown({
  source,
  className,
  headingOffset = 0,
  renderMention = defaultMention,
  light = false,
}: {
  source: string
  className?: string
  /** Added to each heading level, so `##` can become an `h3` inside a section. */
  headingOffset?: 0 | 1 | 2
  renderMention?: MentionRenderer
  /**
   * The small Markdown of a comment: bold, italic, code, links, lists, quotes and code blocks.
   * A heading reads as a bold line, so a comment never adds to the page's outline.
   */
  light?: boolean
}) {
  const blocks = useMemo(
    () =>
      parseMarkdown(source).map((block): MarkdownBlock =>
        light && block.type === 'heading'
          ? {
              type: 'paragraph',
              children: [{ type: 'strong', children: block.children }],
            }
          : block,
      ),
    [source, light],
  )
  return (
    <div
      data-slot="markdown"
      className={cn('flex max-w-prose min-w-0 flex-col gap-3 text-large break-words', className)}
    >
      {blocks.map((block, index) => (
        <Block key={index} block={block} headingOffset={headingOffset} mention={renderMention} />
      ))}
    </div>
  )
}

function Block({
  block,
  headingOffset,
  mention,
}: {
  block: MarkdownBlock
  headingOffset: number
  mention: MentionRenderer
}) {
  switch (block.type) {
    case 'heading': {
      const Heading = (['h2', 'h3', 'h4', 'h5'] as const)[block.level - 2 + headingOffset] ?? 'h5'
      return (
        <Heading className={cn('font-bold', block.level === 2 ? 'text-title' : 'text-large')}>
          <Inline nodes={block.children} mention={mention} />
        </Heading>
      )
    }
    case 'paragraph':
      // Line breaks stay as typed: the text is written in a plain field, and refused markup
      // such as a table should read as the lines the writer typed.
      return (
        <p className="whitespace-pre-line">
          <Inline nodes={block.children} mention={mention} />
        </p>
      )
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul'
      return (
        <List
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={cn('flex flex-col gap-1 pl-6', block.ordered ? 'list-decimal' : 'list-disc')}
        >
          {block.items.map((item, index) => (
            <li key={index} className="pl-1">
              <Inline nodes={item} mention={mention} />
            </li>
          ))}
        </List>
      )
    }
    case 'quote':
      return (
        <blockquote className="flex flex-col gap-3 border-l-2 border-border pl-4 text-muted-foreground">
          {block.children.map((child, index) => (
            <Block key={index} block={child} headingOffset={headingOffset} mention={mention} />
          ))}
        </blockquote>
      )
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-dense">
          <code>{block.text}</code>
        </pre>
      )
  }
}

function Inline({ nodes, mention }: { nodes: MarkdownInline[]; mention: MentionRenderer }) {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>
      case 'strong':
        return (
          <strong key={index} className="font-bold">
            <Inline nodes={node.children} mention={mention} />
          </strong>
        )
      case 'emphasis':
        return (
          <em key={index}>
            <Inline nodes={node.children} mention={mention} />
          </em>
        )
      case 'code':
        return (
          <code key={index} className="rounded-sm bg-muted px-1 font-mono text-body">
            {node.text}
          </code>
        )
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-ink underline underline-offset-4 hover:decoration-2"
          >
            <Inline nodes={node.children} mention={mention} />{' '}
            <ExternalLinkIcon aria-hidden className="inline size-icon-sm align-middle" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )
      case 'mention':
        return (
          <Fragment key={index}>{mention({ label: node.label, target: node.target })}</Fragment>
        )
    }
  })
}
