import { create } from 'zustand';

type VoiceSettingsTab = 'playback' | 'dictation';

export const useVoiceSettingsTabStore = create<{
    tab: VoiceSettingsTab;
    setTab: (tab: VoiceSettingsTab) => void;
}>((set) => ({ tab: 'playback', setTab: (tab) => set({ tab }) }));

export const voiceSettingsTabForSearchTarget = (id: string): VoiceSettingsTab | null => {
    switch (id) {
        case 'voice.playback':
        case 'voice.auto-read-aloud':
            return 'playback';
        case 'voice.speech-recognition':
            return 'dictation';
        default:
            return null;
    }
};
