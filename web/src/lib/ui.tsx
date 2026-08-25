import { useState, type ReactNode } from "react";

/* Shared UI atoms. Two worlds share one component vocabulary:
   night world (player) uses foil/night variants, tool world uses ink. */

const BTN_VARIANTS = {
  foil: "bg-foil text-ink font-black shadow-[0_3px_0_#e0a800]",
  "night-ghost": "bg-card text-ink font-black shadow-[0_2px_0_#f0e4ce]",
  ink: "bg-ink text-card font-black shadow-[0_3px_0_#0f0d0a]",
  "tool-ghost": "bg-night-raise text-ink font-black",
  danger: "bg-seal text-card font-black shadow-[0_3px_0_#8f2e1f]",
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
      className={`pressable min-h-[52px] w-full rounded-full px-5 py-3.5 text-[15px] disabled:bg-night-raise disabled:text-[#b5a88c] disabled:shadow-none ${look} ${props.className ?? ""}`}
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
    <div role="status" className="rounded-2xl bg-[#e4f5ea] text-leaf-deep px-4 py-3 text-sm font-black flex items-start gap-2.5">
      <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-leaf text-white text-xs">✓</span>
      <span>{text}</span>
    </div>
  );
}

/** 4-digit numeric input, mobile keypad friendly. Tool-world styling. */
export function CodeInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={4}
      autoFocus={props.autoFocus}
      className="w-full rounded-[14px] border-2 border-transparent bg-card px-4 py-3.5 text-center text-3xl font-black tabular tracking-[0.35em] text-ink placeholder:text-[#c9bca1] placeholder:text-xl placeholder:tracking-normal outline-none transition-shadow duration-200 focus:shadow-[0_0_0_3px_#ffc838]"
      placeholder={props.placeholder ?? "4 位码"}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
    />
  );
}

/** Passport MRZ line, e.g. P<LIFE<<ENQI<<<<4562<<< */
export function Mrz({ name, code }: { name: string; code: string }) {
  const ascii = name.replace(/[^A-Za-z]/g, "").toUpperCase() || "TRAVELLER";
  const line = `P<LIFE<<${ascii}<<<<${code}<<<<<<<<<<<<<<<<<<`.slice(0, 34);
  return <div className="mrz select-none" aria-hidden>{line}</div>;
}

/** Four-block brand signature from the Life Passport design language. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <div className={`geometry-mark ${className}`} aria-hidden="true">
      <span /><span /><span /><span />
    </div>
  );
}
