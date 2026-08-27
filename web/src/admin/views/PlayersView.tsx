import { useMemo, useState } from "react";
import type { AdminConsoleData, AdminPlayer } from "../../lib/types";
import { colorOf, soloColor, teamLabel } from "../../lib/types";
import { AdminIcon, Btn, EmptyState, Panel, PanelHead, PageTitle } from "../adminUi";
import { T, inputClass, inputStyle } from "../adminTokens";
import { downloadCsv } from "../adminUtils";

type Status = "active" | "locked" | "removed" | "all";

export function PlayersView({
  consoleData,
  players,
  onPlayer,
}: {
  consoleData: AdminConsoleData;
  players: AdminPlayer[];
  onPlayer: (code: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [identity, setIdentity] = useState("all");

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return players
      .filter((player) =>
        !needle ||
        player.name.toLowerCase().includes(needle) ||
        player.code.includes(needle) ||
        player.teammates.some((name) => name.toLowerCase().includes(needle)),
      )
      .filter((player) =>
        status === "all" ||
        (status === "active" && !player.is_removed) ||
        (status === "locked" && player.locked_for_life_event && !player.is_removed) ||
        (status === "removed" && player.is_removed),
      )
      .filter((player) => identity === "all" || player.identity === identity)
      .sort((a, b) => b.score - a.score);
  }, [identity, players, search, status]);

  const stationsTotal = players[0]?.stations_total ?? 7;

  return (
    <div>
      <PageTitle
        eyebrow="CURRENT EVENT · 当前场次"
        title="玩家护照"
        description="搜索、筛选、修正和导出每一本个人护照。队伍只表示共同参赛关系，分数始终属于个人；每次人工修改都会进入审计记录。"
        actions={
          <Btn
            icon="download"
            onClick={() =>
              downloadCsv(
                `${consoleData.current.title}-玩家.csv`,
                players.map((player) => ({
                  姓名: player.name,
                  人生编号: player.code,
                  同行: player.teammates.join(" / "),
                  身份: player.identity,
                  总分: player.score,
                  完成站点: `${player.stations_done}/${player.stations_total}`,
                  已历人生: `${player.life_events_done}/${player.life_events_total}`,
                  Token可用: player.token_available,
                  已删除: player.is_removed,
                })),
              )
            }
          >
            导出 CSV
          </Btn>
        }
      />

      <Panel className="overflow-hidden">
        <div className="grid gap-3 p-4 md:grid-cols-[minmax(16rem,1fr)_auto_auto]" style={{ borderBottom: `1px solid ${T.line}` }}>
          <div className="relative">
            <AdminIcon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
            <input
              className={`${inputClass} !mt-0 pl-10`}
              style={inputStyle}
              placeholder="搜索姓名、队友或人生编号"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            className={`${inputClass} !mt-0`}
            style={inputStyle}
            value={status}
            onChange={(event) => setStatus(event.target.value as Status)}
          >
            <option value="active">在场玩家</option>
            <option value="locked">手机待选择</option>
            <option value="removed">已移除</option>
            <option value="all">全部状态</option>
          </select>
          <select
            className={`${inputClass} !mt-0`}
            style={inputStyle}
            value={identity}
            onChange={(event) => setIdentity(event.target.value)}
          >
            <option value="all">全部身份</option>
            <option value="solo">Solo</option>
            <option value="duo">Duo</option>
            <option value="trio">Trio</option>
          </select>
        </div>

        <PanelHead eyebrow="PASSPORTS" title={`${rows.length} 本护照`} note="按个人总分排序" />

        {rows.length === 0 ? (
          <EmptyState title="没有匹配的玩家" detail="调整搜索条件或筛选状态。" />
        ) : (
          <div className="tool-scroll overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left">
              <thead>
                <tr
                  className="text-[11px] font-black"
                  style={{ background: T.panelAlt, color: T.inkFaint, borderBottom: `1px solid ${T.line}` }}
                >
                  <th className="px-5 py-3">玩家</th>
                  <th className="px-4 py-3">同行</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3 text-right">站点</th>
                  <th className="px-4 py-3 text-right">人生</th>
                  <th className="px-4 py-3 text-right">总分</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {rows.map((player) => {
                  const color = colorOf(player.color_group) ?? (player.identity === "solo" ? soloColor(player.code) : null);
                  return (
                    <tr
                      key={player.code}
                      className={`cursor-pointer hover:bg-[#fffbf2] ${player.is_removed ? "opacity-50" : ""}`}
                      style={{ borderBottom: `1px solid ${T.lineSoft}` }}
                      onClick={() => onPlayer(player.code)}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <span
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-black text-white"
                            style={{ background: color?.hex ?? "#7d7261" }}
                          >
                            {player.name.slice(0, 1)}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-black">{player.name}</div>
                            <div className="font-mono text-[11px]" style={{ color: T.inkFaint }}>
                              人生编号 {player.code}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="text-sm font-black">
                          {teamLabel(player.color_group, player.identity, player.code)}
                        </div>
                        <div className="mt-0.5 text-xs font-semibold" style={{ color: T.inkSoft }}>
                          {player.teammates.length > 0 ? player.teammates.join(" / ") : "独自同行"}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {player.locked_for_life_event && (
                            <span className="rounded-md px-2 py-1 text-[11px] font-black" style={{ background: "#ffe6df", color: "#a53c2d" }}>
                              第 {player.pending_stage ?? "?"} 段待选
                            </span>
                          )}
                          {!player.token_available && (
                            <span className="rounded-md px-2 py-1 text-[11px] font-black" style={{ background: "#eee8de" }}>Token 已用</span>
                          )}
                          {player.is_removed && (
                            <span className="rounded-md px-2 py-1 text-[11px] font-black" style={{ background: "#eee8de" }}>已移除</span>
                          )}
                          {!player.locked_for_life_event && player.token_available && !player.is_removed && (
                            <span className="text-xs font-bold" style={{ color: "#3c8459" }}>正常</span>
                          )}
                        </div>
                      </td>
                      <td className="tabular px-4 py-3.5 text-right font-bold">
                        {player.stations_done}/{player.stations_total ?? stationsTotal}
                      </td>
                      <td className="tabular px-4 py-3.5 text-right font-bold">
                        {player.life_events_done}/{player.life_events_total}
                      </td>
                      <td className="tabular px-4 py-3.5 text-right text-lg font-black">{player.score}</td>
                      <td className="pr-4 text-right">
                        <AdminIcon name="chevron" className="ml-auto h-4 w-4" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
