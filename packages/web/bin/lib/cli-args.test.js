import { afterEach, describe, expect, it } from 'vitest';

import { generateCompletionScript, parseArgs, showHelp } from './cli-args.js';
import { INJECTED_ENV_KEY, assignInjectedEnv } from '../../server/lib/injected-env.js';

describe('parseArgs ui password default', () => {
  const previous = {
    OPENCHAMBER_UI_PASSWORD: process.env.OPENCHAMBER_UI_PASSWORD,
    [INJECTED_ENV_KEY]: process.env[INJECTED_ENV_KEY],
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('takes a password the user exported', () => {
    delete process.env[INJECTED_ENV_KEY];
    process.env.OPENCHAMBER_UI_PASSWORD = 'theirs';

    expect(parseArgs(['serve']).options.uiPassword).toBe('theirs');
  });

  it('ignores a password OpenChamber put into the shell', () => {
    delete process.env[INJECTED_ENV_KEY];
    delete process.env.OPENCHAMBER_UI_PASSWORD;
    assignInjectedEnv(process.env, { OPENCHAMBER_UI_PASSWORD: 'the-desktop-apps' });

    expect(parseArgs(['serve']).options.uiPassword).toBeUndefined();
    expect(parseArgs(['serve', '--ui-password', 'chosen']).options.uiPassword).toBe('chosen');
  });
});

describe('CLI command name', () => {
  it('uses skynex-app in help and generated shell completions', () => {
    const originalLog = console.log;
    let help = '';
    console.log = (chunk) => { help += String(chunk); };
    try {
      showHelp();
    } finally {
      console.log = originalLog;
    }

    expect(help).toContain('skynex-app [COMMAND] [OPTIONS]');
    for (const shell of ['bash', 'zsh', 'fish']) {
      const completion = generateCompletionScript(shell);
      expect(completion).toContain('skynex-app');
      expect(completion).not.toContain('openchamber');
    }
  });
});
