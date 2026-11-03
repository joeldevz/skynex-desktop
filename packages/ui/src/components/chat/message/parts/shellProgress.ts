type ShellProgress = { completed: number; total: number; percent: number };

// Streamed output can reach hundreds of KiB and is re-read on every update, so
// only the tail is scanned for its last non-empty line.
const lastNonEmptyLine = (output: string): string | undefined => {
    let end = output.length;
    while (end > 0) {
        const start = output.lastIndexOf('\n', end - 1) + 1;
        const line = output.slice(start, end);
        const redraw = line.lastIndexOf('\r');
        const visibleLine = line.slice(redraw + 1).trim();
        if (visibleLine) return visibleLine;
        end = start - 1;
    }
    return undefined;
};

/** Reads only explicit progress markers from the final non-empty output line. */
export const readShellProgress = (output: string): ShellProgress | null => {
    const lastLine = lastNonEmptyLine(output);
    if (!lastLine) return null;

    const percentage = lastLine.match(/(?:^|\s)(100|[1-9]?\d)%\s*$/);
    if (percentage) {
        const percent = Number(percentage[1]);
        return { completed: percent, total: 100, percent };
    }

    const counter = lastLine.match(/(?:\[(\d+)\s*\/\s*(\d+)\]|^(\d+)\s*\/\s*(\d+)$)/);
    if (!counter) return null;

    const completed = Number(counter[1] ?? counter[3]);
    const total = Number(counter[2] ?? counter[4]);
    if (total <= 0 || completed > total) return null;

    return { completed, total, percent: Math.floor((completed / total) * 100) };
};
