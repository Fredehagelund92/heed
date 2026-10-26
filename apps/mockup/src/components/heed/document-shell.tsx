import type { ReactNode } from "react"
import type { Editor } from "@tiptap/react"
import { RichTextEditor } from "@/components/editor"
import "@/components/editor/style.css"
import { Canvas } from "@/components/heed/doc"
import { Toolbar } from "@/components/heed/doc-toolbar"

// The one document editor: the page header, then the formatting toolbar as a fixed 40px row (outside
// the scroller), the tinted canvas with the document sheet (the only scroller), an optional side
// panel, and one footer bar. The context and term editors, About our business and a domain all use
// it, so they read as one product.

export function DocumentEditorShell({
  header,
  editor,
  toolbar = true,
  paneRef,
  aside,
  footer,
  children,
}: {
  header: ReactNode
  editor: Editor | null
  /** The formatting row; off when the page has no free text (a synonym). */
  toolbar?: boolean
  /** The pane beside the sidebar, for a page that measures whether its panel fits. */
  paneRef?: (el: HTMLDivElement | null) => void
  /** The docked side panel, when it is open and fits. */
  aside?: ReactNode
  footer: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <RichTextEditor editor={editor} variant="subtle" className="flex min-h-0 flex-1 flex-col rounded-none! border-0! bg-transparent! shadow-none!">
        {toolbar && <Toolbar editor={editor} />}
        <div ref={paneRef} className="@container/main flex min-h-0 flex-1">
          <Canvas className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</Canvas>
          {aside}
        </div>
      </RichTextEditor>
      {footer}
    </div>
  )
}
