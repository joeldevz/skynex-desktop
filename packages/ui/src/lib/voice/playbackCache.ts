import { subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';

export const PLAYBACK_CACHE_TTL_MS = 30 * 60 * 1000;

interface Entry<T> {
    value: T;
    expiresAt: number;
    bytes: number;
}

export class BoundedPlaybackCache<T> {
    private readonly entries = new Map<string, Entry<T>>();
    private bytes = 0;

    constructor(
        private readonly maxEntries: number,
        private readonly maxBytes: number,
        private readonly valueBytes: (value: T) => number,
        private readonly now: () => number = () => Date.now(),
    ) {}

    get size(): number {
        return this.entries.size;
    }

    get(key: string): T | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= this.now()) {
            this.delete(key);
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key: string, value: T): void {
        this.delete(key);
        const bytes = key.length * 2 + this.valueBytes(value);
        if (bytes > this.maxBytes || this.maxEntries < 1) return;
        this.entries.set(key, { value, bytes, expiresAt: this.now() + PLAYBACK_CACHE_TTL_MS });
        this.bytes += bytes;
        while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.delete(oldest);
        }
    }

    clear(): void {
        this.entries.clear();
        this.bytes = 0;
    }

    private delete(key: string): void {
        const entry = this.entries.get(key);
        if (!entry) return;
        this.entries.delete(key);
        this.bytes -= entry.bytes;
    }
}

export const summaryPlaybackCache = new BoundedPlaybackCache<string>(
    64,
    1024 * 1024,
    (value) => value.length * 2,
);

export const audioPlaybackCache = new BoundedPlaybackCache<AudioBuffer>(
    64,
    32 * 1024 * 1024,
    (value) => value.length * value.numberOfChannels * 4,
);

let playbackCacheEpoch = 0;
export const getPlaybackCacheEpoch = (): number => playbackCacheEpoch;

subscribeRuntimeEndpointChanged(() => {
    playbackCacheEpoch += 1;
    summaryPlaybackCache.clear();
    audioPlaybackCache.clear();
});
