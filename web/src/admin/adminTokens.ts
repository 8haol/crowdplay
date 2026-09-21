import type { CSSProperties } from "react";

/* Admin design tokens. The operator console is a paper-desk world: warm
   neutrals, one ink, one accent, hairline borders — deliberately quieter than
   the player and projector pages so long sessions of data work stay readable. */
export const T = {
  bg: "var(--color-admin-bg)",
  panel: "var(--color-card)",
  panelAlt: "var(--color-admin-panel-alt)",
  line: "var(--color-admin-line)",
  lineSoft: "var(--color-admin-line-soft)",
  ink: "var(--color-ink)",
  inkSoft: "var(--color-admin-ink-soft)",
  inkFaint: "var(--color-admin-ink-faint)",
  accent: "var(--color-admin-accent)",
  accentSoft: "var(--color-admin-accent-soft)",
  good: "var(--color-admin-good)",
  goodSoft: "var(--color-admin-good-soft)",
  warn: "var(--color-admin-warn)",
  warnSoft: "var(--color-admin-warn-soft)",
  danger: "var(--color-admin-danger)",
  dangerSoft: "var(--color-admin-danger-soft)",
  rail: "var(--color-admin-rail)",
} as const;

export const inputClass =
  "mt-2 w-full rounded-xl bg-white px-4 py-3 text-sm font-bold outline-none transition-shadow focus:shadow-[0_0_0_3px_rgb(from_var(--color-accent)_r_g_b_/_.4)]";
export const inputStyle = { border: `1px solid var(--color-admin-input-line)`, color: T.ink } as CSSProperties;

