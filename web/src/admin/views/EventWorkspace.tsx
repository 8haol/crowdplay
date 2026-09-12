import { useMemo, useState } from "react";
import { rpc, errorText } from "../../lib/api";
import { usePoll } from "../../lib/usePoll";
import type { AdminEventDetail, AdminPlayerDetail, StationMetric } from "../../lib/types";
import { colorOf, soloColor, teamLabel } from "../../lib/types";
import { AdminIcon, Btn, EmptyState, Metric, Panel, PanelHead, PageTitle, PhaseLabel, Segmented } from "../adminUi";
import { T, inputClass, inputStyle } from "../adminTokens";
import { downloadCsv, formatDate } from "../adminUtils";

/*
 * One event, one full page. Replaces the old slide-over: an archived session
 * has as much to look at as a live one (its full roster, its station numbers,
 * its timeline), and a drawer with a scrollbar was the wrong container for it.
 */

type Tab = "overview" | "players" | "stations" | "timeline";

export function EventWorkspace({
  adminKey,
  eventId,
  onBack,
}: {
  adminKey: string;
  eventId: string;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const pollFn = useMemo(
    () => () => rpc<AdminEventDetail>("admin_event_detail", { p_admin_key: adminKey, p_event_id: eventId }),
    [adminKey, eventId],
  );
  const { data, error, refresh } = usePoll<AdminEventDetail>(pollFn, 20_000);

  if (!data) {
    return (
      <div>
        <PageTitle eyebrow="EVENT" title="正在读取场次" onBack={{ label: "返回全部活动", onClick: onBack }} />
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

  return (
    <div>
      <PageTitle
        eyebrow={data.is_current ? "CURRENT EVENT · 当前场次" : "ENDED EVENT · 已结束场次"}
        title={data.session.title}
        description={`创建于 ${formatDate(data.session.created_at)}${data.session.ended_at ? ` · 结束于 ${formatDate(data.session.ended_at, true)}` : ""}。这一页是该场活动的完整档案。`}
        onBack={{ label: "返回全部活动", onClick: onBack }}
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

      <div className="mb-5">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { id: "overview", label: "概览" },
            { id: "players", label: `玩家 ${active.length}` },
            { id: "stations", label: "站点" },
            { id: "timeline", label: "时间线" },
          ]}
        />
      </div>

      {tab === "overview" && <Overview data={data} stationsTotal={stationsTotal} />}
      {tab === "players" && <PlayerList players={data.players} stationsTotal={stationsTotal} />}
      {tab === "stations" && <StationList stations={data.station_metrics} />}
      {tab === "timeline" && <Timeline data={data} />}
    </div>
  );
}

/* ---------------------------------------------------------------- overview */

function Overview({ data, stationsTotal }: { data: AdminEventDetail; stationsTotal: number }) {
  const active = data.players.filter((player) => !player.is_removed);
  const top = [...active].sort((a, b) => b.score - a.score).slice(0, 8);
  return (
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
  );
}

/* ----------------------------------------------------------------- players */

function PlayerList({ players, stationsTotal }: { players: AdminPlayerDetail[]; stationsTotal: number }) {
  const [search, setSearch] = useState("");
  const [openCode, setOpenCode] = useState<string | null>(null);
  const needle = search.trim().toLowerCase();
  const rows = players
    .filter((player) => !needle || player.name.toLowerCase().includes(needle) || player.code.includes(needle))
    .sort((a, b) => b.score - a.score);

  return (
    <Panel className="overflow-hidden">
      <div className="p-4" style={{ borderBottom: `1px solid ${T.line}` }}>
        <div className="relative max-w-md">
          <AdminIcon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
          <input
            className={`${inputClass} !mt-0 pl-10`}
            style={inputStyle}
            placeholder="搜索姓名或人生编号"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="没有匹配的玩家" />
      ) : (
        rows.map((player) => {
          const open = openCode === player.code;
          return (
            <div key={player.code} style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-[#fffbf2]"
                onClick={() => setOpenCode(open ? null : player.code)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-black">
                    {player.name}
                    <span className="ml-2 font-mono text-xs" style={{ color: T.inkFaint }}>{player.code}</span>
                    {player.is_removed && (
                      <span className="ml-2 rounded-md px-1.5 py-0.5 text-[10px] font-black" style={{ background: "#eee8de" }}>已移除</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs font-semibold" style={{ color: T.inkSoft }}>
                    {teamLabel(player.color_group, player.identity, player.code)} · {player.stations_done}/{player.stations_total ?? stationsTotal} 站 · {player.life_events_done}/3 人生
                  </div>
                </div>
                <span className="tabular shrink-0 text-xl font-black">{player.score}</span>
                <AdminIcon name="chevron" className="h-4 w-4 shrink-0" />
              </button>

              {open && (
                <div className="grid gap-4 px-5 pb-5 md:grid-cols-2" style={{ background: T.panelAlt }}>
                  <div>
                    <h4 className="pt-4 text-xs font-black tracking-[0.14em]" style={{ color: T.inkFaint }}>站点记录</h4>
                    <div className="mt-2 space-y-1.5">
                      {(player.attempts ?? []).length === 0 && (
                        <div className="text-xs font-semibold" style={{ color: T.inkSoft }}>没有挑战记录</div>
                      )}
                      {(player.attempts ?? []).map((attempt, index) => (
                        <div key={index} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs font-bold">
                          <span>{attempt.station_name ?? `站点 ${attempt.station_id}`}</span>
                          <span style={{ color: attempt.status === "passed" ? T.good : T.danger }}>
                            {attempt.status === "passed" ? `+${attempt.score}` : attempt.status === "retry_granted" ? "可重来" : "未通过"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="pt-4 text-xs font-black tracking-[0.14em]" style={{ color: T.inkFaint }}>人生事件</h4>
                    <div className="mt-2 space-y-1.5">
                      {(player.life_events ?? []).length === 0 && (
                        <div className="text-xs font-semibold" style={{ color: T.inkSoft }}>还没有人生事件</div>
                      )}
                      {(player.life_events ?? []).map((event, index) => (
                        <div key={index} className="rounded-lg bg-white px-3 py-2">
                          <div className="text-xs font-black">
                            {event.stage ? `第 ${event.stage} 段` : "人生事件"} · {event.scene_title ?? ""}
                          </div>
                          <div className="mt-0.5 text-xs font-semibold" style={{ color: T.inkSoft }}>
                            {event.choice_label ? `选了「${event.choice_label}」→ ` : ""}{event.card_label}
                          </div>
                          <div className="tabular mt-0.5 text-xs font-bold">
                            {event.score_before} → {event.score_after}
                          </div>
                        </div>
                      ))}
                    </div>
                    {(player.token_usages ?? []).length > 0 && (
                      <>
                        <h4 className="mt-4 text-xs font-black tracking-[0.14em]" style={{ color: T.inkFaint }}>Token</h4>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(player.token_usages ?? []).map((usage, index) => (
                            <span key={index} className="rounded-md bg-white px-2 py-1 text-[11px] font-black">
                              {usage.usage_type === "hint" ? "提示" : usage.usage_type === "second_chance" ? "重来" : "纪念卡"}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- stations */

function StationList({ stations }: { stations: StationMetric[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {stations.map((station) => (
        <Panel key={station.id} className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-black">{station.name_zh}</div>
              <div className="mt-0.5 text-xs font-semibold" style={{ color: T.inkSoft }}>
                {station.type === "main"
                  ? `${station.passed} 通过 · ${station.failed} 失手 · 累计 ${station.score_awarded} 分`
                  : `${station.visits} 次处理`}
              </div>
            </div>
            <div className="tabular text-xl font-black">
              {station.type === "main" ? `${station.completion_pct}%` : station.visits}
            </div>
          </div>
          {station.type === "main" && (
            <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "#eee8de" }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, station.completion_pct)}%`, background: T.accent }} />
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- timeline */

function Timeline({ data }: { data: AdminEventDetail }) {
  return (
    <Panel className="overflow-hidden">
      <PanelHead eyebrow="TIMELINE" title="完整时间线" note={`${data.activity.length} 条记录`} />
      {data.activity.length === 0 ? (
        <EmptyState title="这场没有动态记录" />
      ) : (
        <div className="p-5">
          {data.activity.map((item) => (
            <div key={item.id} className="relative pb-5 pl-5 last:pb-0" style={{ borderLeft: `2px solid #dfd5c4` }}>
              <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full" style={{ background: "#b68b20" }} />
              <div className="text-sm font-black">{item.player_name ?? "系统"} · {item.label}</div>
              <div className="mt-0.5 text-sm font-semibold" style={{ color: T.inkSoft }}>{item.detail}</div>
              <div className="mt-1 text-xs" style={{ color: T.inkFaint }}>{formatDate(item.at, true)}</div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
