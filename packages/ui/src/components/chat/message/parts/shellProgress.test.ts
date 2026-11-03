import { describe, expect, test } from 'bun:test';
import { readShellProgress } from './shellProgress';

describe('readShellProgress', () => {
    test('accepts explicit percentages and counters on the last output line', () => {
        expect(readShellProgress('compile\nprogress: 64%')).toEqual({ completed: 64, total: 100, percent: 64 });
        expect(readShellProgress('download [183/286]')).toEqual({ completed: 183, total: 286, percent: 63 });
        expect(readShellProgress('183/286')).toEqual({ completed: 183, total: 286, percent: 63 });
    });

    test('uses the latest carriage-return redraw in a progress line', () => {
        expect(readShellProgress('10%\r50%\r64%')).toEqual({ completed: 64, total: 100, percent: 64 });
    });

    test('ignores prose ratios, timestamps, versions, malformed and out-of-range values', () => {
        expect(readShellProgress('ratio is 1/2')).toBeNull();
        expect(readShellProgress('version 1/2')).toBeNull();
        expect(readShellProgress('12:30')).toBeNull();
        expect(readShellProgress('101%')).toBeNull();
        expect(readShellProgress('[3/0]')).toBeNull();
        expect(readShellProgress('')).toBeNull();
    });
});
