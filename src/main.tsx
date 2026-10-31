import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addLayer, moveLayer, reorderLayer, renderSvg, sanitizeDesign,
  type Layer, type LayerKind, type TerminalDesign, type Theme
} from "./model";
import {
  createLocalizedPreset, LANGUAGE_STORAGE_KEY, readPreferredLanguage, translations,
  type Language
} from "./i18n";
import "./style.css";

const PREVIEW_COUNT = 12856;
type MessageKey = keyof typeof translations.en;

type DragState = {
  id: string; pointerId: number; startX: number; startY: number; x: number; y: number;
};

function App() {
  const [language, setLanguage] = useState<Language>(readPreferredLanguage);
  const [design, setDesign] = useState<TerminalDesign>(() => createLocalizedPreset("pixel", readPreferredLanguage()));
  const [selectedId, setSelectedId] = useState<string | null>("heading");
  const [demoCount, setDemoCount] = useState(PREVIEW_COUNT);
  const [noticeKey, setNoticeKey] = useState<MessageKey>("noticeInitial");
  const nextId = useRef(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const t = translations[language];
  const names: Record<LayerKind, string> = {
    text: t.layerText, count: t.layerCount, dot: t.layerDot, panel: t.layerPanel
  };
  const selected = design.layers.find(layer => layer.id === selectedId) ?? null;
  const svg = renderSvg(design, demoCount);
  const preview = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const layerName = (layer: Layer): string =>
    layer.kind === "text" ? layer.text || t.blankText : names[layer.kind];

  // Locale changes affect UI labels only. Never replace or translate a working design.
  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // The editor also works in browsers that block local storage.
    }
  }, [language]);

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
    setDesign(createLocalizedPreset(theme, language));
    setSelectedId("heading");
    setNoticeKey("noticeTemplate");
  }

  function insertLayer(kind: LayerKind) {
    let id = "";
    do { id = "custom_" + nextId.current++; } while (design.layers.some(layer => layer.id === id));
    setDesign(current => {
      const next = addLayer(current, kind, id);
      // Only a newly created layer gets a localized initial value.
      return language === "zh-CN" && kind === "text"
        ? { ...next, layers: next.layers.map(layer => layer.id === id ? { ...layer, text: "你的文字" } : layer) }
        : next;
    });
    setSelectedId(id);
    setNoticeKey("noticeAdded");
  }

  function removeSelected() {
    if (!selectedId) return;
    setDesign(current => ({ ...current, layers: current.layers.filter(layer => layer.id !== selectedId) }));
    setSelectedId(null);
    setNoticeKey("noticeRemoved");
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
      setNoticeKey("noticeCopied");
    } catch {
      setNoticeKey("noticeClipboardError");
    }
  }

  async function importDesign(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 65536) { setNoticeKey("noticeTooLarge"); return; }
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
      setNoticeKey("noticeImported");
    } catch {
      setNoticeKey("noticeBadFile");
    }
  }

  return (
    <main className="app">
      <header className="site-head">
        <div className="topline">
          <div className="site-brand">
            <span className="brand-mark" aria-hidden="true">▣</span> WORKSHOP STUDIO
            <span className="beta">{t.alpha}</span>
          </div>
          <div className="language-switch" role="group" aria-label={t.languageLabel}>
            <span className="language-icon" aria-hidden="true">🌐</span>
            <button type="button" lang="zh-CN" aria-pressed={language === "zh-CN"}
              className={language === "zh-CN" ? "active" : ""} onClick={() => setLanguage("zh-CN")}>
              简体中文
            </button>
            <button type="button" lang="en" aria-pressed={language === "en"}
              className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>
              English
            </button>
          </div>
        </div>
        <h1>{t.heading}</h1>
        <p>{t.intro}</p>
      </header>
      <div className="workspace">
        <aside className="panel editor" aria-label={t.editorLabel}>
          <div className="panel-head"><h2>{t.designTools}</h2><span className="muted">{t.studioTag}</span></div>
          <label className="field">{t.templateLabel}
            <select value={design.theme} onChange={event => changePreset(event.target.value as Theme)}>
              <option value="pixel">{t.pixelTemplate}</option>
              <option value="cyber">{t.cyberTemplate}</option>
              <option value="minimal">{t.minimalTemplate}</option>
            </select>
          </label>
          <div className="section-title"><h3>{t.addLayer}</h3><span>{t.maxLayers}</span></div>
          <div className="tool-grid">
            {(["text", "count", "dot", "panel"] as LayerKind[]).map(kind =>
              <button type="button" className="tool-button" onClick={() => insertLayer(kind)} key={kind}
                disabled={design.layers.length >= 32}>{names[kind]} <span aria-hidden="true">+</span></button>)}
          </div>
          <div className="section-title"><h3>{t.layerList}</h3><span>{design.layers.length} {t.elements}</span></div>
          <ol className="layer-list" aria-label={t.layerOrderLabel}>
            {[...design.layers].reverse().map(layer => (
              <li key={layer.id}>
                <button type="button" className={"layer-row" + (layer.id === selectedId ? " active" : "")}
                  aria-pressed={layer.id === selectedId} onClick={() => setSelectedId(layer.id)}>
                  <span className="layer-symbol" aria-hidden="true">
                    {layer.kind === "count" ? "#" : layer.kind === "dot" ? "●" : layer.kind === "panel" ? "▭" : "T"}
                  </span>
                  <span className="layer-name">{layerName(layer)}</span>
                  <span className="layer-visibility">{layer.visible ? "" : t.hidden}</span>
                </button>
              </li>
            ))}
          </ol>
          {selected && <section id="layer-properties" className="properties" aria-label={t.editProperties}>
            <div className="section-title">
              <h3>{t.edit} · {names[selected.kind]}</h3>
              <button type="button" className="danger small" onClick={removeSelected}>{t.delete}</button>
            </div>
            {selected.kind === "text" && <label className="field">{t.textLabel}
              <input value={selected.text} maxLength={120} onChange={event => updateSelected({ text: event.target.value })}/>
            </label>}
            <label className="toggle"><input type="checkbox" checked={selected.visible}
              onChange={event => updateSelected({ visible: event.target.checked })}/>{t.visibilityLabel}</label>
            <div className="form-grid">
              {(["x", "y", "width", "height"] as const).map(key => (
                <label className="field" key={key}>
                  {key === "x" ? t.xLabel : key === "y" ? t.yLabel : key === "width" ? t.widthLabel : t.heightLabel}
                  <input type="number" min={key === "width" || key === "height" ? 8 : 0}
                    max={key === "x" || key === "width" ? design.width : design.height}
                    value={selected[key]} onChange={event => {
                      if (Number.isFinite(event.target.valueAsNumber)) updateSelected({ [key]: event.target.valueAsNumber });
                    }}/>
                </label>
              ))}
              {(selected.kind === "text" || selected.kind === "count") && <label className="field">{t.fontSize}
                <input type="number" min={8} max={80} value={selected.fontSize}
                  onChange={event => {
                    if (Number.isFinite(event.target.valueAsNumber)) updateSelected({ fontSize: event.target.valueAsNumber });
                  }}/>
              </label>}
              <label className="field">{t.color}
                <input type="color" value={selected.color} onChange={event => updateSelected({ color: event.target.value })}/>
              </label>
            </div>
            <div className="layer-actions">
              <button type="button" className="secondary small"
                onClick={() => setDesign(d => reorderLayer(d, selected.id, -1))}>{t.sendBack}</button>
              <button type="button" className="secondary small"
                onClick={() => setDesign(d => reorderLayer(d, selected.id, 1))}>{t.bringForward}</button>
            </div>
          </section>}
          {!selected && <p className="note">{t.selectLayer}</p>}
          <div className="section-title"><h3>{t.canvas}</h3><span>{t.readmeReady}</span></div>
          <div className="form-grid">
            <label className="field">{t.background}
              <input type="color" value={design.background}
                onChange={event => updateDesign({ background: event.target.value })}/>
            </label>
            <label className="field">{t.border}
              <input type="color" value={design.accent} onChange={event => updateDesign({ accent: event.target.value })}/>
            </label>
            <label className="field">{t.widthLabel}
              <input type="number" min={280} max={800} value={design.width}
                onChange={event => {
                  if (Number.isFinite(event.target.valueAsNumber)) updateDesign({ width: event.target.valueAsNumber });
                }}/>
            </label>
            <label className="field">{t.heightLabel}
              <input type="number" min={160} max={480} value={design.height}
                onChange={event => {
                  if (Number.isFinite(event.target.valueAsNumber)) updateDesign({ height: event.target.valueAsNumber });
                }}/>
            </label>
          </div>
        </aside>
        <section id="live-preview" className="panel preview-panel" aria-label={t.livePreview}>
          <div className="panel-head">
            <h2>{t.livePreview}</h2>
            <span className="preview-status"><span className="online-dot" aria-hidden="true"/>{t.svgPreview}</span>
          </div>
          <div className="preview-banner"><span>{t.designSurface}</span><span>{design.width} × {design.height}</span></div>
          <div className="canvas">
            <div className="stage" ref={stageRef}
              style={{ width: design.width, aspectRatio: design.width + " / " + design.height }}>
              <img src={preview} alt={t.imageAlt} draggable={false}/>
              {design.layers.filter(layer => layer.visible).map(layer => (
                <button type="button" key={layer.id}
                  className={"target" + (layer.id === selectedId ? " selected" : "")}
                  aria-label={t.selectAndMove + " " + layerName(layer) + ". " + t.keyboardHelp}
                  title={t.dragTitle + " · " + names[layer.kind]}
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
          <div className="touch-tools" aria-label={t.moveSelectedLabel}>
            <div className="touch-tools-copy">
              <strong>{selected ? t.moving + " " + layerName(selected) : t.selectFirst}</strong>
              <span>{t.tapArrows}</span>
              <a href="#layer-properties" className={selected ? "edit-jump" : "edit-jump disabled"}
                aria-disabled={!selected} onClick={event => { if (!selected) event.preventDefault(); }}>
                {t.editProperties}
              </a>
            </div>
            <div className="nudge-pad">
              <button className="nudge-up" aria-label={t.up} title={t.up}
                type="button" disabled={!selected} onClick={() => setDesign(current => moveLayer(current, selectedId!, 0, -5))}>↑</button>
              <button className="nudge-left" aria-label={t.left} title={t.left}
                type="button" disabled={!selected} onClick={() => setDesign(current => moveLayer(current, selectedId!, -5, 0))}>←</button>
              <button className="nudge-down" aria-label={t.down} title={t.down}
                type="button" disabled={!selected} onClick={() => setDesign(current => moveLayer(current, selectedId!, 0, 5))}>↓</button>
              <button className="nudge-right" aria-label={t.right} title={t.right}
                type="button" disabled={!selected} onClick={() => setDesign(current => moveLayer(current, selectedId!, 5, 0))}>→</button>
            </div>
          </div>
          <div className="hint">{t.positioningHelp}</div>
          <div className="preview-footer">
            <label className="field demo-count">{t.exampleCount}
              <input type="number" min={0} max={999999999} value={demoCount} onChange={event =>
                setDemoCount(Math.max(0, Math.min(999999999, Number(event.target.value) || 0)))}/>
            </label>
            <span className="muted">{t.demoWarning}</span>
          </div>
          <div className="export">
            <button type="button" onClick={() => downloadFile(svg, "visitor-terminal.svg", "image/svg+xml")}>{t.downloadSvg}</button>
            <button type="button" className="secondary"
              onClick={() => downloadFile(JSON.stringify(design, null, 2), "visitor-terminal.design.json", "application/json")}>{t.saveDesign}</button>
            <label className="secondary import-label">{t.loadDesign}
              <input type="file" aria-label={t.importLabel}
                accept=".json,application/json" onChange={importDesign}/>
            </label>
            <button type="button" className="secondary" onClick={copySvg}>{t.copySvg}</button>
          </div>
          <p className="notice" role="status">{t[noticeKey]}</p>
          <div className="disclaimer">{t.disclosure}</div>
        </section>
      </div>
      <footer>WORKSHOP VISITOR TERMINAL <span aria-hidden="true">·</span> {t.footerOpenSource}
        <span aria-hidden="true">·</span> {t.footerAlpha}
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
