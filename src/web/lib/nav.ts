import type { Permissions } from '@/api'
import type { Icon } from '@/components/icons'
import {
  BookOpenIcon,
  BotIcon,
  CircleHelpIcon,
  GaugeIcon,
  GitPullRequestIcon,
  HouseIcon,
  LibraryBigIcon,
  PackageIcon,
  PlugIcon,
  SettingsIcon,
  ShapesIcon,
  UserRoundCogIcon,
  UsersIcon,
} from '@/components/icons'
import { isFor, type Audience } from './permissions'
import type { AdminSection, SettingsSection } from './settings-sections'

export type NavTo =
  | '/'
  | '/assistant'
  | '/library'
  | '/library/bin'
  | '/catalogue'
  | '/proposals'
  | '/editions'
  | '/gaps'
  | '/health'
  | '/admin'
  | '/settings'
  | '/docs'

/**
 * The sidebar groups (contract 8.11; navigation decision, 13 October 2026, second pass): one sidebar, the main
 * places without a label, then one lower group behind a quiet divider, also without a label:
 * Editions, Health and Administration, the places for looking after the library. A place
 * with no group is reached from the palette, its shortcut or the user menu: a person's own
 * Settings open from the user menu. The assistant is a place: its entry opens it full screen, and
 * the launcher in the corner docks it beside another page instead (contract 9.8). Try it is not a
 * place. Docs, Heed's help pages, sit last, behind a divider of their own (docs/help).
 */
export type NavGroup = 'main' | 'manage' | 'help'

export const navGroupLabels: Record<NavGroup, string | null> = {
  main: null,
  manage: null,
  help: null,
}

/** A place: a page the sidebar, the palette and a sequence hotkey go to. */
export type NavItem = {
  id: string
  title: string
  to: NavTo
  /** The part of the page the entry opens, when it is not the page's first. */
  search?: { section: SettingsSection } | { section: AdminSection }
  icon: Icon
  group: NavGroup | null
  /** Sequence hotkey, for example `g>l` ("g" then "l"). Bound and shown from the command registry. */
  hotkey: string
  /** Who sees the entry. A page for a narrower audience also refuses anyone else who opens it. */
  audience: Audience
  /** Extra words the palette matches on. */
  keywords?: readonly string[]
}

/**
 * The top level places. The sidebar, the breadcrumb, the command palette and the sequence
 * hotkeys all read this one list. Shortcuts follow the keyboard map of contract 9.2.
 */
export const navItems: readonly NavItem[] = [
  {
    id: 'home',
    title: 'Home',
    to: '/',
    icon: HouseIcon,
    group: 'main',
    hotkey: 'g>h',
    audience: 'everyone',
  },
  // The assistant full screen, the same conversation as its docked panel (contract 9.8). The
  // assistant makes drafts and proposals only, so it is for everyone (FR-701, FR-706).
  {
    id: 'assistant',
    title: 'Assistant',
    to: '/assistant',
    icon: BotIcon,
    group: 'main',
    hotkey: 'g>a',
    audience: 'everyone',
  },
  {
    id: 'library',
    title: 'Library',
    to: '/library',
    icon: LibraryBigIcon,
    group: 'main',
    hotkey: 'g>l',
    audience: 'everyone',
    // The names people learned before the voice guide (docs/design/voice.md) still find it.
    keywords: ['facts', 'context library', 'items'],
  },
  {
    id: 'catalogue',
    title: 'Catalogue',
    to: '/catalogue',
    icon: ShapesIcon,
    group: 'main',
    hotkey: 'g>o',
    audience: 'everyone',
  },
  {
    id: 'proposals',
    title: 'Proposals',
    to: '/proposals',
    icon: GitPullRequestIcon,
    group: 'main',
    hotkey: 'g>p',
    audience: 'everyone',
  },
  // The numbered releases agents receive. Owners and deputies read them as administrators do;
  // going back and the stop switch stay with administrators (the service's rule).
  {
    id: 'editions',
    title: 'Editions',
    to: '/editions',
    icon: PackageIcon,
    group: 'manage',
    hotkey: 'g>e',
    audience: 'quality',
  },
  // One of the two: Health, in the lower group, for the people who look after a domain, with the
  // gaps, the test questions and each domain's record in it, and the Gaps page among the main
  // places for everyone else (Workbench plan, 3.4). Health keeps the Workbench's keys, since G then H is Home.
  {
    id: 'health',
    title: 'Health',
    to: '/health',
    icon: GaugeIcon,
    group: 'manage',
    hotkey: 'g>w',
    audience: 'quality',
    keywords: ['workbench', 'quality', 'test questions', 'runs', 'domains'],
  },
  {
    id: 'gaps',
    title: 'Gaps',
    to: '/gaps',
    icon: CircleHelpIcon,
    group: 'main',
    hotkey: 'g>m',
    audience: 'contributors',
  },
  // The workspace: domains, about our business, people and roles, sources, limits, the gateway and
  // imports; and oversight, the history log and operations. Auditors read the history log only.
  {
    id: 'admin',
    title: 'Administration',
    to: '/admin',
    icon: SettingsIcon,
    group: 'manage',
    hotkey: 'g>d',
    audience: 'administration',
    keywords: [
      'admin',
      'domains',
      'about our business',
      'people',
      'roles',
      'sources',
      'cube',
      'integrations',
      'limits',
      'gateway',
      'mcp',
      'history log',
      'audit',
    ],
  },
  // People has no sidebar row of its own (it is a section of Administration): the palette finds
  // it as "Find a person" or "Give a role", and g then u opens it (people and roles, slice 1).
  {
    id: 'people',
    title: 'People',
    to: '/admin',
    search: { section: 'people' },
    icon: UsersIcon,
    group: null,
    hotkey: 'g>u',
    audience: 'administrators',
    keywords: [
      'find a person',
      'give a role',
      'roles',
      'email',
      'owner',
      'owner',
      'deputy',
      'approver',
    ],
  },
  // A person's own Settings have no sidebar row: the user menu, the palette and their
  // shortcuts open them. Connect an agent is their second section, and Home's quick action too.
  {
    id: 'connect',
    title: 'Connect an agent',
    to: '/settings',
    search: { section: 'connect' },
    icon: PlugIcon,
    group: null,
    hotkey: 'g>y',
    audience: 'everyone',
    keywords: [
      'mcp',
      'claude',
      'access key',
      'connect your ai',
      'ai app',
      'ai agent',
      'client',
      'token',
    ],
  },
  // Heed's help pages, for everyone (docs/help). They open in docs mode, with a sidebar of their own.
  {
    id: 'docs',
    title: 'Docs',
    to: '/docs',
    icon: BookOpenIcon,
    group: 'help',
    hotkey: 'g>b',
    audience: 'everyone',
    keywords: ['help', 'documentation', 'glossary'],
  },
  {
    id: 'settings',
    title: 'Settings',
    to: '/settings',
    icon: UserRoundCogIcon,
    group: null,
    hotkey: 'g>s',
    audience: 'everyone',
    keywords: ['profile', 'appearance', 'theme'],
  },
]

export const navGroups: readonly NavGroup[] = ['main', 'manage', 'help']

/**
 * The entries of a group the person may use; a group with none is not shown. While the roles load
 * (`undefined`) only the entries for everyone are.
 */
export function navItemsFor(group: NavGroup, permissions: Permissions | undefined): NavItem[] {
  return navItems.filter((item) => item.group === group && isFor(permissions, item.audience))
}
