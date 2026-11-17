import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const dom = new Window({ url: 'http://localhost' });
Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
});

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/session')) return Response.json({ data: [] });
    return Response.json({ directory: '/test', project: { directory: '/test' } });
};

const [{ useServerTTS }, { useSayTTS }, { useConfigStore }] = await Promise.all([
    import('./useServerTTS'),
    import('./useSayTTS'),
    import('@/stores/useConfigStore'),
]);

type ServerTTS = ReturnType<typeof useServerTTS>;
type SayTTS = ReturnType<typeof useSayTTS>;

type Phase = 'resume' | 'decode';
type HookName = 'server' | 'say';

let root: Root;
let server: ServerTTS | undefined;
let say: SayTTS | undefined;
let originalFetch: typeof globalThis.fetch;
let phase: Phase = 'resume';
let contextState: 'running' | 'suspended' = 'suspended';
let pendingEntered: (() => void) | undefined;
let releasePending: (() => void) | undefined;
let enteredPending: Promise<void>;
let speechStarts = 0;
let onStarts = 0;
let onEnds = 0;
let onErrors = 0;
let sourceId = 0;
let deferEachDecode = false;
let decodePreparations: Array<{
    entered: Promise<void>;
    release: () => void;
}> = [];
let decodeWaiters: Array<(() => void) | undefined> = [];
let speechSources: Array<{ bufferId: number; stopCalls: number }> = [];

const Probe = () => {
    server = useServerTTS();
    say = useSayTTS();
    return null;
};

const fetchUrl = (input: RequestInfo | URL) =>
    input instanceof Request ? input.url : input.toString();

class TestAudioContext {
    get state() { return contextState; }
    currentTime = 0;
    destination = {};

    resume() {
        pendingEntered?.();
        return new Promise<void>((resolve) => {
            releasePending = () => {
                resolve();
            };
        });
    }

    createBuffer() {
        return { duration: 0, id: ++sourceId };
    }

    decodeAudioData() {
        if (phase === 'resume') return Promise.resolve({ duration: 1, id: ++sourceId });
        if (deferEachDecode) {
            let markEntered: (() => void) | undefined;
            let resolveDecode: ((buffer: { duration: number; id: number }) => void) | undefined;
            const entered = new Promise<void>((resolve) => { markEntered = resolve; });
            const decoded = new Promise<{ duration: number; id: number }>((resolve) => { resolveDecode = resolve; });
            decodePreparations.push({
                entered,
                release: () => resolveDecode?.({ duration: 1, id: ++sourceId }),
            });
            decodeWaiters[decodePreparations.length - 1]?.();
            markEntered?.();
            return decoded;
        }
        pendingEntered?.();
        return new Promise<{ duration: number; id: number }>((resolve) => {
            releasePending = () => resolve({ duration: 1, id: ++sourceId });
        });
    }

    createBufferSource() {
        type TestAudioBufferSource = {
            buffer: { duration: number; id: number } | null;
            onended: (() => void) | null;
            connect: () => void;
            start: () => void;
            stop: () => void;
        };
        const source: TestAudioBufferSource = {
            buffer: null,
            onended: null,
            connect: () => {},
            start: () => {
                if (source.buffer?.duration === 1) {
                    speechStarts += 1;
                    speechSources.push({ bufferId: source.buffer.id, stopCalls: 0 });
                }
            },
            stop: () => {
                const record = speechSources.find(({ bufferId }) => bufferId === source.buffer?.id);
                if (record) record.stopCalls += 1;
            },
        };
        return source;
    }

    createGain() {
        return { gain: { value: 1 }, connect: () => {} };
    }
}

