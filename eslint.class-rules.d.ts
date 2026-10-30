export type ClassRule = { id: string; pattern: string; message: string }
export declare const webClassRules: ClassRule[]
export declare function webClassRulesExcept(...ids: string[]): ClassRule[]
