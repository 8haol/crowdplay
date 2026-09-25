import { useState } from "react";
import { AdminIcon, Btn } from "../adminUi";
import { T } from "../adminTokens";
import {
  FILTER_OPTIONS,
  SIZE_OPTIONS,
  SORT_OPTIONS,
  type FilterCounts,
  type SizeId,
  type ViewState,
} from "./albumView";

/*
 * 网格上方的吸顶工具条：搜索、类型筛选（带数量）、排序、缩略图大小、进入多选。
 * 手机上排成两行：第一行搜索 + 排序 + 大小 + 选择，第二行是可以横滑的筛选。
 * 多选时同一个位置换成选择条，高度不变，网格不会在手指下面跳。
 */

const FIELD = { background: T.panel, border: "1px solid var(--color-admin-panel-line)", color: T.ink } as const;

export function AlbumToolbar({
  view,
  counts,
  searchKey,
  onChange,
  onStartSelect,
}: {
  view: ViewState;
  counts: FilterCounts;
  /** 「清除筛选」时换一个 key，让搜索框按新的值重新开始。 */
  searchKey: number;
  onChange: (patch: Partial<ViewState>) => void;
  onStartSelect: () => void;
}) {
  const sortLabel = SORT_OPTIONS.find((option) => option.id === view.sort)?.label ?? "";
  const sizeIndex = Math.max(0, SIZE_OPTIONS.findIndex((option) => option.id === view.size));
  const nextSize = SIZE_OPTIONS[(sizeIndex + 1) % SIZE_OPTIONS.length];

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      <SearchBox key={searchKey} initial={view.q} onChange={(q) => onChange({ q })} />

      <label
        className="relative order-2 inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-xl text-sm font-black has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-ink sm:order-4 sm:w-auto sm:px-3"
        style={FIELD}
        title="排序"
      >
        <AdminIcon name="sort" className="h-4 w-4 shrink-0" />
        <span className="hidden whitespace-nowrap sm:inline">{sortLabel}</span>
        <select
          aria-label="排序"
          value={view.sort}
          onChange={(event) => onChange({ sort: event.target.value as ViewState["sort"] })}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>

      {/* 手机：一个按钮轮换 小→中→大；桌面：三段式。 */}
      <button
        type="button"
        className="order-3 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-black sm:hidden"
        style={FIELD}
        aria-label={`缩略图${SIZE_OPTIONS[sizeIndex].name}，点一下换成${nextSize.name}`}
        onClick={() => onChange({ size: nextSize.id })}
      >
        <AdminIcon name="grid" className="h-4 w-4" />
      </button>
      <div
        role="group"
        aria-label="缩略图大小"
        className="order-5 hidden h-10 shrink-0 items-center gap-0.5 rounded-xl p-1 sm:flex"
        style={{ background: "var(--color-admin-neutral)" }}
      >
        {SIZE_OPTIONS.map((option) => (
          <SizeButton key={option.id} id={option.id} label={option.label} name={option.name} active={view.size === option.id} onPick={(size) => onChange({ size })} />
        ))}
      </div>

      <button
        type="button"
        className="pressable order-4 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-black sm:order-6"
        style={FIELD}
        onClick={onStartSelect}
        aria-label="选择照片"
      >
        <AdminIcon name="check" className="h-4 w-4 shrink-0" />
        选择
      </button>

      <div
        role="group"
        aria-label="按类型筛选"
        className="order-5 flex min-w-0 basis-full gap-1.5 overflow-x-auto [scrollbar-width:none] sm:order-2 sm:flex-1 sm:basis-auto [&::-webkit-scrollbar]:hidden"
      >
        {FILTER_OPTIONS.map((option) => {
          const count = counts[option.id];
          const active = view.type === option.id;
          // 没有坏图就不摆「无缩略图」，省一格；正选着它的时候还得留着。
          if (option.id === "nothumb" && count === 0 && !active) return null;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              aria-label={`${option.label}，${count} 个`}
              disabled={count === 0 && !active && option.id !== "all"}
              onClick={() => onChange({ type: option.id })}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-black transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
              style={
                active
                  ? { background: T.ink, color: "var(--color-card)", border: `1px solid ${T.ink}` }
                  : { background: T.panel, color: T.ink, border: "1px solid var(--color-admin-panel-line)" }
              }
            >
              {option.label}
              <span className="tabular text-[11px] font-bold" style={{ opacity: active ? 0.8 : 0.55 }}>{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SizeButton({
  id,
  label,
  name,
  active,
  onPick,
}: {
  id: SizeId;
  label: string;
  name: string;
  active: boolean;
  onPick: (size: SizeId) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`缩略图${name}`}
      aria-pressed={active}
      title={name}
      onClick={() => onPick(id)}
      className="grid h-8 w-8 place-items-center rounded-lg text-[13px] font-black transition-colors duration-150"
      style={
        active
          ? { background: "var(--color-card)", color: T.ink, boxShadow: "0 1px 2px rgb(from var(--color-contrast-dark) r g b / .06)" }
          : { background: "transparent", color: T.inkSoft }
      }
    >
      {label}
    </button>
  );
}

/*
 * 搜索框自己管输入的字：URL 的更新可能走 transition，受控 input 直接绑 URL 会丢字、跳光标。
 * 外面要清空时换 key 重新挂一个。
 */
function SearchBox({ initial, onChange }: { initial: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(initial);
  const update = (value: string) => {
    setText(value);
    onChange(value);
  };
  return (
    <div className="relative order-1 min-w-0 flex-1 sm:w-60 sm:flex-none">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: T.inkFaint }}>
        <AdminIcon name="search" className="h-4 w-4" />
      </span>
      <input
        type="search"
        value={text}
        maxLength={100}
        placeholder="搜索文件名"
        aria-label="搜索文件名"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => update(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && text) {
            event.preventDefault();
            update("");
          }
        }}
        className="h-10 w-full rounded-xl pl-9 pr-9 text-base font-bold outline-none transition-shadow focus:shadow-[0_0_0_3px_rgb(from_var(--color-accent)_r_g_b_/_.4)] [&::-webkit-search-cancel-button]:hidden sm:text-sm"
        style={FIELD}
      />
      {text && (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => update("")}
          className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg"
          style={{ color: T.inkSoft }}
        >
          <AdminIcon name="close" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function SelectionBar({
  count,
  total,
  busy,
  onToggleAll,
  onDownload,
  onDelete,
  onCancel,
}: {
  count: number;
  /** 当前筛选下能看到的张数：「全选」选的是这些。 */
  total: number;
  busy: boolean;
  onToggleAll: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const all = total > 0 && count === total;
  const small = "!px-2.5 !py-2 sm:!px-3";
  return (
    <div className="flex h-full min-h-10 items-center gap-1.5" role="toolbar" aria-label="已选照片的操作">
      <button
        type="button"
        aria-label="取消选择"
        onClick={onCancel}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl sm:hidden"
        style={{ color: T.ink }}
      >
        <AdminIcon name="close" className="h-5 w-5" />
      </button>
      <span className="tabular whitespace-nowrap text-sm font-black" aria-live="polite">已选 {count} 张</span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Btn variant="quiet" className={small} onClick={onToggleAll}>{all ? "全不选" : "全选"}</Btn>
        <Btn icon="download" className={small} disabled={count === 0 || busy} onClick={onDownload}>下载</Btn>
        <Btn variant="danger" className={small} disabled={count === 0} onClick={onDelete}>删除</Btn>
        <Btn variant="primary" className={`${small} max-sm:hidden`} onClick={onCancel}>取消</Btn>
      </div>
    </div>
  );
}
