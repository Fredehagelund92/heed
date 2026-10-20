/** A model setting or provider configuration that cannot be served. The message names the fix. */
export class ModelConfigError extends Error {
  override name = 'ModelConfigError'
}

/** A response came from another vendor's model than the one asked for, as a fallback would. */
export class ModelVendorError extends Error {
  override name = 'ModelVendorError'
}
