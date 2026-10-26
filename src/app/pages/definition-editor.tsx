import * as React from 'react'
import { useEditor } from '@tiptap/react'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  EqualIcon,
  RefreshCwIcon,
  FolderIcon,
  PanelRightIcon,
  UserIcon,
  WholeWordIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { RichTextEditor } from '@/components/editor'
import { useSideChoice } from '@/lib/side-panel'
import { useSend } from '@/lib/scenario'
import { HeaderMore } from '@/components/heed/editor-header'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import '@/components/editor/style.css'
import { docExtensions } from '@/lib/doc-extensions'
import { noteEmoji } from '@/lib/emoji-note'
import { plainText } from '@/lib/mentions'
import { PersonAvatar } from '@/components/heed/bits'
import { ConflictNote, SynonymTags, TypeGlyph, TypeTile } from '@/components/heed/definition'
import { openDock } from '@/lib/dock'
import { DocFooter, Paper, SideSection } from '@/components/heed/doc'
import {
  Ghost,
  PropertyGroup,
  PropertyList,
  PropertyRow,
  SearchSelectField,
  SelectField,
  StaticField,
} from '@/components/heed/field-controls'
import { DomainDot, TagChip } from '@/components/heed/tag-chip'
import { ResizableAside } from '@/components/resizable-aside'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { domainIds, domains, type DomainId } from '@/data/world'
import {
  conflictOf,
  findDefinition,
  meaningOf,
  saveTerm,
  typeLabel,
  useDefinitions,
  type Definition,
  type DefinitionType,
} from '@/lib/definitions'
import { href, navigate, useRoute } from '@/lib/router'
import { useMe } from '@/lib/store'
import { DefinitionPage } from '@/pages/definition-page'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWide } from '@/hooks/use-wide'
import { Kbd } from '@/components/ui/kbd'
import { usePrimaryKey } from '@/hooks/use-primary-key'
import { DocumentEditorShell } from '@/components/heed/document-shell'
import { Panel } from '@/components/heed/panel'

// A term as a document, like any context item: the word as the heading, a few properties, and the
// meaning as the text. No mode to pick. One optional property, Another name for, turns the word
// into a synonym of a metric or a dimension: the meaning folds away and the word uses that
// definition's meaning, showing as a tag under it. Clearing it makes the word a term again, with
// the meaning that was written before. A saved term's own other names are the same tag box as on
// a definition. Only terms are written here: a synced metric or dimension has no editor, so its
// edit address shows its read-only page.

