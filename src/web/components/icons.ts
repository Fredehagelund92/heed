import { createElement, forwardRef, type ReactNode, type SVGProps } from 'react'
import { createLucideIcon, LucideProvider, type LucideIcon, type LucideProps } from 'lucide-react'

/**
 * The only module that imports the icon library. Everything else imports icons from here, so
 * the family can be swapped in one place and ESLint can enforce a single icon language.
 * To add an icon, add one line below. Keep the names in the library's `<Name>Icon` form.
 */

/**
 * The stroke every icon draws at (contract 6.11). Lucide's own default is 2, the stock look; the
 * contract's 1.5 is lighter and rounder next to Nunito Sans. A glyph of 14 pixels or less
 * (`size-icon-sm`, and the 12 pixel glyph of a small badge) draws at 1.75 instead, so it keeps its
 * weight: that rule is the `--icon-stroke-sm` token in tokens.css.
 */
export const ICON_STROKE = 1.5

/** Gives every icon below it the contract's stroke. The app root and Storybook wrap in it. */
export function IconProvider({ children }: { children: ReactNode }) {
  return createElement(LucideProvider, { strokeWidth: ICON_STROKE, children })
}

/*
  Heed marks (contract 6.11): the product's own glyphs for its own concepts, the five item kinds,
  the item states, and the domain, risk and validity fields. Everything generic stays on Lucide.

  The construction rules, so the family reads as one hand:
  - A 24 unit grid with a 3 unit margin, stroke 1.75, round caps and joins, no fill on the shell.
  - The shell says what family a mark is: a small scene for a kind, a ring for a state, an outline
    for a field.
  - The point, one stroke or one solid shape, says which one it is: the thing to heed. It takes
    `--heed-point` when a context sets one (`heed-ink` gives a muted glyph a foreground point) and
    the glyph's own colour otherwise, so in a badge or a tile the whole mark is in the hue.
*/

/** The stroke every Heed mark draws at, whatever the size: the family was drawn at it. */
export const HEED_STROKE = 1.75

type HeedShape = readonly [
  tag: 'path' | 'circle' | 'rect',
  attributes: Partial<SVGProps<SVGSVGElement>>,
  /** The point: a stroke (`line`) or a solid shape (`fill`) in the point colour. */
  point?: 'line' | 'fill',
]

/**
 * The Heed mark factory: draws a mark through Lucide's own icon component, so a mark takes the
 * same size, class, colour and accessibility props as any Lucide icon and is an `Icon` wherever
 * one is expected. Its stroke is the family's 1.75 unless a caller sets another.
 */
export function heedIcon(name: string, shapes: readonly HeedShape[]): LucideIcon {
  const Glyph = createLucideIcon(
    `heed-${name}`,
    shapes.map(([tag, attributes, point], index) => [
      tag,
      {
        ...attributes,
        key: `${name}-${index}`,
        ...(point ? { className: point === 'fill' ? 'heed-point-fill' : 'heed-point' } : {}),
      },
    ]),
  )
  const Mark = forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
    ({ strokeWidth = HEED_STROKE, ...props }, ref) =>
      createElement(Glyph, { ...props, strokeWidth, ref }),
  )
  Mark.displayName = Glyph.displayName
  return Mark
}

const ring = { cx: 12, cy: 12, r: 8.5 } as const

/** Event: a flag on a timeline, something that happened in a period. */
export const HeedEventIcon = heedIcon('event', [
  ['path', { d: 'M3.5 20.5h17' }],
  ['path', { d: 'M8 20.5V4' }],
  ['path', { d: 'M8 4.6h10l-2.9 3.7 2.9 3.7H8z' }, 'fill'],
])

/** Note: a card with a folded corner, a lasting remark. */
export const HeedNoteIcon = heedIcon('note', [
  ['path', { d: 'M5 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8.2L13.2 20H7a2 2 0 0 1-2-2z' }],
  ['path', { d: 'M8.5 8.5h7M8.5 12h3.4' }],
  ['path', { d: 'M19 14.2h-5.8V20z' }, 'fill'],
])

/** Guide: a staircase to a goal, how to investigate a question. */
export const HeedGuideIcon = heedIcon('guide', [
  ['path', { d: 'M3.5 20.5h5v-5h5.5v-5.5h5.5' }],
  ['circle', { cx: 19.5, cy: 5.6, r: 2.6 }, 'fill'],
])

