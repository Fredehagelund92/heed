import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, within } from 'storybook/test'
import { StoryApp } from './story-app'

/**
 * The context library in the real shell, in every state of contract 9.5 and every layout of
 * 8.1 and 8.5, with its action bar (View, Filter, Sort, Group, Display) idle, with filters on
 * and with each menu open. Use the viewport menu for 1440, 1024 and 390 and the theme menu for
 * dark.
 */
const meta = {
  title: 'Library/Library page',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/**
 * The default: 40 pixel rows under a 36 pixel header (the professional pass), titles at 400, data
 * lines on both axes, each row's kind in the checkbox column until the row is hovered or selected.
 */
export const AllItems: Story = { render: () => <StoryApp path="/library" /> }

export const NeedsALook: Story = { render: () => <StoryApp path="/library?view=attention" /> }

export const Mine: Story = { render: () => <StoryApp path="/library?view=mine" /> }

/** Comfortable: 48 pixel rows, a choice in the density menu. Everything else stays as the default. */
export const Comfortable: Story = {
  render: () => <StoryApp path="/library" preferences={{ 'cl.library.density': 'comfortable' }} />,
}

export const ExtraColumns: Story = {
  render: () => (
    <StoryApp
      path="/library"
      preferences={{
        'cl.library.columns': ['domain', 'status', 'until', 'owner', 'checked', 'version'],
      }}
    />
  ),
}

/** The add row in compact rows, the default: its plus sits where the rows show their kind. */
export const AddRowCompact: Story = {
  render: () => <StoryApp path="/library" preferences={{ 'cl.library.density': 'compact' }} />,
}

export const AddRowWithScope: Story = {
  render: () => <StoryApp path="/library" preferences={{ 'cl.library.density': 'scope' }} />,
}

export const GroupedByKind: Story = { render: () => <StoryApp path="/library?group=kind" /> }

export const GroupedByStatus: Story = {
  render: () => <StoryApp path="/library?group=status&view=attention" />,
}

export const FiltersOn: Story = {
  render: () => <StoryApp path="/library?kind=event,note&area=area_sales" />,
}

export const SearchWithMarks: Story = { render: () => <StoryApp path="/library?q=norway" /> }

export const SortedByTitle: Story = { render: () => <StoryApp path="/library?sort=title" /> }

export const AboutOneMarket: Story = {
  render: () => <StoryApp path="/library?about=market:norway" />,
}

export const RetiredItems: Story = { render: () => <StoryApp path="/library?status=retired" /> }

export const Loading: Story = { render: () => <StoryApp path="/library" scenario="slow" /> }

/**
 * No items at all: the toolbar stays, and the empty view says so in one line. There is no start
 * block (8.8).
 */
export const EmptyLibrary: Story = {
  render: () => <StoryApp path="/library" scenario="empty" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('No facts yet', {}, { timeout: 10_000 })).toBeVisible()
    await expect(canvas.getByRole('search', { name: 'Library' })).toBeVisible()
    await expect(
      canvas.queryByRole('heading', { name: 'Start with something your team already knows' }),
    ).toBeNull()
  },
}

/** A few items open straight on the table, like any library. */
export const NearlyEmpty: Story = {
  render: () => <StoryApp path="/library" scenario="few" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findAllByRole('row', {}, { timeout: 10_000 })).not.toHaveLength(0)
    await expect(canvas.getByRole('textbox', { name: 'Search the library' })).toBeVisible()
    await expect(canvas.queryByText('Start from an example')).toBeNull()
  },
}

/** An administrator's row menu ends with Move to Bin, apart from the rest. */
export const AdministratorRowMenu: Story = {
  render: () => <StoryApp path="/library" person="per_ravi" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [first] = await canvas.findAllByRole(
      'button',
      { name: /^Actions for / },
      { timeout: 10_000 },
    )
    await userEvent.click(first!)
    await expect(await screen.findByRole('menuitem', { name: 'Move to Bin' })).toBeVisible()
  },
}

