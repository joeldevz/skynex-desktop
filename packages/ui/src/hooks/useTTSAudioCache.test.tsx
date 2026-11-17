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
    const path = new URL(url, 'http://localhost').pathname;
    if (path.endsWith('/session')) return Response.json({ data: [], nextCursor: null });
    if (path.endsWith('/api/voice/keys')) {
        return Response.json({ openai: false, openaiCompatible: false, stt: false });
    }
    return Response.json({ homeDirectory: '/test', directory: '/test', project: { directory: '/test' } });
};
const [{ useServerTTS }, { useSayTTS }, cache] = await Promise.all([
    import('./useServerTTS'),
    import('./useSayTTS'),
    import('@/lib/voice/playbackCache'),
]);

type ServerHook = ReturnType<typeof useServerTTS>;
type SayHook = ReturnType<typeof useSayTTS>;
type Source = { onended: (() => void) | null; start: () => void; stop: () => void; connect: () => void; buffer: unknown };

let root: Root;
let server: ServerHook | undefined;
let say: SayHook | undefined;
let requests = 0;
let starts = 0;
let sources: Source[] = [];
let failNextAudioRequest = false;
let deferDecode = false;
let resolveDecodeEntered: (() => void) | undefined;
let releaseDecode: (() => void) | undefined;
let decodeEntered: Promise<void>;

const Probe = () => {
    server = useServerTTS();
    say = useSayTTS();
    return null;
};

class TestAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    async resume() {}
    createBuffer() { return { duration: 0, length: 1, numberOfChannels: 1 }; }
    async decodeAudioData() {
        if (deferDecode) {
            resolveDecodeEntered?.();
            await new Promise<void>((resolve) => { releaseDecode = resolve; });
        }
        return { duration: 1, length: 4, numberOfChannels: 1 };
    }
    createGain() { return { gain: { value: 1 }, connect: () => {} }; }
    createBufferSource() {
        const source: Source = {
            onended: null,
            buffer: null,
            connect: () => {},
            start: () => {
                if (typeof source.buffer === 'object' && source.buffer !== null
                    && 'duration' in source.buffer && source.buffer.duration === 1) starts += 1;
            },
            stop: () => {},
        };
        sources.push(source);
        return source;
    }
}

beforeEach(async () => {
    requests = 0;
    starts = 0;
    sources = [];
    failNextAudioRequest = false;
    deferDecode = false;
    resolveDecodeEntered = undefined;
    releaseDecode = undefined;
    decodeEntered = new Promise<void>((resolve) => { resolveDecodeEntered = resolve; });
    cache.audioPlaybackCache.clear();
    Object.assign(window, { AudioContext: TestAudioContext });
    globalThis.fetch = async (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        const path = new URL(url, 'http://localhost').pathname;
        if (path.endsWith('/session')) return Response.json({ data: [] });
        if (path.endsWith('/api/voice/keys')) {
            return Response.json({ openai: false, openaiCompatible: false, stt: false });
        }
        if (url.includes('/api/tts/speak') || url.includes('/api/tts/say/speak')) {
            requests += 1;
            if (failNextAudioRequest) {
                failNextAudioRequest = false;
                return Response.json({ error: 'synthesis failed' }, { status: 500 });
            }
            return new Response(new Uint8Array([1, 2, 3]));
        }
        return Response.json({ available: true, voices: [] });
    };
    root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Probe />));
});

afterEach(async () => {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
});

afterAll(() => {
    dom.happyDOM.close();
});

describe('provider audio cache', () => {
    test('server and Say replay cached audio while starting a new playback each time', async () => {
        for (const provider of ['server', 'say'] as const) {
            const speak = provider === 'server'
                ? (text: string) => server?.speak(text, { cacheKey: `manual:${provider}` })
                : (text: string) => say?.speak(text, { cacheKey: `manual:${provider}` });
            const beforeRequests = requests;
            await act(async () => { await speak('Same concise source.'); });
            await act(async () => sources.at(-1)?.onended?.());
            await act(async () => { await speak('Same concise source.'); });
            await act(async () => sources.at(-1)?.onended?.());
            expect(requests - beforeRequests).toBe(1);
        }
        expect(starts).toBe(4);
        expect(cache.audioPlaybackCache.size).toBeGreaterThan(0);
        cache.summaryPlaybackCache.set('summary', 'cached');
        const oldEpoch = cache.getPlaybackCacheEpoch();
        window.dispatchEvent(new CustomEvent('openchamber:runtime-endpoint-changed'));
        expect(cache.getPlaybackCacheEpoch()).toBe(oldEpoch + 1);
        expect(cache.audioPlaybackCache.size).toBe(0);
        expect(cache.summaryPlaybackCache.get('summary')).toBeUndefined();
    });

    test('failed and cancelled audio synthesis never seeds the cache', async () => {
        failNextAudioRequest = true;
        await act(async () => {
            await say?.speak('Failed synthesis.', { cacheKey: 'failed' });
        });
        expect(cache.audioPlaybackCache.size).toBe(0);

        let pending: Promise<void> | undefined;
        deferDecode = true;
        await act(async () => {
            pending = say?.speak('Cancelled decode.', { cacheKey: 'cancelled' });
            await decodeEntered;
        });
        expect(requests).toBe(2);
        await act(async () => {
            say?.stop();
            deferDecode = false;
            releaseDecode?.();
            await pending;
        });
        expect(cache.audioPlaybackCache.size).toBe(0);
        await act(async () => { await say?.speak('Cancelled decode.', { cacheKey: 'cancelled' }); });
        expect(requests).toBe(3);
        expect(cache.audioPlaybackCache.size).toBe(1);

        deferDecode = true;
        decodeEntered = new Promise<void>((resolve) => { resolveDecodeEntered = resolve; });
        let runtimePending: Promise<void> | undefined;
        await act(async () => {
            runtimePending = say?.speak('Runtime changed during decode.', { cacheKey: 'runtime-pending' });
            await decodeEntered;
        });
        await act(async () => {
            window.dispatchEvent(new CustomEvent('openchamber:runtime-endpoint-changed'));
            deferDecode = false;
            releaseDecode?.();
            await runtimePending;
        });
        await act(async () => sources.at(-1)?.onended?.());
        expect(requests).toBe(4);
        expect(cache.audioPlaybackCache.size).toBe(0);
    });

    test('provider playback without a manual cache key synthesizes every time', async () => {
        await act(async () => { await server?.speak('Uncached full read.'); });
        await act(async () => sources.at(-1)?.onended?.());
        await act(async () => { await server?.speak('Uncached full read.'); });
        await act(async () => sources.at(-1)?.onended?.());
        expect(requests).toBe(2);
        expect(cache.audioPlaybackCache.size).toBe(0);
    });
});
