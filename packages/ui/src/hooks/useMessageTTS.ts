/**
 * useMessageTTS Hook
 * 
 * Hook for playing TTS on individual messages.
 * Uses the configured voice provider (browser, OpenAI, or macOS Say).
 */

import { useCallback, useEffect, useId, useRef } from 'react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/i18n';
import { useConfigStore } from '@/stores/useConfigStore';
import { useServerTTS } from './useServerTTS';
import { useSayTTS } from './useSayTTS';
import { useLocalTTS } from './useLocalTTS';
import { browserVoiceService } from '@/lib/voice/browserVoiceService';
import { ensureLineTerminalPunctuation, sanitizeForTTS } from '@/lib/voice/summarize';
import { requestConciseSpokenSummary } from '@/lib/voice/spokenSummary';
import { loadDesktopSettings } from '@/lib/persistence';
import { opencodeClient } from '@/lib/opencode/client';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { getPlaybackCacheEpoch, summaryPlaybackCache } from '@/lib/voice/playbackCache';
import {
    finishReading,
    isCurrentReading,
    markReadingPlaying,
    startReading,
    stopActiveReading,
    stopReadingUnderKey,
    useIsReading,
    useIsReadingPreparing,
} from '@/lib/voice/activeReading';

export interface PlayMessageTTSOptions {
    summarize?: 'concise';
}

export interface UseMessageTTSReturn {
    /** Whether a reading under this key is preparing or playing. */
    isPlaying: boolean;
    isPreparing: boolean;
    /** Play the text, replacing any reading in progress */
    play: (text: string, options?: PlayMessageTTSOptions) => Promise<void>;
    /** Stop the reading under this hook's key */
    stop: () => void;
}

/**
 * @param readingKey Hooks passing the same key share one reading; without a
 * key the reading is private to this hook.
 */
