import { describe, expect, test } from 'bun:test';
import { getDurableStorage } from './safeStorage';

class DurableStorage implements Storage {
    private readonly values = new Map<string, string>();
    readFailure: Error | null = null;
    writeFailure: Error | null = null;
    readonly removedKeys: string[] = [];

    get length(): number {
        return this.values.size;
    }

    getItem(key: string): string | null {
        if (this.readFailure) throw this.readFailure;
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        if (this.writeFailure) throw this.writeFailure;
        this.values.set(key, String(value));
    }

    removeItem(key: string): void {
        this.removedKeys.push(key);
        this.values.delete(key);
    }

    clear(): void {
        this.values.clear();
    }

    key(index: number): string | null {
        return Array.from(this.values.keys())[index] ?? null;
    }
}

const withLocalStorage = (descriptor: PropertyDescriptor | null, check: () => void): void => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    try {
        if (descriptor === null) {
            Reflect.deleteProperty(globalThis, 'window');
        } else {
            const replacementWindow = {};
            Object.defineProperty(replacementWindow, 'localStorage', descriptor);
            Object.defineProperty(globalThis, 'window', {
                configurable: true,
                value: replacementWindow,
            });
        }
        check();
    } finally {
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
        else Reflect.deleteProperty(globalThis, 'window');
    }
};

describe('getDurableStorage', () => {
    test('C5 distinguishes a missing key from a failed read', () => {
        const backing = new DurableStorage();
        withLocalStorage({ value: backing }, () => {
            const storage: Pick<Storage, 'getItem' | 'setItem'> = getDurableStorage();
            expect(storage.getItem('membership')).toBeNull();

            const failure = new Error('durable read denied');
            backing.readFailure = failure;
            expect(() => storage.getItem('membership')).toThrow(failure);
        });
    });

    test('C9 acknowledges durable writes and preserves the old value after a failed replacement', () => {
        const backing = new DurableStorage();
        withLocalStorage({ value: backing }, () => {
            const storage = getDurableStorage();
            storage.setItem('membership', 'old');
            expect(backing.getItem('membership')).toBe('old');
            expect(storage.getItem('membership')).toBe('old');

            const failure = new Error('durable quota exceeded');
            backing.writeFailure = failure;
            expect(() => storage.setItem('membership', 'replacement')).toThrow(failure);
            expect(backing.getItem('membership')).toBe('old');
            expect(storage.getItem('membership')).toBe('old');
            expect(backing.removedKeys).toEqual([]);
        });
    });

    test('C5/C9 fails closed when localStorage is unavailable or access is denied', () => {
        withLocalStorage(null, () => {
            expect(() => getDurableStorage()).toThrow();
        });
        withLocalStorage({ value: undefined }, () => {
            expect(() => getDurableStorage()).toThrow();
        });
        const failure = new Error('localStorage accessor denied');
        withLocalStorage({ get: () => { throw failure; } }, () => {
            expect(() => getDurableStorage()).toThrow(failure);
        });
    });
});
