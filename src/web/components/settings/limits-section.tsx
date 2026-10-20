import { Fragment, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { Setting } from '@/api'
import { settingsQuery } from '@/api/queries'
import { ClockIcon, SlidersHorizontalIcon, TextAlignStartIcon } from '@/components/icons'
import { openRowClass, useDockMode } from '@/components/page/dock-panel'
import { gridCell } from '@/components/page/grid'
import {
  GridFailed,
  GridHeaderCells,
  GridLoading,
  GridTable,
  gridRowClass,
  type GridColumn,
} from '@/components/page/grid-table'
import { PageContent } from '@/components/page/page'
import { useDockList } from '@/components/page/use-dock-list'
import { panelRowHistory } from '@/lib/history'
import { formatMoment } from '@/lib/library'
import type { AdminSearch } from '@/lib/search-params'
import {
  groupSettings,
  isSettingKey,
  limitsSettingGroups,
  settingGroupTitles,
  settingMeta,
  settingWords,
} from '@/lib/settings'
import { cn } from '@/lib/utils'
import { SettingPanel } from './setting-panel'
import { SettingsBlock } from './settings-parts'

const SLOT = 'settings-limits'
const optional = '@max-3xl:hidden'

const columns: GridColumn[] = [
  { icon: SlidersHorizontalIcon, title: 'Setting', className: 'min-w-0 flex-1' },
  { icon: TextAlignStartIcon, title: 'Value', className: 'min-w-0 flex-1' },
  { icon: ClockIcon, title: 'Changed', className: cn('w-column-changed', optional) },
]

/**
 * Limits (FR-809): every limit, threshold, retention period and model an administrator may
 * change, by group, each with its value in words and when it last changed. A source's settings
 * are on its page in Sources. A
 * row opens the setting in the docked panel, where it changes with a reason and shows every
 * earlier version. The open setting is in the address (`setting=`), so it is linkable.
 */
export function LimitsSection({ search }: { search: AdminSearch }) {
  const settings = useQuery(settingsQuery())
  const navigate = useNavigate()
  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const groups = useMemo(
    () => groupSettings(settings.data ?? [], limitsSettingGroups),
    [settings.data],
  )
  const ids = useMemo(
    () => groups.flatMap((entry) => entry.settings.map((setting) => setting.key)),
    [groups],
  )
  const open = search.setting ?? null
  const list = { section: 'limits' as const }
  const dock = useDockList({
    region,
    ids,
    panelId: open,
    open: (key) =>
      void navigate({
        to: '/admin',
        search: { ...list, setting: key },
        replace: true,
        state: true,
        resetScroll: false,
      }),
    close: () => void navigate({ to: '/admin', search: list, replace: true, resetScroll: false }),
    searchRef,
    enabled: !settings.isPending,
  })
  const mode = useDockMode()
  const openSetting: Setting | null | undefined = open
    ? settings.data
      ? (settings.data.find((setting) => setting.key === open) ?? null)
      : undefined
    : undefined
  const go = (key: string | undefined) =>
    key
      ? () =>
          void navigate({
            to: '/admin',
            search: { ...list, setting: key },
            replace: true,
            state: true,
            resetScroll: false,
          })
      : undefined

  let body
  if (settings.isPending) body = <GridLoading slot={SLOT} label="Loading the settings" />
  else if (settings.isError)
    body = <GridFailed slot={SLOT} what="the settings" retry={() => void settings.refetch()} />
  else
    body = (
      <div ref={setRegion} hidden={open !== null && mode === 'full'}>
        <GridTable slot={SLOT} label="Settings" header={<GridHeaderCells columns={columns} />}>
          {groups.map(({ group, settings: rows }) => (
            <Fragment key={group}>
              <div role="row" className="flex h-row items-center bg-sidebar px-3">
                <div role="rowheader" className="text-dense font-bold">
                  {settingGroupTitles[group]}
                </div>
              </div>
              {rows.map((setting) => (
                <SettingRow
                  key={setting.key}
                  setting={setting}
                  open={setting.key === open}
                  replace={open !== null}
                />
              ))}
            </Fragment>
          ))}
        </GridTable>
      </div>
    )

  return (
    <PageContent width="overview" className="gap-8">
      <SettingsBlock
        title="Limits and settings"
        slot="limits-block"
        description="What people and AI apps can do, what we keep, and which AI models we use. Each change is a new version with a reason, and earlier versions stay in its history."
      >
        {body}
      </SettingsBlock>
      {open !== null ? (
        <SettingPanel
          key={open}
          setting={openSetting}
          position={dock.position}
          onPrevious={go(dock.previousId)}
          onNext={go(dock.nextId)}
          onClose={dock.closePanel}
        />
      ) : null}
    </PageContent>
  )
}

function SettingRow({
  setting,
  open,
  replace,
}: {
  setting: Setting
  open: boolean
  /** Whether a setting is open already, so opening this one replaces it in the history. */
  replace: boolean
}) {
  const title = isSettingKey(setting.key) ? settingMeta[setting.key].title : setting.key
  const words = settingWords(setting.key, setting.value)
  return (
    <div
      role="row"
      data-row-id={setting.key}
      data-setting={setting.key}
      data-open={open || undefined}
      className={cn(gridRowClass, openRowClass)}
    >
      <div role="cell" className={cn(gridCell, 'min-w-0 flex-1')}>
        <Link
          to="/admin"
          search={{ section: 'limits', setting: setting.key }}
          {...panelRowHistory(replace)}
          resetScroll={false}
          data-row-link
          className="block min-w-0 truncate text-body outline-none after:absolute after:inset-0"
        >
          {title}
        </Link>
      </div>
      <div role="cell" className={cn(gridCell, 'min-w-0 flex-1')}>
        <span className="truncate" title={words}>
          {words}
        </span>
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-changed tabular-nums', optional)}>
        <span
          className="truncate text-muted-foreground"
          title={formatMoment(setting.changedAt, 'long')}
        >
          {formatMoment(setting.changedAt)}
        </span>
      </div>
    </div>
  )
}
