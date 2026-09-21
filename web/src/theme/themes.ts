import type { FC } from "react";
import { MIDAUTUMN_COPY, PASSPORT_COPY, type Copy } from "./copy";
import { MIDAUTUMN_STAMPS } from "./StampIcons";

export type ThemeId = "passport" | "midautumn";

export interface Theme {
  id: ThemeId;
  copy: Copy;
  documentTitle: string;
  stampIcons: FC<{ className?: string }>[];
  /** 摊位别名，按本场主摊位顺序套用；空数组 = 用站点库里的原名。 */
  boothNames: string[];
}

export const THEMES: Record<ThemeId, Theme> = {
  passport: {
    id: "passport",
    copy: PASSPORT_COPY,
    documentTitle: "人生护照 Life Passport",
    stampIcons: [],
    boothNames: [],
  },
  midautumn: {
    id: "midautumn",
    copy: MIDAUTUMN_COPY,
    documentTitle: "中秋游园会 · 集章卡",
    stampIcons: MIDAUTUMN_STAMPS,
    boothNames: ["月下音乐会", "异乡百事通", "月下即兴剧场", "今夜留影", "月下寻踪", "月宫连连看", "静默拼月"],
  },
};

export function resolveTheme(raw: unknown): Theme {
  return raw === "passport" || raw === "midautumn" ? THEMES[raw] : THEMES.passport;
}

/** 第 index 个主摊位在这个主题下叫什么；没有别名表就用原名。 */
export function boothName(theme: Theme, index: number, fallback: string): string {
  if (!theme.boothNames.length || index < 0) return fallback;
  return theme.boothNames[index % theme.boothNames.length];
}

/**
 * 某个站点在本场可见主摊位里的序号（按 sort_order），不是主摊位或隐藏摊位返回 -1。
 * 站点对象可能用 `station_id`（快照）或 `id`（库）标识，两种都认。
 */
export function mainStationIndex(
  stations: ReadonlyArray<{ id?: number; station_id?: number; type: string; sort_order: number; hidden?: boolean | null }>,
  id: number,
): number {
  const mains = stations
    .filter((s) => s.type === "main" && !s.hidden)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
  return mains.findIndex((s) => (s.station_id ?? s.id) === id);
}
