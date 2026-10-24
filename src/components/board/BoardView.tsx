"use client";
/**
 * Storyboard view (docs/STORYBOARD.md): the full-window panel where the
 * designer steers a new video before it is built.
 *
 *   1. Style  — Claude's style frames side by side (live, hover to play);
 *               "Choose this style", or "Try other styles", each with a note.
 *   2. Storyboard — the shots in the chosen style (sketches where Claude drew
 *               them), a strip of their timing; "Approve and make the video",
 *               or "Ask for changes".
 *   3. Video  — Claude builds it; the project opens in the editor.
 *
 * While Claude works on a step the view says who is listening and what to do
 * when nobody is. The open board is polled every 1.5 s.
 */
import { Check, Clapperboard, LayoutGrid, LoaderCircle, Palette, Paperclip, RefreshCw, Sparkles, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Board, BoardShot, BoardStatus, BoardStyle, BridgeStatus } from "@/lib/types";
import { MAX_REFERENCE_FILES, checkReferenceFiles, useBoardStore } from "@/store/boardStore";
import { isDesktopConnected, useBridgeStore } from "@/store/bridgeStore";
import { useEditorStore } from "@/store/editorStore";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { IconButton } from "../ui/IconButton";
import { FramePreview } from "./FramePreview";

const POLL_MS = 1_500;

type View = "styles" | "storyboard" | "video";

function viewFor(status: BoardStatus): View {
  if (status === "styles-pending" || status === "choose-style") return "styles";
  if (status === "storyboard-pending" || status === "storyboard") return "storyboard";
  return "video";
}

