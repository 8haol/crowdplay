import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Login } from "../staff/StaffPage";
import { DemoRibbon } from "../lib/DemoRibbon";
import { ErrorBanner, SuccessBanner } from "../lib/ui";
import { Btn, EmptyState, PageTitle, Panel, PanelHead } from "../admin/adminUi";
import { T } from "../admin/adminTokens";
import { rpc, errorText } from "../lib/api";
import type { ImpersonateResult, PlatformOrg, PlatformOrgs } from "../lib/types";
import { ROOT_PREVIEW } from "./previewData";
import { AlbumQuotaDialog, DeleteOrgDialog, NewOrgDialog, RenameOrgDialog, ResetKeyDialog } from "./RootDialogs";
import { formatUsage } from "../admin/adminUtils";

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
        verify={(key) => rpc("platform_orgs", { p_platform_key: key })}
        eyebrow="LIFE PASSPORT · PLATFORM"
        hint="这是平台口令，只有你自己知道 —— 你就是总控"
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
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!previewData);
  // 哪些行的口令当前是明文可见的——只存在这个组件里，刷新页面就清空，
  // 且每一行独立：点开一间机构的口令不会连带把别家也显出来。
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(new Set());
  function toggleRevealed(orgId: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId); else next.add(orgId);
      return next;
    });
  }
  const [dialog, setDialog] = useState<
    | { kind: "new" }
    | { kind: "rename"; org: PlatformOrg }
    | { kind: "reset"; org: PlatformOrg }
    | { kind: "delete"; org: PlatformOrg }
    | { kind: "quota"; org: PlatformOrg }
    | null
  >(null);

  // 组件卸载后，这次请求的收尾要变成空操作——否则 setState 落在已卸载的组件上。
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  // 用 .then(onFulfilled, onRejected) 而不是 async/await 包 try/catch：
  // oxlint 的 set-state-in-effect 规则分析不了「await 一定会让出这一轮同步执行」，
  // 只要 try/catch 包住了 await，它就当作 setState 可能同步发生在 effect 里而报警；
  // 纯 Promise 链没有这个误判。cancelledRef 保证组件卸载后回调是空操作。
  const load = useCallback(() => {
    if (previewData) return;
    rpc<PlatformOrgs>("platform_orgs", { p_platform_key: platformKey })
      .then(
        (result) => {
          if (cancelledRef.current) return;
          setData(result);
          setErr(null);
        },
        (error) => {
          if (cancelledRef.current) return;
          setErr(errorText(error));
        },
      )
      .finally(() => {
        if (!cancelledRef.current) setLoading(false);
      });
  }, [platformKey, previewData]);

  useEffect(() => { load(); }, [load]);

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

  // 弹窗成功后统一走这里：关弹窗、报喜、重拉列表。
  function finishDialog(message: string) {
    setDialog(null);
    setOk(message);
    load();
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-8" style={{ background: T.bg, minHeight: "100vh" }}>
      <PageTitle
        eyebrow="PLATFORM"
        title="机构管理"
        description="所有使用本平台的机构。代入后你会以该机构管理员的身份进入 /admin，令牌长期有效，直到你再次代入或该机构被删除。"
        actions={
          <>
            <Btn variant="primary" disabled={Boolean(previewData)} onClick={() => setDialog({ kind: "new" })}>
              新建机构
            </Btn>
            <Btn variant="quiet" onClick={props.onLogout}>退出</Btn>
          </>
        }
      />

      <div className="mb-4 space-y-3">
        <ErrorBanner text={err} />
        <SuccessBanner text={ok} />
      </div>

      <Panel>
        <PanelHead eyebrow="ORGANIZATIONS" title="机构列表" note={`共 ${orgs.length} 间`} />
        {loading ? (
          <div className="p-5 text-sm font-semibold" style={{ color: T.inkFaint }}>
            正在加载机构列表…
          </div>
        ) : err && !data ? null : orgs.length === 0 ? (
          <div className="p-5">
            <EmptyState title="还没有任何机构" detail="用右上角的「新建机构」开一间。" />
          </div>
        ) : (
          /* 加了「口令」一列之后，窄一点的笔记本上四个操作按钮会被压得逐字换行。
             让表格自己横向滚动，而不是把每一列都挤扁。 */
          <div className="overflow-x-auto">
          <table className="w-full min-w-[62rem] text-sm">
            <thead>
              <tr style={{ color: T.inkFaint }}>
                <th className="px-5 py-3 text-left font-black">机构</th>
                <th className="px-5 py-3 text-left font-black">slug</th>
                <th className="px-5 py-3 text-left font-black">口令</th>
                <th className="whitespace-nowrap px-5 py-3 text-right font-black">场次</th>
                <th className="whitespace-nowrap px-5 py-3 text-left font-black">最近一场</th>
                <th className="whitespace-nowrap px-5 py-3 text-left font-black">相册</th>
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
                  <td className="px-5 py-4">
                    {org.admin_key_plain == null ? (
                      <span className="text-xs font-semibold" style={{ color: T.inkFaint }}>
                        未知（需「重置口令」才能显示）
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <code style={{ color: T.inkSoft }}>
                          {revealedIds.has(org.id) ? org.admin_key_plain : "••••••"}
                        </code>
                        <button
                          type="button"
                          className="pressable text-xs font-black underline underline-offset-2"
                          style={{ color: T.inkFaint }}
                          onClick={() => toggleRevealed(org.id)}
                        >
                          {revealedIds.has(org.id) ? "隐藏" : "显示"}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right font-black">{org.event_count}</td>
                  <td className="px-5 py-4" style={{ color: T.inkSoft }}>
                    {org.last_event_at ? org.last_event_at.slice(0, 10) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    {org.album_quota_bytes == null ? (
                      <span style={{ color: T.inkFaint }}>—</span>
                    ) : (
                      <button
                        type="button"
                        className="pressable tabular text-sm font-black underline decoration-dotted underline-offset-4 disabled:cursor-not-allowed disabled:no-underline"
                        style={{
                          color: (org.album_used_bytes ?? 0) > org.album_quota_bytes * 0.8 ? T.warn : T.inkSoft,
                        }}
                        disabled={busy || Boolean(previewData)}
                        title="点击修改相册额度"
                        onClick={() => setDialog({ kind: "quota", org })}
                      >
                        相册 {formatUsage(org.album_used_bytes ?? 0, org.album_quota_bytes)}
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex justify-end gap-2 whitespace-nowrap">
                      <Btn
                        variant="quiet"
                        disabled={busy || Boolean(previewData)}
                        onClick={() => setDialog({ kind: "rename", org })}
                      >
                        改名
                      </Btn>
                      <Btn
                        variant="quiet"
                        disabled={busy || Boolean(previewData)}
                        onClick={() => setDialog({ kind: "reset", org })}
                      >
                        重置口令
                      </Btn>
                      <Btn
                        variant="danger"
                        disabled={busy || Boolean(previewData)}
                        onClick={() => setDialog({ kind: "delete", org })}
                      >
                        删除
                      </Btn>
                      <Btn
                        variant="quiet"
                        disabled={busy || Boolean(previewData)}
                        onClick={() => void impersonate(org)}
                      >
                        代入
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Panel>

      {dialog?.kind === "new" && (
        <NewOrgDialog
          platformKey={platformKey}
          onClose={() => setDialog(null)}
          onDone={finishDialog}
        />
      )}
      {dialog?.kind === "rename" && (
        <RenameOrgDialog
          platformKey={platformKey}
          org={dialog.org}
          onClose={() => setDialog(null)}
          onDone={finishDialog}
        />
      )}
      {dialog?.kind === "reset" && (
        <ResetKeyDialog
          platformKey={platformKey}
          org={dialog.org}
          onClose={() => setDialog(null)}
          onDone={finishDialog}
        />
      )}
      {dialog?.kind === "quota" && (
        <AlbumQuotaDialog
          platformKey={platformKey}
          org={dialog.org}
          onClose={() => setDialog(null)}
          onDone={finishDialog}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteOrgDialog
          platformKey={platformKey}
          org={dialog.org}
          onClose={() => setDialog(null)}
          onDone={finishDialog}
        />
      )}
    </main>
  );
}
