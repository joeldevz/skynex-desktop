import type { Session } from '@/lib/opencode/model';
import type { WorktreeMetadata } from '@/types/worktree';

export type SessionNode = {
  session: Session;
  children: SessionNode[];
  worktree: WorktreeMetadata | null;
};
