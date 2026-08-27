import type { CSSProperties } from "react";

/* Admin design tokens. The operator console is a paper-desk world: warm
   neutrals, one ink, one accent, hairline borders — deliberately quieter than
   the player and projector pages so long sessions of data work stay readable. */
export const T = {
  bg: "#f7f3ec",
  panel: "#ffffff",
  panelAlt: "#fbf8f2",
  line: "#e4dac8",
  lineSoft: "#eee7dc",
  ink: "#26211b",
  inkSoft: "#6f6558",
  inkFaint: "#918675",
  accent: "#d6a313",
  accentSoft: "#fff7d8",
  good: "#1f7543",
  goodSoft: "#e2f5e9",
  warn: "#8a5a00",
  warnSoft: "#fff0bf",
  danger: "#a63727",
  dangerSoft: "#fff3ef",
  rail: "#241f19",
} as const;

export const inputClass =
  "mt-2 w-full rounded-xl bg-white px-4 py-3 text-sm font-bold outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(255,200,56,.4)]";
export const inputStyle = { border: `1px solid #ddd2bf`, color: T.ink } as CSSProperties;

