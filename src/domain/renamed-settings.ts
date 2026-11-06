/**
 * The settings that were named `CL_*` before Heed 0.1.0 and are `HEED_*` since, the rest of each
 * name unchanged. For one release an old name still works when its new name is unset, and the
 * process that reads it says so once; the release after that reads the new names only
 * (docs/contributing/internals.md, "Settings named CL_ before 0.1.0"). This table is the only code
 * that names an old setting: tests/lint/renamed-settings.test.ts fails on one anywhere else.
 */
export const renamedSettings = {
  CL_AUTH: 'HEED_AUTH',
  CL_DEV_PEOPLE_FILE: 'HEED_DEV_PEOPLE_FILE',
  CL_DOMAIN_OVERRIDES: 'HEED_DOMAIN_OVERRIDES',
  CL_FIXED_TODAY: 'HEED_FIXED_TODAY',
  CL_LOGIN_SERVER: 'HEED_LOGIN_SERVER',
  CL_MCP_STATE_KEY_FILE: 'HEED_MCP_STATE_KEY_FILE',
  CL_METRICS_TOKEN: 'HEED_METRICS_TOKEN',
  CL_OAUTH_CONNECTION_DAYS: 'HEED_OAUTH_CONNECTION_DAYS',
  CL_OAUTH_CONSENT_URL: 'HEED_OAUTH_CONSENT_URL',
  CL_OAUTH_DYNAMIC_REGISTRATION: 'HEED_OAUTH_DYNAMIC_REGISTRATION',
  CL_OAUTH_ISSUER: 'HEED_OAUTH_ISSUER',
  CL_OAUTH_PREVIOUS_KEY_FILES: 'HEED_OAUTH_PREVIOUS_KEY_FILES',
  CL_OAUTH_REFRESH_IDLE_HOURS: 'HEED_OAUTH_REFRESH_IDLE_HOURS',
  CL_OAUTH_SIGNING_KEY_FILE: 'HEED_OAUTH_SIGNING_KEY_FILE',
  CL_OIDC_ADMIN_GROUPS: 'HEED_OIDC_ADMIN_GROUPS',
  CL_OIDC_CLIENT_ID: 'HEED_OIDC_CLIENT_ID',
  CL_OIDC_CLIENT_SECRET_FILE: 'HEED_OIDC_CLIENT_SECRET_FILE',
  CL_OIDC_GROUPS_CLAIM: 'HEED_OIDC_GROUPS_CLAIM',
  CL_OIDC_ISSUER: 'HEED_OIDC_ISSUER',
  CL_OIDC_MEMBER_GROUPS: 'HEED_OIDC_MEMBER_GROUPS',
  CL_OIDC_NAME: 'HEED_OIDC_NAME',
  CL_OIDC_REDIRECT_URL: 'HEED_OIDC_REDIRECT_URL',
  CL_OIDC_SCOPES: 'HEED_OIDC_SCOPES',
  CL_PRODUCT_NAME: 'HEED_PRODUCT_NAME',
  CL_SECRETS_DIR: 'HEED_SECRETS_DIR',
  CL_SESSION_IDLE_HOURS: 'HEED_SESSION_IDLE_HOURS',
  CL_SESSION_MAX_DAYS: 'HEED_SESSION_MAX_DAYS',
  CL_SUPPORT_EMAIL: 'HEED_SUPPORT_EMAIL',
  CL_TRUSTED_PROXIES: 'HEED_TRUSTED_PROXIES',
  CL_WEB_ORIGINS: 'HEED_WEB_ORIGINS',
  CL_WEB_READ_LOOPBACK: 'HEED_WEB_READ_LOOPBACK',
} as const

export type OldSettingName = keyof typeof renamedSettings

export type Environment = Record<string, string | undefined>

const isSet = (value: string | undefined) => value !== undefined && value !== ''

/**
 * The environment with each new setting taken from its old name when only the old one is set (an
 * empty value counts as unset, as `.env` files write them), and the old names it took. A new name
 * that is set always wins. When neither name is set, `HEED_DEFAULT_` plus the rest of the name
 * supplies the value, so the image and compose.yaml can ship a default that an operator's old name
 * still overrides, with its warning.
 */
export function withRenamedSettings(environment: Environment): {
  environment: Environment
  oldNames: OldSettingName[]
} {
  const renamed = { ...environment }
  const oldNames: OldSettingName[] = []
  for (const [oldName, newName] of Object.entries(renamedSettings) as [OldSettingName, string][]) {
    if (isSet(environment[newName])) continue
    if (isSet(environment[oldName])) {
      renamed[newName] = environment[oldName]
      oldNames.push(oldName)
      continue
    }
    const shipped = environment[newName.replace(/^HEED_/, 'HEED_DEFAULT_')]
    if (isSet(shipped)) renamed[newName] = shipped
  }
  return { environment: renamed, oldNames }
}

/** The one warning line about old names in use: each with its new name, never a value. */
export function renamedSettingsWarning(oldNames: readonly OldSettingName[]): string {
  const names = oldNames.map((name) => `${name} is now ${renamedSettings[name]}`).join(', ')
  return `Renamed settings: ${names}. The old names work in this release only (docs/operations.md, "Settings that started with CL_").`
}
