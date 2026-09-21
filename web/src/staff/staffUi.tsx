import { useCopy } from "../theme/ThemeProvider";
import type { ReactNode } from "react";
import type { PlayerState } from "../lib/types";
import { colorOf, soloColor } from "../lib/types";

/*
 * Station-side UI kit. These screens are used one-handed, standing up, in a
 * noisy hall, on somebody's own phone — so everything here is big, high
 * contrast, and single-purpose. The primary action always sits in a sticky bar
 * at the bottom, within thumb reach, instead of somewhere down the page.
 */

export function StaffCard({
  children,
  tone = "plain",
  className = "",
}: {
  children: ReactNode;
  tone?: "plain" | "accent" | "danger" | "good";
  className?: string;
}) {
  const look = {
    plain: { background: "var(--color-card)", border: "1px solid var(--color-line)" },
    accent: { background: "var(--color-staff-accent-soft)", border: "1px solid var(--color-staff-accent-line)" },
    danger: { background: "var(--color-admin-danger-soft)", border: "1px solid var(--color-staff-danger-line)" },
    good: { background: "var(--color-staff-good-soft)", border: "1px solid var(--color-staff-good-line)" },
  }[tone];
  return (
    <section className={`rounded-[22px] p-5 ${className}`} style={look}>
      {children}
    </section>
  );
}

/** Three-beat progress rail so staff always know which step they are on. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-1.5">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black"
              style={
                active
                  ? { background: "var(--color-ink)", color: "var(--color-card)" }
                  : done
                    ? { background: "var(--color-accent)", color: "var(--color-ink)" }
                    : { background: "var(--color-staff-step-idle)", color: "var(--color-staff-step-idle-ink)" }
              }
            >
              {done ? "✓" : index + 1}
            </span>
            <span
              className="truncate text-[11px] font-black"
              style={{ color: active ? "var(--color-ink)" : done ? "var(--color-accent-deep)" : "var(--color-staff-step-idle-ink)" }}
            >
              {step}
            </span>
            {index < steps.length - 1 && (
              <span className="h-0.5 min-w-2 flex-1 rounded-full" style={{ background: done ? "var(--color-accent)" : "var(--color-line)" }} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * On-screen pad for the 3-digit passport code. The OS keyboard fights this
 * input badly: it hides half the screen and, on some Android keyboards, offers
 * autocorrect on a numeric field. A fixed pad is faster and never covers the
 * number being typed.
 *
 * There is only one kind of code now — the old short team code is gone, so the
 * pad no longer needs letter keys and a mode switch.
 */
export function CodePad({
  value,
  onChange,
  hint,
  maxLength = 3,
}: {
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  maxLength?: number;
}) {
  const push = (char: string) => {
    if (value.length >= maxLength) return;
    onChange(value + char);
  };

  return (
    <div>
      <div
        className="tabular flex min-h-[5.5rem] items-center justify-center rounded-[20px] px-4 text-[3.25rem] font-black leading-none tracking-[0.16em]"
        style={{ background: "var(--color-card)", border: "2px solid var(--color-line)", color: value ? "var(--color-ink)" : "var(--color-ink-placeholder)" }}
        aria-live="polite"
      >
        {value || "———"}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
          <PadKey key={key} label={key} onClick={() => push(key)} />
        ))}
        <PadKey label="清空" small onClick={() => onChange("")} />
        <PadKey label="0" onClick={() => push("0")} />
        <PadKey label="⌫" onClick={() => onChange(value.slice(0, -1))} />
      </div>
      {hint && <p className="mt-2.5 text-center text-[11px] font-semibold leading-5 text-ink-dim">{hint}</p>}
    </div>
  );
}

function PadKey({ label, onClick, small }: { label: string; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pressable rounded-[16px] py-4 font-black ${small ? "text-sm" : "tabular text-2xl"}`}
      style={{ background: "var(--color-card)", border: "1px solid var(--color-line)", color: "var(--color-ink)" }}
    >
      {label}
    </button>
  );
}

/** Bottom-anchored action area. Content above it gets padding to compensate. */
export function StickyBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      style={{
        background: "linear-gradient(to top, var(--color-night) 62%, rgb(from var(--color-night) r g b / 0))",
      }}
    >
      <div className="mx-auto flex max-w-md flex-col gap-2">{children}</div>
    </div>
  );
}

/** One roster row: who is in this team and where each of them stands. */
export function MemberRow({ member, stationsTotal }: { member: PlayerState; stationsTotal: number }) {
  const copy = useCopy();
  const color = colorOf(member.color_group, copy) ?? (member.identity === "solo" ? soloColor(member.code, copy) : null);
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-black text-white"
        style={{ background: color?.hex ?? "var(--color-ink-dim)" }}
      >
        {member.name.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-black">{member.name}</div>
        <div className="tabular text-[11px] font-semibold text-ink-dim">
          {member.code} · {member.stations_done}/{member.stations_total ?? stationsTotal} {copy.stationUnit} ·{" "}
          {member.life_events_done}/{member.life_events_total} {copy.stageShort}
          {member.locked_for_life_event && <span className="font-black text-seal"> · 手机待选</span>}
          {!member.token_available && <span> · 无 {copy.tokenShort}</span>}
        </div>
      </div>
      <span className="tabular shrink-0 text-xl font-black">{member.score}</span>
    </div>
  );
}

export function Kv({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" | "good" }) {
  return (
    <div>
      <div className="text-[10px] font-black tracking-[0.16em] text-ink-dim">{label}</div>
      <div
        className="tabular mt-0.5 text-xl font-black"
        style={{ color: tone === "danger" ? "var(--color-fail)" : tone === "good" ? "var(--color-leaf-deep)" : undefined }}
      >
        {value}
      </div>
    </div>
  );
}
