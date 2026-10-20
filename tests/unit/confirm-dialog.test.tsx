import { useState } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { check, ConfirmDialog, suggestedReason } from '@/components/form/confirm-dialog'
import { Button } from '@/components/ui/button'

function openDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = props.onConfirm ?? vi.fn()
  render(
    <ConfirmDialog
      trigger={<Button>Go back</Button>}
      title="Go back to edition 2026-10-06.2?"
      effect="Agents get the content of 2026-10-06.2 again, as a new edition."
      action="Go back"
      tone="destructive"
      reason={{ required: true }}
      confirmText="2026-10-06.2"
      {...props}
      onConfirm={onConfirm}
    />,
  )
  return { onConfirm }
}

describe('ConfirmDialog gating', () => {
  it('does not act without a reason and the typed edition, and says what is missing', async () => {
    const user = userEvent.setup()
    const { onConfirm } = openDialog()
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Go back to edition 2026-10-06.2?',
    })
    expect(dialog).toHaveAccessibleDescription(/as a new edition/)

    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(onConfirm).not.toHaveBeenCalled()
    const why = screen.getByRole('textbox', { name: /Why/ })
    expect(why).toHaveAttribute('aria-invalid', 'true')
    expect(why).toHaveAccessibleDescription(/Give a reason\./)
    expect(why).toHaveFocus()
    expect(screen.getByText('Type 2026-10-06.2 to confirm.')).toBeInTheDocument()
  })

  it('does not act when the typed text differs, even by one character', async () => {
    const user = userEvent.setup()
    const { onConfirm } = openDialog()
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await user.type(
      await screen.findByRole('textbox', { name: /Why/ }),
      'The United States item was wrong.',
    )
    await user.type(
      screen.getByRole('textbox', { name: /Type 2026-10-06.2 to confirm/ }),
      '2026-10-06.',
    )
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText("This doesn't match 2026-10-06.2.")).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Type 2026-10-06.2 to confirm/ })).toHaveFocus()
  })

  it('acts once everything is in order, with the reason trimmed, and closes', async () => {
    const user = userEvent.setup()
    const { onConfirm } = openDialog()
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await user.type(
      await screen.findByRole('textbox', { name: /Why/ }),
      '  Back to the last good edition.  ',
    )
    await user.type(
      screen.getByRole('textbox', { name: /Type 2026-10-06.2 to confirm/ }),
      '2026-10-06.2',
    )
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(onConfirm).toHaveBeenCalledWith({ reason: 'Back to the last good edition.' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('acts with Command or Control Enter from the reason, with the same checks', async () => {
    const user = userEvent.setup()
    const pageKeys = vi.fn()
    window.document.addEventListener('keydown', pageKeys)
    const { onConfirm } = openDialog({ confirmText: undefined, tone: 'default' })
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    const why = await screen.findByRole('textbox', { name: /Why/ })
    // The dialog moves focus to the reason a moment after it shows; the keys go where it is.
    await waitFor(() => expect(why).toHaveFocus())
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(why).toHaveAttribute('aria-invalid', 'true')
    await user.type(why, 'Checked against the source.')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(onConfirm).toHaveBeenCalledWith({ reason: 'Checked against the source.' })
    // The page under the dialog never gets the key, so its own main action does not run.
    expect(pageKeys).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }))
    window.document.removeEventListener('keydown', pageKeys)
  })

  it('stays open with the reason kept and the error shown when the action fails', async () => {
    const user = userEvent.setup()
    openDialog({
      confirmText: undefined,
      onConfirm: () => Promise.reject(new Error('Someone else claimed it.')),
    })
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await user.type(await screen.findByRole('textbox', { name: /Why/ }), 'Wrong edition.')
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Go back didn't go through")
    expect(screen.getByRole('alert')).toHaveTextContent('Someone else claimed it.')
    expect(screen.getByRole('textbox', { name: /Why/ })).toHaveValue('Wrong edition.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('cannot be closed while the action runs', async () => {
    const user = userEvent.setup()
    let finish = () => {}
    openDialog({
      confirmText: undefined,
      reason: undefined,
      onConfirm: () => new Promise<void>((resolve) => (finish = resolve)),
    })
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await act(() => {
      finish()
      return Promise.resolve()
    })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('starts on the reason, or on Cancel for a destructive action without one', async () => {
    const user = userEvent.setup()
    const first = render(
      <ConfirmDialog
        trigger={<Button>Accept</Button>}
        title="Accept this change?"
        effect="It is published as edition 2026-10-08.1."
        action="Accept"
        reason={{ required: true }}
        onConfirm={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Why/ })).toHaveFocus())
    first.unmount()

    render(
      <ConfirmDialog
        trigger={<Button>Stop delivery</Button>}
        title="Stop delivery?"
        effect="Agents get no context from Commercial within 60 seconds."
        action="Stop delivery"
        tone="destructive"
        onConfirm={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Stop delivery' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
  })

  it('returns focus to the trigger after Cancel', async () => {
    const user = userEvent.setup()
    openDialog({ confirmText: undefined })
    const trigger = screen.getByRole('button', { name: 'Go back' })
    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe('reason suggestions (heed-ux A10)', () => {
  const suggestions = ['Checked the evidence', 'Confirmed with the owner']

  it('fills in the reason from a chip, keeps it editable, and still requires one', async () => {
    const user = userEvent.setup()
    const { onConfirm } = openDialog({
      reason: { label: 'Reason', required: true, suggestions },
      confirmText: undefined,
      tone: 'default',
    })
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    const chips = await screen.findByRole('group', { name: 'Common reasons' })
    const field = screen.getByRole('textbox', { name: /Reason/ })

    await user.click(within(chips).getByRole('button', { name: 'Checked the evidence' }))
    expect(field).toHaveValue('Checked the evidence')
    expect(within(chips).getByRole('button', { name: 'Checked the evidence' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // Another chip replaces it; unpressing it clears the reason, which is still required.
    await user.click(within(chips).getByRole('button', { name: 'Confirmed with the owner' }))
    expect(field).toHaveValue('Confirmed with the owner')
    await user.click(within(chips).getByRole('button', { name: 'Confirmed with the owner' }))
    expect(field).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(within(chips).getByRole('button', { name: 'Checked the evidence' }))
    await user.type(field, ' against the notice')
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(onConfirm).toHaveBeenCalledWith({ reason: 'Checked the evidence against the notice' })
  })

  it('adds a chip after words the person wrote, never over them', () => {
    expect(suggestedReason('', 'Checked the evidence', suggestions)).toBe('Checked the evidence')
    expect(suggestedReason('Confirmed with the owner', 'Checked the evidence', suggestions)).toBe(
      'Checked the evidence',
    )
    expect(suggestedReason('Read the notice', 'Checked the evidence', suggestions)).toBe(
      'Read the notice. Checked the evidence',
    )
    expect(suggestedReason('Read the notice.', 'Checked the evidence', suggestions)).toBe(
      'Read the notice. Checked the evidence',
    )
    expect(suggestedReason('Checked the evidence', undefined, suggestions)).toBe('')
    expect(suggestedReason('Read the notice', undefined, suggestions)).toBe('Read the notice')
  })
})

describe('the confirmation rules', () => {
  it('needs a reason only when asked, and at most the maximum', () => {
    expect(check({ reasonText: '', max: 500, typed: '' })).toEqual({})
    expect(check({ reason: {}, reasonText: '', max: 500, typed: '' })).toEqual({})
    expect(check({ reason: { required: true }, reasonText: '   ', max: 500, typed: '' })).toEqual({
      reason: 'Give a reason.',
    })
    expect(check({ reason: {}, reasonText: 'x'.repeat(501), max: 500, typed: '' })).toEqual({
      reason: 'Shorten it by 1 character.',
    })
    expect(check({ reason: {}, reasonText: 'x'.repeat(510), max: 500, typed: '' })).toEqual({
      reason: 'Shorten it by 10 characters.',
    })
  })

  it('counts characters, not code units, against the maximum', () => {
    expect(check({ reason: {}, reasonText: '😀'.repeat(500), max: 500, typed: '' })).toEqual({})
  })

  it('needs the exact text, ignoring spaces around it', () => {
    const base = { reasonText: '', max: 500 }
    expect(check({ ...base, confirmText: 'Commercial', typed: ' Commercial ' })).toEqual({})
    expect(check({ ...base, confirmText: 'Commercial', typed: 'commercial' })).toEqual({
      confirm: "This doesn't match Commercial.",
    })
    expect(check({ ...base, confirmText: 'Commercial', typed: '' })).toEqual({
      confirm: 'Type Commercial to confirm.',
    })
  })
})

describe('ConfirmDialog with the effect first and a done step', () => {
  function Stepped({
    state = 'ready',
    onConfirm = vi.fn(),
  }: {
    state?: 'pending' | 'ready' | 'refused'
    onConfirm?: () => Promise<void> | void
  }) {
    const [done, setDone] = useState(false)
    return (
      <ConfirmDialog
        trigger={<Button>Go back</Button>}
        title="Go back to edition 2026-10-06.2?"
        effect="Agents get the content of 2026-10-06.2 again, as a new edition."
        action="Go back"
        tone="destructive"
        reason={{ required: true }}
        confirmText="2026-10-06.2"
        review={{
          state,
          content:
            state === 'refused' ? (
              <p>This edition cannot come back.</p>
            ) : (
              <p>2 items change for agents.</p>
            ),
        }}
        done={
          done
            ? {
                title: 'Edition 2026-10-07.3 is live',
                content: <p>Ravi Kapoor went back.</p>,
                actions: <Button>Go back to 2026-10-07.2…</Button>,
              }
            : null
        }
        onConfirm={async () => {
          await onConfirm()
          setDone(true)
        }}
      />
    )
  }

  it('shows the effect first, and the reason and the typing only after Continue', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<Stepped onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Step 1 of 2 · Check what changes')
    expect(dialog).toHaveTextContent('2 items change for agents.')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(dialog).toHaveTextContent('Step 2 of 2 · Confirm')
    expect(screen.getByRole('textbox', { name: /Why/ })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(dialog).toHaveTextContent('2 items change for agents.')
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('waits for the effect before it goes on', async () => {
    const user = userEvent.setup()
    render(<Stepped state="pending" />)
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    const go = await screen.findByRole('button', { name: 'Continue' })
    expect(go).toHaveAttribute('aria-disabled', 'true')
    await user.click(go)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('offers only Close when the action cannot go ahead', async () => {
    const user = userEvent.setup()
    render(<Stepped state="refused" />)
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('This edition cannot come back.')
    expect(dialog).not.toHaveTextContent('Step 1 of 2')
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('stays open after the action on what happened, with the way to undo it', async () => {
    const user = userEvent.setup()
    render(<Stepped />)
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    await user.type(screen.getByRole('textbox', { name: /Why/ }), 'A wrong caveat.')
    await user.type(
      screen.getByRole('textbox', { name: /Type 2026-10-06.2 to confirm/ }),
      '2026-10-06.2',
    )
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Edition 2026-10-07.3 is live',
    })
    expect(dialog).toHaveTextContent('Ravi Kapoor went back.')
    expect(screen.getByRole('button', { name: 'Go back to 2026-10-07.2…' })).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus())
  })
})

describe('ConfirmDialog locked until the words are typed (FR-814, as AWS deletes)', () => {
  const deleting = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) =>
    openDialog({
      trigger: <Button>Delete Practice</Button>,
      title: 'Delete Practice?',
      effect: 'Everything under Practice is handled in this one step.',
      action: 'Delete domain',
      reason: { label: 'Why' },
      confirmText: 'permanently delete',
      lockUntilTyped: true,
      ...props,
    })

  it('keeps the button disabled until the exact words are typed, then acts', async () => {
    const user = userEvent.setup()
    const { onConfirm } = deleting()
    await user.click(screen.getByRole('button', { name: 'Delete Practice' }))
    const field = await screen.findByRole('textbox', {
      name: 'Type permanently delete to confirm',
    })
    const button = screen.getByRole('button', { name: 'Delete domain' })
    expect(button).toBeDisabled()
    await user.type(field, 'Practice')
    expect(button).toBeDisabled()
    await user.clear(field)
    await user.type(field, 'permanently delet')
    expect(button).toBeDisabled()
    await user.type(field, 'e')
    expect(button).toBeEnabled()
    await user.click(button)
    expect(onConfirm).toHaveBeenCalledWith({ reason: '' })
  })

  it('stays disabled while what it does loads, even with the words typed', async () => {
    const user = userEvent.setup()
    const { onConfirm } = deleting({ hold: 'waiting' })
    await user.click(screen.getByRole('button', { name: 'Delete Practice' }))
    await user.type(
      await screen.findByRole('textbox', { name: 'Type permanently delete to confirm' }),
      'permanently delete{Control>}{Enter}{/Control}',
    )
    expect(screen.getByRole('button', { name: 'Delete domain' })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('offers only Close, with no fields, when it cannot go ahead', async () => {
    const user = userEvent.setup()
    deleting({ hold: 'refused', children: <p>The demo domain always exists.</p> })
    await user.click(screen.getByRole('button', { name: 'Delete Practice' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('The demo domain always exists.')
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete domain' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
})
