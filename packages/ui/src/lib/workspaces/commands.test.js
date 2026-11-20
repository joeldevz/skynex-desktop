import { describe, expect, test } from 'bun:test';
import { expandWorkspaceCommand, findWorkspaceCommand } from './commands';

describe('workspace commands', () => {
  test('replaces literal argument markers without interpreting replacement text', () => {
    expect(expandWorkspaceCommand('First $ARGUMENTS, then $ARGUMENTS.', '$ARGUMENTS; $HOME'))
      .toBe('First $ARGUMENTS; $HOME, then $ARGUMENTS; $HOME.');
  });

  test('matches command names exactly', () => {
    const commands = [{ name: 'release', template: 'Release $ARGUMENTS.' }];
    expect(findWorkspaceCommand(commands, 'release')).toBe(commands[0]);
    expect(findWorkspaceCommand(commands, 'Release')).toBeUndefined();
  });
});
