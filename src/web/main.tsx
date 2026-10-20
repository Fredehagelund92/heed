import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createQueryClient } from '@/api/query-client'
import { followAppearance } from '@/lib/appearance'
import './styles/index.css'
import { App, createAppRouter, showSignedOut } from './router'

followAppearance()

const queryClient = createQueryClient({ onSignedOut: () => showSignedOut(router) })
const router = createAppRouter(queryClient)

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App queryClient={queryClient} router={router} />
  </StrictMode>,
)
