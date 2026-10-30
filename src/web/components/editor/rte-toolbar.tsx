import { useRichTextEditorContext } from './rte-context'
import type { RichTextEditorToolbarProps } from './types'
import { cn } from './ui/utils'

export const Toolbar = ({
  children,
  className,
  sticky,
  stickyOffset = 0,
}: RichTextEditorToolbarProps) => {
  const { variant, editable } = useRichTextEditorContext()

  if (!editable) {
    return null
  }

  return (
    <div
      className={cn(
        'rte-toolbar',
        variant === 'subtle'
          ? 'rte-toolbar--subtle'
          : variant === 'compact' && 'rte-toolbar--compact',
        sticky && 'sticky z-raised',
        className,
      )}
      data-sticky={sticky ? '' : undefined}
      style={sticky ? { top: stickyOffset } : undefined}
    >
      {children}
    </div>
  )
}
