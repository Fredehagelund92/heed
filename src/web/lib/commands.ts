import type { Icon } from '@/components/icons'
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BotIcon,
  CheckIcon,
  CircleXIcon,
  Columns2Icon,
  KeyboardIcon,
  LinkIcon,
  ListChecksIcon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SquarePenIcon,
  StarIcon,
  SunIcon,
  Trash2Icon,
  Undo2Icon,
  UserRoundCheckIcon,
  XIcon,
} from '@/components/icons'
import type { Permissions } from '@/api'
import type { Appearance } from '@/lib/appearance'
import { navItems, type NavItem, type NavTo } from '@/lib/nav'
import { isFor } from '@/lib/permissions'

export type CommandGroup =
  'On this page' | 'Review' | 'Go to' | 'Ask' | 'Create' | 'Appearance' | 'View'

/**
 * What the library list offers while it is on screen. The list registers it; list commands run
 * against it. Every method acts on the cursor row (the focused row) or the selection.
 */
export type ListScope = {
  move: (delta: number, extendSelection?: boolean) => void
  moveTo: (edge: 'first' | 'last') => void
  toggleSelected: () => void
  /** Clears the selection, then the cursor. Returns false when there was nothing to clear. */
  clear: () => boolean
  focusSearch: () => void
  /** The cursor row's item, if any, for item commands such as favourite. */
  cursorItemId: () => string | null
  /**
   * Marks the focused or open row as viewed, or not, on a list that keeps a viewed mark (what
   * changed between editions); absent on the others.
   */
  toggleViewed?: () => void
  /**
   * Opens the open record's compare focus, or leaves it, on a list whose records compare two runs
   * side by side (the Workbench, with a test question open); absent on the others.
   */
  toggleCompare?: () => void
  /** Shows the open record's first, second or third tab, on a list beside a record with tabs. */
  showTab?: (index: number) => void
  /**
   * What can be done with the selected rows at once, on a list that has bulk actions (the review
   * queue, FR-223): how many are selected, which actions may run, and running one (each opens
   * the dialog that shows what will happen and asks for the reason). Absent on the others.
   */
  bulk?: {
    count: () => number
    can: (action: BulkAction) => boolean
    run: (action: BulkAction) => void
    selectAll: () => void
  }
  /**
   * Discarding drafts, on a list that holds the person's own (Proposals > Mine): how many the key
   * would discard (the selected drafts, or else the focused row when it is one), and asking to
   * (the confirmation names them first). Absent on the others.
   */
  discard?: {
    count: () => number
    run: () => void
  }
}

/** The bulk actions of the review queue (FR-223). */
export type BulkAction = 'accept' | 'request_changes' | 'reject' | 'assign'

/** What an item page offers while it is on screen. */
export type DocumentScope = {
  itemId: string
  next: () => void
  previous: () => void
}

/**
 * What the review screen offers while it is on screen (contract 9.2, the review scope): open a
 * decision's dialog, and the next or previous proposal in the queue. No key commits a decision;
 * a key only opens the dialog that asks for the reason.
 */
export type ReviewScope = {
  canOpen: (outcome: 'accept' | 'request_changes' | 'reject') => boolean
  open: (outcome: 'accept' | 'request_changes' | 'reject') => void
  next: (() => void) | null
  previous: (() => void) | null
}

/**
 * The owner's check on the item shown, while something asks for a look (CON-211): Mark as
 * checked, or Yes, still going on for an open issue past its review date. The key only opens the
 * dialog that asks what was checked; nothing is recorded without it (contract 9.4).
 */
export type CheckScope = {
  /** The check's name on its button, such as "Yes, still going on". */
  title: string
  open: () => void
}

