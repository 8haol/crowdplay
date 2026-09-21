import { T } from "./adminTokens";
import type { Phase } from "../lib/types";

export type IconName =
  | "events" | "live" | "players" | "life-events" | "stations" | "settings"
  | "screen" | "plus" | "download" | "close" | "chevron" | "back" | "copy"
  | "logout" | "search" | "menu" | "check";

export function AdminIcon({ name, className = "" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    events: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
    live: <><circle cx="12" cy="12" r="3" /><path d="M6.5 6.5a7.8 7.8 0 0 0 0 11M17.5 6.5a7.8 7.8 0 0 1 0 11M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17" /></>,
    players: <><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 21v-2a6 6 0 0 1 12 0v2M17 8a3 3 0 0 1 0 6M17 16a5 5 0 0 1 4 5" /></>,
    "life-events": <><path d="M12 21s7-3.8 7-10.2A4.8 4.8 0 0 0 10.1 8 4.8 4.8 0 0 0 5 6.2C2.7 6.2 1 8.1 1 10.8 1 17.2 8 21 12 21Z" /><path d="m8.7 12.2 2-2 1.8 1.8 2.8-3" /></>,
    stations: <><path d="M4 19V9M12 19V4M20 19v-7M2 19h20" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14v-4a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1H21v4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
    screen: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    download: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    back: <path d="m15 18-6-6 6-6" />,
    copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>,
    logout: <><path d="M15 12H3M7 8l-4 4 4 4" /><path d="M11 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-8" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    check: <path d="M4.5 12.8l4.6 4.6L19.5 7" />,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export function PhaseLabel({ phase }: { phase: Phase }) {
  const look = {
    waiting: { t: "待开始", bg: T.warnSoft, fg: "var(--color-guide-accent-ink)", live: false },
    playing: { t: "进行中", bg: T.goodSoft, fg: T.good, live: true },
    ended: { t: "已结束", bg: "var(--color-admin-ended)", fg: "var(--color-admin-ended-ink)", live: false },
  }[phase];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-black"
      style={{ background: look.bg, color: look.fg }}
    >
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${look.live ? "animate-pulse" : ""}`} />
      {look.t}
    </span>
  );
}

/** Page heading. Every admin view opens with one so the hierarchy is obvious. */
export function PageTitle({
  eyebrow,
  title,
  description,
  actions,
  onBack,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  onBack?: { label: string; onClick: () => void };
}) {
  return (
    <header className="mb-6">
      {onBack && (
        <button
          type="button"
          onClick={onBack.onClick}
          className="pressable mb-3 inline-flex items-center gap-1.5 text-xs font-black"
          style={{ color: T.inkSoft }}
        >
          <AdminIcon name="back" className="h-3.5 w-3.5" />
          {onBack.label}
        </button>
      )}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[11px] font-black tracking-[0.2em]" style={{ color: T.inkFaint }}>
              {eyebrow}
            </div>
          )}
          <h1 className="mt-1 text-[clamp(1.75rem,3.2vw,2.6rem)] font-black leading-[1.05] tracking-[-0.04em]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Panel({ children, className = "", tone }: { children: React.ReactNode; className?: string; tone?: "danger" }) {
  return (
    <section
      className={`rounded-[18px] ${className}`}
      style={{ background: T.panel, border: `1px solid ${tone === "danger" ? "var(--color-admin-danger-card-line)" : T.line}` }}
    >
      {children}
    </section>
  );
}

export function PanelHead({
  eyebrow,
  title,
  note,
  actions,
}: {
  eyebrow?: string;
  title: string;
  note?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
      style={{ borderBottom: `1px solid ${T.line}` }}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[11px] font-black tracking-[0.16em]" style={{ color: T.inkFaint }}>
            {eyebrow}
          </div>
        )}
        <h2 className="mt-0.5 text-lg font-black">{title}</h2>
        {note && <p className="mt-1 text-xs font-semibold" style={{ color: T.inkSoft }}>{note}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/*
 * 统计卡。左边那条色条是有含义的：只有当这个数字本身处在一个值得注意的状态
 * 时才上色（进行中、有人卡住、名单锁了）。不要为了「第一张卡好看」给它上色，
 * 那样一屋子色条就等于没有色条。
 */
export function Metric({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "neutral" | "accent" | "good" | "danger";
}) {
  const rail = tone === "accent" ? T.accent : tone === "good" ? T.good : tone === "danger" ? T.danger : T.rail;
  return (
    <article className="relative overflow-hidden rounded-[16px] p-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: rail }} />
      <div className="pl-2">
        <div className="text-[11px] font-black tracking-[0.06em]" style={{ color: T.inkSoft }}>{label}</div>
        <div className="tabular mt-2 text-[clamp(1.9rem,3.4vw,2.7rem)] font-black leading-none tracking-[-0.05em]">
          {value}
        </div>
        {note && <div className="mt-2 text-[11px] font-semibold" style={{ color: T.inkFaint }}>{note}</div>}
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- controls */

const BUTTON_LOOK = {
  primary: { background: T.ink, color: "var(--color-card)", border: `1px solid ${T.ink}` },
  ghost: { background: T.panel, color: T.ink, border: `1px solid var(--color-admin-panel-line)` },
  quiet: { background: "transparent", color: T.inkSoft, border: "1px solid transparent" },
  danger: { background: T.panel, color: T.danger, border: `1px solid var(--color-admin-danger-button-line)` },
  dangerSolid: { background: "var(--color-admin-danger-button)", color: "var(--color-card)", border: "1px solid var(--color-admin-danger-button)" },
  /** 墨色侧栏上的按钮：纸色的 quiet 在那上面等于隐形。 */
  onRail: { background: "rgb(from var(--color-card) r g b / .08)", color: "var(--color-card)", border: "1px solid rgb(from var(--color-card) r g b / .18)" },
} as const;

export function Btn({
  children,
  onClick,
  href,
  variant = "ghost",
  icon,
  disabled,
  className = "",
  type = "button",
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  /** 外链按钮走同一个定义，否则它们迟早和 Btn 的尺寸走散。 */
  href?: string;
  variant?: keyof typeof BUTTON_LOOK;
  icon?: IconName;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const look = `pressable inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black disabled:cursor-not-allowed disabled:opacity-35 ${className}`;
  const body = (
    <>
      {icon && <AdminIcon name={icon} className="h-4 w-4 shrink-0" />}
      {children}
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={look} style={BUTTON_LOOK[variant]}>
        {body}
      </a>
    );
  }
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={look} style={BUTTON_LOOK[variant]}>
      {body}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-black">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11px] font-semibold" style={{ color: T.inkFaint }}>{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  note,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  note?: string;
  /** 关掉但仍然显示——藏起来会让人以为功能没了，而不是此刻不适用。 */
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-xl p-4 ${disabled ? "opacity-60" : ""}`}
      style={{ background: T.panelAlt, border: `1px solid ${T.lineSoft}` }}
    >
      <div className="min-w-0">
        <div className="text-sm font-black">{label}</div>
        {note && <div className="mt-0.5 text-xs font-semibold" style={{ color: T.inkSoft }}>{note}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className="relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed"
        style={{ background: checked ? "var(--color-admin-toggle-on)" : "var(--color-admin-toggle-off)" }}
      >
        <span
          className="absolute left-1 top-1 h-6 w-6 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(1.5rem)" : "translateX(0)" }}
        />
      </button>
    </div>
  );
}

