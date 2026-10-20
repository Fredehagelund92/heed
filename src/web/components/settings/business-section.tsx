import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ABOUT_BUSINESS_GUIDE,
  ABOUT_BUSINESS_MAX,
  ABOUT_BUSINESS_STARTER,
  aboutBusinessBlock,
  aboutBusinessLength,
} from '@domain/about-business'
import { toApiError, type Setting } from '@/api'
import { settingsQuery, useApiWrite, useDraftAboutBusiness } from '@/api/queries'
import { BodyInput } from '@/components/editor/body-input'
import { HelpLink } from '@/components/help/help-link'
import {
  Building2Icon,
  CircleAlertIcon,
  InfoIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SparklesIcon,
  Undo2Icon,
} from '@/components/icons'
import { PageContent } from '@/components/page/page'
import { CopyBlock } from '@/components/try-it/copy-block'
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
  FieldLabel,
} from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { productName } from '@/lib/brand'
import { formatMoment } from '@/lib/library'
import { showToast } from '@/lib/toast'
import { SettingHistory } from './setting-panel'
import { SettingsBlock, usePeople } from './settings-parts'
import { settingSchemas } from '../../../contract/admin.ts'

const KEY = 'business.about'
const REASON_MAX = 500

/**
 * About our business (captain, 15 October 2026): a short text that tells the assistant and the AI
 * apps that connect what the company does and what its words mean, so they do not start from
 * nothing. An administrator writes it here, sees exactly what the models are given as they type,
 * can put the starter text back, and saves a new version with a reason; the history shows who
 * changed it and when. It is background, never evidence, and the page says so.
 */
export function BusinessSection() {
  const settings = useQuery(settingsQuery())
  const setting = settings.data?.find((entry) => entry.key === KEY)
  let body
  if (settings.isPending)
    body = (
      <div role="status" aria-label="Loading About our business" className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-chart w-full" />
      </div>
    )
  else if (settings.isError || !setting)
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body text-muted-foreground">
          {settings.isError ? "We couldn't load About our business." : "There's no text yet."}
        </p>
        <Button variant="outline" onClick={() => void settings.refetch()}>
          Try again
        </Button>
      </div>
    )
  else body = <BusinessForm key={setting.version} setting={setting} />
  return (
    <PageContent width="reading" className="gap-8" data-slot="settings-business">
      <Alert>
        <InfoIcon aria-hidden />
        <AlertContent>
          <AlertTitle>Background, not a source</AlertTitle>
          <AlertDescription>
            The assistant gets this text with every question, and AI apps get it when they connect,
            so they know what the business is and what its words mean. It&apos;s never quoted or
            counted as a source, and AI apps never get it as a fact. Facts about a metric, a market
            or a date belong in the library, where the owners of each domain check them.
          </AlertDescription>
        </AlertContent>
      </Alert>
      {body}
      <SettingsBlock
        title="History"
        description="Every version, newest first, with who saved it, when and why."
      >
        <SettingHistory settingKey={KEY} />
      </SettingsBlock>
    </PageContent>
  )
}

