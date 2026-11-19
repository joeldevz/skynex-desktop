import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import { VoiceSettings } from './VoiceSettings';
import { useVoiceSettingsTabStore, voiceSettingsTabForSearchTarget } from './voiceSettingsTabs';

test('Voice settings start on playback and reveal dictation on tab selection', async () => {
    const windowInstance = new Window();
    const globals = {
        window: windowInstance,
        document: windowInstance.document,
        HTMLElement: windowInstance.HTMLElement,
        Element: windowInstance.Element,
        Node: windowInstance.Node,
        ResizeObserver: windowInstance.ResizeObserver,
        requestAnimationFrame: windowInstance.requestAnimationFrame.bind(windowInstance),
        cancelAnimationFrame: windowInstance.cancelAnimationFrame.bind(windowInstance),
        localStorage: windowInstance.localStorage,
        sessionStorage: windowInstance.sessionStorage,
        IS_REACT_ACT_ENVIRONMENT: true,
        fetch: async () => new Response(null, { status: 404 }),
    };
    const descriptors = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    Object.assign(globalThis, globals);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<I18nProvider><VoiceSettings /></I18nProvider>));
        expect(host.querySelector('[data-settings-item="voice.playback"]')).not.toBeNull();
        expect(host.querySelector('[data-settings-item="voice.speech-recognition"]')).toBeNull();

        const dictation = [...host.querySelectorAll<HTMLElement>('[role="tab"]')]
            .find((element) => element.textContent?.trim() === 'Dictation');
        expect(dictation).toBeDefined();
        await act(async () => dictation?.click());
        expect(host.querySelector('[data-settings-item="voice.playback"]')).toBeNull();
        expect(host.querySelector('[data-settings-item="voice.speech-recognition"]')).not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        useVoiceSettingsTabStore.getState().setTab('playback');
        await windowInstance.happyDOM.close();
        for (const [name, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    }
});

test('Voice settings search targets resolve to their corresponding tabs', () => {
    expect(voiceSettingsTabForSearchTarget('voice.playback')).toBe('playback');
    expect(voiceSettingsTabForSearchTarget('voice.auto-read-aloud')).toBe('playback');
    expect(voiceSettingsTabForSearchTarget('voice.speech-recognition')).toBe('dictation');
    expect(voiceSettingsTabForSearchTarget('chat.messages')).toBeNull();
});
