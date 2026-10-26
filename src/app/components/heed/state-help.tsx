import { ArrowRightIcon } from '@/components/icons'
import { StateLine } from '@/components/heed/bits'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DRAFT_LABEL, type AnswerState } from '@/data/ask'
import { ANSWER_LINES } from '@/lib/help-content'
import { useRoute } from '@/lib/router'

/**
 * Contextual help where the words are: the answer line, with its short sentence, opens a small card
 * saying what it means and what to do, with a way to all six. Its name is the words and the
 * sentence, as they show; hovering it gives the longer form.
 */
export function StateHelp({ state, draft }: { state: AnswerState; draft?: boolean }) {
  const { query } = useRoute()
  const line = ANSWER_LINES.find((l) => l.state === state)!
  if (draft)
    return (
      <StateLine state={state} draft sentence>
        {state === 'grounded' ? DRAFT_LABEL : undefined}
      </StateLine>
    )
  return (
    <Popover defaultOpen={query.get('statehelp') === '1'}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger className="w-fit rounded-md text-left outline-none hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50" />
          }
        >
          <StateLine state={state} sentence tip={false} />
        </TooltipTrigger>
        <TooltipContent className="block max-w-64 text-pretty">
          <span className="font-semibold">{line.long}.</span> {line.means}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        sideOffset={6}
        aria-label={`What ${line.label} means`}
        className="w-80 gap-2 rounded-lg p-3.5"
      >
        <p className="text-sm font-semibold">
          {line.label}: {line.long.charAt(0).toLowerCase() + line.long.slice(1)}
        </p>
        <p className="text-sm text-pretty">{line.means}</p>
        <p className="text-sm text-pretty text-muted-foreground">
          <span className="font-medium text-foreground">What you do. </span>
          {line.todo}
        </p>
        <a
          href="/help"
          className="mt-1 inline-flex w-fit items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          All answer lines
          <ArrowRightIcon className="size-3.5" aria-hidden />
        </a>
      </PopoverContent>
    </Popover>
  )
}
