import { describe, expect, test } from 'bun:test';

import { skillAutocompleteScope } from './skillAutocompleteItems';

describe('skillAutocompleteScope', () => {
  test('a Skynex-installed skill is labelled skynex, whatever its scope', () => {
    expect(skillAutocompleteScope({ scope: 'user', managedBy: 'skynex' })).toBe('skynex');
    expect(skillAutocompleteScope({ scope: 'project', managedBy: 'skynex' })).toBe('skynex');
  });

  test('other skills keep their scope', () => {
    expect(skillAutocompleteScope({ scope: 'project' })).toBe('project');
    expect(skillAutocompleteScope({ scope: 'user', managedBy: 'someone-else' })).toBe('user');
  });
});
