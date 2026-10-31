import * as React from 'react'
import { useEditor } from '@tiptap/react'
import {
  ArchiveIcon,
  CalendarIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleDashedIcon,
  FilePenLineIcon,
  CircleAlertIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
  PanelRightIcon,
  FolderIcon,
  GlobeIcon,
  LinkIcon,
  MapPinIcon,
  ShapesIcon,
  ShieldAlertIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UserIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { RichTextEditor } from '@/components/editor'
import { ContextText } from '@/components/heed/mention-chip'
import { useSideChoice } from '@/lib/side-panel'
import { useSend } from '@/lib/send'
import '@/components/editor/style.css'
import { docExtensions } from '@/lib/doc-extensions'
import { noteEmoji } from '@/lib/emoji-note'
import { type Validity } from '@/model/validity'
import {
  missingDates,
  validOfWhen,
  whenOfValid,
  whenSummary,
  type WhenMode,
  type WhenValue,
} from '@/lib/when'
import {
  Ghost,
  InlineText,
  PeopleField,
  PickerField,
  PropertyGroup,
  PropertyList,
  PropertyRow,
  SelectField,
  StaticField,
  WhenField,
  type Option,
} from '@/components/heed/field-controls'
import { DomainDot, TagChip } from '@/components/heed/tag-chip'
import { ScopeField } from '@/components/heed/scope-field'
import { termsOfNames } from '@/lib/scope'
import { kindIcons } from '@/components/heed/kind-icons'
import { plainText } from '@/lib/mentions'
import { PersonAvatar } from '@/components/heed/bits'
import { DocFooter, Paper } from '@/components/heed/doc'
import { ResizableAside } from '@/components/resizable-aside'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  kindHint,
  kindLabel,
  servedToAgents,
  type DomainId,
  type Fact,
  type Kind,
  type ScopeTerm,
  type Status,
} from '@/model/items'
import { homeDomain, ownersOf, type Domain, type Domains } from '@/model/people'
import { toApiError, type Clash } from '@/api/errors'
import { closeDock, openDock, useDock } from '@/lib/dock'
import { HeaderMore, SaveStatus } from '@/components/heed/editor-header'
import { Panel, PanelGroup } from '@/components/heed/panel'
import { ChoiceGroup, ViewToggle } from '@/components/heed/switches'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { setDraft } from '@/lib/draft'
import { href, navigate, useRoute } from '@/lib/router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Vocabulary } from '@/api'
import type { Relation } from '@/api/client'
import { draftFromTextQuery, itemPageQuery, useInbox, useVocabulary, useWrite } from '@/api/queries'
import { useDomainList, useDomains, useFact, useFacts, useMe, usePeople } from '@/lib/workspace'
import { useWide } from '@/hooks/use-wide'
import { Kbd } from '@/components/ui/kbd'
import { usePrimaryKey } from '@/hooks/use-primary-key'
import { DocumentEditorShell } from '@/components/heed/document-shell'

// The context editor as a document, the way editorcn's Simple Document Editor template shows one: a
// muted canvas, editorcn's floating toolbar, the title as a large heading, the text as the document,
// and a word count in the footer. The item's fields are a property strip under the title; what
// agents get, the overlaps and the Ready line sit in a side panel. Publish and Save are in the
// header, as in a docs editor. One page for new context, an edit and a suggestion.

type Form = {
  title: string
  body: string
  kind: Kind
  domain: DomainId
  owners: string[]
  status: Status
  /** What it applies to, each term by its vocabulary key (FR-107). */
  where: ScopeTerm[]
  when: WhenMode
  from: string
  until: string
  source: string
  quote: string
  causes: boolean
  dontConclude: string
}

const BLANK: Form = {
  title: '',
  body: '',
  kind: 'event',
  domain: 'sales',
  owners: [],
  status: 'Live',
  where: [],
  when: 'always',
  from: '',
  until: '',
  source: '',
  quote: '',
  causes: false,
  dontConclude: '',
}

/** An item's scope by key; an item read only as names (a list row, a gap's draft) by its names. */
const scopeOf = (f: Fact, vocabulary: Vocabulary) => f.scope ?? termsOfNames(f.where, vocabulary)

/** The words of "Applies to" in a sentence: "Orders in any market". */
const scopeWords = (terms: ScopeTerm[]) =>
  terms.map((t) => (t.kind === 'dimension' ? `any ${t.name.toLowerCase()}` : t.name)).join(' in ')

