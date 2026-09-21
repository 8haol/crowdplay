import { useMemo } from "react";
import { errorText, rpc } from "../../lib/api";
import { usePoll } from "../../lib/usePoll";
import type { EventStation, EventStationsData, StationHiddenFields, StationMetric } from "../../lib/types";
import { Btn, HiddenTag, Metric, Panel, PageTitle } from "../adminUi";
import { T } from "../adminTokens";
import { PREVIEW_EVENT_STATIONS } from "../previewData";
import { EventStationsPanel } from "./EventStationsPanel";

/*
 * 这一场跑哪些站，以及它们的数字。
 *
 * 和「站点库」拆成两页：站点库是整间机构跨场次复用的模板，这一页只讲今晚。
 * 以前它们挤在一个叫「站点运营」的页面里，而那一页又作用于一个隐式选中的场次。
 *
 * station_metrics 由调用方传入，不在这里自己拉 admin_console：活动层外壳本来
 * 就在轮询它，白拿。admin_event_stations 只返回 {phase, rows, candidates}，
 * 没有这些数字。
 */
export function EventStationsPage({
  adminKey,
  eventId,
  stationMetrics,
  stamps,
  preview,
  onDone,
}: {
  adminKey: string;
  eventId: string;
  stationMetrics: StationMetric[];
  stamps: number;
  preview?: boolean;
  onDone: (message: string) => void;
}) {
  const pollFn = useMemo(
    () => () => rpc<EventStationsData>("admin_event_stations", { p_admin_key: adminKey, p_event_id: eventId }),
    [adminKey, eventId],
  );
  const poll = usePoll<EventStationsData>(preview ? null : pollFn, 15_000);
  const data = preview ? PREVIEW_EVENT_STATIONS : poll.data;

  const done = (message: string) => { onDone(message); poll.refresh(); };

  /* 隐藏摊位（神秘嘉宾）不计入主站数：和后端 _main_station_total 的口径一致。
     metrics 那份 payload 不带 hidden，从本场名单里查。 */
  const hiddenIds = useMemo(
    () => new Set(
      ((data?.rows ?? []) as Array<EventStation & StationHiddenFields>)
        .filter((row) => row.hidden)
        .map((row) => row.station_id),
    ),
    [data],
  );
  const mains = stationMetrics.filter(
    (station) => station.type === "main" && !station.disabled && !hiddenIds.has(station.station_id),
  );
  const avgCompletion = mains.length
    ? Math.round(mains.reduce((sum, station) => sum + station.completion_pct, 0) / mains.length)
    : 0;

  return (
    <div>
      <PageTitle
        eyebrow="EVENT STATIONS"
        title="本场站点"
        description="这一场实际启用了哪些站，以及它们的完成率。开场前可以随意增删改名；一旦开场就只能撤站、不能再加，已记的分全部保留。"
      />

      {!data ? (
        <Panel className="p-10 text-center">
          {poll.error ? (
            <>
              <h2 className="text-lg font-black">站点配置读取失败</h2>
              <p className="mt-2 text-sm font-semibold" style={{ color: T.inkSoft }}>{errorText(poll.error)}</p>
              <div className="mt-4"><Btn variant="primary" onClick={poll.refresh}>重试</Btn></div>
            </>
          ) : (
            <div className="dots text-sm font-black" style={{ color: T.inkSoft }}>
              正在读取站点配置<span>.</span><span>.</span><span>.</span>
            </div>
          )}
        </Panel>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="本场主线站点" value={mains.length} note="人生事件按完成进度触发" />
            <Metric label="平均完成覆盖" value={`${avgCompletion}%`} note="全场队伍的平均进度" />
            <Metric label="整队盖章" value={stamps} note="一支队伍一站算一次" />
            <Metric
              label="本场名单"
              value={data.phase === "waiting" ? "可编辑" : data.phase === "playing" ? "已锁定" : "已存档"}
              note={data.phase === "waiting" ? "开场前随时改" : data.phase === "playing" ? "进行中只能撤站" : "结束后只读"}
              tone={data.phase === "waiting" ? "good" : data.phase === "playing" ? "danger" : "neutral"}
            />
          </div>

          <EventStationsPanel
            adminKey={adminKey}
            eventId={eventId}
            data={data}
            metrics={stationMetrics}
            preview={preview}
            onDone={done}
          />

          <StationNumbers metrics={stationMetrics} hiddenIds={hiddenIds} />
        </>
      )}
    </div>
  );
}

/* 每个站的数字，放在编辑器下面：活动进行中这是总控盯着看的东西，
   但它是读数，不是控件。 */
function StationNumbers({ metrics, hiddenIds }: { metrics: StationMetric[]; hiddenIds: Set<number> }) {
  const mains = metrics.filter((station) => station.type === "main");
  if (mains.length === 0) return null;
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      {mains.map((station) => {
        const decided = station.passed + station.failed;
        const passRate = decided > 0 ? Math.round((station.passed / decided) * 100) : 0;
        return (
          <Panel key={station.station_id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className="tabular grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-black"
                  style={{ background: T.panelAlt }}
                >
                  {String(station.sort_order).padStart(2, "0")}
                </span>
                <div>
                  <h2 className="flex items-center gap-2 font-black">
                    {station.name_zh}
                    {hiddenIds.has(station.station_id) && <HiddenTag />}
                  </h2>
                  <div className="text-[11px] font-bold" style={{ color: T.inkFaint }}>
                    {station.scoring_mode === "graded"
                      ? "3 / 6 / 9 分级计分"
                      : station.scoring_mode === "free"
                        ? "0–10 自由计分"
                        : "固定 6 分"}
                  </div>
                </div>
              </div>
              {station.disabled && (
                <span
                  className="shrink-0 rounded-md px-2 py-1 text-[11px] font-black"
                  style={{ background: T.dangerSoft, color: T.danger }}
                >
                  已撤站
                </span>
              )}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <Stat label="处理次数" value={station.visits} />
              <Stat label="通过率" value={`${passRate}%`} />
              <Stat label="完成覆盖" value={`${station.completion_pct}%`} />
            </div>

            <div className="mt-5">
              <div className="flex justify-between text-xs font-bold" style={{ color: T.inkSoft }}>
                <span>队伍完成进度</span>
                <span className="tabular">{station.completion_pct}%</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full" style={{ background: "var(--color-admin-neutral)" }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, station.completion_pct)}%`, background: T.accent }}
                />
              </div>
            </div>
          </Panel>
        );
      })}
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