const STEP_ORDER: View[] = ["styles", "storyboard", "video"];
const STEP_LABEL: Record<View, string> = { styles: "1  Style", storyboard: "2  Storyboard", video: "3  Video" };

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(2))}s`;
}

function Steps({ status, view, onView }: { status: BoardStatus; view: View; onView: (view: View) => void }) {
  const reached = STEP_ORDER.indexOf(viewFor(status));
  return (
    <div className="flex items-center gap-1">
      {STEP_ORDER.map((step, index) => {
        const done = index < reached || status === "built";
        const enabled = index <= reached;
        return (
          <button
            key={step}
            type="button"
            disabled={!enabled}
            onClick={() => onView(step)}
            className={cx(
              "ms-focus inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11.5px] transition-colors disabled:cursor-default",
              view === step ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted",
              enabled && view !== step && "hover:text-foreground",
              !enabled && "opacity-50",
            )}
          >
            {done ? <Check size={12} className="text-success" /> : null}
            <span className="whitespace-pre">{STEP_LABEL[step]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Who answers Claude-side steps, and what to do when nobody does. */
function ListenerHint({ status, recentlyActive }: { status: BridgeStatus | null; recentlyActive: boolean }) {
  if (isDesktopConnected(status) || recentlyActive) {
    const who = status?.listenerClient === "headless" ? "The autopilot" : "Claude";
    return <p className="text-[12px] text-muted">{who} is on it. This usually takes under a minute.</p>;
  }
  return (
    <p dir="auto" className="max-w-[640px] rounded border border-accent-2/40 bg-accent-2/10 px-3 py-2 text-[12px] leading-[1.6] text-accent-2">
      Nobody is listening yet. Start the autopilot (the <b>WeDo Claude Motion - Autopilot</b> shortcut, or{" "}
      <span className="font-mono">scripts/start-autopilot.cmd</span>), or write <b>“check Claude Motion”</b> (
      <span dir="rtl">«کلاد موشن رو چک کن»</span>) to Claude in the chat or the Code tab.
    </p>
  );
}

function Waiting({ title, board }: { title: string; board: Board }) {
  const { status, recentlyActive } = useBridgeStore(useShallow((s) => ({ status: s.status, recentlyActive: s.recentlyActive })));
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <LoaderCircle size={26} className="animate-spin text-accent" />
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {board.waitingRequestId ? <ListenerHint status={status} recentlyActive={recentlyActive} /> : null}
    </div>
  );
}

function NoteBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <textarea
      dir="auto"
      rows={2}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="ms-input ms-scroll min-h-[48px] w-full max-w-[720px] select-text resize-y leading-[1.5]"
      aria-label="Note for Claude"
    />
  );
}

function StyleCard({ style, board, chosen, onChoose, busy }: { style: BoardStyle; board: Board; chosen: boolean; onChoose: () => void; busy: boolean }) {
  const built = board.status === "built";
  return (
    <article
      className={cx(
        "flex flex-col gap-2.5 rounded-lg border bg-panel p-2.5 transition-colors",
        chosen ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-border hover:border-border-strong",
      )}
    >
      <FramePreview code={style.code} files={style.files} meta={board.meta} time={style.time} label={style.name} />
      <div className="flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <h4 dir="auto" className="text-[13px] font-semibold">
            <span className="mr-1.5 font-mono text-[11px] uppercase text-muted">{style.id}</span>
            {style.name}
          </h4>
          {style.description && (
            <p dir="auto" className="mt-0.5 text-[11.5px] leading-[1.5] text-muted">
              {style.description}
            </p>
          )}
        </div>
      </div>
      <Button variant={chosen ? "default" : "primary"} icon={chosen ? <Check size={13} /> : <Palette size={13} />} onClick={onChoose} disabled={busy || built || (chosen && board.status !== "choose-style")}>
        {chosen ? "Chosen" : "Choose this style"}
      </Button>
    </article>
  );
}

/** The designer's reference images / videos (their previews), and a button to add more before new styles. */
function ReferencesStrip({ board, canAdd }: { board: Board; canAdd: boolean }) {
  const { addReferences, busy } = useBoardStore(useShallow((s) => ({ addReferences: s.addReferences, busy: s.busy })));
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const references = board.references ?? [];
  if (!references.length && !canAdd) return null;
  const onPick = (files: FileList | null) => {
    const picked = Array.from(files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    const error = checkReferenceFiles(picked, references.length);
    setProblem(error);
    if (!error && picked.length) void addReferences(picked);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-3">
        {references.map((ref) => (
          <figure key={ref.id} className="flex flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local thumbnail from the bridge, nothing to optimise */}
            <img
              src={`/api/bridge/boards/${board.id}/refs/${ref.preview}`}
              alt={`Reference ${ref.name}`}
              className="h-20 rounded border border-border object-cover"
            />
            <figcaption className="max-w-[220px] truncate text-[10.5px] text-muted" title={ref.name}>
              {ref.kind === "video" ? `Video ${ref.duration ?? ""}s · ` : ""}
              {ref.name}
            </figcaption>
          </figure>
        ))}
        {canAdd && references.length < MAX_REFERENCE_FILES && (
          <Button size="sm" icon={<Paperclip size={12} />} disabled={busy} onClick={() => inputRef.current?.click()} title="An image or video whose look Claude should match">
            Add a reference
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(event) => onPick(event.target.files)}
        />
      </div>
      {problem && <p className="text-[11px] text-danger">{problem}</p>}
    </div>
  );
}

function StylesStep({ board }: { board: Board }) {
  const { act, busy } = useBoardStore(useShallow((s) => ({ act: s.act, busy: s.busy })));
  const [note, setNote] = useState("");
  if (board.status === "styles-pending") {
    return (
      <>
        {(board.references?.length ?? 0) > 0 && (
          <div className="flex justify-center px-6 pt-8">
            <ReferencesStrip board={board} canAdd={false} />
          </div>
        )}
        <Waiting title="Claude is preparing style frames…" board={board} />
      </>
    );
  }
  const columns = board.meta.width >= board.meta.height ? "minmax(300px, 1fr)" : "minmax(220px, 1fr)";
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <p dir="auto" className="max-w-[760px] text-[12.5px] leading-[1.6] text-muted">
        Pick the look of the video. Each frame is the same moment of <b className="text-foreground">{board.title}</b> in a different style.
        Hover a frame to play it. You can add a note for Claude before choosing.
      </p>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, ${columns})` }}>
        {board.styles.map((style) => (
          <StyleCard
            key={`${board.stylesRevision}:${style.id}`}
            style={style}
            board={board}
            chosen={board.chosenStyleId === style.id}
            busy={busy}
            onChoose={() => void act({ action: "choose-style", styleId: style.id, ...(note.trim() ? { note: note.trim() } : {}) }).then((ok) => ok && setNote(""))}
          />
        ))}
      </div>
      {board.status !== "built" && <div className="flex flex-col gap-2">
        <ReferencesStrip board={board} canAdd />
        <NoteBox value={note} onChange={setNote} placeholder="Note for Claude (optional), e.g. use our brand blue, a calmer font, more space around the title" />
        <div>
          <Button
            icon={<RefreshCw size={13} />}
            disabled={busy}
            onClick={() => void act({ action: "restyle", ...(note.trim() ? { note: note.trim() } : {}) }).then((ok) => ok && setNote(""))}
          >
            Try other styles
          </Button>
        </div>
      </div>}
    </div>
  );
}