/** Example: a speech bubble with a check, a checked question and its answer. */
export const HeedExampleIcon = heedIcon('example', [
  [
    'path',
    {
      d: 'M5 4.5h14a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2h-6.2L8 21v-4.3H5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z',
    },
  ],
  ['path', { d: 'M8.4 10.7l2.5 2.5 4.7-5' }, 'line'],
])

/** Issue: a rounded warning, a temporary problem. Also the Active issue state. */
export const HeedIssueIcon = heedIcon('issue', [
  [
    'path',
    {
      d: 'M10.7 4.6a1.5 1.5 0 0 1 2.6 0l7.6 13.2a1.5 1.5 0 0 1-1.3 2.2H4.4a1.5 1.5 0 0 1-1.3-2.2z',
    },
  ],
  ['path', { d: 'M12 9.6v4' }, 'line'],
  ['path', { d: 'M12 16.8h.01' }, 'line'],
])

/** Source missing: a ghost (dashed) ring with a cross, what it relies on is gone. */
export const HeedSourceMissingIcon = heedIcon('source-missing', [
  ['circle', { ...ring, strokeDasharray: '3.1 3.1', strokeDashoffset: 1.55 }],
  ['path', { d: 'M9.6 9.6l4.8 4.8M14.4 9.6l-4.8 4.8' }, 'line'],
])

/** Source changed: a ring that turns, with its arrow head. */
export const HeedSourceChangedIcon = heedIcon('source-changed', [
  ['path', { d: 'M20.4 12A8.4 8.4 0 1 1 17.9 6.05' }],
  ['path', { d: 'M18.3 2.6v3.9h-3.9' }, 'line'],
])

/** Re-check due: a ring with clock hands, its review date has passed. */
export const HeedRecheckDueIcon = heedIcon('recheck-due', [
  ['circle', ring],
  ['path', { d: 'M12 7.6V12l3 1.8' }, 'line'],
])

/** Accepted: a ring with a check. Neutral in every theme: a healthy item is never green. */
export const HeedAcceptedIcon = heedIcon('accepted', [
  ['circle', ring],
  ['path', { d: 'M8.1 12.4l2.7 2.7 5.2-5.6' }, 'line'],
])

/** Ended: a ring with a stop square, its last day has passed. */
export const HeedEndedIcon = heedIcon('ended', [
  ['circle', ring],
  ['rect', { x: 9, y: 9, width: 6, height: 6, rx: 1.3 }, 'fill'],
])

/** Retired: a ring with a minus, taken out of service. */
export const HeedRetiredIcon = heedIcon('retired', [
  ['circle', ring],
  ['path', { d: 'M8 12h8' }, 'line'],
])

/** Edit waiting: a ring with a pencil, and a dot on its rim for the edit that waits. */
export const HeedEditWaitingIcon = heedIcon('edit-waiting', [
  ['path', { d: 'M20.13 9.52A8.5 8.5 0 1 1 14.48 3.87' }],
  ['circle', { cx: 18, cy: 6, r: 2.5 }, 'fill'],
  [
    'path',
    {
      d: 'M9 15l.6-2.6 4.2-4.2a1.1 1.1 0 0 1 1.5 0l.5.5a1.1 1.1 0 0 1 0 1.5l-4.2 4.2z',
    },
    'line',
  ],
])

/** Domain: a 2 by 2 map with one cell filled, the business area an item belongs to. */
export const HeedDomainIcon = heedIcon('domain', [
  ['rect', { x: 4, y: 4, width: 7, height: 7, rx: 2 }],
  ['rect', { x: 13, y: 4, width: 7, height: 7, rx: 2 }],
  ['rect', { x: 4, y: 13, width: 7, height: 7, rx: 2 }],
  ['rect', { x: 13, y: 13, width: 7, height: 7, rx: 2 }, 'fill'],
])

/** Risk: three bars with the tallest filled. */
export const HeedRiskIcon = heedIcon('risk', [
  ['rect', { x: 4, y: 14, width: 4, height: 6, rx: 1.2 }],
  ['rect', { x: 10, y: 10, width: 4, height: 10, rx: 1.2 }],
  ['rect', { x: 16, y: 5, width: 4, height: 15, rx: 1.2 }, 'fill'],
])

