import type { ESLint, Linter } from 'eslint'

export type Surface = { place: string; files: string[]; except?: string[] }
export declare const plainWordsFiles: string[]
export declare const errorMessageFiles: string[]
export declare const notProductFiles: string[]
export declare const surfaces: Surface[]
export declare function allowedIn(path: string): string[]
export declare const plainWordsConfigs: Linter.Config[]
declare const plugin: ESLint.Plugin
export default plugin
