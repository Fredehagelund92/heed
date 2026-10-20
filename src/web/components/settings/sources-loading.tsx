import { GridLoading } from '@/components/page/grid-table'
import { PageContent } from '@/components/page/page'

/** Sources while its pages or the overview load: the grid's skeleton at the page's edge. */
export function SourcesLoading() {
  return (
    <PageContent width="overview">
      <GridLoading slot="settings-source-list" label="Loading the sources" />
    </PageContent>
  )
}
