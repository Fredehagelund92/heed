import { describe, expect, it, vi } from 'vitest'
import {
  commandGroups,
  commands,
  commandTitle,
  formatHotkey,
  isAvailable,
  type CommandContext,
  type DocumentScope,
  type ListScope,
} from '@/lib/commands'
import { navItems } from '@/lib/nav'

function context(extra: Partial<CommandContext> = {}): CommandContext {
  return { navigate: vi.fn(), setAppearance: vi.fn(), toggleSidebar: vi.fn(), ...extra }
}

function listScope(): ListScope {
  return {
    move: vi.fn(),
    moveTo: vi.fn(),
    toggleSelected: vi.fn(),
    clear: vi.fn(() => true),
    focusSearch: vi.fn(),
    cursorItemId: () => 'itm_cursor',
  }
}

function documentScope(): DocumentScope {
  return { itemId: 'itm_open', next: vi.fn(), previous: vi.fn() }
}

const byId = (id: string) => {
  const command = commands.find((candidate) => candidate.id === id)
  if (!command) throw new Error(`No command ${id}`)
  return command
}

describe('command registry', () => {
  it('has unique ids', () => {
    const ids = commands.map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never gives one shortcut to two commands in one scope (contract 9.1)', () => {
    for (const scope of ['list', 'document', 'record', 'check'] as const) {
      // A scoped screen also has every global shortcut, so global and scoped must not collide.
      const active = commands.filter(
        (command) => command.hotkey && (command.scope === 'global' || command.scope === scope),
      )
      const hotkeys = active.map((command) => command.hotkey)
      expect(new Set(hotkeys).size, `${scope}: ${hotkeys.join(' ')}`).toBe(hotkeys.length)
    }
  })

  it('puts every command in a known group, with a label', () => {
    for (const command of commands) {
      expect(commandGroups).toContain(command.group)
      expect(command.title.length).toBeGreaterThan(0)
    }
  })

  it('has one go-to command for every page in the navigation, with the contract shortcuts', () => {
    for (const item of navItems) {
      const ctx = context()
      byId(`go.${item.id}`).run(ctx)
      if (item.search) expect(ctx.navigate).toHaveBeenCalledWith(item.to, item.search)
      else expect(ctx.navigate).toHaveBeenCalledWith(item.to)
    }
    expect(byId('go.library').hotkey).toBe('g>l')
    expect(byId('go.gaps').hotkey).toBe('g>m')
    // Health keeps the Workbench's keys: G then H is Home.
    expect(byId('go.health').hotkey).toBe('g>w')
    expect(byId('go.home').hotkey).toBe('g>h')
    expect(byId('go.admin').hotkey).toBe('g>d')
    expect(byId('go.editions').hotkey).toBe('g>e')
    expect(byId('go.docs').hotkey).toBe('g>b')
    // Quality was retired with its entry (Workbench plan, slice W8), and its key with it; Areas
    // and MCP and gateway went into Health and Administration (navigation decision), with theirs.
    for (const gone of ['quality', 'workbench', 'areas', 'mcp'])
      expect(commands.some((command) => command.id === `go.${gone}`)).toBe(false)
    for (const key of ['g>q', 'g>r', 'g>t'])
      expect(commands.some((command) => command.hotkey === key)).toBe(false)
    // Connect an AI app is a section of the person's own Settings.
    const connect = context()
    byId('go.connect').run(connect)
    expect(connect.navigate).toHaveBeenCalledWith('/settings', { section: 'connect' })
    expect(byId('go.connect').hotkey).toBe('g>y')
    expect(byId('go.settings').hotkey).toBe('g>s')
  })

  it('goes to the assistant full screen with G then A, and focuses its composer there (contract 9.8)', () => {
    const go = byId('go.assistant')
    expect([go.group, go.hotkey, go.title]).toEqual(['Go to', 'g>a', 'Assistant'])
    const elsewhere = context()
    go.run(elsewhere)
    expect(elsewhere.navigate).toHaveBeenCalledWith('/assistant')
    // On the page, going there again keeps its scope in the address and puts the focus in it.
    const there = context({ assistant: 'expanded', focusAssistant: vi.fn() })
    go.run(there)
    expect(there.focusAssistant).toHaveBeenCalled()
    expect(there.navigate).not.toHaveBeenCalled()
    // Try it is the assistant expanded too, but has no composer: G then A goes to the page.
    const tryIt = context({ assistant: 'expanded' })
    go.run(tryIt)
    expect(tryIt.navigate).toHaveBeenCalledWith('/assistant')
    expect(commands.some((command) => command.id === 'go.try-it')).toBe(false)
  })

  it('docks the assistant with Command or Control backslash, and G then I on its second tab', () => {
    const ctx = context({ toggleAssistant: vi.fn() })
    const ask = byId('ask.assistant')
    const agent = byId('ask.agent')
    expect([ask.group, ask.hotkey, ask.title]).toEqual([
      'Ask',
      'mod+backslash',
      'Ask the assistant',
    ])
    // It works from the composer too, so the person can dock what they are typing in.
    expect(ask.whileTyping).toBe(true)
    expect([agent.group, agent.hotkey, agent.title]).toEqual(['Ask', 'g>i', 'Try a question'])
    ask.run(ctx)
    // Without a tab: the tab last shown, as the launcher does.
    expect(ctx.toggleAssistant).toHaveBeenLastCalledWith()
    agent.run(ctx)
    expect(ctx.toggleAssistant).toHaveBeenLastCalledWith('agent')
    expect(ctx.navigate).not.toHaveBeenCalled()
    // Without a shell to open it in, neither is offered.
    expect(isAvailable(ask, context())).toBe(false)
    expect(isAvailable(agent, ctx)).toBe(true)
    // The palette says what the key does in each of the three states.
    expect(commandTitle(ask, context({ assistant: 'closed' }))).toBe('Ask the assistant')
    expect(commandTitle(ask, context({ assistant: 'docked' }))).toBe('Close the assistant')
    expect(commandTitle(ask, context({ assistant: 'expanded' }))).toBe('Dock the assistant')
    expect(formatHotkey('mod+backslash', true)).toEqual(['⌘', '\\'])
    expect(formatHotkey('mod+backslash', false)).toEqual(['Ctrl', '\\'])
  })

  it('starts a new chat from the palette while the assistant is docked or expanded', () => {
    const newChat = byId('ask.new-chat')
    expect([newChat.group, newChat.title]).toEqual(['Ask', 'New chat'])
    const ctx = context({ assistant: 'docked', newChat: vi.fn() })
    expect(isAvailable(newChat, ctx)).toBe(true)
    newChat.run(ctx)
    expect(ctx.newChat).toHaveBeenCalled()
    // The shell offers it only while the assistant shows: there is no chat to start over closed.
    expect(isAvailable(newChat, context({ assistant: 'closed' }))).toBe(false)
  })

  it('offers a place only to the roles it is for (Quality design, section 0; navigation decision)', () => {
    const contributor = context({ permissions: { roles: [], assignments: [] } })
    const owner = context({
      permissions: { roles: [], assignments: [{ areaId: 'area_commercial', role: 'owner' }] },
    })
    const approver = context({
      permissions: { roles: [], assignments: [{ areaId: 'area_commercial', role: 'approver' }] },
    })
    const admin = context({ permissions: { roles: ['administrator'], assignments: [] } })
    const auditor = context({ permissions: { roles: ['auditor'], assignments: [] } })
    const offered = (ctx: CommandContext) =>
      commands
        .filter((command) => command.group === 'Go to' && isAvailable(command, ctx))
        .map((command) => command.id.slice('go.'.length))
    const everyone = ['home', 'assistant', 'library', 'catalogue', 'proposals']
    // Connect an AI app and Settings have no sidebar row, but the palette offers them to everyone;
    // Docs, the help pages, are for everyone too.
    const last = ['connect', 'docs', 'settings']
    // Health holds the gaps for the people it is for; everyone else goes to Gaps. Owners read
    // Editions; Administration is for administrators and auditors (navigation decision).
    expect(offered(contributor)).toEqual([...everyone, 'gaps', ...last])
    expect(offered(approver)).toEqual([...everyone, 'gaps', ...last])
    expect(offered(auditor)).toEqual([...everyone, 'gaps', 'admin', ...last])
    expect(offered(owner)).toEqual([...everyone, 'editions', 'health', ...last])
    // People, a section of Administration, is offered to administrators by name too, and so is
    // the library's Deleted facts (the Bin), which is no sidebar place.
    expect(offered(admin)).toEqual([
      ...everyone,
      'editions',
      'health',
      'admin',
      'people',
      ...last,
      'deleted-items',
    ])
    // While the session loads, only what everyone may use is offered, so nothing shows and goes.
    expect(offered(context())).toEqual([...everyone, ...last])
  })

  it("goes to the library's Deleted facts, the Bin page, found by its old name too", () => {
    const command = byId('go.deleted-items')
    expect(command.title).toBe('Deleted facts')
    expect(command.keywords).toContain('bin')
    const ctx = context({ permissions: { roles: ['administrator'], assignments: [] } })
    command.run(ctx)
    expect(ctx.navigate).toHaveBeenCalledWith('/library/bin')
  })

  it('discards the selected drafts, or the focused one, with Command or Control Backspace', () => {
    const command = byId('selection.discard')
    expect(command.hotkey).toBe('mod+backspace')
    // Only a list that holds the person's drafts offers it, and only with a draft to discard.
    expect(isAvailable(command, context({ list: listScope() }))).toBe(false)
    let count = 0
    const run = vi.fn()
    const list = { ...listScope(), discard: { count: () => count, run } }
    expect(isAvailable(command, context({ list }))).toBe(false)
    count = 1
    expect(isAvailable(command, context({ list }))).toBe(true)
    expect(commandTitle(command, context({ list }))).toBe('Discard the draft')
    count = 3
    expect(commandTitle(command, context({ list }))).toBe('Discard the 3 drafts')
    command.run(context({ list }))
    expect(run).toHaveBeenCalledOnce()
  })

  it('sets the appearance and toggles the sidebar', () => {
    const ctx = context()
    byId('appearance.dark').run(ctx)
    expect(ctx.setAppearance).toHaveBeenCalledWith('dark')
    byId('view.toggle-sidebar').run(ctx)
    expect(ctx.toggleSidebar).toHaveBeenCalled()
  })

  it('offers list commands only while the list is shown', () => {
    expect(isAvailable(byId('list.down'), context())).toBe(false)
    const list = listScope()
    const ctx = context({ list })
    expect(isAvailable(byId('list.down'), ctx)).toBe(true)
    byId('list.down').run(ctx)
    expect(list.move).toHaveBeenCalledWith(1)
    byId('list.extend-up').run(ctx)
    expect(list.move).toHaveBeenCalledWith(-1, true)
    byId('list.select').run(ctx)
    expect(list.toggleSelected).toHaveBeenCalled()
  })

  it("compares with Shift C and shows a record's tabs with 1, 2 and 3, only where the list has them", () => {
    const compare = byId('list.compare')
    // C alone adds context everywhere, so the compare focus takes Shift C (Workbench plan, W7).
    expect(compare.hotkey).toBe('shift+c')
    expect(byId('create.item').hotkey).toBe('c')
    expect(formatHotkey(compare.hotkey!, true)).toEqual(['⇧', 'C'])
    const tabs = ['list.tab-1', 'list.tab-2', 'list.tab-3'].map(byId)
    expect(tabs.map((command) => command.hotkey)).toEqual(['1', '2', '3'])

    // A list without a record to compare or tabs to show offers neither.
    const plain = context({ list: listScope() })
    expect(isAvailable(compare, plain)).toBe(false)
    for (const tab of tabs) expect(isAvailable(tab, plain)).toBe(false)

    const list = { ...listScope(), toggleCompare: vi.fn(), showTab: vi.fn() }
    const ctx = context({ list })
    expect(isAvailable(compare, ctx)).toBe(true)
    compare.run(ctx)
    expect(list.toggleCompare).toHaveBeenCalledOnce()
    tabs.forEach((tab, index) => {
      expect(isAvailable(tab, ctx)).toBe(true)
      tab.run(ctx)
      expect(list.showTab).toHaveBeenLastCalledWith(index)
    })
  })

  it('opens the owner check of the item shown with Y, named as its button is', () => {
    const check = byId('item.check')
    expect([check.group, check.hotkey]).toEqual(['On this page', 'y'])
    expect(isAvailable(check, context())).toBe(false)
    const open = vi.fn()
    const ctx = context({ check: { title: 'Yes, still going on', open } })
    expect(isAvailable(check, ctx)).toBe(true)
    expect(commandTitle(check, ctx)).toBe('Yes, still going on')
    check.run(ctx)
    expect(open).toHaveBeenCalledTimes(1)
    // A panel beside the list has the list's keys too: Y is none of them.
    const beside = commands.filter(
      (command) => command.scope === 'list' && command.hotkey === check.hotkey,
    )
    expect(beside).toEqual([])
  })

  it('moves to the next and previous item on an item page', () => {
    const doc = documentScope()
    const ctx = context({ document: doc })
    expect(isAvailable(byId('item.next'), context())).toBe(false)
    byId('item.next').run(ctx)
    byId('item.previous').run(ctx)
    expect(doc.next).toHaveBeenCalled()
    expect(doc.previous).toHaveBeenCalled()
  })

  it('Escape goes up from a record page, unless a list on it has the key', () => {
    const up = vi.fn()
    const command = byId('page.up')
    expect(command.hotkey).toBe('escape')
    expect(isAvailable(command, context())).toBe(false)
    expect(isAvailable(command, context({ up, list: listScope() }))).toBe(false)
    expect(isAvailable(command, context({ up }))).toBe(true)
    command.run(context({ up }))
    expect(up).toHaveBeenCalledTimes(1)
  })

  it('favourites the open item, or the list cursor, and says which way it goes', () => {
    const toggleFavorite = vi.fn()
    const favorite = byId('item.favorite')
    expect(isAvailable(favorite, context({ toggleFavorite }))).toBe(false)
    const onItem = context({
      toggleFavorite,
      document: documentScope(),
      isFavorite: () => true,
    })
    expect(favorite.titleFor?.(onItem)).toBe('Remove from favourites')
    favorite.run(onItem)
    expect(toggleFavorite).toHaveBeenCalledWith('itm_open')
    favorite.run(context({ toggleFavorite, list: listScope() }))
    expect(toggleFavorite).toHaveBeenLastCalledWith('itm_cursor')
  })

  it('focuses the library search with / on the list, and opens the palette elsewhere', () => {
    const openPalette = vi.fn()
    const list = listScope()
    byId('list.search').run(context({ list, openPalette }))
    expect(list.focusSearch).toHaveBeenCalled()
    byId('list.search').run(context({ openPalette }))
    expect(openPalette).toHaveBeenCalled()
  })
})

describe('formatHotkey', () => {
  it('formats modifier combinations for each platform', () => {
    expect(formatHotkey('mod+b', true)).toEqual(['⌘', 'B'])
    expect(formatHotkey('mod+b', false)).toEqual(['Ctrl', 'B'])
  })

  it('formats sequences and named keys', () => {
    expect(formatHotkey('g>l', false)).toEqual(['G', 'then', 'L'])
    expect(formatHotkey('shift+slash', false)).toEqual(['?'])
    expect(formatHotkey('escape', false)).toEqual(['Esc'])
    expect(formatHotkey('shift+j', true)).toEqual(['⇧', 'J'])
    expect(formatHotkey('mod+backspace', true)).toEqual(['⌘', '⌫'])
    expect(formatHotkey('mod+backspace', false)).toEqual(['Ctrl', 'Backspace'])
  })
})
