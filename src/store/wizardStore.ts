/**
 * The New video wizard (docs/STORYBOARD.md): what kind of video, the designer's files, the style,
 * then a storyboard board for Claude. Files upload to the media library as soon as they are added
 * (a footage or voice file is then transcribed with Whisper on this computer), so Start only sends
 * their ids. The state survives closing the wizard until a video is started or it is reset.
 */
import { create } from "zustand";
import { mediaKindForName, type MediaKind } from "@/lib/media";
import { analyseReference, fetchMedia, importLink, startTranscript, uploadMedia, waitForReady, type UploadedMedia } from "@/lib/mediaClient";
import type { Board, MaterialRole, VideoKind } from "@/lib/types";

export type VideoFormat = "9:16" | "16:9" | "1:1" | "4:5";

export const FORMAT_SIZE: Record<VideoFormat, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export const LANGUAGES = [
  { label: "Persian (فارسی)", value: "Persian", whisper: "fa" },
  { label: "English", value: "English", whisper: "en" },
  { label: "Arabic (العربية)", value: "Arabic", whisper: "ar" },
  { label: "Turkish", value: "Turkish", whisper: "tr" },
] as const;

/** Roles a file of each kind can take, the first being the default. */
export const ROLES_FOR_KIND: Record<MediaKind, MaterialRole[]> = {
  video: ["footage"],
  audio: ["voice", "music", "sfx"],
  image: ["image", "logo"],
  font: ["font"],
};

export const ROLE_LABELS: Record<MaterialRole, string> = {
  footage: "Footage",
  voice: "Voice-over",
  music: "Music",
  sfx: "Sound effect",
  image: "Image",
  logo: "Logo",
  font: "Font",
};

export const MAX_STYLE_HINTS = 3;
export const MAX_WIZARD_REFERENCES = 4;

export interface WizardFile {
  key: string;
  name: string;
  kind: MediaKind;
  role: MaterialRole | "reference";
  note: string;
  status: "uploading" | "processing" | "ready" | "error";
  /** 0..1 while uploading */
  progress: number;
  error?: string;
  media?: UploadedMedia;
  /** references: the reference seen in full on the server (contact sheets, cuts, colours) */
  analysis?: { state: "processing" | "ready" | "error"; summary?: string; error?: string };
  /** set when the file came from a link */
  link?: string;
}

export type WizardStep = 0 | 1 | 2 | 3;

interface WizardState {
  open: boolean;
  step: WizardStep;
  kind: VideoKind;
  format: VideoFormat;
  duration: number;
  /** the designer typed a duration: footage no longer sets it */
  durationSet: boolean;
  language: string;
  brief: string;
  script: string;
  files: WizardFile[];
  styleHints: string[];
  starting: boolean;
  error: string | null;
  show(): void;
  hide(): void;
  reset(): void;
  setStep(step: WizardStep): void;
  set(patch: Partial<Pick<WizardState, "kind" | "format" | "duration" | "durationSet" | "language" | "brief" | "script">>): void;
  addFiles(files: File[], asReference?: boolean): string | null;
  /** a reference video from a link (Instagram, YouTube, …), downloaded by the server */
  addLink(url: string): string | null;
  updateFile(key: string, patch: Partial<WizardFile>): void;
  removeFile(key: string): void;
  toggleStyle(name: string): void;
  /** create the board; resolves with it, or null (the error is in `error`) */
  start(): Promise<Board | null>;
}

const INITIAL = {
  step: 0 as WizardStep,
  kind: "motion" as VideoKind,
  format: "9:16" as VideoFormat,
  duration: 15,
  durationSet: false,
  language: "Persian",
  brief: "",
  script: "",
  files: [] as WizardFile[],
  styleHints: [] as string[],
  starting: false,
  error: null as string | null,
};

let nextKey = 1;

function defaultRole(kind: MediaKind, name: string): MaterialRole {
  if (kind === "audio") return /voice|vo\b|narrat|speech|صدا|گوینده/i.test(name) ? "voice" : "music";
  if (kind === "image") return /logo|لوگو/i.test(name) ? "logo" : "image";
  return ROLES_FOR_KIND[kind][0];
}

/** Whisper's language hint for the wizard's language. */
export function whisperLanguage(language: string): string | undefined {
  return LANGUAGES.find((entry) => entry.value === language)?.whisper;
}

/** Total length of the ready footage, which sets the video's length unless the designer typed one. */
function footageLength(files: WizardFile[]): number {
  return files.filter((f) => f.role === "footage" && f.media?.duration).reduce((sum, f) => sum + (f.media?.duration ?? 0), 0);
}

