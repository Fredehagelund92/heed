import { createLazyFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/pages/settings'

export const Route = createLazyFileRoute('/_app/settings/')({ component: () => <SettingsPage /> })
