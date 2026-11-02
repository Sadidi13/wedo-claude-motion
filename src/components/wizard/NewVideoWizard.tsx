"use client";
/**
 * The New video wizard (docs/STORYBOARD.md): the one place a video starts. Four steps, each kept
 * when the designer moves back and forth:
 *
 *   1. Kind: motion graphics, footage of a person, or a conversation with Claude; format, length, language.
 *   2. Content: footage, voice-over, music, images, logo and fonts (uploaded to the media library at
 *      once, footage and voice transcribed by Whisper), and the script.
 *   3. Style: up to three directions from the style library, and references to match; or neither,
 *      and Claude proposes.
 *   4. Start: a summary, the autopilot switch, and the board that asks Claude for style frames.
 *
 * Opened by the top bar's New video button, and by `?new=1` (motion-bridge launch).
 */
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clapperboard,
  FileAudio,
  FileImage,
  FileVideo,
  LoaderCircle,
  MessagesSquare,
  Search,
  Sparkles,
  Trash2,
  Type,
  Upload,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { STYLE_LIBRARY } from "@/lib/ai/styleLibrary";
import type { MediaKind } from "@/lib/media";
import type { MaterialRole, VideoKind } from "@/lib/types";
import { useBoardStore } from "@/store/boardStore";
import { useBridgeStore } from "@/store/bridgeStore";
import { useEditorStore } from "@/store/editorStore";
import { autopilotAction } from "../AutopilotChip";
import {
  FORMAT_SIZE,
  LANGUAGES,
  MAX_STYLE_HINTS,
  MAX_WIZARD_REFERENCES,
  ROLES_FOR_KIND,
  ROLE_LABELS,
  type VideoFormat,
  type WizardFile,
  type WizardStep,
  useWizardStore,
  whisperLanguage,
} from "@/store/wizardStore";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Field } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import { Segmented } from "../ui/Segmented";
import { TranscriptPanel } from "./TranscriptPanel";

const STEPS: { title: string }[] = [{ title: "Kind" }, { title: "Content" }, { title: "Style" }, { title: "Start" }];

const KINDS: { value: VideoKind; icon: ReactNode; title: string; text: string; soon?: boolean }[] = [
  {
    value: "motion",
    icon: <Sparkles size={18} />,
    title: "Motion graphics",
    text: "Everything designed and animated: type, shapes, illustration, 3D. Add a logo, music or a voice-over if you have them.",
  },
  {
    value: "footage",
    icon: <UserRound size={18} />,
    title: "Footage of a person",
    text: "Your talking-head or product footage, edited with captions that follow the speech, graphics, punch-ins and sound.",
  },
  {
    value: "chat",
    icon: <MessagesSquare size={18} />,
    title: "Talk it through with Claude",
    text: "Claude asks about the client, the message and the look, then sets everything up for you.",
    soon: true,
  },
];

const FORMATS: { value: VideoFormat; label: string }[] = [
  { value: "9:16", label: "9:16 Reel" },
  { value: "16:9", label: "16:9 Wide" },
  { value: "1:1", label: "1:1 Square" },
  { value: "4:5", label: "4:5 Feed" },
];

const KIND_ICONS: Record<MediaKind, ReactNode> = {
  video: <FileVideo size={15} />,
  audio: <FileAudio size={15} />,
  image: <FileImage size={15} />,
  font: <Type size={15} />,
};

/** `?new=1` is read once per page load (module-level: React runs effects twice in development). */
let newFromUrl: boolean | null = null;

function describeFile(file: WizardFile): string {
  const media = file.media;
  if (file.link && (file.status === "uploading" || (file.status === "processing" && !media?.duration))) return "Downloading the video (up to 1080p)…";
  if (file.status === "uploading") return `Uploading ${Math.round(file.progress * 100)}%`;
  if (file.status === "error") return file.error ?? "Failed";
  if (!media) return "Preparing…";
  const parts: string[] = [];
  if (media.duration > 0) parts.push(`${media.duration.toFixed(1)} s`);
  if (media.width > 0) parts.push(`${media.width}×${media.height}`);
  if (file.kind === "video") parts.push(media.hasAudio ? "with sound" : "silent");
  if (media.fontFamily) parts.push(`${media.fontFamily} ${media.fontWeight ?? ""}`.trim());
  if (file.status === "processing") parts.push(file.kind === "video" ? "preparing frames…" : "reading…");
  return parts.join(" · ");
}

