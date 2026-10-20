import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../src/web/stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-themes', 'storybook-addon-pseudo-states'],
  framework: {
    name: '@storybook/react-vite',
    options: { builder: { viteConfigPath: '.storybook/vite.config.ts' } },
  },
  core: { disableTelemetry: true },
}

export default config
