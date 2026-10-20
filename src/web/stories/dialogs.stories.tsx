import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { BlockedButton } from '@/components/ui/blocked-button'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { reasonSuggestions } from '@/components/review/decision-bar'
import { TermOption } from '@/components/app-shell/command-palette'
import { KindIcon } from '@/components/item/item-marks'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import {
  ArchiveIcon,
  CheckIcon,
  CircleStopIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SendIcon,
  SigmaIcon,
} from '@/components/icons'
import { rankTerms } from '@/lib/catalogue'
import { mockCatalogue } from '@/mocks/catalogue'
import { areas, FIXTURE_TODAY, vocabulary } from '@/mocks/reference-data'
import { LONG_LABEL, StateRow, StoryPaper, stateParameters } from './form-story-parts'

const meta = {
  title: 'Forms/Dialogs',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

/** Going back: a reason, then the edition number typed to confirm. */
export const TypeToConfirm: Story = {
  render: () => (
    <StoryPaper>
      <ConfirmDialog
        open
        title="Go back to how it was on 6 October 2026?"
        effect="AI apps get the facts of edition 2026-10-06.2 again. 14 facts change: 3 return to an earlier version, 1 archived fact comes back and 10 newer facts stop being shared."
        action="Go back"
        actionIcon={RotateCcwIcon}
        tone="destructive"
        reason={{
          required: true,
          defaultValue:
            'The United States fact was wrong. Back to the last good edition while we fix it.',
        }}
        confirmText="2026-10-06.2"
        onConfirm={() => wait(800)}
      />
    </StoryPaper>
  ),
}

/**
 * A guarded action in two steps (Editions design S5): the real effect first, read from the
 * service, then the reason and the typing. The list is the preview's own rows, 40 pixels each.
 */
export const EffectFirst: Story = {
  render: () => (
    <StoryPaper>
      <ConfirmDialog
        open
        title="Go back to how it was on 6 October 2026?"
        effect="AI apps get the facts of edition 2026-10-06.2 again. Nothing is deleted, and you can undo this."
        review={{
          state: 'ready',
          content: (
            <div className="flex flex-col gap-3">
              <p className="text-body">
                3 facts change for AI apps: 1 stops being shared, 1 comes back and 1 returns to an
                earlier version.
              </p>
              <ul
                aria-label="What changes for AI apps"
                className="flex flex-col divide-y divide-border-subtle rounded-sm border"
              >
                {[
                  ['note', 'Net revenue excludes test accounts', 'Stops being shared'],
                  ['issue', 'Poland order delay', 'Comes back'],
                  ['event', 'United States launch moved', 'Version 3 returns to version 2'],
                ].map(([kind, title, effect]) => (
                  <li key={title} className="flex min-h-row items-center gap-3 px-3">
                    <KindIcon kind={kind as 'note'} />
                    <span className="min-w-0 flex-1 truncate text-dense">{title}</span>
                    <span className="text-dense text-muted-foreground">{effect}</span>
                  </li>
                ))}
              </ul>
            </div>
          ),
        }}
        action="Go back"
        actionIcon={RotateCcwIcon}
        tone="destructive"
        reason={{ required: true, label: 'Why are you going back?' }}
        confirmText="2026-10-06.2"
        onConfirm={() => wait(400)}
      />
    </StoryPaper>
  ),
}

/** The effect is still loading: Continue waits for it. */
export const EffectLoading: Story = {
  render: () => (
    <StoryPaper>
      <ConfirmDialog
        open
        title="Go back to how it was on 6 October 2026?"
        effect="AI apps get the facts of edition 2026-10-06.2 again."
        review={{ state: 'pending', content: <p className="text-body">Loading what changes…</p> }}
        action="Go back"
        tone="destructive"
        reason={{ required: true }}
        confirmText="2026-10-06.2"
        onConfirm={() => wait(400)}
      />
    </StoryPaper>
  ),
}

/** The action cannot go ahead: the first step says why, and offers only Close. */
export const EffectRefused: Story = {
  render: () => (
    <StoryPaper>
      <ConfirmDialog
        open
        title="Go back to how it was on 2 August 2026?"
        effect="AI apps get the facts of edition 2026-08-02.1 again."
        review={{
          state: 'refused',
          content: (
            <p className="text-body">
              One of its fact versions can&apos;t be shared with AI apps again. Nothing has changed.
            </p>
          ),
        }}
        action="Go back"
        tone="destructive"
        reason={{ required: true }}
        confirmText="2026-08-02.1"
        onConfirm={() => wait(400)}
      />
    </StoryPaper>
  ),
}

/** After the action: what happened, and the way to undo it, which is its own confirmed action. */
export const Done: Story = {
  render: () => (
    <StoryPaper>
      <ConfirmDialog
        trigger={
          <Button variant="outline">
            <RotateCcwIcon aria-hidden />
            Go back
          </Button>
        }
        title="Go back to how it was on 6 October 2026?"
        effect="AI apps get the facts of edition 2026-10-06.2 again."
        action="Go back"
        actionIcon={RotateCcwIcon}
        tone="destructive"
        reason={{ required: true, defaultValue: 'The United States fact was wrong.' }}
        done={{
          title: 'Went back to 6 October 2026',
          content: (
            <p className="text-body">
              From now on, AI apps get the facts of edition 2026-10-06.2 again, saved as the new
              edition 2026-10-08.1. Nothing was deleted.
            </p>
          ),
          actions: (
            <Button variant="outline" size="lg">
              <RotateCcwIcon aria-hidden />
              Go back to 2026-10-07.2…
            </Button>
          ),
        }}
        onConfirm={() => wait(200)}
      />
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Go back' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /Type 2026-10-06.2 to confirm/ }),
      '2026-10-06.2',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Go back' }))
    await expect(
      await screen.findByRole('alertdialog', { name: 'Went back to 6 October 2026' }),
    ).toBeVisible()
  },
}

/** Pressing the action with nothing filled in says what is missing, beside each field. */
export const Gating: Story = {
  render: () => (
    <StoryPaper>
      <ConfirmDialog
        trigger={
          <Button variant="outline">
            <CircleStopIcon aria-hidden />
            Stop sharing
          </Button>
        }
        title="Stop sharing Sales with AI apps?"
        effect="Within a minute, AI apps get no facts from Sales. Nothing is lost, and you can start again at any time."
        action="Stop sharing"
        actionIcon={CircleStopIcon}
        tone="destructive"
        reason={{ required: true }}
        confirmText="Sales"
        onConfirm={() => wait(400)}
      />
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Stop sharing' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Stop sharing Sales with AI apps?',
    })
    const why = within(dialog).getByRole('textbox', { name: 'Why' })
    await waitFor(() => expect(why).toHaveFocus())
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop sharing' }))
    await expect(why).toHaveAttribute('aria-invalid', 'true')
    await expect(within(dialog).getByText('Type Sales to confirm.')).toBeVisible()
    await userEvent.type(why, 'A wrong caveat is reaching answers.')
    await userEvent.tab()
    await userEvent.keyboard('Sale')
    await userEvent.keyboard('{Enter}')
    await expect(within(dialog).getByText("This doesn't match Sales.")).toBeVisible()
    await expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  },
}

