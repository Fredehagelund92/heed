import * as React from "react"
import { BotIcon } from "lucide-react"
import { StateLine } from "@/components/heed/bits"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { correctionInAgent, inAgent } from "@/data/ask"
import { useIsMobile } from "@/hooks/use-mobile"

// How the same answers look inside a person's own agent: a static transcript, each answer ending in
// the one line that names its state. Opened from the connect steps, once someone has set one up.

function AgentLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
        <BotIcon className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  )
}

function UserLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-frame bg-muted px-4 py-2 text-[15px] leading-relaxed">{children}</div>
    </div>
  )
}

function Transcript({ agent }: { agent: string }) {
  return (
    <div className="flex flex-col gap-6">
      {inAgent.map((t) => (
        <div key={t.state} className="flex flex-col gap-4 border-b pb-6 last:border-b-0">
          <UserLine>{t.you}</UserLine>
          <AgentLine>
            <p className="text-xs font-medium text-muted-foreground">{agent}</p>
            <p className="text-[15px] leading-relaxed">{t.agent}</p>
            <StateLine state={t.state} className="text-xs font-medium text-muted-foreground">
              {t.line}
            </StateLine>
          </AgentLine>
        </div>
      ))}
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium">An answer that needs correction</p>
        {correctionInAgent.map((m, i) =>
          m.who === "you" ? (
            <UserLine key={i}>{m.text}</UserLine>
          ) : (
            <AgentLine key={i}>
              <p className="text-[15px] leading-relaxed">{m.text}</p>
            </AgentLine>
          )
        )}
      </div>
    </div>
  )
}

/** A quiet link under the connect steps that opens the transcript in a sheet: from the side, or from the bottom on a phone. */
export function AgentPreviewLink({ agent }: { agent: string }) {
  const [open, setOpen] = React.useState(false)
  const mobile = useIsMobile()
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        See how an agent answers
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={mobile ? "bottom" : "right"} className="gap-0 data-[side=bottom]:max-h-[85svh] data-[side=right]:sm:max-w-md">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>How an agent answers</SheetTitle>
            <SheetDescription>
              The agent checks the context first, then ends each answer with one line naming what it found. Numbers come from the data tool.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Transcript agent={agent} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
