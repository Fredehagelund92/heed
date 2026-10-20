import { withThemeByClassName } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react-vite'
import { IconProvider } from '@/components/icons'
import './preview.css'

/**
 * Viewport matrix for review: 1440, 1024 and 390 wide, in light and dark. Pick a size in the
 * toolbar's viewport menu and an appearance in the theme menu. The same matrix is used by the
 * Playwright tests (tests/e2e) for the app shell.
 */
const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
    a11y: { test: 'todo' },
    viewport: {
      options: {
        desktop: {
          name: 'Desktop 1440',
          styles: { width: '1440px', height: '900px' },
          type: 'desktop',
        },
        laptop: {
          name: 'Laptop 1024',
          styles: { width: '1024px', height: '768px' },
          type: 'tablet',
        },
        phone: { name: 'Phone 390', styles: { width: '390px', height: '844px' }, type: 'mobile' },
      },
    },
  },
  initialGlobals: { viewport: { value: 'desktop', isRotated: false } },
  decorators: [
    // The app root gives every icon the contract's 1.5 stroke; stories get the same.
    (Story) => (
      <IconProvider>
        <Story />
      </IconProvider>
    ),
    withThemeByClassName({
      themes: { light: '', dark: 'dark' },
      defaultTheme: 'light',
    }),
  ],
}

export default preview
