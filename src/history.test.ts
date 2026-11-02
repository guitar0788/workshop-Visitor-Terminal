import { describe, expect, it } from "vitest";
import { clonePreset, duplicateLayer, moveLayer, renderSvg } from "./model";
import {
  createHistory, finishDrag, previewDrag, recordEdit, redoEdit, undoEdit
} from "./history";

describe("mobile studio history and editing", () => {
  it("undoes and redoes a single design change without mutating source", () => {
    const original = clonePreset("pixel");
    const next = moveLayer(original, "heading", 20, 10);
    const state = recordEdit(createHistory(original), next);
    expect(state.past).toHaveLength(1);
    expect(state.present.layers[0].x).toBe(44);
    const undone = undoEdit(state);
    expect(undone.present.layers[0].x).toBe(24);
    expect(undone.future).toHaveLength(1);
    const redone = redoEdit(undone);
    expect(redone.present.layers[0].x).toBe(44);
    expect(original.layers[0].x).toBe(24);
  });

  it("clears redo history after a new committed action", () => {
    const first = createHistory(clonePreset("pixel"));
    const changed = recordEdit(first, moveLayer(first.present, "heading", 10, 0));
    const undone = undoEdit(changed);
    expect(undone.future).toHaveLength(1);
    const newEdit = recordEdit(undone, moveLayer(undone.present, "heading", 0, 5));
    expect(newEdit.future).toHaveLength(0);
    expect(redoEdit(newEdit)).toBe(newEdit);
  });

  it("records a whole pointer drag as a single history action", () => {
    const original = clonePreset("cyber");
    let history = createHistory(original);
    for (let i = 1; i < 8; i++) {
      history = previewDrag(history, moveLayer(original, "heading", i * 3, i * 2));
    }
    expect(history.past).toHaveLength(0);
    const committed = finishDrag(history, original);
    expect(committed.past).toHaveLength(1);
    expect(undoEdit(committed).present).toEqual(original);
  });

  it("records duplication as one undoable and redoable edit without altering the source", () => {
    const original = clonePreset("mc-nether");
    const copied = duplicateLayer(original, "heading", "heading_copy");
    const history = recordEdit(createHistory(original), copied);
    expect(history.past).toHaveLength(1);
    expect(history.present.layers.some(layer => layer.id === "heading_copy")).toBe(true);
    const undone = undoEdit(history);
    expect(undone.present).toEqual(original);
    expect(undone.future).toHaveLength(1);
    expect(redoEdit(undone).present).toEqual(copied);
    expect(original.layers.some(layer => layer.id === "heading_copy")).toBe(false);
  });

  it("ignores a no-op gesture", () => {
    const original = clonePreset("minimal");
    const history = createHistory(original);
    expect(finishDrag(history, original)).toBe(history);
    expect(recordEdit(history, original)).toBe(history);
    expect(undoEdit(history)).toBe(history);
    expect(redoEdit(history)).toBe(history);
  });

  it("limits undo memory while preserving the most recent edits", () => {
    let history = createHistory(clonePreset("pixel"));
    for (let i = 0; i < 75; i++) {
      history = recordEdit(history, moveLayer(
        history.present, "heading", i % 2 === 0 ? 1 : -1, 0
      ));
    }
    expect(history.past.length).toBeLessThanOrEqual(60);
  });

  it("editing and undoing never changes the exported SVG from source design", () => {
    const original = clonePreset("pixel");
    const svg = renderSvg(original, 123);
    const moved = recordEdit(createHistory(original), moveLayer(original, "heading", 5, 5));
    expect(renderSvg(undoEdit(moved).present, 123)).toBe(svg);
  });
});
