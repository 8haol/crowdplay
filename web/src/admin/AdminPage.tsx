import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { rpc, errorText } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { AdminConsoleData, AdminDashboardData, AdminPlayer } from "../lib/types";
import { screenUrl } from "../lib/gameLinks";
import { ChromeDivider, ConnDot, SuccessBanner, UpLink } from "../lib/ui";
import { Login } from "../staff/StaffPage";
import { AdminIcon, Btn, EmptyState, Panel, PhaseLabel } from "./adminUi";
import { T } from "./adminTokens";
import { ADMIN_NAV, NAV_GROUPS, type AdminSection } from "./adminUtils";
import { NewGameModal, PlayerDrawer } from "./AdminDialogs";
import { LifeEventCatalogView } from "./LifeEventCatalogView";
import { EventsListView } from "./views/EventsListView";
import { EventOverview } from "./views/EventOverview";
import { LiveView } from "./views/LiveView";
import { PlayersView } from "./views/PlayersView";
import { EventSettingsView } from "./views/EventSettingsView";
import { OrgSettingsView } from "./views/OrgSettingsView";
import { EventStationsPage } from "./views/EventStationsPage";
import { StationLibraryPage } from "./views/StationLibraryPage";
import { ADMIN_PREVIEW, type AdminSnapshot } from "./previewData";
import { DemoRibbon } from "../lib/DemoRibbon";

const SESSION_KEY = "lp_admin_key";

/*
 * Operator console. Layout is a conventional dashboard on purpose — persistent
 * left rail, one page per destination, deep links via `?view=` / `?event=` —
 * because the previous top-tab build gave archives, the live controls and the
 * player table equal billing and no sense of "where am I".
 */
export default function AdminPage() {
  const [searchParams] = useSearchParams();
  const preview = searchParams.get("preview") === "1";
  const [adminKey, setAdminKey] = useState<string | null>(() =>
    preview ? "preview" : sessionStorage.getItem(SESSION_KEY),
  );

  if (!adminKey) {
    return (
      <Login
        title="管理中心"
        admin
        onOk={(key) => { sessionStorage.setItem(SESSION_KEY, key); setAdminKey(key); }}
      />
    );
  }
  return (
    <>
      {preview && <DemoRibbon label="管理后台演示 · 数据为示例" />}
    <AdminConsole
      adminKey={adminKey}
      previewData={preview ? ADMIN_PREVIEW : undefined}
      onLogout={() => { sessionStorage.removeItem(SESSION_KEY); setAdminKey(null); }}
      onAdminKeyChanged={(key) => { sessionStorage.setItem(SESSION_KEY, key); setAdminKey(key); }}
    />
    </>
  );
}

/*
 * What one poll round-trip resolves to. Most organisations have run at least
 * one event and get the normal console; a brand-new one from /root
 * deliberately has none yet (no event is pre-created), which is a real,
 * successful state — not an error — so it is carried as data, never thrown.
 */
type AdminScreen =
  | { emptyOrg: false; snapshot: AdminSnapshot }
  | { emptyOrg: true; org: AdminDashboardData["org"] };

