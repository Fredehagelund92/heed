export type ClassRule = { id: string; pattern: string; message: string }
export declare const classRules: ClassRule[]
export declare function classRulesExcept(...ids: string[]): ClassRule[]
export declare const appClassRules: ClassRule[]
export declare function appClassRulesExcept(...ids: string[]): ClassRule[]