const countWords = (text: string) =>
  text
    .replace(/[#*_`>[\]()-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length

export function DefinitionEditor({ name }: { name?: string }) {
  const original = name ? findDefinition(name) : undefined
  if (original?.synced) return <DefinitionPage name={original.name} />
  return <TermEditor key={name ?? 'new'} name={name} original={original} />
}

function TermEditor({ name, original }: { name?: string; original?: Definition }) {
  const me = useMe()
  const all = useDefinitions()
  const { query } = useRoute()
  const preset = query.get('sameAs') ?? undefined
  const [title, setTitle] = React.useState(original?.name ?? '')
  const [target, setTarget] = React.useState<string | undefined>(original?.sameAs ?? preset)
  const synonym = !!target
  const [domain, setDomain] = React.useState<DomainId | undefined>(original?.domain ?? me.owns[0])
  const [body, setBody] = React.useState(original?.definition ?? '')
  const [mainRef, wide] = useWide<HTMLDivElement>()
  const ids = React.useId()
  const fieldId = (n: string) => `${ids}-${n}`
  // What agents get folds away unless there is something to say (a conflict), until the person chooses.
  const [sideChoice, setSideChoice] = useSideChoice()
  usePrimaryKey()
  const { state: sendState, send, online } = useSend()

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: docExtensions(
      'What the word means here, in one or two plain sentences. Say what it is not, if people mix it up.',
    ),
    content: body,
    contentType: 'markdown',
    editorProps: { attributes: { 'aria-label': 'What it means' } },
    onUpdate: ({ editor }) => setBody(editor.getMarkdown()),
  })

  if (name && !original)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SiteHeader title="Definitions" icon={<WholeWordIcon />} />
        <p className="p-6 text-sm text-muted-foreground">
          There is no term called “{name}”. It may have been renamed; search Definitions for it.
        </p>
      </div>
    )

  const targetDef = target ? findDefinition(target) : undefined
  const draft: Definition = {
    ...(original ?? {
      type: 'term' as DefinitionType,
      synced: false,
      sourceNames: [],
      by: me.name,
    }),
    name: title.trim(),
    definition: synonym ? '' : body.trim(),
    sameAs: target,
    domain: synonym && targetDef ? (meaningOf(targetDef).domain ?? domain) : domain,
    updated: '23 Oct 2026',
  }
  const missing = [!title.trim() && 'the word', !synonym && !body.trim() && 'what it means'].filter(
    Boolean,
  ) as string[]
  const conflict = title.trim() ? conflictOf(draft) : undefined
  const sideOpen = sideChoice ?? !!conflict
  const words = countWords(`${title} ${synonym ? '' : plainText(body)}`)
  // What a word can be another name for: a metric or a dimension.
  const targets = all.filter((d) => d.synced && !d.sameAs)
  const canEdit = me.admin || (!!draft.domain && me.owns.includes(draft.domain))
  // Clearing Another name for brings back the meaning written before, with a way back.
  const clearTarget = () => {
    const was = target
    setTarget(undefined)
    toast(`“${title.trim() || 'This word'}” has its own meaning again`, {
      description: body.trim() ? 'The meaning written before is back.' : 'Write what it means.',
      action: { label: 'Undo', onClick: () => setTarget(was) },
    })
  }

  const unchanged =
    !!original &&
    original.name === draft.name &&
    original.definition === draft.definition &&
    original.sameAs === draft.sameAs &&
    original.domain === draft.domain
  const blocked = missing.length
    ? `Add ${missing.join(' and ')} first.`
    : unchanged
      ? 'Nothing has changed yet.'
      : ''

  const commit = () => {
    saveTerm(original?.name, draft)
    toast(original ? 'Saved' : 'Published', {
      description: draft.sameAs
        ? `Agents read “${draft.name}” as ${draft.sameAs} from the next question.`
        : `Agents read “${draft.name}” this way from the next question.`,
    })
    navigate('/definitions', { dock: `def.${draft.name}` })
  }
  // Saving, then done; or failed with Retry, the words untouched. Offline, nothing is sent.
  const verb = original ? 'Save' : 'Publish'
  const save = () => {
    if (blocked) {
      if (!title.trim()) document.getElementById('term-word')?.focus()
      else if (!synonym) editor?.commands.focus('end')
      return
    }
    send(commit)
  }
  const held =
    blocked || (!online ? `You're offline. ${verb} once you're back; your words stay here.` : '')

  const side = (
    <>
      <SideSection
        title="What agents get"
        description="When a question uses this word, agents read this first."
      >
        <div className="rounded-frame border bg-muted/40 p-3 text-sm leading-relaxed">
          {synonym ? (
            <p>
              <span className="font-medium">{title.trim() || 'This word'}</span> is another name for{' '}
              <span className="font-medium">{targetDef?.name ?? '...'}</span>
              {targetDef && (
                <span className="text-muted-foreground">
                  : {plainText(meaningOf(targetDef).definition)}
                </span>
              )}
            </p>
          ) : (
            <p>
              <span className="font-medium">{title.trim() || 'This word'}</span>
              {': '}
              {plainText(body).trim() || (
                <span className="text-muted-foreground">what it means goes here.</span>
              )}
            </p>
          )}
        </div>
      </SideSection>
      <SideSection
        title={missing.length ? 'Not ready yet' : conflict ? 'Ready, with a conflict' : 'Ready'}
        description={
          missing.length
            ? `Add ${missing.join(' and ')}.`
            : conflict
              ? "It saves, but agents don't use it until the conflict is settled."
              : synonym
                ? `It never changes ${targetDef?.name}; it only teaches agents another word for it.`
                : 'Agents can use it from the next question.'
        }
        className="border-b-0"
      />
    </>
  )

  return (
    <DocumentEditorShell
      editor={editor}
      toolbar={!synonym}
      paneRef={mainRef}
      header={
        <>
          <SiteHeader
            title={original ? original.name : 'New term'}
            icon={<WholeWordIcon />}
            back={{
              href: original
                ? href(`/definitions/${encodeURIComponent(original.name)}`)
                : href('/definitions'),
              label: original ? `Back to ${original.name}` : 'Back to Definitions',
            }}
            bare
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    data-primary
                    aria-disabled={!!held}
                    loading={sendState === 'sending'}
                    loadingLabel={original ? 'Saving…' : 'Publishing…'}
                    aria-describedby={held ? 'save-blocked' : undefined}

                    onClick={save}
                  />
                }
              >
                {verb}
              </TooltipTrigger>
              <TooltipContent>
                {held || (
                  <>
                    {original ? 'Save' : 'Publish'} <Kbd className="ml-1">⌘</Kbd>
                    <Kbd>Enter</Kbd>
                  </>
                )}
              </TooltipContent>
            </Tooltip>
            <span id="save-blocked" className="sr-only">
              {held}
            </span>
            <HeaderMore>
              <DropdownMenuItem onClick={() => setSideChoice(!sideOpen)}>
                <PanelRightIcon />
                {sideOpen ? 'Hide what agents get' : 'Show what agents get'}
              </DropdownMenuItem>
            </HeaderMore>
          </SiteHeader>
        </>
      }
      aside={
        <>
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
            sendState === 'failed' ? (
              <span role="alert" className="flex items-center gap-2 text-destructive">
                <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
                <span>
                  Couldn't {verb.toLowerCase()}
                  <span className="max-sm:hidden">. Your words are kept</span>.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-foreground"
                  onClick={() => send(commit)}
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  Retry
                </Button>
              </span>
            ) : missing.length ? (
              <>
                <CircleDashedIcon className="size-3.5" aria-hidden />
                <span>
                  Not ready<span className="hidden sm:inline">: add {missing.join(' and ')}</span>
                </span>
              </>
            ) : unchanged ? (
              <>
                <CircleDashedIcon className="size-3.5" aria-hidden />
                No changes yet
              </>
            ) : (
              <>
                <CircleCheckIcon className="size-3.5" aria-hidden />
                {conflict ? 'Ready, with a conflict' : 'Ready'}
              </>
            )
          }
        >
          <span className="whitespace-nowrap">
            {words.toLocaleString('en-GB')} {words === 1 ? 'word' : 'words'}
          </span>
          <span className="hidden sm:inline">{synonym ? 'Another name' : 'Markdown'}</span>
        </DocFooter>
      }
    >
      <Paper>
        <div className="mb-4 flex items-center gap-3 sm:mb-5">
          <TypeTile d={{ type: 'term', sameAs: synonym ? 'x' : undefined }} size="lg" />
          <textarea
            id="term-word"
            aria-label="The word"
            rows={1}
            className="field-sizing-content w-full resize-none overflow-hidden bg-transparent text-2xl leading-tight font-bold tracking-tight outline-none placeholder:text-muted-foreground/60 sm:text-3xl"
            placeholder="The word people use"
            value={title}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
            onPaste={(e) => noteEmoji(e.clipboardData.getData('text/plain'))}
          />
        </div>
        {conflict && <ConflictNote d={draft} className="mb-5" />}
        <PropertyList label="Properties">
          <PropertyGroup>
            <PropertyRow id={fieldId('same')} label="Another name for" icon={<EqualIcon />}>
              <SearchSelectField
                labelId={fieldId('same')}
                label="Another name for"
                value={target}
                onChange={setTarget}
                onClear={clearTarget}
                clearLabel="Not another name: give it its own meaning"
                placeholder="Add a definition"
                searchPlaceholder="Search metrics and dimensions"
                groups={(['metric', 'dimension'] as DefinitionType[]).map((t) => ({
                  heading: `${typeLabel[t]}s`,
                  options: targets
                    .filter((d) => d.type === t)
                    .map((d) => ({ value: d.name, label: d.name, icon: <TypeGlyph d={d} /> })),
                }))}
                display={
                  targetDef && (
                    <TagChip tone={targetDef.type} icon={<TypeGlyph d={targetDef} />}>
                      {targetDef.name}
                    </TagChip>
                  )
                }
              />
            </PropertyRow>
            <PropertyRow id={fieldId('domain')} label="Domain" icon={<FolderIcon />}>
              {synonym && targetDef ? (
                <StaticField>
                  <span className="text-muted-foreground">
                    {draft.domain ? domains[draft.domain].name : 'All domains'}, from{' '}
                    {meaningOf(targetDef).name}
                  </span>
                </StaticField>
              ) : (
                <SelectField
                  labelId={fieldId('domain')}
                  label="Domain"
                  value={domain ?? ''}
                  options={domainIds.map((d) => ({
                    value: d,
                    label: domains[d].name,
                    hint: domains[d].covers,
                    icon: <DomainDot id={d} />,
                  }))}
                  onChange={(d) => setDomain(d as DomainId)}
                  display={
                    domain ? (
                      <>
                        <DomainDot id={domain} />
                        <span className="font-medium">{domains[domain].name}</span>
                      </>
                    ) : (
                      <Ghost>Add a domain</Ghost>
                    )
                  }
                />
              )}
            </PropertyRow>
            <PropertyRow id={fieldId('by')} label="Written by" icon={<UserIcon />}>
              <StaticField>
                <PersonAvatar name={original?.by ?? me.name} size={20} />
                {original?.by ?? me.name}
              </StaticField>
            </PropertyRow>
          </PropertyGroup>
        </PropertyList>
        {/* A saved term's own other names: the same tag box as on a definition. */}
        {original && !synonym && !original.sameAs && (
          <div className="mb-6">
            <SynonymTags d={original} canEdit={canEdit} level={2} />
          </div>
        )}
        {synonym ? (
          // Another name: the meaning editor folds away; the word uses the meaning of what it names.
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
              Uses the meaning of{' '}
              {targetDef ? (
                <button
                  type="button"
                  onClick={() => openDock('def', targetDef.name)}
                  className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-foreground/30 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <TypeGlyph d={targetDef} className="text-current" />
                  {targetDef.name}
                </button>
              ) : (
                'a definition'
              )}
            </p>
            <p className="max-w-reading text-base leading-7 text-muted-foreground">
              {targetDef ? plainText(meaningOf(targetDef).definition) : null}
            </p>
          </div>
        ) : (
          <RichTextEditor.Content className="text-base [&_.ProseMirror]:min-h-32! [&_.ProseMirror]:max-w-reading [&_.ProseMirror]:p-0!" />
        )}
      </Paper>
      {sideOpen && !wide && <div className="border-t bg-background">{side}</div>}
    </DocumentEditorShell>
  )
}
