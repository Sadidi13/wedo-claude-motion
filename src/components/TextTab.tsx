"use client";
/**
 * The inspector's Text tab: every word on screen and every font, changed here without Claude.
 *
 * - Texts: the scene's TEXT table (the contract asks for one), or for older scenes the plain text
 *   inside its layers. Each change is one Undo step and shows in the preview at once.
 * - Fonts: each role of the FONTS table, and "All text" (one rule over the whole stage, for scenes
 *   without roles). A font comes from the media library, an upload, the fonts installed on this
 *   computer (copied into the library, so exports have it too) or Vazirmatn from Google Fonts.
 */
import { Check, LoaderCircle, Type, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { FONTS_CSS, WEB_FONTS, type FontFace, allTextFont, firstFamily } from "@/lib/fonts";
import { mediaRef, mediaUrls, type MediaMeta } from "@/lib/media";
import { uploadMedia, waitForReady } from "@/lib/mediaClient";
import { readJsxTexts, readSceneTables, type TableEntry } from "@/lib/parser";
import { errorMessage, useEditorStore } from "@/store/editorStore";
import { Button } from "./ui/Button";
import { cx } from "./ui/cx";

const SAMPLE = "نمونهٔ متن فارسی ۱۲۳ · Sora 2 Aa";

interface InstalledFamily {
  family: string;
  arabic: boolean;
  faces: { id: string; weight: number; style: "normal" | "italic" }[];
}

type LibraryFont = MediaMeta & { ref: string };

function humanize(key: string): string {
  return key.replace(/\./g, " · ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** One editable text; commits when it loses focus (or Ctrl+Enter), so typing is one Undo step. */
function TextRow({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <textarea
        dir="auto"
        rows={Math.min(4, Math.max(1, Math.ceil(draft.length / 34)))}
        className="ms-input min-h-7 w-full select-text resize-y py-1 leading-5"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") setDraft(value);
        }}
      />
    </label>
  );
}

/** Load a library font under its own name so its sample shows (the editor page, not the stage). */
function useSampleFace(font: LibraryFont | null): string | undefined {
  const [family, setFamily] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!font) return;
    const name = `ms-sample-${font.id}`;
    const face = new FontFace(name, `url(${mediaUrls.file(font.id)})`, { weight: String(font.fontWeight ?? 400), style: font.fontStyle ?? "normal" });
    let live = true;
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        if (live) setFamily(name);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [font]);
  return family;
}

function LibraryOption({ font, onChoose, busy }: { font: LibraryFont; onChoose: () => void; busy: boolean }) {
  const sample = useSampleFace(font);
  return (
    <button type="button" disabled={busy} onClick={onChoose} className="ms-focus flex flex-col items-start gap-0.5 rounded border border-border px-2 py-1.5 text-left hover:bg-panel-3">
      <span className="text-[11px] text-muted">
        {font.fontFamily} {font.fontWeight} {font.fontArabic ? "· Persian" : ""}
      </span>
      <span dir="auto" className="text-[15px] leading-6" style={{ fontFamily: sample ? `"${sample}"` : undefined }}>
        {SAMPLE}
      </span>
    </button>
  );
}

