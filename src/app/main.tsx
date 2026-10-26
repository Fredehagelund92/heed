import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// After the first paint the app is ready: from then on a dock or a row that arrives moves in; what is
// on screen at load is simply there (docs/motion.md: no page-enter transition).
requestAnimationFrame(() =>
  requestAnimationFrame(() => document.documentElement.setAttribute('data-ready', '')),
)
