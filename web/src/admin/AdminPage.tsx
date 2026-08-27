import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { rpc, errorText } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { AdminConsoleData, AdminPlayer, StationMetric } from "../lib/types";
import { ConnDot, SuccessBanner } from "../lib/ui";
import { Login } from "../staff/StaffPage";
import { AdminIcon, PhaseLabel } from "./adminUi";
import { ADMIN_NAV, type AdminTab } from "./adminUtils";
import { EventDetailDrawer, NewGameModal, PlayerDrawer, StationEditModal } from "./AdminDialogs";
import { EventsView, OverviewView, PlayersView, SettingsView, StationsView } from "./AdminViews";
import { LifeEventCatalogView } from "./LifeEventCatalogView";

const SESSION_KEY = "lp_admin_key";

interface AdminSnapshot {
  consoleData: AdminConsoleData;
  players: AdminPlayer[];
}

export default function AdminPage() {
  const [searchParams] = useSearchParams();
  const preview = import.meta.env.DEV && searchParams.get("preview") === "1";
  const [adminKey, setAdminKey] = useState<string | null>(() => preview ? "preview" : sessionStorage.getItem(SESSION_KEY));

  if (!adminKey) {
    return <Login title="管理中心" admin onOk={(key) => { sessionStorage.setItem(SESSION_KEY, key); setAdminKey(key); }} />;
  }
  return <AdminConsole adminKey={adminKey} previewData={preview ? PREVIEW_SNAPSHOT : undefined} onLogout={() => { sessionStorage.removeItem(SESSION_KEY); setAdminKey(null); }} onAdminKeyChanged={(key) => { sessionStorage.setItem(SESSION_KEY, key); setAdminKey(key); }} />;
}

