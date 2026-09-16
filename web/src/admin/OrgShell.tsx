import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rpc, errorText } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { AdminDashboardData } from "../lib/types";
import { SuccessBanner } from "../lib/ui";
import { Btn, EmptyState, Panel } from "./adminUi";
import { T } from "./adminTokens";
import { ConsoleSkeleton, ShellError, SideNav, TopBar } from "./adminChrome";
import { ORG_NAV, type OrgSection } from "./adminUtils";
import { DeleteEventDialog, NewGameModal } from "./AdminDialogs";
import { EventsListView, type DeletableEvent } from "./views/EventsListView";
import { LifeEventCatalogView } from "./LifeEventCatalogView";
import { OrgSettingsView } from "./views/OrgSettingsView";
import { StationLibraryPage } from "./views/StationLibraryPage";
import type { OrgPreview } from "./previewData";

/*
 * 机构层：跨场次的东西。登录后默认落在这里。
 *
 * 这一层只调「只要口令」的那几个 RPC——尤其是不再调 admin_console /
 * admin_list_players。以前它每 4 秒无条件拉一次某个隐式选中的场次，那个隐式
 * 选中正是「这一栏到底在管哪一场」说不清的根源。现在要管某一场，就得先进去。
 */
export function OrgShell({
  adminKey,
  section,
  previewData,
  onLogout,
  onAdminKeyChanged,
}: {
  adminKey: string;
  section: OrgSection;
  previewData?: OrgPreview;
  onLogout: () => void;
  onAdminKeyChanged: (key: string) => void;
}) {
  const navigate = useNavigate();
  const [banner, setBanner] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [deleting, setDeleting] = useState<DeletableEvent | null>(null);

  const pollFn = useMemo(
    () => () => rpc<AdminDashboardData>("admin_dashboard", { p_admin_key: adminKey }),
    [adminKey],
  );
  const poll = usePoll<AdminDashboardData>(previewData ? null : pollFn, 4000);
  const data = previewData ? previewData.dashboard : poll.data;
  const online = previewData ? true : poll.online;

  const done = (message: string) => { setBanner(message); if (!previewData) poll.refresh(); };
  const go = (next: OrgSection) => {
    setNavOpen(false);
    navigate(next === "events" ? "/admin" : `/admin/${next}`);
  };

  if (!data) {
    return (
      <div className="tool-surface min-h-dvh" style={{ color: T.ink }}>
        <TopBar online={online} onLogout={onLogout} onMenu={() => {}} />
        {poll.error ? (
          <ShellError
            title="无法连接管理数据"
            detail={errorText(poll.error)}
            actions={
              <>
                <Btn variant="primary" onClick={poll.refresh}>重试</Btn>
                <Btn variant="quiet" onClick={onLogout}>重新登录</Btn>
              </>
            }
          />
        ) : (
          <ConsoleSkeleton />
        )}
      </div>
    );
  }

  return (
    <div className="tool-surface min-h-dvh" style={{ color: T.ink }}>
      <TopBar
        online={online}
        session={data.org.name_zh}
        onLogout={onLogout}
        onMenu={() => setNavOpen((value) => !value)}
      />

      <div className="mx-auto flex w-full max-w-[1560px]">
        <SideNav<OrgSection>
          items={ORG_NAV}
          current={section}
          open={navOpen}
          badges={{ events: data.events.length }}
          onNavigate={go}
          onDismiss={() => setNavOpen(false)}
          footer={
            <>
              <Btn variant="primary" icon="plus" className="w-full" onClick={() => { setNavOpen(false); setNewGameOpen(true); }}>
                创建新场次
              </Btn>
              <p className="mt-3 px-1 text-[11px] font-semibold leading-5" style={{ color: T.inkFaint }}>
                新场次拿到自己的入场二维码、工作人员码和大屏链接；已有的活动原样保留。
              </p>
            </>
          }
        />

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {banner && <div className="mb-5"><SuccessBanner text={banner} /></div>}

          {section === "events" && (
            data.events.length === 0 ? (
              /* 从 /root 新开的机构故意没有预建场次。这不是错误，是一个真实的
                 成功状态，所以给它一张平静的空卡片而不是报错。 */
              <Panel className="mx-auto w-full max-w-md">
                <EmptyState
                  title="这间机构还没有活动"
                  detail="创建第一场就能拿到专属的入场二维码、工作人员码和大屏链接，之前的设置一个都不会丢。"
                  action={<Btn variant="primary" icon="plus" onClick={() => setNewGameOpen(true)}>创建新场次</Btn>}
                />
              </Panel>
            ) : (
              <EventsListView
                events={data.events}
                onOpenEvent={(eventId) => navigate(`/admin/e/${eventId}/overview`)}
                onNewGame={() => setNewGameOpen(true)}
                onDelete={previewData ? undefined : setDeleting}
              />
            )
          )}
          {section === "library" && (
            <StationLibraryPage adminKey={adminKey} preview={Boolean(previewData)} onDone={done} />
          )}
          {section === "life-events" && (
            <LifeEventCatalogView adminKey={adminKey} preview={Boolean(previewData)} />
          )}
          {section === "org-settings" && (
            <OrgSettingsView
              adminKey={adminKey}
              orgName={data.org.name_zh}
              onDone={done}
              onAdminKeyChanged={onAdminKeyChanged}
            />
          )}
        </main>
      </div>

      {newGameOpen && (
        <NewGameModal
          adminKey={adminKey}
          playerCount={0}
          onClose={() => setNewGameOpen(false)}
          onDone={(message, eventId) => {
            setNewGameOpen(false);
            done(message);
            // 把人送进刚建的那一场：新的二维码、工作人员码和大屏链接都在里面。
            if (eventId) navigate(`/admin/e/${eventId}/overview`);
          }}
        />
      )}
      {deleting && (
        <DeleteEventDialog
          adminKey={adminKey}
          event={deleting}
          onClose={() => setDeleting(null)}
          onDone={(message) => { setDeleting(null); done(message); }}
        />
      )}
    </div>
  );
}
