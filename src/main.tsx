import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addLayer, clonePreset, moveLayer, reorderLayer, renderSvg, sanitizeDesign,
  type Layer, type LayerKind, type TerminalDesign, type Theme
} from "./model";
import "./style.css";

const PREVIEW_COUNT = 12856;
const names: Record<LayerKind, string> = {
  text: "Text", count: "Visitor count", dot: "Status light", panel: "Panel"
};
type DragState = {
  id: string; pointerId: number; startX: number; startY: number; x: number; y: number;
};

function App() {
  const [design, setDesign] = useState<TerminalDesign>(() => clonePreset("pixel"));
  const [selectedId, setSelectedId] = useState<string | null>("heading");
  const [demoCount, setDemoCount] = useState(PREVIEW_COUNT);
  const [notice, setNotice] = useState("Drag an element to move it, or use arrow keys.");
  const nextId = useRef(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const selected = design.layers.find(layer => layer.id === selectedId) ?? null;
  const svg = renderSvg(design, demoCount);
  const preview = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

  function updateDesign(patch: Partial<TerminalDesign>) {
    setDesign(current => sanitizeDesign({ ...current, ...patch }));
  }

  function updateSelected(patch: Partial<Layer>) {
    if (!selectedId) return;
    setDesign(current => sanitizeDesign({
      ...current, layers: current.layers.map(layer => layer.id === selectedId ? { ...layer, ...patch } : layer)
    }));
  }

  function changePreset(theme: Theme) {
    setDesign(clonePreset(theme));
    setSelectedId("heading");
    setNotice("Template loaded. You can change every layer.");
  }

  function insertLayer(kind: LayerKind) {
    let id = "";
    do { id = "custom_" + nextId.current++; } while (design.layers.some(layer => layer.id === id));
    setDesign(current => addLayer(current, kind, id));
    setSelectedId(id);
    setNotice(names[kind] + " added. Drag it in the preview.");
  }

  function removeSelected() {
    if (!selectedId) return;
    setDesign(current => ({ ...current, layers: current.layers.filter(layer => layer.id !== selectedId) }));
    setSelectedId(null);
    setNotice("Layer removed.");
  }

  function startDrag(event: React.PointerEvent<HTMLButtonElement>, layer: Layer) {
    if (event.button !== 0) return;
    event.preventDefault();
    setSelectedId(layer.id);
    dragRef.current = {
      id: layer.id, pointerId: event.pointerId, startX: event.clientX,
      startY: event.clientY, x: layer.x, y: layer.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event: React.PointerEvent<HTMLButtonElement>) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage || !stage.width || !stage.height) return;
    const x = state.x + (event.clientX - state.startX) * design.width / stage.width;
    const y = state.y + (event.clientY - state.startY) * design.height / stage.height;
    setDesign(current => {
      const layer = current.layers.find(item => item.id === state.id);
      return layer ? moveLayer(current, state.id, x - layer.x, y - layer.y) : current;
    });
  }

  function stopDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function nudge(event: React.KeyboardEvent<HTMLButtonElement>, id: string) {
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
    };
    const direction = keys[event.key];
    if (!direction) return;
    event.preventDefault();
    setSelectedId(id);
    setDesign(current => moveLayer(current, id,
      direction[0] * (event.shiftKey ? 10 : 1),
      direction[1] * (event.shiftKey ? 10 : 1)));
  }

  function downloadFile(data: string, filename: string, mime: string) {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copySvg() {
    try {
      await navigator.clipboard.writeText(svg);
      setNotice("SVG source copied.");
    } catch {
      setNotice("Clipboard access unavailable. Use Download SVG instead.");
    }
  }

  async function importDesign(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 65536) { setNotice("Design file exceeds the 64 KB limit."); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || !("schemaVersion" in parsed) ||
          (parsed as { schemaVersion: unknown }).schemaVersion !== 1 ||
          !("layers" in parsed) || !Array.isArray((parsed as { layers: unknown }).layers)) {
        throw Error("Invalid schema");
      }
      const restored = sanitizeDesign(parsed);
      setDesign(restored);
      setSelectedId(restored.layers[0]?.id ?? null);
      setNotice("Design loaded locally.");
    } catch {
      setNotice("Invalid design JSON. Please import a file exported from this editor.");
    }
  }

  return (
    <main className="app">
      <header className="site-head">
        <div className="site-brand"><span className="brand-mark" aria-hidden="true">▣</span> WORKSHOP STUDIO <span className="beta">ALPHA</span></div>
        <h1>Make every visit your own.</h1>
        <p>Design a personal visitor counter for your GitHub README. Build it visually, preview it instantly, and export it as SVG.</p>
      </header>
      <div className="workspace">
        <aside className="panel editor" aria-label="Editor">
          <div className="panel-head"><h2>Design tools</h2><span className="muted">01 / STUDIO</span></div>
          <label className="field">Start with a template
            <select value={design.theme} onChange={event => changePreset(event.target.value as Theme)}>
              <option value="pixel">🎮 Pixel Terminal</option>
              <option value="cyber">✧ Cyber HUD</option>
              <option value="minimal">◻ Minimal</option>
            </select>
          </label>
          <div className="section-title"><h3>Add a layer</h3><span>MAX 32</span></div>
          <div className="tool-grid">
            {(["text", "count", "dot", "panel"] as LayerKind[]).map(kind =>
              <button type="button" className="tool-button" onClick={() => insertLayer(kind)} key={kind}
                disabled={design.layers.length >= 32}>{names[kind]} <span aria-hidden="true">+</span></button>)}
          </div>
          <div className="section-title"><h3>Layers</h3><span>{design.layers.length} ELEMENTS</span></div>
          <ol className="layer-list" aria-label="Layer order, front to back">
            {[...design.layers].reverse().map(layer => (
              <li key={layer.id}>
                <button type="button"
                  className={"layer-row" + (layer.id === selectedId ? " active" : "")}
                  aria-pressed={layer.id === selectedId} onClick={() => setSelectedId(layer.id)}>
                  <span className="layer-symbol" aria-hidden="true">{layer.kind === "count" ? "#" : layer.kind === "dot" ? "●" : layer.kind === "panel" ? "▭" : "T"}</span>
                  <span className="layer-name">{layer.kind === "text" ? layer.text || "Empty text" : names[layer.kind]}</span>
                  <span className="layer-visibility">{layer.visible ? "" : "hidden"}</span>
                </button>
              </li>
            ))}
          </ol>
          {selected && <section className="properties" aria-label="Selected layer properties">
            <div className="section-title"><h3>Edit · {names[selected.kind]}</h3>
              <button type="button" className="danger small" onClick={removeSelected}>Delete</button>
            </div>
            {(selected.kind === "text") && <label className="field">Text
              <input value={selected.text} maxLength={120} onChange={event => updateSelected({ text: event.target.value })}/>
            </label>}
            <label className="toggle"><input type="checkbox" checked={selected.visible}
              onChange={event => updateSelected({ visible: event.target.checked })}/> Show this layer</label>
            <div className="form-grid">
              {(["x", "y", "width", "height"] as const).map(key =>
                <label className="field" key={key}>{key.toUpperCase()}
                  <input type="number" min={key === "width" || key === "height" ? 8 : 0}
                    max={key === "x" || key === "width" ? design.width : design.height}
                    value={selected[key]} onChange={event => {
                      const v = event.target.valueAsNumber;
                      if (Number.isFinite(v)) updateSelected({ [key]: v });
                    }}/>
                </label>)}
              {(selected.kind === "text" || selected.kind === "count") && <label className="field">Font size
                <input type="number" min={8} max={80} value={selected.fontSize}
                  onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) updateSelected({ fontSize: event.target.valueAsNumber }); }}/>
              </label>}
              <label className="field">Color
                <input type="color" value={selected.color} onChange={event => updateSelected({ color: event.target.value })}/>
              </label>
            </div>
            <div className="layer-actions">
              <button type="button" className="secondary small" onClick={() => setDesign(d => reorderLayer(d, selected.id, -1))}>Send back</button>
              <button type="button" className="secondary small" onClick={() => setDesign(d => reorderLayer(d, selected.id, 1))}>Bring forward</button>
            </div>
          </section>}
          {!selected && <p className="note">Select any layer in the list or preview to edit it.</p>}
          <div className="section-title"><h3>Canvas</h3><span>README READY</span></div>
          <div className="form-grid">
            <label className="field">Background
              <input type="color" value={design.background} onChange={event => updateDesign({ background: event.target.value })}/>
            </label>
            <label className="field">Border
              <input type="color" value={design.accent} onChange={event => updateDesign({ accent: event.target.value })}/>
            </label>
            <label className="field">Width
              <input type="number" min={280} max={800} value={design.width}
                onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) updateDesign({ width: event.target.valueAsNumber }); }}/>
            </label>
            <label className="field">Height
              <input type="number" min={160} max={480} value={design.height}
                onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) updateDesign({ height: event.target.valueAsNumber }); }}/>
            </label>
          </div>
        </aside>
        <section className="panel preview-panel" aria-label="Live preview">
          <div className="panel-head">
            <h2>Live preview</h2>
            <span className="preview-status"><span className="online-dot" aria-hidden="true"/> SVG PREVIEW</span>
          </div>
          <div className="preview-banner"><span>DESIGN SURFACE</span><span>{design.width} × {design.height}</span></div>
          <div className="canvas">
            <div className="stage" ref={stageRef} style={{ width: design.width, aspectRatio: design.width + " / " + design.height }}>
              <img src={preview} alt="Custom visitor counter live preview" draggable={false}/>
              {design.layers.filter(layer => layer.visible).map(layer => (
                <button type="button" key={layer.id}
                  className={"target" + (layer.id === selectedId ? " selected" : "")}
                  aria-label={"Select and move " + (layer.kind === "text" ? layer.text || "empty text" : names[layer.kind]) + ". Arrow keys move by one pixel; Shift moves by ten."}
                  title={"Drag to move · " + names[layer.kind]}
                  style={{
                    left: layer.x / design.width * 100 + "%",
                    top: layer.y / design.height * 100 + "%",
                    width: layer.width / design.width * 100 + "%",
                    height: layer.height / design.height * 100 + "%"
                  }}
                  onPointerDown={event => startDrag(event, layer)}
                  onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag}
                  onKeyDown={event => nudge(event, layer.id)}/>
              ))}
            </div>
          </div>
          <div className="hint">✥ Drag layers on the preview · Arrow keys for precise positioning · Shift + arrows for 10px</div>
          <div className="preview-footer">
            <label className="field demo-count">Example visit count
              <input type="number" min={0} max={999999999} value={demoCount} onChange={event =>
                setDemoCount(Math.max(0, Math.min(999999999, Number(event.target.value) || 0)))}/>
            </label>
            <span className="muted">Preview only · Not a live counter</span>
          </div>
          <div className="export">
            <button type="button" onClick={() => downloadFile(svg, "visitor-terminal.svg", "image/svg+xml")}>Download SVG ↗</button>
            <button type="button" className="secondary" onClick={() => downloadFile(JSON.stringify(design, null, 2), "visitor-terminal.design.json", "application/json")}>Save design</button>
            <label className="secondary import-label">Load design <input type="file" accept=".json,application/json" onChange={importDesign}/></label>
            <button type="button" className="secondary" onClick={copySvg}>Copy SVG</button>
          </div>
          <p className="notice" role="status">{notice}</p>
          <div className="disclaimer">GitHub caches README images. Hosted counting and one-click embed URLs are future milestones; this editor currently exports static SVG artwork.</div>
        </section>
      </div>
      <footer>WORKSHOP VISITOR TERMINAL <span aria-hidden="true">·</span> OPEN SOURCE <span aria-hidden="true">·</span> STUDIO ALPHA</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
