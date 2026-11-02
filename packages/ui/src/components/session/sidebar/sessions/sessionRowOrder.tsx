export type SessionRowOrderEntry = {
  id: string;
  rowKey: string;
  scopeKey: string | null;
  archived: boolean;
  descendantRange?: readonly [start: number, end: number];
};