export const Decisions: Story = {
  render: () => (
    <StoryPaper>
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          trigger={
            <Button>
              <CheckIcon aria-hidden />
              Accept
            </Button>
          }
          title="Accept this change?"
          effect={
            <>
              This is a <strong className="font-bold">high-risk</strong> change. We save your yes
              now. AI apps get it once the approver accepts too.
            </>
          }
          action="Accept"
          actionIcon={CheckIcon}
          reason={{
            label: 'Why are you accepting it?',
            required: true,
            hint: 'Everyone who can see the proposal can read this.',
            suggestions: reasonSuggestions.accept.change,
          }}
          onConfirm={() => wait(600)}
        />
        <ConfirmDialog
          trigger={
            <Button variant="outline">
              <MessageSquareIcon aria-hidden />
              Ask for changes
            </Button>
          }
          title="Ask Kofi Mensah for changes?"
          effect="Kofi sees your reason and can change it and send it again. The time to review starts again when it comes back."
          action="Ask for changes"
          actionIcon={MessageSquareIcon}
          reason={{
            label: 'Why are you asking for changes?',
            required: true,
            hint: 'Everyone who can see the proposal can read this.',
            suggestions: reasonSuggestions.request_changes.change,
          }}
          onConfirm={() => wait(600)}
        />
        <ConfirmDialog
          trigger={<Button variant="destructive">Reject</Button>}
          title="Reject this proposal?"
          effect="Rejecting closes it, and AI apps never get it. Kofi can start a new draft from it."
          action="Reject"
          tone="destructive"
          reason={{
            label: 'Why are you rejecting it?',
            required: true,
            defaultValue: 'This changes how a metric is defined, so it belongs in Cube.',
            note: 'Filled in from “Reject with this reason”. You can change it.',
            suggestions: reasonSuggestions.reject.change,
          }}
          onConfirm={() => wait(600)}
        />
      </div>
    </StoryPaper>
  ),
}

