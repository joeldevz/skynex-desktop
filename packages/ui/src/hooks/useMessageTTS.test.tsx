import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';

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
    if (new URL(url, 'http://localhost').pathname.endsWith('/session')) {
        return Response.json({ data: [] });
    }
    return Response.json({ directory: '/test', project: { directory: '/test' } });
};

const [{ useMessageTTS }, { useConfigStore }, { browserVoiceService }, { I18nProvider }, playbackCache] = await Promise.all([
    import('./useMessageTTS'),
    import('@/stores/useConfigStore'),
    import('@/lib/voice/browserVoiceService'),
    import('@/lib/i18n'),
    import('@/lib/voice/playbackCache'),
]);

type MessageTTS = ReturnType<typeof useMessageTTS>;
let root: Root;
let playback: MessageTTS | undefined;
let observer: MessageTTS | undefined;
let originalFetch: typeof globalThis.fetch;
let fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
let resolveFetchStarted: (() => void) | undefined;
let fetchStarted: Promise<void>;
let speakText: ReturnType<typeof spyOn>;
let waitForVoices: ReturnType<typeof spyOn>;
let resumeAudioContext: ReturnType<typeof spyOn>;
let playbackErrors: Array<Parameters<typeof toast.error>[0]> = [];
let restoreToastError: () => void;

const Probe = () => {
    playback = useMessageTTS('test-reading', true);
    return null;
};

const Observer = () => {
    observer = useMessageTTS('test-reading', true);
    return null;
};

const mount = async () => {
    await act(async () => root.render(<I18nProvider><Probe /><Observer /></I18nProvider>));
};

const reply = (text: string, status = 200) => new Response(JSON.stringify({ text }), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const fetchUrl = (input: RequestInfo | URL) => input instanceof Request ? input.url : input.toString();
const summaryRequests = () => fetchCalls.filter(({ input }) => fetchUrl(input).includes('/api/small-model/generate'));

const play = async (text: string, options?: Parameters<MessageTTS['play']>[1]) => {
    await act(async () => playback?.play(text, options));
};

beforeEach(() => {
    playbackCache.summaryPlaybackCache.clear();
    playbackCache.audioPlaybackCache.clear();
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    fetchStarted = new Promise<void>((resolve) => { resolveFetchStarted = resolve; });
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ input, init });
        if (fetchUrl(input).includes('/api/small-model/generate')) resolveFetchStarted?.();
        return reply('A concise spoken summary.');
    };
    useConfigStore.setState({
        voiceProvider: 'browser',
        showMessageTTSButtons: false,
        autoReadAloudEnabled: false,
        ttsInputMode: 'raw',
    });
    speakText = spyOn(browserVoiceService, 'speakText').mockImplementation(async () => undefined);
    waitForVoices = spyOn(browserVoiceService, 'waitForVoices').mockResolvedValue([]);
    resumeAudioContext = spyOn(browserVoiceService, 'resumeAudioContext').mockResolvedValue(undefined);
    playbackErrors = [];
    const toastError = spyOn(toast, 'error');
    toastError.mockImplementation((message) => {
        playbackErrors.push(message);
        return 'test-toast';
    });
    restoreToastError = () => toastError.mockRestore();
    root = createRoot(document.createElement('div'));
    playback = undefined;
    observer = undefined;
});

afterEach(async () => {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    speakText.mockRestore();
    waitForVoices.mockRestore();
    resumeAudioContext.mockRestore();
    restoreToastError();
});

afterAll(() => {
    globalThis.fetch = nativeFetch;
    dom.happyDOM.close();
});

