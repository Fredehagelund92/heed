import type { ESLint, Linter } from 'eslint'
import type { Place } from './src/domain/words.ts'

export type Surface = { place: string; files: string[]; except?: string[] }
export type AppSurface = { place: Place; files: string[] }
export declare const plainWordsFiles: string[]
export declare const errorMessageFiles: string[]
export declare const surfaces: Surface[]
export declare const webWordsFiles: string[]
export declare const webNotProductFiles: string[]
export declare const webSurfaces: AppSurface[]
export declare function allowedIn(path: string): string[]
export declare function webPlacesOf(path: string): Place[]
export declare const plainWordsConfigs: Linter.Config[]
declare const plugin: ESLint.Plugin
export default plugin
export declare const glossaryV2Files: string[]
export declare const glossaryV2Not: string[]
export declare const copyRatchetConfigs: Linter.Config[]
export declare function readsAsText(
  node: unknown,
  errorsOnly: boolean,
  wide?: boolean,
  text?: string,
): boolean
export declare function looksLikeCode(text: string, wide?: boolean): boolean
export declare function codeSample(text: string): boolean
export declare function kindAndId(node: unknown): boolean
