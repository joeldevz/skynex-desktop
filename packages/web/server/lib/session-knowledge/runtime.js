/**
 * Checkout context and managed-tool guidance for every session sender.
 *
 * The text lives in OpenCode as the session's instruction entries
 * (`/api/experimental/session/:id/instructions/entries/:key`). OpenCode keeps
 * them with the session: the first values go into the system prompt, a value
 * that changes or goes away is announced to the agent at its next step, and
 * compaction, revert and fork keep them. So OpenChamber holds no record of what
 * a session was told; every sender writes what the session should carry now,
 * right before its message, and OpenCode tells the agent only what changed.
 *
 * One owner for every sender (a message from the UI, the queue, a scheduled
 * task, a session the agent dispatched): sessions started without a UI must
 * carry the same context as the ones a tab sends to.
 */
/**
 * OpenCode orders entries by key. Retired keys stay only to clear old injections.
 */
export const KNOWLEDGE_ENTRY_KEYS = {
  checkout: 'openchamber.checkout',
  pinned: 'openchamber.pinned',
  memory: 'openchamber.memory',
  guidance: 'openchamber.guidance',
};

/**
 * Where the session works, as the agent cannot see it for itself between two
 * messages: another session sharing the checkout may have switched the branch,
 * and the agent would go on editing that session's work. The directory is
 * named too, so a session moved to another worktree reads as a move.
 */
const describeCheckout = ({ directory, branch, placeholder = false }) => {
  if (!branch) return `This session works in \`${directory}\`, with no branch checked out.`;
  const where = `This session works in \`${directory}\`, on branch \`${branch}\`.`;
  return placeholder ? `${where} ${placeholderBranchGuidance(branch)}` : where;
};

/**
 * A branch OpenChamber named with a placeholder (Quick worktree's
 * `agile-chipmunk`) and never pushed is renamed after the task by the agent,
 * at the moment it names the task. Said here, with the branch, and only while
 * it holds: once renamed, the entry changes and OpenCode tells the agent so.
 * `work.name` does the rename (its `branch`) and refuses to name the task
 * without it, so the two cannot drift apart; a separate `git branch -m` step
 * was the one weaker models dropped.
 */
const placeholderBranchGuidance = (branch) => `Its name \`${branch}\` is a placeholder OpenChamber generated, not one the user chose,`
  + ' and it is not pushed yet. Name the task with work.name, passing branch too: work.name renames the branch to it.'
  + " Follow the naming the repository's other branches use (`git branch -a`); with none, `<type>/<short-kebab-case>`"
  + ' with the conventional commit types, such as `fix/login-timeout`. No tool or app prefix.'
  + ' A placeholder made for an issue (`issue-180-merry-salamander`) keeps its `issue-180-`: work.name puts it in front of your name.';

/**
 * When to link, stated in every session that has the `openchamber` tool, and
 * only here. Stated only in the action's description, an agent given an issue
 * to investigate never opened the tool and so never linked it.
 */
export const SESSION_LINK_GUIDANCE = "Link to this session with the openchamber tool's session.link,"
  + " as soon as you know it, each issue or pull or merge request the user gives you to"
  + " work on, fix, investigate or review, that you open for this work, or that the work"
  + " resolves. One merely mentioned in passing stays unlinked. The reply need not say you linked it.";

/**
 * When to name the task, stated with the linking guidance for the same reason:
 * an action only its description mentions is never called. The sidebar lists
 * a task under this name, so it is set early and changed only with the task.
 */
export const WORK_NAME_GUIDANCE = "Name the task with the openchamber tool's work.name as soon as it is clear what"
  + " the task is: at most 4 words naming the task itself, such as \"Login timeout fix\" or \"Sidebar task rows\","
  + " never a step of it. Rename it only when the work becomes a different task; finishing a step, fixing"
  + " something on the way or a follow-up within the same task is no reason. A name the user gave stays.";

/**
 * Where the managed tools are called, stated while they are direct tools (the
 * default; `agentToolsCodeMode` puts them in Code Mode's catalog instead).
 * OpenCode's Code Mode teaches the model that tools live in `execute`'s
 * catalog, and a model that called `tools.openchamber(...)` from a script got
 * "Unknown tool", concluded the tool did not exist and never named its task.
 */
export const DIRECT_TOOLS_GUIDANCE = "The openchamber tools (openchamber, openchamber_render and the others) are direct tool calls:"
  + " never call them from inside a Code Mode execute script, where they do not exist.";

/**
 * When to draw a page, stated in every session that has the
 * `openchamber_render` tool, and only here. Stated only in the tool
 * description, it went unread: asked for a breakdown of lines of code per
 * package, an agent answered with a list and drew the chart only when asked.
 * Interface mockups are named on their own: listed only as data, the cases
 * read to a literal model as "charts only", while a proposed UI change is
 * where a page helps most. The limits matter as much as the cases: a page for
 * two numbers is worse than a sentence.
 */
export const RENDER_PAGE_GUIDANCE = "The openchamber_render tool draws a chart, table, diagram or interface mockup inline in the chat."
  + " Use it when the answer is mostly data or structure the user would otherwise picture:"
  + " numbers across several items (sizes, counts, timings, costs, test results), shares of a whole,"
  + " a trend, options compared on several criteria, a timeline, how components connect;"
  + " or how something looks: a proposed interface change, before and after, layout options."
  + " Skip it for a few numbers, a short list, code, or when the user asked for plain text."
  + " At most one page per answer."
  + " A mockup of the user's own project takes its look from that project's code (theme tokens, CSS variables, styles), not from OpenChamber's theme."
  + " Draw a page that only shows right before your final reply, and keep the reply to what the page does not show."
  + " For a choice a page shows better than text, such as layouts or designs, ask on a page with awaitAnswer and continue from the answer.";

