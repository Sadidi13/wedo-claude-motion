"use client";
/**
 * Layers panel (left). Rows come from `flattenLayers`, i.e. After Effects
 * order: the LAST child of the Stage (drawn on top) is the FIRST row, and a
 * group's children are listed the same way right under it. Row = chevron ·
 * kind icon · name (double-click to rename) · timing badge · eye · lock, with
 * hover actions and a right-click menu for duplicate / delete / bring
 * forward / send backward / wrap in Sprite. The header inserts Text / Image /
 * Shape layers at the playhead.
 */
import {
  ArrowDown,
  ArrowUp,
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  Circle,
  Clapperboard,
  Component,
  Copy,
  Cuboid,
  Ellipsis,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Shapes,
  Square,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import type { LayerKind, LayerNode } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";
import { flattenLayers, hasLiteralTiming, sourceDirectionFor, type LayerRow } from "@/store/layerRows";
import { formatRange } from "@/store/time";
import { Button } from "./ui/Button";
import { ContextMenu, type ContextMenuItem } from "./ui/ContextMenu";
import { cx } from "./ui/cx";
import { IconButton } from "./ui/IconButton";

const KIND_ICON: Record<LayerKind, LucideIcon> = {
  sprite: Clapperboard,
  text: Type,
  image: ImageIcon,
  shape: Shapes,
  group: Boxes,
  canvas: Cuboid,
  component: Component,
  element: Box,
};

const EMPTY_LAYERS: LayerNode[] = [];

interface MenuState {
  x: number;
  y: number;
  id: string;
}

function layerMenuItems(node: LayerNode): ContextMenuItem[] {
  const store = useEditorStore.getState();
  return [
    { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => store.duplicateLayer(node.id) },
    {
      label: "Bring forward",
      icon: <ArrowUp size={14} />,
      onSelect: () => store.moveLayer(node.id, { direction: sourceDirectionFor("up") }),
      disabled: node.locked,
    },
    {
      label: "Send backward",
      icon: <ArrowDown size={14} />,
      onSelect: () => store.moveLayer(node.id, { direction: sourceDirectionFor("down") }),
      disabled: node.locked,
    },
    {
      label: "Wrap in Sprite",
      icon: <Clapperboard size={14} />,
      onSelect: () => store.wrapInSprite(node.id, node.range.start, node.range.end),
      disabled: node.kind === "sprite" || node.locked,
      separator: true,
    },
    { label: node.hidden ? "Show" : "Hide", icon: node.hidden ? <Eye size={14} /> : <EyeOff size={14} />, onSelect: () => store.setHidden(node.id, !node.hidden) },
    { label: node.locked ? "Unlock" : "Lock", icon: node.locked ? <LockOpen size={14} /> : <Lock size={14} />, onSelect: () => store.setLocked(node.id, !node.locked) },
    { label: "Delete", icon: <Trash2 size={14} />, onSelect: () => store.deleteLayer(node.id), disabled: node.locked, danger: true, separator: true },
  ];
}

function RenameInput({ node, onDone }: { node: LayerNode; onDone: () => void }) {
  const [draft, setDraft] = useState(node.name);
  const commit = () => {
    onDone();
    if (draft.trim() !== node.name) useEditorStore.getState().renameLayer(node.id, draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") commit();
    if (event.key === "Escape") onDone();
  };
  return (
    <input
      autoFocus
      aria-label="Layer name"
      className="ms-input h-5 min-w-0 flex-1 select-text px-1 py-0"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}

interface RowProps {
  row: LayerRow;
  selected: boolean;
  renaming: boolean;
  onRename: (id: string | null) => void;
  onMenu: (state: MenuState) => void;
}

function LayerRowItem({ row, selected, renaming, onRename, onMenu }: RowProps) {
  const { node, depth, hasChildren, collapsed } = row;
  const store = useEditorStore.getState();
  const Icon = KIND_ICON[node.kind];
  const dynamic = node.kind === "sprite" && !hasLiteralTiming(node);

  const openMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    store.select(node.id);
    onMenu({ x: event.clientX, y: event.clientY, id: node.id });
  };

  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-level={depth + 1}
      aria-expanded={hasChildren ? !collapsed : undefined}
      data-layer-row={node.id}
      tabIndex={-1}
      onClick={() => store.select(node.id)}
      onDoubleClick={() => onRename(node.id)}
      onContextMenu={openMenu}
      className={cx(
        "group flex h-7 cursor-default items-center gap-1 pr-1 text-[12px]",
        selected ? "bg-accent/15 text-foreground" : "hover:bg-panel-2",
        node.hidden && "opacity-50",
      )}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={collapsed ? "Expand" : "Collapse"}
        onClick={(event) => {
          event.stopPropagation();
          store.toggleCollapsed(node.id);
        }}
        className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted hover:text-foreground", !hasChildren && "invisible")}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </button>
      <Icon size={14} className={cx("shrink-0", node.kind === "sprite" ? "text-accent" : "text-muted")} />
      {renaming ? (
        <RenameInput node={node} onDone={() => onRename(null)} />
      ) : (
        <span className="min-w-0 flex-1 truncate" title={`${node.name} <${node.tag}>`}>
          {node.name}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-0.5 group-hover:hidden">
        {dynamic && (
          <span title="Timing is an expression; edit it in the Code tab" className="rounded bg-accent-2/15 px-1 font-mono text-[9.5px] text-accent-2">
            expr
          </span>
        )}
        <span className="font-mono text-[10px] tabular-nums text-muted">{formatRange(node.range)}</span>
      </span>
      <span className="hidden shrink-0 items-center group-hover:flex">
        <IconButton size="sm" title="Duplicate (Ctrl+D)" onClick={(event) => { event.stopPropagation(); store.duplicateLayer(node.id); }}>
          <Copy size={12} />
        </IconButton>
        <IconButton size="sm" title="Delete" danger disabled={node.locked} onClick={(event) => { event.stopPropagation(); store.deleteLayer(node.id); }}>
          <Trash2 size={12} />
        </IconButton>
        <IconButton size="sm" title="More actions" onClick={openMenu}>
          <Ellipsis size={12} />
        </IconButton>
      </span>
      <IconButton
        size="sm"
        title={node.hidden ? "Show layer (H)" : "Hide layer (H)"}
        active={node.hidden}
        onClick={(event) => {
          event.stopPropagation();
          store.setHidden(node.id, !node.hidden);
        }}
      >
        {node.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
      </IconButton>
      <IconButton
        size="sm"
        title={node.locked ? "Unlock layer" : "Lock layer"}
        active={node.locked}
        onClick={(event) => {
          event.stopPropagation();
          store.setLocked(node.id, !node.locked);
        }}
      >
        {node.locked ? <Lock size={12} /> : <LockOpen size={12} />}
      </IconButton>
    </div>
  );
}

export function LayersPanel() {
  const { layers, byId, collapsed, selectedId, hasProject, parseError } = useEditorStore(
    useShallow((s) => ({
      layers: s.scene?.layers ?? EMPTY_LAYERS,
      byId: s.scene?.byId,
      collapsed: s.collapsed,
      selectedId: s.selectedId,
      hasProject: s.project !== null,
      parseError: s.parseError,
    })),
  );
  const rows = useMemo(() => flattenLayers(layers, collapsed), [layers, collapsed]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [shapeMenu, setShapeMenu] = useState<{ x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeShapeMenu = useCallback(() => setShapeMenu(null), []);

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    listRef.current.querySelector(`[data-layer-row="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const store = useEditorStore.getState();
  const menuNode = menu && byId ? byId[menu.id] : undefined;
  const disabled = !byId;

  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-panel" aria-label="Layers">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Layers</span>
        <span className="font-mono text-[10px] text-muted">{byId ? Object.keys(byId).length : 0}</span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" icon={<Type size={14} />} title="Add a text layer at the playhead" disabled={disabled} onClick={() => store.addTextLayer()}>
          Text
        </Button>
        <Button size="sm" variant="ghost" icon={<ImageIcon size={14} />} title="Add an image layer at the playhead" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
          Image
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Shapes size={14} />}
          title="Add a shape layer at the playhead"
          disabled={disabled}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setShapeMenu({ x: rect.left, y: rect.bottom + 2 });
          }}
        >
          Shape
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Image file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void store.addImageLayer(file);
          }}
        />
      </div>

      <div ref={listRef} role="tree" aria-label="Layer tree" className="ms-scroll min-h-0 flex-1 overflow-auto py-1">
        {!hasProject && <p className="px-3 py-2 text-muted">Loading project…</p>}
        {hasProject && parseError && (
          <p className="px-3 py-2 text-[11.5px] text-danger">The scene file does not parse. Fix it in the Code tab (whole scene).</p>
        )}
        {hasProject && !parseError && rows.length === 0 && <p className="px-3 py-2 text-muted">No layers yet. Add text, an image or a shape above.</p>}
        {rows.map((row) => (
          <LayerRowItem
            key={row.node.id}
            row={row}
            selected={row.node.id === selectedId}
            renaming={renamingId === row.node.id}
            onRename={setRenamingId}
            onMenu={setMenu}
          />
        ))}
      </div>

      {menu && menuNode && <ContextMenu x={menu.x} y={menu.y} items={layerMenuItems(menuNode)} onClose={closeMenu} />}
      {shapeMenu && (
        <ContextMenu
          x={shapeMenu.x}
          y={shapeMenu.y}
          onClose={closeShapeMenu}
          items={[
            { label: "Rectangle", icon: <Square size={14} />, onSelect: () => store.addShapeLayer("rect") },
            { label: "Circle", icon: <Circle size={14} />, onSelect: () => store.addShapeLayer("circle") },
          ]}
        />
      )}
    </aside>
  );
}
