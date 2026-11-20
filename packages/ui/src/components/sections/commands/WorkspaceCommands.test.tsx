import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  localStorage: browser.localStorage,
  sessionStorage: browser.sessionStorage,
  Node: browser.Node,
  Element: browser.Element,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLTextAreaElement: browser.HTMLTextAreaElement,
  Event: browser.Event,
  FocusEvent: browser.FocusEvent,
  MutationObserver: browser.MutationObserver,
  ResizeObserver: browser.ResizeObserver,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { I18nProvider } = await import('@/lib/i18n');
const { ThemeSystemProvider } = await import('@/contexts/ThemeSystemContext');
const { WorkspaceCommandsPage, WorkspaceCommandsSidebar } = await import('./WorkspaceCommands');
const { useWorkspacesStore } = await import('@/stores/useWorkspacesStore');
const { useCommandSettingsScope } = await import('./commandSettingsScope');
const initialWorkspaces = useWorkspacesStore.getState();
const initialScope = useCommandSettingsScope.getState();
const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container);

afterEach(async () => {
  await act(async () => root.unmount());
  useWorkspacesStore.setState(initialWorkspaces, true);
  useCommandSettingsScope.setState(initialScope, true);
  await browser.close();
});

test('workspace prompt edits preserve sibling commands and expose no execution controls', async () => {
  const original = {
    id: 'workspace-one', name: 'Workspace One', description: '', folders: [], defaults: {},
    commands: [
      { name: 'review', description: 'Review this', template: 'Review $ARGUMENTS' },
      { name: 'explain', template: 'Explain this' },
    ],
  } as const;
  const writes: Array<readonly { name: string; description?: string; template: string }[]> = [];
  const { getRuntimeKey } = await import('@/lib/runtime-switch');
  useWorkspacesStore.setState({
    runtimeKey: getRuntimeKey(),
    catalog: { version: 1, workspaces: [original] },
    status: 'ready',
    update: async (id, patch) => {
      const current = useWorkspacesStore.getState().catalog.workspaces.find((entry) => entry.id === id);
      if (!current) return { kind: 'retained', reason: 'missing' };
      const updated = { ...current, ...patch };
      writes.push(updated.commands ?? []);
      useWorkspacesStore.setState({ catalog: { version: 1, workspaces: [updated] } });
      return { kind: 'saved' };
    },
  });
  useCommandSettingsScope.setState({ workspaceId: original.id, commandName: 'review' });
  await act(async () => root.render(<I18nProvider><WorkspaceCommandsPage workspace={original} /></I18nProvider>));

  const textareas = container.querySelectorAll<HTMLTextAreaElement>('textarea');
  expect(textareas).toHaveLength(2);
  expect(container.textContent).toContain('$ARGUMENTS');
  expect(container.textContent).not.toContain('Override agent');
  expect(container.textContent).not.toContain('Override model');
  const prompt = textareas[1];
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('Missing native textarea setter');
  await act(async () => {
    setValue.call(prompt, 'Review $ARGUMENTS carefully');
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    prompt.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual([
    { name: 'review', description: 'Review this', template: 'Review $ARGUMENTS carefully' },
    { name: 'explain', template: 'Explain this' },
  ]);

  const updatedWorkspace = useWorkspacesStore.getState().catalog.workspaces[0];
  if (!updatedWorkspace) throw new Error('Missing updated workspace');
  await act(async () => useCommandSettingsScope.setState({ commandName: 'new-command' }));
  await act(async () => root.render(<I18nProvider><WorkspaceCommandsPage workspace={updatedWorkspace} /></I18nProvider>));
  const nameInput = container.querySelector<HTMLInputElement>('input');
  const templateInput = container.querySelectorAll<HTMLTextAreaElement>('textarea')[1];
  const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!nameInput || !setInputValue || !setValue) throw new Error('Missing workspace command creation fields');
  await act(async () => {
    setInputValue.call(nameInput, 'summarize');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    setValue.call(templateInput, 'Summarize $ARGUMENTS');
    templateInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const create = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Create');
  expect(create).not.toBeNull();
  await act(async () => {
    create?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual([
    { name: 'review', description: 'Review this', template: 'Review $ARGUMENTS carefully' },
    { name: 'explain', template: 'Explain this' },
    { name: 'summarize', template: 'Summarize $ARGUMENTS' },
  ]);

  const createdWorkspace = useWorkspacesStore.getState().catalog.workspaces[0];
  if (!createdWorkspace) throw new Error('Missing created workspace');
  await act(async () => root.render(<ThemeSystemProvider><I18nProvider><WorkspaceCommandsSidebar workspace={createdWorkspace} /></I18nProvider></ThemeSystemProvider>));
  const deleteButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label="Delete"]'));
  expect(deleteButtons).toHaveLength(3);
  await act(async () => deleteButtons[0]?.click());
  const confirmDialog = document.querySelector('[role="dialog"]');
  const confirm = Array.from(confirmDialog?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((button) => button.textContent === 'Delete');
  expect(confirm).not.toBeNull();
  await act(async () => {
    confirm?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(useWorkspacesStore.getState().catalog.workspaces[0]?.commands).toEqual([
    { name: 'explain', template: 'Explain this' },
    { name: 'summarize', template: 'Summarize $ARGUMENTS' },
  ]);
});
