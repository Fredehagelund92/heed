import { toast } from 'sonner'
import {
  ArrowLeftRightIcon,
  ArrowRightIcon,
  AtSignIcon,
  BellIcon,
  CalendarClockIcon,
  CalendarIcon,
  CheckIcon,
  CircleDashedIcon,
  CircleStopIcon,
  FlagIcon,
  GitPullRequestArrowIcon,
  GlobeIcon,
  LayersIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  SigmaIcon,
  SplitIcon,
  TableIcon,
  TagIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PersonAvatar } from '@/components/heed/bits'
import { FoldTrigger } from '@/components/heed/fold'
import { kindIcons } from '@/components/heed/kind-icons'
import { ReadingLine } from '@/components/heed/reading'
import { StateHelp } from '@/components/heed/state-help'
import { useWrite } from '@/api/queries'
import { PRODUCT } from '@/lib/brand'
import { useDefinitions } from '@/lib/definitions'
import { openDock } from '@/lib/dock'
import { ANSWER_LINES } from '@/lib/help-content'
import { href } from '@/lib/router'
import { answerKey, keepShown } from '@/lib/shown-answers'
import { chipTone, domainHue } from '@/lib/tones'
import { cn } from '@/lib/utils'
import { useDomains, useFacts, useMe, usePeople } from '@/lib/workspace'
import { useReadAhead, useReadCitedAhead } from '@/lib/read-ahead'
import { askedOf } from '@/model/ask'
import { isLive } from '@/model/ask-turn'

/**
 * What Ask's loop answer (loop-answer.tsx) uses of Ask, handed to it by Ask, as the records answer
 * is given its parts (records-parts.ts). The answer loads on its own, with the first loop answer;
 * were it to import these itself, the bundler would split the code Ask shares with it into more
 * chunks that Ask's first load then fetches too. Ask adds its own answer actions (answer.tsx).
 */
export const loopParts = {
  toast,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  AtSignIcon,
  BellIcon,
  CalendarClockIcon,
  CalendarIcon,
  CheckIcon,
  CircleDashedIcon,
  CircleStopIcon,
  FlagIcon,
  GitPullRequestArrowIcon,
  GlobeIcon,
  LayersIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  SigmaIcon,
  SplitIcon,
  TableIcon,
  TagIcon,
  TriangleAlertIcon,
  Button,
  Collapsible,
  CollapsibleContent,
  Popover,
  PopoverContent,
  PopoverTrigger,
  PersonAvatar,
  FoldTrigger,
  kindIcons,
  ReadingLine,
  StateHelp,
  useWrite,
  PRODUCT,
  useDefinitions,
  openDock,
  useReadAhead,
  useReadCitedAhead,
  ANSWER_LINES,
  href,
  answerKey,
  keepShown,
  chipTone,
  domainHue,
  cn,
  useDomains,
  useFacts,
  useMe,
  usePeople,
  askedOf,
  isLive,
}
export type LoopPartsOfAsk = typeof loopParts
