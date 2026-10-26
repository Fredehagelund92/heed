import { createLazyFileRoute } from '@tanstack/react-router'
import { ReviewPage } from '@/pages/review-page'

export const Route = createLazyFileRoute('/_app/inbox/$id/review')({ component: Review })

function Review() {
  const { id } = Route.useParams()
  return <ReviewPage key={id} id={id} />
}
