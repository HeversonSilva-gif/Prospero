declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type CompanyId = Brand<string, "CompanyId">;
export type ProjectId = Brand<string, "ProjectId">;
export type AgentId = Brand<string, "AgentId">;
export type IssueId = Brand<string, "IssueId">;
export type ThreadId = Brand<string, "ThreadId">;
export type MessageId = Brand<string, "MessageId">;
export type InboxItemId = Brand<string, "InboxItemId">;

export const newId = <T extends string>(): T => crypto.randomUUID() as unknown as T;
