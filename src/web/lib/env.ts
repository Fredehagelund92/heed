/** The design preview route exists in development and in builds made with VITE_DESIGN_PREVIEW=true. */
export const designPreviewEnabled =
  import.meta.env.DEV || import.meta.env.VITE_DESIGN_PREVIEW === 'true'
