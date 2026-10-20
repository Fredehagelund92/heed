import { Outlet } from '@tanstack/react-router'
import './design-preview.css'

/** Every design preview page, with the classes only the preview writes. */
export function DesignPreviewLayout() {
  return <Outlet />
}
