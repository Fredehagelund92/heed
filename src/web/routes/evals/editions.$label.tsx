import { createFileRoute, redirect } from '@tanstack/react-router'

/** An edition's old address, from the retired Evals and releases screen. */
export const Route = createFileRoute('/evals/editions/$label')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/editions/$label', params, replace: true })
  },
})