/**
 * An administrator's View menu ends with Deleted facts, the way to the Bin: it is no sidebar
 * place, one step away from the library.
 */
export const AdministratorViewMenu: Story = {
  render: () => <StoryApp path="/library" person="per_ravi" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: /^View: / }, { timeout: 10_000 }),
    )
    await expect(await screen.findByRole('menuitem', { name: 'Deleted facts' })).toBeVisible()
  },
}

/** Two rows selected by an administrator, and Move to Bin from the bar: one reason for both. */
export const MoveToBinDialog: Story = {
  render: () => <StoryApp path="/library" person="per_ravi" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const boxes = await canvas.findAllByRole(
      'checkbox',
      { name: /^Select (?!every)/ },
      { timeout: 10_000 },
    )
    await userEvent.click(boxes[0]!)
    await userEvent.click(boxes[1]!)
    const bar = canvas.getByRole('region', { name: 'Selected rows' })
    await userEvent.click(within(bar).getByRole('button', { name: 'Move to Bin' }))
    await expect(
      await screen.findByRole('alertdialog', { name: 'Move 2 facts to the Bin?' }),
    ).toBeVisible()
  },
}

export const NoResults: Story = {
  render: () => <StoryApp path="/library?q=zzzz&kind=guide" />,
}

export const Error: Story = { render: () => <StoryApp path="/library" scenario="error" /> }

export const Phone: Story = {
  render: () => <StoryApp path="/library" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

export const Tablet: Story = {
  render: () => <StoryApp path="/library" />,
  globals: { viewport: { value: 'laptop', isRotated: false } },
}

/** Opens one of the action bar's buttons once the list has loaded. */
function openBarButton(name: RegExp) {
  return async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const bar = await within(canvasElement).findByRole('search', { name: 'Library' })
    await within(canvasElement).findAllByRole('row', {}, { timeout: 10_000 })
    await userEvent.click(within(bar).getByRole('button', { name }))
  }
}

/** Three filters on: each a chip in the second row, the Filter button with its count. */
export const ActionBarFiltersOn: Story = {
  render: () => (
    <StoryApp path="/library?area=area_sales&status=source_missing,stale&kind=event,note" />
  ),
}

export const FilterMenuOpen: Story = {
  render: () => <StoryApp path="/library?area=area_sales" />,
  play: async (context) => {
    await openBarButton(/^Filter/)(context)
    await expect(await screen.findByRole('tablist', { name: 'Filter by' })).toBeVisible()
  },
}

export const SortMenuOpen: Story = {
  render: () => <StoryApp path="/library" />,
  play: openBarButton(/^Sort:/),
}

export const GroupMenuOpen: Story = {
  render: () => <StoryApp path="/library?group=kind" />,
  play: openBarButton(/^Grouped by/),
}

export const DisplayMenuOpen: Story = {
  render: () => <StoryApp path="/library" />,
  play: openBarButton(/^Density and columns$/),
}

export const ViewMenuOpen: Story = {
  render: () => <StoryApp path="/library?view=attention" />,
  play: openBarButton(/^View:/),
}

/** On a phone, Sort, Group and density fold into one menu. */
export const PhoneMenuOpen: Story = {
  render: () => <StoryApp path="/library" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: openBarButton(/^Sort, group and density$/),
}

/** On a phone, the search field opens under the bar from its button. */
export const PhoneSearchOpen: Story = {
  render: () => <StoryApp path="/library?q=norway" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

export const PhoneFiltersOn: Story = {
  render: () => <StoryApp path="/library?area=area_sales&status=source_missing" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

/** The shared searchable filter sheet, with touch-sized fields and choices at 390 px. */
export const PhoneFilterMenuOpen: Story = {
  render: () => <StoryApp path="/library" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: openBarButton(/^Filter$/),
}
