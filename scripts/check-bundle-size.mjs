// Fails when the first load of the app grows past its budget. Run after `npm run build`.
// What counts: the scripts and styles that index.html loads or preloads (not lazy route chunks).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web')
// Measured when the foundation landed: 195 KB of script and 13 KB of CSS. The budget is a ratchet, not a target.
// Raised from 210 to 220 with the write foundation (217.6 KB): the session, roles and error
// shapes the shell needs, and the zod validators of the shared draft and proposal rules, which
// stay in the first load's zod chunk because zod is tree-shaken once for the whole app.
// Raised from 220 to 225 with Add context (222.8 KB): the preview and overlap calls in the API
// client, mock and queries, and the two routes, which the shell loads before any page. The form
// itself is a lazy route chunk.
// Raised from 225 to 230 with the Catalogue home page (225.9 KB): the catalogue read model call
// in the API client, mock and queries, the nav entry and the route stubs, which the shell loads
// before any page. The page and its table are lazy route chunks.
// Raised from 230 to 235, and CSS from 20 to 21, with the review queue and the review screen
// (230.9 KB and 20.7 KB): the review keys in the command registry, the shell's review scope, the
// sidebar's To review count and the answer-run reads in the API client and queries, which the
// shell loads before any page; and Tailwind builds one stylesheet for every screen, so the field
// diff, the decision bar and the checks' details add their utilities to it. The queue and the
// review screen themselves are lazy route chunks.
// Raised from 235 to 236 (JS only) with live updates and the bell (235.8 KB; main 232.7 KB): the
// shell's bell button and unread count read, the rail count and the hook that loads the live
// reader on demand, and Rollup splitting modules the lazy notification chunks share with the
// shell into their own chunks. The popover, its list, the stream reader and the sentence
// registry stay lazy.
// Raised from 236 to 236.3, and CSS from 21 to 21.2, with the docked panel (236.27 KB and 21.13
// KB, from 235.92 and 20.93): the shell's rule that keeps the panel's width free and folds the
// sidebar while one is docked, and the library route's panel and tab params, which the shell
// loads before any page; and the panel's utilities in the one stylesheet. The panel, its tabs
// and the item parts it shares with the item page are lazy library chunks.
// Raised from 236.3 to 237.7 (JS only) with the navigation by role (237.7 KB, from 235.4): the
// audience of every menu entry and the rule that reads it, the Ask group, the shell's assistant
// state and its header button, the dock count for two panels, and the route stubs of Try it,
// Quality, Editions, Areas and the old Evals addresses, which the shell loads before any page.
// The assistant's panel and the pages themselves are lazy chunks.
// Raised from 237.7 to 238.46, and CSS from 21.2 to 21.31, with the assistant launcher (238.45
// KB and 21.31 KB; main measured 237.71 and 21.19): the round button on every page, the rule that
// lifts it over a bar stuck to the bottom of a page, the assistant's tab state and the cover rule
// for a record's panel in the shell, and the launcher's place beside a panel in the one
// stylesheet. The assistant's panel and its tabs stay a lazy chunk.
// Raised from 238.46 to 238.47, and CSS from 21.31 to 21.43, with Home (238.46 KB and 21.42 KB;
// main measured 238.45 and 21.30): the route's tab param and the mock's quiet scenario, which
// the shell loads before any page, and Home's utilities in the one stylesheet. The page, its
// search field and its table are a lazy route chunk.
// Raised from 238.47 to 238.52 (JS only) with the Quality reads (238.517 KB; main measured
// 238.464): the six read methods' names and their http bindings in the API client and its route
// list, which the shell loads before any page. The mock's Quality model is in the lazy mock chunk.
// Raised from 238.52 to 239.07, and CSS from 21.43 to 21.47, with the Quality page (239.064 KB
// and 21.467 KB; main measured 238.358 and 21.340): the ten test question and run methods' names
// in the API client's list, their query keys, options and invalidations, the route's search
// schema and the upload icon, which the shell loads before any page; and the page's utilities in
// the one stylesheet. The page, its panels, dialogs and the trend chart are lazy chunks.
// Raised from 239.07 to 239.31, and CSS from 21.47 to 21.49 (239.304 KB and 21.480 KB), with the scope that names a dimension with
// any value (the three picker reads in the API client's method list and their query options, and
// the library's filter and names for "market: any value", which the shell's library index
// carries; the picker, its list and the paste-a-list summary are a lazy chunk), on top of the
// Quality reads.
// Raised CSS from 21.49 to 21.55 (JS unchanged) with the chip previews (21.540 KB and 238.553 KB;
// main measured 21.478 and 239.308 on the same machine): the hover card's, the bottom sheet's and
// the @ list peek's utilities in the one stylesheet. The card, the sheet and their reads are a
// lazy chunk the shell fetches after the first load; the dimension page that replaced its
// placeholder made the first load's script smaller.
// CSS from the chip previews' 21.55 to 21.60 with What an agent would get and Connect your AI
// (21.539 KB over main's 21.480, so about 0.06 on top of the chip previews): the scope bar's
// container query, the numbered steps and the copy block's
// utilities in the one stylesheet. The first load's script went down (238.938 KB, from 239.304):
// the placeholder that Try it's route loaded is gone, and Try it and Connect are lazy chunks.
// Lowered from 239.31 to 217.5, and CSS from 21.6 to 21.55, by the trim pass (216.652 KB and
// 21.472 KB; main measured 239.213 and 21.598): the class merge helper ships tables compiled at
// build time (src/web/lib/cn-tables.gen.ts) instead of compiling its config in the browser; the
// user menu's popup and the phone's sidebar sheet are chunks of their own, so Base UI's menu and
// dialog (focus trap, scroll lock, dismissal) are not in the first load; and the app's stylesheet
// leaves out the classes only the stories write.
// Raised from 217.5 to 217.64 (JS only) with the agent sign-in (217.636 KB and 21.499 KB; main
// measured 216.652 and 21.472): the six sign-in and connection methods' names in the API
// client's list, their query keys, options and invalidations and the sign-in hook, the consent
// route's search schema and its route stub, and the shell's rule that leaves the consent page
// standalone, which the shell loads before any page. The consent page, the connected apps grid
// on Connect your AI and the mock's connections are lazy chunks.
// Raised from 217.64 to 219.77, and CSS from 21.55 to 21.691, with the assistant's Ask tab (219.762
// KB and 21.690 KB; main measured 217.636 and 21.499 on the same machine): the assistant page's
// route stub and its search schema (0.4 KB), which the shell loads before any page; and Rollup
// moving the button, the input and five icons, which the panel's lazy chat chunk now shares with
// the shell, out of the entry into small preloaded chunks of their own (about 1.6 KB of gzip
// overhead, no new code); and the chat's utilities in the one stylesheet. The chat itself (the
// stream reader, the transcript, the composer, the scope picker and the mock's scripted
// assistant) is lazy. It reads the stream with its own small reader rather than the AI SDK's
// chat client, whose schema library would have kept 7 KB more of zod in the first load.
// Raised from 219.77 to 220.17, and CSS from 21.691 to 21.82, with the professional pass's
// tokens, shell and grids (220.169 KB and 21.815 KB; main measured 219.907 and 21.690 on the same
// machine, so about 0.26 and 0.125 on top): the toolbar button sizes, the 48 pixel header's ghost
// controls, the 28 pixel sidebar items and the breadcrumb's size, which the shell loads before
// any page; and the data line token, its border and divide utilities, the header and toolbar
// tokens and the one row-control rule that shows a row's checkbox and menu on hover, keyboard
// focus, selection and touch, in the one stylesheet. The grid classes and the shared toolbar live
// in lazy list chunks.
// Raised from 220.17 to 220.75, and CSS from 21.82 to 21.825, with the Item page's
// persistent Details column (220.749 and 21.823 KB; unchanged HEAD measured 220.167 and
// 21.747 on the same install). Human breadcrumb metadata and its lazy label renderer add
// 596 bytes to the shell and shared chunk boundaries; the list's search index stays lazy.
// The 288 pixel column, its responsive rules and 15/24 reading role add 78 bytes of CSS.
// Raised from 220.75 to 221.77, and CSS from 21.825 to 21.86, with Settings and the MCP traffic
// (221.764 KB and 21.858 KB; main measured 220.749 and 21.823 on the same machine): the nineteen
// settings, roles, areas, operations, history log, import and traffic methods' names in the API
// client's list, their query keys, options and invalidations, and the Settings route's section,
// setting and history log filters in its search schema, which the shell loads before any page;
// and the sections' utilities in the one stylesheet. The sections, their panels and dialogs, the
// settings' schemas and words, and the mock's settings world are lazy chunks.
// Shared phone pass C3: measured 221.878 KB JS and 22.318 KB CSS after Item and Settings. The shared controls'
// phone target classes, accessible icon-only badges and text-row-phone merge role add 0.114 KB JS;
// phone sheets, launcher clearance, safe-area padding and wrapping rows add 0.46 KB CSS.
// The menu, popover and docked-panel behavior stays in lazy chunks.
// Raised from 221.9 to 222.34, and CSS from 22.33 to 22.66, with the Workbench route, template
// and record pane (222.334 KB and 22.653 KB; main measured 221.881 and 22.389 on the same
// machine, so main's CSS was already over its budget): the route's search schema and stub, which
// the shell loads before any page, and the shell's rule that folds the sidebar while a record is
// open in a page's own flow; and the three panes' widths, their fold under a 1,100 pixel page and
// the record pane's sticky bar in the one stylesheet. The page, the scope strip, the record pane
// and the Workbench's address helpers are lazy chunks.
// Lowered from 222.34 to 222.15, and CSS from 22.66 to 22.53, by taking what only lazy chunks
// and the design preview use out of the first load (222.140 KB and 22.528 KB; main measured
// 222.449 and 22.679 on the same machine, over both budgets since the Workbench route merged):
// the design preview's template catalog is read by its route's loader on demand; the panel and
// record pane hooks are in dock-hooks.ts, so the shell carries only their contexts; and the
// design preview's own classes are in design-preview.css, which only the preview loads.
// CSS raised from 22.53 to 22.6 with the Workbench's work list (22.596 KB; main measured 22.528 on
// the same install, JS unchanged at 221.3): the list's phone rows (56 high, padded 12, titles on
// up to two lines) and its group headers stuck under the shell's header add their utilities to
// the one stylesheet. The open row reuses the docked lists' look; the list itself is lazy.
// CSS raised from 22.6 to 22.7 with the Workbench taking over from Quality (W8: 22.696 KB, JS
// 220.428; main measured 22.700 and 220.479 on the same install, so main's CSS was already over
// since the record bodies, the gap and item records and the compare focus merged, W6 to W7). W8
// itself adds no first-load CSS of its own and takes 0.05 KB of JS out: the Quality page and its
// panels are gone, and the old address's mapping loads only when an old link is followed.
// CSS raised from 22.7 to 22.75 with the guarded go back and stop delivery (Editions S5: 22.749
// KB, JS 220.465; main measured 22.696 and 220.428 on the same install): the shared confirmation's
// wide two-step form and the preview's rows, which fold to two lines on a phone, add their
// utilities to the one stylesheet. The dialogs, the preview and the history line are lazy chunks.
// CSS raised from 22.75 to 22.89 with the Heed logo and Heed blue (22.885 KB, JS 222.070 within its
// budget; main measured 22.761 and 221.237 on the same install, so main's CSS was already over):
// the accent's tokens in both themes (the link ink, the ink kept for counts, the selection bar and
// the launcher, the plain selected tint) and their utilities in the one stylesheet. The logo
// itself adds no CSS: its outlines are inline SVG, 0.83 KB of script with the wordmark in whole
// font units and the symbol as one blade drawn twice.
// Lowered from 222.15 to 204.37 (JS only) by building the first load as three files, the app, React
// and the other libraries, instead of the 54 small shared chunks Rolldown cut it into (204.362 KB;
// main measured 222.596, over its budget since Administration's Sources, whose crumb, old-link
// redirect and section names in the shell moved two modules into chunks of their own). The same
// modules load first; only their packing changed. The Sources page itself is a lazy chunk.
// Raised from 204.37 to 205.16, and CSS from 22.89 to 22.96, with the People page (people and
// roles slice 1: 205.154 KB and 22.957 KB; main measured 204.715 and 22.948 on the same install,
// so main was already over both): the two people methods' names in the API client's list, their
// query keys and options, People in the palette ("Find a person", g then u), and the page's
// words, role, status, last sign-in and open person in Administration's search schema, whose
// filter values are in a module of their own so the rest of the people contract stays lazy. The
// page, the person's sheet, the dialog and the picker are lazy chunks.
// Raised from 205.16 to 205.35, and CSS from 22.96 to 23.01, with adding a source in Sources
// (205.343 KB and 23.003 KB; main measured 205.154 and 22.957 on the same install): the shell's
// crumbs for the form to add a source and to change one's settings, the five source calls of the
// API's method list, and the preload lists of the lazy routes, which name the shared chunks the
// Sources pages split out; the success tone of the shared alert and the form's narrow layout add
// their utilities to the one stylesheet. The form, its queries and a source's settings are lazy.
// Raised from 205.35 to 205.66, and CSS from 23.01 to 23.05, with the contributor flow (heed UX
// PR 1: 205.654 KB and 23.050 KB, measured on top of the owner screens, PR 2, which did not
// raise it): the call that reads a Home question as a scope in the API
// client's list and its query, the inbox item's reviewer note, the `asked` month in Add context's
// search schema, which the shell loads before any page, and the utilities of the Try it row's
// reading and the evidence day's Today button in the one stylesheet. The editor's request, the
// reading itself and the grouped gap types are in lazy chunks.
// Raised from 205.66 to 205.89, and CSS from 23.05 to 23.17, with the assistant's answers in
// GitHub-flavoured Markdown (205.882 KB and 23.167 KB; main measured 205.879 and 23.155 on the
// same install, so main was already over both): the two square marks of a task list in the icon
// module, and the utilities of an answer's table and task list in the one stylesheet. The parser
// (micromark with its GFM extension) and the answer's renderer are in the assistant's lazy chunk.
// Raised from 205.89 to 206.87, and CSS from 23.17 to 23.26, with the Docs area (206.861 KB and
// 23.255 KB; main measured 206.054 and 23.186 on the same install, so main was already over
// both by 0.16 and 0.02). What the shell must load before any page: the Docs entry and its
// BookOpen icon (0.16 KB in the libraries' file), its crumbs, the layout route and the two
// route stubs whose loaders fetch the pages' query on demand, and the lazy chunks' names in the
// preload map (0.65 KB in the app's file); and the sticky rail's offset token and the rule that
// stops a linked heading under the header (0.07 KB of CSS). The pages, their front matter, the query,
// the GitHub-flavoured Markdown parser and renderer, the search index and the sidebar's
// section list are lazy chunks, and the docs reuse the stylesheet's existing utilities.
// Raised from 206.87 to 206.9 (JS only) with help in context (206.896 KB; main 206.863 KB): the
// help link's chunk name in the preload map and in the dependency lists of the routes that show
// one. The link, its card, the pages and their renderer are lazy chunks, and the links reuse the
// stylesheet's existing utilities, so the CSS is unchanged.
// Raised from 206.9 to 207.06, and CSS from 23.26 to 23.48, with Home's pulse strip on top of
// help in context (207.049 KB and 23.477 KB). What the shell loads before any page: the weekly agent totals read in the API
// client, the mock and the queries (0.03 KB); and the strip's container layout utilities, the
// spark width token and the phone grid's room for the assistant launcher (0.19 KB of CSS). The
// strip itself and its inline SVG charts are in Home's chunk, with no chart library; the charts
// take their colours as attributes naming the tokens, so they add no CSS.
// Kept at 207.06 and 23.48 by a trim pass (204.590 KB and 23.308 KB; main measured 215.972 and
// 23.720 on the same install, over both): the tooltip's popup, with Floating UI's positioning, is
// a chunk of its own that the shell fetches after the first load (components/ui/tooltip-popup.tsx);
// the tooltip's root and trigger stay. And the stylesheet leaves out fourteen utilities that only
// words in comments and code asked for, among them `filter` and `transform` with their @property
// rules and `container` with a rule per breakpoint (styles/index.css).
// CSS kept at 23.48 by a second trim pass (23.2 KB; main measured 24.9 on the same install):
// the custom utilities only lazy chunks use (the answer's motion, the docked panel's motion, the
// sideways fade, the mention chip, the phone grid, Your drafts' columns and the agent's line)
// are in stylesheets of their own that load with those chunks, in the utilities layer as before;
// and the shadcn parts nothing used (the sidebar's rail, trigger, input and menu actions, the
// dropdown's submenus and checkbox item, three input group parts and five more) are gone, with
// their utilities. The first load's script is over its budget on main (217.0 KB after this pass,
// from 218.3), which is for its own change.
// JS kept at 207.06 by a third trim pass (206.342 KB; main measured 216.9 on the same install, over
// since the item page's marks grew the agent's mark, the writer's words and the proposal's fields).
// A module the first load imports ships every export a lazy chunk uses from it, so the shell now
// imports small modules: the Item route's stub reads the proposal states' names from
// lib/proposals.ts, not the item marks, which keep the badges, the avatar and the provenance
// words lazy; the address's search schema reads the connector id's pattern from connector-id.ts
// and the connections' sorts from connection-sorts.ts; and the built-in manifests, whose titles
// the trail names, are typed by define-manifest.ts, so the manifest's schema stays lazy.
// Raised with the tinted avatars, JS from 207.06 to 207.3 (206.635 KB here, 207.2 on CI; the
// assistant's avatar is in a lazy module of its own) and CSS from 23.48 to 23.8 (23.720 KB): the
// eight pastel pairs of a person's avatar and the assistant's pair, each for light and dark, the
// five avatar sizes and their initials' sizes, as tokens, and the utilities that use them.
// Raised JS from 207.3 to 208.0 with Base UI 1.9 (207.313 KB here; 206.621 with 1.8 on the same
// machine, and CI measures about 0.6 KB more): the new web app in src/app is the approved mockup,
// built on Base UI 1.9, and the repository keeps one version of each package, so the front end
// moves with it. Nothing of the front end's own changed.
// Raised JS from 208.0 to 209.0 with content connectors (208.6 KB on CI): the words for the nine
// new read warnings (documents left out and why, too much text, too many removals, rate limits)
// live in lib/sources.ts, which the shell's sources crumb and the Inbox already import.
const budgetKb = { js: 209.0, css: 23.8 }

const html = readFileSync(join(root, 'index.html'), 'utf8')
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(js|css))"/g)].map((match) => ({
  file: match[1],
  kind: match[2],
}))
if (assets.length === 0)
  throw new Error('No assets found in dist/web/index.html. Run `npm run build` first.')

const totals = { js: 0, css: 0 }
for (const { file, kind } of assets) {
  const bytes = gzipSync(readFileSync(join(root, file))).length
  totals[kind] += bytes
  console.log(`${(bytes / 1024).toFixed(1).padStart(7)} KB gzip  ${file}`)
}

let failed = false
for (const kind of ['js', 'css']) {
  const kb = totals[kind] / 1024
  const ok = kb <= budgetKb[kind]
  failed ||= !ok
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} initial ${kind}: ${kb.toFixed(1)} KB gzip, budget ${budgetKb[kind]} KB`,
  )
}
if (failed) {
  console.error(
    'The first load is over budget. Lazy load the new code, or raise the budget on purpose in scripts/check-bundle-size.mjs.',
  )
  process.exit(1)
}