/** One click fills in a common reason, which stays editable and required (heed-ux A10). */
export const ReasonChips: Story = {
  render: () => (
    <StoryPaper>
      <ConfirmDialog
        trigger={
          <Button>
            <CheckIcon aria-hidden />
            Accept
          </Button>
        }
        title="Accept this proposal?"
        effect="AI apps get it within a minute."
        action="Accept"
        actionIcon={CheckIcon}
        reason={{
          label: 'Why are you accepting it?',
          required: true,
          hint: 'Everyone who can see the proposal can read this.',
          suggestions: reasonSuggestions.accept.create,
        }}
        onConfirm={() => wait(600)}
      />
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Accept' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Checked the source' }))
    await expect(
      within(dialog).getByRole('textbox', { name: 'Why are you accepting it?' }),
    ).toHaveValue('Checked the source')
  },
}

/** Archiving shows what it is about, then the effect. */
export const Retire: Story = {
  render: () => (
    <StoryPaper>
      <ConfirmDialog
        open
        title="Archive this fact?"
        effect={
          <>
            AI apps stop getting it at once. You can still read it and its history.{' '}
            <strong className="font-bold">4 facts mention it</strong>, and those links will show
            &quot;Archived&quot;.
          </>
        }
        action="Archive fact"
        actionIcon={ArchiveIcon}
        tone="destructive"
        reason={{ required: true, label: 'Why are you archiving it?' }}
        onConfirm={() => wait(600)}
      >
        <p className="flex items-center gap-3 text-body font-bold">
          <KindIcon kind="note" decorative />
          Average order value lags by one day in the source tool
        </p>
      </ConfirmDialog>
    </StoryPaper>
  ),
}

/** The action failed: the dialog stays, with the reason kept and the error at the top. */
export const Failed: Story = {
  render: () => (
    <StoryPaper>
      <ConfirmDialog
        open
        title="Suggest archiving this fact?"
        effect="An owner of Sales decides. AI apps keep getting the fact until then."
        action="Suggest archiving"
        actionIcon={SendIcon}
        reason={{
          required: true,
          label: 'Why should it be archived?',
          defaultValue: 'Cube fixed the delay on 1 October.',
        }}
        onConfirm={() => Promise.reject(new Error('Someone already suggested archiving it.'))}
      />
    </StoryPaper>
  ),
  play: async () => {
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suggest archiving' }))
    await expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Someone already suggested archiving it.',
    )
  },
}

/** While the action runs the button shows a spinner (after 150 ms) and nothing can close it. */
export const Submitting: Story = {
  render: () => (
    <StoryPaper>
      <ConfirmDialog
        open
        title="Checked, still correct?"
        effect="You checked the fact against its source. It stays as written, and AI apps are no longer told it may be out of date."
        action="Checked, still correct"
        actionIcon={CheckIcon}
        reason={{
          required: true,
          label: 'What you checked',
          defaultValue: 'Calculation still excludes test accounts.',
        }}
        onConfirm={() => new Promise<void>(() => {})}
      />
    </StoryPaper>
  ),
  play: async () => {
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Checked, still correct' }))
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('Working'))
    await expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  },
}

