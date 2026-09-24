import { useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { Login } from "../staff/StaffPage";
import { DemoRibbon } from "../lib/DemoRibbon";
import { OrgShell } from "./OrgShell";
import { EventShell } from "./EventShell";
import { ORG_NAV, EVENT_NAV, type OrgSection, type EventSection } from "./adminUtils";
import { ORG_PREVIEW, EVENT_PREVIEW } from "./previewData";

const SESSION_KEY = "lp_admin_key";

/*
 * 管理后台的入口：登录门 + 决定进哪一层。
 *
 * 后台是两层的，路由就把这两层写出来：
 *
 *   /admin                              机构层（全部活动）
 *   /admin/library|life-events|albums|org-settings
 *   /admin/albums/:albumId              机构层里的某一本相册
 *   /admin/e/:eventId/overview|live|players|stations|settings
 *
 * 这么做是因为用户抱怨的根源是「左侧这一栏到底针对谁」没有任何地方明示。
 * 写进路径之后，刷新、后退、收藏、把链接发给别人都自洽。
 *
 * 从外面进来的入口只有裸 /admin（首页、/screen 引导页、/guide 的演示链接、
 * /root 代入之后的跳转），没有任何一处深链到旧的 ?view= / ?event=，
 * 所以这次重排 URL 不会打断既有链接。
 */
export default function AdminPage() {
  const [searchParams] = useSearchParams();
  const params = useParams();
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

  const logout = () => { sessionStorage.removeItem(SESSION_KEY); setAdminKey(null); };
  const keyChanged = (key: string) => { sessionStorage.setItem(SESSION_KEY, key); setAdminKey(key); };
  const ribbon = preview ? <DemoRibbon label="管理后台演示 · 数据为示例" /> : null;

  // 活动层：URL 里有 :eventId。
  if (params.eventId) {
    const requested = params.section as EventSection | undefined;
    if (!requested || !EVENT_NAV.some((item) => item.id === requested)) {
      return <Navigate to={`/admin/e/${params.eventId}/overview`} replace />;
    }
    return (
      <>
        {ribbon}
        <EventShell
          adminKey={adminKey}
          eventId={params.eventId}
          section={requested}
          previewData={preview ? EVENT_PREVIEW : undefined}
          onLogout={logout}
        />
      </>
    );
  }

  // 机构层：/admin 本身是「全部活动」，其余几页各占一个路径段。
  // /admin/albums/:albumId 没有 :section，但它仍然是「活动相册」那一页。
  const requested = (params.albumId ? "albums" : params.section) as OrgSection | undefined;
  const section: OrgSection =
    requested && ORG_NAV.some((item) => item.id === requested) ? requested : "events";
  return (
    <>
      {ribbon}
      <OrgShell
        adminKey={adminKey}
        section={section}
        albumId={section === "albums" ? params.albumId : undefined}
        previewData={preview ? ORG_PREVIEW : undefined}
        onLogout={logout}
        onAdminKeyChanged={keyChanged}
      />
    </>
  );
}
