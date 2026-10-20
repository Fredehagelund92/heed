import { Fragment, type ReactElement } from 'react'
import { ChevronDownIcon } from '@/components/icons'
import { PageToolbarDivider, toolbarViewClass } from '@/components/page/toolbar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** Sections that belong together, with the group's name for the menu; one group has none. */
export type SectionGroup<S extends string> = { title: string | null; sections: readonly S[] }

/**
 * A page's sections as toolbar views (the Proposals page's view links), the current one filled,
 * with a line between groups. Below a 896 pixel page they become one menu button that names the
 * current section and lists the groups under their names (contract 8.4). Settings and
 * Administration both show their sections with it.
 */
export function SectionNav<S extends string>({
  label,
  groups,
  titles,
  active,
  link,
  onChoose,
}: {
  /** What the sections are, for the navigation landmark: "Settings sections". */
  label: string
  groups: readonly SectionGroup<S>[]
  titles: Record<S, string>
  active: S
  /** The link to a section, as the element its view renders. */
  link: (section: S) => ReactElement
  /** Goes to a section chosen in the menu. */
  onChoose: (section: S) => void
}) {
  const shown = groups.filter((group) => group.sections.length > 0)
  return (
    <>
      <nav aria-label={label} className="flex items-center gap-1 @max-4xl:hidden">
        {shown.map((group, index) => (
          <Fragment key={group.title ?? index}>
            {index > 0 ? <PageToolbarDivider /> : null}
            {group.sections.map((section) => (
              <Button
                key={section}
                variant="ghost"
                size="toolbar"
                render={link(section)}
                aria-current={section === active ? 'page' : undefined}
                className={toolbarViewClass}
              >
                {titles[section]}
              </Button>
            ))}
          </Fragment>
        ))}
      </nav>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="touch"
              aria-label={`Section: ${titles[active]}`}
              className="@4xl:hidden"
            />
          }
        >
          {titles[active]}
          <ChevronDownIcon className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={active} onValueChange={(value: S) => onChoose(value)}>
            {shown.map((group, index) => (
              <Fragment key={group.title ?? index}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuGroup>
                  {group.title ? <DropdownMenuLabel>{group.title}</DropdownMenuLabel> : null}
                  {group.sections.map((section) => (
                    // Choosing a section goes there, so the menu closes.
                    <DropdownMenuRadioItem key={section} value={section} closeOnClick>
                      {titles[section]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuGroup>
              </Fragment>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
