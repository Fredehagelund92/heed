import { Link } from '@tanstack/react-router'
import { useShellActions } from '@/components/app-shell/shell-actions'
import {
  EllipsisIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LinkIcon,
  StarIcon,
  Trash2Icon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatHotkey } from '@/lib/commands'
import type { LibrarySearch } from '@/lib/search-params'

/**
 * The row button (contract 8.2): one quiet `...` button, 28, shown on hover and focus. Its menu
 * holds the item commands that make sense from a list: the row itself opens the docked panel,
 * Open page goes to the item page. Editing and review are not in this slice. An administrator
 * also gets Move to Bin, last and apart, since it takes the item out of the library.
 */
export function RowMenu({
  itemId,
  title,
  linkSearch,
  className,
  onMoveToBin,
}: {
  itemId: string
  title: string
  linkSearch: LibrarySearch
  className?: string
  /** An administrator's Move to Bin; left out for everyone else. */
  onMoveToBin?: (() => void) | undefined
}) {
  const { toggleFavorite, isFavorite, copyLinks } = useShellActions()
  const favorite = isFavorite(itemId)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            aria-label={`Actions for ${title}`}
            className={className}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-menu">
        <DropdownMenuItem
          render={
            <Link
              to="/library/$itemId"
              params={{ itemId }}
              search={linkSearch}
              state={{ fromList: true, fromParent: true }}
            />
          }
        >
          <FileTextIcon />
          Open page
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<Link to="/library/$itemId" params={{ itemId }} target="_blank" rel="noopener" />}
        >
          <ExternalLinkIcon />
          Open in a new tab
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => copyLinks([itemId])}>
          <LinkIcon />
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => toggleFavorite(itemId)}>
          <StarIcon />
          {favorite ? 'Remove from favourites' : 'Add to favourites'}
          <DropdownMenuShortcut>{formatHotkey('f').join('')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        {onMoveToBin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onMoveToBin}>
              <Trash2Icon />
              Move to Bin
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
