import { describe, expect, test } from 'bun:test';
import { requestConciseSpokenSummary } from './spokenSummary';

describe('requestConciseSpokenSummary', () => {
    test('sends only the selected reply and provider preferences on demand', async () => {
        const controller = new AbortController();
        let requests = 0;
        const result = await requestConciseSpokenSummary('The change is ready. Verification is pending.', {
            providerID: 'selected-provider',
            modelID: 'selected-model',
            signal: controller.signal,
        }, async (init, options) => {
            requests += 1;
            expect(init.method).toBe('POST');
            expect(init.signal).toBe(controller.signal);
            expect(options?.notifyOnError).toBe(false);
            expect(JSON.parse(String(init.body))).toMatchObject({
                prompt: 'The change is ready. Verification is pending.',
                preferredProviderID: 'selected-provider',
                preferredModelID: 'selected-model',
            });
            return Response.json({ text: '  Ready, but not verified.  ' });
        });
        expect(requests).toBe(1);
        expect(result).toBe('Ready, but not verified.');
    });

    test('does not request generation for blank input', async () => {
        let requests = 0;
        expect(await requestConciseSpokenSummary(' \n ', {}, async () => {
            requests += 1;
            return Response.json({ text: 'Unused' });
        })).toBeNull();
        expect(requests).toBe(0);
    });

    test.each([{}, { text: '' }, { text: '  ' }, { text: 42 }, null])(
        'rejects unusable output %j without returning the original reply',
        async (payload) => {
            expect(await requestConciseSpokenSummary('Original reply', {}, async () => Response.json(payload))).toBeNull();
        },
    );

    test('returns no summary on refused or failed requests', async () => {
        expect(await requestConciseSpokenSummary('Original reply', {}, async () => new Response(null, { status: 404 }))).toBeNull();
        expect(await requestConciseSpokenSummary('Original reply', {}, async () => { throw new Error('Unavailable'); })).toBeNull();
        expect(await requestConciseSpokenSummary('Original reply', {}, async () => new Response('invalid JSON'))).toBeNull();
    });
});
