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
