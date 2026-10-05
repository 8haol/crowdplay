import { useState } from "react";
import type { AdminConsoleData, AdminDashboardData } from "../../lib/types";
import { AdminIcon, Btn, EmptyState, Metric, Panel, PanelHead, PageTitle, PhaseLabel } from "../adminUi";
import { T } from "../adminTokens";
import { downloadCsv, formatDate } from "../adminUtils";

/*
 * Landing page of the console: every session this installation has ever run,
 * live one first. Clicking a row opens that event's own workspace, which is
 * where all per-event work now happens — the old build buried archives behind a
 * tab and a slide-over, so "which event am I looking at" was never on screen.
 */

type Row = {
  event_id: string;
  title: string;
  phase: AdminConsoleData["current"]["phase"];
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  player_count: number;
  stamps: number;
  top_score: number;
  life_events: number;
  tokens_used: number;
  is_current: boolean;
};

type Filter = "all" | "live" | "archived";

/** 删除弹窗需要的那几样，独立成型：调用方不必背上整个 Row。 */
export interface DeletableEvent {
  event_id: string;
  title: string;
  phase: string;
  player_count: number;
}

export function EventsListView({
  events,
  onOpenEvent,
  onNewGame,
  onDelete,
}: {
  events: AdminDashboardData["events"];
  onOpenEvent: (eventId: string) => void;
  onNewGame: () => void;
  /** 不传＝不显示删除（演示模式）。 */
  onDelete?: (row: DeletableEvent) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  /* Every event the organisation has run, straight from the server, newest
     first. "Current" means still open (waiting or playing); an ended event is
     history but keeps all its data and opens like any other. */
  const rows: Row[] = events.map((event) => ({
    event_id: event.event_id,
    title: event.title,
    phase: event.phase,
    created_at: event.created_at,
    started_at: event.started_at,
    ended_at: event.ended_at,
    player_count: event.player_count,
    stamps: event.stamps,
    top_score: event.top_score,
    life_events: event.life_events,
    tokens_used: event.tokens_used,
    is_current: event.phase !== "ended",
  }));

  const shown = rows.filter((row) =>
    filter === "all" ? true : filter === "live" ? row.is_current : !row.is_current,
  );
  const totalPlayers = rows.reduce((sum, row) => sum + row.player_count, 0);
  const totalStamps = rows.reduce((sum, row) => sum + row.stamps, 0);
  const liveCount = rows.filter((row) => row.phase === "playing").length;

  return (
    <div>
      <PageTitle
        eyebrow="ALL EVENTS"
        title="全部活动"
        description="每一场活动都有独立的入场二维码、玩家名单和运营数据。点任意一行进入那一场的管理页面。"
        actions={
          <>
            <Btn
              icon="download"
              onClick={() =>
                downloadCsv(
                  "Crowdplay-全部活动.csv",
                  rows.map((row) => ({
                    活动: row.title,
                    状态: row.is_current ? "进行中 / 等待中" : "已结束",
                    阶段: row.phase,
                    创建: formatDate(row.created_at),
                    开始: formatDate(row.started_at, true),
                    结束: formatDate(row.ended_at, true),
                    玩家: row.player_count,
                    盖章: row.stamps,
                    人生事件: row.life_events,
                    最高分: row.top_score,
                  })),
                )
              }
            >
              导出清单
            </Btn>
            <Btn variant="primary" icon="plus" onClick={onNewGame}>创建新场次</Btn>
          </>
        }
      />

      {/* 四个数字都是机构级的——这一层不知道、也不该知道"当前那一场"有多少人。
          以前这里有「当前场次玩家」「手机待选事件」两张卡，它们读的是某个隐式
          选中场次的 admin_console，正是这次重构要消掉的那种混淆。 */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="活动总数" value={rows.length} note={`${rows.filter((row) => !row.is_current).length} 场已结束`} />
        <Metric label="累计到场" value={totalPlayers} note="全部场次相加" />
        <Metric
          label="进行中"
          value={liveCount}
          note={liveCount > 0 ? "点进去用现场总控" : "同时只能跑一场"}
          tone={liveCount > 0 ? "good" : "neutral"}
        />
        <Metric label="累计盖章" value={totalStamps} note="一支队伍一站算一次" />
      </div>

      <Panel className="overflow-hidden">
        <PanelHead
          eyebrow="EVENT LIST"
          title="活动列表"
          note="当前场次固定排在最上面"
          actions={
            <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--color-admin-neutral)" }}>
              {([["all", "全部"], ["live", "当前"], ["archived", "已结束"]] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className="rounded-md px-3 py-1.5 text-xs font-black"
                  style={filter === id ? { background: "var(--color-card)", color: T.ink } : { color: T.inkSoft }}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        />

        {shown.length === 0 ? (
          <EmptyState title="没有匹配的活动" detail="换一个筛选条件试试。" />
        ) : (
          <div className="tool-scroll overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr
                  className="text-[11px] font-black tracking-[0.08em]"
                  style={{ background: T.panelAlt, color: T.inkFaint, borderBottom: `1px solid ${T.line}` }}
                >
                  <th className="px-5 py-3">活动</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">时间</th>
                  <th className="px-4 py-3 text-right">玩家</th>
                  <th className="px-4 py-3 text-right">盖章</th>
                  <th className="px-4 py-3 text-right">人生事件</th>
                  <th className="px-4 py-3 text-right">最高分</th>
                  <th className="w-32 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr
                    key={row.event_id}
                    className="cursor-pointer hover:bg-admin-row-hover"
                    style={{ borderBottom: `1px solid ${T.lineSoft}` }}
                    onClick={() => onOpenEvent(row.event_id)}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-black">{row.title}</span>
                        {row.is_current && (
                          <span className="rounded-md px-1.5 py-0.5 text-[10px] font-black" style={{ background: T.accentSoft, color: T.warn }}>
                            当前
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px]" style={{ color: T.inkFaint }}>
                        {row.event_id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-4 py-4"><PhaseLabel phase={row.phase} /></td>
                    <td className="px-4 py-4 text-xs font-semibold" style={{ color: T.inkSoft }}>
                      <div>{formatDate(row.created_at)}</div>
                      <div className="mt-0.5" style={{ color: T.inkFaint }}>
                        {row.ended_at ? `结束 ${formatDate(row.ended_at, true)}` : row.started_at ? `开始 ${formatDate(row.started_at, true)}` : "尚未开始"}
                      </div>
                    </td>
                    <td className="tabular px-4 py-4 text-right font-black">{row.player_count}</td>
                    <td className="tabular px-4 py-4 text-right font-bold">{row.stamps}</td>
                    <td className="tabular px-4 py-4 text-right font-bold">{row.life_events}</td>
                    <td className="tabular px-4 py-4 text-right text-lg font-black">{row.top_score}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-3">
                        {onDelete && (
                          <button
                            type="button"
                            disabled={row.phase === "playing"}
                            title={row.phase === "playing" ? "进行中的活动不能删除，请先在现场总控结束它" : undefined}
                            className="pressable text-xs font-black disabled:cursor-not-allowed disabled:opacity-40"
                            style={{ color: T.danger }}
                            /* 整行是可点的（点进那一场），所以这里必须拦住冒泡，
                               否则点「删除」会同时把人导航走。 */
                            onClick={(event) => { event.stopPropagation(); onDelete(row); }}
                          >
                            删除
                          </button>
                        )}
                        <span className="inline-flex items-center gap-1 text-xs font-black" style={{ color: T.inkSoft }}>
                          进入
                          <AdminIcon name="chevron" className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
