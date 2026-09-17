/*
 * 后台是两层的，导航也就是两套。
 *
 * 分界线不是拍脑袋定的，是 RPC 的签名：只要口令的（admin_dashboard、
 * admin_station_library、admin_life_event_catalog）属于机构，要 event_id 的
 * （admin_console、admin_event_stations、admin_list_players…）属于某一场。
 * 往任何一套里加东西之前，先看它对应的 RPC 要不要 event_id。
 */
export type OrgSection = "events" | "library" | "life-events" | "org-settings";
export type EventSection = "overview" | "live" | "players" | "stations" | "settings";

import type { IconName } from "./adminUi";
import type { ScoringMode, StationType } from "../lib/types";

export const TYPE_ZH: Record<StationType, string> = {
  main: "主线挑战",
  life_event: "人生盲盒",
  grace: "恩典站",
};

/** One line that says how a station is run, in the operator's own words. */
export function stationRule(type: StationType, mode: ScoringMode): string {
  if (type === "life_event") return "玩家手机自动完成 · 无需值守";
  if (type === "grace") return "Grace Token 求助与纪念卡兑换";
  if (mode === "free") return "0–10 自由计分";
  if (mode === "fixed") return "固定 6 分";
  return "3 / 6 / 9 分级计分";
}

/*
 * The activity feed's labels are built inside the SQL functions, where the
 * token is still called by its old name. Renaming it there would mean a
 * migration for one string, so the console translates on the way out — the
 * single place a server-written label is read by a human.
 */
export function feedLabel(label: string): string {
  return label === "Help Token" ? "Grace Token" : label;
}

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: IconName;
  note: string;
}

/** 机构层：跨场次的东西。进后台默认落在这一层。 */
export const ORG_NAV: Array<NavItem<OrgSection>> = [
  { id: "events", label: "全部活动", icon: "events", note: "创建、查看、进入任意一场" },
  { id: "library", label: "站点库", icon: "stations", note: "跨场次复用的站点模板" },
  { id: "life-events", label: "人生事件库", icon: "life-events", note: "30 个场景与隐藏结果" },
  { id: "org-settings", label: "机构设置", icon: "settings", note: "管理密码" },
];

/** 活动层：只属于某一场。进入活动默认落在「本场概览」。 */
export const EVENT_NAV: Array<NavItem<EventSection>> = [
  { id: "overview", label: "本场概览", icon: "events", note: "成绩、修正记录、时间线" },
  { id: "live", label: "现场总控", icon: "live", note: "开局、结束、入场二维码" },
  { id: "players", label: "玩家护照", icon: "players", note: "搜索、修正、导出" },
  { id: "stations", label: "本场站点", icon: "stations", note: "本场启用哪些站" },
  { id: "settings", label: "本场设置", icon: "settings", note: "名称、登记开关、工作人员码" },
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