/** The plain alert dialog, for a question with no reason to give. */
export const Alert: Story = {
  render: () => (
    <StoryPaper>
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without submitting?</AlertDialogTitle>
            <AlertDialogDescription>
              Your draft is saved. You can come back to it from Proposals.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <Button size="lg">Leave</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StoryPaper>
  ),
}

export const LongTitle: Story = {
  render: () => (
    <StoryPaper>
      <ConfirmDialog
        open
        title={LONG_LABEL}
        effect={LONG_LABEL}
        action="Archive fact"
        tone="destructive"
        onConfirm={() => wait(400)}
      />
    </StoryPaper>
  ),
}

/**
 * The rendered width of the open dialog against its contract size (`dialog` 480, `dialog-wide`
 * 640), held 16px in from each edge on a phone. The width class and the gutter cap once fought
 * over one property, and the gutter won: the palette filled the screen.
 */
async function expectDialogWidth(name: string, contract: number) {
  const dialog = await screen.findByRole('dialog', { name })
  await waitFor(() =>
    expect(Math.round(dialog.getBoundingClientRect().width)).toBe(
      Math.min(contract, window.innerWidth - 32),
    ),
  )
}

/** A plain dialog takes the form dialog width, 480. */
export const FormDialog: Story = {
  render: () => (
    <StoryPaper>
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave with unsaved changes?</DialogTitle>
            <DialogDescription>
              Your latest edits have not reached the service. Stay to finish saving them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline">Leave this page</Button>
            <Button>Keep writing</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StoryPaper>
  ),
  play: () => expectDialogWidth('Leave with unsaved changes?', 480),
}

/** The command palette: 640 wide, centred, near the top of the screen. */
export const CommandPalette: Story = {
  render: () => (
    <StoryPaper>
      <CommandDialog
        open
        title="Command palette"
        description="Jump to a fact, a page or an action."
      >
        <Command loop>
          <CommandInput
            placeholder="Jump to a fact, a page or an action"
            aria-label="Search facts, pages and actions"
          />
          <CommandList>
            <CommandGroup heading="Go to">
              <CommandItem>
                <span>Library</span>
                <CommandShortcut>G L</CommandShortcut>
              </CommandItem>
              <CommandItem>
                <span>Proposals</span>
                <CommandShortcut>G P</CommandShortcut>
              </CommandItem>
              <CommandItem>
                <span>Gaps</span>
                <CommandShortcut>G G</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </StoryPaper>
  ),
  play: () => expectDialogWidth('Command palette', 640),
}

/**
 * The palette's catalogue results (contract 9.1): a metric or dimension named outright leads, with
 * its type tile, its name and its domain badge as in the catalogue.
 */