/** Valid until: a calendar with an end tick, the period an item applies. */
export const HeedValidUntilIcon = heedIcon('valid-until', [
  ['rect', { x: 3.5, y: 5, width: 17, height: 15.5, rx: 3 }],
  ['path', { d: 'M3.5 10h17M8 3v4M16 3v4' }],
  ['path', { d: 'M7.6 15h5.2' }, 'line'],
  ['path', { d: 'M16.4 13v4' }, 'line'],
])

/** Every Heed mark, in the order of the contract's glyph table: a story and a test walk it. */
export const heedMarks = {
  event: HeedEventIcon,
  note: HeedNoteIcon,
  guide: HeedGuideIcon,
  example: HeedExampleIcon,
  issue: HeedIssueIcon,
  'source-missing': HeedSourceMissingIcon,
  'source-changed': HeedSourceChangedIcon,
  'recheck-due': HeedRecheckDueIcon,
  accepted: HeedAcceptedIcon,
  ended: HeedEndedIcon,
  retired: HeedRetiredIcon,
  'edit-waiting': HeedEditWaitingIcon,
  domain: HeedDomainIcon,
  risk: HeedRiskIcon,
  'valid-until': HeedValidUntilIcon,
} as const satisfies Record<string, LucideIcon>

export {
  ActivityIcon,
  AlignLeftIcon,
  ArchiveIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowRightLeftIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  AtSignIcon,
  BadgeCheckIcon,
  BellIcon,
  BoldIcon,
  BookOpenIcon,
  BotIcon,
  Building2Icon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarIcon,
  CalendarSyncIcon,
  ChartColumnIcon,
  CheckCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleHelpIcon,
  CircleSlashIcon,
  CircleStopIcon,
  CircleXIcon,
  ClockIcon,
  CloudIcon,
  CloudOffIcon,
  CodeIcon,
  CodeXmlIcon,
  Columns2Icon,
  CommandIcon,
  CopyIcon,
  CornerDownLeftIcon,
  DatabaseIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  EyeIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  FlagIcon,
  FlaskConicalIcon,
  FolderIcon,
  FootprintsIcon,
  GaugeIcon,
  GitCommitHorizontalIcon,
  GitBranchIcon,
  GitCompareArrowsIcon,
  GitPullRequestIcon,
  GlobeIcon,
  HashIcon,
  Heading2Icon,
  Heading3Icon,
  HistoryIcon,
  HouseIcon,
  InboxIcon,
  InfoIcon,
  ItalicIcon,
  KeyRoundIcon,
  KeyboardIcon,
  LayersIcon,
  LibraryBigIcon,
  Link2OffIcon,
  LinkIcon,
  ListChecksIcon,
  ListFilterIcon,
  ListIcon,
  ListPlusIcon,
  ListOrderedIcon,
  ListTreeIcon,
  LoaderCircleIcon,
  LockIcon,
  LogInIcon,
  LogOutIcon,
  Maximize2Icon,
  MenuIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  Minimize2Icon,
  MinusIcon,
  MonitorIcon,
  MoonIcon,
  NetworkIcon,
  NotebookPenIcon,
  PackageIcon,
  PanelLeftIcon,
  PaperclipIcon,
  PencilIcon,
  PencilLineIcon,
  PercentIcon,
  PinIcon,
  PlayIcon,
  PlugIcon,
  PlusIcon,
  QuoteIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Rows3Icon,
  ScaleIcon,
  SearchIcon,
  SearchXIcon,
  SendIcon,
  SettingsIcon,
  ShapesIcon,
  ShieldCheckIcon,
  SigmaIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SplitIcon,
  SquareCheckIcon,
  SquareIcon,
  SquarePenIcon,
  StarIcon,
  SunIcon,
  Table2Icon,
  TableIcon,
  TagIcon,
  TargetIcon,
  TextAlignStartIcon,
  TextQuoteIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TimerIcon,
  Trash2Icon,
  TriangleAlertIcon,
  TypeIcon,
  Undo2Icon,
  UnlinkIcon,
  UploadIcon,
  UserRoundCheckIcon,
  UserRoundCogIcon,
  UserRoundIcon,
  UserRoundPenIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
export type { LucideIcon as Icon } from 'lucide-react'
