import { useMediaQuery } from '@/hooks/use-media-query'

/** Below the Tailwind `md` breakpoint the sidebar becomes a sheet. */
export function useIsMobile() {
  return useMediaQuery('(max-width: 47.99rem)')
}
