import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Logo, LogoSymbol, LogoWordmark } from '@/components/app-shell/logo'
import { productName } from '@/lib/brand'

/**
 * The Heed logo (docs/design/logo.md): the symbol, and the lockup of the symbol and the outlined
 * Outfit 500 wordmark. One fill of currentColor: switch the theme in the toolbar and the logo
 * inverts with the text around it. It never takes the accent.
 */
const meta = {
  title: 'Shell/Logo',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const symbolSizes = [
  { height: 12, className: 'h-3' },
  { height: 16, className: 'h-4' },
  { height: 20, className: 'h-5' },
  { height: 32, className: 'h-8' },
  { height: 64, className: 'h-16' },
]

/** The symbol at the heights it is checked at: 12 is the minimum, 20 the sidebar and the rail. */
export const SymbolOnly: Story = {
  name: 'Symbol',
  render: () => (
    <div className="flex items-end gap-8 text-foreground">
      {symbolSizes.map(({ height, className }) => (
        <div key={height} className="flex flex-col items-center gap-2">
          <LogoSymbol className={className} />
          <span className="text-caption text-muted-foreground">{height}</span>
        </div>
      ))}
    </div>
  ),
}

/** The lockup at 16 (the minimum), 20 (the sidebar) and 32 (sign-in, consent and signed out). */
export const Lockup: Story = {
  render: () => (
    <div className="flex items-end gap-8 text-foreground">
      {[
        { height: 16, className: 'h-4' },
        { height: 20, className: undefined },
        { height: 32, className: 'h-8' },
      ].map(({ height, className }) => (
        <div key={height} className="flex flex-col items-start gap-2">
          <Logo className={className} />
          <span className="text-caption text-muted-foreground">{height}</span>
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('img', { name: productName })).toHaveLength(3)
  },
}

/**
 * The top of the sidebar, expanded and in the rail, on the sidebar's background: the symbol in the
 * 32 pixel slot of the icon column, the wordmark on the labels' edge.
 */
export const Sidebar: Story = {
  render: () => (
    <div className="flex items-start gap-6">
      <div className="flex h-header w-sidebar items-center rounded-md bg-sidebar px-2 text-sidebar-foreground">
        <span className="flex size-control-md shrink-0 items-center justify-center">
          <LogoSymbol />
        </span>
        <LogoWordmark />
      </div>
      <div className="flex h-header w-rail items-center rounded-md bg-sidebar px-2 text-sidebar-foreground">
        <span className="flex size-control-md items-center justify-center">
          <LogoSymbol />
        </span>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const mark of canvasElement.querySelectorAll('svg')) {
      await expect(mark).toHaveAttribute('aria-hidden', 'true')
    }
  },
}
