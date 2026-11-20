import type { WorkspaceCommand } from './model';

export function expandWorkspaceCommand(template: string, argumentsText: string): string {
  return template.replace(/\$ARGUMENTS/g, () => argumentsText);
}

export function findWorkspaceCommand(
  commands: readonly WorkspaceCommand[] | undefined,
  name: string,
): WorkspaceCommand | undefined {
  return commands?.find((command) => command.name === name);
}
