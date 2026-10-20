import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/catalogue')({
  component: Outlet,
})
