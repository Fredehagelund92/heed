# The public docs site

The docs site, built with [Starlight](https://starlight.astro.build) on Astro. It holds no pages of its own. It reads the Markdown in `docs/`, where the pages stay, and builds them into a static site that needs no service: search and fonts are local files, and no page loads anything from another host.

It is its own npm package with its own lockfile, as `apps/mockup` is, so its packages stay out of the app's tree and out of the images, and a bad upgrade can only break the docs build. The app's own Docs area, at `/docs`, and `npm run docs:build` do not use it.

## Run it

From the repository root, `npm --prefix apps/docs ci` once, then:

```sh
npm run site:dev     # http://localhost:4321
npm run site:build   # the site in apps/docs/dist, then the check of every link
```

In this folder, `npm run typecheck`, `npm run lint` and `npm test` check its own code. CI runs all of them whenever the docs or this folder change.

## What is on the site

`lib/pages.ts` lists the pages: every page of `docs/help`, and the operator and integrator pages by name. Everything else in `docs/` stays in the repository ([docs/README.md](../../docs/README.md) is the full index).

A page outside `docs/help` starts with front matter, and its title comes from there, so the body has no `#` heading:

```yaml
---
title: Run and operate the service
line: One line on what the page holds, at most 120 characters.
group: Run the service # a group in lib/pages.ts
order: 2 # its place in the group
reviewed: 2026-11-03 # the day someone last checked it
---
```

The sidebar is built from `group` and `order`. The strict rules in [docs/help/README.md](../../docs/help/README.md) hold for the help pages. Other pages only need their front matter and links that go somewhere.

## Links

Pages keep the relative links that work on GitHub, and the build resolves them (`lib/links.ts`):

- a link to another page of the site opens on the site;
- a link to any other file of the repository opens on GitHub at the build's reference, so a release's pages open the files of that release;
- a link to a screen of the app keeps its words without a link, because the site knows no instance of the app. The `open:` button of a help page is left out for the same reason;
- a link to a file that does not exist stops the build.

After the build, `scripts/check-site.ts` reads the built pages. It fails on a link or a heading that goes nowhere, on anything loaded from another host, on a `<title>` tag that reached a page's body, and on a page missing from the site or from `llms.txt`.

## The design

`lib/tokens.ts` reads `src/web/styles/tokens.css` when the site is built, so the site has the web app's colours in light and dark, and a name it needs that goes missing stops the build. `src/styles/theme.css` maps those tokens to Starlight's names. The font is Nunito Sans. Code blocks are Catppuccin Mocha in both themes.

## For agents

Each build has its own `llms.txt` and `llms-full.txt` (`lib/llms.ts`), written by the functions that write the app's (`src/domain/docs.ts`), over every page of the site.

## Settings

All are read when the site is built:

| Setting             | What it does                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `DOCS_SITE`         | The host, for canonical addresses, the sitemap and whole addresses in `llms.txt`           |
| `DOCS_ROOT`         | The path above the versions, `/heed`. Empty at the root of a host                          |
| `DOCS_VERSION`      | The folder of this build: `vMAJOR.MINOR`, or `next`, which search engines are told to skip |
| `DOCS_REF`          | The Git reference repository links open at, `main` by default                              |
| `HEED_PRODUCT_NAME` | The product name in titles. A renamed build shows it in place of the logo                  |

With none set, the site is served at the root of its own host.

## Versions and publishing

`.github/workflows/docs-site.yml` builds one folder per minor release, `/v0.1/`, at its tag, and `/next/` from `main`. `versions.json` at the root lists the folders, and the switcher in the header reads it when a page opens, so an old version's pages know of newer ones without being built again. See [Releasing Heed](../../docs/releasing.md#the-docs-site) for how it is published.

## A team without internet access

Either way, nothing in the browser needs a service.

1. **Download once.** Each GitHub Release has `heed-docs-<version>.tar.gz`, built to be served at the root of a host. Carry it in with the images, unpack it, and serve the folder with any static server.
2. **Build it yourself.** At the release tag, run `npm --prefix apps/docs ci`, then `npm run site:build`, and copy `apps/docs/dist` to a static server. The build needs no network. The install needs an npm mirror that holds the platform packages of `pagefind` and `sharp`.
