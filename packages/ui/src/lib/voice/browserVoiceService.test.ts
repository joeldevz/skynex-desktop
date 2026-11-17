import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { browserVoiceService } from './browserVoiceService';

class FakeUtterance {
    static latest: FakeUtterance | null = null;

    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: SpeechSynthesisVoice | null = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;

    constructor(readonly text: string) {
        FakeUtterance.latest = this;
    }
}

const originalResumeAudioContext = browserVoiceService.resumeAudioContext;
let originalWindowDescriptor: PropertyDescriptor | undefined;
let originalUtteranceDescriptor: PropertyDescriptor | undefined;
let speakCount = 0;
let cancelCount = 0;

const voice = {
    default: true,
    lang: 'en-US',
    localService: true,
    name: 'Test voice',
    voiceURI: 'test-voice',
} satisfies SpeechSynthesisVoice;

function latestUtterance(): FakeUtterance {
    const utterance = FakeUtterance.latest;
    if (!utterance) throw new Error('Expected a speech utterance');
    return utterance;
}

beforeEach(() => {
    speakCount = 0;
    cancelCount = 0;
    FakeUtterance.latest = null;
    originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    originalUtteranceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'SpeechSynthesisUtterance');

    browserVoiceService.resumeAudioContext = async () => {};
    Object.assign(globalThis, {
        window: {
            speechSynthesis: {
                cancel: () => { cancelCount += 1; },
                getVoices: () => [voice],
                onvoiceschanged: null,
                speak: () => { speakCount += 1; },
            },
        },
    });
    Object.assign(globalThis, { SpeechSynthesisUtterance: FakeUtterance });
});

afterEach(() => {
    browserVoiceService.resumeAudioContext = originalResumeAudioContext;
    if (originalWindowDescriptor) {
        Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
        Reflect.deleteProperty(globalThis, 'window');
    }
    if (originalUtteranceDescriptor) {
        Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', originalUtteranceDescriptor);
    } else {
        Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance');
    }
});

describe('browserVoiceService.speakText', () => {
    test('rejects when voice discovery returns no voices without speaking', async () => {
        window.speechSynthesis.getVoices = () => [];

        await expect(browserVoiceService.speakText('Hello', 'en-US')).rejects.toThrow(
            'No browser speech voices are available',
        );
        expect(speakCount).toBe(0);
    });

    test('resolves on start, calls onEnd on completion, and clears the startup deadline', async () => {
        let endCount = 0;
        const playback = browserVoiceService.speakText('Hello', 'en-US', () => { endCount += 1; });

        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(speakCount).toBe(1);
        latestUtterance().onstart?.();
        expect(await playback).toBe(undefined);

        await new Promise((resolve) => setTimeout(resolve, 2050));
        expect(cancelCount).toBe(1);

        latestUtterance().onend?.();
        expect(endCount).toBe(1);
    });

    test('rejects a synthesis error that arrives before playback starts', async () => {
        const playback = browserVoiceService.speakText('Hello', 'en-US');

        await new Promise((resolve) => setTimeout(resolve, 60));
        latestUtterance().onerror?.({ error: 'network' });
        await expect(playback).rejects.toThrow('Speech synthesis error: network');
    });

    test('rejects and cancels when the browser never starts playback', async () => {
        const playback = browserVoiceService.speakText('Hello', 'en-US');

        await new Promise((resolve) => setTimeout(resolve, 60));
        await expect(playback).rejects.toThrow('Browser speech did not start');

        expect(cancelCount).toBe(2);
        expect(latestUtterance().onstart).toBeNull();
        expect(latestUtterance().onend).toBeNull();
        expect(latestUtterance().onerror).toBeNull();
    });

    test('reports a synthesis error through onError after playback has started', async () => {
        const errors: string[] = [];
        const playback = browserVoiceService.speakText('Hello', 'en-US', undefined, {
            onError: (error) => { errors.push(error); },
        });

        await new Promise((resolve) => setTimeout(resolve, 60));
        latestUtterance().onstart?.();
        expect(await playback).toBe(undefined);
        latestUtterance().onerror?.({ error: 'network' });

        expect(errors).toEqual(['Speech synthesis error: network']);
    });

    test('a cancelled startup deadline cannot cancel a replacement reading', async () => {
        const first = browserVoiceService.speakText('Stalled reply', 'en-US');
        const cancelled = first.then(
            () => 'started',
            (error: Error) => error.message,
        );
        await new Promise((resolve) => setTimeout(resolve, 60));
        browserVoiceService.cancelSpeech();
        expect(await cancelled).toBe('Speech was cancelled');

        let finished = 0;
        const second = browserVoiceService.speakText('New reply', 'en-US', () => { finished += 1; });
        await new Promise((resolve) => setTimeout(resolve, 60));
        latestUtterance().onstart?.();
        await second;
        const cancellationsAtStart = cancelCount;
        await new Promise((resolve) => setTimeout(resolve, 2050));
        expect(cancelCount).toBe(cancellationsAtStart);
        latestUtterance().onend?.();
        expect(finished).toBe(1);
    });

    test('a stopped request awaiting audio setup cannot replace newer speech', async () => {
        const resumes: Array<() => void> = [];
        browserVoiceService.resumeAudioContext = () => new Promise<void>((resolve) => { resumes.push(resolve); });
        const first = browserVoiceService.speakText('Old reply', 'en-US');
        const cancelled = first.then(
            () => 'started',
            (error: Error) => error.message,
        );
        browserVoiceService.cancelSpeech();
        const second = browserVoiceService.speakText('New reply', 'en-US');
        resumes[1]?.();
        await new Promise((resolve) => setTimeout(resolve, 60));
        latestUtterance().onstart?.();
        await second;

        const cancellationsAtStart = cancelCount;
        resumes[0]?.();
        expect(await cancelled).toBe('Speech was cancelled');
        expect(speakCount).toBe(1);
        expect(cancelCount).toBe(cancellationsAtStart);
        latestUtterance().onend?.();
    });

    test('does not substitute another voice when the selected voice is required', async () => {
        await expect(browserVoiceService.speakText('Hello', 'en-US', undefined, {
            voiceName: 'Missing selected voice',
            requireVoice: true,
        })).rejects.toThrow('The selected browser speech voice is unavailable');
        expect(speakCount).toBe(0);
    });

    test('uses the selected voice even when a different voice matches the language', async () => {
        const selectedVoice = { ...voice, name: 'Selected voice', lang: 'es' };
        window.speechSynthesis.getVoices = () => [voice, selectedVoice];
        const playback = browserVoiceService.speakText('Hello', 'en-US', undefined, {
            voiceName: selectedVoice.name,
            requireVoice: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(latestUtterance().voice).toBe(selectedVoice);
        latestUtterance().onstart?.();
        await playback;
        latestUtterance().onend?.();
    });
});