function AdminConsole(props: { adminKey: string; previewData?: AdminSnapshot; onLogout: () => void; onAdminKeyChanged: (key: string) => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const pollFn = useMemo(() => async (): Promise<AdminSnapshot> => {
    const [consoleData, players] = await Promise.all([
      rpc<AdminConsoleData>("admin_console", { p_admin_key: props.adminKey }),
      rpc<AdminPlayer[]>("admin_list_players", { p_admin_key: props.adminKey }),
    ]);
    return { consoleData, players };
  }, [props.adminKey]);
  const poll = usePoll<AdminSnapshot>(props.previewData ? null : pollFn, 4000);
  const data = props.previewData ?? poll.data;
  const online = props.previewData ? true : poll.online;
  const requestedTab = searchParams.get("view") as AdminTab | null;
  const tab: AdminTab = ADMIN_NAV.some((item) => item.id === requestedTab) ? requestedTab! : "overview";
  const setTab = (next: AdminTab) => {
    const updated = new URLSearchParams(searchParams);
    if (next === "overview") updated.delete("view"); else updated.set("view", next);
    setSearchParams(updated, { replace: true });
  };
  const [banner, setBanner] = useState<string | null>(null);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [playerCode, setPlayerCode] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [station, setStation] = useState<StationMetric | null>(null);

  const refresh = () => { setBanner(null); if (!props.previewData) poll.refresh(); };
  const done = (message: string) => { setBanner(message); if (!props.previewData) poll.refresh(); };

  if (!data) {
    return <div className="min-h-dvh bg-[#f7f3ec] text-[#26211b]"><AdminTop online={online} onLogout={props.onLogout} />{poll.error ? <div className="grid min-h-[75dvh] place-items-center p-6"><div className="max-w-md rounded-[24px] border border-[#e4dac8] bg-white p-7 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#fff0eb] text-xl font-black text-[#a63727]">!</span><h1 className="mt-4 text-2xl font-black">控制台连接失败</h1><p className="mt-2 text-sm font-semibold leading-6 text-[#7e7364]">{errorText(poll.error)}</p><button className="mt-5 rounded-xl bg-[#26211b] px-5 py-3 text-sm font-black text-white" onClick={refresh}>重新连接</button></div></div> : <ConsoleSkeleton />}</div>;
  }

  const common = { adminKey: props.adminKey, consoleData: data.consoleData, players: data.players, onDone: done };
  const selectedPlayer = data.players.find((player) => player.code === playerCode) ?? null;

  return <div className="min-h-dvh bg-[#f7f3ec] pb-16 text-[#26211b]">
    <AdminTop online={online} session={data.consoleData.current.title} phase={data.consoleData.current.phase} onLogout={props.onLogout} />
    <nav className="sticky top-[65px] z-20 border-b border-[#ded4c3] bg-[#f7f3ec]/96 backdrop-blur-xl"><div className="mx-auto flex max-w-[1480px] gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">{ADMIN_NAV.map((item) => <button key={item.id} className={`relative flex shrink-0 items-center gap-2 px-3 py-3.5 text-sm font-black transition-colors ${tab === item.id ? "text-[#26211b]" : "text-[#887d6d] hover:text-[#3f3931]"}`} onClick={() => setTab(item.id)}><AdminIcon name={item.id} className="h-4 w-4" /><span className="hidden sm:inline">{item.label}</span><span className="sm:hidden">{item.short}</span>{tab === item.id && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[#d19b11]" />}</button>)}</div></nav>
    <main id="admin-main" className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-9">{banner && <div className="mb-5"><SuccessBanner text={banner} /></div>}{tab === "overview" && <OverviewView {...common} onNewGame={() => setNewGameOpen(true)} onPlayer={setPlayerCode} />}{tab === "events" && <EventsView {...common} onNewGame={() => setNewGameOpen(true)} onEvent={setEventId} />}{tab === "players" && <PlayersView {...common} onPlayer={setPlayerCode} />}{tab === "life-events" && <LifeEventCatalogView adminKey={props.adminKey} preview={Boolean(props.previewData)} />}{tab === "stations" && <StationsView {...common} onStation={setStation} />}{tab === "settings" && <SettingsView {...common} onNewGame={() => setNewGameOpen(true)} onAdminKeyChanged={props.onAdminKeyChanged} />}</main>
    {newGameOpen && <NewGameModal adminKey={props.adminKey} current={data.consoleData.current} playerCount={data.consoleData.stats.players} onClose={() => setNewGameOpen(false)} onDone={(message) => { setNewGameOpen(false); done(message); }} />}
    {selectedPlayer && <PlayerDrawer adminKey={props.adminKey} player={selectedPlayer} onClose={() => setPlayerCode(null)} onDone={(message) => { setPlayerCode(null); done(message); }} />}
    {eventId && <EventDetailDrawer adminKey={props.adminKey} eventId={eventId} onClose={() => setEventId(null)} />}
    {station && <StationEditModal adminKey={props.adminKey} station={station} onClose={() => setStation(null)} onDone={(message) => { setStation(null); done(message); }} />}
  </div>;
}

function AdminTop({ online, session, phase, onLogout }: { online: boolean; session?: string; phase?: AdminConsoleData["current"]["phase"]; onLogout: () => void }) {
  return <header className="sticky top-0 z-30 h-[65px] border-b border-[#ded4c3] bg-[#f7f3ec]/96 backdrop-blur-xl"><div className="mx-auto flex h-full max-w-[1480px] items-center justify-between gap-4 pr-4 pl-[4.5rem] sm:pr-6 sm:pl-[5rem] lg:pr-8"><div className="flex min-w-0 items-center gap-5"><div className="shrink-0"><div className="flex items-center gap-2 text-sm font-black tracking-[-0.02em]"><span className="grid grid-cols-2 gap-[2px]"><i className="h-2 w-2 rounded-[2px] bg-[#26211b]" /><i className="h-2 w-2 rounded-[2px] bg-[#d94d38]" /><i className="h-2 w-2 rounded-[2px] bg-[#f1bb2c]" /><i className="h-2 w-2 rounded-[2px] bg-[#33935d]" /></span>LIFE PASSPORT</div><div className="mt-0.5 text-[10px] font-bold text-[#8c8171]">活动管理后台</div></div>{session && <div className="hidden min-w-0 items-center gap-3 border-l border-[#d9cebc] pl-5 md:flex"><div className="min-w-0"><div className="truncate text-sm font-black">{session}</div><div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold text-[#8c8171]"><ConnDot online={online} />{online ? "数据已同步" : "正在重连"}</div></div>{phase && <PhaseLabel phase={phase} />}</div>}</div><div className="flex shrink-0 items-center gap-2"><a href="/screen" target="_blank" rel="noreferrer" className="hidden items-center gap-2 rounded-lg border border-[#d9cebc] bg-white px-3 py-2 text-xs font-black sm:flex"><AdminIcon name="screen" className="h-4 w-4" />大屏</a><button className="rounded-lg px-3 py-2 text-xs font-black text-[#786e61] hover:bg-[#ece5da]" onClick={onLogout}>退出</button></div></div></header>;
}

function ConsoleSkeleton() {
  return <div className="mx-auto max-w-[1480px] space-y-6 px-4 py-8 sm:px-6 lg:px-8"><div className="h-10 w-72 animate-pulse rounded-xl bg-[#e8e0d4]" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-36 animate-pulse rounded-[18px] bg-white" />)}</div><div className="grid gap-5 lg:grid-cols-2"><div className="h-96 animate-pulse rounded-[22px] bg-white" /><div className="h-96 animate-pulse rounded-[22px] bg-white" /></div></div>;
}

const previewPlayer = (name: string, code: string, score: number, attemptCount: number, extra: Partial<AdminPlayer> = {}): AdminPlayer => ({ player_id: code, name, code, identity: "solo", color_group: `solo-${Number(code) % 8 + 1}`, score, token_available: true, locked_for_life_event: false, next_threshold: score < 35 ? 35 : 45, pending_threshold: null, status_effect: null, team_id: `team-${code}`, team_code: `S${code.slice(-2)}`, team_challenge_score: null, is_removed: false, created_at: new Date().toISOString(), attempt_count: attemptCount, ...extra });
const PREVIEW_PLAYERS = [previewPlayer("林沐恩", "0427", 48, 6), previewPlayer("周以诺", "1836", 42, 5, { identity: "duo", color_group: "navy" }), previewPlayer("陈思语", "2741", 37, 5, { identity: "trio", color_group: "coral", locked_for_life_event: true, pending_threshold: 35 }), previewPlayer("梁乐知", "5912", 31, 4, { token_available: false })];
const PREVIEW_STATIONS: StationMetric[] = [{ id: 1, slug: "music", name_zh: "音乐之声", type: "main", scoring_mode: "graded", sort_order: 1, visits: 34, passed: 29, failed: 5, score_awarded: 198, completion_pct: 72.3 }, { id: 2, slug: "uk-life", name_zh: "英伦百事通", type: "main", scoring_mode: "graded", sort_order: 2, visits: 28, passed: 20, failed: 8, score_awarded: 147, completion_pct: 59.6 }, { id: 8, slug: "life-event", name_zh: "人生盲盒", type: "life_event", scoring_mode: null, sort_order: 8, visits: 19, passed: 0, failed: 0, score_awarded: 0, completion_pct: 0 }];
const PREVIEW_SNAPSHOT: AdminSnapshot = { players: PREVIEW_PLAYERS, consoleData: { current: { event_id: "preview-event", title: "2026 Glasgow 新生迎新会", join_token: "8f23e7c51a9d4b60", join_open: true, phase: "playing", created_at: new Date().toISOString(), started_at: new Date().toISOString(), ended_at: null, player_count: 47 }, stats: { players: 47, teams: 23, stamps: 68, life_events: 19, tokens_used: 11, top_score: 48, top_personal_score: 48, locked_players: 1, removed_players: 2 }, teams: [{ team_id: "team-d03", code: "D03", identity: "duo", color_group: "navy", challenge_score: 42, stations_done: 6, pending_events: 0, created_at: new Date().toISOString(), members: [{ name: "林沐恩", score: 48, token_available: true }, { name: "周以诺", score: 42, token_available: true }] }, { team_id: "team-t07", code: "T07", identity: "trio", color_group: "coral", challenge_score: 36, stations_done: 5, pending_events: 1, created_at: new Date().toISOString(), members: [{ name: "陈思语", score: 37, token_available: true }, { name: "梁乐知", score: 31, token_available: false }, { name: "顾安然", score: 36, token_available: true }] }], station_metrics: PREVIEW_STATIONS, activity: [{ id: "1", kind: "attempt", at: new Date().toISOString(), player_name: "D03 · 林沐恩 / 周以诺", player_code: "D03", label: "音乐之声", detail: "全队每人 +9 分" }, { id: "2", kind: "life_event", at: new Date(Date.now() - 120000).toISOString(), player_name: "陈思语", player_code: "2741", label: "人生事件", detail: "路上捡到 £10" }], archives: [{ event_id: "archive-1", title: "2026 春季学生团契", phase: "ended", created_at: "2026-03-14T18:00:00Z", started_at: "2026-03-14T18:20:00Z", ended_at: "2026-03-14T19:35:00Z", player_count: 38, top_score: 56, stamps: 221, life_events: 16, tokens_used: 9 }] } };