/** Choosing a font for one role (or all text): library, upload, installed, web. */
function FontPicker({ onPick, onClose }: { onPick: (pick: { family: string; faces?: FontFace[]; webCss?: string }) => Promise<void>; onClose: () => void }) {
  const [source, setSource] = useState<"library" | "installed" | "web">("library");
  const [library, setLibrary] = useState<LibraryFont[] | null>(null);
  const [installed, setInstalled] = useState<InstalledFamily[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetch("/api/media", { cache: "no-store" })
      .then((response) => response.json())
      .then((list: LibraryFont[]) => setLibrary(list.filter((m) => m.kind === "font" && m.state === "ready")))
      .catch(() => setLibrary([]));
  }, []);
  useEffect(() => {
    if (source !== "installed" || installed) return;
    void fetch("/api/fonts/installed", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { families: InstalledFamily[] }) => setInstalled(body.families))
      .catch(() => setInstalled([]));
  }, [source, installed]);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setProblem(null);
    try {
      await work();
      onClose();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const facesOf = (family: string): FontFace[] =>
    (library ?? []).filter((m) => m.fontFamily === family).map((m) => ({ family, ref: m.ref, weight: m.fontWeight ?? 400, style: m.fontStyle ?? "normal" }));

  const families = useMemo(() => {
    const byFamily = new Map<string, LibraryFont>();
    for (const font of library ?? []) if (font.fontFamily && !byFamily.has(font.fontFamily)) byFamily.set(font.fontFamily, font);
    return [...byFamily.values()];
  }, [library]);

  const needle = query.trim().toLowerCase();
  const shownInstalled = (installed ?? []).filter((f) => !needle || f.family.toLowerCase().includes(needle)).slice(0, 80);

  return (
    <div className="mt-1.5 flex flex-col gap-2 rounded-md border border-border bg-panel-2 p-2">
      <div className="flex items-center gap-1">
        {(["library", "installed", "web"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSource(value)}
            className={cx("ms-focus rounded px-2 py-0.5 text-[11px]", source === value ? "bg-panel-3 text-foreground" : "text-muted hover:text-foreground")}
          >
            {value === "library" ? "Your fonts" : value === "installed" ? "On this computer" : "Web"}
          </button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {source === "library" && (
        <div className="flex flex-col gap-1.5">
          {library === null && <LoaderCircle size={14} className="animate-spin text-muted" />}
          {families.map((font) => (
            <LibraryOption key={font.id} font={font} busy={busy !== null} onChoose={() => void run(font.id, () => onPick({ family: font.fontFamily!, faces: facesOf(font.fontFamily!) }))} />
          ))}
          {library?.length === 0 && <p className="text-[11px] text-muted">No font files yet. Upload one, or take one from this computer.</p>}
          <Button size="sm" icon={<Upload size={12} />} loading={busy === "upload"} onClick={() => uploadRef.current?.click()}>
            Upload a font file
          </Button>
          <input
            ref={uploadRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void run("upload", async () => {
                const uploaded = await uploadMedia(file);
                const ready = await waitForReady(uploaded.id);
                if (!ready.fontFamily) throw new Error("The file's font name could not be read");
                await onPick({
                  family: ready.fontFamily,
                  faces: [{ family: ready.fontFamily, ref: mediaRef(ready.id, ready.ext), weight: ready.fontWeight ?? 400, style: ready.fontStyle ?? "normal" }],
                });
              });
            }}
          />
        </div>
      )}
      {source === "installed" && (
        <div className="flex flex-col gap-1.5">
          <input className="ms-input h-7" placeholder="Search installed fonts" value={query} onChange={(event) => setQuery(event.target.value)} />
          {installed === null && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              <LoaderCircle size={12} className="animate-spin" /> Reading the fonts on this computer…
            </p>
          )}
          <div className="ms-scroll flex max-h-72 flex-col gap-1 overflow-auto">
            {shownInstalled.map((family) => (
              <button
                key={family.family}
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run(family.family, async () => {
                    const response = await fetch("/api/fonts/installed/import", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ family: family.family }),
                    });
                    const body = (await response.json().catch(() => null)) as { fonts?: LibraryFont[]; error?: string } | null;
                    if (!response.ok || !body?.fonts) throw new Error(body?.error ?? `HTTP ${response.status}`);
                    await onPick({
                      family: family.family,
                      faces: body.fonts.map((m) => ({ family: family.family, ref: m.ref, weight: m.fontWeight ?? 400, style: m.fontStyle ?? "normal" })),
                    });
                  })
                }
                className="ms-focus flex flex-col items-start gap-0.5 rounded border border-border px-2 py-1.5 text-left hover:bg-panel-3"
              >
                <span className="flex items-center gap-1.5 text-[11px] text-muted">
                  {busy === family.family && <LoaderCircle size={11} className="animate-spin" />}
                  {family.family} · {family.faces.length} weight{family.faces.length === 1 ? "" : "s"} {family.arabic ? "· Persian" : ""}
                </span>
                <span dir="auto" className="text-[15px] leading-6" style={{ fontFamily: `"${family.family}"` }}>
                  {SAMPLE}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {source === "web" &&
        WEB_FONTS.map((font) => (
          <button
            key={font.family}
            type="button"
            disabled={busy !== null}
            onClick={() => void run(font.family, () => onPick({ family: font.family, webCss: font.css }))}
            className="ms-focus flex flex-col items-start gap-0.5 rounded border border-border px-2 py-1.5 text-left hover:bg-panel-3"
          >
            <span className="text-[11px] text-muted">
              {font.family} · {font.note} · Google Fonts
            </span>
          </button>
        ))}
      {problem && <p className="text-[11px] text-danger">{problem}</p>}
    </div>
  );
}

function FontRow({ label, current, onPick, onRemove }: { label: string; current: string | null; onPick: (pick: { family: string; faces?: FontFace[]; webCss?: string }) => Promise<void>; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 truncate text-[11px] font-medium uppercase tracking-wide text-muted" title={label}>
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px]" style={current ? { fontFamily: `"${current}", sans-serif` } : undefined}>
          {current ?? "—"}
        </span>
        {onRemove && current && (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        )}
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          Change
        </Button>
      </div>
      {open && <FontPicker onPick={onPick} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function TextTab() {
  const { project, scene } = useEditorStore(useShallow((s) => ({ project: s.project, scene: s.scene })));
  const source = project ? (project.files[project.entry]?.content ?? "") : "";
  const css = project?.files[FONTS_CSS]?.content ?? "";

  const parsed = useMemo(() => {
    try {
      return { tables: readSceneTables(source), jsx: readJsxTexts(source), error: null };
    } catch (error) {
      return { tables: { TEXT: null, FONTS: null }, jsx: [], error: errorMessage(error) };
    }
  }, [source]);

  if (!project) return null;
  const { setTableText, setJsxTextValue, applyFont } = useEditorStore.getState();
  const texts: TableEntry[] = parsed.tables.TEXT ?? [];
  const fonts: TableEntry[] = parsed.tables.FONTS ?? [];

  const pickFor = (role: string | null) => async (pick: { family: string; faces?: FontFace[]; webCss?: string }) => {
    if (!applyFont({ role, ...pick })) throw new Error("The font could not be applied (see the notice)");
  };

  return (
    <div className="flex flex-col gap-4 p-3">
      {parsed.error && <p className="text-[11px] text-danger">The scene does not parse, so its text cannot be listed: {parsed.error}</p>}
      <section className="flex flex-col gap-2.5">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold">
          <Type size={13} /> Texts
        </h3>
        {texts.length > 0 &&
          texts.map((entry) => (
            <TextRow key={entry.key} label={humanize(entry.key)} value={entry.value} onCommit={(value) => setTableText("TEXT", entry.key, value)} />
          ))}
        {texts.length > 0 && parsed.jsx.length > 0 && <h4 className="pt-1 text-[11px] font-medium text-muted">Other text in the layers</h4>}
        {parsed.jsx.map((entry) => (
          <TextRow
            key={entry.key}
            label={(entry.layerId && scene?.byId[entry.layerId]?.name) || `Text ${entry.key.slice(1)}`}
            value={entry.value}
            onCommit={(value) => setJsxTextValue(entry.key, value)}
          />
        ))}
        {texts.length === 0 && parsed.jsx.length === 0 && !parsed.error && <p className="text-[11.5px] text-muted">This scene has no text to edit.</p>}
        {texts.length + parsed.jsx.length > 0 && (
          <p className="flex items-center gap-1 text-[10.5px] text-muted">
            <Check size={11} /> Changes apply when you leave the box (Ctrl+Enter), one Undo each.
          </p>
        )}
      </section>
      <section className="flex flex-col gap-2.5">
        <h3 className="text-[12px] font-semibold">Fonts</h3>
        {fonts.map((entry) => (
          <FontRow key={entry.key} label={humanize(entry.key)} current={firstFamily(entry.value)} onPick={pickFor(entry.key)} />
        ))}
        <FontRow
          label="All text"
          current={allTextFont(css)}
          onPick={pickFor(null)}
          onRemove={() => applyFont({ role: null, family: null })}
        />
        <p className="text-[10.5px] leading-4 text-muted">
          {fonts.length
            ? "Each role sets the font of the texts that use it. All text overrides every font on the stage."
            : "This scene names no font roles: All text sets one font for every text on the stage."}
        </p>
      </section>
    </div>
  );
}
