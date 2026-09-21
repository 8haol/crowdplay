import { useMemo, useState } from "react";
import { errorText, rpc } from "../../lib/api";
import type {
  EventStation,
  EventStationsData,
  ScoringMode,
  Station,
  StationMetric,
  StationType,
} from "../../lib/types";
import { ErrorBanner } from "../../lib/ui";
import { Btn, Panel, PanelHead } from "../adminUi";
import { T, inputClass, inputStyle } from "../adminTokens";
import { TYPE_ZH, stationRule } from "../adminUtils";
import { DisableStationModal } from "../AdminDialogs";

/** One row of the draft roster: exactly what `admin_set_event_stations` takes. */
interface DraftRow {
  station_id: number;
  name_zh: string;
  type: StationType;
  scoring_mode: ScoringMode;
}

/**
 * 「本场站点」 — which stations this one event runs.
 *
 * The roster is a snapshot, not a pointer into the library, so it is editable
 * as a whole sheet while the event is still waiting and frozen once it starts.
 * The one mid-event action is withdrawing a station (a volunteer did not turn
 * up), which the backend allows in `playing` precisely because it keeps every
 * score already recorded.
 */
export function EventStationsPanel({
  adminKey,
  eventId,
  data,
  metrics,
  preview,
  onDone,
}: {
  adminKey: string;
  eventId: string;
  data: EventStationsData;
  /** Per-station numbers for this event, keyed by `station_id`. */
  metrics: StationMetric[];
  preview?: boolean;
  onDone: (message: string) => void;
}) {
  const editable = data.phase === "waiting";
  const enabled = useMemo(() => data.rows.filter((row) => !row.disabled_at), [data.rows]);
  const withdrawn = useMemo(() => data.rows.filter((row) => row.disabled_at), [data.rows]);

  const initial = useMemo<DraftRow[]>(() => enabled.map(toDraft), [enabled]);
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const rows = draft ?? initial;
  const dirty = draft !== null;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<EventStation | null>(null);

  /* Everything that could still join: library rows not on the roster, plus any
     row this draft has taken off it (which goes back to being just a library
     row the moment the sheet is saved). */
  const pool = useMemo(() => {
    const chosen = new Set(rows.map((row) => row.station_id));
    return [
      ...data.candidates.filter((station) => !chosen.has(station.id)).map(fromLibrary),
      ...data.rows.filter((row) => !chosen.has(row.station_id)).map(toDraft),
    ].sort((a, b) => a.station_id - b.station_id);
  }, [data.candidates, data.rows, rows]);

  const metricOf = useMemo(
    () => new Map(metrics.map((metric) => [metric.station_id, metric])),
    [metrics],
  );

  const edit = (index: number, patch: Partial<DraftRow>) =>
    setDraft(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const move = (index: number, delta: number) => {
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
  };

  const save = async () => {
    setErr(null);
    if (preview) return onDone("演示模式不会写入数据");
    setBusy(true);
    try {
      await rpc("admin_set_event_stations", {
        p_admin_key: adminKey,
        p_event_id: eventId,
        // Sort order is the order on screen; the operator never types a number.
        p_rows: rows.map((row, index) => ({
          station_id: row.station_id,
          name_zh: row.name_zh.trim(),
          scoring_mode: row.type === "main" ? row.scoring_mode : null,
          sort_order: index + 1,
        })),
      });
      setDraft(null);
      onDone(`本场站点已保存（${rows.length} 个）`);
    } catch (error) {
      setErr(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel className="overflow-hidden">
        <PanelHead
          eyebrow="本场站点"
          title={`这一场跑 ${enabled.length} 个站`}
          note={
            editable
              ? "开场前可以随意增删、改名、排序。保存之后工作人员端立刻照这份名单选站。"
              : data.phase === "playing"
                ? "活动进行中，名单已锁定。临时缺人手时可以撤站 —— 已记的分会保留。"
                : "活动已结束，这份名单是当晚的存档。"
          }
          actions={
            editable ? (
              <>
                {dirty && <Btn variant="quiet" onClick={() => { setDraft(null); setErr(null); }}>还原</Btn>}
                <Btn variant="primary" disabled={!dirty || busy} onClick={save}>
                  {busy ? "保存中…" : "保存本场名单"}
                </Btn>
              </>
            ) : undefined
          }
        />

        {err && <div className="px-5 pt-4"><ErrorBanner text={err} /></div>}

        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm font-bold" style={{ color: T.inkFaint }}>
            这一场还没有任何站点。从下面的候选里挑几个加进来。
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: T.lineSoft }}>
            {rows.map((row, index) => {
              const metric = metricOf.get(row.station_id);
              return (
                <li key={row.station_id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <span
                    className="tabular grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-black"
                    style={{ background: T.panelAlt }}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  {editable ? (
                    <input
                      className={`${inputClass} !mt-0 !w-auto min-w-[9rem] flex-1`}
                      style={inputStyle}
                      value={row.name_zh}
                      maxLength={30}
                      aria-label={`第 ${index + 1} 站名称`}
                      onChange={(event) => edit(index, { name_zh: event.target.value })}
                    />
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-black">{row.name_zh}</div>
                      <div className="text-[11px] font-bold" style={{ color: T.inkFaint }}>
                        {stationRule(row.type, row.scoring_mode)}
                        {metric && row.type === "main" ? ` · 已处理 ${metric.visits} 次` : ""}
                      </div>
                    </div>
                  )}

                  {editable && row.type === "main" && (
                    <select
                      className={`${inputClass} !mt-0 !w-auto shrink-0`}
                      style={inputStyle}
                      value={row.scoring_mode ?? "graded"}
                      aria-label={`${row.name_zh} 计分方式`}
                      onChange={(event) => edit(index, { scoring_mode: event.target.value as ScoringMode })}
                    >
                      <option value="graded">3 / 6 / 9</option>
                      <option value="free">0–10 自由</option>
                      <option value="fixed">固定 6 分</option>
                    </select>
                  )}
                  {editable && row.type !== "main" && (
                    <span className="shrink-0 text-[11px] font-black" style={{ color: T.inkFaint }}>
                      {TYPE_ZH[row.type]}
                    </span>
                  )}

                  <div className="flex shrink-0 items-center gap-1.5">
                    {editable ? (
                      <>
                        <MoveButton label="上移" disabled={index === 0} onClick={() => move(index, -1)}>↑</MoveButton>
                        <MoveButton label="下移" disabled={index === rows.length - 1} onClick={() => move(index, 1)}>↓</MoveButton>
                        {/* The server refuses a sheet without a life-event
                            station or without a main one; say so before the
                            operator gets there rather than after. */}
                        <Btn
                          variant="quiet"
                          disabled={Boolean(required(rows, index))}
                          onClick={() => setDraft(rows.filter((_, i) => i !== index))}
                        >
                          {required(rows, index) ?? "移出"}
                        </Btn>
                      </>
                    ) : data.phase === "playing" && row.type !== "life_event" ? (
                      /* Same rule as the waiting sheet, same moment: the server
                         keeps at least one main station, so the last one's
                         button is dead before it is pressed rather than after
                         the operator has confirmed a withdrawal. */
                      <Btn
                        variant="danger"
                        disabled={Boolean(required(rows, index))}
                        onClick={() => {
                          const station = enabled.find((entry) => entry.station_id === row.station_id);
                          if (station) setDisabling(station);
                        }}
                      >
                        {required(rows, index) ? "必留" : "撤站"}
                      </Btn>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {editable && (
          <div className="px-5 py-4" style={{ borderTop: `1px solid ${T.lineSoft}`, background: T.panelAlt }}>
            <div className="text-[11px] font-black tracking-[0.16em]" style={{ color: T.inkFaint }}>
              可以加进本场的站点
            </div>
            {pool.length === 0 ? (
              <p className="mt-2 text-xs font-semibold" style={{ color: T.inkFaint }}>
                库里的站点都已经在本场了。要更多站点请到下面的「站点库」新增。
              </p>
            ) : (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {pool.map((station) => (
                  <button
                    key={station.station_id}
                    type="button"
                    className="pressable rounded-xl px-3 py-2 text-xs font-black"
                    style={{ background: "var(--color-card)", border: `1px solid var(--color-admin-panel-line)` }}
                    onClick={() => setDraft([...rows, station])}
                  >
                    + {station.name_zh}
                    <span className="ml-1.5 font-bold" style={{ color: T.inkFaint }}>
                      {TYPE_ZH[station.type]}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] font-semibold leading-5" style={{ color: T.inkFaint }}>
              每场必须留一个人生盲盒站和至少一个主线站点。开场之后这份名单就锁定了，只能撤站。
            </p>
          </div>
        )}

        {withdrawn.length > 0 && (
          <div className="px-5 py-4" style={{ borderTop: `1px solid ${T.lineSoft}` }}>
            <div className="text-[11px] font-black tracking-[0.16em]" style={{ color: T.inkFaint }}>
              本场已撤下
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {withdrawn.map((row) => (
                <span
                  key={row.station_id}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-black"
                  style={{ background: T.dangerSoft, color: T.danger }}
                >
                  {row.name_zh} · 已记的分保留
                </span>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {disabling && (
        <DisableStationModal
          adminKey={adminKey}
          eventId={eventId}
          station={disabling}
          onClose={() => setDisabling(null)}
          onDone={(message) => { setDisabling(null); onDone(message); }}
        />
      )}
    </>
  );
}

function MoveButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="pressable grid h-9 w-9 place-items-center rounded-lg text-sm font-black disabled:opacity-30"
      style={{ background: "var(--color-card)", border: `1px solid var(--color-admin-panel-line)`, color: T.ink }}
    >
      {children}
    </button>
  );
}

/** Why this row cannot leave the event — as a draft edit or as a mid-event
    withdrawal — or null if it can. Mirrors the server's two guards. */
function required(rows: DraftRow[], index: number): string | null {
  const row = rows[index];
  const others = rows.filter((_, i) => i !== index);
  if (row.type === "life_event" && !others.some((other) => other.type === "life_event")) return "必留";
  if (row.type === "main" && !others.some((other) => other.type === "main")) return "必留";
  return null;
}

function toDraft(row: EventStation): DraftRow {
  return {
    station_id: row.station_id,
    name_zh: row.name_zh,
    type: row.type,
    scoring_mode: row.scoring_mode,
  };
}

/* A library row joins the event under the library's current name; the event
   then owns that copy, and later renames in the library do not follow it. */
function fromLibrary(station: Station): DraftRow {
  return {
    station_id: station.id,
    name_zh: station.name_zh,
    type: station.type,
    scoring_mode: station.scoring_mode,
  };
}