beforeEach(() => {
    originalFetch = globalThis.fetch;
    phase = 'resume';
    contextState = 'suspended';
    pendingEntered = undefined;
    releasePending = undefined;
    enteredPending = Promise.resolve();
    speechStarts = 0;
    onStarts = 0;
    onEnds = 0;
    onErrors = 0;
    sourceId = 0;
    deferEachDecode = false;
    decodePreparations = [];
    decodeWaiters = [];
    speechSources = [];
    Object.assign(window, { AudioContext: TestAudioContext });
    globalThis.fetch = async (input) => {
        const url = fetchUrl(input);
        const path = new URL(url, 'http://localhost').pathname;
        if (path.endsWith('/api/tts/status')) return Response.json({ available: true });
        if (path.endsWith('/api/tts/say/status')) return Response.json({ available: true, voices: [] });
        if (path.endsWith('/api/voice/keys')) {
            return Response.json({ openai: false, openaiCompatible: false, stt: false });
        }
        if (path.endsWith('/api/tts/speak') || path.endsWith('/api/tts/say/speak')) {
            return new Response(new Uint8Array([1, 2, 3]));
        }
        return Response.json({ directory: '/test', project: { directory: '/test' } });
    };
    useConfigStore.setState({
        voiceApiKeys: { openai: false, openaiCompatible: false, stt: false },
        openaiCompatibleUrl: '',
        ttsChunkedMode: false,
    });
    root = createRoot(document.createElement('div'));
    server = undefined;
    say = undefined;
});

afterEach(async () => {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
});

afterAll(() => {
    globalThis.fetch = nativeFetch;
    dom.happyDOM.close();
});

const getHook = (hook: HookName) => hook === 'server' ? server : say;

const runStoppedPreparation = async (hookName: HookName, pendingPhase: Phase) => {
    phase = pendingPhase;
    contextState = pendingPhase === 'resume' ? 'suspended' : 'running';
    enteredPending = new Promise<void>((resolve) => { pendingEntered = resolve; });
    await act(async () => root.render(<Probe />));

    let request: Promise<void> | undefined;
    await act(async () => {
        request = getHook(hookName)?.speak('A short test reply.', {
            onStart: () => { onStarts += 1; },
        });
        await enteredPending;
    });

    await act(async () => getHook(hookName)?.stop());
    releasePending?.();
    await act(async () => request);

    expect({ speechStarts, onStarts }).toEqual({ speechStarts: 0, onStarts: 0 });
};

describe('TTS preparation cancellation', () => {
    for (const hook of ['server', 'say'] as const) {
        test(`${hook} Stop during AudioContext.resume prevents speech and onStart`, async () => {
            await runStoppedPreparation(hook, 'resume');
        });

        test(`${hook} Stop during decodeAudioData prevents speech and onStart`, async () => {
            await runStoppedPreparation(hook, 'decode');
        });

        test(`${hook} late stopped A cannot start over or clear ownership of current B`, async () => {
            phase = 'decode';
            contextState = 'running';
            deferEachDecode = true;
            await act(async () => root.render(<Probe />));

            let requestA: Promise<void> | undefined;
            const aDecodeEntered = new Promise<void>((resolve) => { decodeWaiters[0] = resolve; });
            await act(async () => {
                requestA = getHook(hook)?.speak('Reply A.', {
                    onStart: () => { onStarts += 1; },
                    onEnd: () => { onEnds += 1; },
                    onError: () => { onErrors += 1; },
                });
                await aDecodeEntered;
            });
            await act(async () => getHook(hook)?.stop());

            let requestB: Promise<void> | undefined;
            const bDecodeEntered = new Promise<void>((resolve) => { decodeWaiters[1] = resolve; });
            await act(async () => {
                requestB = getHook(hook)?.speak('Reply B.', {
                    onStart: () => { onStarts += 1; },
                    onEnd: () => { onEnds += 1; },
                    onError: () => { onErrors += 1; },
                });
                await bDecodeEntered;
            });
            const bPreparation = decodePreparations[1];
            bPreparation?.release();
            await act(async () => requestB);
            const bSource = speechSources[0];

            decodePreparations[0]?.release();
            await act(async () => requestA);
            await act(async () => getHook(hook)?.stop());

            expect({
                speechStarts,
                onStarts,
                onEnds,
                onErrors,
                bSourceStopCalls: bSource?.stopCalls,
            }).toEqual({
                speechStarts: 1,
                onStarts: 1,
                onEnds: 0,
                onErrors: 0,
                bSourceStopCalls: 1,
            });
        });
    }
});
