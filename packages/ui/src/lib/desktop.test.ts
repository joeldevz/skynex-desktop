import { afterEach, describe, expect, test } from 'bun:test';

import { clearDesktopSessionNotifications, getDesktopProductAnalyticsSettings, setDesktopProductAnalyticsEnabled, isBrowserClientRuntime, isDesktopLocalOriginActive, openSessionInOwningHostWindow, recordDesktopFeature, recordDesktopProductInteraction, takePendingDesktopSessionLinks } from './desktop';

describe('desktop product analytics settings', () => {
  afterEach(() => { Reflect.deleteProperty(globalThis, 'window'); });

  test('reads and saves the preference even when analytics is unavailable', async () => {
    const calls: Array<{ command: string; args: { enabled?: boolean } }> = [];
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      location: { origin: 'openchamber-ui://app' },
      __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
      __OPENCHAMBER_LOCAL_ORIGIN__: 'http://127.0.0.1:51761',
      __OPENCHAMBER_API_BASE_URL__: 'http://127.0.0.1:51761',
      __OPENCHAMBER_DESKTOP__: { invoke: async (command: string, args: { enabled?: boolean }) => {
        calls.push({ command, args });
        return { enabled: command === 'desktop_get_product_analytics_settings', available: false };
      } },
    } });
    expect(await getDesktopProductAnalyticsSettings()).toEqual({ enabled: true, available: false });
    expect(await setDesktopProductAnalyticsEnabled(false)).toEqual({ enabled: false, available: false });
    expect(calls).toEqual([
      { command: 'desktop_get_product_analytics_settings', args: {} },
      { command: 'desktop_set_product_analytics_enabled', args: { enabled: false } },
    ]);
  });

  test('rejects remote desktop access before invoking the bridge', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      location: { origin: 'openchamber-ui://app' },
      __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
      __OPENCHAMBER_LOCAL_ORIGIN__: 'http://127.0.0.1:51761',
      __OPENCHAMBER_API_BASE_URL__: 'http://127.0.0.1:3000',
      __OPENCHAMBER_DESKTOP__: { invoke: () => { throw new Error('unexpected invoke'); } },
    } });
    await expect(getDesktopProductAnalyticsSettings()).rejects.toThrow('unavailable');
  });

  test('attributes interactions to the current runtime rather than the packaged page origin', () => {
    type InteractionArgs = { event: string } | { feature: string; action: string };
    const calls: Array<{ command: string; args: InteractionArgs }> = [];
    const localOrigin = 'http://127.0.0.1:51761';
    const renderer = {
      location: { origin: 'openchamber-ui://app' },
      __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
      __OPENCHAMBER_LOCAL_ORIGIN__: localOrigin,
      __OPENCHAMBER_API_BASE_URL__: localOrigin,
      __OPENCHAMBER_DESKTOP__: { invoke: async (command: string, args: InteractionArgs) => {
        calls.push({ command, args });
        return true;
      } },
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: renderer });

    recordDesktopProductInteraction('conversation_created');
    recordDesktopFeature('browser', 'opened');
    renderer.__OPENCHAMBER_API_BASE_URL__ = 'http://127.0.0.1:3000';
    recordDesktopProductInteraction('prompt_sent');
    recordDesktopFeature('chat', 'used');
    renderer.__OPENCHAMBER_API_BASE_URL__ = localOrigin;
    recordDesktopProductInteraction('prompt_sent');

    expect(calls).toEqual([
      { command: 'desktop_record_product_analytics_interaction', args: { event: 'conversation_created' } },
      { command: 'desktop_record_product_analytics_feature', args: { feature: 'browser', action: 'opened' } },
      { command: 'desktop_record_product_analytics_interaction', args: { event: 'prompt_sent' } },
    ]);
  });
});

describe('clearing session notifications', () => {
  const originalWindow = globalThis.window;
  afterEach(() => {
    globalThis.window = originalWindow;
  });

  const desktopWindow = (platform: string) => {
    const calls: Array<{ command: string; args: { sessionId?: string } }> = [];
    globalThis.window = Object.assign(Object.create(null), {
      __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
      __OPENCHAMBER_PLATFORM__: platform,
      __OPENCHAMBER_DESKTOP__: {
        invoke: async (command: string, args: { sessionId?: string }) => {
          calls.push({ command, args });
          return null;
        },
      },
    });
    return calls;
  };

  test('asks the macOS shell to remove the session notifications', () => {
    const calls = desktopWindow('darwin');
    clearDesktopSessionNotifications('ses_1');
    expect(calls).toEqual([{ command: 'desktop_clear_session_notifications', args: { sessionId: 'ses_1' } }]);
  });

  test('stays quiet where delivered notifications cannot be removed', () => {
    const calls = desktopWindow('win32');
    clearDesktopSessionNotifications('ses_1');
    expect(calls).toEqual([]);
  });
});