function BusinessForm({ setting }: { setting: Setting }) {
  const saved = typeof setting.value === 'string' ? setting.value : ''
  const [text, setText] = useState(saved)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<{ text?: string; reason?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const spinning = usePendingIndicator(busy)
  const save = useApiWrite('setSetting')
  const draft = useDraftAboutBusiness()
  const drafting = usePendingIndicator(draft.isPending)
  /** What the box held before a first version replaced it, for putting it back. */
  const [drafted, setDrafted] = useState<{ before: string } | null>(null)
  const [nothingToWrite, setNothingToWrite] = useState(false)
  const [draftFailure, setDraftFailure] = useState<string | null>(null)
  const { nameOf } = usePeople()
  const block = aboutBusinessBlock(text)

  const check = (nextText: string, nextReason: string) => ({
    ...(aboutBusinessLength(nextText) > ABOUT_BUSINESS_MAX
      ? { text: `Keep it to ${ABOUT_BUSINESS_MAX.toLocaleString('en')} characters.` }
      : {}),
    ...(!nextReason.trim()
      ? { reason: "Say why you're changing it." }
      : [...nextReason.trim()].length > REASON_MAX
        ? { reason: 'Keep the reason to 500 characters.' }
        : {}),
  })
  // A field marked wrong is checked again as it is corrected.
  const recheck = (nextText: string, nextReason: string) => {
    if (!errors.text && !errors.reason) return
    const problems = check(nextText, nextReason)
    setErrors({
      ...(errors.text && problems.text ? { text: problems.text } : {}),
      ...(errors.reason && problems.reason ? { reason: problems.reason } : {}),
    })
  }

  /** Puts a first version in the box. It is not saved: the administrator reads and edits it first. */
  const writeFirstVersion = async () => {
    if (busy || draft.isPending) return
    setDraftFailure(null)
    setNothingToWrite(false)
    try {
      const written = await draft.mutateAsync()
      if (!written.text) {
        setDrafted(null)
        setNothingToWrite(true)
        return
      }
      setDrafted({ before: text })
      setText(written.text)
      setErrors({})
      document.getElementById('business-text')?.focus()
    } catch (error) {
      setDraftFailure(toApiError(error).message || 'Try again.')
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const problems = check(text, reason)
    setErrors(problems)
    if (problems.text || problems.reason) {
      document.getElementById(problems.text ? 'business-text' : 'business-reason')?.focus()
      return
    }
    const parsed = settingSchemas[KEY].safeParse(text)
    if (!parsed.success) {
      setErrors({ text: parsed.error.issues[0]?.message ?? 'Check the text.' })
      return
    }
    setFailure(null)
    setBusy(true)
    try {
      await save.mutateAsync({
        key: KEY,
        version: setting.version,
        value: parsed.data,
        reason: reason.trim(),
      })
      showToast(
        'About our business saved',
        parsed.data
          ? 'The assistant and AI apps get the new text from their next question.'
          : 'The text is empty, so the assistant and AI apps get no background.',
      )
    } catch (error) {
      const refused = toApiError(error)
      setFailure(
        refused.kind === 'conflict'
          ? 'Another admin saved a new version after you opened this page. You now see their version, so check it before you change it again.'
          : refused.message || 'Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsBlock
        title="The text"
        slot="business-text"
        description={
          <>
            Headings, lists and links show as you type.{' '}
            <HelpLink to="tell-heed-about-your-business">More on what makes a good text</HelpLink>
          </>
        }
      >
        <p className="text-dense text-muted-foreground" data-slot="business-saved">
          Version {setting.version.toLocaleString('en')}, saved {formatMoment(setting.changedAt)}
          {setting.changedBy ? ` by ${nameOf(setting.changedBy)}` : ', when the app was set up'}.
        </p>
        <form
          noValidate
          aria-label="Change About our business"
          onSubmit={(event) => void submit(event)}
          aria-busy={busy || undefined}
          className="flex flex-col gap-6"
        >
          {failure ? (
            <Alert variant="danger" role="alert">
              <CircleAlertIcon aria-hidden />
              <AlertContent>
                <AlertTitle>We couldn&apos;t save the text</AlertTitle>
                <AlertDescription>{failure}</AlertDescription>
              </AlertContent>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field name="text" invalid={Boolean(errors.text)} disabled={busy}>
              <FieldHeader>
                <FieldLabel
                  id="business-text-label"
                  icon={Building2Icon}
                  onClick={() => document.getElementById('business-text')?.focus()}
                >
                  About our business
                </FieldLabel>
                <FieldDescription
                  id="business-text-hint"
                  render={<div />}
                  data-slot="business-guide"
                  className="flex flex-col gap-2"
                >
                  <ol className="flex list-decimal flex-col gap-1 pl-4 marker:font-bold">
                    {ABOUT_BUSINESS_GUIDE.parts.map((part) => (
                      <li key={part.title}>
                        <span className="font-bold text-foreground">{part.title}.</span> {part.hint}
                      </li>
                    ))}
                  </ol>
                  <p>
                    <span className="font-bold text-foreground">
                      {ABOUT_BUSINESS_GUIDE.leaveOut.title}:
                    </span>{' '}
                    {ABOUT_BUSINESS_GUIDE.leaveOut.hint}
                  </p>
                  <p>{ABOUT_BUSINESS_GUIDE.empty}</p>
                </FieldDescription>
              </FieldHeader>
              {/* The editor item text uses (contract 9.6), mentions off: the text stays the
                  plain Markdown the models are given. */}
              <BodyInput
                id="business-text"
                appearance="field"
                size="reading"
                mentions={false}
                labelledBy="business-text-label"
                describedBy={
                  errors.text ? 'business-text-hint business-text-error' : 'business-text-hint'
                }
                value={text}
                onChange={(next) => {
                  setText(next)
                  setDrafted(null)
                  setNothingToWrite(false)
                  recheck(next, reason)
                }}
                max={ABOUT_BUSINESS_MAX}
                count={aboutBusinessLength}
                invalid={Boolean(errors.text)}
                disabled={busy}
              />
              <FieldError id="business-text-error">{errors.text || undefined}</FieldError>
            </Field>
            <div className="flex flex-col gap-3" data-slot="business-helpers">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  aria-disabled={busy || draft.isPending || undefined}
                  onClick={() => void writeFirstVersion()}
                  className="relative"
                >
                  <span className={drafting ? 'opacity-0' : 'inline-flex items-center gap-2'}>
                    <SparklesIcon aria-hidden />
                    Write a first version for me
                  </span>
                  {drafting ? (
                    <LoaderCircleIcon
                      aria-hidden
                      className="absolute inset-0 m-auto motion-safe:animate-spin"
                    />
                  ) : null}
                </Button>
                <p className="text-dense text-muted-foreground">
                  Drafts from what {productName} knows. Nothing changes until you save.
                </p>
              </div>
              <p role="status" className="sr-only">
                {draft.isPending ? 'Writing a first version' : ''}
              </p>
              {draftFailure ? (
                <Alert variant="danger" role="alert">
                  <CircleAlertIcon aria-hidden />
                  <AlertContent>
                    <AlertTitle>We couldn&apos;t write a first version</AlertTitle>
                    <AlertDescription>{draftFailure}</AlertDescription>
                  </AlertContent>
                </Alert>
              ) : null}
              {drafted ? (
                <div data-slot="business-drafted" className="flex flex-col items-start gap-2">
                  <p role="status" className="text-dense text-muted-foreground">
                    A first version is in the box. {productName} can&apos;t know what your company
                    sells, so check the first lines and change what&apos;s wrong, then save.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setText(drafted.before)
                      recheck(drafted.before, reason)
                      setDrafted(null)
                    }}
                  >
                    <Undo2Icon aria-hidden />
                    Put back my text
                  </Button>
                </div>
              ) : null}
              {nothingToWrite ? (
                <p role="status" className="text-dense text-muted-foreground">
                  {productName} doesn&apos;t know enough to write a first version yet. Add a domain
                  or connect a definition source first, or write the text yourself.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || text === ABOUT_BUSINESS_STARTER}
                  onClick={() => {
                    setText(ABOUT_BUSINESS_STARTER)
                    setDrafted(null)
                    recheck(ABOUT_BUSINESS_STARTER, reason)
                  }}
                >
                  <RotateCcwIcon aria-hidden />
                  Reset to the starter text
                </Button>
                <p className="text-dense text-muted-foreground">
                  Puts back the starter text. Nothing changes until you save.
                </p>
              </div>
            </div>
            <Field name="reason" invalid={Boolean(errors.reason)} disabled={busy}>
              <FieldHeader>
                <FieldLabel icon={MessageSquareIcon}>Why</FieldLabel>
                <FieldDescription>Kept in the history log with the new version.</FieldDescription>
              </FieldHeader>
              <FieldControl
                id="business-reason"
                value={reason}
                onValueChange={(next) => {
                  setReason(String(next))
                  recheck(text, String(next))
                }}
                render={
                  <Textarea rows={2} className="resize-y text-body pointer-coarse:text-large" />
                }
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
      </SettingsBlock>
      <SettingsBlock
        title="What the assistant and AI apps get"
        slot="business-preview"
        description="Exactly the text they get, with the lines around it. It follows what you type, and they get it once you save."
      >
        {block ? (
          // In full: the preview is what they read, so none of it scrolls out of sight.
          <CopyBlock
            text={block}
            label="what the assistant and AI apps get"
            className="[&_pre]:max-h-none"
          />
        ) : (
          <p className="rounded-md border p-4 text-body text-muted-foreground">
            Nothing. With the text empty, the assistant and AI apps get no background about the
            business.
          </p>
        )}
      </SettingsBlock>
    </>
  )
}
