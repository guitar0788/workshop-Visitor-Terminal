import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { presets, renderSvg, type TerminalDesign, type Theme } from "./model";
import "./style.css";
function App() {
  const [design, setDesign] = useState<TerminalDesign>({ ...presets.pixel });
  const [visits, setVisits] = useState(12856);
  const [copied, setCopied] = useState(false);
  const svg = renderSvg(design, visits);
  const preview = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const update = (patch: Partial<TerminalDesign>) => { setDesign(d => ({ ...d, ...patch })); setCopied(false); };
  function download() {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a"); a.href = url; a.download = "workshop-terminal.svg"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="app">
    <header><p className="eyebrow">WORKSHOP VISITOR TERMINAL</p><h1>Design your own profile counter.</h1><p>Build a README-ready SVG with live visual controls. No account required for this local preview.</p></header>
    <div className="workspace"><section className="panel controls" aria-label="Editor controls">
      <h2>Editor</h2>
      <label>Template<select value={design.theme} onChange={e => setDesign({ ...presets[e.target.value as Theme] })}>
        <option value="pixel">Pixel Terminal</option><option value="minimal">Minimal</option><option value="cyber">Cyber HUD</option></select></label>
      <label>Terminal title<input maxLength={40} value={design.title} onChange={e => update({ title: e.target.value })}/></label>
      <label>Counter label<input maxLength={30} value={design.label} onChange={e => update({ label: e.target.value })}/></label>
      <div className="colors"><label>Accent color<input type="color" value={design.accent} onChange={e => update({ accent: e.target.value })}/></label>
      <label>Background<input type="color" value={design.background} onChange={e => update({ background: e.target.value })}/></label></div>
      <label>Width ({design.width}px)<input type="range" min="280" max="800" step="10" value={design.width} onChange={e => update({ width: Number(e.target.value) })}/></label>
      <label>Demo visit count<input type="number" min="0" max="999999999" value={visits} onChange={e => setVisits(Math.max(0, Math.min(999999999, Number(e.target.value) || 0)))}/></label>
      <p className="note">Demo numbers are not real visits. Hosted counting and README URLs are planned for a later release.</p>
    </section>
    <section className="panel preview" aria-label="Live preview"><div className="previewHead"><h2>Live preview</h2><span>SVG</span></div>
      <div className="canvas"><img src={preview} alt="Custom visitor counter preview" style={{ maxWidth: "100%" }}/></div>
      <div className="actions"><button onClick={download}>Download SVG</button><button className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(svg); setCopied(true); } catch { setCopied(false); } }}>Copy SVG source</button></div>
      <p role="status" className="note">{copied ? "SVG source copied." : "This is a static design preview, not a live counter."}</p>
    </section></div>
    <footer>Open source · Visual editor prototype · No tracking in this preview</footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
