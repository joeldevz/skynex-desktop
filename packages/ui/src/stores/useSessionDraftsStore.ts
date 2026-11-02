/** A new draft's id: the server keeps ids of letters, digits, `_`, `.` and `-`. */
export const createSessionDraftId = (): string => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