describe('useMessageTTS concise playback', () => {
    test('reuses the summary when the same reply is played again', async () => {
        await mount();
        await play('A repeated reply for cache measurement.', { summarize: 'concise' });
        await act(async () => playback?.stop());
        await play('A repeated reply for cache measurement.', { summarize: 'concise' });
        expect(summaryRequests()).toHaveLength(1);
        expect(speakText.mock.calls).toHaveLength(2);
    });

    test('expires manual summary reuse after thirty minutes', async () => {
        const now = 10_000;
        const clock = spyOn(Date, 'now');
        clock.mockImplementation(() => now);
        try {
            await mount();
            await play('A summary that expires.', { summarize: 'concise' });
            await act(async () => playback?.stop());
            clock.mockImplementation(() => now + 30 * 60 * 1000);
            await play('A summary that expires.', { summarize: 'concise' });
            expect(summaryRequests()).toHaveLength(2);
        } finally {
            clock.mockRestore();
        }
    });

    test('runtime endpoint changes clear caches and reject an in-flight summary write', async () => {
        let resolveFetch: ((response: Response) => void) | undefined;
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            fetchCalls.push({ input, init });
            if (fetchUrl(input).includes('/api/small-model/generate')) {
                resolveFetchStarted?.();
                if (summaryRequests().length === 1) return new Promise<Response>((resolve) => { resolveFetch = resolve; });
                return reply('Runtime scoped summary.');
            }
            return reply('response');
        };
        await mount();
        let pending: Promise<void> | undefined;
        await act(async () => {
            pending = playback?.play('Runtime scoped source.', { summarize: 'concise' });
            await fetchStarted;
        });
        expect(resolveFetch).toBeDefined();
        await act(async () => {
            window.dispatchEvent(new CustomEvent('openchamber:runtime-endpoint-changed'));
            resolveFetch?.(reply('Late runtime summary.'));
            await pending;
        });
        expect(summaryRequests()).toHaveLength(1);
        expect(speakText.mock.calls).toHaveLength(1);
        await act(async () => playback?.stop());
        await play('Runtime scoped source.', { summarize: 'concise' });
        expect(summaryRequests()).toHaveLength(2);
    });

    test('does not request a summary when the hook mounts', async () => {
        await mount();
        expect(summaryRequests()).toHaveLength(0);
    });

    test('summarizes short text on explicit concise playback, including raw mode', async () => {
        await mount();
        await play('A short original reply.', { summarize: 'concise' });

        const request = summaryRequests()[0];
        expect(summaryRequests()).toHaveLength(1);
        expect(playback?.isPreparing).toBe(false);
        expect(observer?.isPreparing).toBe(false);
        expect(request && fetchUrl(request.input)).toContain('/api/small-model/generate');
        const requestBody = request?.input instanceof Request
            ? await request.input.clone().json()
            : JSON.parse(String(request?.init?.body));
        expect(requestBody).toMatchObject({
            prompt: 'A short original reply.',
        });
        expect(speakText.mock.calls).toHaveLength(1);
        expect(speakText.mock.calls[0]?.[0]).toBe('A concise spoken summary.');
    });

    test('does not fall back to the full reply for empty, unavailable, or failed summaries', async () => {
        await mount();
        const outcomes: Array<Response | Error> = [
            reply('', 200),
            reply('', 404),
            new Error('Network unavailable'),
        ];
        for (const outcome of outcomes) {
            globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
                fetchCalls.push({ input, init });
                if (outcome instanceof Error) throw outcome;
                return outcome;
            };
            await play('The complete reply must not be read.', { summarize: 'concise' });
        }

        expect(summaryRequests()).toHaveLength(3);
        expect(speakText.mock.calls).toHaveLength(0);
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            fetchCalls.push({ input, init });
            return reply('Recovered summary.');
        };
        await play('The complete reply must not be read.', { summarize: 'concise' });
        expect(summaryRequests()).toHaveLength(4);
        expect(speakText.mock.calls).toHaveLength(1);
    });

    test('stopping aborts pending summary work and its late response cannot play', async () => {
        let resolveFetch: ((response: Response) => void) | undefined;
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            fetchCalls.push({ input, init });
            if (fetchUrl(input).includes('/api/small-model/generate')) resolveFetchStarted?.();
            return new Promise<Response>((resolve) => { resolveFetch = resolve; });
        };
        await mount();

        let request: Promise<void> | undefined;
        await act(async () => {
            request = playback?.play('Pending reply.', { summarize: 'concise' });
            await fetchStarted;
        });
        const summaryRequest = summaryRequests()[0];
        expect(summaryRequests()).toHaveLength(1);
        expect(playback?.isPreparing).toBe(true);
        expect(observer?.isPreparing).toBe(true);
        const signal = summaryRequest?.input instanceof Request
            ? summaryRequest.input.signal
            : summaryRequest?.init?.signal;
        expect(signal).toBeInstanceOf(AbortSignal);

        await act(async () => observer?.stop());
        expect(signal?.aborted).toBe(true);
        expect(playback?.isPreparing).toBe(false);
        resolveFetch?.(reply('Late summary.'));
            await act(async () => request);

            expect(speakText.mock.calls).toHaveLength(0);
            globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
                fetchCalls.push({ input, init });
                return reply('Recovered after cancellation.');
            };
            await play('Pending reply.', { summarize: 'concise' });
            expect(summaryRequests()).toHaveLength(2);
            expect(speakText.mock.calls).toHaveLength(1);
    });

    test('ordinary playback reads a long reply without requesting a summary', async () => {
        await mount();
        const text = 'Read this full reply aloud. '.repeat(30).trim();
        await play(text);

        expect(summaryRequests()).toHaveLength(0);
        expect(speakText.mock.calls[0]?.[0]).toBe(text);
    });

    test('shows a playback error and exits the reading state for both reading modes', async () => {
        speakText.mockRejectedValue(new Error('No browser speech voices are available'));
        await mount();
        for (const summarize of [undefined, 'concise'] as const) {
            playbackErrors = [];
            await play('A reply to read.', { summarize });
            expect(playback?.isPlaying).toBe(false);
            expect(playbackErrors).toHaveLength(1);
            expect(playbackErrors[0]).toBe('Voice playback failed. Check Settings → Voice and the speech voices installed on your system.');
        }
    });

    test('reports errors after speech started but ignores them after a stop', async () => {
        let options: Parameters<typeof browserVoiceService.speakText>[3];
        speakText.mockRestore();
        const playbackSpy = spyOn(browserVoiceService, 'speakText');
        playbackSpy.mockImplementation(async (...args: Parameters<typeof browserVoiceService.speakText>) => {
            options = args[3];
        });
        await mount();
        await play('Started reply.');
        expect(playback?.isPlaying).toBe(true);
        await act(async () => options?.onError?.('audio-hardware'));
        expect(playback?.isPlaying).toBe(false);
        expect(playbackErrors).toHaveLength(1);

        playbackErrors = [];
        await play('Stopped reply.');
        await act(async () => playback?.stop());
        await act(async () => options?.onError?.('interrupted'));
        expect(playbackErrors).toHaveLength(0);
        playbackSpy.mockRestore();
    });

    test('keeps both controls preparing until browser speech actually starts', async () => {
        let releaseStart: (() => void) | undefined;
        let entered: (() => void) | undefined;
        const entering = new Promise<void>((resolve) => { entered = resolve; });
        speakText.mockRestore();
        const pendingSpeech = spyOn(browserVoiceService, 'speakText');
        pendingSpeech.mockImplementation(() => {
            entered?.();
            return new Promise<void>((resolve) => { releaseStart = resolve; });
        });
        await mount();
        let request: Promise<void> | undefined;
        await act(async () => {
            request = playback?.play('Short reply.', { summarize: 'concise' });
            await entering;
        });
        expect(playback?.isPreparing).toBe(true);
        expect(observer?.isPreparing).toBe(true);
        await act(async () => {
            releaseStart?.();
            await request;
        });
        expect(playback?.isPreparing).toBe(false);
        expect(observer?.isPreparing).toBe(false);
        expect(playback?.isPlaying).toBe(true);
        pendingSpeech.mockRestore();
    });

    test('an unavailable selected server voice does not fall back or generate a summary', async () => {
        useConfigStore.setState({ voiceProvider: 'openai' });
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            fetchCalls.push({ input, init });
            return Response.json({ available: false, openai: false, openaiCompatible: false, stt: false });
        };
        await mount();
        await play('A reply.', { summarize: 'concise' });
        expect(summaryRequests()).toHaveLength(0);
        expect(speakText.mock.calls).toHaveLength(0);
        expect(playbackErrors).toHaveLength(1);
        expect(playback?.isPreparing).toBe(false);
        expect(playback?.isPlaying).toBe(false);
    });

    test('a late start from replaced speech cannot end preparation of the new reading', async () => {
        const releases: Array<() => void> = [];
        let entered: (() => void) | undefined;
        speakText.mockRestore();
        const pendingSpeech = spyOn(browserVoiceService, 'speakText');
        pendingSpeech.mockImplementation(() => {
            entered?.();
            return new Promise<void>((resolve) => { releases.push(resolve); });
        });
        await mount();
        let first: Promise<void> | undefined;
        const firstQueued = new Promise<void>((resolve) => { entered = resolve; });
        await act(async () => {
            first = playback?.play('First.');
            await firstQueued;
        });
        let second: Promise<void> | undefined;
        const secondQueued = new Promise<void>((resolve) => { entered = resolve; });
        await act(async () => {
            second = playback?.play('Second.');
            await secondQueued;
        });
        await act(async () => { releases[0]?.(); await first; });
        expect(observer?.isPreparing).toBe(true);
        await act(async () => { releases[1]?.(); await second; });
        expect(observer?.isPreparing).toBe(false);
        pendingSpeech.mockRestore();
    });

    test('uses the selected local model and speaker, preparing until decoded audio starts', async () => {
        useConfigStore.setState({
            voiceProvider: 'local',
            localTtsModelId: 'piper-es_ES-davefx-medium',
            localTtsVoiceId: 0,
            ttsFollowTextLanguage: true,
        });
        let releaseAudio: ((response: Response) => void) | undefined;
        let requestedAudio: (() => void) | undefined;
        const audioRequest = new Promise<void>((resolve) => { requestedAudio = resolve; });
        let startedAudio: (() => void) | undefined;
        const audioStart = new Promise<void>((resolve) => { startedAudio = resolve; });
        let finishAudio: (() => void) | undefined;
        let audioRequests = 0;
        class TestAudioContext {
            state = 'running';
            destination = {};
            async decodeAudioData() { return { duration: 1, length: 4, numberOfChannels: 1 }; }
            createBufferSource() {
                type TestAudioBufferSource = { buffer: { duration: number } | null; onended: (() => void) | null; connect: () => void; start: () => void; stop: () => void };
                const source: TestAudioBufferSource = {
                    buffer: null,
                    onended: null,
                    connect: () => {},
                    start: () => {
                        finishAudio = () => source.onended?.();
                        startedAudio?.();
                    },
                    stop: () => {},
                };
                return source;
            }
        }
        const previousContext = Object.getOwnPropertyDescriptor(window, 'AudioContext');
        Object.assign(window, { AudioContext: TestAudioContext });
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            fetchCalls.push({ input, init });
            if (fetchUrl(input).includes('/api/dictation/tts/speak')) {
                audioRequests += 1;
                requestedAudio?.();
                if (audioRequests > 1) return new Response(new Uint8Array([1, 2]));
                return new Promise<Response>((resolve) => { releaseAudio = resolve; });
            }
            return reply('Ya terminé los cambios.');
        };
        try {
            await mount();
            let request: Promise<void> | undefined;
            await act(async () => {
                request = playback?.play('A reply.', { summarize: 'concise' });
                await audioRequest;
            });
            expect(playback?.isPreparing).toBe(true);
            expect(observer?.isPreparing).toBe(true);
            const localRequest = fetchCalls.find(({ input }) => fetchUrl(input).includes('/api/dictation/tts/speak'));
            const body = localRequest?.input instanceof Request
                ? await localRequest.input.clone().json()
                : JSON.parse(String(localRequest?.init?.body));
            expect(body).toMatchObject({ model: 'piper-es_ES-davefx-medium', speakerId: 0 });
            expect(body.language).toBe(undefined);
            expect(body.languageSample).toBe(undefined);
            expect(speakText.mock.calls).toHaveLength(0);
            await act(async () => {
                releaseAudio?.(new Response(new Uint8Array([1, 2])));
                await audioStart;
            });
            expect(playback?.isPreparing).toBe(false);
            expect(observer?.isPreparing).toBe(false);
            expect(playback?.isPlaying).toBe(true);
            await act(async () => {
                finishAudio?.();
                await request;
            });
            expect(playback?.isPlaying).toBe(false);
            let replay: Promise<void> | undefined;
            await act(async () => {
                replay = playback?.play('A reply.', { summarize: 'concise' });
                await Promise.resolve();
            });
            expect(fetchCalls.filter(({ input }) => fetchUrl(input).includes('/api/dictation/tts/speak'))).toHaveLength(1);
            expect(summaryRequests()).toHaveLength(1);
            await act(async () => {
                finishAudio?.();
                await replay;
            });
            await act(async () => useConfigStore.setState({ speechRate: 1.5 }));
            let changedVoice: Promise<void> | undefined;
            await act(async () => {
                changedVoice = playback?.play('A reply.', { summarize: 'concise' });
                for (let index = 0; index < 8; index += 1) await Promise.resolve();
            });
            expect(audioRequests).toBe(2);
            expect(summaryRequests()).toHaveLength(1);
            await act(async () => {
                finishAudio?.();
                await changedVoice;
            });
            let changedText: Promise<void> | undefined;
            await act(async () => {
                changedText = playback?.play('A different reply.', { summarize: 'concise' });
                for (let index = 0; index < 8; index += 1) await Promise.resolve();
            });
            expect(audioRequests).toBe(3);
            expect(summaryRequests()).toHaveLength(2);
            await act(async () => {
                finishAudio?.();
                await changedText;
            });
            for (const change of [
                { localTtsModelId: 'piper-es_ES-new-medium' },
                { localTtsVoiceId: 1 },
                { speechRate: 1.8 },
            ]) {
                await act(async () => useConfigStore.setState(change));
                let changedConfigPlayback: Promise<void> | undefined;
                await act(async () => {
                    changedConfigPlayback = playback?.play('A different reply.', { summarize: 'concise' });
                    for (let index = 0; index < 8; index += 1) await Promise.resolve();
                });
                await act(async () => {
                    finishAudio?.();
                    await changedConfigPlayback;
                });
            }
            expect(audioRequests).toBe(6);
            expect(summaryRequests()).toHaveLength(2);
        } finally {
            if (previousContext) Object.defineProperty(window, 'AudioContext', previousContext);
            else Reflect.deleteProperty(window, 'AudioContext');
        }
    });
});
