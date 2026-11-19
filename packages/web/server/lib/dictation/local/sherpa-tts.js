/**
 * Sherpa-onnx offline TTS (Kokoro, Piper/VITS and Supertonic). Runs inside the dictation worker process
 * only — never load the native addon in the main server process.
 */

import { existsSync } from 'fs';
import path from 'path';

import { loadSherpaOnnxNode } from './sherpa-loader.js';

function assertFileExists(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function float32ToPcm16le(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out[i] = Math.round(clamped * 32767);
  }
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * sherpa-onnx model config for one catalog entry. Kokoro carries a voices
 * bank (speaker ids) and optional lexicons; a Piper/VITS model is a single
 * voice with espeak-ng phonemization. Supertonic reads raw text through its
 * own Unicode indexer and carries ten voice styles.
 * @param {{ modelDir: string, type?: string, files: Record<string, string>, lexicon?: string[] }} config
 */
function buildModelConfig(config) {
  const file = (key, label) => {
    const filePath = path.join(config.modelDir, config.files[key]);
    assertFileExists(filePath, label);
    return filePath;
  };
  if (config.type === 'supertonic') {
    return {
      supertonic: {
        durationPredictor: file('durationPredictor', 'TTS duration predictor'),
        textEncoder: file('textEncoder', 'TTS text encoder'),
        vectorEstimator: file('vectorEstimator', 'TTS vector estimator'),
        vocoder: file('vocoder', 'TTS vocoder'),
        ttsJson: file('ttsJson', 'TTS config'),
        unicodeIndexer: file('unicodeIndexer', 'TTS unicode indexer'),
        voiceStyle: file('voiceStyle', 'TTS voice styles'),
      },
    };
  }
  const modelPath = file('model', 'TTS model');
  const tokensPath = file('tokens', 'TTS tokens');

  if (config.type === 'vits') {
    // Piper models phonemize through espeak-ng (`espeakData`); character
    // models (Coqui) read the text directly and carry no espeak data.
    const dataDir = config.files.espeakData ? file('espeakData', 'TTS espeak-ng dataDir') : '';
    return { vits: { model: modelPath, tokens: tokensPath, ...(dataDir ? { dataDir } : {}), lengthScale: 1.0 } };
  }

  const dataDir = file('espeakData', 'TTS espeak-ng dataDir');
  const voicesPath = file('voices', 'TTS voices');
  const lexicon = (config.lexicon ?? []).map((key) => file(key, 'TTS lexicon')).join(',');
  return {
    kokoro: {
      model: modelPath,
      voices: voicesPath,
      tokens: tokensPath,
      dataDir,
      lengthScale: 1.0,
      ...(lexicon ? { lexicon } : {}),
    },
  };
}

export class SherpaTtsEngine {
  /**
   * @param {{ modelDir: string, type?: string, files: Record<string, string>, lexicon?: string[], languages?: string[], numThreads?: number }} config
   */
  constructor(config) {
    const model = buildModelConfig(config);
    this.sherpa = loadSherpaOnnxNode();
    // Supertonic rejects a language it does not speak instead of guessing.
    this.languages = config.type === 'supertonic' ? (config.languages ?? []) : null;

    const sherpa = this.sherpa;
    if (typeof sherpa.OfflineTts !== 'function') {
      throw new Error('sherpa-onnx-node OfflineTts is unavailable');
    }

    this.tts = new sherpa.OfflineTts({
      model,
      numThreads: config.numThreads ?? 2,
      provider: 'cpu',
      maxNumSentences: 1,
    });
  }

  /**
   * Synthesize text to PCM16LE.
   * @param {string} text
   * @param {{ speakerId?: number, speed?: number, language?: string }} [options]
   * @returns {{ pcm16: Buffer, sampleRate: number }}
   */
  synthesize(text, options = {}) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      throw new Error('Cannot synthesize empty text');
    }

    const sid = Number.isInteger(options.speakerId) ? options.speakerId : 0;
    const speed = typeof options.speed === 'number' && options.speed > 0 ? options.speed : 1.0;
    // Request a copied buffer from sherpa itself: native external-backed
    // typed arrays are rejected by Electron.
    const audio = this.languages
      ? this.tts.generate({
        text: trimmed,
        generationConfig: new this.sherpa.GenerationConfig({
          sid,
          speed,
          extra: { lang: this.languages.includes(options.language) ? options.language : 'en' },
        }),
        enableExternalBuffer: false,
      })
      : this.tts.generate({ text: trimmed, sid, speed, enableExternalBuffer: false });

    let samples = null;
    if (audio && audio.samples instanceof Float32Array) {
      samples = Float32Array.from(audio.samples);
    } else if (audio && Array.isArray(audio.samples)) {
      samples = Float32Array.from(audio.samples);
    }
    if (!samples) {
      throw new Error('Unexpected sherpa TTS output: missing Float32 samples');
    }

    const sampleRate =
      audio && typeof audio.sampleRate === 'number' && audio.sampleRate > 0
        ? audio.sampleRate
        : typeof this.tts.sampleRate === 'number' && this.tts.sampleRate > 0
          ? this.tts.sampleRate
          : 24000;

    return { pcm16: float32ToPcm16le(samples), sampleRate };
  }

  free() {
    try {
      this.tts?.free?.();
    } catch {
      // ignore
    }
  }
}
