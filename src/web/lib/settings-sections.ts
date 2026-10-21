/**
 * The sections of Settings and of Administration, in the order they show. Apart from
 * lib/settings.ts so the address's search params (search-params.ts, on the first load) do not
 * bring the settings' schemas with them.
 *
 * Settings is a person's own (navigation decision, 12 October 2026): their profile and
 * appearance, and connecting their AI. Administration runs the workspace (Workspace) and reads
 * what happened in it (Oversight).
 */
export const settingsSections = ['profile', 'connect'] as const
export type SettingsSection = (typeof settingsSections)[number]

/** A person's own settings, everyone's. The breadcrumb names the section with these too. */
export const settingsSectionTitles: Record<SettingsSection, string> = {
  profile: 'Profile and appearance',
  connect: 'Connect an agent',
}

export const adminSections = [
  'domains',
  'business',
  'people',
  'sources',
  'limits',
  'gateway',
  'import',
  'audit',
  'operations',
] as const
export type AdminSection = (typeof adminSections)[number]

export const adminSectionTitles: Record<AdminSection, string> = {
  domains: 'Domains',
  business: 'About our business',
  people: 'People',
  sources: 'Sources',
  limits: 'Limits',
  gateway: 'MCP and gateway',
  import: 'Import facts',
  audit: 'History log',
  operations: 'Operations',
}

/** Administration's two groups, each with its sections in order. */
export const adminSectionGroups = [
  {
    title: 'Workspace',
    sections: ['domains', 'business', 'people', 'sources', 'limits', 'gateway', 'import'],
  },
  { title: 'Oversight', sections: ['audit', 'operations'] },
] as const satisfies readonly { title: string; sections: readonly AdminSection[] }[]

/**
 * The sections Settings had before Administration took the workspace's (`areas` is Domains now,
 * and Editions exports an edition). An old address with one of them still opens: it is sent to
 * where the section went.
 */
export const retiredSettingsSections = [
  'areas',
  'limits',
  'roles',
  'audit',
  'operations',
  'import',
  'export',
] as const
export type RetiredSettingsSection = (typeof retiredSettingsSections)[number]

/**
 * Where a section Settings had before went: the Administration section that took it over, or
 * Editions for exporting an edition.
 */
export const retiredSettingsSectionMoves: Record<
  RetiredSettingsSection,
  { section: AdminSection } | 'editions'
> = {
  areas: { section: 'domains' },
  limits: { section: 'limits' },
  roles: { section: 'people' },
  audit: { section: 'audit' },
  operations: { section: 'operations' },
  import: { section: 'import' },
  export: 'editions',
}

/**
 * Administration's sections that were renamed: People and roles is People since the People page
 * (people and roles decision, 13 October 2026). An old link opens the new section.
 */
export const retiredAdminSections = ['roles'] as const
export type RetiredAdminSection = (typeof retiredAdminSections)[number]
export const retiredAdminSectionMoves: Record<RetiredAdminSection, AdminSection> = {
  roles: 'people',
}

/**
 * The settings that moved from Limits to the page of the source they belong to (integrations
 * decision, 12 October 2026), by key, with the source's id. An old link to one opens it there.
 */
export const movedSourceSettings: Readonly<Record<string, string>> = {
  'sources.cube_model_url': 'cube',
}

/** The tabs of MCP and gateway. Clients is the default. */
export const gatewayTabs = ['clients', 'connections', 'tools', 'activity'] as const
export type GatewayTab = (typeof gatewayTabs)[number]
