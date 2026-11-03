/**
 * The error the client writes on a tool part it finalizes itself when OpenCode
 * reports the turn interrupted while the part was still pending or running.
 * Rows read it as the user's stop, not as the tool failing.
 */
export const INTERRUPTED_TOOL_ERROR = "Interrupted"
