import type { TerminalDesign } from "./model";

export interface EditHistory {
  past: TerminalDesign[];
  present: TerminalDesign;
  future: TerminalDesign[];
}

const LIMIT = 60;
const unchanged = (a: TerminalDesign, b: TerminalDesign): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function createHistory(design: TerminalDesign): EditHistory {
  return { past: [], present: design, future: [] };
}

export function recordEdit(history: EditHistory, next: TerminalDesign): EditHistory {
  if (unchanged(history.present, next)) return history;
  return {
    past: [...history.past, history.present].slice(-LIMIT),
    present: next,
    future: []
  };
}

/** Update drag preview without filling the undo stack with pointer-move events. */
export function previewDrag(history: EditHistory, next: TerminalDesign): EditHistory {
  return unchanged(history.present, next) ? history : { ...history, present: next };
}

/** Record one undo step for an entire drag gesture. */
export function finishDrag(history: EditHistory, before: TerminalDesign): EditHistory {
  if (unchanged(before, history.present)) return history;
  return {
    past: [...history.past, before].slice(-LIMIT),
    present: history.present,
    future: []
  };
}

export function undoEdit(history: EditHistory): EditHistory {
  if (!history.past.length) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, LIMIT)
  };
}

export function redoEdit(history: EditHistory): EditHistory {
  if (!history.future.length) return history;
  const next = history.future[0];
  return {
    past: [...history.past, history.present].slice(-LIMIT),
    present: next,
    future: history.future.slice(1)
  };
}
