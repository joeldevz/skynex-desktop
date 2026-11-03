import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { plugin } from 'bun';
import { pathToFileURL } from 'node:url';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { OpenCode } from '@opencode/client';
import type { ToolPart as ToolPartData } from '@/lib/opencode/model';
import { SyncProvider } from '@/sync/sync-context';
import { I18nProvider } from '@/lib/i18n';
import { ThemeSystemProvider } from '@/contexts/ThemeSystemContext';

plugin({
  name: 'tool-shell-card-worker-url',
  setup(build) {
    build.onLoad({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, ({ path }) => ({
      contents: `export default ${JSON.stringify(pathToFileURL(path.split('?')[0]).href)};`,
      loader: 'js',
    }));
  },
});

const { default: ToolPart } = await import('./ToolPart');

const fixture = (state: ToolPartData['state']): ToolPartData => ({
  id: 'prt_shell_card', sessionID: 'ses_shell_card', messageID: 'msg_shell_card',
  type: 'tool', tool: 'shell', callID: 'call_shell_card', state,
});

const Harness = ({ part }: { part: ToolPartData }) => {
  const [expanded, setExpanded] = React.useState(false);
  return <ToolPart part={part} isExpanded={expanded} isMobile={false} onToggle={() => setExpanded((value) => !value)} />;
};

const mounted = async (initial: ToolPartData) => {
  const happyWindow = new Window({ url: 'http://localhost' });
  const globals = {
    window: happyWindow, document: happyWindow.document, navigator: happyWindow.navigator,
    localStorage: happyWindow.localStorage, customElements: happyWindow.customElements,
    Node: happyWindow.Node, Text: happyWindow.Text, NodeList: happyWindow.NodeList,
    Element: happyWindow.Element, HTMLElement: happyWindow.HTMLElement, SVGElement: happyWindow.SVGElement,
    CustomEvent: happyWindow.CustomEvent, requestAnimationFrame: happyWindow.requestAnimationFrame.bind(happyWindow),
    cancelAnimationFrame: happyWindow.cancelAnimationFrame.bind(happyWindow),
    getComputedStyle: happyWindow.getComputedStyle.bind(happyWindow), ResizeObserver: happyWindow.ResizeObserver,
    MutationObserver: happyWindow.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const sdk = OpenCode.make({ baseUrl: 'http://localhost', fetch: async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }) });
  const render = async (part: ToolPartData) => act(async () => {
    root.render(<SyncProvider sdk={sdk} directory=""><ThemeSystemProvider><I18nProvider><Harness part={part} /></I18nProvider></ThemeSystemProvider></SyncProvider>);
  });
  await render(initial);
  return {
    container,
    render,
    close: async () => {
      await act(async () => root.unmount());
      await happyWindow.happyDOM.abort();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
};

test('completed shell card starts collapsed and opens to command and output', async () => {
  const view = await mounted(fixture({ status: 'completed', input: { command: 'printf hello' }, output: 'hello', time: { start: 1, end: 2 } }));
  try {
    const header = view.container.querySelector<HTMLElement>('[role="button"]');
    expect(header?.getAttribute('aria-expanded')).toBe('false');
    const icons = [...(header?.querySelectorAll('use') ?? [])].map((icon) => icon.getAttribute('href'));
    expect(icons[0]).toBe('#oc-terminal-box');
    expect(icons).toContain('#oc-checkbox-circle');
    await act(async () => {
      header?.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    expect(view.container.textContent).toContain('$ printf hello');
    expect(view.container.textContent).toContain('hello');
  } finally { await view.close(); }
});

test('running shell shows spinner and explicit output progress', async () => {
  const view = await mounted(fixture({ status: 'running', input: { command: 'build' }, metadata: { output: 'working 64%' }, time: { start: 1 } }));
  try {
    expect(view.container.querySelector('.oc-spinner, [data-spinner]')).not.toBeNull();
    expect(view.container.textContent).toContain('64%');
    expect(view.container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('64');
  } finally { await view.close(); }
});

test('live shell failure opens once and remains collapsed after manual close', async () => {
  const view = await mounted(fixture({ status: 'running', input: { command: 'build' }, time: { start: 1 } }));
  try {
    await view.render(fixture({ status: 'error', input: { command: 'build' }, error: 'failed', time: { start: 1, end: 2 } }));
    const header = view.container.querySelector<HTMLElement>('[role="button"]');
    expect(header?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => header?.click());
    expect(header?.getAttribute('aria-expanded')).toBe('false');
    await view.render(fixture({ status: 'error', input: { command: 'build' }, error: 'failed', time: { start: 1, end: 2 } }));
    expect(view.container.querySelector('[role="button"]')?.getAttribute('aria-expanded')).toBe('false');
  } finally { await view.close(); }
});

for (const error of ['Tool execution aborted', 'Interrupted']) {
  test(`a shell the user stopped (${error}) stays collapsed`, async () => {
    const view = await mounted(fixture({ status: 'running', input: { command: 'build' }, time: { start: 1 } }));
    try {
      await view.render(fixture({ status: 'error', input: { command: 'build' }, error, time: { start: 1, end: 2 } }));
      expect(view.container.querySelector('[role="button"]')?.getAttribute('aria-expanded')).toBe('false');
    } finally { await view.close(); }
  });
}