/**
 * When to reach for a workflow, stated in every session that has the
 * `openchamber_workflow` tool. A run costs many agents, so the agent starts
 * one only when the user asks; spotting a task that fits is the agent's job
 * too, and it offers one instead of starting it.
 */
export const WORKFLOW_GUIDANCE = 'The openchamber_workflow tool runs a script that fans a large task out to many agents in the background.'
  + ' Start one when the user asks for a workflow.'
  + ' When the task in front of you has many similar independent pieces (a review per file, an audit across many routes, a migration of many files)'
  + ' or needs results cross-checked at that scale, say so and offer a workflow; never start one unasked.'
  + ' A single feature, a few steps or a short loop over files you can do yourself never gets one.';

const buildGuidance = ({ linking, rendering, workflows, directTools }) => [
  linking ? SESSION_LINK_GUIDANCE : '',
  linking ? WORK_NAME_GUIDANCE : '',
  rendering ? RENDER_PAGE_GUIDANCE : '',
  workflows ? WORKFLOW_GUIDANCE : '',
  (linking || rendering || workflows) && directTools ? DIRECT_TOOLS_GUIDANCE : '',
].filter(Boolean).join('\n\n');

/**
 * The text each entry should hold now. An empty text means the entry goes
 * away; a key left out keeps what the session holds, which is what a branch
 * that could not be read means. Pinned notes/plans and project memory are
 * not injected in this stage, so their entries are always removed.
 */
export const buildKnowledgeEntries = ({ linking = false, rendering = false, workflows = false, directTools = true, checkout = null }) => {
  const entries = {
    [KNOWLEDGE_ENTRY_KEYS.pinned]: '',
    [KNOWLEDGE_ENTRY_KEYS.memory]: '',
    [KNOWLEDGE_ENTRY_KEYS.guidance]: buildGuidance({ linking, rendering, workflows, directTools }),
  };
  // The branch is told while the agent has the tool, whose worktree move is
  // the one thing it can do about a busy branch.
  if (!linking) entries[KNOWLEDGE_ENTRY_KEYS.checkout] = '';
  else if (checkout) entries[KNOWLEDGE_ENTRY_KEYS.checkout] = describeCheckout(checkout);
  return entries;
};

export const createSessionKnowledgeRuntime = (dependencies) => {
  const {
    // Whether this session's agent has the `openchamber` tool to link with.
    isSessionLinkingAvailable = null,
    // The checked-out branch, or '' when none is checked out. Failures throw;
    // read only while the agent has the tool.
    readCheckoutBranch = null,
    // `(directory, branch)`: that checked-out branch while its name is
    // OpenChamber's placeholder and it was never pushed, else null.
    readPlaceholderBranch = null,
    // Whether this session's agent has the `openchamber_render` tool.
    isPageRenderingAvailable = async () => false,
    // Whether this session's agent has the `openchamber_workflow` tool.
    isWorkflowAvailable = async () => false,
    // Whether the managed tools run through Code Mode's catalog rather than
    // as direct tools.
    areAgentToolsInCodeMode = async () => false,
    // The session's instruction entries in OpenCode: `put(sessionId,
    // directory, key, text)` and `remove(sessionId, directory, key)`. Both are
    // idempotent there, so writing an unchanged value tells the agent nothing.
    instructionEntries = null,
  } = dependencies;

  /** Everything the session should be carrying, read fresh. */
  const collect = async (directory) => {
    const linking = typeof isSessionLinkingAvailable === 'function'
      ? await Promise.resolve(isSessionLinkingAvailable()).catch(() => false)
      : false;
    // The branch is read only while the tool that moves a session off it is there.
    const branch = linking && directory && readCheckoutBranch
      ? await Promise.resolve(readCheckoutBranch(directory)).catch(() => null)
      : null;
    const placeholder = Boolean(branch) && readPlaceholderBranch
      ? await Promise.resolve(readPlaceholderBranch(directory, branch)).then((name) => name === branch, () => false)
      : false;
    const checkout = branch !== null ? { directory, branch, placeholder } : null;

    const rendering = await Promise.resolve(isPageRenderingAvailable()).catch(() => false);
    const workflows = await Promise.resolve(isWorkflowAvailable()).catch(() => false);
    const directTools = !(await Promise.resolve(areAgentToolsInCodeMode()).catch(() => false));

    return { linking, rendering, workflows, directTools, checkout };
  };

  /**
   * Writes what the session should carry now into its instruction entries.
   * Called right before a message goes out, so the agent reads it with that
   * message. Never throws: a message without its background costs the agent
   * some context, a failed send costs the user their message. One entry that
   * will not write does not hold back the others.
   */
  const sync = async (sessionId, directory) => {
    if (!instructionEntries || !sessionId) return false;
    try {
      const entries = buildKnowledgeEntries(await collect(directory));
      const writes = await Promise.allSettled(Object.entries(entries).map(([key, text]) => (text
        ? instructionEntries.put(sessionId, directory, key, text)
        : instructionEntries.remove(sessionId, directory, key))));
      const failed = writes.find((write) => write.status === 'rejected');
      if (failed) console.warn('[session-knowledge] entry write failed:', failed.reason?.message || failed.reason);
      return !failed;
    } catch (error) {
      console.warn('[session-knowledge] sync failed:', error?.message || error);
      return false;
    }
  };

  return {
    collect,
    sync,
  };
};
