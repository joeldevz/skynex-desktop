import { describe, expect, test } from 'bun:test';
import { DIRECT_TOOLS_GUIDANCE, KNOWLEDGE_ENTRY_KEYS, RENDER_PAGE_GUIDANCE, SESSION_LINK_GUIDANCE, WORK_NAME_GUIDANCE, WORKFLOW_GUIDANCE, buildKnowledgeEntries, createSessionKnowledgeRuntime } from './runtime.js';

const DIRECTORY = '/work/project';
const { checkout: CHECKOUT, pinned: PINNED, memory: MEMORY, guidance: GUIDANCE } = KNOWLEDGE_ENTRY_KEYS;
const createRuntime = (overrides = {}) => createSessionKnowledgeRuntime(overrides);
const entriesFor = async (runtime, directory = DIRECTORY) => buildKnowledgeEntries(await runtime.collect(directory));

const createEntriesStub = ({ fail = new Set() } = {}) => {
  const held = new Map();
  const calls = [];
  return {
    held,
    calls,
    put: async (sessionId, directory, key, value) => {
      calls.push(['put', sessionId, directory, key]);
      if (fail.has(key)) throw new Error(`put ${key} failed`);
      held.set(key, value);
    },
    remove: async (sessionId, directory, key) => {
      calls.push(['remove', sessionId, directory, key]);
      if (fail.has(key)) throw new Error(`remove ${key} failed`);
      held.delete(key);
    },
  };
};

describe('writing session context', () => {
  test('clears retired entries without reading their stores', async () => {
    const instructionEntries = createEntriesStub();
    instructionEntries.held.set(PINNED, 'Historical pinned text');
    instructionEntries.held.set(MEMORY, 'Historical memory index');
    const runtime = createRuntime({ instructionEntries });
    expect(await runtime.sync('ses_a', DIRECTORY)).toBe(true);
    expect(instructionEntries.held.size).toBe(0);
    for (const key of [PINNED, MEMORY, GUIDANCE, CHECKOUT]) {
      expect(instructionEntries.calls).toContainEqual(['remove', 'ses_a', DIRECTORY, key]);
    }
  });

  test('one entry that will not write does not hold back the others', async () => {
    const instructionEntries = createEntriesStub({ fail: new Set([GUIDANCE]) });
    const runtime = createRuntime({ instructionEntries, isSessionLinkingAvailable: async () => true, readCheckoutBranch: async () => 'main' });
    expect(await runtime.sync('ses_a', DIRECTORY)).toBe(false);
    expect(instructionEntries.held.get(CHECKOUT)).toContain('on branch `main`');
  });

  test('never throws, so a send goes out without its background', async () => {
    const instructionEntries = createEntriesStub();
    const runtime = createRuntime({ instructionEntries, isSessionLinkingAvailable: async () => { throw new Error('settings unreadable'); } });
    await expect(runtime.sync('ses_a', DIRECTORY)).resolves.toBe(true);
    const broken = createRuntime({ instructionEntries: { remove: async () => { throw new Error('offline'); } } });
    await expect(broken.sync('ses_a', DIRECTORY)).resolves.toBe(false);
    await expect(runtime.sync('', DIRECTORY)).resolves.toBe(false);
  });

  test('does nothing without OpenCode wired', async () => {
    expect(await createRuntime().sync('ses_a', DIRECTORY)).toBe(false);
  });
});

describe('when to link', () => {
  test('is told in a session whose agent has the tool, even with nothing else to tell', async () => {
    const entries = await entriesFor(createRuntime({ isSessionLinkingAvailable: async () => true }));
    expect(entries[GUIDANCE]).toBe(`${SESSION_LINK_GUIDANCE}\n\n${WORK_NAME_GUIDANCE}\n\n${DIRECT_TOOLS_GUIDANCE}`);
    expect(entries[PINNED]).toBe('');
    expect(entries[MEMORY]).toBe('');
  });

  test('is left out without the tool, or when the check fails', async () => {
    for (const isSessionLinkingAvailable of [async () => false, async () => { throw new Error('settings unreadable'); }]) {
      const entries = await entriesFor(createRuntime({ isSessionLinkingAvailable }));
      expect(entries[GUIDANCE]).toBe('');
    }
  });
});

describe('when to draw a page', () => {
  test('is told in a session whose agent has the render tool', async () => {
    const entries = await entriesFor(createRuntime({ isPageRenderingAvailable: async () => true }));
    expect(entries[GUIDANCE]).toBe(`${RENDER_PAGE_GUIDANCE}\n\n${DIRECT_TOOLS_GUIDANCE}`);
    expect(entries[GUIDANCE]).toContain('Skip it for a few numbers');
  });

  test('is left out without the tool, or when the check fails', async () => {
    for (const isPageRenderingAvailable of [async () => false, async () => { throw new Error('settings unreadable'); }]) {
      const entries = await entriesFor(createRuntime({ isPageRenderingAvailable }));
      expect(entries[GUIDANCE]).toBe('');
    }
  });
});

describe('when to offer a workflow', () => {
  test('is told only in a session whose agent has the workflow tool', async () => {
    const withTool = await entriesFor(createRuntime({ isWorkflowAvailable: async () => true }));
    expect(withTool[GUIDANCE]).toBe(`${WORKFLOW_GUIDANCE}\n\n${DIRECT_TOOLS_GUIDANCE}`);
    expect(withTool[GUIDANCE]).toContain('never start one unasked');
    const without = await entriesFor(createRuntime({ isWorkflowAvailable: async () => { throw new Error('settings unreadable'); } }));
    expect(without[GUIDANCE]).toBe('');
  });
});

