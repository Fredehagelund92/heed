import { useMediaQuery } from './use-media-query'

/**
 * The shell header's height in pixels: the --header-height token, 48 from 768 wide and 56 on a
 * phone (tokens.css; tests/lint/tokens.test.ts keeps these equal). A list that scrolls under the
 * sticky header needs the number for its scroll padding; CSS reads the token itself.
 */
export const HEADER_HEIGHT = 48
export const HEADER_HEIGHT_PHONE = 56

export function useHeaderHeight() {
  return useMediaQuery('(min-width: 48rem)') ? HEADER_HEIGHT : HEADER_HEIGHT_PHONE
}
