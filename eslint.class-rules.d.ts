export type ClassRule = { id: string; pattern: string; message: string }
export declare const appClassRules: ClassRule[]
export declare function appClassRulesExcept(...ids: string[]): ClassRule[]
