"use client";
/**
 * Right-hand inspector with three tabs: Properties (layer / stage fields),
 * Code (exact source of the selected layer or the whole scene) and Ask Claude.
 * All three stay mounted (hidden with CSS) so drafts and in-flight requests
 * survive a tab switch.
 */
import { Braces, SlidersHorizontal, Sparkles } from "lucide-react";
import { AskClaudeTab } from "./AskClaudeTab";
import { CodeTab } from "./CodeTab";
import { PropertiesTab } from "./PropertiesTab";
import { cx } from "./ui/cx";
import { Segmented } from "./ui/Segmented";

export type InspectorTab = "properties" | "code" | "ask";

interface InspectorProps {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onOpenCode: () => void;
}

const TABS = [
  { value: "properties", label: <span className="inline-flex items-center gap-1"><SlidersHorizontal size={13} /> Properties</span>, title: "Layer and stage properties" },
  { value: "code", label: <span className="inline-flex items-center gap-1"><Braces size={13} /> Code</span>, title: "Edit the layer's source" },
  { value: "ask", label: <span className="inline-flex items-center gap-1"><Sparkles size={13} /> Ask Claude</span>, title: "Rewrite with Claude" },
] as const;

export function Inspector({ tab, onTabChange, onOpenCode }: InspectorProps) {
  return (
    <aside className="flex min-h-0 flex-col border-l border-border bg-panel" aria-label="Inspector">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-2">
        <Segmented block size="sm" value={tab} options={TABS} onChange={onTabChange} />
      </div>
      <div className={cx("ms-scroll min-h-0 flex-1 overflow-auto", tab !== "properties" && "hidden")}>
        <PropertiesTab onOpenCode={onOpenCode} />
      </div>
      <div className={cx("flex min-h-0 flex-1 flex-col", tab !== "code" && "hidden")}>
        <CodeTab />
      </div>
      <div className={cx("flex min-h-0 flex-1 flex-col", tab !== "ask" && "hidden")}>
        <AskClaudeTab />
      </div>
    </aside>
  );
}
