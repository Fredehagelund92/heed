import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { termCandidatesQuery } from '@/api/queries'
import { ListChecksIcon, PlusIcon } from '@/components/icons'
import { StubPage } from '@/components/page/stub-page'
import { Button } from '@/components/ui/button'
import { EmptyContent } from '@/components/ui/empty'
import { proposeTermsSearch } from '@/lib/sources'
import { usePermissions } from '@/lib/use-session'

export const Route = createFileRoute('/catalogue/suggest')({
  component: SuggestTerm,
})

/**
 * Suggest a name (FR-125, FR-136). The catalogue lists the vocabulary, and a term comes from the
 * definition source: an administrator proposes the source's members as terms in Sources (Propose
 * terms), and an owner of the term's domain, or an administrator, accepts them. So the
 * page leads an administrator there and tells everyone else who adds terms. The trail's
 * Catalogue crumb is the way back, so the page has no second one.
 */
function SuggestTerm() {
  const { isAdmin, ready } = usePermissions()
  const candidates = useQuery({ ...termCandidatesQuery(), enabled: ready && isAdmin })
  if (!isAdmin)
    return (
      <StubPage
        title="Suggest a name"
        description="Names come from the definition source, such as Cube. An admin proposes its metrics and dimensions as names in Administration › Sources, and an owner of each name's domain accepts them. Ask an admin for the name you miss. It shows here once it's accepted."
        icon={PlusIcon}
      />
    )
  const open = candidates.data ?? []
  const source = open[0]?.source
  return (
    <StubPage
      title="Suggest a name"
      description={
        candidates.isPending
          ? 'Names come from the definition source, such as Cube. As an admin, you propose its metrics and dimensions as names in Sources.'
          : open.length
            ? `Names come from the definition source, such as Cube. ${open.length === 1 ? "One of its metrics or dimensions isn't a name yet. Propose it" : `${open.length.toLocaleString('en')} of its metrics and dimensions aren't names yet. Propose them`} in Sources, with any values of a dimension, such as markets. An owner of each name's domain, or an admin, accepts them.`
            : 'Every metric and dimension of the definition source is a name, or waits for a decision. A new one shows in Sources after the next read of the source, ready to propose.'
      }
      icon={PlusIcon}
    >
      <EmptyContent>
        <Button
          variant="outline"
          render={
            <Link
              to="/admin"
              search={source ? proposeTermsSearch(source) : { section: 'sources' }}
            />
          }
        >
          <ListChecksIcon aria-hidden />
          {source ? 'Propose names' : 'Open Sources'}
        </Button>
      </EmptyContent>
    </StubPage>
  )
}