function DropZone({ onFiles, accept, label, hint }: { onFiles: (files: File[]) => void; accept: string; label: string; hint: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    onFiles(Array.from(event.dataTransfer.files));
  };
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cx(
        "flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-4 py-4 text-center transition-colors",
        over ? "border-accent bg-accent/10" : "border-border-strong bg-panel",
      )}
    >
      <Button size="sm" icon={<Upload size={13} />} onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
      <span className="text-[11px] text-muted">{hint}</span>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}

function FileRow({ file, language }: { file: WizardFile; language: string }) {
  const { updateFile, removeFile } = useWizardStore.getState();
  const roles = file.role === "reference" ? [] : ROLES_FOR_KIND[file.kind];
  return (
    <div className="rounded-md border border-border bg-panel-2 p-2">
      <div className="flex items-center gap-2">
        <span className={cx("shrink-0", file.status === "error" ? "text-danger" : "text-accent")}>{KIND_ICONS[file.kind]}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium" title={file.name}>
            {file.name}
          </div>
          <div className={cx("truncate text-[11px]", file.status === "error" ? "text-danger" : "text-muted")}>{describeFile(file)}</div>
          {file.status === "uploading" && (
            <div className="mt-1 h-1 overflow-hidden rounded bg-panel-3">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(file.progress * 100)}%` }} />
            </div>
          )}
        </div>
        {file.status === "processing" && <LoaderCircle size={14} className="shrink-0 animate-spin text-muted" />}
        {file.status === "ready" && <Check size={14} className="shrink-0 text-success" />}
        {roles.length > 1 && (
          <select
            className="ms-input h-7 w-[120px] shrink-0 text-[11.5px]"
            value={file.role}
            onChange={(event) => updateFile(file.key, { role: event.target.value as MaterialRole })}
            aria-label={`Use of ${file.name}`}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        )}
        {roles.length === 1 && <span className="shrink-0 text-[11px] text-muted">{ROLE_LABELS[roles[0]]}</span>}
        <IconButton title={`Remove ${file.name}`} danger onClick={() => removeFile(file.key)}>
          <Trash2 size={14} />
        </IconButton>
      </div>
      {file.role !== "reference" && file.status !== "error" && (
        <input
          dir="auto"
          className="ms-input mt-1.5 h-7 w-full select-text text-[11.5px]"
          placeholder="Note for Claude (optional), e.g. use only 0:05–0:20, the logo goes at the end"
          value={file.note}
          onChange={(event) => updateFile(file.key, { note: event.target.value })}
        />
      )}
      {file.role === "reference" && file.analysis && (
        <p
          className={cx(
            "mt-1.5 flex items-center gap-1.5 text-[11px]",
            file.analysis.state === "error" ? "text-danger" : file.analysis.state === "ready" ? "text-success" : "text-muted",
          )}
        >
          {file.analysis.state === "processing" && <LoaderCircle size={12} className="animate-spin" />}
          {file.analysis.state === "processing"
            ? "Seeing it in full: every cut, the colours, the motion around each transition…"
            : file.analysis.state === "ready"
              ? `Seen in full: ${file.analysis.summary}. Claude writes its style spec from these.`
              : `Could not measure it (${file.analysis.error}); Claude still sees one contact sheet.`}
        </p>
      )}
      {file.status === "ready" && file.media && (file.role === "footage" || file.role === "voice") && file.media.hasAudio && (
        <TranscriptPanel mediaId={file.media.id} language={whisperLanguage(language)} known={file.media.transcript?.state} />
      )}
    </div>
  );
}

function KindStep() {
  const { kind, format, duration, language, brief, set } = useWizardStore(
    useShallow((s) => ({ kind: s.kind, format: s.format, duration: s.duration, language: s.language, brief: s.brief, set: s.set })),
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2.5">
        {KINDS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={option.soon}
            onClick={() => set({ kind: option.value })}
            className={cx(
              "ms-focus flex flex-col items-start gap-1.5 rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45",
              kind === option.value ? "border-accent bg-accent/10" : "border-border bg-panel hover:bg-panel-3",
            )}
          >
            <span className="flex items-center gap-2 text-[12.5px] font-semibold">
              <span className="text-accent">{option.icon}</span>
              {option.title}
            </span>
            <span className="text-[11.5px] leading-4 text-muted">{option.text}</span>
            {option.soon && <span className="text-[10.5px] text-accent-2">Coming next</span>}
          </button>
        ))}
      </div>
      <Field label="What is the video about?" hint="The client, what it is for, who watches it, the one thing they should remember.">
        <textarea
          dir="auto"
          rows={4}
          className="ms-input min-h-[88px] w-full select-text resize-y py-1.5 leading-5"
          placeholder="e.g. A 30-second reel for my page about the new Sora 2 model: what it is, three things it can do, follow for more"
          value={brief}
          onChange={(event) => set({ brief: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Format">
          <Segmented value={format} options={FORMATS} onChange={(value) => set({ format: value })} />
        </Field>
        <Field label="Length (seconds)" hint={kind === "footage" ? "Set from the footage once it is uploaded" : undefined}>
          <input
            type="number"
            min={2}
            max={600}
            step={1}
            className="ms-input h-7 w-24"
            value={duration}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value > 0) set({ duration: Math.min(600, value), durationSet: true });
            }}
          />
        </Field>
        <Field label="Language">
          <select className="ms-input h-7 w-44" value={language} onChange={(event) => set({ language: event.target.value })}>
            {LANGUAGES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

function ContentStep() {
  const { kind, files, script, language, set, addFiles } = useWizardStore(
    useShallow((s) => ({ kind: s.kind, files: s.files, script: s.script, language: s.language, set: s.set, addFiles: s.addFiles })),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const materials = files.filter((f) => f.role !== "reference");
  const hasFootage = materials.some((f) => f.role === "footage");
  return (
    <div className="flex flex-col gap-3">
      <DropZone
        label="Add files"
        accept="video/*,audio/*,image/*,.ttf,.otf,.woff,.woff2"
        hint={
          kind === "footage"
            ? "Your footage first, then a logo, music, a font… Drop them here or pick them. Any size."
            : "A logo, product photos, a voice-over or music, your brand font… Drop them here or pick them. Any size."
        }
        onFiles={(picked) => setProblem(addFiles(picked))}
      />
      {problem && <p className="text-[11px] text-danger">{problem}</p>}
      {kind === "footage" && !hasFootage && <p className="text-[11.5px] text-accent-2">Add the footage of the person to build the video around.</p>}
      {materials.length > 0 && (
        <div className="flex flex-col gap-2">
          {materials.map((file) => (
            <FileRow key={file.key} file={file} language={language} />
          ))}
        </div>
      )}
      <Field
        label="Script and key messages"
        hint="The exact words for the screen: headline, points, call to action. With footage, Claude also reads what is said."
      >
        <textarea
          dir="auto"
          rows={5}
          className="ms-input min-h-[100px] w-full select-text resize-y py-1.5 leading-5"
          placeholder="Optional"
          value={script}
          onChange={(event) => set({ script: event.target.value })}
        />
      </Field>
    </div>
  );
}

function StyleStep() {
  const { files, styleHints, toggleStyle, addFiles, addLink, language } = useWizardStore(
    useShallow((s) => ({ files: s.files, styleHints: s.styleHints, toggleStyle: s.toggleStyle, addFiles: s.addFiles, addLink: s.addLink, language: s.language })),
  );
  const [query, setQuery] = useState("");
  const [link, setLink] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const references = files.filter((f) => f.role === "reference");
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = STYLE_LIBRARY.filter(
      (style) => !needle || `${style.name} ${style.group} ${style.recipe}`.toLowerCase().includes(needle) || styleHints.includes(style.name),
    );
    const byGroup = new Map<string, typeof matches>();
    for (const style of matches) byGroup.set(style.group, [...(byGroup.get(style.group) ?? []), style]);
    return [...byGroup.entries()];
  }, [query, styleHints]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] leading-5 text-muted">
        Pick up to {MAX_STYLE_HINTS} directions, add a reference whose look Claude should match, or leave both empty and Claude proposes three
        styles for your brief. You choose between the style frames next.
      </p>
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Style library {styleHints.length > 0 && `· ${styleHints.length} of ${MAX_STYLE_HINTS} picked`}
          </h3>
          <label className="flex items-center gap-1.5">
            <Search size={13} className="text-muted" />
            <input className="ms-input h-7 w-56" placeholder="Search: neon, paper, luxury…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        <div className="ms-scroll flex max-h-[300px] flex-col gap-3 overflow-auto rounded-md border border-border bg-panel p-2">
          {groups.length === 0 && <p className="text-[11.5px] text-muted">No style matches “{query}”.</p>}
          {groups.map(([group, styles]) => (
            <div key={group}>
              <div className="mb-1 text-[11px] font-semibold text-muted">{group}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {styles.map((style) => {
                  const picked = styleHints.includes(style.name);
                  const full = !picked && styleHints.length >= MAX_STYLE_HINTS;
                  return (
                    <button
                      key={style.name}
                      type="button"
                      disabled={full}
                      onClick={() => toggleStyle(style.name)}
                      title={style.recipe}
                      className={cx(
                        "ms-focus flex flex-col items-start rounded border px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        picked ? "border-accent bg-accent/10" : "border-border hover:bg-panel-3",
                      )}
                    >
                      <span className="flex items-center gap-1 text-[12px] font-medium">
                        {picked && <Check size={12} className="text-accent" />}
                        {style.name}
                      </span>
                      <span className="line-clamp-2 text-[10.5px] leading-[14px] text-muted">{style.recipe}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">References to match ({references.length} of {MAX_WIZARD_REFERENCES})</h3>
        {references.length < MAX_WIZARD_REFERENCES && (
          <>
            <DropZone
              label="Add a reference"
              accept="video/*,image/*"
              hint="A video or image whose look the video should have. Claude matches its style, never its logos or text."
              onFiles={(picked) => setProblem(addFiles(picked, true))}
            />
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const error = addLink(link);
                setProblem(error);
                if (!error) setLink("");
              }}
            >
              <input
                className="ms-input h-7 min-w-0 flex-1 select-text"
                placeholder="…or paste a link: an Instagram reel, a YouTube video"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                aria-label="Reference link"
              />
              <Button size="sm" type="submit" disabled={!link.trim()}>
                Get it
              </Button>
            </form>
          </>
        )}
        {problem && <p className="text-[11px] text-danger">{problem}</p>}
        {references.map((file) => (
          <FileRow key={file.key} file={file} language={language} />
        ))}
      </section>
    </div>
  );
}

function StartStep({ turnOn, setTurnOn }: { turnOn: boolean; setTurnOn: (value: boolean) => void }) {
  const state = useWizardStore(
    useShallow((s) => ({
      kind: s.kind,
      format: s.format,
      duration: s.duration,
      language: s.language,
      brief: s.brief,
      script: s.script,
      files: s.files,
      styleHints: s.styleHints,
      error: s.error,
    })),
  );
  const autopilot = useBridgeStore((s) => s.status?.autopilot ?? null);
  const chatListening = useBridgeStore((s) => s.status?.listener === "listening" && s.status.listenerClient !== "headless");
  const size = FORMAT_SIZE[state.format];
  const materials = state.files.filter((f) => f.role !== "reference");
  const references = state.files.filter((f) => f.role === "reference");
  const pending = state.files.filter((f) => f.status === "uploading" || f.status === "processing" || f.analysis?.state === "processing");
  const failed = state.files.filter((f) => f.status === "error");
  const rows: [string, ReactNode][] = [
    ["Kind", KINDS.find((k) => k.value === state.kind)?.title],
    ["Video", `${state.format} · ${size.width}×${size.height} · ${state.duration} s · ${state.language}`],
    ["About", state.brief.trim() || <span className="text-danger">Write what the video is about (step 1)</span>],
    ["Files", materials.length ? materials.map((f) => `${ROLE_LABELS[f.role as MaterialRole]}: ${f.name}`).join(" · ") : "None"],
    ["Script", state.script.trim() ? `${state.script.trim().slice(0, 140)}${state.script.trim().length > 140 ? "…" : ""}` : "None"],
    ["Style", state.styleHints.length ? state.styleHints.join(", ") : "Claude proposes three"],
    ["References", references.length ? references.map((f) => f.name).join(", ") : "None"],
  ];
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd dir="auto" className="min-w-0 break-words">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {pending.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-accent-2">
          <LoaderCircle size={12} className="animate-spin" /> Waiting for {pending.length} file(s) to finish uploading and preparing.
        </p>
      )}
      {failed.length > 0 && <p className="text-[11.5px] text-danger">{failed.length} file(s) failed and will be left out: {failed.map((f) => f.name).join(", ")}</p>}
      <div className="rounded-md border border-border bg-panel p-2.5 text-[12px]">
        <div className="mb-1 font-medium">Claude</div>
        {chatListening ? (
          <p className="text-muted">A Claude chat is listening to the editor; it will answer.</p>
        ) : autopilot?.running ? (
          <p className="text-muted">The autopilot is on ({autopilot.model ?? "Claude"}): style frames arrive in a few minutes.</p>
        ) : (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={turnOn} onChange={(event) => setTurnOn(event.target.checked)} />
            <span>
              Turn the autopilot on, so Claude starts right away. <span className="text-muted">It waits for free and uses your Claude plan only for each step.</span>
            </span>
          </label>
        )}
      </div>
      {state.error && <p className="text-[11.5px] text-danger">{state.error}</p>}
    </div>
  );
}

export function NewVideoWizard() {
  const { open, step, brief, kind, files, starting } = useWizardStore(
    useShallow((s) => ({ open: s.open, step: s.step, brief: s.brief, kind: s.kind, files: s.files, starting: s.starting })),
  );
  const [turnOn, setTurnOn] = useState(true);

  useEffect(() => {
    if (newFromUrl !== null) return;
    const url = new URL(window.location.href);
    newFromUrl = url.searchParams.get("new") === "1";
    if (!newFromUrl) return;
    url.searchParams.delete("new");
    window.history.replaceState(null, "", url.toString());
    useWizardStore.getState().show();
  }, []);

  if (!open) return null;
  const { hide, setStep, start, reset } = useWizardStore.getState();
  const pending = files.some((f) => f.status === "uploading" || f.status === "processing" || f.analysis?.state === "processing");
  const needsFootage = kind === "footage" && !files.some((f) => f.role === "footage" && f.status !== "error");
  const canStart = brief.trim().length > 0 && !pending && !needsFootage && !starting;

  const begin = async () => {
    const autopilot = useBridgeStore.getState().status?.autopilot;
    const chatListening = useBridgeStore.getState().status?.listener === "listening";
    if (turnOn && !autopilot?.running && !chatListening) await autopilotAction("start").catch(() => undefined);
    const board = await start();
    if (!board) return;
    useBoardStore.getState().open(board.id);
    useEditorStore.getState().setNotice({ kind: "info", message: "Storyboard started: Claude is preparing style frames" });
    reset();
    hide();
  };

  const footer = (
    <>
      <Button variant="ghost" size="sm" className="mr-auto" onClick={() => reset()} title="Clear everything in the wizard">
        Start over
      </Button>
      {step > 0 && (
        <Button icon={<ArrowLeft size={13} />} onClick={() => setStep((step - 1) as WizardStep)}>
          Back
        </Button>
      )}
      {step < 3 ? (
        <Button variant="primary" icon={<ArrowRight size={13} />} disabled={step === 0 && !brief.trim()} onClick={() => setStep((step + 1) as WizardStep)}>
          Next
        </Button>
      ) : (
        <Button
          variant="primary"
          icon={<Clapperboard size={13} />}
          loading={starting}
          disabled={!canStart}
          onClick={() => void begin()}
          title={pending ? "Waiting for uploads" : needsFootage ? "Add the footage first" : undefined}
        >
          Start the storyboard
        </Button>
      )}
    </>
  );

  return (
    <Modal title="New video" onClose={hide} width={820} footer={footer}>
      <ol className="mb-4 flex items-center gap-1.5">
        {STEPS.map((entry, i) => (
          <li key={entry.title} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => (i <= step || brief.trim() ? setStep(i as WizardStep) : undefined)}
              className={cx(
                "ms-focus flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px]",
                i === step ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted hover:text-foreground",
              )}
            >
              <span className="font-mono text-[10.5px]">{i + 1}</span>
              {entry.title}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-5 bg-border" />}
          </li>
        ))}
      </ol>
      {step === 0 && <KindStep />}
      {step === 1 && <ContentStep />}
      {step === 2 && <StyleStep />}
      {step === 3 && <StartStep turnOn={turnOn} setTurnOn={setTurnOn} />}
    </Modal>
  );
}

/** The top bar's entry point. */
export function NewVideoButton() {
  return (
    <Button
      size="sm"
      variant="primary"
      icon={<Clapperboard size={14} />}
      onClick={() => useWizardStore.getState().show()}
      title="Start a new video: kind, your files, the style, then the storyboard"
    >
      New video
    </Button>
  );
}