function fromFact(f: Fact, domains: Domains, vocabulary: Vocabulary): Form {
  // From the stored dates, so the editor shows the real ones.
  const w = whenOfValid(f.valid)
  return {
    title: f.title,
    body: [f.summary, f.body].filter(Boolean).join('\n\n'),
    kind: f.kind,
    domain: f.domain,
    owners: ownersOf(f, domains),
    // A draft is published as Live.
    status: f.status === 'Draft' ? 'Live' : f.status,
    where: scopeOf(f, vocabulary),
    when: w.mode,
    from: w.from,
    until: w.until,
    source: f.source,
    quote: f.quote,
    causes: !!f.causes,
    dontConclude: f.dontConclude,
  }
}

const whenOf = (f: Form): WhenValue => ({ mode: f.when, from: f.from, until: f.until })

/** The stored dates the form says. */
const validOf = (f: Form): Validity => validOfWhen(whenOf(f))

/** The When people read, from the same function as everywhere else once the dates are there. */
const whenText = (f: Form) => whenSummary(whenOf(f))

function toFact(f: Form, id: string, me: string, domains: Domains, original?: Fact): Fact {
  const [summary, ...rest] = f.body.split('\n\n')
  return {
    valid: validOf(f),
    id,
    title: f.title || 'Untitled context item',
    summary: summary ?? '',
    body: rest.join('\n\n') || undefined,
    domain: f.domain,
    // Owners of its own only when they differ from its domain's.
    owners: f.owners.join() === domains[f.domain]?.owners.join() ? undefined : f.owners,
    kind: f.kind,
    where: f.where.map((t) => t.name),
    scope: f.where,
    // Until its dates are picked, an edited item keeps saying what it said.
    when: original && missingDates(whenOf(f)) ? original.when : whenText(f),
    status: f.status,
    checkedBy: me,
    checkedOn: '22 Oct 2026',
    source: f.source,
    quote: f.quote,
    dontConclude: f.dontConclude || 'Cause not proven.',
    causes: f.causes,
  }
}

function initialForm(
  fact: Fact | undefined,
  query: URLSearchParams,
  home: DomainId,
  {
    domains,
    vocabulary,
    gapDraft,
    fromText,
  }: { domains: Domains; vocabulary: Vocabulary; gapDraft?: Fact; fromText?: Fact },
): Form {
  if (fact) return fromFact(fact, domains, vocabulary)
  if (fromText) return fromFact(fromText, domains, vocabulary)
  // New context starts in the writer's own domain, so an owner publishes rather than suggests.
  const blank = { ...BLANK, domain: home, owners: domains[home]?.owners ?? [] }
  // A Not found card opens its draft, never a blank page, with the draft's own dates.
  if (gapDraft)
    return {
      ...fromFact(gapDraft, domains, vocabulary),
      domain: gapDraft.domain,
      owners: domains[gapDraft.domain]?.owners ?? [],
      when: 'between',
      from: '2026-10-14',
      until: '2026-10-16',
    }
  const metric = query.get('metric')
  const market = query.get('market')
  if (metric || market)
    return {
      ...blank,
      where: termsOfNames(
        [metric, market].filter((w): w is string => !!w),
        vocabulary,
      ),
    }
  return blank
}

/** "customs.example": a link's host, the way a link chip names it. */
const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url.replace(/^https?:\/\//, '')
  }
}