export const CommandPaletteCatalogueTerms: Story = {
  render: () => {
    const terms = rankTerms(
      mockCatalogue([], { vocabulary, today: FIXTURE_TODAY }).list().terms,
      'mar',
      3,
    )
    return (
      <StoryPaper>
        <CommandDialog
          open
          title="Command palette"
          description="Jump to a fact, a page or an action."
        >
          <Command shouldFilter={false} loop>
            <CommandInput
              value="mar"
              placeholder="Jump to a fact, a page or an action"
              aria-label="Search facts, pages and actions"
            />
            <CommandList>
              <CommandGroup heading="Metrics and dimensions">
                {terms.map(({ term }) => (
                  <TermOption key={term.key} term={term} areas={areas} onSelect={() => {}} />
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </CommandDialog>
      </StoryPaper>
    )
  },
  play: async () => {
    const group = await screen.findByRole('group', { name: 'Catalogue' })
    const options = within(group).getAllByRole('option')
    await expect(options.length).toBeGreaterThan(1)
    // The tile names the type, so the option reads "Dimension Market Sandbox".
    for (const option of options) await expect(option).toHaveAccessibleName(/^(Metric|Dimension) /)
    // The domain badge ends at the row's padding edge, the column a command's shortcut ends at.
    for (const option of options) {
      const badge = option.querySelector('[data-slot=domain-badge]')!
      const edge =
        option.getBoundingClientRect().right - parseFloat(getComputedStyle(option).paddingRight)
      await expect(Math.round(badge.getBoundingClientRect().right)).toBe(Math.round(edge))
    }
  },
}

/** The phone panel from the bottom edge: swipe down, Escape or the scrim close it. */
export const PhoneDrawer: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: () => (
    <StoryPaper>
      <Drawer defaultOpen>
        <DrawerTrigger render={<Button variant="outline">What AI apps will get</Button>} />
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>What AI apps will get</DrawerTitle>
            <DrawerDescription>
              For a question about Units sold in Norway on 4 Aug 2026.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-3 px-4 pb-4 text-body">
            <p className="font-bold">
              Online sales to Norway stopped on 4 August 2026 after a new customs rule
            </p>
            <p className="text-muted-foreground">
              From 4 August 2026, still going on. Source: customs.example, read 5 Aug 2026.
            </p>
          </div>
          <DrawerFooter>
            <DrawerClose
              render={
                <Button variant="outline" size="lg">
                  Close
                </Button>
              }
            />
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </StoryPaper>
  ),
}

/** A card on hover after 300 ms or on keyboard focus, for a mention or a person. */
export const HoverCardOpen: Story = {
  name: 'Hover card',
  render: () => (
    <StoryPaper>
      <p className="text-body">
        Compare{' '}
        <HoverCard defaultOpen>
          <HoverCardTrigger
            href="#orders"
            className="font-bold underline decoration-dotted underline-offset-4"
          >
            Orders
          </HoverCardTrigger>
          <HoverCardContent>
            <p className="flex items-center gap-2 font-bold">
              <SigmaIcon aria-hidden className="size-4 text-muted-foreground" />
              Orders
            </p>
            <p className="text-muted-foreground">
              Metric in Payments. The value of paid orders, per day.
            </p>
            <p className="text-caption text-muted-foreground">Used by 12 context items.</p>
          </HoverCardContent>
        </HoverCard>{' '}
        before and after the pause.
      </p>
    </StoryPaper>
  ),
}

/** Blocked, never hidden: visible, focusable, and it says why. */
export const Blocked: Story = {
  parameters: stateParameters,
  render: () => (
    <StoryPaper>
      <StateRow name="Default">
        <div className="flex flex-wrap gap-2">
          <BlockedButton
            variant="default"
            reason="Answer tests on the whole domain are still running. About 9 minutes."
          >
            Accept
          </BlockedButton>
          <BlockedButton reason="You wrote this proposal. Sofia Brandt, the deputy, can decide.">
            Ask for changes
          </BlockedButton>
        </div>
      </StateRow>
      <StateRow name="Hover" id="state-hover">
        <BlockedButton
          variant="default"
          reason="Sofia Brandt is reviewing this. Ask her to hand it over, or wait."
        >
          Accept
        </BlockedButton>
      </StateRow>
      <StateRow name="Focus visible" id="state-focus">
        <BlockedButton
          variant="default"
          reason="Sofia Brandt is reviewing this. Ask her to hand it over, or wait."
        >
          Accept
        </BlockedButton>
      </StateRow>
      <StateRow name="200 character label">
        <BlockedButton reason={LONG_LABEL} className="max-w-full">
          <span className="truncate">{LONG_LABEL}</span>
        </BlockedButton>
      </StateRow>
    </StoryPaper>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [accept] = canvas.getAllByRole('button', { name: 'Accept' })
    if (!accept) throw new Error('No Accept button')
    await expect(accept).toHaveAttribute('aria-disabled', 'true')
    await expect(accept).toHaveAccessibleDescription(/still running/)
    accept.focus()
    await userEvent.keyboard('{Enter}')
    await expect(await screen.findByText('Accept is blocked')).toBeVisible()
  },
}