describe('browser client runtime', () => {
  test('uses browser file behavior only outside the Electron shell', () => {
    expect(isBrowserClientRuntime('web', false)).toBe(true);
    expect(isBrowserClientRuntime('web', true)).toBe(false);
  });

  test('keeps desktop and VS Code runtime behavior out of browser-only flows', () => {
    expect(isBrowserClientRuntime('desktop', false)).toBe(false);
    expect(isBrowserClientRuntime('vscode', false)).toBe(false);
  });
});

describe('desktop local origin', () => {
  // Bun test runner does not provide `window`.
  const installWindow = (options: { electron: boolean; localOrigin: string; apiBaseUrl: string }) => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { origin: 'openchamber-ui://app' },
        __OPENCHAMBER_ELECTRON__: options.electron ? { runtime: 'electron' } : undefined,
        __OPENCHAMBER_LOCAL_ORIGIN__: options.localOrigin,
        __OPENCHAMBER_API_BASE_URL__: options.apiBaseUrl,
      },
    });
  };

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  test("counts the desktop's own server as local", () => {
    installWindow({ electron: true, localOrigin: 'http://127.0.0.1:51761', apiBaseUrl: 'http://127.0.0.1:51761' });
    expect(isDesktopLocalOriginActive()).toBe(true);
  });

  test('counts the same port reached as localhost as local', () => {
    installWindow({ electron: true, localOrigin: 'http://127.0.0.1:51761', apiBaseUrl: 'http://localhost:51761' });
    expect(isDesktopLocalOriginActive()).toBe(true);
  });

  // A server in WSL or a container is reachable on loopback, but its files are
  // not on this machine: actions that hand a path to the local OS stay hidden.
  test('counts a server on another loopback port as remote', () => {
    installWindow({ electron: true, localOrigin: 'http://127.0.0.1:51761', apiBaseUrl: 'http://localhost:3000' });
    expect(isDesktopLocalOriginActive()).toBe(false);
  });

  test('is never local outside the desktop shell', () => {
    installWindow({ electron: false, localOrigin: 'http://127.0.0.1:51761', apiBaseUrl: 'http://127.0.0.1:51761' });
    expect(isDesktopLocalOriginActive()).toBe(false);
  });
});

describe('pending desktop session links', () => {
  type PendingLink = { sessionId: string; messageId?: string; runtimeKey?: string };

  const installWindow = (pending: PendingLink[]) => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { origin: 'openchamber-ui://app' },
        __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
        __OPENCHAMBER_LOCAL_ORIGIN__: 'http://127.0.0.1:51761',
        __OPENCHAMBER_API_BASE_URL__: 'http://127.0.0.1:51761',
        __OPENCHAMBER_DESKTOP__: { invoke: async () => pending },
      },
    });
  };

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  test('keep the runtime key of a link that names its host', async () => {
    installWindow([
      { sessionId: 'ses_a', runtimeKey: 'host:h1' },
      { sessionId: 'ses_b', messageId: 'msg_1' },
    ]);
    expect(await takePendingDesktopSessionLinks()).toEqual([
      { sessionId: 'ses_a', messageId: null, runtimeKey: 'host:h1' },
      { sessionId: 'ses_b', messageId: 'msg_1', runtimeKey: null },
    ]);
  });
});

describe('opening a session in its owning host window', () => {
  const installLocalWindow = () => {
    const calls: Array<{ command: string; args: Record<string, string> }> = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { origin: 'openchamber-ui://app' },
        __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
        __OPENCHAMBER_LOCAL_ORIGIN__: 'http://127.0.0.1:51761',
        __OPENCHAMBER_API_BASE_URL__: 'http://127.0.0.1:51761',
        __OPENCHAMBER_DESKTOP__: {
          invoke: async (command: string, args: Record<string, string>) => {
            calls.push({ command, args });
            return { opened: true };
          },
        },
      },
    });
    return calls;
  };

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  test('leaves a session of this window instance to the window', () => {
    const calls = installLocalWindow();
    expect(openSessionInOwningHostWindow('ses_a', 'local', 'msg_1')).toBe(false);
    expect(openSessionInOwningHostWindow('ses_a', null)).toBe(false);
    expect(calls).toEqual([]);
  });

  test('hands a session of another instance to its window with the message', () => {
    const calls = installLocalWindow();
    expect(openSessionInOwningHostWindow('ses_a', 'host:h1', 'msg_1')).toBe(true);
    expect(openSessionInOwningHostWindow('ses_b', 'host:h1')).toBe(true);
    expect(calls).toEqual([
      { command: 'desktop_open_host_session', args: { runtimeKey: 'host:h1', sessionId: 'ses_a', messageId: 'msg_1' } },
      { command: 'desktop_open_host_session', args: { runtimeKey: 'host:h1', sessionId: 'ses_b' } },
    ]);
  });
});
