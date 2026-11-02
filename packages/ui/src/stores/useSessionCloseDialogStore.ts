import { create } from 'zustand';
import type { OpenSessionReference } from './useOpenSessionsStore';

type CloseRequest = { reference: OpenSessionReference; runtimeKey: string | null };
type CloseDialogState = {
  requests: readonly CloseRequest[];
  failure: 'stop-failed' | 'stopped-but-open' | 'close-failed' | null;
  present(request: CloseRequest): void;
  dismiss(): void;
  fail(failure: CloseDialogState['failure']): void;
};

export const useSessionCloseDialogStore = create<CloseDialogState>()((set) => ({
  requests: [], failure: null,
  present: (request) => set((state) => ({ requests: state.requests.some((entry) => entry.runtimeKey === request.runtimeKey && entry.reference.sessionId === request.reference.sessionId) ? state.requests : [...state.requests, request], failure: null })),
  dismiss: () => set((state) => ({ requests: state.requests.slice(1) })),
  fail: (failure) => set({ failure }),
}));
