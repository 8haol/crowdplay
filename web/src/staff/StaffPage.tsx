import { ThemeProvider } from "../theme/ThemeProvider";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { rpc, errorText } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { EventStation, StaffSession } from "../lib/types";
import { ActionButton, BrandMark, ErrorBanner, UpLink } from "../lib/ui";
import { StaffCard } from "./staffUi";
import { DemoRibbon } from "../lib/DemoRibbon";
import { PREVIEW_STAFF_KEY } from "./previewData";
import { PREVIEW_STATIONS } from "../play/previewData";
import MainStation from "./MainStation";
import GraceStation from "./GraceStation";

const SESSION_KEY = "lp_staff_key";
const LS_STATION = "lp_staff_station";

/** Demo roster for `/staff?preview=1`, mirroring the shipped seed. */
const PREVIEW_ALL_STATIONS: EventStation[] = [
  ...PREVIEW_STATIONS,
  { id: 8, station_id: 8, name_zh: "人生盲盒", type: "life_event", scoring_mode: null, sort_order: 8 },
  { id: 9, station_id: 9, name_zh: "恩典站", type: "grace", scoring_mode: null, sort_order: 9 },
];

/*
 * Station console. Every screen is designed for one-handed use while standing:
 * a compact sticky header that always says which station you are on, one job
 * per screen, and the primary action pinned to the bottom of the viewport.
 */
export default function StaffPage() {
  const [searchParams] = useSearchParams();
  const preview = searchParams.get("preview") === "1";
  const [staffKey, setStaffKey] = useState<string | null>(() =>
    preview ? PREVIEW_STAFF_KEY : sessionStorage.getItem(SESSION_KEY),
  );
  const [stationId, setStationId] = useState<number | null>(() => {
    const stored = localStorage.getItem(LS_STATION);
    return stored ? Number(stored) : null;
  });
  const [notice, setNotice] = useState<string | null>(null);

  /*
   * `staff_session` carries both the event title and this event's enabled
   * station roster (`session.stations` — the same array `staff_stations`
   * used to return separately, one extra round-trip for the same data).
   * Polling it, instead of fetching once on mount, is what lets a station
   * the admin withdraws mid-event reach a volunteer whose phone has been
   * sitting open on the console all evening.
   *
   * Whether the stored station survived is checked right here, inside the
   * poll function — the same place `PlayPage`'s poll reacts to a join code
   * going bad (see `pollFn` there) — rather than in a separate effect. That
   * gives mount (the first fetch) and every later tick the same one code
   * path, and keeps the side effect out of a React effect body.
   */
  const pollFn = useMemo(
    () => (preview || !staffKey ? null : async () => {
      const result = await rpc<StaffSession>("staff_session", { p_staff_key: staffKey });
      const stored = localStorage.getItem(LS_STATION);
      if (stored && !result.stations.some((row) => row.id === Number(stored))) {
        localStorage.removeItem(LS_STATION);
        setStationId(null);
        setNotice("这个站已经被撤下，请重新选择你负责的站点");
      }
      return result;
    }),
    [preview, staffKey],
  );
  const { data: session } = usePoll<StaffSession>(pollFn, 15_000);
  const stations = preview ? PREVIEW_ALL_STATIONS : (session?.stations ?? []);
  /* The code is the event. Show which one, so a volunteer who was sent two codes
     for two nights can tell at a glance that they are in tonight's. */
  const eventTitle = preview ? "演示场次" : (session?.title ?? null);

  const stationsTotal = Math.max(1, stations.filter((station) => station.type === "main").length);

  const renderContent = () => {
    if (!staffKey) {
      return (
        <Login
          title="工作人员"
          onOk={(key) => {
            sessionStorage.setItem(SESSION_KEY, key);
            setStaffKey(key);
          }}
        />
      );
    }

    const station = stations.find((entry) => entry.id === stationId) ?? null;

    if (!station) {
      return (
        <Shell
          demo={preview}
          title="选择你负责的站点"
          subtitle={eventTitle ? `${eventTitle} · 选好之后这台手机会记住` : "选好之后这台手机会记住"}
          onLogout={() => logout(setStaffKey)}
        >
          {notice && (
            <div className="mb-4">
              <ErrorBanner text={notice} />
            </div>
          )}
          <StationPicker
            stations={stations}
            onPick={(id) => {
              localStorage.setItem(LS_STATION, String(id));
              setStationId(id);
              setNotice(null);
            }}
          />
        </Shell>
      );
    }

    return (
      <Shell
        demo={preview}
        title={station.name_zh}
        subtitle={eventTitle ? `${eventTitle} · ${stationSubtitle(station)}` : stationSubtitle(station)}
        badge={station.type === "main" ? `第 ${station.sort_order} 站` : station.type === "grace" ? "恩典站" : "人生盲盒"}
        onSwitch={() => {
          localStorage.removeItem(LS_STATION);
          setStationId(null);
        }}
        onLogout={() => logout(setStaffKey)}
      >
        {station.type === "main" && (
          <MainStation key={station.id} staffKey={staffKey} station={station} stationsTotal={stationsTotal} />
        )}
        {station.type === "life_event" && <LifeEventStation />}
        {station.type === "grace" && (
          <GraceStation staffKey={staffKey} stations={stations} stationsTotal={stationsTotal} />
        )}
      </Shell>
    );
  };

  return <ThemeProvider theme={searchParams.get("theme") ?? (staffKey ? session?.theme : undefined)}>{renderContent()}</ThemeProvider>;
}

