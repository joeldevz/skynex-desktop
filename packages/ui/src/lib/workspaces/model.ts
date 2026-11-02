import type { ModelSelection } from '../opencode/model';

export type WorkspaceFolder = Readonly<{ id: string; path: string; role: string }>;
export type WorkspaceDefaults = Readonly<{ model?: ModelSelection; agent?: string }>;
export type Workspace = Readonly<{
  id: string;
  name: string;
  description: string;
  folders: readonly WorkspaceFolder[];
  defaults: WorkspaceDefaults;
}>;
export type WorkspaceCatalog = Readonly<{ version: 1; workspaces: readonly Workspace[] }>;
export type WorkspacePatch = Partial<Omit<Workspace, 'id'>>;
export type ParseResult<T> = { kind: 'missing' } | { kind: 'valid'; value: T } | { kind: 'invalid'; reason: string };
