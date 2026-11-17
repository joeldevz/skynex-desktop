import { describe, expect, test } from 'bun:test';
import { BoundedPlaybackCache, PLAYBACK_CACHE_TTL_MS } from './playbackCache';

describe('BoundedPlaybackCache', () => {
    test('expires from creation time and does not extend lifetime on read', () => {
        let now = 100;
        const cache = new BoundedPlaybackCache<string>(4, 100, (value) => value.length * 2, () => now);
        cache.set('key', 'value');
        now += PLAYBACK_CACHE_TTL_MS - 1;
        expect(cache.get('key')).toBe('value');
        now += 1;
        expect(cache.get('key')).toBeUndefined();
    });

    test('bounds entry count and inclusive key plus value bytes', () => {
        const cache = new BoundedPlaybackCache<string>(2, 100, (value) => value.length * 2);
        cache.set('a', 'one');
        cache.set('b', 'two');
        cache.set('c', 'three');
        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('b')).toBe('two');
        expect(cache.get('c')).toBe('three');
        const byteBounded = new BoundedPlaybackCache<string>(3, 12, (value) => value.length * 2);
        byteBounded.set('a', 'one');
        byteBounded.set('b', 'two');
        byteBounded.set('x', 'oversized');
        expect(byteBounded.get('x')).toBeUndefined();
        expect(byteBounded.get('a')).toBeUndefined();
        expect(byteBounded.get('b')).toBe('two');
    });
});
