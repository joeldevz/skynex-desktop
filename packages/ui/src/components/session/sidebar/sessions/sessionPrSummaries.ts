import type { IssueLiveSummary, TrackerStateCategory } from '@/lib/api/types';
import { trackerIssueLook } from '@/lib/trackers/stateLook';
import type { PrVisualSummary } from '@/stores/useGitHubPrStatusStore';

type PrStatusLabelKey =
  | 'sessions.sidebar.group.pr.status.merged'
  | 'sessions.sidebar.group.pr.status.readyToMerge'
  | 'sessions.sidebar.group.pr.status.open'
  | 'sessions.sidebar.group.pr.status.mergeConflicts'
  | 'sessions.sidebar.group.pr.status.checksFailing'
  | 'sessions.sidebar.group.pr.status.checksRunning'
  | 'sessions.sidebar.group.pr.status.mergeBlocked'
  | 'sessions.sidebar.group.pr.status.draft'
  | 'sessions.sidebar.group.pr.status.closed';

/** The status line a PR shows in the sidebar. */
export const getPrStatusLabelKey = (summary: PrVisualSummary): PrStatusLabelKey | null => {
  switch (summary.visualState) {
    case 'merged':
      return 'sessions.sidebar.group.pr.status.merged';
    case 'open':
      // Checks still running keep the open colour; the line names them, and
      // such a PR is not ready to merge yet.
      if (summary.checks?.state === 'pending') return 'sessions.sidebar.group.pr.status.checksRunning';
      // A PR still waiting for a required review is not ready to merge.
      return summary.mergeableState !== 'blocked'
        && (summary.canMerge === true || summary.mergeableState === 'clean' || summary.checks?.state === 'success')
        ? 'sessions.sidebar.group.pr.status.readyToMerge'
        : 'sessions.sidebar.group.pr.status.open';
    case 'blocked':
      if (summary.mergeableState === 'dirty') return 'sessions.sidebar.group.pr.status.mergeConflicts';
      if (summary.checks?.state === 'failure') return 'sessions.sidebar.group.pr.status.checksFailing';
      return 'sessions.sidebar.group.pr.status.mergeBlocked';
    case 'draft':
      return 'sessions.sidebar.group.pr.status.draft';
    case 'closed':
      return 'sessions.sidebar.group.pr.status.closed';
    default:
      return null;
  }
};

type IssueStatusLabelKey =
  | 'sessions.sidebar.group.issue.status.open'
  | 'sessions.sidebar.group.issue.status.completed'
  | 'sessions.sidebar.group.issue.status.notPlanned';

const ISSUE_STATE_LOOK = {
  open: { color: 'var(--pr-open)', statusKey: 'sessions.sidebar.group.issue.status.open', priority: 0 },
  completed: { color: 'var(--pr-merged)', statusKey: 'sessions.sidebar.group.issue.status.completed', priority: 2 },
  not_planned: { color: 'var(--pr-closed)', statusKey: 'sessions.sidebar.group.issue.status.notPlanned', priority: 3 },
} satisfies Record<IssueLiveSummary['state'], { color: string; statusKey: IssueStatusLabelKey; priority: number }>;

export const getIssueStateLook = (state: IssueLiveSummary['state']): { color: string; statusKey: IssueStatusLabelKey } => {
  const { color, statusKey } = ISSUE_STATE_LOOK[state];
  return { color, statusKey };
};

export const getTrackerItemStateLook = (category: TrackerStateCategory): { color: string; priority: number } => {
  const { color, priority } = ISSUE_STATE_LOOK[trackerIssueLook(category)];
  return { color, priority };
};
