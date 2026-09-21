import { useCopy } from "../theme/ThemeProvider";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

/* Shared UI atoms. Two worlds share one component vocabulary:
   night world (player) uses foil/night variants, tool world uses ink. */

const BTN_VARIANTS = {
  foil: "bg-accent text-accent-ink font-black shadow-[0_3px_0_var(--color-accent-shadow)]",
  "night-ghost": "bg-card text-ink font-black shadow-[0_2px_0_var(--color-shadow-line)]",
  ink: "bg-ink text-card font-black shadow-[0_3px_0_var(--color-ink-shadow)]",
  "tool-ghost": "bg-night-raise text-ink font-black",
  danger: "bg-seal text-card font-black shadow-[0_3px_0_var(--color-seal-shadow)]",
} as const;

export type BtnVariant = keyof typeof BTN_VARIANTS;

/** Big touch-target button with a built-in loading lock (anti double-tap). */
export function ActionButton(props: {
  onClick: () => Promise<void> | void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  variant?: BtnVariant;
}) {
  const [busy, setBusy] = useState(false);
  const look = BTN_VARIANTS[props.variant ?? "ink"];
  return (
    <button
      className={`pressable min-h-[52px] w-full rounded-full px-5 py-3.5 text-[15px] disabled:bg-night-raise disabled:text-ink-disabled disabled:shadow-none ${look} ${props.className ?? ""}`}
      disabled={props.disabled || busy}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await props.onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span className="h-4 w-4 rounded-full border-[2.5px] border-current border-t-transparent animate-spin" />
          提交中…
        </span>
      ) : props.children}
    </button>
  );
}

/** Green/red connectivity dot fed by the polling loop. */
export function ConnDot({ online }: { online: boolean }) {
  return (
    <span
      title={online ? "连接正常" : "连接中断，正在重试"}
      className={`inline-block h-2 w-2 rounded-full ring-2 ring-current/10 ${
        online ? "bg-leaf" : "bg-seal pulse-soft"
      }`}
    />
  );
}

export function ErrorBanner({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="alert" className="rounded-2xl bg-seal text-white px-4 py-3 text-sm font-black flex items-start gap-2.5">
      <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-seal text-xs">!</span>
      <span>{text}</span>
    </div>
  );
}

export function SuccessBanner({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="status" className="rounded-2xl bg-pass-soft text-leaf-deep px-4 py-3 text-sm font-black flex items-start gap-2.5">
      <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-leaf text-white text-xs">✓</span>
      <span>{text}</span>
    </div>
  );
}

/** 3-digit numeric passport input, mobile keypad friendly. */
export function CodeInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const copy = useCopy();
  return (
    <input
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={3}
      autoFocus={props.autoFocus}
      className="w-full rounded-[14px] border-2 border-transparent bg-card px-4 py-3.5 text-center text-3xl font-black tabular tracking-[0.35em] text-ink placeholder:text-ink-placeholder placeholder:text-xl placeholder:tracking-normal outline-none transition-shadow duration-200 focus:shadow-[0_0_0_3px_var(--color-accent)]"
      placeholder={props.placeholder ?? copy.lifeNo}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value.replace(/\D/g, "").slice(0, 3))}
    />
  );
}

/** Passport MRZ line, e.g. P<LIFE<<ENQI<<<<4562<<< */
export function Mrz({ name, code }: { name: string; code: string }) {
  const ascii = name.replace(/[^A-Za-z]/g, "").toUpperCase() || "TRAVELLER";
  const line = `P<LIFE<<${ascii}<<<<${code}<<<<<<<<<<<<<<<<<<`.slice(0, 34);
  return <div className="mrz select-none" aria-hidden>{line}</div>;
}

/** Four-block brand signature from the card design language. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <div className={`geometry-mark ${className}`} aria-hidden="true">
      <span /><span /><span /><span />
    </div>
  );
}

/**
 * "Go up one level".
 *
 * Three things this has to be at once, learned in that order:
 *
 * 1. NOT A PRIMARY BUTTON. A filled pill with a hard drop shadow means "the
 *    thing this page wants you to do", so styling the back control that way put
 *    a bright ball in every corner. It gets a soft neutral wash instead.
 * 2. BIG ENOUGH TO HIT. The first quiet version went too far the other way:
 *    12px text with 6px of padding is a 28px target that a thumb misses. Every
 *    instance is now at least 44px tall with 14px text.
 * 3. HONEST ABOUT WHERE IT GOES. Up one level, labelled with the destination —
 *    the station list from a station, the guide from the event library.
 *
 * `variant="icon"` is for the projector header only, where the click comes from
 * a mouse and every extra mark shows up on a wall.
 */
export function UpLink({
  label,
  to,
  onClick,
  variant = "text",
  className = "",
}: {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: "text" | "icon";
  className?: string;
}) {
  const shared =
    variant === "icon"
      ? `grid h-9 w-9 shrink-0 place-items-center rounded-full bg-current/8 text-[15px] leading-none text-current/60 transition-colors hover:bg-current/15 hover:text-current ${className}`
      : `inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-current/8 px-3.5 text-[14px] font-black text-current/75 transition-colors hover:bg-current/15 hover:text-current ${className}`;
  const body =
    variant === "icon" ? (
      <span aria-hidden="true">←</span>
    ) : (
      <>
        <span aria-hidden="true" className="text-[16px] leading-none">←</span>
        <span className="truncate">{label}</span>
      </>
    );
  const title = `返回${label}`;

  if (to) {
    return (
      <Link to={to} className={shared} aria-label={title} title={title}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={shared} aria-label={title} title={title}>
      {body}
    </button>
  );
}

/** Hairline separator for a row of chrome (back link · page name · actions). */
export function ChromeDivider() {
  return <span aria-hidden="true" className="h-3 w-px shrink-0 bg-current/15" />;
}
