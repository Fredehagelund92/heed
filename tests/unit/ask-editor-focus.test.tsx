import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import AskEditor, { type AskEditorHandle } from '@/components/assistant/ask-editor'
import { textDraft } from '@/lib/ask-draft'

/*
  The chip editor takes the focus from the plain box that stands in while its chunk loads, so the
  words typed next go on into the question. React makes its view twice in development (StrictMode),
  as the local pilot runs it: the view made again must keep that focus, or the keys typed next go
  to the page and the question is never sent. The rest of the editor is tested in Chromium
  (tests/e2e/ask-chips.spec.ts).
*/

function Editor({ onHandle }: { onHandle: (handle: AskEditorHandle | null) => void }) {
  return (
    <AskEditor
      handle={onHandle}
      draft={textDraft('Which facts apply to ')}
      onDraftChange={() => undefined}
      reading={null}
      read="Which facts apply to"
      onSubmit={() => undefined}
      onRecall={() => null}
      today="2026-10-07"
      id="question"
      label="Your question"
    />
  )
}

describe('the chip editor', () => {
  it('keeps the focus it took as it mounts when React makes its view again', async () => {
    let handedOver = false
    // As the composer hands over: the first handle takes the focus the plain box had.
    const onHandle = (handle: AskEditorHandle | null) => {
      if (!handle || handedOver) return
      handedOver = true
      handle.focus()
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { getByRole } = render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <Editor onHandle={onHandle} />
        </QueryClientProvider>
      </StrictMode>,
    )
    const box = getByRole('textbox', { name: 'Your question' })
    expect(handedOver).toBe(true)
    await waitFor(() => expect(box).toHaveFocus())
    expect(box).toHaveTextContent('Which facts apply to')
  })
})