/** What a command can do. The shell provides these; commands never import the router or the DOM. */
export type CommandContext = {
  /** Goes to a place, on the part of it named when it is not the first (a Settings section). */
  navigate: (to: NavTo, search?: NavItem['search']) => void
  /** The person's roles: a place they may not use is not offered. No roles while the session loads. */
  permissions?: Permissions
  /**
   * Docks the assistant beside the page on a tab, switches to it, or closes the assistant when it
   * already shows that tab: Ask (the assistant) or What an agent would get (Try it). Without a
   * tab it toggles the dock on the tab last shown. On the assistant's own page (or Try it's) it
   * docks the same conversation and returns to the page the person came from.
   */
  toggleAssistant?: (tab?: 'ask' | 'agent') => void
  /** Where the assistant is: closed, docked beside the page, or expanded to its own page. */
  assistant?: AssistantState
  /** Puts the focus in the composer of the assistant's page; only there. */
  focusAssistant?: () => void
  /** Starts the assistant's conversation afresh; while the assistant is docked or expanded. */
  newChat?: () => void
  setAppearance: (mode: Appearance) => void
  toggleSidebar: () => void
  openPalette?: () => void
  openShortcuts?: () => void
  addContext?: () => void
  toggleFavorite?: (itemId: string) => void
  isFavorite?: (itemId: string) => boolean
  copyLink?: (itemId: string) => void
  list?: ListScope | null
  document?: DocumentScope | null
  review?: ReviewScope | null
  check?: CheckScope | null
  /** The page's main action, such as "Submit for review" on a form (contract 9.2, Document). */
  mainAction?: MainAction | null
  /** Takes back the step held for Undo, while one is (contract 9.4). */
  undo?: (() => void) | null
  /**
   * On a record page: back to the page it was opened from when that is not on its trail, or else
   * up to the parent crumb; back when that is the entry behind (contract 9.11).
   */
  up?: (() => void) | null
  /** Where `up` goes, when it is back to the page the record was opened from. */
  backTo?: string
}

/**
 * The assistant's three states, never two at once (contract 9.8): closed, docked beside the page
 * (the launcher, Command or Control backslash), or expanded to its own page (the sidebar, g a).
 */
export type AssistantState = 'closed' | 'docked' | 'expanded'

/** What Command or Control Enter does on the page that registers it. */
export type MainAction = { title: string; run: () => void }

export type CommandScope = 'global' | 'list' | 'document' | 'review' | 'record' | 'check'

export type Command = {
  id: string
  title: string
  group: CommandGroup
  icon: Icon
  /** Where the command applies (contract 9.1). A scoped command is off when its screen is not shown. */
  scope: CommandScope
  /** Extra words the palette matches on. */
  keywords?: readonly string[]
  /** A react-hotkeys-hook string. Sequences use ">" ("g>l"). Shown as a hint and bound once, from here. */
  hotkey?: string
  /** Movement keys belong on the keyboard, not in the palette. */
  paletteHidden?: boolean
  /** Also runs while typing in a field or an editor, as the page's main action does. */
  whileTyping?: boolean
  /** Whether the command can run now. Absent means always, within its scope. */
  available?: (context: CommandContext) => boolean
  /**
   * Its availability follows what the screen does not re-render for, such as the focused row:
   * the key stays bound while its screen is shown, and `available` is asked when it is pressed.
   */
  checkedOnPress?: boolean
  /** A title that depends on the context, such as "Remove from favourites". */
  titleFor?: (context: CommandContext) => string
  run: (context: CommandContext) => void
}

/** The selection's bulk action may run: rows are selected and the person may take it. */
const bulkReady = (context: CommandContext, action: BulkAction) =>
  (context.list?.bulk?.count() ?? 0) > 0 && (context.list?.bulk?.can(action) ?? false)
const selectedWords = (context: CommandContext) => {
  const count = context.list?.bulk?.count() ?? 0
  return count === 1 ? 'the selected proposal' : `the ${count.toLocaleString('en')} selected`
}

const focusedItem = (context: CommandContext) =>
  context.document?.itemId ?? context.list?.cursorItemId() ?? null

/**
 * The one command registry. The palette lists it, the shell binds the hotkeys from it, the
 * shortcut sheet shows it and the hint next to each command is formatted from it. Add a command
 * here, nowhere else.
 */
