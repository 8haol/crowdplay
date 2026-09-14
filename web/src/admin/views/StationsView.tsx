import { useMemo } from "react";
import { errorText, rpc } from "../../lib/api";
import { usePoll } from "../../lib/usePoll";
import type { AdminConsoleData, EventStationsData, StationLibrary } from "../../lib/types";
import { Btn, Metric, Panel, PageTitle } from "../adminUi";
import { T } from "../adminTokens";
import { PREVIEW_EVENT_STATIONS, PREVIEW_LIBRARY } from "../previewData";
import { EventStationsPanel } from "./EventStationsPanel";
import { StationLibraryPanel } from "./StationLibraryPanel";

interface StationsData {
  event: EventStationsData;
  library: StationLibrary;
}

/*
 * Station operations, in the order the operator thinks about them:
 *
 *   1. 本场站点 — what tonight actually runs, and its live numbers.
 *   2. 站点库   — the organisation's catalogue, which tonight was picked from.
 *
 * The two panels live in their own files (`EventStationsPanel`,
 * `StationLibraryPanel`): they are separate editors over separate RPCs with
 * separate rules, and keeping them here made one 400-line file with two
 * unrelated pieces of draft state in it.
 */
export function StationsView({
  adminKey,
  consoleData,
  preview,
  onDone,
}: {
  adminKey: string;
  consoleData: AdminConsoleData;
  preview?: boolean;
  onDone: (message: string) => void;
}) {
  const eventId = consoleData.current.event_id;
  const pollFn = useMemo(
    () => async (): Promise<StationsData> => {
      const [event, library] = await Promise.all([
        rpc<EventStationsData>("admin_event_stations", { p_admin_key: adminKey, p_event_id: eventId }),
        rpc<StationLibrary>("admin_station_library", { p_admin_key: adminKey }),
      ]);
      return { event, library };
    },
    [adminKey, eventId],
  );
  const poll = usePoll<StationsData>(preview ? null : pollFn, 15_000);
  const data = preview ? { event: PREVIEW_EVENT_STATIONS, library: PREVIEW_LIBRARY } : poll.data;

  const done = (message: string) => { onDone(message); poll.refresh(); };

  const mains = consoleData.station_metrics.filter(
    (station) => station.type === "main" && !station.disabled,
  );
  const avgCompletion = mains.length
    ? Math.round(mains.reduce((sum, station) => sum + station.completion_pct, 0) / mains.length)
    : 0;
  const phase = data?.event.phase ?? consoleData.current.phase;

  return (
    <div>
      <PageTitle
        eyebrow="OPERATIONS · 现场运营"
        title="站点运营"
        description="上半页是这一场跑哪些站，下半页是本机构的站点库。开场前可以随意调整名单；开场之后临时缺人手，就把那个站撤下来，已记的分会保留。"
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="本场主线站点" value={mains.length} note="人生事件按完成进度触发" tone="accent" />
        <Metric label="平均完成覆盖" value={`${avgCompletion}%`} note="全场队伍的平均进度" />
        <Metric label="整队盖章" value={consoleData.stats.stamps} note="一支队伍一站算一次" />
        <Metric
          label="本场名单"
          value={phase === "waiting" ? "可编辑" : phase === "playing" ? "已锁定" : "已存档"}
          note={phase === "waiting" ? "开场前随时改" : phase === "playing" ? "进行中只能撤站" : "结束后只读"}
          tone={phase === "waiting" ? "good" : phase === "playing" ? "danger" : "neutral"}
        />
      </div>

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
        <div className="space-y-5">
          <EventStationsPanel
            adminKey={adminKey}
            eventId={eventId}
            data={data.event}
            metrics={consoleData.station_metrics}
            preview={preview}
            onDone={done}
          />
          <StationLibraryPanel
            adminKey={adminKey}
            library={data.library}
            preview={preview}
            onDone={done}
          />
        </div>
      )}

      {data && <StationNumbers consoleData={consoleData} />}
    </div>
  );
}

/* The numbers per station, kept below the two editors: during the event this
   is what the operator watches, but it is a read-out, not a control. */
function StationNumbers({ consoleData }: { consoleData: AdminConsoleData }) {
  const mains = consoleData.station_metrics.filter((station) => station.type === "main");
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
                  <h2 className="font-black">{station.name_zh}</h2>
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
              <div className="mt-2 h-2.5 overflow-hidden rounded-full" style={{ background: "#eee8de" }}>
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
