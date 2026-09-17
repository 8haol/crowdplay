import type { ReactNode } from "react";
import type { AdminConsoleData } from "../lib/types";
import { screenUrl } from "../lib/gameLinks";
import { ChromeDivider, ConnDot, UpLink } from "../lib/ui";
import { AdminIcon, Panel, PhaseLabel } from "./adminUi";
import { T } from "./adminTokens";
import type { NavItem } from "./adminUtils";

/*
 * 两层外壳共用的顶栏、左侧栏和骨架屏。
 *
 * 抽出来是因为机构层和活动层的 chrome 长得一样，只是导航项和顶栏内容不同；
 * 复制一份的话，以后调间距就得改两处。SideNav 因此是泛型的：它不认识
 * OrgSection / EventSection，只认识「一串有 id / label / icon / note 的项」。
 */

export function TopBar({
  online,
  session,
  context,
  phase,
  screenToken,
  onLogout,
  onMenu,
}: {
  online: boolean;
  session?: string;
  /** 活动层传机构名：顶栏读作「机构 › 这一场」，一眼看得出自己在某一场里面。 */
  context?: string;
  phase?: AdminConsoleData["current"]["phase"];
  /** 这一场的投影令牌；顶栏那个链接开的是这一场的大屏。机构层不传——大屏属于某一场。 */
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
              {context && (
                <>
                  <span className="hidden truncate text-sm font-semibold sm:inline" style={{ color: T.inkFaint }}>
                    {context}
                  </span>
                  <span className="hidden shrink-0 text-sm font-semibold sm:inline" style={{ color: T.inkFaint }}>›</span>
                </>
              )}
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
          {screenToken && (
            <a
              href={screenUrl(screenToken)}
              target="_blank"
              rel="noreferrer"
              className="pressable hidden items-center gap-2 rounded-lg px-3 py-2 text-xs font-black sm:inline-flex"
              style={{ background: "#fff", border: `1px solid #d9cebc` }}
            >
              <AdminIcon name="screen" className="h-4 w-4" />
              实况大屏
            </a>
          )}
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

export function SideNav<T extends string>({
  items,
  current,
  open,
  badges,
  header,
  footer,
  tone = "paper",
  onNavigate,
  onDismiss,
}: {
  items: Array<NavItem<T>>;
  current: T;
  open: boolean;
  /*
   * 两层最容易混淆的地方就是这条侧栏，所以两层给它两种材质：机构层是桌面
   * 本身（纸色，与页面连成一片），活动层是从抽屉里抽出来的那一份档案（墨色，
   * 选中项翻成白纸）。颜色都来自既有的 token，不引入新的品牌色。
   */
  tone?: "paper" | "ink";
  badges?: Partial<Record<T, number>>;
  /** 活动层用它显示「这是哪一场」，机构层不传。 */
  header?: ReactNode;
  footer?: ReactNode;
  onNavigate: (next: T) => void;
  onDismiss: () => void;
}) {
  const ink = tone === "ink";
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-20 bg-[#211d18]/40 lg:hidden"
          onClick={onDismiss}
          role="presentation"
        />
      )}
      <nav
        className={`fixed inset-y-0 left-0 z-30 w-[17rem] shrink-0 overflow-y-auto px-3 pb-6 pt-[76px] transition-transform lg:sticky lg:top-[62px] lg:z-0 lg:h-[calc(100dvh-62px)] lg:translate-x-0 lg:pt-5 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={
          ink
            ? { background: T.rail, borderRight: "1px solid #14110d" }
            : { background: T.bg, borderRight: `1px solid #ded4c3` }
        }
      >
        {header && <div className="mb-4">{header}</div>}

        <div className="space-y-0.5">
          {items.map((item) => {
            const active = current === item.id;
            const badge = badges?.[item.id] ?? 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className="pressable flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                style={
                  active
                    ? ink
                      ? { background: "#fff", color: T.ink }
                      : { background: T.ink, color: "#fff" }
                    : { background: "transparent", color: ink ? "rgba(255,255,255,.86)" : T.ink }
                }
              >
                <AdminIcon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black">{item.label}</span>
                  <span
                    className="block truncate text-[11px] font-semibold"
                    style={{
                      color: active
                        ? ink ? T.inkFaint : "rgba(255,255,255,.62)"
                        : ink ? "rgba(255,255,255,.58)" : T.inkFaint,
                    }}
                  >
                    {item.note}
                  </span>
                </span>
                {badge > 0 && (
                  <span
                    className="tabular shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black"
                    style={
                      active
                        ? ink
                          ? { background: T.accentSoft, color: T.warn }
                          : { background: "rgba(255,255,255,.2)", color: "#fff" }
                        : ink
                          ? { background: "rgba(255,255,255,.16)", color: "#fff" }
                          : { background: T.accentSoft, color: T.warn }
                    }
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {footer && (
          <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${ink ? "rgba(255,255,255,.14)" : T.line}` }}>
            {footer}
          </div>
        )}
      </nav>
    </>
  );
}

export function ConsoleSkeleton() {
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

/** 两层共用的"读不出来"卡片。 */
export function ShellError({
  title,
  detail,
  actions,
}: {
  title: string;
  detail: string;
  actions: ReactNode;
}) {
  return (
    <div className="grid min-h-[75dvh] place-items-center p-6">
      <Panel className="max-w-md p-7 text-center">
        <span
          className="mx-auto grid h-12 w-12 place-items-center rounded-xl text-xl font-black"
          style={{ background: T.dangerSoft, color: T.danger }}
        >
          !
        </span>
        <h1 className="mt-4 text-xl font-black">{title}</h1>
        <p className="mt-2 text-sm font-semibold" style={{ color: T.inkSoft }}>{detail}</p>
        <div className="mt-5 flex justify-center gap-2">{actions}</div>
      </Panel>
    </div>
  );
}
