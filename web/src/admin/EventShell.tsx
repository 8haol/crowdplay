import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rpc, errorText } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { AdminConsoleData, AdminPlayer } from "../lib/types";
import { SuccessBanner } from "../lib/ui";
import { Btn } from "./adminUi";
import { T } from "./adminTokens";
import { ConsoleSkeleton, ShellError, SideNav, TopBar } from "./adminChrome";
import { EVENT_NAV, type EventSection } from "./adminUtils";
import { PlayerDrawer } from "./AdminDialogs";
import { EventOverview } from "./views/EventOverview";
import { EventSettingsView } from "./views/EventSettingsView";
import { EventStationsPage } from "./views/EventStationsPage";
import { LiveView } from "./views/LiveView";
import { PlayersView } from "./views/PlayersView";
import type { EventPreview } from "./previewData";

interface Snapshot {
  consoleData: AdminConsoleData;
  players: AdminPlayer[];
}

/*
 * 活动层：只属于这一场。
 *
 * 和机构层最大的区别是「在管哪一场」不再靠猜——它来自 URL 的 :eventId，
 * 顶栏和左侧栏都把它写在脸上。以前这个选择是隐式的（URL 有就用 URL 的，
 * 否则用正在进行的，否则用最新的），于是同一个设置页你不知道它在改哪一场。
 */
export function EventShell({
  adminKey,
  eventId,
  section,
  previewData,
  onLogout,
}: {
  adminKey: string;
  eventId: string;
  section: EventSection;
  previewData?: EventPreview;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const [banner, setBanner] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [playerCode, setPlayerCode] = useState<string | null>(null);

  const pollFn = useMemo(
    () => async (): Promise<Snapshot> => {
      const [consoleData, players] = await Promise.all([
        rpc<AdminConsoleData>("admin_console", { p_admin_key: adminKey, p_event_id: eventId }),
        rpc<AdminPlayer[]>("admin_list_players", { p_admin_key: adminKey, p_event_id: eventId }),
      ]);
      return { consoleData, players };
    },
    [adminKey, eventId],
  );
  const poll = usePoll<Snapshot>(previewData ? null : pollFn, 4000);
  const data = previewData ?? poll.data;
  const online = previewData ? true : poll.online;

  const done = (message: string) => { setBanner(message); if (!previewData) poll.refresh(); };
  const go = (next: EventSection) => {
    setNavOpen(false);
    navigate(`/admin/e/${eventId}/${next}`);
  };

  if (!data) {
    return (
      <div className="tool-surface min-h-dvh" style={{ color: T.ink }}>
        <TopBar online={online} onLogout={onLogout} onMenu={() => {}} />
        {poll.error ? (
          /* 场次不存在、或不属于当前登录的机构，后端抛 EVENT_NOT_FOUND。
             故意不静默跳回列表——静默跳走会让人以为自己点错了。
             标题保持中性，具体原因交给 errorText：这里也可能是网络断了，
             那时说"找不到这场活动"就是撒谎。 */
          <ShellError
            title="打不开这场活动"
            detail={errorText(poll.error)}
            actions={
              <>
                <Btn variant="primary" onClick={() => navigate("/admin")}>回到全部活动</Btn>
                <Btn variant="quiet" onClick={poll.refresh}>重试</Btn>
              </>
            }
          />
        ) : (
          <ConsoleSkeleton />
        )}
      </div>
    );
  }

  const { consoleData, players } = data;
  const selectedPlayer = players.find((player) => player.code === playerCode) ?? null;

  return (
    <div className="tool-surface min-h-dvh" style={{ color: T.ink }}>
      <TopBar
        online={online}
        session={consoleData.current.title}
        context={consoleData.org.name_zh}
        phase={consoleData.current.phase}
        screenToken={consoleData.current.screen_token}
        onLogout={onLogout}
        onMenu={() => setNavOpen((value) => !value)}
      />

      <div className="mx-auto flex w-full max-w-[1560px]">
        <SideNav<EventSection>
          items={EVENT_NAV}
          current={section}
          open={navOpen}
          badges={{ live: consoleData.stats.locked_players }}
          onNavigate={go}
          onDismiss={() => setNavOpen(false)}
          tone="ink"
          header={
            <Btn variant="onRail" icon="back" className="w-full" onClick={() => navigate("/admin")}>
              全部活动
            </Btn>
          }
        />

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {banner && <div className="mb-5"><SuccessBanner text={banner} /></div>}

          {section === "overview" && (
            <EventOverview adminKey={adminKey} eventId={eventId} preview={Boolean(previewData)} />
          )}
          {section === "live" && (
            <LiveView
              adminKey={adminKey}
              consoleData={consoleData}
              players={players}
              onDone={done}
              onPlayer={setPlayerCode}
              onNewGame={() => navigate("/admin")}
            />
          )}
          {section === "players" && (
            <PlayersView consoleData={consoleData} players={players} onPlayer={setPlayerCode} />
          )}
          {section === "stations" && (
            <EventStationsPage
              adminKey={adminKey}
              eventId={eventId}
              stationMetrics={consoleData.station_metrics}
              stamps={consoleData.stats.stamps}
              preview={Boolean(previewData)}
              onDone={done}
            />
          )}
          {section === "settings" && (
            <EventSettingsView adminKey={adminKey} session={consoleData.current} onDone={done} />
          )}
        </main>
      </div>

      {selectedPlayer && (
        <PlayerDrawer
          adminKey={adminKey}
          eventId={eventId}
          player={selectedPlayer}
          onClose={() => setPlayerCode(null)}
          onDone={(message) => { setPlayerCode(null); done(message); }}
        />
      )}
    </div>
  );
}