export const commands: readonly Command[] = [
  {
    id: 'item.favorite',
    title: 'Add to favourites',
    group: 'On this page',
    icon: StarIcon,
    scope: 'global',
    hotkey: 'f',
    keywords: ['star', 'pin', 'favorite', 'bookmark'],
    available: (context) => focusedItem(context) !== null && context.toggleFavorite !== undefined,
    titleFor: (context) => {
      const id = focusedItem(context)
      return id && context.isFavorite?.(id) ? 'Remove from favourites' : 'Add to favourites'
    },
    run: (context) => {
      const id = focusedItem(context)
      if (id) context.toggleFavorite?.(id)
    },
  },
  {
    id: 'item.copy-link',
    title: 'Copy link',
    group: 'On this page',
    icon: LinkIcon,
    scope: 'global',
    keywords: ['share', 'url', 'address'],
    available: (context) => focusedItem(context) !== null && context.copyLink !== undefined,
    run: (context) => {
      const id = focusedItem(context)
      if (id) context.copyLink?.(id)
    },
  },
  {
    id: 'item.next',
    title: 'Next fact',
    group: 'On this page',
    icon: ArrowDownIcon,
    scope: 'document',
    hotkey: 'j',
    keywords: ['down', 'following'],
    run: (context) => context.document?.next(),
  },
  {
    id: 'item.previous',
    title: 'Previous fact',
    group: 'On this page',
    icon: ArrowUpIcon,
    scope: 'document',
    hotkey: 'k',
    keywords: ['up', 'before'],
    run: (context) => context.document?.previous(),
  },
  {
    id: 'item.check',
    title: 'Mark as checked',
    titleFor: (context) => context.check?.title ?? 'Mark as checked',
    group: 'On this page',
    icon: CheckIcon,
    scope: 'check',
    hotkey: 'y',
    keywords: [
      'checked',
      'still correct',
      'still going on',
      'check date',
      'review date',
      'confirm',
    ],
    run: (context) => context.check?.open(),
  },
  {
    id: 'page.up',
    title: 'Back to where you came from, or up',
    titleFor: (context) => (context.backTo ? `Back to ${context.backTo}` : 'Up to the parent page'),
    group: 'Go to',
    icon: ArrowLeftIcon,
    scope: 'record',
    hotkey: 'escape',
    keywords: ['back', 'close', 'return', 'list'],
    // With nothing open over the record; a list on the page has the key first.
    available: (context) => !context.list,
    run: (context) => context.up?.(),
  },
  {
    id: 'review.accept',
    title: 'Accept',
    group: 'Review',
    icon: CheckIcon,
    scope: 'review',
    hotkey: 'a',
    keywords: ['approve', 'decide', 'publish'],
    available: (context) => context.review?.canOpen('accept') ?? false,
    run: (context) => context.review?.open('accept'),
  },
  {
    id: 'review.request-changes',
    title: 'Ask for changes',
    group: 'Review',
    icon: MessageSquareIcon,
    scope: 'review',
    hotkey: 'r',
    keywords: ['decide', 'return', 'feedback'],
    available: (context) => context.review?.canOpen('request_changes') ?? false,
    run: (context) => context.review?.open('request_changes'),
  },
  {
    id: 'review.reject',
    title: 'Reject',
    group: 'Review',
    icon: CircleXIcon,
    scope: 'review',
    hotkey: 'shift+r',
    keywords: ['decide', 'decline'],
    available: (context) => context.review?.canOpen('reject') ?? false,
    run: (context) => context.review?.open('reject'),
  },
  {
    id: 'review.next',
    title: 'Next proposal to review',
    group: 'Review',
    icon: ArrowDownIcon,
    scope: 'review',
    hotkey: 'j',
    keywords: ['down', 'following', 'queue'],
    available: (context) => Boolean(context.review?.next),
    run: (context) => context.review?.next?.(),
  },
  {
    id: 'review.previous',
    title: 'Previous proposal to review',
    group: 'Review',
    icon: ArrowUpIcon,
    scope: 'review',
    hotkey: 'k',
    keywords: ['up', 'before', 'queue'],
    available: (context) => Boolean(context.review?.previous),
    run: (context) => context.review?.previous?.(),
  },
  {
    id: 'selection.accept',
    title: 'Accept the selected proposals',
    group: 'Review',
    icon: CheckIcon,
    scope: 'list',
    keywords: ['bulk', 'approve', 'decide', 'selected', 'all'],
    available: (context) => bulkReady(context, 'accept'),
    titleFor: (context) => `Accept ${selectedWords(context)}`,
    run: (context) => context.list?.bulk?.run('accept'),
  },
  {
    id: 'selection.request-changes',
    title: 'Ask for changes on the selected proposals',
    group: 'Review',
    icon: MessageSquareIcon,
    scope: 'list',
    keywords: ['bulk', 'return', 'feedback', 'selected'],
    available: (context) => bulkReady(context, 'request_changes'),
    titleFor: (context) => `Ask for changes on ${selectedWords(context)}`,
    run: (context) => context.list?.bulk?.run('request_changes'),
  },
  {
    id: 'selection.reject',
    title: 'Reject the selected proposals',
    group: 'Review',
    icon: CircleXIcon,
    scope: 'list',
    keywords: ['bulk', 'decline', 'selected'],
    available: (context) => bulkReady(context, 'reject'),
    titleFor: (context) => `Reject ${selectedWords(context)}`,
    run: (context) => context.list?.bulk?.run('reject'),
  },
  {
    id: 'selection.assign',
    title: 'Assign the selected proposals',
    group: 'Review',
    icon: UserRoundCheckIcon,
    scope: 'list',
    keywords: ['bulk', 'claim', 'hand over', 'reviewer', 'selected'],
    available: (context) => bulkReady(context, 'assign'),
    titleFor: (context) => `Assign ${selectedWords(context)}`,
    run: (context) => context.list?.bulk?.run('assign'),
  },
  {
    id: 'selection.all',
    title: 'Select every proposal in the list',
    group: 'Review',
    icon: ListChecksIcon,
    scope: 'list',
    keywords: ['bulk', 'select all', 'everything'],
    available: (context) => Boolean(context.list?.bulk),
    run: (context) => context.list?.bulk?.selectAll(),
  },
  {
    id: 'selection.discard',
    title: 'Discard the selected drafts',
    group: 'On this page',
    icon: Trash2Icon,
    scope: 'list',
    // Linear's delete. Only drafts the person never submitted; a sent proposal is withdrawn.
    hotkey: 'mod+backspace',
    keywords: ['delete', 'remove', 'throw away', 'draft', 'drafts', 'bin', 'trash'],
    available: (context) => (context.list?.discard?.count() ?? 0) > 0,
    // The focused row decides it, and focus moves without the list rendering again.
    checkedOnPress: true,
    titleFor: (context) => {
      const count = context.list?.discard?.count() ?? 0
      return count === 1 ? 'Discard the draft' : `Discard the ${count.toLocaleString('en')} drafts`
    },
    run: (context) => context.list?.discard?.run(),
  },
  {
    id: 'action.undo',
    title: 'Undo the step just taken',
    group: 'On this page',
    icon: Undo2Icon,
    scope: 'global',
    hotkey: 'mod+z',
    keywords: ['undo', 'take back', 'cancel'],
    available: (context) => Boolean(context.undo),
    run: (context) => context.undo?.(),
  },
  {
    id: 'page.main-action',
    title: 'Send or save',
    group: 'On this page',
    icon: SendIcon,
    scope: 'global',
    hotkey: 'mod+enter',
    whileTyping: true,
    keywords: ['submit', 'save', 'send', 'review'],
    available: (context) => Boolean(context.mainAction),
    titleFor: (context) => context.mainAction?.title ?? 'Send or save',
    run: (context) => context.mainAction?.run(),
  },
  {
    id: 'list.down',
    title: 'Move down',
    group: 'View',
    icon: ArrowDownIcon,
    scope: 'list',
    hotkey: 'j',
    paletteHidden: true,
    run: (context) => context.list?.move(1),
  },
  {
    id: 'list.up',
    title: 'Move up',
    group: 'View',
    icon: ArrowUpIcon,
    scope: 'list',
    hotkey: 'k',
    paletteHidden: true,
    run: (context) => context.list?.move(-1),
  },
  {
    id: 'list.down-arrow',
    title: 'Move down',
    group: 'View',
    icon: ArrowDownIcon,
    scope: 'list',
    hotkey: 'down',
    paletteHidden: true,
    run: (context) => context.list?.move(1),
  },
  {
    id: 'list.up-arrow',
    title: 'Move up',
    group: 'View',
    icon: ArrowUpIcon,
    scope: 'list',
    hotkey: 'up',
    paletteHidden: true,
    run: (context) => context.list?.move(-1),
  },
  {
    id: 'list.extend-down',
    title: 'Extend the selection down',
    group: 'View',
    icon: ArrowDownIcon,
    scope: 'list',
    hotkey: 'shift+j',
    paletteHidden: true,
    run: (context) => context.list?.move(1, true),
  },
  {
    id: 'list.extend-up',
    title: 'Extend the selection up',
    group: 'View',
    icon: ArrowUpIcon,
    scope: 'list',
    hotkey: 'shift+k',
    paletteHidden: true,
    run: (context) => context.list?.move(-1, true),
  },
  {
    id: 'list.first',
    title: 'First row',
    group: 'View',
    icon: ArrowUpIcon,
    scope: 'list',
    hotkey: 'home',
    paletteHidden: true,
    run: (context) => context.list?.moveTo('first'),
  },
  {
    id: 'list.last',
    title: 'Last row',
    group: 'View',
    icon: ArrowDownIcon,
    scope: 'list',
    hotkey: 'end',
    paletteHidden: true,
    run: (context) => context.list?.moveTo('last'),
  },
  {
    id: 'list.select',
    title: 'Select or unselect the row',
    group: 'View',
    icon: CheckIcon,
    scope: 'list',
    hotkey: 'x',
    paletteHidden: true,
    run: (context) => context.list?.toggleSelected(),
  },
  {
    id: 'list.viewed',
    title: 'Mark as viewed, or not',
    group: 'View',
    // The tick the shell already loads: the key is not in the palette, so no icon of its own.
    icon: CheckIcon,
    scope: 'list',
    hotkey: 'v',
    paletteHidden: true,
    available: (context) => Boolean(context.list?.toggleViewed),
    run: (context) => context.list?.toggleViewed?.(),
  },
  {
    id: 'list.compare',
    title: 'Compare the two runs side by side',
    group: 'View',
    icon: Columns2Icon,
    scope: 'list',
    // Shift: C alone adds context everywhere.
    hotkey: 'shift+c',
    keywords: ['compare', 'side by side', 'runs', 'editions'],
    available: (context) => Boolean(context.list?.toggleCompare),
    run: (context) => context.list?.toggleCompare?.(),
  },
  ...(['first', 'second', 'third'] as const).map((ordinal, index): Command => ({
    id: `list.tab-${index + 1}`,
    title: `Show the record's ${ordinal} tab`,
    group: 'View',
    icon: ArrowRightIcon,
    scope: 'list',
    hotkey: String(index + 1),
    paletteHidden: true,
    available: (context) => Boolean(context.list?.showTab),
    run: (context) => context.list?.showTab?.(index),
  })),
  {
    id: 'list.clear',
    title: 'Clear the selection',
    group: 'View',
    icon: XIcon,
    scope: 'list',
    hotkey: 'escape',
    paletteHidden: true,
    run: (context) => void context.list?.clear(),
  },
  {
    id: 'list.search',
    title: 'Search the library',
    group: 'View',
    icon: SearchIcon,
    scope: 'global',
    hotkey: 'slash',
    keywords: ['find', 'filter'],
    run: (context) => (context.list ? context.list.focusSearch() : context.openPalette?.()),
  },
  {
    id: 'create.item',
    title: 'Add a fact',
    group: 'Create',
    icon: PlusIcon,
    scope: 'global',
    hotkey: 'c',
    keywords: ['new', 'write', 'create', 'add context', 'item'],
    run: (context) => context.addContext?.(),
  },
  ...navItems.map((item): Command => ({
    id: `go.${item.id}`,
    title: item.title,
    group: 'Go to',
    icon: item.icon,
    scope: 'global',
    hotkey: item.hotkey,
    keywords: ['open', 'navigate', 'page', ...(item.keywords ?? [])],
    available: (context) => isFor(context.permissions, item.audience),
    // On the assistant's page, going to it again puts the focus in its composer and keeps the
    // scope in the address.
    run: (context) => {
      if (item.to === '/assistant' && context.focusAssistant) context.focusAssistant()
      else if (item.search) context.navigate(item.to, item.search)
      else context.navigate(item.to)
    },
  })),
  // The library's Deleted facts (the Bin page), an administrator's: it is no sidebar place, so
  // the palette and the library's View menu go to it.
  {
    id: 'go.deleted-items',
    title: 'Deleted facts',
    group: 'Go to',
    icon: Trash2Icon,
    scope: 'global',
    keywords: ['bin', 'trash', 'restore', 'deleted', 'removed', 'library', 'deleted items'],
    available: (context) => isFor(context.permissions, 'administrators'),
    run: (context) => context.navigate('/library/bin'),
  },
  // The assistant docked beside the page, as the launcher in the corner docks it. Command or
  // Control backslash toggles the dock (contract 9.2); on the assistant's page it docks the same
  // conversation instead. G then A goes to the page (the Assistant place, above).
  {
    id: 'ask.assistant',
    title: 'Ask the assistant',
    group: 'Ask',
    icon: BotIcon,
    scope: 'global',
    hotkey: 'mod+backslash',
    whileTyping: true,
    keywords: ['assistant', 'chat', 'help', 'question', 'panel', 'dock', 'side'],
    available: (context) => context.toggleAssistant !== undefined,
    titleFor: (context) =>
      context.assistant === 'expanded'
        ? 'Dock the assistant'
        : context.assistant === 'docked'
          ? 'Close the assistant'
          : 'Ask the assistant',
    run: (context) => context.toggleAssistant?.(),
  },
  {
    id: 'ask.new-chat',
    title: 'New chat',
    group: 'Ask',
    icon: SquarePenIcon,
    scope: 'global',
    keywords: ['assistant', 'chat', 'clear', 'start over', 'reset', 'conversation'],
    available: (context) => context.newChat !== undefined,
    run: (context) => context.newChat?.(),
  },
  {
    id: 'ask.agent',
    title: 'Try a question',
    group: 'Ask',
    icon: MessageSquareIcon,
    scope: 'global',
    hotkey: 'g>i',
    keywords: ['try it', 'what an agent would get', 'ai app', 'answer', 'question'],
    available: (context) => context.toggleAssistant !== undefined,
    run: (context) => context.toggleAssistant?.('agent'),
  },
  {
    id: 'appearance.light',
    title: 'Use light appearance',
    group: 'Appearance',
    icon: SunIcon,
    scope: 'global',
    keywords: ['theme', 'light mode'],
    run: ({ setAppearance }) => setAppearance('light'),
  },
  {
    id: 'appearance.dark',
    title: 'Use dark appearance',
    group: 'Appearance',
    icon: MoonIcon,
    scope: 'global',
    keywords: ['theme', 'dark mode'],
    run: ({ setAppearance }) => setAppearance('dark'),
  },
  {
    id: 'appearance.system',
    title: 'Follow system appearance',
    group: 'Appearance',
    icon: MonitorIcon,
    scope: 'global',
    keywords: ['theme', 'auto'],
    run: ({ setAppearance }) => setAppearance('system'),
  },
  {
    id: 'view.toggle-sidebar',
    title: 'Toggle sidebar',
    group: 'View',
    icon: PanelLeftIcon,
    scope: 'global',
    hotkey: 'mod+b',
    keywords: ['navigation', 'collapse', 'rail'],
    run: ({ toggleSidebar }) => toggleSidebar(),
  },
  {
    id: 'view.shortcuts',
    title: 'Keyboard shortcuts',
    group: 'View',
    icon: KeyboardIcon,
    scope: 'global',
    hotkey: 'shift+slash',
    keywords: ['help', 'keys', 'cheat sheet', 'hotkeys'],
    run: (context) => context.openShortcuts?.(),
  },
]