function stationSubtitle(station: EventStation): string {
  if (station.type === "main") {
    if (station.scoring_mode === "free") return "整队一次记分 · 点选 0–10 分";
    return station.scoring_mode === "graded" ? "整队一次记分 · 3 / 6 / 9 或失败" : "整队一次记分 · 完成 6 分或失败";
  }
  if (station.type === "life_event") return "玩家在自己手机上完成，无需值守";
  return "整队求助 · 个人换纪念卡";
}

function logout(set: (value: null) => void) {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LS_STATION);
  set(null);
}

/* ------------------------------------------------------------------- shell */

function Shell(props: {
  title: string;
  subtitle?: string;
  badge?: string;
  demo?: boolean;
  children: React.ReactNode;
  onSwitch?: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="min-h-dvh bg-desk text-ink">
      <header
        className="sticky top-0 z-30 px-3 py-2.5"
        style={{ background: "var(--color-accent)", boxShadow: "0 2px 0 var(--color-foil-shadow)" }}
      >
        <div className="mx-auto max-w-md">
          {/* One level up, and it says where that is: inside a station it goes
              back to the station list, not out of the app. */}
          <div className="flex items-center justify-between gap-2 text-ink">
            {props.onSwitch ? (
              <UpLink label="换站点" onClick={props.onSwitch} />
            ) : (
              <UpLink label="入口" to="/" />
            )}
            <button
              type="button"
              className="pressable inline-flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-[14px] font-bold text-accent-deep hover:bg-black/8"
              onClick={props.onLogout}
            >
              退出
            </button>
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            {props.badge && (
              <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-black">
                {props.badge}
              </span>
            )}
            <span className="truncate text-[17px] font-black leading-tight">{props.title}</span>
          </div>
          {props.subtitle && (
            <div className="mt-0.5 truncate text-[11px] font-bold text-accent-deep">{props.subtitle}</div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-md p-4">{props.children}</main>
      {props.demo && <DemoRibbon label="工作人员界面演示 · 不会写入数据" />}
    </div>
  );
}

function StationPicker({ stations, onPick }: { stations: EventStation[]; onPick: (id: number) => void }) {
  if (stations.length === 0) {
    return <StaffCard><div className="dots text-sm font-black text-ink-dim">加载站点<span>.</span><span>.</span><span>.</span></div></StaffCard>;
  }
  const groups: Array<{ label: string; note: string; items: EventStation[] }> = [
    { label: "主线挑战", note: "整队识别一次，录一次结果", items: stations.filter((s) => s.type === "main") },
    { label: "恩典站", note: "Token 求助与纪念卡兑换", items: stations.filter((s) => s.type === "grace") },
    { label: "人生盲盒", note: "已数字化，无需值守", items: stations.filter((s) => s.type === "life_event") },
  ];
  return (
    <div className="space-y-5">
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <div key={group.label}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-black">{group.label}</h2>
              <span className="text-[11px] font-semibold text-ink-dim">{group.note}</span>
            </div>
            <div className="space-y-2">
              {group.items.map((station) => (
                <button
                  key={station.id}
                  type="button"
                  onClick={() => onPick(station.id)}
                  className="pressable flex w-full items-center gap-3 rounded-[18px] bg-white px-4 py-4 text-left"
                  style={{ border: "1px solid var(--color-line)" }}
                >
                  <span
                    className="tabular grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-black"
                    style={{ background: "var(--color-night-raise)" }}
                  >
                    {String(station.sort_order).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] font-black">{station.name_zh}</span>
                    <span className="block truncate text-[11px] font-semibold text-ink-dim">
                      {stationSubtitle(station)}
                    </span>
                  </span>
                  <span className="shrink-0 text-lg text-ink-dim">→</span>
                </button>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- login */

export function Login(props: {
  title: string;
  onOk: (key: string) => void;
  admin?: boolean;
  /** Overrides the default validation round-trip (`admin_dashboard` / `staff_session`). */
  verify?: (key: string) => Promise<unknown>;
  /** Overrides the `LIFE PASSPORT · ADMIN|CREW` eyebrow line. */
  eyebrow?: string;
  /** Overrides the caption under the title. */
  hint?: string;
}) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-desk p-6 text-ink">
      <div className="night-sky" />
      {/* Corner chrome, outside the centred composition: a left-aligned control
          hanging above a centred logo reads as a stray element. */}
      <div className="absolute inset-x-0 top-0 z-10 flex p-4">
        <UpLink label="入口" to="/" />
      </div>
      <div className="relative z-10 flex w-full max-w-xs flex-col items-center">
        <BrandMark className="!w-[104px] !gap-1 !rounded-[18px] !p-2.5 !shadow-[0_3px_0_var(--color-foil-shadow)]" />
        <p className="mt-6 font-mono text-[10px] font-black tracking-[0.4em] text-ink-dim">
          {props.eyebrow ?? `LIFE PASSPORT · ${props.admin ? "ADMIN" : "CREW"}`}
        </p>
        <h1 className="mt-2 text-3xl font-black">{props.title}</h1>
        <p className="mt-2 text-center text-xs font-semibold text-ink-dim">
          {props.hint ?? (props.admin ? "管理员密码由总控发给你" : "输入本场的 6 位工作人员码 · 总控在管理端里能看到它")}
        </p>
        <form
          className="mt-7 w-full space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          {/* A staff code is read off a chat message and typed in a noisy room;
              it is short, per-event and low-value, so it stays visible. The admin
              password is a real secret and stays masked. */}
          <input
            type={props.admin ? "password" : "text"}
            autoComplete={props.admin ? "current-password" : "one-time-code"}
            autoCapitalize={props.admin ? "off" : "characters"}
            spellCheck={false}
            className={`w-full rounded-[16px] bg-card px-4 py-3.5 text-lg font-bold outline-none transition-shadow duration-200 focus:shadow-[0_0_0_3px_var(--color-accent)] ${props.admin ? "" : "text-center font-mono tracking-[0.3em] uppercase"}`}
            style={{ border: "2px solid transparent" }}
            placeholder={props.admin ? "密码" : "工作人员码"}
            maxLength={props.admin ? 64 : 6}
            value={key}
            onChange={(event) => setKey(props.admin ? event.target.value : event.target.value.toUpperCase())}
          />
          <ErrorBanner text={err} />
          <ActionButton
            disabled={!key}
            onClick={async () => {
              setErr(null);
              try {
                // cheap key validation round-trip
                if (props.verify) {
                  await props.verify(key);
                } else if (props.admin) {
                  await rpc("admin_dashboard", { p_admin_key: key });
                } else {
                  await rpc("staff_session", { p_staff_key: key });
                }
                props.onOk(key);
              } catch (error) {
                setErr(errorText(error));
              }
            }}
          >
            登录
          </ActionButton>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- life event */

function LifeEventStation() {
  return (
    <div className="space-y-4">
      <StaffCard tone="accent" className="text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white text-3xl shadow-[0_3px_0_var(--color-foil-shadow)]">
          📱
        </div>
        <h2 className="mt-5 text-2xl font-black">人生事件已经数字化</h2>
        <p className="mt-3 text-sm font-semibold leading-7 text-ink-dim">
          玩家完成第 3 / 5 / 7 站之后，手机上会自动弹出一段人生事件。
          先是整屏通知，点开才出现场景和两个选择；服务器随机揭晓结果并自动计分。
        </p>
      </StaffCard>
      <StaffCard>
        <div className="text-[15px] font-black">工作人员不用操作</div>
        <ul className="mt-2 space-y-1.5 text-xs font-semibold leading-6 text-ink-dim">
          <li>· 不需要输入编号，也不需要发实体卡</li>
          <li>· 不要让整队停在这里等 —— 事件不阻塞队伍去下一站</li>
          <li>· 每人一共三段，最后一段一定在七站跑完后出现</li>
          <li>· 玩家手机确实打不开时，请找总控在 /admin 的玩家档案里处理</li>
        </ul>
      </StaffCard>
    </div>
  );
}
