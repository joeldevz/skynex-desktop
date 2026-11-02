import { getRegisteredRuntimeAPIs } from '../../contexts/runtimeAPIRegistry';
import { spaceIdOfDirectory } from '../spaces/space-route';
import { normalizePath } from '../pathNormalization';
import { getRuntimeKey, isTransientRuntimeKey } from '../runtime-switch';
import type { WorkspaceSessionScope } from './session-scope';

type WorkspaceRuntimePolicy = { kind: 'host' } | { kind: 'vscode'; roots: readonly string[] } | { kind: 'isolated-space' };
export type WorkspaceAccessResult = { kind: 'supported' } | { kind: 'unavailable'; reason: 'runtime-unavailable' | 'outside-editor-roots' | 'isolated-space-unsupported' | 'folder-unavailable'; paths: readonly string[] };

function validateWorkspaceRuntimeScope(scope: WorkspaceSessionScope, policy: WorkspaceRuntimePolicy): WorkspaceAccessResult {
  const paths = scope.folders.map((folder) => folder.path);
  if (policy.kind === 'isolated-space' || paths.some((path) => spaceIdOfDirectory(path))) {
    return { kind: 'unavailable', reason: 'isolated-space-unsupported', paths };
  }
  if (policy.kind === 'vscode') {
    const roots = new Set(policy.roots.map((root) => normalizePath(root)));
    const outside = paths.filter((path) => !roots.has(normalizePath(path)));
    if (outside.length) return { kind: 'unavailable', reason: 'outside-editor-roots', paths: outside };
  }
  return { kind: 'supported' };
}

export async function checkWorkspaceScopeAccess(scope: WorkspaceSessionScope, editorRoots: readonly string[]): Promise<WorkspaceAccessResult> {
  const runtimeKey = getRuntimeKey();
  const apis = getRegisteredRuntimeAPIs();
  if (!apis || isTransientRuntimeKey(runtimeKey)) return { kind: 'unavailable', reason: 'runtime-unavailable', paths: scope.folders.map((folder) => folder.path) };
  const result = validateWorkspaceRuntimeScope(scope, apis.runtime.isVSCode ? { kind: 'vscode', roots: editorRoots } : { kind: 'host' });
  if (result.kind === 'unavailable') return result;
  const unavailable: string[] = [];
  for (const folder of scope.folders) {
    if (runtimeKey !== getRuntimeKey() || apis !== getRegisteredRuntimeAPIs()) {
      return { kind: 'unavailable', reason: 'runtime-unavailable', paths: scope.folders.map((folder) => folder.path) };
    }
    try { await apis.files.listDirectory(folder.path); }
    catch { unavailable.push(folder.path); }
    if (runtimeKey !== getRuntimeKey() || apis !== getRegisteredRuntimeAPIs()) {
      return { kind: 'unavailable', reason: 'runtime-unavailable', paths: scope.folders.map((folder) => folder.path) };
    }
  }
  return unavailable.length ? { kind: 'unavailable', reason: 'folder-unavailable', paths: unavailable } : { kind: 'supported' };
}