/** Segmented control used for in-page tabs. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string; badge?: number }>;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl p-1" style={{ background: "var(--color-admin-neutral)" }}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-black transition-colors"
          style={
            value === option.id
              ? { background: "var(--color-card)", color: T.ink, boxShadow: "0 1px 2px rgb(from var(--color-contrast-dark) r g b / .06)" }
              : { background: "transparent", color: T.inkSoft }
          }
        >
          {option.label}
          {option.badge !== undefined && option.badge > 0 && (
            <span className="tabular rounded-full px-1.5 text-[10px]" style={{ background: T.accentSoft, color: T.warn }}>
              {option.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <div className="text-lg font-black">{title}</div>
      {detail && <p className="mx-auto mt-1.5 max-w-sm text-sm font-semibold" style={{ color: T.inkSoft }}>{detail}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- overlays */

export function Modal({ children, onClose, width = "max-w-xl" }: { children: React.ReactNode; onClose: () => void; width?: string }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-admin-overlay/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={onClose}
    >
      <div
        className={`toast-in tool-scroll max-h-[92dvh] w-full ${width} overflow-y-auto rounded-t-[24px] p-6 shadow-[0_24px_80px_rgb(from_var(--color-admin-shadow)_r_g_b_/_.32)] sm:rounded-[24px]`}
        style={{ background: "var(--color-admin-table-footer)" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 bg-admin-overlay/45 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside
        className="toast-in tool-scroll absolute inset-y-0 right-0 w-full max-w-3xl overflow-y-auto shadow-[-20px_0_70px_rgb(from_var(--color-admin-shadow)_r_g_b_/_.18)]"
        style={{ background: "var(--color-admin-table-footer)" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </aside>
    </div>
  );
}

export function DialogHead({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0">
        <div className="text-[11px] font-black tracking-[0.18em]" style={{ color: T.inkFaint }}>{eyebrow}</div>
        <h2 className="mt-1 text-2xl font-black tracking-[-0.03em]">{title}</h2>
      </div>
      <button type="button" className="shrink-0 rounded-lg p-2 hover:bg-admin-neutral" style={{ color: T.inkSoft }} onClick={onClose} aria-label="关闭">
        <AdminIcon name="close" className="h-5 w-5" />
      </button>
    </div>
  );
}