describe('where the managed tools are called', () => {
  test('says they are direct tools, and not when they run through Code Mode', async () => {
    const direct = await entriesFor(createRuntime({ isSessionLinkingAvailable: async () => true }));
    expect(direct[GUIDANCE]).toContain('never call them from inside a Code Mode execute script');
    const codeMode = await entriesFor(createRuntime({ isSessionLinkingAvailable: async () => true, areAgentToolsInCodeMode: async () => true }));
    expect(codeMode[GUIDANCE]).not.toContain(DIRECT_TOOLS_GUIDANCE);
  });
});

describe('the worktree move', () => {
  test('is introduced by the tool description, never told as a rule in the session', async () => {
    const entries = await entriesFor(createRuntime({ isSessionLinkingAvailable: async () => true }));
    expect(entries[GUIDANCE]).not.toContain('moveToWorktree');
  });
});

describe('which branch the session works on', () => {
  const runtimeOn = (branch, overrides = {}) => createRuntime({
    isSessionLinkingAvailable: async () => true,
    readCheckoutBranch: async () => {
      if (branch instanceof Error) throw branch;
      return branch;
    },
    ...overrides,
  });

  test('names the directory and the branch', async () => {
    const entries = await entriesFor(runtimeOn('main'));
    expect(entries[CHECKOUT]).toBe('This session works in `/work/project`, on branch `main`.');
  });

  test('a switched branch changes the entry, which OpenCode announces to the agent', async () => {
    const instructionEntries = createEntriesStub();
    let branch = 'main';
    const runtime = runtimeOn(null, { instructionEntries, readCheckoutBranch: async () => branch });
    await runtime.sync('ses_a', DIRECTORY);
    const before = instructionEntries.held.get(CHECKOUT);
    branch = 'fix/other-session';
    await runtime.sync('ses_a', DIRECTORY);
    expect(instructionEntries.held.get(CHECKOUT)).not.toBe(before);
    expect(instructionEntries.held.get(CHECKOUT)).toContain('`fix/other-session`');
  });

  test('a session that moved to another directory names the new one', async () => {
    const entries = await entriesFor(runtimeOn('feat/moved'), '/work/project-worktree');
    expect(entries[CHECKOUT]).toBe('This session works in `/work/project-worktree`, on branch `feat/moved`.');
  });

  test('a branch that cannot be read keeps what the session holds', async () => {
    for (const unreadable of [null, new Error('git failed')]) {
      const entries = await entriesFor(runtimeOn(unreadable));
      expect(entries).not.toHaveProperty(CHECKOUT);
    }
  });

  test('an empty branch replaces the old branch and directory; a failed read preserves it', async () => {
    const instructionEntries = createEntriesStub();
    let branch = 'main';
    const runtime = runtimeOn(null, {
      instructionEntries,
      readCheckoutBranch: async () => {
        if (branch instanceof Error) throw branch;
        return branch;
      },
    });
    await runtime.sync('ses_a', DIRECTORY);
    expect(instructionEntries.held.get(CHECKOUT)).toContain('on branch `main`');
    branch = '';
    await runtime.sync('ses_a', '/work/plain-directory');
    const noBranch = 'This session works in `/work/plain-directory`, with no branch checked out.';
    expect(instructionEntries.held.get(CHECKOUT)).toBe(noBranch);
    branch = new Error('git failed');
    await runtime.sync('ses_a', '/work/unreadable');
    expect(instructionEntries.held.get(CHECKOUT)).toBe(noBranch);
  });

  test('a placeholder branch asks for a rename with work.name, until it is renamed', async () => {
    const instructionEntries = createEntriesStub();
    let branch = 'agile-chipmunk';
    const runtime = runtimeOn(null, {
      instructionEntries,
      readCheckoutBranch: async () => branch,
      readPlaceholderBranch: async () => (branch === 'agile-chipmunk' ? branch : null),
    });
    await runtime.sync('ses_a', DIRECTORY);
    const told = instructionEntries.held.get(CHECKOUT);
    expect(told).toContain('`agile-chipmunk` is a placeholder');
    expect(told).toContain('passing branch too');
    expect(told).toContain('work.name');
    branch = 'fix/login-timeout';
    await runtime.sync('ses_a', DIRECTORY);
    expect(instructionEntries.held.get(CHECKOUT)).toBe('This session works in `/work/project`, on branch `fix/login-timeout`.');
  });

  test('a placeholder check that fails tells only the branch', async () => {
    const entries = await entriesFor(runtimeOn('agile-chipmunk', {
      readPlaceholderBranch: async () => { throw new Error('git failed'); },
    }));
    expect(entries[CHECKOUT]).toBe('This session works in `/work/project`, on branch `agile-chipmunk`.');
  });

  test('is not read without the tool, and the entry is cleared', async () => {
    const reads = [];
    const runtime = createRuntime({
      isSessionLinkingAvailable: async () => false,
      readCheckoutBranch: async (directory) => { reads.push(directory); return 'main'; },
    });
    const entries = await entriesFor(runtime);
    expect(reads).toEqual([]);
    expect(entries[CHECKOUT]).toBe('');
  });
});
