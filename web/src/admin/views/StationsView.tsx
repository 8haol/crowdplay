import type { AdminConsoleData, StationMetric } from "../../lib/types";
import { Btn, Metric, Panel, PageTitle } from "../adminUi";
import { T } from "../adminTokens";

export function StationsView({
  consoleData,
  onStation,
}: {
  consoleData: AdminConsoleData;
  onStation: (station: StationMetric) => void;
}) {
  const phaseLocked = consoleData.current.phase === "playing";
  const mains = consoleData.station_metrics.filter((station) => station.type === "main");
  const avgCompletion = mains.length
    ? Math.round(mains.reduce((sum, station) => sum + station.completion_pct, 0) / mains.length)
    : 0;

  return (
    <div>
      <PageTitle
        eyebrow="OPERATIONS · 现场运营"
        title="站点运营"
        description="每个站点的处理量、通过率和完成覆盖。非游戏进行状态下还可以修改显示名称与计分方式。"
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="主线站点" value={mains.length} note="人生事件按第 3 / 5 / 7 站触发" tone="accent" />
        <Metric label="平均完成覆盖" value={`${avgCompletion}%`} note="全场玩家的平均进度" />
        <Metric label="整队盖章" value={consoleData.stats.stamps} note="一支队伍一站算一次" />
        <Metric
          label="站点配置"
          value={phaseLocked ? "已锁定" : "可编辑"}
          note={phaseLocked ? "游戏进行中不能改配置" : "开局前 / 结束后可改"}
          tone={phaseLocked ? "danger" : "good"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {consoleData.station_metrics.map((station) => {
          const decided = station.passed + station.failed;
          const passRate = decided > 0 ? Math.round((station.passed / decided) * 100) : 0;
          return (
            <Panel key={station.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg font-mono text-xs font-black"
                    style={{ background: T.panelAlt }}
                  >
                    {String(station.sort_order).padStart(2, "0")}
                  </span>
                  <div>
                    <h2 className="font-black">{station.name_zh}</h2>
                    <div className="text-[11px] font-bold" style={{ color: T.inkFaint }}>
                      {station.type === "main"
                        ? station.scoring_mode === "graded" ? "3 / 6 / 9 分级计分" : "固定 6 分"
                        : station.type === "life_event" ? "手机自动事件（无需值守）" : "Help Token 兑换"}
                    </div>
                  </div>
                </div>
                <Btn disabled={phaseLocked} onClick={() => onStation(station)}>编辑</Btn>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <Stat label="处理次数" value={station.visits} />
                <Stat label={station.type === "main" ? "通过率" : "累计处理"} value={station.type === "main" ? `${passRate}%` : station.visits} />
                <Stat
                  label={station.type === "main" ? "完成覆盖" : "类型"}
                  value={station.type === "main" ? `${station.completion_pct}%` : station.type === "life_event" ? "事件" : "恩典"}
                />
              </div>

              {station.type === "main" && (
                <div className="mt-5">
                  <div className="flex justify-between text-xs font-bold" style={{ color: T.inkSoft }}>
                    <span>玩家完成进度</span>
                    <span className="tabular">{station.completion_pct}%</span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full" style={{ background: "#eee8de" }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, station.completion_pct)}%`, background: T.accent }} />
                  </div>
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[11px] font-bold" style={{ color: T.inkFaint }}>{label}</div>
      <div className="tabular mt-1 text-xl font-black">{value}</div>
    </div>
  );
}
