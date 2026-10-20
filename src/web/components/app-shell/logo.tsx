import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { productName } from '@/lib/brand'

/*
  The Heed logo (docs/design/logo.md): the symbol, two blades turned half a turn about an oval
  counter, and the wordmark, lowercase heed in Outfit 500 at -0.035em, shipped as outlines so no
  webfont loads. Both are one fill of currentColor, so the logo takes the ink of the text around
  it and inverts with the theme; it never takes the accent. They share one grid: the symbol fills
  36 by 40 units, 2 units to the pixel at the sidebar's 20 pixels; the wordmark is set at 0.9 of
  the symbol's height, starts 14 units (7 pixels) after it and centres its ascender band (the top
  of the h to the baseline) on the symbol. The same paths are in src/web/public: heed-symbol.svg,
  heed-lockup.svg, heed-mark.svg and the favicons; tests/unit/logo.test.tsx fails if they drift.
*/

/**
 * One blade of the symbol on its 36 by 40 grid. The symbol is this blade and the same blade turned
 * half a turn about the grid's centre (`logoBladeTurn`), so the two are equal by construction.
 */
export const logoBladePath =
  'm27 12.37.48-.4c-2.1-1.17-3.9-2.63-4.67-4.99-.71-2.18.13-7.26-3.46-6.97-2.61.22-6.11 3.72-8.08 5.41-1.74 1.49-3.49 2.98-5.22 4.49-3.76 3.29-8.05 7.27-4.93 12.68.48.85 1.12 1.59 1.86 2.22 1.02.86 2.22 1.51 3.47 1.98l.53-.32a12.93 6.43 154.6 0 1 20.02-14.1z'

export const logoBladeTurn = 'rotate(180 18 20)'

/**
 * The wordmark in Outfit's own units (1000 to the em, the baseline at y = 0), relative and whole,
 * so the two e's are one string twice. `logoWordmarkTransform` sets it on the lockup's grid: 0.036
 * units to the font unit (18 pixels to the em at 2 units to the pixel), its ink starting at x = 50
 * and its baseline at y = 32.96, which centres the ascender band (720 units) on the symbol.
 */
export const logoWordmarkPath =
  'm390 0v-277q0-48-30-79-31-31-79-31-32 0-57 14-25 14-39 39-14 25-14 57l-43-24q0-55 24-97 24-43 66-68 43-24 96-24 54 0 96 24 42 24 66 66 24 43 24 99v301zm-329 0v-720h110v720zm739 10q-72 0-130-32-57-33-90-90-34-57-34-128 0-71 33-128 33-56 89-89 57-33 126-33 67 0 118 31 52 31 82 85 29 54 29 123 0 12-1 25-2 12-5 27h-394v-90h337l-41 36q-2-44-17-74-15-30-42-46-28-16-68-16-42 0-73 18-31 18-48 51-17 32-17 77 0 45 18 79 18 34 51 52 33 19 76 19 37 0 69-13 31-13 53-38l70 71q-35 41-85 62-50 21-106 21zm499 0q-72 0-129-32-58-33-92-90-33-57-33-128 0-71 33-128 33-56 90-89 56-33 125-33 67 0 119 31 51 31 80 85 30 54 30 123 0 12-2 25-1 12-4 27h-394v-90h337l-41 36q-2-44-17-74-15-30-43-46-27-16-67-16-42 0-73 18-31 18-48 51-17 32-17 77 0 45 18 79 18 34 51 52 33 19 76 19 37 0 68-13 32-13 54-38l70 71q-35 41-85 62-50 21-106 21zm477 0q-65 0-117-33-53-33-83-89-31-57-31-127 0-71 31-128 30-56 82-89 53-34 118-34 55 0 98 24 42 23 67 64 25 41 25 93v138q0 52-24 93-25 41-68 64-43 24-98 24zm18-104q41 0 71-19 31-18 48-51 17-33 17-76 0-43-17-76-17-33-48-51-30-19-71-19-40 0-70 19-31 18-48 51-18 33-18 76 0 43 17 76 18 33 49 51 30 19 70 19zm239 94h-110v-129l19-117-19-116v-358h110z'

export const logoWordmarkTransform = 'matrix(.036 0 0 .036 47.804 32.96)'

/** The symbol alone: 18 by 20 by itself, its size in the sidebar; a height class sizes it otherwise. */
export function LogoSymbol({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 36 40"
      width="18"
      height="20"
      fill="currentColor"
      aria-hidden="true"
      data-slot="logo-symbol"
      className={cn('w-auto shrink-0', className)}
      {...props}
    >
      <path d={logoBladePath} />
      <path transform={logoBladeTurn} d={logoBladePath} />
    </svg>
  )
}

/**
 * The wordmark alone, cut from the lockup's grid so it keeps the lockup's vertical alignment: 35.5
 * by 20 beside a 20 pixel symbol. The sidebar sets it after the symbol's 32 pixel slot.
 */
export function LogoWordmark({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="50 0 71 40"
      width="35.5"
      height="20"
      fill="currentColor"
      aria-hidden="true"
      data-slot="logo-wordmark"
      className={cn('w-auto shrink-0', className)}
      {...props}
    >
      <path transform={logoWordmarkTransform} d={logoWordmarkPath} />
    </svg>
  )
}

/**
 * The lockup, the symbol and the wordmark as one image named Heed: 60.5 by 20 by itself; a height
 * class sizes it otherwise (h-8 on the sign-in, consent and signed-out pages).
 */
export function Logo({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 121 40"
      width="60.5"
      height="20"
      fill="currentColor"
      role="img"
      aria-label={productName}
      data-slot="logo"
      className={cn('w-auto shrink-0', className)}
      {...props}
    >
      <path d={logoBladePath} />
      <path transform={logoBladeTurn} d={logoBladePath} />
      <path transform={logoWordmarkTransform} d={logoWordmarkPath} />
    </svg>
  )
}
