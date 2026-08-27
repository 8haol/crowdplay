export type AdminTab = "overview" | "events" | "players" | "life-events" | "stations" | "settings";

export const ADMIN_NAV: Array<{ id: AdminTab; label: string; short: string }> = [
  { id: "overview", label: "活动总览", short: "总览" },
  { id: "events", label: "场次管理", short: "场次" },
  { id: "players", label: "玩家数据", short: "玩家" },
  { id: "life-events", label: "人生事件库", short: "事件库" },
  { id: "stations", label: "站点运营", short: "站点" },
  { id: "settings", label: "系统设置", short: "设置" },
];

export function formatDate(value: string | null | undefined, includeTime = false): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", includeTime ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

export function downloadCsv(filename: string, rows: Array<Record<string, string | number | boolean | null | undefined>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = `\uFEFF${headers.map(quote).join(",")}\n${rows.map((row) => headers.map((header) => quote(row[header])).join(",")).join("\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
