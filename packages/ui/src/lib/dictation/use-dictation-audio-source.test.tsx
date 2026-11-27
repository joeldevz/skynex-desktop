import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDictationAudioSource, type DictationAudioSource } from './use-dictation-audio-source';

const dom = new Window({ url: 'http://localhost' });
Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
});

let audio: DictationAudioSource;
let root: Root;
let tracksStopped = 0;
let contexts = 0;
let graphs = 0;
let closes = 0;
let segments = 0;
let resolveMedia: (stream: MediaStream) => void;
let resolveResume: () => void;
let resumePending = false;

const stream = { getTracks: () => [{ stop: () => { tracksStopped += 1; } }] } as MediaStream;

class FakeAudioContext {
    state = 'suspended';
    constructor() { contexts += 1; }
    resume() {
        resumePending = true;
        return new Promise<void>((resolve) => { resolveResume = resolve; });
    }
    close() { closes += 1; return Promise.resolve(); }
    createMediaStreamSource() { graphs += 1; throw new Error('unexpected graph'); }
}

const Probe = () => {
    audio = useDictationAudioSource({ onPcmSegment: () => { segments += 1; } });
    return null;
};

async function setup() {
    tracksStopped = 0;
    contexts = 0;
    graphs = 0;
    closes = 0;
    segments = 0;
    resumePending = false;
    Object.defineProperty(dom, 'AudioContext', { configurable: true, value: FakeAudioContext });
    Object.defineProperty(dom.navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: () => new Promise<MediaStream>((resolve) => { resolveMedia = resolve; }) },
    });
    root = createRoot(document.createElement('div'));
    await act(async () => { root.render(<Probe />); });
}

afterEach(async () => { await act(async () => { root.unmount(); }); });

describe('dictation capture cancellation', () => {
    test('closes a microphone granted after stop without creating a graph', async () => {
        await setup();
        const start = audio.start();
        await audio.stop();
        resolveMedia(stream);
        await start;
        expect(tracksStopped).toBe(1);
        expect(contexts).toBe(0);
        expect(graphs).toBe(0);
        expect(segments).toBe(0);
    });

    test('stops the microphone while resume is pending and never creates a graph', async () => {
        await setup();
        const start = audio.start();
        resolveMedia(stream);
        await Promise.resolve();
        expect(resumePending).toBe(true);
        await audio.stop();
        expect(tracksStopped).toBe(1);
        expect(closes).toBe(1);
        resolveResume();
        await start;
        expect(graphs).toBe(0);
        expect(segments).toBe(0);
    });
});
