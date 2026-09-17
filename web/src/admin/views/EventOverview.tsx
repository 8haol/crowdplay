import { useMemo } from "react";
import { rpc, errorText } from "../../lib/api";
import { usePoll } from "../../lib/usePoll";
import type { AdminEventDetail } from "../../lib/types";
import { colorOf, soloColor, teamLabel } from "../../lib/types";
import { Btn, EmptyState, Metric, Panel, PanelHead, PageTitle, PhaseLabel } from "../adminUi";
import { T } from "../adminTokens";
import { downloadCsv, feedLabel, formatDate } from "../adminUtils";

/*
 * 活动层的第一页：这一场的战绩、人工修正记录和完整时间线。
 *
 * 它的前身 EventWorkspace 有四个只读标签（概览 / 玩家 / 站点 / 时间线），其中
 * 玩家和站点两个和左侧栏的「玩家护照」「本场站点」逐字重复——用户说的
 * 「详情页和现场总控非常重复且 confusing」就是这么来的。这里只留概览和时间线，
 * 玩家和站点各归各页。不要把它们加回来。
 *
 * 也不再自称「该场活动的完整档案」：它现在只是活动层的一页，档案是整个活动层。
 */
export function EventOverview({
  adminKey,
  eventId,
  preview,
}: {
  adminKey: string;
  eventId: string;
  preview?: boolean;
}) {
  const pollFn = useMemo(
    () => () => rpc<AdminEventDetail>("admin_event_detail", { p_admin_key: adminKey, p_event_id: eventId }),
    [adminKey, eventId],
  );
  const { data, error, refresh } = usePoll<AdminEventDetail>(preview ? null : pollFn, 20_000);

  if (!data) {
    return (
      <div>
        <PageTitle eyebrow="EVENT" title="正在读取场次" />
        <Panel>
          {error ? (
            <EmptyState
              title="无法读取这场活动"
              detail={errorText(error)}
              action={<Btn variant="primary" onClick={refresh}>重试</Btn>}
            />
          ) : (
            <div className="grid place-items-center px-6 py-20">
              <div className="dots text-xl font-black">正在读取场次<span>.</span><span>.</span><span>.</span></div>
            </div>
          )}
        </Panel>
      </div>
    );
  }

  const active = data.players.filter((player) => !player.is_removed);
  const stationsTotal = active[0]?.stations_total ?? 7;
  const finished = active.filter((player) => player.stations_done >= (player.stations_total ?? stationsTotal)).length;
  const lifeEvents = active.reduce((sum, player) => sum + (player.life_events_done ?? 0), 0);
  const top = [...active].sort((a, b) => b.score - a.score).slice(0, 8);

  return (
    <div>
      <PageTitle
        eyebrow={data.is_current ? "CURRENT EVENT · 当前场次" : "ENDED EVENT · 已结束场次"}
        title={data.session.title}
        description={`创建于 ${formatDate(data.session.created_at)}${
          data.session.ended_at ? ` · 结束于 ${formatDate(data.session.ended_at, true)}` : ""
        }`}
        actions={
          <>
            <PhaseLabel phase={data.session.phase} />
            <Btn
              icon="download"
              onClick={() =>
                downloadCsv(
                  `${data.session.title}-玩家.csv`,
                  data.players.map((player) => ({
                    姓名: player.name,
                    人生编号: player.code,
                    同行: player.teammates.join(" / "),
                    身份: player.identity,
                    总分: player.score,
                    完成站点: player.stations_done,
                    已历人生: player.life_events_done,
                    Token可用: player.token_available,
                    已删除: player.is_removed,
                  })),
                )
              }
            >
              导出玩家
            </Btn>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="玩家" value={active.length} note={`${data.players.length - active.length} 人已移除`} tone="accent" />
        <Metric label="走完全程" value={finished} note={`共 ${stationsTotal} 站`} />
        <Metric label="人生事件" value={lifeEvents} note="每人最多 3 段" />
        <Metric label="最高分" value={active.reduce((max, player) => Math.max(max, player.score), 0)} note="个人护照总分" />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,.7fr)]">
        <Panel className="overflow-hidden">
          <PanelHead eyebrow="STANDINGS" title="成绩前八" note="按个人护照总分" />
          <div>
            {top.length === 0 ? (
              <EmptyState title="这场没有玩家记录" />
            ) : (
              top.map((player, index) => {
                const color = colorOf(player.color_group) ?? (player.identity === "solo" ? soloColor(player.code) : null);
                return (
                  <div
                    key={player.code}
                    className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3.5"
                    style={{ borderBottom: `1px solid ${T.lineSoft}` }}
                  >
                    <span className="tabular text-sm font-black" style={{ color: index < 3 ? T.danger : T.inkFaint }}>
                      {index + 1}
                    </span>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color?.hex ?? "#8c8171" }} />
                      <div className="min-w-0">
                        <div className="truncate font-black">{player.name}</div>
                        <div className="text-xs font-semibold" style={{ color: T.inkSoft }}>
                          {teamLabel(player.color_group, player.identity, player.code)} · {player.stations_done}/{player.stations_total ?? stationsTotal} 站 · {player.life_events_done}/3 人生
                        </div>
                      </div>
                    </div>
                    <span className="tabular text-xl font-black">{player.score}</span>
                  </div>
                );
              })
            )}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHead eyebrow="AUDIT" title="人工修正记录" note="每次 admin 改动都留痕" />
          {(data.admin_log ?? []).length === 0 ? (
            <EmptyState title="这场没有人工修正" detail="所有分数都来自正常流程。" />
          ) : (
            <div className="tool-scroll max-h-[28rem] overflow-y-auto">
              {(data.admin_log ?? []).map((entry) => (
                <div key={entry.id} className="px-5 py-3.5" style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                  <div className="text-sm font-black">
                    {entry.player_name ?? "系统"} · {entry.action}
                  </div>
                  {entry.reason && (
                    <div className="mt-0.5 text-xs font-semibold" style={{ color: T.inkSoft }}>{entry.reason}</div>
                  )}
                  <div className="mt-1 text-[11px]" style={{ color: T.inkFaint }}>{formatDate(entry.created_at, true)}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-5">
        <Panel className="overflow-hidden">
          <PanelHead eyebrow="TIMELINE" title="完整时间线" note={`${data.activity.length} 条记录`} />
          {data.activity.length === 0 ? (
            <EmptyState title="这场没有动态记录" />
          ) : (
            <div className="p-5">
              {data.activity.map((item) => (
                <div key={item.id} className="relative pb-5 pl-5 last:pb-0" style={{ borderLeft: `2px solid #dfd5c4` }}>
                  <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full" style={{ background: "#b68b20" }} />
                  <div className="text-sm font-black">{item.player_name ?? "系统"} · {feedLabel(item.label)}</div>
                  <div className="mt-0.5 text-sm font-semibold" style={{ color: T.inkSoft }}>{item.detail}</div>
                  <div className="mt-1 text-xs" style={{ color: T.inkFaint }}>{formatDate(item.at, true)}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
