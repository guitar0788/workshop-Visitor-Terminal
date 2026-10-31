export type Theme = "pixel" | "minimal" | "cyber";
export interface TerminalDesign { title: string; label: string; accent: string; background: string; theme: Theme; width: number; }
export const presets: Record<Theme, TerminalDesign> = {
  pixel: { title: "WORKSHOP TERMINAL", label: "TOTAL VISITS", accent: "#7ee787", background: "#101820", theme: "pixel", width: 420 },
  minimal: { title: "PROFILE VIEWS", label: "VISITS", accent: "#2563eb", background: "#111827", theme: "minimal", width: 420 },
  cyber: { title: "CYBER COUNTER", label: "VISITORS", accent: "#22d3ee", background: "#0b1020", theme: "cyber", width: 420 }
};
export function sanitizeDesign(d: TerminalDesign): TerminalDesign {
  return { ...d, title: d.title.slice(0, 40), label: d.label.slice(0, 30),
    accent: /^#[0-9a-fA-F]{6}$/.test(d.accent) ? d.accent : "#7ee787",
    background: /^#[0-9a-fA-F]{6}$/.test(d.background) ? d.background : "#101820",
    width: Math.max(280, Math.min(800, Math.round(Number(d.width) || 420))) };
}
export function escapeXml(v: string): string { return v.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&apos;" })[c]!); }
export function renderSvg(input: TerminalDesign, visits: number): string {
  const d = sanitizeDesign(input), n = Number.isFinite(visits) ? Math.max(0, Math.floor(visits)) : 0;
  const border = d.theme === "minimal" ? 1 : 3;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="190" viewBox="0 0 ${d.width} 190" role="img" aria-label="${escapeXml(d.label)}: ${n.toLocaleString("en-US")}">
<rect x="2" y="2" width="${d.width - 4}" height="186" rx="${d.theme === "pixel" ? 2 : 12}" fill="${d.background}" stroke="${d.accent}" stroke-width="${border}"/>
<circle cx="${d.width - 27}" cy="26" r="5" fill="${d.accent}"/>
<g fill="${d.accent}" font-family="monospace"><text x="24" y="33" font-size="15" font-weight="bold">${escapeXml(d.title)}</text><text x="24" y="80" font-size="13">${escapeXml(d.label)}</text><text x="24" y="139" font-size="44" font-weight="bold">${n.toLocaleString("en-US")}</text><text x="24" y="169" font-size="11">SYSTEM READY</text></g></svg>`;
}
