export type AdminSection =
  | "events"
  | "live"
  | "players"
  | "life-events"
  | "stations"
  | "settings";

import type { IconName } from "./adminUi";

export const ADMIN_NAV: Array<{
  id: AdminSection;
  label: string;
  short: string;
  icon: IconName;
  note: string;
  group: "运营" | "数据" | "配置";
}> = [
  { id: "events", label: "全部活动", short: "活动", icon: "events", note: "创建、归档、进入任意一场", group: "运营" },
  { id: "live", label: "现场总控", short: "总控", icon: "live", note: "开局、结束、入场二维码", group: "运营" },
  { id: "players", label: "玩家护照", short: "玩家", icon: "players", note: "搜索、修正、导出", group: "数据" },
  { id: "stations", label: "站点运营", short: "站点", icon: "stations", note: "完成率与计分设置", group: "数据" },
  { id: "life-events", label: "人生事件库", short: "事件库", icon: "life-events", note: "30 个场景与隐藏结果", group: "数据" },
  { id: "settings", label: "系统设置", short: "设置", icon: "settings", note: "名称、登记开关、密码", group: "配置" },
];

export const NAV_GROUPS: Array<AdminSection[]> = [
  ["events", "live"],
  ["players", "stations", "life-events"],
  ["settings"],
];

export function formatDate(value: string | null | undefined, includeTime = false): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(
    "zh-CN",
    includeTime
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "short", day: "numeric" },
  ).format(new Date(value));
}

/** "8 月 27 日 19:04 · 已进行 42 分钟" style helper for the live console. */
export function elapsedLabel(startedAt: string | null): string | null {
  if (!startedAt) return null;
  const minutes = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000));
  if (minutes < 60) return `已进行 ${minutes} 分钟`;
  return `已进行 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export function downloadCsv(
  filename: string,
  rows: Array<Record<string, string | number | boolean | null | undefined>>,
) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = `﻿${headers.map(quote).join(",")}\n${rows
    .map((row) => headers.map((header) => quote(row[header])).join(","))
    .join("\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
