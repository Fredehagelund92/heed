import { createContext, useContext } from 'react'
import type { Crumb } from '@/lib/crumbs'
import type { OriginBack } from './trail'

/**
 * The trail of the page on screen, which the shell works out once (trail.tsx) for the header,
 * Escape and the page: the sidebar place first, the page (or its section) last. Apart from the
 * router, so a page reads it without bringing the router into the chunks pages share.
 */
export const TrailContext = createContext<Crumb[]>([])

export const useTrail = () => useContext(TrailContext)

/** Where the page on screen was opened from, when that is not on its trail (trail.tsx). */
export const OriginContext = createContext<OriginBack | undefined>(undefined)

export const useOrigin = () => useContext(OriginContext)
