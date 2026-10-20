import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

/*
  The native select's two sizes (contract 6.6): 32 by default and 40 large, so it lines up with a
  40 high input or date field beside it. One height class only, or the stylesheet's order decides
  and the large one never shows.
*/
describe('NativeSelect', () => {
  it('is 32 high by default and 40 high when large, with one height each', () => {
    render(
      <>
        <NativeSelect aria-label="Default">
          <NativeSelectOption value="a">A</NativeSelectOption>
        </NativeSelect>
        <NativeSelect aria-label="Large" size="lg">
          <NativeSelectOption value="a">A</NativeSelectOption>
        </NativeSelect>
      </>,
    )
    const heights = (name: string) =>
      screen
        .getByRole('combobox', { name })
        .className.split(/\s+/)
        .filter((name) => /^h-control-/.test(name))
    expect(heights('Default')).toEqual(['h-control-md'])
    expect(heights('Large')).toEqual(['h-control-lg'])
  })
})
