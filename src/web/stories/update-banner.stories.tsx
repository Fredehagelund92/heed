import type { Meta, StoryObj } from '@storybook/react-vite'
import { noteServiceVersion, resetOutdated } from '@/api/api-version'
import { UpdateBanner } from '@/components/app-shell/update-banner'

/**
 * The banner under the shell header while the app and the service come from different code
 * (api/api-version.ts): a page left open from before an update, or a service started before it.
 */
const meta = {
  title: 'Shell/Update banner',
  component: UpdateBanner,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof UpdateBanner>

export default meta
type Story = StoryObj<typeof meta>

/** The web server serves the service's build already: reloading the page catches up. */
export const PageFromBefore: Story = {
  beforeEach: () => {
    noteServiceVersion('newer', 'own', () => Promise.resolve('newer'))
    return resetOutdated
  },
}

/** The service runs older code: it has to start again. */
export const ServiceFromBefore: Story = {
  beforeEach: () => {
    noteServiceVersion('older', 'own', () => Promise.resolve('own'))
    return resetOutdated
  },
}
