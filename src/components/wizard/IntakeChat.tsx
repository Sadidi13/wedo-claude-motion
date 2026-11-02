"use client";
/**
 * "Talk it through with Claude" in the New video wizard: Claude asks a few short questions (the
 * autopilot answers each turn at the everyday effort) and ends with an order; "Use this" fills the
 * wizard (kind, brief, format, length, language, script, style picks) and goes on to the content.
 */
import { ArrowRight, LoaderCircle, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBridgeStore } from "@/store/bridgeStore";
import { chatGreeting, useWizardStore } from "@/store/wizardStore";
import { autopilotAction } from "../AutopilotChip";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";

export function IntakeChat() {
  const { chat, pending, error, order, language, sendChat, applyOrder } = useWizardStore(
    useShallow((s) => ({
      chat: s.chat,
      pending: s.chatPending,
      error: s.chatError,
      order: s.order,
      language: s.language,
      sendChat: s.sendChat,
      applyOrder: s.applyOrder,
    })),
  );
  const autopilot = useBridgeStore((s) => s.status?.autopilot ?? null);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const messages = chat.length ? chat : [chatGreeting(language)];
  const persian = language === "Persian";

  useEffect(() => {
    // A block body: newer Chromium returns a promise from scrollIntoView, and an effect must return nothing but a cleanup.
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, pending]);

  const send = async (text: string) => {
    if (!text.trim() || pending) return;
    // The conversation is answered by the autopilot: turn it on when nobody listens.
    if (!autopilot?.running) await autopilotAction("start").catch(() => undefined);
    setDraft("");
    await sendChat(text);
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-panel p-2.5">
      <div className="ms-scroll flex max-h-[300px] min-h-[160px] flex-col gap-2 overflow-auto pr-1">
        {messages.map((message, i) => (
          <div
            key={i}
            dir="auto"
            className={cx(
              "max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-[12.5px] leading-5",
              message.role === "designer" ? "self-end bg-accent/15 text-foreground" : "self-start bg-panel-3 text-foreground",
            )}
          >
            {message.text}
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-1.5 self-start text-[11.5px] text-muted">
            <LoaderCircle size={12} className="animate-spin" /> Claude is thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>
      {error && <p className="text-[11px] text-danger">{error}</p>}
      {order ? (
        <div className="flex flex-col gap-2 rounded border border-accent/40 bg-accent/10 p-2 text-[12px]">
          <div className="flex items-center gap-1.5 font-medium">
            <Sparkles size={13} className="text-accent" /> The order is ready
          </div>
          <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11.5px]">
            <dt className="text-muted">Kind</dt>
            <dd>{order.kind === "footage" ? "Footage of a person" : "Motion graphics"}</dd>
            <dt className="text-muted">Video</dt>
            <dd>
              {order.format} · {order.duration} s · {order.language}
            </dd>
            <dt className="text-muted">About</dt>
            <dd dir="auto">{order.brief}</dd>
            {order.styleHints?.length ? (
              <>
                <dt className="text-muted">Style</dt>
                <dd>{order.styleHints.join(", ")}</dd>
              </>
            ) : null}
          </dl>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" icon={<ArrowRight size={12} />} onClick={applyOrder}>
              Use this and add files
            </Button>
            <span className="self-center text-[11px] text-muted">or keep talking to change it</span>
          </div>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          dir="auto"
          rows={2}
          className="ms-input min-h-[44px] min-w-0 flex-1 select-text resize-y py-1.5 leading-5"
          placeholder={persian ? "جواب بده یا هر چی می‌خوای بگو…" : "Answer, or say anything about the video…"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
        <div className="flex flex-col gap-1">
          <Button size="sm" variant="primary" icon={<Send size={12} />} loading={pending} disabled={!draft.trim()} onClick={() => void send(draft)} title="Send (Ctrl+Enter)">
            Send
          </Button>
          {chat.length > 2 && !order && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => void send(persian ? "کافیه، خلاصهٔ سفارش رو بده." : "That's enough, please give me the order.")}>
              Wrap it up
            </Button>
          )}
        </div>
      </div>
      <p className="text-[10.5px] text-muted">The autopilot answers ({autopilot?.model ?? "Claude"}); each answer is one short Claude run on your plan.</p>
    </div>
  );
}
