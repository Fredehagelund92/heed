# The Heed logo

Heed is the product's name: the app, the service and the command-line tool (`heed`) all carry it,
and the product copy already says "Sign in to Heed" and "connect to Heed again". The logo is the
captain's design: a symbol and a lowercase wordmark. The symbol here is the supplied one redrawn
clean, and the wordmark is set in Outfit 500 and outlined. The captain decided this on 12 October 2026.

## The symbol

Two blades, one turned exactly half a turn onto the other, around an oval counter. Each blade
sweeps from a soft outer corner into a short square tip that faces the other blade across a
narrow slit.

It is drawn on a **36 by 40 grid**, 2 units to the pixel at the sidebar's 20 pixels. It is one path
in `fill="currentColor"`, with no stroke and no gradient. The supplied artwork was a raster trace.
The redraw keeps its design and cleans the construction:

| Part       | Construction                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| Blades     | The average of the trace's two blades, so one is the other turned half a turn about (18, 20)                  |
| Counter    | An exact elliptical arc, 12.93 by 6.43 units, tilted 154.6 degrees, shared by both blades                     |
| Tips       | Short square terminals where the trace had hairline spurs                                                     |
| Proportion | 0.9 to 1 (width to height), as supplied; the outline moves at most 1.5 percent of the width                   |
| Slits      | About 1.6 units (4.4 percent of the width): they close below about 24 pixels, where the oval carries the mark |

The source is `LogoSymbol` in `src/web/components/heed/logo.tsx`.

## The wordmark and the lockup

The wordmark is lowercase `heed` in **Outfit 500**, tracked -0.035em. It was shaped with kerning
from the OFL font file and outlined, so no webfont loads and the logo never falls back to another
typeface. It is `logoWordmarkPath`, on the same grid as the symbol.

| Measure            | At the sidebar's 20 pixels                                                            |
| ------------------ | ------------------------------------------------------------------------------------- |
| Lockup             | 60.5 by 20 (`viewBox="0 0 121 40"`)                                                   |
| Symbol             | 18 by 20                                                                              |
| Gap                | 7 (14 units), symbol edge to the first stem of the h                                  |
| Wordmark           | Set at 18 pixels (0.9 of the symbol): ascender 13, x-height 8.6, 35.5 wide            |
| Vertical alignment | The wordmark's ascender band (the top of the h to the baseline) centred on the symbol |

## Where it shows

| Place                        | What                   | Size                                                                                                                                                                                                                                                                  |
| ---------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar, expanded            | The lockup, link home  | 20 high, in the 48 pixel header row, centred on the breadcrumb's line above the hairline the row shares with the app header. The symbol sits in the 32 pixel slot of the nav icons' column (centred 24 from the edge), so the wordmark starts at 40, the labels' edge |
| Sidebar, folded to the rail  | The symbol alone       | 18 by 20, in the same place. Clicking it expands the sidebar                                                                                                                                                                                                          |
| Phone menu sheet             | The lockup             | The same 20 high, in the sheet's 56 pixel header, on a 44 pixel target. The phone header itself shows no logo                                                                                                                                                         |
| Sign-in, consent, signed out | The lockup             | 32 high (symbol 28.8 by 32, gap 11.2, wordmark 28.8 pixels, about 97 wide), on the content column, 24 above the heading                                                                                                                                               |
| Favicon and touch icon       | The symbol on a tile   | Below                                                                                                                                                                                                                                                                 |
| README on GitHub             | The lockup             | 56 high, the light or the dark file by the reader's colour scheme (`docs/images`)                                                                                                                                                                                     |
| Social preview               | The lockup and tagline | 1280 by 640, set in the repository settings; the lockup 120 high, the tagline under it                                                                                                                                                                                |
| Owner avatar                 | The symbol on a tile   | 500, the symbol 310 high in #f4f5f8 on #13161d, like the touch icon                                                                                                                                                                                                   |

The link home is named "Heed". In the sidebar the symbol and the wordmark are decorative SVGs inside
it; on its own, `Logo` is one image named "Heed".

## Files

| File                                                         | Use                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `components/app-shell/logo.tsx`                              | `LogoSymbol`, `LogoWordmark` and `Logo` (the lockup) in the app, and the two paths               |
| `public/heed-symbol.svg`                                     | The symbol on its own, in currentColor, for docs and slides                                      |
| `public/heed-lockup.svg`                                     | The lockup, outlined, in currentColor                                                            |
| `public/heed-mark.svg`                                       | The same as `heed-symbol.svg`, kept so links to the old file still work                          |
| `public/favicon.svg`                                         | The symbol 22 of 32 high in #f4f5f8 on a #13161d tile with 7 unit corners, in every scheme       |
| `public/favicon.ico`                                         | 16, 32 and 48, rendered from `favicon.svg`, for browsers without SVG icons                       |
| `public/apple-touch-icon.png`                                | 180, the symbol 112 high in #f4f5f8 on #13161d, for home screens                                 |
| `docs/images/heed-lockup-light.svg`, `heed-symbol-light.svg` | The lockup and the symbol in #13161d, for GitHub's light pages                                   |
| `docs/images/heed-lockup-dark.svg`, `heed-symbol-dark.svg`   | The lockup and the symbol in #f4f5f8, for GitHub's dark pages                                    |
| `docs/images/heed-social-preview.png`                        | 1280 by 640, the lockup in #f4f5f8 and the tagline in Nunito Sans 400 at 44, #a1a4ac, on #13161d |
| `docs/images/heed-avatar.png`                                | 500, the symbol on the ink tile, for the owner's avatar                                          |

GitHub shows a README image as an `<img>`, where `currentColor` is black on any page, so the README
uses the fixed-colour files in a `<picture>` with a `prefers-color-scheme: dark` source; they are
the public files with only the fill changed.

The public files are in `src/web/public`. The ICO and the touch icon are rendered from the same
path as the component. No test checks yet that a public file matches the component.

## The favicon and the touch icon

Both are the symbol in #f4f5f8 on an ink (#13161d) tile, in every colour scheme. A bare symbol
switched by `prefers-color-scheme` disappears when the browser's tab strip is dark and the system
is light, or the other way round; the tile shows on any tab strip. The favicon's tile is the whole
32 unit square with corners of 7 (about 22 percent), and the symbol is 22 units high (about 69
percent), centred, so it stays legible at 16 pixels. The touch icon is a full square, since the
home screen rounds it, with the symbol 112 of 180 high.

The links in `index.html` carry a version (`?v=2`). Raise it whenever an icon changes, so browsers
drop the cached old one.

## Usage

- **Colour.** One colour: the ink of the text around it (`currentColor`; in the app the foreground
  token, #13161d light and #f4f5f8 dark). Forced colours paint it as CanvasText. **Never the
  accent**: Heed blue is for what the product does (contract 6.1), not for its name.
- **Clear space.** Half the symbol's height on every side: 10 pixels around the 20 pixel lockup.
- **Minimum size.** The lockup 16 high, the symbol 12 high. Below 16 use the symbol alone.
- **Do** size it by height and let the width follow. Keep the symbol and the wordmark together at
  their fixed gap and alignment, and use the symbol alone where space is square.
- **Do not** put it on a tile or behind a colour in the app (the tile is for the favicon, the
  touch icon and the avatar only), outline it, add a gradient or shadow,
  animate, rotate or stretch it, recolour the halves, re-space the lockup, or set the name in
  another typeface.
