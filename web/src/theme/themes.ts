import type { FC } from "react";
import { MIDAUTUMN_COPY, PASSPORT_COPY, type Copy } from "./copy";
import { MIDAUTUMN_STAMPS } from "./StampIcons";

export type ThemeId = "passport" | "midautumn";

export interface Theme {
  id: ThemeId;
  copy: Copy;
  documentTitle: string;
  stampIcons: FC<{ className?: string }>[];
}

export const THEMES: Record<ThemeId, Theme> = {
  passport: {
    id: "passport",
    copy: PASSPORT_COPY,
    documentTitle: "人生护照 Life Passport",
    stampIcons: [],
  },
  midautumn: {
    id: "midautumn",
    copy: MIDAUTUMN_COPY,
    documentTitle: "中秋游园会 · 集章卡",
    stampIcons: MIDAUTUMN_STAMPS,
  },
};

export function resolveTheme(raw: unknown): Theme {
  return raw === "passport" || raw === "midautumn" ? THEMES[raw] : THEMES.passport;
}