const countWords = (text: string) =>
  text
    .replace(/[#*_`>[\]()-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length

/* ---------- the property list ---------- */

const STATUS_OPTIONS: Option<Status>[] = [
  { value: 'Live', label: 'Live', hint: 'Agents get it.' },
  {
    value: 'Needs checking',
    label: 'Needs checking',
    hint: 'Agents get it, told it may be out of date.',
  },
  { value: 'Archived', label: 'Archived', hint: 'Agents stop getting it.' },
]
const KIND_OPTIONS = (Object.keys(kindLabel) as Kind[]).map((k) => {
  const Icon = kindIcons[k]
  return {
    value: k,
    label: kindLabel[k],
    hint: kindHint[k],
    icon: <Icon aria-hidden className="size-4 text-muted-foreground" />,
  }
})
// From the workspace as it stands, so a domain added or renamed in Settings is here with its own words.
const domainOptions = (domains: Domain[]) =>
  domains.map((d) => ({
    value: d.id,
    label: d.name,
    hint: d.covers,
    icon: <DomainDot id={d.id} />,
  }))

const RELATIONS: Option<Relation>[] = [
  { value: 'replaces', label: 'Replaces it' },
  { value: 'disagree', label: 'Disagrees' },
  { value: 'unrelated', label: 'Unrelated' },
]

/* ---------- the page ---------- */

export function FactEditor(props: { mode: 'new' | 'edit' | 'suggest'; factId?: string }) {
  // ?draft=norway opens the editor as Draft from text fills it, so that state has a link.
  const fromText = useQuery({
    ...draftFromTextQuery(''),
    enabled: useRoute().query.get('draft') === 'norway',
  })
  // An edit or a suggestion starts from the item's own read, which has its text, source and quote;
  // the list's row is all there is when that read fails.
  const page = useQuery({ ...itemPageQuery(props.factId ?? ''), enabled: !!props.factId })
  const listed = useFact(props.factId)
  if (fromText.isFetching || (props.factId && page.isPending)) return null
  return <Editor {...props} fromText={fromText.data} original={page.data?.item ?? listed} />
}

function Editor({
  mode,
  original,
  fromText,
}: {
  mode: 'new' | 'edit' | 'suggest'
  factId?: string
  original?: Fact
  fromText?: Fact
}) {
  const facts = useFacts()
  const me = useMe()
  const domains = useDomains()
  const domainList = useDomainList()
  const people = usePeople()
  const vocabulary = useVocabulary()
  const { cards } = useInbox()
  const write = useWrite()
  const queryClient = useQueryClient()
  const { query } = useRoute()
  // What the page opened with, so an edit or a suggestion that changes nothing can't be sent.
  const [initial] = React.useState<Form>(() =>
    initialForm(original, query, homeDomain(me, domainList)?.id ?? '', {
      domains,
      vocabulary,
      gapDraft: cards.find((c) => c.id === query.get('gap'))?.gap?.draft,
      fromText: mode === 'new' ? fromText : undefined,
    }),
  )
  const [form, setForm] = React.useState<Form>(initial)
  const [sourceOpen, setSourceOpen] = React.useState(false)
  const [mainRef, wide] = useWide<HTMLDivElement>()
  usePrimaryKey()
  const titleRef = React.useRef<HTMLTextAreaElement>(null)
  const [overlap, setOverlap] = React.useState<Record<string, Relation>>({})
  const [pasted, setPasted] = React.useState('')
  const [draftOpen, setDraftOpen] = React.useState(false)
  const [previewAll, setPreviewAll] = React.useState(false)
  const { state: sendState, error: sendError, send, online, reset } = useSend()
  // Live items the service named when it refused to publish until this says how it relates to
  // each: asked right under the title, and sent with the next publish.
  const [clashes, setClashes] = React.useState<Clash[]>([])
  // Read by the text editor's own handler too, which keeps the first render's closure.
  const failed = React.useRef(false)
  React.useEffect(() => {
    failed.current = sendState === 'failed'
  })
  // A refusal was about the words as they were: once they change, Publish tries them afresh.
  React.useEffect(() => {
    if (failed.current) reset()
  }, [form, reset])
  // Drafts save themselves: a quiet status instead of a Save button.
  const [saving, setSaving] = React.useState(false)
  const saveTimer = React.useRef<number>(0)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => (Object.is(f[k], v) ? f : { ...f, [k]: v }))
    setSaving(true)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => setSaving(false), 700)
  }
  React.useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: docExtensions(
      'Two or three plain sentences. The first one is what agents read first.',
    ),
    content: form.body,
    contentType: 'markdown',
    editorProps: { attributes: { 'aria-label': 'What agents should know' } },
    onUpdate: ({ editor }) => set('body', editor.getMarkdown()),
  })

  const trying = useDock()?.kind === 'try'
  const owner = me.owns.includes(form.domain) || me.admin
  const isSuggest = mode === 'suggest' || !owner
  const ownerName = form.owners[0] ?? domains[form.domain]?.owners[0] ?? ''
  const ids = React.useId()
  const KindIcon = kindIcons[form.kind]
  const fieldId = (name: string) => `${ids}-${name}`
  const draft = toFact(form, original?.id ?? 'draft', me.name, domains, original)
  React.useEffect(() => setDraft(draft))

  const whereNames = form.where.map((t) => t.name)
  const inside = (a: string[], b: string[]) => a.every((w) => b.includes(w))
  // The same place, or one inside the other: a value narrows an item, and still overlaps the
  // broader one ("Orders in Norway" and "Orders in Norway for one campaign").
  const overlaps = facts.filter(
    (f) =>
      f.id !== original?.id &&
      f.title !== form.title &&
      servedToAgents(f) &&
      whereNames.length >= 2 &&
      f.where.length >= 2 &&
      (inside(whereNames, f.where) || inside(f.where, whereNames)),
  )
  // Folded unless there is something to say (an overlap), until the person chooses.
  // The panel's open or closed, as the person last left it this session; until then, open only with an overlap.
  const [sideChoice, setSideChoice] = useSideChoice()
  const sideOpen = sideChoice ?? overlaps.length > 0
  // What the service needs before it publishes or sends: a domain that exists, where it applies
  // (a mention in the text is not that), and a source with a sentence copied from it. An edit that
  // leaves its source alone keeps the sentence it has.
  const quoteNeeded =
    mode === 'new' || form.source !== initial.source || form.quote !== initial.quote
  const missing = [
    !domains[form.domain] && 'a domain',
    !form.title && 'a title',
    !form.body.trim() && 'what agents should know',
    !form.where.length && 'where it applies',
    !form.source && 'a source',
    form.source && quoteNeeded && !form.quote.trim() && 'a sentence copied from the source',
  ].filter(Boolean) as string[]
  const unanswered = clashes.find((c) => !overlap[c.itemId])
  const reaches = whereNames.length ? (whereNames.includes('Norway') ? 12 : 9) : 0
  // Counted as agents read it: a mention is its words.
  const text = plainText(form.body)
  const words = countWords(`${form.title} ${text}`)
  // Long enough to clamp: about six lines of the preview's width.
  const long = text.split('\n').filter(Boolean).length + Math.floor(text.length / 45) > 6

  const fill = async () => {
    const filled = fromFact(
      await queryClient.fetchQuery(draftFromTextQuery(pasted)),
      domains,
      vocabulary,
    )
    setForm(filled)
    editor?.commands.setContent(filled.body, { contentType: 'markdown' })
    setDraftOpen(false)
    toast('Filled from your text', { description: 'Check each part before you publish.' })
  }

  const unchanged = mode !== 'new' && JSON.stringify(form) === JSON.stringify(initial)
  // The first paragraph is the summary agents read first; the real schema keeps it to 280 characters.
  const summaryLength = plainText(form.body.split('\n\n')[0] ?? '').length
  const tooLong = summaryLength > 280
  // With no definitions connected there is nothing to say where it applies with yet.
  const noWords = !form.where.length && !vocabulary.metrics.length && !vocabulary.dimensions.length
  const blocked = missing.length
    ? `Add ${missing.join(', ')} first.${noWords ? ' Where it applies is named from your definitions: connect them in Settings, Integrations.' : ''}`
    : tooLong
      ? 'Shorten the first paragraph to 280 characters first.'
      : unchanged
        ? 'Nothing has changed yet.'
        : unanswered
          ? `Say how this relates to “${unanswered.title}” first.`
          : ''
  // A blocked click goes to the first thing missing instead of answering with a toast.
  const focusField = (name: string) =>
    document.getElementById(fieldId(name))?.nextElementSibling?.querySelector('button')?.focus()
  const goToMissing = () => {
    if (!domains[form.domain]) focusField('domain')
    else if (!form.title) titleRef.current?.focus()
    else if (!form.body.trim()) editor?.commands.focus('end')
    else if (!form.where.length) focusField('where')
    else if (!form.source || (quoteNeeded && !form.quote.trim())) setSourceOpen(true)
    else if (unanswered)
      document.getElementById(`${ids}-clashes`)?.querySelector<HTMLElement>('[role=radio]')?.focus()
  }

  const commit = async () => {
    if (isSuggest) {
      // It waits visibly: a line on the item, and a row under All in your Inbox.
      const { id } = await write('sendSuggestion', {
        fact: draft,
        sent: {
          factId: original?.id,
          title: form.title,
          by: me.name,
          to: ownerName,
          domain: form.domain,
          at: 'just now',
        },
      })
      toast(`Sent to ${ownerName}, owner of ${domains[form.domain]?.name}`, {
        description: 'Agents get it once the owner publishes it.',
      })
      navigate(
        original ? `/context/${original.id}` : '/inbox',
        original ? undefined : { tab: 'all', card: id },
      )
      return
    }
    const { id } = await write('saveItem', {
      fact: draft,
      isNew: !original,
      // Each overlap as the owner answered it; one left alone is unrelated, as it reads.
      relations: {
        ...Object.fromEntries(overlaps.map((f) => [f.id, overlap[f.id] ?? 'unrelated'])),
        ...Object.fromEntries(
          clashes.flatMap((c) => {
            const r = overlap[c.itemId]
            return r ? [[c.itemId, r] as const] : []
          }),
        ),
      },
      gap: query.get('gap') ?? undefined,
      setup: !!query.get('setup'),
    })
    if (query.get('setup')) {
      toast('Published', {
        description: 'Your first context item. Agents get it from the next question.',
      })
      navigate('/inbox')
      return
    }
    toast(original ? 'Saved' : 'Published', {
      description: 'Agents get it from the next question.',
    })
    navigate(`/context/${id}`)
  }
  // Sending, then done; or failed with Retry, the text untouched. Offline, nothing is sent.
  const verb = isSuggest ? 'Send' : original ? 'Save' : 'Publish'
  // A refusal that names live items to relate to lists them, unanswered, under the title.
  const publish = () =>
    commit().catch((e: unknown) => {
      const named = toApiError(e).clashes.filter((c) => !clashes.some((k) => k.itemId === c.itemId))
      if (named.length) setClashes((k) => [...k, ...named])
      throw e
    })
  // Retry only where sending again can help: no answer, or the service failing on its side. A
  // refusal says why instead, and the change it asks for makes Publish work again.
  // The service's own words for a refusal, as a sentence.
  const refusal =
    sendState === 'failed' &&
    sendError &&
    !(sendError.kind === 'unanswered' || sendError.kind === 'failed')
      ? sendError.message.replace(/[^.!?]$/, '$&.')
      : ''
  // A new refusal comes into view, wherever the page was scrolled.
  const refusalRef = React.useRef<HTMLElement>(null)
  React.useEffect(() => {
    if (refusal) refusalRef.current?.scrollIntoView({ block: 'nearest' })
  }, [refusal])
  const retryable = !sendError || sendError.kind === 'unanswered' || sendError.kind === 'failed'
  const submit = () => {
    if (blocked) return goToMissing()
    send(publish)
  }
  const held =
    blocked || (!online ? `You're offline. ${verb} once you're back; your text stays here.` : '')

  const heading =
    form.title || (mode === 'new' ? 'New context' : mode === 'edit' ? 'Edit' : 'Suggest a change')

  // Draft from text: a short dialog, opened from the More menu.
  const draftFromText = (
    <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Draft from text</DialogTitle>
          <DialogDescription>
            Paste a message or a link; the fields fill in, and you check each one.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="draft-text">Message or link</FieldLabel>
          <Textarea
            id="draft-text"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            className="min-h-28"
            placeholder="Online sales to Norway stopped on 4 August 2026 after a new customs rule, so orders there fell. https://customs.example/norway/notices/2026-08-04"
          />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={() => void fill()}>Fill it in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  // The panel: the preview and the overlaps as groups that fold (the preview starts folded when
  // there are overlaps, so the choices are in view), and the Ready line as its footer.
  const side = (
    <>
      <PanelGroup
        title="Preview"
        defaultOpen={!overlaps.length}
        description={
          form.where.length
            ? `Agents asking about ${scopeWords(form.where)}${form.when === 'always' ? '' : `, ${whenText(form).replace(/^From/, 'from')}`} get this, live as you type.`
            : 'Add where it applies to see who gets it.'
        }
      >
        <div className="rounded-frame border bg-muted/30 p-3 text-sm">
          <p className="leading-snug font-medium">{draft.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {domains[form.domain]?.name}, {kindLabel[form.kind].toLowerCase()},{' '}
            {draft.when.charAt(0).toLowerCase() + draft.when.slice(1)}
          </p>
          <p className="text-xs text-muted-foreground">
            {isSuggest
              ? 'Not checked yet: waiting for the owner'
              : `Checked by the owner of ${domains[form.domain]?.name}`}
          </p>
          {/* The text as the document reads it: paragraphs, real bullets, a quote. Clamped when long,
              never boxed, so the panel keeps one scroll bar at most. */}
          <div
            className={cn(
              'mt-2.5 flex flex-col gap-2 leading-relaxed text-foreground/85',
              long && !previewAll && 'max-h-44 overflow-hidden fade-out-bottom',
            )}
          >
            {form.body.trim() ? (
              <ContextText text={form.body.replace(/\*\*|`/g, '')} dense />
            ) : (
              <p className="text-muted-foreground">…</p>
            )}
          </div>
          {long && (
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-xs"
              aria-expanded={previewAll}
              onClick={() => setPreviewAll((v) => !v)}
            >
              {previewAll ? 'Show less' : 'Show all'}
            </Button>
          )}
          <p className="mt-2.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <LinkIcon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">
              {form.source.replace(/^https?:\/\//, '') || 'No source yet'}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="text-foreground">Don't conclude:</span> {draft.dontConclude}
            {form.causes ? '' : " The source doesn't say this caused a change."}
          </p>
        </div>
        {reaches > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            {reaches} questions agents asked this week would get it.
          </p>
        )}
      </PanelGroup>
      <PanelGroup
        title="Overlaps"
        count={overlaps.length}
        description={
          overlaps.length
            ? 'Context on the same metric and market. Say how this one relates to each.'
            : 'None. Nothing else covers the same place.'
        }
      >
        {overlaps.length > 0 && (
          <div className="flex flex-col gap-4">
            {overlaps.map((f) => (
              <div key={f.id} className="flex flex-col gap-2">
                <button
                  type="button"
                  className="text-left text-sm font-medium underline-offset-4 hover:underline"
                  onClick={() => openDock('context', f.id)}
                >
                  {f.title}
                </button>
                <ChoiceGroup
                  label={`How this relates to ${f.title}`}
                  value={overlap[f.id] ?? 'unrelated'}
                  onChange={(v) => setOverlap((o) => ({ ...o, [f.id]: v }))}
                  options={RELATIONS}
                />
              </div>
            ))}
          </div>
        )}
      </PanelGroup>
    </>
  )
  const notReady = missing.length ? `Add ${missing.join(', ')}.` : unanswered ? blocked : ''
  const ready = (
    <p className="flex items-start gap-2 p-4 text-sm">
      {notReady ? (
        <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      )}
      <span>
        <span className="font-medium">{notReady ? 'Not ready yet.' : 'Ready.'}</span>{' '}
        <span className="text-muted-foreground">
          {notReady || 'Complete, and it reaches the questions it is meant for.'}
        </span>
      </span>
    </p>
  )

  return (
    <DocumentEditorShell
      editor={editor}
      toolbar={true}
      paneRef={mainRef}
      header={
        <>
          <SiteHeader
            title={heading}
            icon={<FilePenLineIcon />}
            back={
              original
                ? { href: href(`/context/${original.id}`), label: 'Back to the context item' }
                : { href: href('/context'), label: 'Back to Context' }
            }
            bare
          >
            <SaveStatus saving={saving} offline={!online} />
            {/* Write or try it: the same draft, seen two ways, so a quiet toggle rather than tabs. */}
            <ViewToggle
              pressed={trying}
              onPressedChange={(p) => (p ? openDock('try', 'editor') : closeDock())}
              icon={<FlaskConicalIcon />}
              on="Try it"
              off="Back to writing"
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    data-primary
                    aria-disabled={!!held}
                    loading={sendState === 'sending'}
                    loadingLabel={
                      verb === 'Send' ? 'Sending…' : verb === 'Save' ? 'Saving…' : 'Publishing…'
                    }
                    aria-describedby={held ? 'publish-blocked' : undefined}

                    onClick={submit}
                  />
                }
              >
                {isSuggest ? (
                  <>
                    Send
                    <span className="hidden sm:inline">
                      {' '}
                      to the owner of {domains[form.domain]?.name}
                    </span>
                  </>
                ) : (
                  verb
                )}
              </TooltipTrigger>
              <TooltipContent>
                {held || (
                  <>
                    {isSuggest ? 'Send' : original ? 'Save' : 'Publish'}{' '}
                    <Kbd className="ml-1">⌘</Kbd>
                    <Kbd>Enter</Kbd>
                  </>
                )}
              </TooltipContent>
            </Tooltip>
            <span id="publish-blocked" className="sr-only">
              {held}
            </span>
            <HeaderMore>
              {mode === 'new' && (
                <DropdownMenuItem onClick={() => setDraftOpen(true)}>
                  <SparklesIcon />
                  Draft from text
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setSideChoice(!sideOpen)}>
                <PanelRightIcon />
                {sideOpen ? 'Hide what agents get' : 'Show what agents get'}
              </DropdownMenuItem>
            </HeaderMore>
          </SiteHeader>
          {draftFromText}
        </>
      }
      aside={
        <>
          {/* The side pane opens by itself only when this overlaps another item: then what agents get, and how the two relate, matter. Otherwise the header's toggle opens it. */}
          {sideOpen && wide && (
            <ResizableAside
              side="right"
              storageKey="doc-side"
              defaultWidth={320}
              min={280}
              max={520}
              label="What agents get"
              className="border-l bg-background"
            >
              <Panel
                title="What agents get"
                onClose={() => setSideChoice(false)}
                closeLabel="Hide what agents get"
                footer={ready}
              >
                {side}
              </Panel>
            </ResizableAside>
          )}
        </>
      }
      footer={
        <DocFooter
          status={
            sendState === 'failed' && !retryable ? (
              <span className="flex items-center gap-2 text-destructive">
                <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
                Not {verb === 'Send' ? 'sent' : verb === 'Save' ? 'saved' : 'published'}
              </span>
            ) : sendState === 'failed' ? (
              <span role="alert" className="flex items-center gap-2 text-destructive">
                <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
                <span>
                  Couldn't {verb.toLowerCase()}
                  <span className="max-sm:hidden">. Your text is kept</span>.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-foreground"
                  onClick={() => send(publish)}
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  Retry
                </Button>
              </span>
            ) : missing.length ? (
              <>
                <CircleDashedIcon className="size-3.5" aria-hidden />
                <span>
                  Not ready<span className="hidden sm:inline">: add {missing.join(', ')}</span>
                </span>
              </>
            ) : unchanged ? (
              <>
                <CircleDashedIcon className="size-3.5" aria-hidden />
                No changes yet
              </>
            ) : unanswered ? (
              <>
                <CircleDashedIcon className="size-3.5" aria-hidden />
                <span>
                  Not ready<span className="hidden sm:inline">: say how it relates</span>
                </span>
              </>
            ) : (
              <>
                <CircleCheckIcon className="size-3.5" aria-hidden />
                Ready
              </>
            )
          }
        >
          <span
            className={cn(
              'whitespace-nowrap tabular-nums',
              tooLong && 'font-medium text-destructive',
            )}
            title="The first paragraph is what agents read first"
          >
            Summary {summaryLength} of 280
          </span>
          <span className="whitespace-nowrap">
            {words.toLocaleString('en-GB')} {words === 1 ? 'word' : 'words'}
          </span>
          <span className="whitespace-nowrap max-sm:hidden">
            {(form.title.length + text.length).toLocaleString('en-GB')} characters
          </span>
          <span className="hidden sm:inline">Markdown</span>
        </DocFooter>
      }
    >
      <Paper>
        {mode === 'suggest' && original && (
          <p className="mb-5 rounded-frame bg-muted px-3 py-2 text-sm text-muted-foreground">
            You're suggesting a change. {ownerName}, owner of {domains[original.domain]?.name},
            decides; agents keep getting the context item as it is until then.
          </p>
        )}
        <textarea
          ref={titleRef}
          aria-label="Title"
          rows={1}
          className="mb-4 field-sizing-content w-full resize-none overflow-hidden bg-transparent text-2xl leading-tight font-bold tracking-tight outline-none placeholder:text-muted-foreground/60 sm:mb-5 sm:text-3xl"
          placeholder="What should agents know?"
          value={form.title}
          onChange={(e) => set('title', e.target.value.replace(/\n/g, ' '))}
          onPaste={(e) => noteEmoji(e.clipboardData.getData('text/plain'))}
        />
        {/* What stopped a publish, in the service's words, and the live items it named to relate
            to, answered here, under the title, at any width. */}
        {(refusal || clashes.length > 0) && (
          <section
            ref={refusalRef}
            id={`${ids}-clashes`}
            aria-label="Before it can be published"
            className="mb-5 flex flex-col gap-3 rounded-frame bg-muted px-3 py-2 text-sm"
          >
            {refusal ? (
              <p role="alert" className="flex items-start gap-2">
                <CircleAlertIcon
                  className="mt-0.5 size-3.5 shrink-0 text-destructive"
                  aria-hidden
                />
                <span>
                  Couldn't {verb.toLowerCase()}. {refusal}
                </span>
              </p>
            ) : (
              <p className="text-muted-foreground">
                Agents get these for the same questions. Say how this relates to each.
              </p>
            )}
            {clashes.map((c) => (
              <div key={c.itemId} className="flex flex-col gap-2">
                <button
                  type="button"
                  className="text-left font-medium underline-offset-4 hover:underline"
                  onClick={() => openDock('context', c.itemId)}
                >
                  {c.title}
                </button>
                <ChoiceGroup
                  label={`How this relates to ${c.title}`}
                  value={overlap[c.itemId]}
                  onChange={(v) => {
                    setOverlap((o) => ({ ...o, [c.itemId]: v }))
                    reset()
                  }}
                  options={RELATIONS}
                />
              </div>
            ))}
          </section>
        )}
        {/* The properties as a calm list under the title: what it is, when and where it applies,
            where it comes from. Each value shows as the thing it is; a click edits it. */}
        <PropertyList label="Properties">
          <PropertyGroup>
            <PropertyRow
              id={fieldId('domain')}
              label="Domain"
              icon={<FolderIcon />}
              required={!domains[form.domain]}
            >
              <SelectField
                labelId={fieldId('domain')}
                label="Domain"
                value={form.domain}
                options={domainOptions(domainList)}
                onChange={(d) => {
                  set('domain', d)
                  set('owners', domains[d]?.owners ?? [])
                }}
                display={
                  domains[form.domain] ? (
                    <>
                      <DomainDot id={form.domain} />
                      <span className="font-medium">{domains[form.domain]?.name}</span>
                    </>
                  ) : (
                    <Ghost>Choose a domain</Ghost>
                  )
                }
              />
            </PropertyRow>
            <PropertyRow id={fieldId('kind')} label="Kind" icon={<ShapesIcon />}>
              <SelectField
                labelId={fieldId('kind')}
                label="Kind"
                value={form.kind}
                options={KIND_OPTIONS}
                onChange={(k) => set('kind', k)}
                display={<TagChip icon={<KindIcon aria-hidden />}>{kindLabel[form.kind]}</TagChip>}
              />
            </PropertyRow>
            <PropertyRow id={fieldId('status')} label="Status" icon={<CircleDotIcon />}>
              <SelectField
                labelId={fieldId('status')}
                label="Status"
                value={form.status}
                options={STATUS_OPTIONS}
                onChange={(v) => set('status', v)}
                disabled={isSuggest}
                display={
                  // Live is the default and says nothing; a status that needs attention is a chip.
                  form.status === 'Live' ? (
                    <span>Live</span>
                  ) : form.status === 'Needs checking' ? (
                    <TagChip tone="warn" icon={<TriangleAlertIcon aria-hidden />}>
                      Needs checking
                    </TagChip>
                  ) : (
                    <TagChip icon={<ArchiveIcon aria-hidden />}>Archived</TagChip>
                  )
                }
              />
            </PropertyRow>
            <PropertyRow id={fieldId('owner')} label="Owner" icon={<UserIcon />}>
              <PeopleField
                labelId={fieldId('owner')}
                label="Owner"
                values={form.owners}
                people={people}
                me={me.name}
                onChange={(v) => set('owners', v)}
                note={
                  isSuggest
                    ? 'The owner decides on your suggestion.'
                    : "An owner publishes and checks this domain's context."
                }
              />
            </PropertyRow>
          </PropertyGroup>
          <PropertyGroup>
            <PropertyRow
              id={fieldId('where')}
              label="Applies to"
              icon={<MapPinIcon />}
              required={!form.where.length}
            >
              <ScopeField
                labelId={fieldId('where')}
                label="Applies to"
                value={form.where}
                onChange={(w) => set('where', w)}
                placeholder="Add a metric, dimension or value"
              />
            </PropertyRow>
            <PropertyRow id={fieldId('when')} label="When" icon={<CalendarIcon />}>
              <WhenField
                labelId={fieldId('when')}
                value={whenOf(form)}
                onChange={(w) =>
                  setForm((f) => ({ ...f, when: w.mode, from: w.from, until: w.until }))
                }
              />
            </PropertyRow>
          </PropertyGroup>
          <PropertyGroup>
            <PropertyRow
              id={fieldId('source')}
              label="Source"
              icon={<LinkIcon />}
              required={!form.source}
            >
              <PickerField
                labelId={fieldId('source')}
                label="Source"
                open={sourceOpen}
                onOpenChange={setSourceOpen}
                className="w-96 p-3"
                value={
                  form.source ? (
                    <TagChip icon={<GlobeIcon aria-hidden />} title={form.source}>
                      {hostOf(form.source)}
                    </TagChip>
                  ) : (
                    <Ghost>Add a source</Ghost>
                  )
                }
              >
                <div className="grid gap-3 pb-1">
                  <Field>
                    <FieldLabel htmlFor="fact-source">Link</FieldLabel>
                    <Input
                      id="fact-source"
                      type="url"
                      value={form.source}
                      onChange={(e) => set('source', e.target.value)}
                      placeholder="https://"
                      className="h-9"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fact-quote">A sentence copied from it</FieldLabel>
                    <Textarea
                      id="fact-quote"
                      value={form.quote}
                      onChange={(e) => set('quote', e.target.value)}
                      className="min-h-16"
                    />
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="fact-causes"
                      checked={form.causes}
                      onCheckedChange={(v) => set('causes', !!v)}
                    />
                    <FieldLabel htmlFor="fact-causes" className="font-normal">
                      The source says this caused the change
                    </FieldLabel>
                  </Field>
                </div>
              </PickerField>
            </PropertyRow>
            <PropertyRow id={fieldId('dont')} label="Don't conclude" icon={<ShieldAlertIcon />}>
              <InlineText
                labelId={fieldId('dont')}
                value={form.dontConclude}
                onChange={(v) => set('dontConclude', v)}
                placeholder="Anything an agent should not conclude from this?"
              />
            </PropertyRow>
            {original && (
              <PropertyRow id={fieldId('checked')} label="Checked" icon={<CircleCheckIcon />}>
                <StaticField>
                  <PersonAvatar name={original.checkedBy} size={20} />
                  <span>
                    {original.checkedBy}, {original.checkedOn}
                  </span>
                </StaticField>
              </PropertyRow>
            )}
          </PropertyGroup>
        </PropertyList>
        <RichTextEditor.Content className="text-base [&_.ProseMirror]:min-h-48! [&_.ProseMirror]:max-w-reading [&_.ProseMirror]:p-0!" />
      </Paper>
      {sideOpen && !wide && (
        <section aria-labelledby="doc-side-under" className="border-t bg-background">
          {/* Under the document the panel keeps its title, so its groups sit under a heading of their own. */}
          <h2 id="doc-side-under" className="px-4 pt-4 pb-1 text-sm font-medium">
            What agents get
          </h2>
          {side}
          <div className="border-t">{ready}</div>
        </section>
      )}
    </DocumentEditorShell>
  )
}