export const commandGroups: readonly CommandGroup[] = [
  'On this page',
  'Review',
  'Go to',
  'Ask',
  'Create',
  'Appearance',
  'View',
]

/** Whether a command's screen is shown: a scoped command is off when it is not. */
export function inScope(command: Command, context: CommandContext): boolean {
  if (command.scope === 'list' && !context.list) return false
  if (command.scope === 'document' && !context.document) return false
  if (command.scope === 'review' && !context.review) return false
  if (command.scope === 'record' && !context.up) return false
  if (command.scope === 'check' && !context.check) return false
  return true
}

/** Whether a command can run in this context: its screen is shown and its own check passes. */
export function isAvailable(command: Command, context: CommandContext): boolean {
  if (!inScope(command, context)) return false
  return command.available ? command.available(context) : true
}

export function commandTitle(command: Command, context: CommandContext): string {
  return command.titleFor ? command.titleFor(context) : command.title
}

const keyNames: Record<string, [mac: string, other: string]> = {
  mod: ['⌘', 'Ctrl'],
  shift: ['⇧', 'Shift'],
  alt: ['⌥', 'Alt'],
  escape: ['Esc', 'Esc'],
  enter: ['↵', 'Enter'],
  slash: ['/', '/'],
  backslash: ['\\', '\\'],
  up: ['↑', '↑'],
  down: ['↓', '↓'],
  home: ['Home', 'Home'],
  end: ['End', 'End'],
  backspace: ['⌫', 'Backspace'],
}

/** Formats a react-hotkeys-hook string for display: `mod+b` becomes the keys to press, `g>l` becomes G then L. */
export function formatHotkey(hotkey: string, isMac = isMacPlatform()): string[] {
  if (hotkey === 'shift+slash') return ['?']
  return hotkey.split('>').flatMap((step, index) => [
    ...(index > 0 ? ['then'] : []),
    ...step.split('+').map((part) => {
      const named = keyNames[part]
      if (named) return isMac ? named[0] : named[1]
      return part.length === 1 ? part.toUpperCase() : part
    }),
  ])
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
}
