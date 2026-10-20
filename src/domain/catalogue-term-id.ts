/**
 * What a catalogue term's id may be: its key in the vocabulary without the `metric:` or `dim:`
 * prefix. Apart from the rest of the catalogue, so the term routes' loaders, which the shell loads
 * before any page, can turn away an id that cannot exist without bringing the catalogue's schemas.
 */
export const catalogueTermIdPattern = /^[a-z0-9_]{1,64}$/
