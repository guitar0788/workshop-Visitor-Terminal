import React, { useEffect, useMemo, useRef, useState } from "react";
import { isApprovedTheme, approvedCanvasWidth } from "./approved-reference-cards";
import { isCardTheme } from "./card-art";
import { createRoot } from "react-dom/client";
import {
  addLayer, CARD_THEMES, MAX_VISITOR_COUNT, moveLayer, reorderLayer, renderSvg, resizeCanvas, sanitizeDesign,
  type Layer, type LayerKind, type TerminalDesign, type Theme
} from "./model";
import {
  createLocalizedPreset, LANGUAGE_STORAGE_KEY, readPreferredLanguage, translations,
  type Language
} from "./i18n";
import {
  createHistory, finishDrag, previewDrag, recordEdit, redoEdit, undoEdit,
  type EditHistory
} from "./history";
import {
  OFFLINE_DEMO_MODE, PUBLISH_UI_ENABLED, PUBLISH_PILOT_MODE, beginGitHubLogin, exchangeGitHubReturn, logoutPublishing,
  deletePublishedCounter, exportPublishedAccount, markdownEmbed, myCounters, publishDesign,
  readOAuthReturn, revokeAllPublishedSessions, savePublished,
  type PublishedCounter, type PublishSession
} from "./publish-client";
import "./style.css";

// Preserve the original sample count on all six untouched illustrated styles
// and the three legacy themes. Only the owner-approved 1 / 3 / 5 artwork uses
// its exact 12,847 source-image sample when first selected.
const PREVIEW_COUNT = 12856;
const APPROVED_PREVIEW_COUNT = 12847;
type MessageKey = keyof typeof translations.en;
type MobileTab = "preview" | "layers" | "properties" | "export";
type DragState = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  before: TerminalDesign;
};