function AdminConsole(props: {
  adminKey: string;
  previewData?: AdminSnapshot;
  onLogout: () => void;
  onAdminKeyChanged: (key: string) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedEventId = searchParams.get("event");
  /*
   * The console always works on one event. Which one: the event in the URL if
   * there is one (the operator opened it from the list), otherwise the one that
   * is live right now, otherwise the newest. The dashboard call resolves that
   * before the per-event calls are made.
   */
  const pollFn = useMemo(
    () => async (): Promise<AdminScreen> => {
      const dashboard = await rpc<AdminDashboardData>("admin_dashboard", { p_admin_key: props.adminKey });
      const eventId =
        (requestedEventId && dashboard.events.some((event) => event.event_id === requestedEventId) ? requestedEventId : null)
        ?? dashboard.live_event_id
        ?? dashboard.events[0]?.event_id;
      if (!eventId) return { emptyOrg: true, org: dashboard.org };
      const [consoleData, players] = await Promise.all([
        rpc<AdminConsoleData>("admin_console", { p_admin_key: props.adminKey, p_event_id: eventId }),
        rpc<AdminPlayer[]>("admin_list_players", { p_admin_key: props.adminKey, p_event_id: eventId }),
      ]);
      return { emptyOrg: false, snapshot: { consoleData, players } };
    },
    [props.adminKey, requestedEventId],
  );
  const poll = usePoll<AdminScreen>(props.previewData ? null : pollFn, 4000);
  const data: AdminScreen | null = props.previewData ? { emptyOrg: false, snapshot: props.previewData } : poll.data;
  const online = props.previewData ? true : poll.online;

  const requestedSection = searchParams.get("view") as AdminSection | null;
  const section: AdminSection = ADMIN_NAV.some((item) => item.id === requestedSection)
    ? requestedSection!
    : "events";
  const openEventId = searchParams.get("event");

  const navigate = (next: AdminSection, eventId?: string | null) => {
    const updated = new URLSearchParams(searchParams);
    if (next === "events") updated.delete("view"); else updated.set("view", next);
    if (eventId) updated.set("event", eventId); else updated.delete("event");
    setSearchParams(updated, { replace: false });
  };

  const [banner, setBanner] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [playerCode, setPlayerCode] = useState<string | null>(null);

  const done = (message: string) => { setBanner(message); if (!props.previewData) poll.refresh(); };

  if (!data) {
    return (
      <div className="tool-surface min-h-dvh" style={{ color: T.ink }}>
        <TopBar online={online} onLogout={props.onLogout} onMenu={() => {}} />
        {poll.error ? (
          <div className="grid min-h-[75dvh] place-items-center p-6">
            <Panel className="max-w-md p-7 text-center">
              <span
                className="mx-auto grid h-12 w-12 place-items-center rounded-xl text-xl font-black"
                style={{ background: T.dangerSoft, color: T.danger }}
              >
                !
              </span>
              <h1 className="mt-4 text-xl font-black">无法连接管理数据</h1>
              <p className="mt-2 text-sm font-semibold" style={{ color: T.inkSoft }}>{errorText(poll.error)}</p>
              <div className="mt-5 flex justify-center gap-2">
                <Btn variant="primary" onClick={poll.refresh}>重试</Btn>
                <Btn variant="quiet" onClick={props.onLogout}>重新登录</Btn>
              </div>
            </Panel>
          </div>
        ) : (
          <ConsoleSkeleton />
        )}
      </div>
    );
  }

  /*
   * A brand-new organisation from /root has no events yet — on purpose, it is
   * not pre-created. That is not a connection failure, so it gets its own
   * calm shell instead of the error card above: just enough chrome for 退出
   * to work, plus a way to create the first event.
   */
  if (data.emptyOrg) {
    return (
      <div className="tool-surface min-h-dvh" style={{ color: T.ink }}>
        <TopBar online={online} session={data.org.name_zh} onLogout={props.onLogout} onMenu={() => {}} />
        <div className="grid min-h-[75dvh] place-items-center p-6">
          <Panel className="w-full max-w-md">
            <EmptyState
              title="这间机构还没有活动"
              detail="创建第一场就能拿到专属的入场二维码、工作人员码和大屏链接，之前的设置一个都不会丢。"
              action={
                <Btn variant="primary" icon="plus" onClick={() => setNewGameOpen(true)}>创建新场次</Btn>
              }
            />
          </Panel>
        </div>
        {newGameOpen && (
          <NewGameModal
            adminKey={props.adminKey}
            playerCount={0}
            onClose={() => setNewGameOpen(false)}
            onDone={(message, eventId) => {
              setNewGameOpen(false);
              done(message);
              // Land the operator in the event they just made; that is where
              // the new keys are.
              if (eventId) navigate("events", eventId);
            }}
          />
        )}
      </div>
    );
  }

  const snapshot = data.snapshot;
  const selectedPlayer = snapshot.players.find((player) => player.code === playerCode) ?? null;
  const common = { adminKey: props.adminKey, consoleData: snapshot.consoleData, players: snapshot.players, onDone: done };

  return (
    <div className="tool-surface min-h-dvh" style={{ color: T.ink }}>
      <TopBar
        online={online}
        session={`${snapshot.consoleData.org.name_zh} · ${snapshot.consoleData.current.title}`}
        phase={snapshot.consoleData.current.phase}
        screenToken={snapshot.consoleData.current.screen_token}
        onLogout={props.onLogout}
        onMenu={() => setNavOpen((value) => !value)}
      />

      <div className="mx-auto flex w-full max-w-[1560px]">
        <SideNav
          section={section}
          open={navOpen}
          liveCount={snapshot.consoleData.stats.locked_players}
          eventCount={snapshot.consoleData.events.length}
          onNavigate={(next) => { setNavOpen(false); navigate(next, null); }}
          onNewGame={() => { setNavOpen(false); setNewGameOpen(true); }}
        />

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {banner && <div className="mb-5"><SuccessBanner text={banner} /></div>}

          {openEventId ? (
            <div>
              <div className="mb-4">
                <Btn variant="quiet" onClick={() => navigate("events", null)}>返回全部活动</Btn>
              </div>
              <EventOverview
                adminKey={props.adminKey}
                eventId={openEventId}
                preview={Boolean(props.previewData)}
              />
            </div>
          ) : (
            <>
              {section === "events" && (
                <EventsListView
                  consoleData={snapshot.consoleData}
                  onOpenEvent={(eventId) => navigate("events", eventId)}
                  onNewGame={() => setNewGameOpen(true)}
                />
              )}
              {section === "live" && (
                <LiveView
                  {...common}
                  onPlayer={setPlayerCode}
                  onNewGame={() => setNewGameOpen(true)}
                />
              )}
              {section === "players" && (
                <PlayersView consoleData={snapshot.consoleData} players={snapshot.players} onPlayer={setPlayerCode} />
              )}
              {section === "stations" && (
                <div className="space-y-6">
                  <EventStationsPage
                    adminKey={props.adminKey}
                    eventId={snapshot.consoleData.current.event_id}
                    stationMetrics={snapshot.consoleData.station_metrics}
                    stamps={snapshot.consoleData.stats.stamps}
                    preview={Boolean(props.previewData)}
                    onDone={done}
                  />
                  <StationLibraryPage
                    adminKey={props.adminKey}
                    preview={Boolean(props.previewData)}
                    onDone={done}
                  />
                </div>
              )}
              {section === "life-events" && (
                <LifeEventCatalogView adminKey={props.adminKey} preview={Boolean(props.previewData)} />
              )}
              {section === "settings" && (
                <div className="space-y-6">
                  <EventSettingsView
                    adminKey={props.adminKey}
                    session={snapshot.consoleData.current}
                    onDone={done}
                  />
                  <OrgSettingsView
                    adminKey={props.adminKey}
                    orgName={snapshot.consoleData.org.name_zh}
                    onDone={done}
                    onAdminKeyChanged={props.onAdminKeyChanged}
                  />
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {newGameOpen && (
        <NewGameModal
          adminKey={props.adminKey}
          current={snapshot.consoleData.current}
          playerCount={snapshot.consoleData.stats.players}
          onClose={() => setNewGameOpen(false)}
          onDone={(message, eventId) => {
            setNewGameOpen(false);
            done(message);
            // Land the operator in the event they just made; that is where the
            // new keys are.
            if (eventId) navigate("events", eventId);
          }}
        />
      )}
      {selectedPlayer && (
        <PlayerDrawer
          adminKey={props.adminKey}
          eventId={snapshot.consoleData.current.event_id}
          player={selectedPlayer}
          onClose={() => setPlayerCode(null)}
          onDone={(message) => { setPlayerCode(null); done(message); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- chrome */

function TopBar({
  online,
  session,
  phase,
  screenToken,
  onLogout,
  onMenu,
}: {
  online: boolean;
  session?: string;
  phase?: AdminConsoleData["current"]["phase"];
  /** The working event's projector token; the header link opens that event's screen. */
  screenToken?: string;
  onLogout: () => void;
  onMenu: () => void;
}) {
  return (
    <header
      className="sticky top-0 z-30 h-[62px] backdrop-blur-xl"
      style={{ background: "rgba(247,243,236,.96)", borderBottom: `1px solid #ded4c3` }}
    >
      <div className="mx-auto flex h-full w-full max-w-[1560px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="pressable grid h-9 w-9 shrink-0 place-items-center rounded-lg lg:hidden"
            style={{ border: `1px solid #d9cebc`, background: "#fff" }}
            onClick={onMenu}
            aria-label="打开导航"
          >
            <AdminIcon name="menu" className="h-4 w-4" />
          </button>
          <UpLink label="入口" to="/" className="hidden sm:inline-flex" />
          <ChromeDivider />
          <div className="min-w-0">
            <div className="text-[10px] font-black tracking-[0.3em]" style={{ color: T.inkFaint }}>
              LIFE PASSPORT
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-black">{session ?? "管理中心"}</span>
              {phase && <PhaseLabel phase={phase} />}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden items-center gap-1.5 text-xs font-bold sm:flex" style={{ color: T.inkSoft }}>
            <ConnDot online={online} />
            {online ? "已连接" : "重连中"}
          </span>
          <a
            href={screenToken ? screenUrl(screenToken) : "/screen"}
            target="_blank"
            rel="noreferrer"
            className="pressable hidden items-center gap-2 rounded-lg px-3 py-2 text-xs font-black sm:inline-flex"
            style={{ background: "#fff", border: `1px solid #d9cebc` }}
          >
            <AdminIcon name="screen" className="h-4 w-4" />
            实况大屏
          </a>
          <button
            type="button"
            className="pressable inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black"
            style={{ color: T.inkSoft }}
            onClick={onLogout}
          >
            <AdminIcon name="logout" className="h-4 w-4" />
            退出
          </button>
        </div>
      </div>
    </header>
  );
}

function SideNav({
  section,
  open,
  liveCount,
  eventCount,
  onNavigate,
  onNewGame,
}: {
  section: AdminSection;
  open: boolean;
  liveCount: number;
  eventCount: number;
  onNavigate: (next: AdminSection) => void;
  onNewGame: () => void;
}) {
  const items = (ids: AdminSection[]) =>
    ids.map((id) => {
      const item = ADMIN_NAV.find((entry) => entry.id === id)!;
      const active = section === id;
      const badge = id === "live" ? liveCount : id === "events" ? eventCount : 0;
      return (
        <button
          key={id}
          type="button"
          onClick={() => onNavigate(id)}
          className="pressable flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
          style={
            active
              ? { background: T.ink, color: "#fff" }
              : { background: "transparent", color: T.ink }
          }
        >
          <AdminIcon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black">{item.label}</span>
            <span
              className="block truncate text-[11px] font-semibold"
              style={{ color: active ? "rgba(255,255,255,.62)" : T.inkFaint }}
            >
              {item.note}
            </span>
          </span>
          {badge > 0 && (
            <span
              className="tabular shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black"
              style={
                active
                  ? { background: "rgba(255,255,255,.2)", color: "#fff" }
                  : { background: T.accentSoft, color: T.warn }
              }
            >
              {badge}
            </span>
          )}
        </button>
      );
    });

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-20 bg-[#211d18]/40 lg:hidden"
          onClick={() => onNavigate(section)}
          role="presentation"
        />
      )}
      <nav
        className={`fixed inset-y-0 left-0 z-30 w-[17rem] shrink-0 overflow-y-auto px-3 pb-6 pt-[76px] transition-transform lg:sticky lg:top-[62px] lg:z-0 lg:h-[calc(100dvh-62px)] lg:translate-x-0 lg:pt-5 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: T.bg, borderRight: `1px solid #ded4c3` }}
      >
        <div className="space-y-5">
          {NAV_GROUPS.map((ids, index) => (
            <div key={index}>
              <div className="px-3 pb-1.5 text-[10px] font-black tracking-[0.2em]" style={{ color: T.inkFaint }}>
                {ADMIN_NAV.find((entry) => entry.id === ids[0])?.group}
              </div>
              <div className="space-y-0.5">{items(ids)}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${T.line}` }}>
          <Btn variant="primary" icon="plus" className="w-full" onClick={onNewGame}>创建新场次</Btn>
          <p className="mt-3 px-1 text-[11px] font-semibold leading-5" style={{ color: T.inkFaint }}>
            新场次拿到自己的入场二维码、工作人员码和大屏链接；已有的活动原样保留。
          </p>
        </div>
      </nav>
    </>
  );
}

function ConsoleSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1560px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-10 w-72 animate-pulse rounded-xl bg-[#e8e0d4]" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-[16px] bg-white" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-[18px] bg-white" />
    </div>
  );
}