export function useMessageTTS(readingKey?: string, manualPlaybackEnabled = false): UseMessageTTSReturn {
    const { t } = useI18n();
    const instanceKey = useId();
    const key = readingKey ?? instanceKey;
    const isPlaying = useIsReading(key);
    const isPreparing = useIsReadingPreparing(key);
    const ownTokenRef = useRef<symbol | null>(null);
    const summaryAbortRef = useRef<AbortController | null>(null);
    
    const voiceProvider = useConfigStore((state) => state.voiceProvider);
    const speechRate = useConfigStore((state) => state.speechRate);
    const speechPitch = useConfigStore((state) => state.speechPitch);
    const speechVolume = useConfigStore((state) => state.speechVolume);
    const sayVoice = useConfigStore((state) => state.sayVoice);
    const localTtsVoiceId = useConfigStore((state) => state.localTtsVoiceId);
    const localTtsModelId = useConfigStore((state) => state.localTtsModelId);
    const ttsFollowTextLanguage = useConfigStore((state) => state.ttsFollowTextLanguage);
    const browserVoice = useConfigStore((state) => state.browserVoice);
    const openaiVoice = useConfigStore((state) => state.openaiVoice);
    const openaiCompatibleVoice = useConfigStore((state) => state.openaiCompatibleVoice);
    const openaiCompatibleUrl = useConfigStore((state) => state.openaiCompatibleUrl);
    const openaiCompatibleTtsModel = useConfigStore((state) => state.openaiCompatibleTtsModel);
    const showMessageTTSButtons = useConfigStore((state) => state.showMessageTTSButtons);
    const autoReadAloudEnabled = useConfigStore((state) => state.autoReadAloudEnabled);
    const ttsInputMode = useConfigStore((state) => state.ttsInputMode);

    const isServerProvider = voiceProvider === 'openai' || voiceProvider === 'openai-compatible';
    // Auto-read can be on while the per-message buttons are hidden; both
    // paths still need the selected provider's availability.
    const voicePlaybackEnabled = manualPlaybackEnabled || showMessageTTSButtons || autoReadAloudEnabled;
    const shouldCheckOpenAIAvailability = voicePlaybackEnabled && isServerProvider;
    const shouldCheckSayAvailability = voicePlaybackEnabled && voiceProvider === 'say';

    const { speak: speakServerTTS, stop: stopServerTTS, isAvailable: isServerTTSAvailable, checkAvailability: checkServerAvailability } = useServerTTS({
        enabled: shouldCheckOpenAIAvailability,
        availabilityMode: voiceProvider === 'openai-compatible' ? 'openai-compatible' : 'openai',
    });
    const { speak: speakSayTTS, stop: stopSayTTS, isAvailable: isSayTTSAvailable, checkAvailability: checkSayAvailability } = useSayTTS({
        enabled: shouldCheckSayAvailability,
    });
    const { speak: speakLocalTTS, stop: stopLocalTTS } = useLocalTTS();
    
    const stopPlayback = useCallback(() => {
        summaryAbortRef.current?.abort();
        summaryAbortRef.current = null;
        stopServerTTS();
        stopSayTTS();
        stopLocalTTS();
        browserVoiceService.cancelSpeech();
    }, [stopServerTTS, stopSayTTS, stopLocalTTS]);

    const stop = useCallback(() => stopReadingUnderKey(key), [key]);

    // The players above go silent when this hook unmounts; a reading it
    // started must not stay marked as playing.
    useEffect(() => () => {
        const token = ownTokenRef.current;
        if (token && isCurrentReading(token)) {
            stopActiveReading();
        }
    }, []);
    
    const play = useCallback(async (text: string, options?: PlayMessageTTSOptions) => {
        if (!text.trim()) return;
        
        const token = startReading(key, stopPlayback);
        ownTokenRef.current = token;
        const finish = () => finishReading(token);
        const started = () => markReadingPlaying(token);
        const fail = () => {
            if (!isCurrentReading(token)) return;
            toast.error(t('chat.messageBody.tts.playbackFailed'), { id: 'tts-playback-error' });
            finish();
        };
        
        try {
            const useSelectedVoice = options?.summarize === 'concise';
            let serverAvailable = isServerTTSAvailable;
            let sayAvailable = isSayTTSAvailable;
            if (useSelectedVoice) {
                if (isServerProvider) serverAvailable = await checkServerAvailability();
                if (voiceProvider === 'say') sayAvailable = await checkSayAvailability();
                if (!isCurrentReading(token)) return;
                if ((isServerProvider && !serverAvailable) || (voiceProvider === 'say' && !sayAvailable)) {
                    fail();
                    return;
                }
            }
            let sourceText = text;
            if (options?.summarize === 'concise') {
                const controller = new AbortController();
                summaryAbortRef.current = controller;
                const { currentProviderId, currentModelId } = useConfigStore.getState();
                const cacheEpoch = getPlaybackCacheEpoch();
                const runtimeKey = getRuntimeKey();
                const directory = opencodeClient.getDirectory();
                const smallModelSettings = await loadDesktopSettings().catch(() => null);
                if (!isCurrentReading(token)) return;
                const summaryKey = smallModelSettings ? JSON.stringify([
                    runtimeKey,
                    directory ?? '',
                    key,
                    text,
                    currentProviderId || '',
                    currentModelId || '',
                    smallModelSettings.smallModelUseDefault ?? null,
                    smallModelSettings.smallModelOverride ?? '',
                    smallModelSettings.smallModelVariant ?? '',
                ]) : null;
                const cachedSummary = summaryKey ? summaryPlaybackCache.get(summaryKey) : undefined;
                const summary = cachedSummary ?? await requestConciseSpokenSummary(text, {
                    providerID: currentProviderId || undefined,
                    modelID: currentModelId || undefined,
                    signal: controller.signal,
                });
                if (!isCurrentReading(token)) return;
                summaryAbortRef.current = null;
                if (!summary) {
                    toast.error(t('chat.messageBody.tts.summaryFailed'));
                    finish();
                    return;
                }
                if (!cachedSummary && summaryKey && cacheEpoch === getPlaybackCacheEpoch()
                    && runtimeKey === getRuntimeKey() && directory === opencodeClient.getDirectory()) {
                    summaryPlaybackCache.set(summaryKey, summary);
                }
                sourceText = summary;
            }
            const shouldUseRaw = ttsInputMode === 'raw' && isServerProvider;
            const sanitizedText = sanitizeForTTS(sourceText);
            const textToSpeak = shouldUseRaw ? sourceText : sanitizedText;
            const manualAudioCacheKey = options?.summarize === 'concise' ? JSON.stringify([
                getRuntimeKey(),
                opencodeClient.getDirectory() ?? '',
                key,
                text,
                voiceProvider,
                voiceProvider === 'openai-compatible' ? openaiCompatibleVoice : openaiVoice,
                openaiCompatibleTtsModel ?? '',
                speechRate,
                speechPitch,
                speechVolume,
                localTtsModelId ?? '',
                localTtsVoiceId ?? '',
                sayVoice ?? '',
                browserVoice ?? '',
                textToSpeak,
            ]) : undefined;
            
            if (isServerProvider && serverAvailable) {
                const voice = voiceProvider === 'openai-compatible' ? openaiCompatibleVoice : openaiVoice;
                const baseURL = voiceProvider === 'openai-compatible' ? openaiCompatibleUrl : undefined;
                const model = voiceProvider === 'openai-compatible' ? openaiCompatibleTtsModel : undefined;
                await speakServerTTS(textToSpeak, {
                    voice,
                    model,
                    speed: speechRate,
                    pitch: speechPitch,
                    volume: speechVolume,
                    summarize: false,
                    baseURL,
                    cacheKey: manualAudioCacheKey,
                    onStart: started,
                    onEnd: finish,
                    onError: fail,
                });
            } else if (voiceProvider === 'local') {
                await speakLocalTTS(sanitizedText, {
                    model: localTtsModelId,
                    speakerId: localTtsVoiceId,
                    speed: speechRate,
                    cacheKey: manualAudioCacheKey,
                    language: !useSelectedVoice && ttsFollowTextLanguage ? 'auto' : undefined,
                    onStart: started,
                    onEnd: finish,
                    onError: fail,
                });
            } else if (voiceProvider === 'say' && sayAvailable) {
                const wordsPerMinute = Math.round(100 + (speechRate - 0.5) * 200);
                await speakSayTTS(ensureLineTerminalPunctuation(sanitizedText), {
                    voice: sayVoice,
                    rate: wordsPerMinute,
                    cacheKey: manualAudioCacheKey,
                    language: !useSelectedVoice && ttsFollowTextLanguage ? 'auto' : undefined,
                    onStart: started,
                    onEnd: finish,
                    onError: fail,
                });
            } else {
                // Browser TTS
                await browserVoiceService.waitForVoices();
                await browserVoiceService.resumeAudioContext();
                if (!isCurrentReading(token)) return;
                await browserVoiceService.speakText(
                    ensureLineTerminalPunctuation(sanitizedText),
                    navigator.language || 'en-US',
                    finish,
                    {
                        rate: speechRate,
                        pitch: speechPitch,
                        volume: speechVolume,
                        voiceName: browserVoice || undefined,
                        requireVoice: useSelectedVoice,
                        onError: fail,
                    }
                );
                started();
            }
        } catch (err) {
            console.error('[useMessageTTS] Playback error:', err);
            fail();
        }
    }, [
        voiceProvider,
        isServerProvider,
        speechRate,
        speechPitch,
        speechVolume,
        sayVoice,
        browserVoice,
        openaiVoice,
        openaiCompatibleVoice,
        openaiCompatibleUrl,
        openaiCompatibleTtsModel,
        isServerTTSAvailable,
        isSayTTSAvailable,
        checkServerAvailability,
        checkSayAvailability,
        ttsInputMode,
        speakServerTTS,
        speakSayTTS,
        speakLocalTTS,
        localTtsVoiceId,
        localTtsModelId,
        ttsFollowTextLanguage,
        key,
        stopPlayback,
        t,
    ]);
    
    return {
        isPlaying,
        isPreparing,
        play,
        stop,
    };
}
