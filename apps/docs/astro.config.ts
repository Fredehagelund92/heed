import { unified } from '@astrojs/markdown-remark'
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import { linkContext } from './lib/links.ts'
import { repoRoot, sidebar, sitePages } from './lib/pages.ts'
import { remarkHeedDocs } from './lib/remark-heed-docs.ts'
import { basePath, readSettings } from './lib/settings.ts'
import { heedTokens } from './lib/tokens.ts'

/*
  The public docs site (README.md): docs/help and the operator pages, read where they are, in the
  web app's tokens and font. One build makes one version; nothing here depends on the others.
*/

const settings = readSettings(process.env)
const base = basePath(settings)
const pages = sitePages()
// /next/ follows main, so it stays out of search engines and carries no canonical addresses.
const isNext = settings.version === 'next'

export default defineConfig({
  site: !isNext && settings.site ? settings.site : undefined,
  base: `${base}/`,
  trailingSlash: 'always',
  // The web app's icons and logo, so a change there reaches the site.
  publicDir: '../../src/web/public',
  markdown: {
    // Astro's default processor runs no remark plugins.
    processor: unified({
      remarkPlugins: [[remarkHeedDocs, linkContext(pages, base, settings.ref)]],
    }),
  },
  vite: { plugins: [heedTokens()], server: { fs: { allow: [repoRoot] } } },
  integrations: [
    starlight({
      title: settings.product,
      description: `Guides and reference for ${settings.product}.`,
      favicon: '/favicon.svg',
      customCss: [
        '@fontsource-variable/nunito-sans',
        'virtual:heed-tokens.css',
        './src/styles/theme.css',
      ],
      sidebar: sidebar(pages),
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/Fredehagelund92/heed' },
      ],
      // The code block is dark in both themes (design contract), so one theme is enough.
      expressiveCode: {
        themes: ['catppuccin-mocha'],
        defaultProps: { wrap: true },
        styleOverrides: {
          borderRadius: '0',
          codeFontSize: '0.8125rem',
          codeLineHeight: '1.5rem',
          uiFontSize: '0.75rem',
          frames: { frameBoxShadowCssValue: 'none', editorActiveTabIndicatorHeight: '0' },
        },
      },
      routeMiddleware: './src/route-data.ts',
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'alternate',
            type: 'text/plain',
            title: 'The docs for agents',
            href: `${base}/llms.txt`,
          },
        },
        ...(isNext
          ? [{ tag: 'meta' as const, attrs: { name: 'robots', content: 'noindex' } }]
          : []),
      ],
      components: {
        Search: './src/components/Search.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
    }),
  ],
})