function ShotStrip({ shots, duration }: { shots: BoardShot[]; duration: number }) {
  return (
    <div className="relative h-7 w-full max-w-[960px] overflow-hidden rounded border border-border bg-panel">
      {shots.map((shot, index) => (
        <div
          key={shot.id}
          title={`${shot.title}: ${formatSeconds(shot.start)}-${formatSeconds(shot.end)}`}
          className={cx("absolute inset-y-0 flex items-center overflow-hidden border-r border-background px-1.5 text-[10.5px]", index % 2 ? "bg-accent/25" : "bg-accent/40")}
          style={{ left: `${(shot.start / duration) * 100}%`, width: `${((shot.end - shot.start) / duration) * 100}%` }}
        >
          <span className="truncate" dir="auto">
            {index + 1}. {shot.title}
          </span>
        </div>
      ))}
    </div>
  );
}

function ShotRow({ shot, index, board }: { shot: BoardShot; index: number; board: Board }) {
  const thumbWidth = board.meta.width >= board.meta.height ? 260 : 150;
  return (
    <article className="flex gap-4 rounded-lg border border-border bg-panel p-3">
      <div className="shrink-0" style={{ width: thumbWidth }}>
        {shot.code ? (
          <FramePreview code={shot.code} files={shot.files} meta={board.meta} time={shot.time ?? 0} label={shot.title} />
        ) : (
          <div
            className="flex w-full items-center justify-center rounded-md border border-dashed border-border-strong bg-panel-2 p-3 text-center text-[11px] text-muted"
            style={{ aspectRatio: `${board.meta.width} / ${board.meta.height}` }}
          >
            <span dir="auto">{shot.title}</span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-muted">{index + 1}</span>
          <h4 dir="auto" className="text-[13px] font-semibold">
            {shot.title}
          </h4>
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted">
            {formatSeconds(shot.start)} – {formatSeconds(shot.end)}
          </span>
        </div>
        <p dir="auto" className="mt-1.5 text-[12px] leading-[1.6]">
          {shot.action}
        </p>
        {shot.text && (
          <p dir="auto" className="mt-1.5 text-[12px] leading-[1.6] text-muted">
            <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-wide text-accent">On screen</span>
            {shot.text}
          </p>
        )}
        {shot.audio && (
          <p dir="auto" className="mt-1 text-[12px] leading-[1.6] text-muted">
            <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-wide text-accent-2">Sound</span>
            {shot.audio}
          </p>
        )}
      </div>
    </article>
  );
}

function StoryboardStep({ board }: { board: Board }) {
  const { act, busy } = useBoardStore(useShallow((s) => ({ act: s.act, busy: s.busy })));
  const [note, setNote] = useState("");
  const chosen = board.styles.find((style) => style.id === board.chosenStyleId);
  if (board.status === "storyboard-pending") {
    return <Waiting title={`Claude is writing the storyboard in the “${chosen?.name ?? "chosen"}” style…`} board={board} />;
  }
  if (board.shots.length === 0) return <Waiting title="Waiting for the storyboard…" board={board} />;
  const canAct = board.status === "storyboard" || board.status === "build-pending";
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <p dir="auto" className="max-w-[760px] text-[12.5px] leading-[1.6] text-muted">
        The storyboard of <b className="text-foreground">{board.title}</b> in the <b className="text-foreground">{chosen?.name}</b> style,{" "}
        {board.shots.length} shots over {formatSeconds(board.meta.duration)}. Approve it to make the video, or ask for changes.
      </p>
      <ShotStrip shots={board.shots} duration={board.meta.duration} />
      {board.storyboardNotes && (
        <p dir="auto" className="max-w-[960px] whitespace-pre-wrap rounded border border-border bg-panel-2 px-3 py-2 text-[12px] leading-[1.6] text-muted">
          {board.storyboardNotes}
        </p>
      )}
      <div className="flex max-w-[960px] flex-col gap-3">
        {board.shots.map((shot, index) => (
          <ShotRow key={`${board.storyboardRevision}:${shot.id}`} shot={shot} index={index} board={board} />
        ))}
      </div>
      {canAct && (
        <div className="flex flex-col gap-2">
          <NoteBox value={note} onChange={setNote} placeholder="What should change? e.g. shorter intro, the logo at the end, a calmer music cue" />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={<Wand2 size={13} />}
              disabled={busy}
              onClick={() => void act({ action: "approve", ...(note.trim() ? { note: note.trim() } : {}) }).then((ok) => ok && setNote(""))}
            >
              Approve and make the video
            </Button>
            <Button
              icon={<RefreshCw size={13} />}
              disabled={busy || !note.trim()}
              title={note.trim() ? undefined : "Write what should change first"}
              onClick={() => void act({ action: "revise-storyboard", note: note.trim() }).then((ok) => ok && setNote(""))}
            >
              Ask for changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoStep({ board }: { board: Board }) {
  const close = useBoardStore((s) => s.close);
  const projectId = useEditorStore((s) => s.project?.id ?? null);
  if (board.status !== "built") {
    const chosen = board.styles.find((style) => style.id === board.chosenStyleId);
    return <Waiting title={`Claude is making the video in the “${chosen?.name ?? "chosen"}” style…`} board={board} />;
  }
  const open = projectId !== null && projectId === board.projectId;
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Sparkles size={26} className="text-success" />
      <h3 className="text-[15px] font-semibold">The video is ready</h3>
      <p className="text-[12px] text-muted">{open ? "It is open in the editor: every element is its own layer." : "It opens in the editor tab that works with Claude."}</p>
      <Button variant="primary" icon={<Clapperboard size={13} />} onClick={close}>
        Show the video
      </Button>
    </div>
  );
}

export function BoardView() {
  const { openId, board, error, close, refresh } = useBoardStore(
    useShallow((s) => ({ openId: s.openId, board: s.board, error: s.error, close: s.close, refresh: s.refresh })),
  );
  // A step the designer clicked back to; it lasts until the board moves on (then the view follows the board).
  const [picked, setPicked] = useState<{ view: View; boardId: string; status: BoardStatus } | null>(null);

  useEffect(() => {
    if (!openId) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [openId, refresh]);

  useEffect(() => {
    if (!openId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openId, close]);

  if (!openId) return null;
  const shown: View = !board
    ? "styles"
    : picked && picked.boardId === board.id && picked.status === board.status
      ? picked.view
      : viewFor(board.status);
  const setView = (view: View) => {
    if (board) setPicked({ view, boardId: board.id, status: board.status });
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Storyboard">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-panel px-4">
        <LayoutGrid size={16} className="text-accent" />
        <span className="text-[13px] font-semibold">Storyboard</span>
        {board && (
          <span dir="auto" className="max-w-[36vw] truncate text-[13px] text-muted" title={board.brief}>
            {board.title}
          </span>
        )}
        <div className="flex-1" />
        {board && <Steps status={board.status} view={shown} onView={setView} />}
        <div className="flex-1" />
        <span className="hidden text-[11px] text-muted md:inline">
          {board ? `${board.meta.width}×${board.meta.height} · ${board.meta.duration}s` : ""}
        </span>
        <IconButton title="Close (Esc)" onClick={close}>
          <X size={16} />
        </IconButton>
      </header>
      {(error || board?.lastError) && (
        <div dir="auto" className="shrink-0 border-b border-danger/40 bg-danger/10 px-4 py-2 text-[12px] text-danger">
          {board?.lastError ? `Claude could not do this step: ${board.lastError}` : error}
        </div>
      )}
      <main className="ms-scroll min-h-0 flex-1 overflow-auto">
        {!board ? (
          <div className="flex items-center justify-center py-20 text-muted">
            <LoaderCircle size={20} className="animate-spin" />
          </div>
        ) : shown === "styles" ? (
          <StylesStep board={board} />
        ) : shown === "storyboard" ? (
          <StoryboardStep board={board} />
        ) : (
          <VideoStep board={board} />
        )}
      </main>
    </div>
  );
}