function App() {
  const [language, setLanguage] = useState<Language>(readPreferredLanguage);
  const [history, setHistory] = useState<EditHistory>(
    () => createHistory(createLocalizedPreset("pixel", readPreferredLanguage()))
  );
  const [selectedId, setSelectedId] = useState<string | null>("heading");
  const [demoCount, setDemoCount] = useState(PREVIEW_COUNT);
  const [noticeKey, setNoticeKey] = useState<MessageKey>("noticeInitial");
  const [mobileTab, setMobileTab] = useState<MobileTab>("preview");
  const [cleanPreview, setCleanPreview] = useState(false);
  const [galleryExpanded, setGalleryExpanded] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
  const [preciseOpen, setPreciseOpen] = useState(false);
  const [publishSession, setPublishSession] = useState<PublishSession | null>(null);
  const [publishedCounters, setPublishedCounters] = useState<PublishedCounter[]>([]);
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  const [publishingBusy, setPublishingBusy] = useState(false);
  const [publishNotice, setPublishNotice] = useState("");
  const [deleteTargetSlug, setDeleteTargetSlug] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [signOutEverywhereOpen, setSignOutEverywhereOpen] = useState(false);
  const handledAuth = useRef(false);
  const nextId = useRef(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const design = history.present;
  const t = translations[language];
  const names: Record<LayerKind, string> = {
    text: t.layerText, count: t.layerCount, dot: t.layerDot, panel: t.layerPanel
  };
  const selected = design.layers.find(layer => layer.id === selectedId) ?? null;
  const svg = renderSvg(design, demoCount);
  const preview = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  // Re-render thumbnails only when their localized stock captions change,
  // not on every pointer drag, counter update or undo/redo operation.
  const cardPreviews = useMemo(() => CARD_THEMES.map(theme => ({
    theme,
    src: "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(renderSvg(createLocalizedPreset(theme, language),
        isApprovedTheme(theme) ? APPROVED_PREVIEW_COUNT : PREVIEW_COUNT))
  })), [language]);
  const layerName = (layer: Layer) =>
    layer.kind === "text" ? layer.text || t.blankText : names[layer.kind];

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Language switching continues to work without persistent browser storage.
    }
  }, [language]);

  // OAuth return values are one-use. Remove them from the URL immediately;
  // React StrictMode may execute effects twice during local development.
  useEffect(() => {
    if (handledAuth.current) return;
    handledAuth.current = true;
    let result: ReturnType<typeof readOAuthReturn>;
    try {
      result = readOAuthReturn();
    } catch {
      setPublishNotice(translations[language].publishSignInError);
      return;
    }
    if (!result) return;
    if (!PUBLISH_UI_ENABLED) {
      setPublishNotice(translations[language].publishSignInError);
      return;
    }
    void exchangeGitHubReturn(result).then(async account => {
      setPublishSession(account);
      const owned = await myCounters(account.accessToken);
      setPublishedCounters(owned.counters);
      setPublishNotice(translations[language].publishAuthSuccess);
      setMobileTab("export");
    }).catch(() => setPublishNotice(translations[language].publishSignInError));
  // OAuth redirect should be processed once, independent of language changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshPublished(token: string) {
    const list = await myCounters(token);
    setPublishedCounters(list.counters);
  }

  async function loginPublishing() {
    if (publishingBusy) return;
    setPublishingBusy(true);
    try {
      await beginGitHubLogin();
    } catch {
      setPublishNotice(t.publishError);
      setPublishingBusy(false);
    }
  }

  async function publishNewCounter() {
    if (!publishSession || publishingBusy) return;
    setPublishingBusy(true);
    try {
      const created = await publishDesign(publishSession.accessToken, design);
      setPublishedSlug(created.slug);
      await refreshPublished(publishSession.accessToken);
      setPublishNotice(t.publishSuccess);
    } catch {
      setPublishNotice(t.publishError);
    } finally {
      setPublishingBusy(false);
    }
  }

  async function updatePublishedCounter() {
    if (!publishSession || !publishedSlug || publishingBusy) return;
    setPublishingBusy(true);
    try {
      await savePublished(publishSession.accessToken, publishedSlug, design);
      await refreshPublished(publishSession.accessToken);
      setPublishNotice(t.publishSaved);
    } catch {
      setPublishNotice(t.publishError);
    } finally {
      setPublishingBusy(false);
    }
  }

  async function copyPublishedMarkdown(counter: PublishedCounter) {
    try {
      await navigator.clipboard.writeText(markdownEmbed(counter.imageUrl));
      setPublishNotice(t.publishCopied);
    } catch {
      setPublishNotice(t.noticeClipboardError);
    }
  }

  function loadPublishedDesign(counter: PublishedCounter) {
    const restored = sanitizeDesign(counter.design);
    edit(() => restored);
    setSelectedId(restored.layers[0]?.id ?? null);
    setPublishedSlug(counter.slug);
    setPublishNotice(t.publishSelected + ": " + counter.slug);
  }

  function startDeleteConfirmation(slug: string) {
    if (publishingBusy) return;
    setDeleteTargetSlug(slug);
    setDeleteConfirmation("");
    setPublishNotice("");
  }

  function cancelDeleteConfirmation() {
    if (publishingBusy) return;
    setDeleteTargetSlug(null);
    setDeleteConfirmation("");
  }

  async function removePublishedCounter() {
    const slug = deleteTargetSlug;
    if (!publishSession || publishingBusy || !slug || deleteConfirmation !== slug ||
        !publishedCounters.some(counter => counter.slug === slug)) return;
    setPublishingBusy(true);
    try {
      await deletePublishedCounter(publishSession.accessToken, slug);
      setPublishedCounters(current => current.filter(counter => counter.slug !== slug));
      setPublishedSlug(current => current === slug ? null : current);
      setDeleteTargetSlug(null);
      setDeleteConfirmation("");
      setPublishNotice(t.publishDeleteSuccess);
    } catch {
      // Keep the explicit confirmation visible after a network error so that
      // a user can verify the counter still exists before trying again.
      setPublishNotice(t.publishDeleteError);
    } finally {
      setPublishingBusy(false);
    }
  }

  async function downloadPublishedAccount() {
    if (!publishSession || publishingBusy) return;
    setPublishingBusy(true);
    try {
      const data = await exportPublishedAccount(
        publishSession.accessToken, publishSession.user
      );
      // The backup is written on this device only and never uploaded or saved
      // by the Worker. It contains SVG designs, GitHub ID and visit totals.
      downloadFile(JSON.stringify(data, null, 2),
        "workshop-counter-account-" + publishSession.user.id + ".json",
        "application/json;charset=utf-8");
      setPublishNotice(t.publishAccountExportSuccess);
    } catch {
      setPublishNotice(t.publishAccountExportError);
    } finally {
      setPublishingBusy(false);
    }
  }

  async function signOutEverywhere() {
    if (!publishSession || publishingBusy || !signOutEverywhereOpen) return;
    setPublishingBusy(true);
    try {
      await revokeAllPublishedSessions(publishSession.accessToken);
      // Clear *all* personal browser state only after server revocation.
      setPublishSession(null);
      setPublishedCounters([]);
      setPublishedSlug(null);
      setDeleteTargetSlug(null);
      setDeleteConfirmation("");
      setSignOutEverywhereOpen(false);
      setPublishNotice(t.publishSignOutEverywhereSuccess);
    } catch {
      // A failed remote revocation is NOT a successful all-device logout.
      setPublishNotice(t.publishSignOutEverywhereError);
    } finally {
      setPublishingBusy(false);
    }
  }

  async function signOutPublishing() {
    if (!publishSession || publishingBusy) return;
    const token = publishSession.accessToken;
    // Clear the browser token even when network logout is unavailable.
    setPublishSession(null);
    setPublishedCounters([]);
    setPublishedSlug(null);
    setDeleteTargetSlug(null);
    setDeleteConfirmation("");
    setSignOutEverywhereOpen(false);
    setPublishNotice(t.publishSignedOut);
    try { await logoutPublishing(token); } catch {
      // The in-memory token is discarded regardless; the server token expires
      // after one hour even when the logout request cannot reach Cloudflare.
    }
  }

  function renderPublishing() {
    const selection = publishedCounters.find(item => item.slug === publishedSlug);
    return (
      <section className="publish-panel" aria-label={t.publishTitle}>
        <div className="publish-heading">
          <h3>{t.publishTitle}</h3>
          <span className={"publish-indicator" + (PUBLISH_UI_ENABLED ? " available" : "")}>
            {OFFLINE_DEMO_MODE ? "OFFLINE" : PUBLISH_UI_ENABLED ? "BETA" : "PREVIEW"}
          </span>
        </div>
        <p className="publish-cache-caveat" role="note">{t.githubProxyCountingNotice}</p>
        {PUBLISH_UI_ENABLED && PUBLISH_PILOT_MODE && (
          <p className="publish-hint" role="note">{t.publishPilotNotice}</p>
        )}
        {!PUBLISH_UI_ENABLED ? (
          <>
            <p className="publish-copy">
              {OFFLINE_DEMO_MODE ? t.offlinePublishUnavailable : t.publishUnavailable}
            </p>
            <p className="publish-hint">
              {OFFLINE_DEMO_MODE ? t.offlinePublishWarning : t.publishPreviewWarning}
            </p>
          </>
        ) : !publishSession ? (
          <>
            <p className="publish-copy">{t.publishSignInHint}</p>
            <button type="button" className="publish-primary" disabled={publishingBusy}
              onClick={() => void loginPublishing()}>
              {publishingBusy ? t.publishBusy : t.publishSignIn}
            </button>
          </>
        ) : (
          <>
            <div className="publish-account">
              <strong>{t.publishSession} · @{publishSession.user.login}</strong>
              <button type="button" className="secondary small"
                onClick={() => void signOutPublishing()}>{t.publishSignOut}</button>
            </div>
            <p className="publish-hint">{t.publishQuota}</p>
            <div className="publish-account-tools">
              <button type="button" className="secondary"
                disabled={publishingBusy}
                onClick={() => void downloadPublishedAccount()}>
                {t.publishAccountExport}
              </button>
              <button type="button" className="secondary"
                disabled={publishingBusy}
                aria-expanded={signOutEverywhereOpen}
                onClick={() => setSignOutEverywhereOpen(value => !value)}>
                {t.publishSignOutEverywhere}
              </button>
            </div>
            {signOutEverywhereOpen && (
              <div className="publish-session-confirm" role="group"
                aria-label={t.publishSignOutEverywhere}>
                <p>{t.publishSignOutEverywhereWarning}</p>
                <div className="publish-session-confirm-actions">
                  <button type="button" className="publish-revoke-confirm"
                    disabled={publishingBusy}
                    onClick={() => void signOutEverywhere()}>
                    {publishingBusy ? t.publishBusy : t.publishSignOutEverywhereConfirm}
                  </button>
                  <button type="button" className="secondary"
                    disabled={publishingBusy}
                    onClick={() => setSignOutEverywhereOpen(false)}>
                    {t.publishDeleteCancel}
                  </button>
                </div>
              </div>
            )}
            <div className="publish-actions">
              <button type="button" className="publish-primary"
                disabled={publishingBusy || publishedCounters.length >= 3}
                onClick={() => void publishNewCounter()}>
                {publishingBusy ? t.publishBusy : t.publishNew}
              </button>
              <button type="button" className="secondary"
                disabled={publishingBusy || !publishedSlug}
                onClick={() => void updatePublishedCounter()}>
                {t.publishUpdate}
              </button>
            </div>
            <p className="publish-hint">
              {selection ? t.publishSelected + ": " + selection.slug : t.publishNone}
            </p>
            <h4 className="publish-list-title">{t.publishList}</h4>
            <div className="publish-list">
              {publishedCounters.map(item => (
                <article className={"published-item" + (item.slug === publishedSlug ? " selected" : "")}
                  key={item.slug}>
                  <div className="published-summary">
                    <strong>{item.slug}</strong>
                    <span>{item.hits.toLocaleString()} {t.publishVisits}</span>
                  </div>
                  <div className="published-controls">
                    <button type="button" className="secondary small"
                      onClick={() => loadPublishedDesign(item)}>{t.publishLoad}</button>
                    <button type="button" className="secondary small"
                      onClick={() => void copyPublishedMarkdown(item)}>{t.publishCopy}</button>
                    <a href={item.imageUrl} target="_blank" rel="noopener noreferrer">
                      {t.publishOpen}</a>
                    <button type="button" className="publish-delete-trigger"
                      disabled={publishingBusy}
                      aria-expanded={deleteTargetSlug === item.slug}
                      onClick={() => deleteTargetSlug === item.slug
                        ? cancelDeleteConfirmation() : startDeleteConfirmation(item.slug)}>
                      {t.publishDelete}
                    </button>
                  </div>
                  {deleteTargetSlug === item.slug && (
                    <div className="publish-delete-confirm" role="group"
                      aria-label={t.publishDeleteConfirmTitle}>
                      <strong>{t.publishDeleteConfirmTitle}</strong>
                      <p>{t.publishDeleteWarning}</p>
                      <p className="publish-delete-slug">{item.slug}</p>
                      <label>{t.publishDeleteTypeSlug}
                        <input type="text" value={deleteConfirmation}
                          autoComplete="off" autoCapitalize="off" spellCheck={false}
                          disabled={publishingBusy}
                          onChange={event => setDeleteConfirmation(event.target.value)}
                          placeholder={item.slug}/>
                      </label>
                      <div className="publish-delete-buttons">
                        <button type="button" className="publish-delete-danger"
                          disabled={publishingBusy || deleteConfirmation !== item.slug}
                          onClick={() => void removePublishedCounter()}>
                          {publishingBusy ? t.publishBusy : t.publishDeleteForever}
                        </button>
                        <button type="button" className="secondary"
                          disabled={publishingBusy}
                          onClick={cancelDeleteConfirmation}>
                          {t.publishDeleteCancel}
                        </button>
                      </div>
                    </div>
                  )}
                  {publishedSlug === item.slug && (
                    <label className="field publish-markdown">{t.publishReadme}
                      <textarea value={markdownEmbed(item.imageUrl)} readOnly rows={2}
                        onFocus={event => event.currentTarget.select()}/>
                    </label>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
        {publishNotice && <p className="publish-notice" role="status">{publishNotice}</p>}
      </section>
    );
  }

  function edit(updater: (current: TerminalDesign) => TerminalDesign) {
    setHistory(current => recordEdit(current, updater(current.present)));
  }

  function updateDesign(patch: Partial<TerminalDesign>) {
    edit(current => {
      const next = patch.width !== undefined || patch.height !== undefined
        ? resizeCanvas(current, patch.width ?? current.width, patch.height ?? current.height)
        : current;
      return sanitizeDesign({ ...next, ...patch, width: next.width, height: next.height });
    });
  }

  function updateSelected(patch: Partial<Layer>) {
    if (!selectedId) return;
    edit(current => sanitizeDesign({
      ...current,
      layers: current.layers.map(layer =>
        layer.id === selectedId ? { ...layer, ...patch } : layer)
    }));
  }

  function changePreset(theme: Theme) {
    edit(() => createLocalizedPreset(theme, language));
    setDemoCount(isApprovedTheme(theme) ? APPROVED_PREVIEW_COUNT : PREVIEW_COUNT);
    setSelectedId(isApprovedTheme(theme) || theme.startsWith("mc-") ? "visits" : "heading");
    setCleanPreview(false);
    // On phones the picker lives in the Layers sheet: immediately show the
    // selected card, rather than leaving the new design hidden behind a sheet.
    setMobileTab("preview");
    setGalleryExpanded(false);
    setNoticeKey("noticeTemplate");
  }

  function insertLayer(kind: LayerKind) {
    let id = "";
    do { id = "custom_" + nextId.current++; }
    while (design.layers.some(layer => layer.id === id));
    edit(current => {
      const next = addLayer(current, kind, id);
      return language === "zh-CN" && kind === "text"
        ? {
            ...next,
            layers: next.layers.map(layer =>
              layer.id === id ? { ...layer, text: "你的文字" } : layer)
          }
        : next;
    });
    setSelectedId(id);
    setCleanPreview(false);
    setNoticeKey("noticeAdded");
  }

  function removeSelected() {
    if (!selectedId) return;
    edit(current => ({
      ...current,
      layers: current.layers.filter(layer => layer.id !== selectedId)
    }));
    setSelectedId(null);
    setNoticeKey("noticeRemoved");
  }

  function selectLayer(id: string, fromList = false) {
    setSelectedId(id);
    if (fromList) {
      setMobileTab("properties");
      setCleanPreview(false);
    }
  }

  function startDrag(event: React.PointerEvent<HTMLButtonElement>, layer: Layer) {
    if (event.button !== 0 || cleanPreview) return;
    selectLayer(layer.id);
    // On touch screens, a tap selects. Only explicit move mode captures
    // the pointer, so normal vertical page scrolling remains usable.
    if (event.pointerType === "touch" && !moveMode) return;
    event.preventDefault();
    dragRef.current = {
      id: layer.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      before: design
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event: React.PointerEvent<HTMLButtonElement>) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return;
    const dx = (event.clientX - state.startX) * state.before.width / bounds.width;
    const dy = (event.clientY - state.startY) * state.before.height / bounds.height;
    const next = moveLayer(state.before, state.id, dx, dy);
    setHistory(current => previewDrag(current, next));
  }

  function stopDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setHistory(current => finishDrag(current, state.before));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function nudge(event: React.KeyboardEvent<HTMLButtonElement>, id: string) {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      ArrowUp: [0, -1], ArrowDown: [0, 1]
    };
    const direction = directions[event.key];
    if (!direction || cleanPreview) return;
    event.preventDefault();
    selectLayer(id);
    const distance = event.shiftKey ? 10 : 1;
    edit(current => moveLayer(
      current, id, direction[0] * distance, direction[1] * distance
    ));
  }

  function nudgeSelected(dx: number, dy: number) {
    if (!selectedId) return;
    edit(current => moveLayer(current, selectedId, dx, dy));
  }

  function undo() {
    setHistory(undoEdit);
    setSelectedId(null); // Avoid highlighting a layer that might no longer exist.
    setNoticeKey("noticeInitial");
  }

  function redo() {
    setHistory(redoEdit);
    setSelectedId(null);
    setNoticeKey("noticeInitial");
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
      edit(() => restored);
      setSelectedId(restored.layers[0]?.id ?? null);
      setCleanPreview(false);
      setNoticeKey("noticeImported");
    } catch {
      setNoticeKey("noticeBadFile");
    }
  }

  function renderTemplates() {
    const cardLabels = [
      t.pixelCardTemplate, t.terminalCardTemplate, t.rpgCardTemplate,
      t.minecraftOverworldTemplate, t.minecraftNetherTemplate,
      t.minecraftEndTemplate
    ];
    return (
      <div className="template-picker">
        <label className="field">{t.templateLabel}
          <select value={design.theme}
            onChange={event => changePreset(event.target.value as Theme)}>
            <optgroup label={t.cardTemplates}>
              {CARD_THEMES.map((theme, index) =>
                <option key={theme} value={theme}>{cardLabels[index]}</option>)}
              {!CARD_THEMES.includes(design.theme as typeof CARD_THEMES[number]) &&
                !["pixel", "cyber", "minimal"].includes(design.theme) && (
                  <option value={design.theme}>{t.legacyTemplate} · {design.theme}</option>
                )}
            </optgroup>
            <optgroup label={t.classicTemplates}>
              <option value="pixel">{t.pixelTemplate}</option>
              <option value="cyber">{t.cyberTemplate}</option>
              <option value="minimal">{t.minimalTemplate}</option>
            </optgroup>
          </select>
        </label>
        <div className="template-gallery-head">
          <strong>{t.cardTemplates}</strong>
          <button type="button" className="gallery-expand"
            aria-expanded={galleryExpanded}
            onClick={() => setGalleryExpanded(current => !current)}>
            {galleryExpanded ? t.galleryCollapse : t.galleryExpand}
          </button>
        </div>
        <p className="template-gallery-hint">{t.galleryHint}</p>
        <div className={"template-gallery" + (galleryExpanded ? " expanded" : " compact")}
          aria-label={t.cardTemplates}>
          {cardPreviews.map(({ theme, src }, index) => {
            return (
              <button key={theme} type="button"
                className={"template-choice" + (design.theme === theme ? " active" : "")}
                aria-pressed={design.theme === theme}
                aria-label={cardLabels[index]}
                title={cardLabels[index]}
                onClick={() => changePreset(theme)}>
                <img alt="" loading="lazy" draggable={false}
                  width={isApprovedTheme(theme) ? approvedCanvasWidth(theme) : 600}
                  height={isApprovedTheme(theme) ? 362 : 210}
                  style={{aspectRatio: isApprovedTheme(theme) ? `${approvedCanvasWidth(theme)} / 362` : "600 / 210"}}
                  src={src}/>
                <span>{cardLabels[index]}</span>
              </button>
            );
          })}
        </div>
        {isCardTheme(design.theme) && (
          <p className="template-gallery-hint" role="note">
            {isApprovedTheme(design.theme) ? t.approvedArtworkLimit : t.vectorArtworkLimit}
          </p>
        )}
      </div>
    );
  }

  function renderLayers() {
    return (
      <>
        <div className="section-title">
          <h3>{t.addLayer}</h3><span>{t.maxLayers}</span>
        </div>
        <div className="tool-grid">
          {(["text", "count", "dot", "panel"] as LayerKind[]).map(kind =>
            <button type="button" className="tool-button"
              onClick={() => insertLayer(kind)} key={kind}
              disabled={design.layers.length >= 32}>
              {names[kind]} <span aria-hidden="true">+</span>
            </button>
          )}
        </div>
        <div className="section-title">
          <h3>{t.layerList}</h3>
          <span>{design.layers.length} {t.elements}</span>
        </div>
        <ol className="layer-list" aria-label={t.layerOrderLabel}>
          {[...design.layers].reverse().map(layer => (
            <li key={layer.id}>
              <button type="button"
                className={"layer-row" + (layer.id === selectedId ? " active" : "")}
                aria-pressed={layer.id === selectedId}
                onClick={() => selectLayer(layer.id, true)}>
                <span className="layer-symbol" aria-hidden="true">
                  {layer.kind === "count" ? "#" : layer.kind === "dot" ? "●" :
                    layer.kind === "panel" ? "▭" : "T"}
                </span>
                <span className="layer-name">{layerName(layer)}</span>
                <span className="layer-visibility">{layer.visible ? "" : t.hidden}</span>
              </button>
            </li>
          ))}
        </ol>
      </>
    );
  }

  function renderProperties() {
    return (
      <>
        {selected ? (
          <section className="properties" aria-label={t.editProperties}>
            <div className="section-title">
              <h3>{t.edit} · {names[selected.kind]}</h3>
              <button type="button" className="danger small"
                onClick={removeSelected}>{t.delete}</button>
            </div>
            {selected.kind === "text" && (
              <label className="field">{t.textLabel}
                <input value={selected.text} maxLength={120}
                  onChange={event => updateSelected({ text: event.target.value })}/>
              </label>
            )}
            <label className="toggle">
              <input type="checkbox" checked={selected.visible}
                onChange={event => updateSelected({ visible: event.target.checked })}/>
              {t.visibilityLabel}
            </label>
            <div className="form-grid">
              {(["x", "y", "width", "height"] as const).map(key => (
                <label className="field" key={key}>
                  {key === "x" ? t.xLabel : key === "y" ? t.yLabel :
                    key === "width" ? t.widthLabel : t.heightLabel}
                  <input type="number"
                    min={key === "width" || key === "height" ? 8 : 0}
                    max={key === "x" || key === "width" ? design.width : design.height}
                    value={selected[key]}
                    onChange={event => {
                      if (Number.isFinite(event.target.valueAsNumber)) {
                        updateSelected({ [key]: event.target.valueAsNumber });
                      }
                    }}/>
                </label>
              ))}
              {(selected.kind === "text" || selected.kind === "count") && (
                <label className="field">{t.fontSize}
                  <input type="number" min={8} max={80} value={selected.fontSize}
                    onChange={event => {
                      if (Number.isFinite(event.target.valueAsNumber)) {
                        updateSelected({ fontSize: event.target.valueAsNumber });
                      }
                    }}/>
                </label>
              )}
              <label className="field">{t.color}
                <input type="color" value={selected.color}
                  onChange={event => updateSelected({ color: event.target.value })}/>
              </label>
            </div>
            <div className="layer-actions">
              <button type="button" className="secondary small"
                onClick={() => edit(d => reorderLayer(d, selected.id, -1))}>
                {t.sendBack}
              </button>
              <button type="button" className="secondary small"
                onClick={() => edit(d => reorderLayer(d, selected.id, 1))}>
                {t.bringForward}
              </button>
            </div>
          </section>
        ) : <p className="note">{t.selectLayer}</p>}
      </>
    );
  }

  function renderCanvasSettings() {
    return (
      <>
        <div className="section-title">
          <h3>{t.canvas}</h3><span>{t.readmeReady}</span>
        </div>
        <div className="form-grid canvas-settings">
          {!isCardTheme(design.theme) && (
            <label className="field">{t.background}
              <input type="color" value={design.background}
                onChange={event => updateDesign({ background: event.target.value })}/>
            </label>
          )}
          <label className="field">{isCardTheme(design.theme) ? t.newLayerColor : t.border}
            <input type="color" value={design.accent}
              onChange={event => updateDesign({ accent: event.target.value })}/>
          </label>
          <label className="field">{t.widthLabel}
            <input type="number" min={280} max={800} value={design.width}
              onChange={event => {
                if (Number.isFinite(event.target.valueAsNumber)) {
                  updateDesign({ width: event.target.valueAsNumber });
                }
              }}/>
          </label>
          <label className="field">{t.heightLabel}
            <input type="number" min={160} max={480} value={design.height}
              onChange={event => {
                if (Number.isFinite(event.target.valueAsNumber)) {
                  updateDesign({ height: event.target.valueAsNumber });
                }
              }}/>
          </label>
        </div>
      </>
    );
  }

  function renderExport() {
    return (
      <>
        <div className="preview-footer">
          <label className="field demo-count">{t.exampleCount}
            <input type="number" min={0} max={MAX_VISITOR_COUNT} step={1} value={demoCount}
              onChange={event => setDemoCount(Math.max(
                0, Math.min(MAX_VISITOR_COUNT, Math.floor(Number(event.target.value) || 0))
              ))}/>
          </label>
          <span className="muted">{t.demoWarning}</span>
        </div>
        <div className="export">
          <button type="button"
            onClick={() => downloadFile(svg, "visitor-terminal.svg", "image/svg+xml")}>
            {t.downloadSvg}
          </button>
          <button type="button" className="secondary"
            onClick={() => downloadFile(
              JSON.stringify(design, null, 2),
              "visitor-terminal.design.json", "application/json"
            )}>{t.saveDesign}</button>
          <label className="secondary import-label">{t.loadDesign}
            <input type="file" aria-label={t.importLabel}
              accept=".json,application/json" onChange={importDesign}/>
          </label>
          <button type="button" className="secondary"
            onClick={copySvg}>{t.copySvg}</button>
        </div>
        <p className="notice" role="status">{t[noticeKey]}</p>
        {!OFFLINE_DEMO_MODE && (
          <section className="offline-distribution" aria-label={t.offlineDownloadTitle}>
            <div>
              <strong>{t.offlineDownloadTitle}</strong>
              <p>{t.offlineDownloadDescription}</p>
            </div>
            <a download="Workshop-Studio-Offline.html"
              href={import.meta.env.BASE_URL + "Workshop-Studio-Offline.html"}>
              {t.offlineDownloadAction}
            </a>
          </section>
        )}
        {renderPublishing()}
        <div className="disclaimer">{t.disclosure}</div>
      </>
    );
  }

  const tabs: Array<{ id: MobileTab; icon: string; label: string }> = [
    { id: "preview", icon: "▣", label: t.mobilePreview },
    { id: "layers", icon: "▤", label: t.mobileLayers },
    { id: "properties", icon: "☷", label: t.mobileProperties },
    { id: "export", icon: "⇩", label: t.mobileExport }
  ];

  const sheetTitle = mobileTab === "layers" ? t.layerList :
    mobileTab === "properties" ? t.mobileProperties : t.exportPanel;

  return (
    <main className="app">
      <header className="site-head">
        <div className="topline">
          <div className="site-brand">
            <span className="brand-mark" aria-hidden="true">▣</span> WORKSHOP STUDIO
            <span className="beta">{t.alpha}</span>
          </div>
          <div className="language-switch desktop-language" role="group" aria-label={t.languageLabel}>
            <span className="language-icon" aria-hidden="true">🌐</span>
            <button type="button" lang="zh-CN" aria-pressed={language === "zh-CN"}
              className={language === "zh-CN" ? "active" : ""}
              onClick={() => setLanguage("zh-CN")}>简体中文</button>
            <button type="button" lang="en" aria-pressed={language === "en"}
              className={language === "en" ? "active" : ""}
              onClick={() => setLanguage("en")}>English</button>
          </div>
          <label className="mobile-language mobile-only">
            <span aria-hidden="true">🌐</span>
            <select value={language} aria-label={t.languageLabel}
              onChange={event => setLanguage(event.target.value as Language)}>
              <option value="zh-CN">中文</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
        <h1>{t.heading}</h1>
        <p className="site-intro">{t.intro}</p>
      </header>

      <div className="workspace">
        <aside className="panel editor desktop-editor" aria-label={t.editorLabel}>
          <div className="panel-head">
            <h2>{t.designTools}</h2><span className="muted">{t.studioTag}</span>
          </div>
          {renderTemplates()}
          {renderLayers()}
          {renderProperties()}
          {renderCanvasSettings()}
        </aside>

        <section id="live-preview" className="panel preview-panel" aria-label={t.livePreview}>
          <div className="panel-head preview-heading">
            <h2>{t.livePreview}</h2>
            <div className="preview-actions">
              <button type="button" className="history-button" aria-label={t.undo}
                title={t.undo} onClick={undo} disabled={history.past.length === 0}>↶</button>
              <button type="button" className="history-button" aria-label={t.redo}
                title={t.redo} onClick={redo} disabled={history.future.length === 0}>↷</button>
              <span className="preview-status desktop-status">
                <span className="online-dot" aria-hidden="true"/>{t.svgPreview}
              </span>
            </div>
          </div>
          <div className="preview-banner">
            <span>{t.designSurface}</span><span>{design.width} × {design.height}</span>
          </div>

          <div className={"canvas" + (cleanPreview ? " pure-canvas" : "")}>
            <div className={"stage" + (moveMode ? " move-mode" : "")}
              ref={stageRef}
              style={{ width: design.width, aspectRatio: design.width + " / " + design.height }}>
              <img src={preview} alt={t.imageAlt} draggable={false}/>
              {!cleanPreview && design.layers.filter(layer => layer.visible).map(layer => (
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
                  onPointerMove={drag}
                  onPointerUp={stopDrag}
                  onPointerCancel={stopDrag}
                  onKeyDown={event => nudge(event, layer.id)}/>
              ))}
            </div>
          </div>

          <div className="preview-modes">
            <button type="button" className={"mode-button" + (cleanPreview ? " active" : "")}
              aria-pressed={cleanPreview} onClick={() => setCleanPreview(value => !value)}>
              {cleanPreview ? "▣ " + t.editPreview : "◉ " + t.cleanPreview}
            </button>
            <button type="button" className={"mode-button mobile-only" + (moveMode ? " active" : "")}
              aria-pressed={moveMode} disabled={cleanPreview}
              onClick={() => setMoveMode(value => !value)}>
              {moveMode ? t.moveModeOff : t.moveModeOn}
            </button>
            <button type="button" className="mode-button"
              aria-expanded={preciseOpen} disabled={!selected || cleanPreview}
              onClick={() => setPreciseOpen(value => !value)}>
              {preciseOpen ? t.hidePrecise : t.preciseTools}
            </button>
          </div>

          <div className="mobile-guidance mobile-only">
            {cleanPreview ? t.cleanTip : t.previewTip}
          </div>

          {preciseOpen && !cleanPreview && (
            <div className="precision-panel" aria-label={t.toolsLabel}>
              <div className="precision-caption">
                <strong>{selected ? t.moving + " " + layerName(selected) : t.selectFirst}</strong>
                <span>{t.tapArrows}</span>
              </div>
              <div className="nudge-pad">
                <button className="nudge-up" aria-label={t.up} type="button"
                  disabled={!selected} onClick={() => nudgeSelected(0, -5)}>↑</button>
                <button className="nudge-left" aria-label={t.left} type="button"
                  disabled={!selected} onClick={() => nudgeSelected(-5, 0)}>←</button>
                <button className="nudge-down" aria-label={t.down} type="button"
                  disabled={!selected} onClick={() => nudgeSelected(0, 5)}>↓</button>
                <button className="nudge-right" aria-label={t.right} type="button"
                  disabled={!selected} onClick={() => nudgeSelected(5, 0)}>→</button>
              </div>
            </div>
          )}

          <div className="desktop-export">
            <p className="hint">{t.positioningHelp}</p>
            {renderExport()}
          </div>
        </section>
      </div>

      {mobileTab !== "preview" && (
        <section className="mobile-sheet mobile-only" aria-label={sheetTitle}>
          <div className="sheet-heading">
            <h2>{sheetTitle}</h2>
            <button type="button" aria-label={t.closePanel}
              onClick={() => setMobileTab("preview")}>×</button>
          </div>
          <div className="sheet-body">
            {mobileTab === "layers" && (
              <>
                <p className="sheet-intro">{t.mobileLayersIntro}</p>
                {renderTemplates()}
                {renderLayers()}
              </>
            )}
            {mobileTab === "properties" && (
              <>
                <p className="sheet-intro">{t.mobilePropertiesIntro}</p>
                {renderProperties()}
                {renderCanvasSettings()}
              </>
            )}
            {mobileTab === "export" && (
              <>
                <p className="sheet-intro">{t.mobileExportIntro}</p>
                {renderExport()}
              </>
            )}
          </div>
        </section>
      )}

      <nav className="mobile-nav mobile-only" aria-label={t.mobileHelp}>
        {tabs.map(tab => (
          <button type="button" key={tab.id}
            className={mobileTab === tab.id ? "active" : ""}
            aria-current={mobileTab === tab.id ? "page" : undefined}
            onClick={() => {
              setMobileTab(tab.id);
              if (tab.id !== "preview") setCleanPreview(false);
            }}>
            <span className="nav-icon" aria-hidden="true">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <footer>
        WORKSHOP VISITOR TERMINAL <span aria-hidden="true">·</span> {t.footerOpenSource}
        <span aria-hidden="true">·</span> {t.footerAlpha}
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App/></React.StrictMode>
);
