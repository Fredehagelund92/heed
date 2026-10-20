import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Setting } from '@/api'
import { toApiError } from '@/api'
import { settingHistoryQuery, toolsQuery, useApiWrite } from '@/api/queries'
import {
  CircleAlertIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  SlidersHorizontalIcon,
} from '@/components/icons'
import { DockPanel, type DockTab } from '@/components/page/dock-panel'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldControl,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldGroup,
  FieldHeader,
  FieldItem,
  FieldItemContent,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { formatMoment } from '@/lib/library'
import {
  fieldsOf,
  JUDGE_MODE,
  settingFormValue,
  settingFormValues,
  settingMeta,
  settingWords,
  type SettingField,
} from '@/lib/settings'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { usePeople } from './settings-parts'
import type { SettingKey } from '../../../contract/admin.ts'

type PanelTab = 'change' | 'history'
const REASON_MAX = 500

/**
 * One setting in the docked panel (FR-809): what it does and its value now, a form that changes
 * it with a reason, and every earlier version with who changed it and why. A change is a new
 * version, never an edit, and names the version it was made on: if another administrator saved
 * first, the panel says so and shows their version instead of overwriting it.
 */
export function SettingPanel({
  setting,
  position,
  onPrevious,
  onNext,
  onClose,
}: {
  /** The setting as the list read it; undefined while it loads, null when the key is unknown. */
  setting: Setting | null | undefined
  position: { index: number; total: number } | null
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<PanelTab>('change')
  const shared = {
    meta: (
      <>
        <span className="truncate">Setting</span>
        {position ? (
          <span className="shrink-0">
            · {(position.index + 1).toLocaleString('en')} of {position.total.toLocaleString('en')}
          </span>
        ) : null}
      </>
    ),
    onPrevious,
    onNext,
    onClose,
  }
  if (setting === undefined) return <DockPanel title={null} {...shared} />
  if (setting === null || !Object.hasOwn(settingMeta, setting.key))
    return (
      <DockPanel title="This setting isn't available" {...shared}>
        <p className="text-body text-muted-foreground">
          You can change only the settings in the list. Close this and choose another.
        </p>
      </DockPanel>
    )
  const key = setting.key as SettingKey
  const meta = settingMeta[key]
  const tabs: DockTab<PanelTab>[] = [
    { value: 'change', label: 'Change' },
    { value: 'history', label: 'History' },
  ]
  return (
    <DockPanel
      title={meta.title}
      contentKey={key}
      tabs={tabs}
      tab={tab}
      onTabChange={setTab}
      tabsLabel={`${meta.title} sections`}
      note={
        <div className="flex flex-col gap-2">
          <p className="text-body text-muted-foreground">{meta.description}</p>
          <p className="text-body">
            <span className="text-muted-foreground">Now: </span>
            <span data-slot="setting-current">{settingWords(key, setting.value)}</span>
          </p>
        </div>
      }
      {...shared}
    >
      <TabsContent value="change">
        <SettingForm key={`${key}.${setting.version}`} setting={setting} settingKey={key} />
      </TabsContent>
      <TabsContent value="history">
        <SettingHistory settingKey={key} />
      </TabsContent>
    </DockPanel>
  )
}

function SettingForm({ setting, settingKey }: { setting: Setting; settingKey: SettingKey }) {
  const meta = settingMeta[settingKey]
  const { data: toolList } = useQuery({
    ...toolsQuery(),
    enabled: settingKey === 'limits.mcp_rate_per_minute',
  })
  const tools = toolList?.map((tool) => tool.tool) ?? []
  const fields = fieldsOf(settingKey, setting.value, tools)
  const save = useApiWrite('setSetting')
  const [values, setValues] = useState(() => settingFormValues(settingKey, setting.value, tools))
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const spinning = usePendingIndicator(busy)
  const judgeOther = meta.shape === 'judge' && values[JUDGE_MODE] !== 'model'

  const check = (next: Record<string, string>, nextReason: string) => {
    const result = settingFormValue(settingKey, next, tools, setting.value)
    const problems = result.ok ? {} : { ...result.errors }
    if (!nextReason.trim()) problems.reason = "Say why you're changing it."
    else if ([...nextReason.trim()].length > REASON_MAX)
      problems.reason = 'Keep the reason to 500 characters.'
    return { result, problems }
  }
  const change = (name: string, value: string) => {
    const next = { ...values, [name]: value }
    setValues(next)
    // A field marked wrong is checked again as it is corrected.
    if (Object.keys(errors).length) {
      const { problems } = check(next, reason)
      setErrors(
        Object.fromEntries(
          Object.keys(errors).flatMap((key) => (problems[key] ? [[key, problems[key]]] : [])),
        ),
      )
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const { result, problems } = check(values, reason)
    setErrors(problems)
    const first = [...fields.map((field) => field.name), 'reason'].find((name) => problems[name])
    if (first || !result.ok) {
      document.getElementById(`setting-${first ?? 'reason'}`)?.focus()
      return
    }
    setFailure(null)
    setBusy(true)
    try {
      const saved = await save.mutateAsync({
        key: settingKey,
        version: setting.version,
        value: result.value,
        reason: reason.trim(),
      })
      showToast(`${meta.title} saved`, `Now ${settingWords(settingKey, saved.value)}.`)
    } catch (error) {
      const refused = toApiError(error)
      setFailure(
        refused.kind === 'conflict'
          ? 'Another admin changed this setting after you opened it. You now see their version. Check it, then change it again.'
          : refused.message || 'Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const input = (field: SettingField) => (
    <Field key={field.name} name={field.name} invalid={Boolean(errors[field.name])} disabled={busy}>
      <FieldHeader>
        <FieldLabel optional={field.optional}>
          {field.label}
          {field.unit && field.unit !== field.label.toLowerCase() ? (
            <span className="font-normal text-muted-foreground">, {field.unit}</span>
          ) : null}
        </FieldLabel>
        {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
      </FieldHeader>
      <FieldControl
        value={values[field.name] ?? ''}
        onValueChange={(next) => change(field.name, String(next))}
        render={
          <Input
            id={`setting-${field.name}`}
            size="lg"
            autoComplete="off"
            inputMode={
              field.kind === 'int'
                ? 'numeric'
                : field.kind === 'dollars'
                  ? 'decimal'
                  : field.kind === 'url'
                    ? 'url'
                    : undefined
            }
            spellCheck={field.kind === 'text' || field.kind === 'url' ? false : undefined}
            className={cn(
              (field.kind === 'int' || field.kind === 'dollars') && 'w-number-field tabular-nums',
            )}
          />
        }
      />
      <FieldError>{errors[field.name]}</FieldError>
    </Field>
  )

  return (
    <form
      noValidate
      aria-label={`Change ${meta.title}`}
      onSubmit={(event) => void submit(event)}
      aria-busy={busy || undefined}
      className="flex flex-col gap-6"
    >
      {failure ? (
        <Alert variant="danger" role="alert">
          <CircleAlertIcon aria-hidden />
          <AlertContent>
            <AlertTitle>The setting wasn't saved</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </AlertContent>
        </Alert>
      ) : null}
      <FieldGroup>
        {meta.shape === 'judge' ? (
          <Field name={JUDGE_MODE} disabled={busy}>
            <FieldSet
              render={
                <RadioGroup
                  value={values[JUDGE_MODE]}
                  onValueChange={(next: string) => change(JUDGE_MODE, next)}
                />
              }
            >
              <FieldLegend icon={SlidersHorizontalIcon}>Judge</FieldLegend>
              <FieldItem>
                <RadioGroupItem value="different_family" />
                <FieldItemContent>
                  <FieldLabel>Another model line</FieldLabel>
                  <FieldDescription>
                    A model from the same provider and maker, but from another line than the model
                    that answers, so it doesn't favour its own answers. If the provider lists no
                    other line from that maker, the model that answers judges itself.
                  </FieldDescription>
                </FieldItemContent>
              </FieldItem>
              <FieldItem>
                <RadioGroupItem value="model" />
                <FieldItemContent>
                  <FieldLabel>A model named here</FieldLabel>
                </FieldItemContent>
              </FieldItem>
            </FieldSet>
          </Field>
        ) : null}
        {judgeOther ? null : fields.map(input)}
        <Field name="reason" invalid={Boolean(errors.reason)} disabled={busy}>
          <FieldHeader>
            <FieldLabel icon={MessageSquareIcon}>Why</FieldLabel>
            <FieldDescription>The history log keeps it with the new version.</FieldDescription>
          </FieldHeader>
          <FieldControl
            id="setting-reason"
            value={reason}
            onValueChange={(next) => {
              setReason(String(next))
              if (errors.reason)
                setErrors((current) => ({
                  ...current,
                  reason: check(values, String(next)).problems.reason ?? '',
                }))
            }}
            render={<Textarea rows={3} className="resize-y text-body pointer-coarse:text-large" />}
          />
          <FieldFooter>
            <FieldError>{errors.reason || undefined}</FieldError>
            <FieldCounter count={[...reason].length} max={REASON_MAX} />
          </FieldFooter>
        </Field>
      </FieldGroup>
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          aria-disabled={busy || undefined}
          onMouseDown={(event) => event.preventDefault()}
          className="relative"
        >
          <span className={spinning ? 'opacity-0' : undefined}>Save new version</span>
          {spinning ? (
            <LoaderCircleIcon
              aria-hidden
              className="absolute inset-0 m-auto motion-safe:animate-spin"
            />
          ) : null}
        </Button>
        <p role="status" className="sr-only">
          {spinning ? 'Saving' : ''}
        </p>
      </div>
    </form>
  )
}

/** Every version of the setting, newest first: the value, when, who and why. */
export function SettingHistory({ settingKey }: { settingKey: SettingKey }) {
  const history = useQuery(settingHistoryQuery(settingKey))
  const { nameOf } = usePeople()
  if (history.isPending)
    return (
      <div role="status" aria-label="Loading the history" className="flex flex-col gap-2">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    )
  if (history.isError)
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body text-muted-foreground">We couldn&apos;t load the history.</p>
        <Button variant="outline" onClick={() => void history.refetch()}>
          Try again
        </Button>
      </div>
    )
  return (
    <ol
      aria-label="Versions, newest first"
      data-slot="setting-history"
      className="flex flex-col divide-y rounded-lg border"
    >
      {history.data.map((version, index) => (
        <li key={version.version} className="flex px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-body">
              <span className="font-bold">{settingWords(settingKey, version.value)}</span>
              {index === 0 ? <span className="text-muted-foreground"> · now</span> : null}
            </p>
            <p className="text-dense text-muted-foreground">
              Version {version.version} · {formatMoment(version.changedAt)} ·{' '}
              {version.changedBy ? nameOf(version.changedBy) : 'Set at installation'}
            </p>
            {version.reason ? <p className="text-dense">{version.reason}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}
