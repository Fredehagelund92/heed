import { ArchiveIcon, ArrowDownUpIcon, BoldIcon, CalendarIcon, FilePlusIcon, LinkIcon, MinusIcon, PlusIcon, TypeIcon, type LucideIcon } from "lucide-react"
import type { ChangeKind, Review } from "@/data/review"

/** Each kind of change as a glyph: the review's block labels and the Inbox's rows use the same one. */
export const changeIcons: Record<ChangeKind, LucideIcon> = {
  Wording: TypeIcon,
  Added: PlusIcon,
  Removed: MinusIcon,
  Formatting: BoldIcon,
  Link: LinkIcon,
  Order: ArrowDownUpIcon,
  Dates: CalendarIcon,
}

/** What a suggestion mostly does, as one glyph: a new item, a retirement, or its main kind of change. */
export const suggestionIcon = (r: Review): LucideIcon =>
  r.mode === "new" ? FilePlusIcon : r.mode === "retire" ? ArchiveIcon : changeIcons[r.counts[0]?.kind ?? "Wording"]
