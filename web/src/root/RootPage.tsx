import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Login } from "../staff/StaffPage";
import { DemoRibbon } from "../lib/DemoRibbon";
import { ErrorBanner } from "../lib/ui";
import { Btn, EmptyState, PageTitle, Panel, PanelHead } from "../admin/adminUi";
import { T } from "../admin/adminTokens";
import { rpc, errorText } from "../lib/api";
import type { ImpersonateResult, PlatformOrg, PlatformOrgs } from "../lib/types";
import { ROOT_PREVIEW } from "./previewData";

const SESSION_KEY = "lp_platform_key";
const ADMIN_SESSION_KEY = "lp_admin_key";

/*
 * 超级管理员控制台。只有业主一个人用，所以刻意做得比 /admin 朴素：
 * 一张表格 + 行内操作，没有左栏、没有子页面。
 */
export default function RootPage() {
  const [searchParams] = useSearchParams();
  const preview = searchParams.get("preview") === "1";
  const [platformKey, setPlatformKey] = useState<string | null>(() =>
    preview ? "preview" : sessionStorage.getItem(SESSION_KEY),
  );

  if (!platformKey) {
    return (
      <Login
        title="平台管理"
        admin
        onOk={(key) => { sessionStorage.setItem(SESSION_KEY, key); setPlatformKey(key); }}
      />
    );
  }
  return (
    <>
      {preview && <DemoRibbon label="平台管理演示 · 数据为示例" />}
      <RootConsole
        platformKey={platformKey}
        previewData={preview ? ROOT_PREVIEW : undefined}
        onLogout={() => { sessionStorage.removeItem(SESSION_KEY); setPlatformKey(null); }}
      />
    </>
  );
}

function RootConsole(props: {
  platformKey: string;
  previewData?: PlatformOrgs;
  onLogout: () => void;
}) {
  const { platformKey, previewData } = props;
  const navigate = useNavigate();
  const [data, setData] = useState<PlatformOrgs | null>(previewData ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (previewData) return;
    try {
      setData(await rpc<PlatformOrgs>("platform_orgs", { p_platform_key: platformKey }));
      setErr(null);
    } catch (error) { setErr(errorText(error)); }
  }, [platformKey, previewData]);

  useEffect(() => { void load(); }, [load]);

  async function impersonate(org: PlatformOrg) {
    if (previewData) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await rpc<ImpersonateResult>("platform_impersonate", {
        p_platform_key: platformKey,
        p_org_id: org.id,
      });
      sessionStorage.setItem(ADMIN_SESSION_KEY, result.token);
      navigate("/admin");
    } catch (error) {
      setErr(errorText(error));
    } finally { setBusy(false); }
  }

  const orgs = data?.orgs ?? [];

  return (
    <main className="mx-auto max-w-5xl px-5 py-8" style={{ background: T.bg, minHeight: "100vh" }}>
      <PageTitle
        eyebrow="PLATFORM"
        title="机构管理"
        description="所有使用本平台的机构。代入后你会以该机构管理员的身份进入 /admin，令牌 2 小时后失效。"
        actions={<Btn variant="quiet" onClick={props.onLogout}>退出</Btn>}
      />

      <div className="mb-4"><ErrorBanner text={err} /></div>

      <Panel>
        <PanelHead eyebrow="ORGANIZATIONS" title="机构列表" note={`共 ${orgs.length} 间`} />
        {orgs.length === 0 ? (
          <div className="p-5">
            <EmptyState title="还没有任何机构" detail="用右上角的「新建机构」开一间。" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: T.inkFaint }}>
                <th className="px-5 py-3 text-left font-black">机构</th>
                <th className="px-5 py-3 text-left font-black">slug</th>
                <th className="px-5 py-3 text-right font-black">场次</th>
                <th className="px-5 py-3 text-left font-black">最近一场</th>
                <th className="px-5 py-3 text-right font-black">操作</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <strong style={{ color: T.ink }}>{org.name_zh}</strong>
                      {org.has_live_event && (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-black"
                          style={{ background: T.goodSoft, color: T.good }}
                        >
                          进行中
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-semibold" style={{ color: T.inkFaint }}>{org.name_en}</div>
                  </td>
                  <td className="px-5 py-4"><code style={{ color: T.inkSoft }}>{org.slug}</code></td>
                  <td className="px-5 py-4 text-right font-black">{org.event_count}</td>
                  <td className="px-5 py-4" style={{ color: T.inkSoft }}>
                    {org.last_event_at ? org.last_event_at.slice(0, 10) : "—"}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Btn
                      variant="quiet"
                      disabled={busy || Boolean(previewData)}
                      onClick={() => void impersonate(org)}
                    >
                      代入
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </main>
  );
}
