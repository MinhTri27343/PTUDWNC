import type Database from 'better-sqlite3';
export const VERSIONS = ['starter', 'v1', 'v2', 'v3', 'v4'] as const;
export type Version = typeof VERSIONS[number];
export type Role = 'Viewer' | 'Member' | 'Owner';
export type Action = 'read' | 'edit' | 'delete' | 'members';
export type Db = Database.Database;
export interface User { id: string; name: string; tenantId: string; admin: number; passwordHash: string }
export interface Project { id: string; name: string; tenantId: string }
export interface Task { id: string; projectId: string; title: string; description: string; assigneeId: string | null; status: 'Open' | 'Closed' }
export interface Resource { project: Project; task?: Task }
export interface Context { db: Db; version: Version }
export class HttpError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}
export function fail(status: number, code: string, message?: string): never { throw new HttpError(status, code, message); }
