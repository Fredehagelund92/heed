import {
  RouteIcon,
  RulerIcon,
  TriangleAlertIcon,
  ZapIcon,
  type LucideIcon,
} from '@/components/icons'
import type { Kind } from '@/data/world'

/**
 * A context item's kind as an icon, the same in lists, mentions and the picker. A Rule is a ruler:
 * a fixed measure for reading the numbers. The bulb it replaced said "an idea", which a rule is not.
 */
export const kindIcons: Record<Kind, LucideIcon> = {
  event: ZapIcon,
  issue: TriangleAlertIcon,
  note: RulerIcon,
  guide: RouteIcon,
}