export const useWizardStore = create<WizardState>()((set, get) => {
  /** A ready reference is seen in full on the server; Start waits for it. */
  const analyse = async (key: string, id: string) => {
    get().updateFile(key, { analysis: { state: "processing" } });
    try {
      const view = await analyseReference(id);
      const a = view.analysis;
      if (view.status?.state !== "ready" || !a) throw new Error(view.status?.error ?? "The reference could not be measured");
      const summary = a.kind === "image" ? "colours measured" : `${a.cuts.length} cuts, ${a.sheets.length} contact sheets, ${a.strips.length} transition strips`;
      get().updateFile(key, { analysis: { state: "ready", summary } });
    } catch (error) {
      get().updateFile(key, { analysis: { state: "error", error: error instanceof Error ? error.message : String(error) } });
    }
  };

  /** Wait until an uploaded or downloaded file is ready, then transcribe speech or measure a reference. */
  const prepare = async (key: string, first: UploadedMedia) => {
    get().updateFile(key, { status: "processing", progress: 1, media: first });
    const ready = await waitForReady(first.id, (meta) => get().updateFile(key, { media: meta }));
    // A link is named after the video's title once it is downloaded.
    const linked = get().files.find((f) => f.key === key)?.link;
    get().updateFile(key, { status: "ready", media: ready, ...(linked ? { name: ready.name } : {}) });
    return ready;
  };

  const fromLink = async (key: string, url: string) => {
    try {
      const ready = await prepare(key, await importLink(url));
      await analyse(key, ready.id);
    } catch (error) {
      get().updateFile(key, { status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  };

  /** Upload one file, wait until it is ready, then start its transcript when it carries speech. */
  const upload = async (key: string, file: File) => {
    try {
      const uploaded = await uploadMedia(file, (progress) => get().updateFile(key, { progress }));
      const ready = await prepare(key, uploaded);
      const entry = get().files.find((f) => f.key === key);
      if (entry?.role === "reference") {
        await analyse(key, ready.id);
        return;
      }
      if (entry && (entry.role === "footage" || entry.role === "voice") && ready.hasAudio) {
        await startTranscript(ready.id, whisperLanguage(get().language)).catch(() => undefined); // no Whisper: the script box is the fallback
        get().updateFile(key, { media: await fetchMedia(ready.id) });
      }
      const state = get();
      if (!state.durationSet && state.kind === "footage") {
        const length = footageLength(state.files);
        if (length > 0) set({ duration: Number(length.toFixed(2)) });
      }
    } catch (error) {
      get().updateFile(key, { status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  };

  return {
    open: false,
    ...INITIAL,

    show: () => set({ open: true }),
    hide: () => set({ open: false }),
    reset: () => set({ ...INITIAL, files: [], styleHints: [] }),
    setStep: (step) => set({ step, error: null }),
    set: (patch) => set(patch),

    addFiles(files, asReference = false) {
      const accepted: WizardFile[] = [];
      const current = get().files;
      for (const file of files) {
        const kind = mediaKindForName(file.name);
        if (!kind) return `"${file.name}" is not a video, sound, image or font file`;
        if (asReference && kind !== "video" && kind !== "image") return `"${file.name}": a reference is an image or a video`;
        accepted.push({
          key: `f${nextKey++}`,
          name: file.name,
          kind,
          role: asReference ? "reference" : defaultRole(kind, file.name),
          note: "",
          status: "uploading",
          progress: 0,
        });
      }
      const references = current.filter((f) => f.role === "reference").length + (asReference ? accepted.length : 0);
      if (references > MAX_WIZARD_REFERENCES) return `At most ${MAX_WIZARD_REFERENCES} references`;
      set({ files: [...current, ...accepted] });
      accepted.forEach((entry, i) => void upload(entry.key, files[i]));
      return null;
    },

    addLink(raw) {
      const url = raw.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) return "Paste a link that starts with https://";
      const current = get().files;
      if (current.filter((f) => f.role === "reference").length >= MAX_WIZARD_REFERENCES) return `At most ${MAX_WIZARD_REFERENCES} references`;
      const key = `f${nextKey++}`;
      let host = url;
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        // the server says what is wrong with it
      }
      set({ files: [...current, { key, name: `Link: ${host}`, kind: "video", role: "reference", note: "", status: "uploading", progress: 0, link: url }] });
      void fromLink(key, url);
      return null;
    },

    updateFile: (key, patch) => set({ files: get().files.map((f) => (f.key === key ? { ...f, ...patch } : f)) }),

    removeFile: (key) => set({ files: get().files.filter((f) => f.key !== key) }),

    toggleStyle(name) {
      const hints = get().styleHints;
      if (hints.includes(name)) set({ styleHints: hints.filter((h) => h !== name) });
      else if (hints.length < MAX_STYLE_HINTS) set({ styleHints: [...hints, name] });
    },

    async start() {
      const state = get();
      if (state.starting) return null;
      const ready = state.files.filter((f) => f.status === "ready" && f.media);
      const size = FORMAT_SIZE[state.format];
      const body = {
        brief: state.brief.trim(),
        stage: { ...size, duration: state.duration, fps: 30 },
        videoKind: state.kind,
        language: state.language,
        ...(state.script.trim() ? { script: state.script.trim() } : {}),
        materials: ready
          .filter((f) => f.role !== "reference")
          .map((f) => ({ mediaId: f.media!.id, role: f.role as MaterialRole, ...(f.note.trim() ? { note: f.note.trim() } : {}) })),
        referenceMedia: ready.filter((f) => f.role === "reference").map((f) => f.media!.id),
        ...(state.styleHints.length ? { styleHints: state.styleHints } : {}),
      };
      set({ starting: true, error: null });
      try {
        const response = await fetch("/api/bridge/boards/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = (await response.json().catch(() => null)) as { board?: Board; error?: string } | null;
        if (!response.ok || !result?.board) {
          set({ error: result?.error ?? `HTTP ${response.status}` });
          return null;
        }
        return result.board;
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
        return null;
      } finally {
        set({ starting: false });
      }
    },
  };
});
