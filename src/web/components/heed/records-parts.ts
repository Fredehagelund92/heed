import { ArrowUpRightIcon, SearchIcon, TableIcon } from '@/components/icons'
import { kindIcons } from '@/components/heed/kind-icons'
import { Suggestions } from '@/components/heed/suggestions'
import { openDock } from '@/lib/dock'
import { href } from '@/lib/router'
import { cn } from '@/lib/utils'
import { kindLabel } from '@/model/items'

/**
 * What a records answer (records-answer.tsx) uses of Ask, handed to it by Ask. The answer loads on
 * its own, with the first records answer; were it to import these itself, the bundler would split
 * the code Ask shares with it into one more chunk that Ask's first load then fetches too.
 */
export const recordsParts = {
  ArrowUpRightIcon,
  SearchIcon,
  TableIcon,
  kindIcons,
  kindLabel,
  Suggestions,
  openDock,
  href,
  cn,
}
export type RecordsParts = typeof recordsParts
