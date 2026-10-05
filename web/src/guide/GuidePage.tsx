import { useEffect, useLayoutEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BrandMark, UpLink } from "../lib/ui";
import { useScrollMemory } from "../lib/useScrollMemory";
import {
  AWARDS_PERSONAL, AWARDS_TEAM, FAQ, FLOW, SCORING, SOP, type DemoLink,
} from "./guideContent";

/*
 * /guide — the page volunteers read before the event.
 *
 * LAYOUT: one centred column at every width, and nothing else. The first build
 * ran body copy across a 1024px container (~150 characters a line); the second
 * added a desktop-only sidebar rail, which put the section nav on a collision
 * course with the page's decorative circles and gave phones and laptops two
 * different structures to get wrong. There is now a single sticky header that
 * carries both the way out and the section list, and a single column under it
 * capped at a readable measure. Wide screens get margins, not a second layout.
 *
 * SCROLL MEMORY: every "看一下效果" link leaves for a real screen in demo mode,
 * and people come straight back. Returning to the top of a long page each time
 * made the demos annoying to walk through, so the scroll position is kept in
 * sessionStorage and restored on the way back.
 */

const SECTIONS = [
  { id: "what", label: "这是什么", short: "简介" },
  { id: "flow", label: "活动流程", short: "流程" },
  { id: "try", label: "试玩效果", short: "试玩" },
  { id: "rules", label: "规则与记分", short: "规则" },
  { id: "awards", label: "颁奖", short: "颁奖" },
  { id: "sop", label: "同工 SOP", short: "SOP" },
  { id: "faq", label: "常见问题", short: "问答" },
];

const SCROLL_KEY = "lp_guide_scroll";
const THEME_KEY = "lp_guide_theme";

/** 演示按钮能用哪些皮肤。第一个是默认，URL 上不写。 */
const PREVIEW_THEMES: Array<[id: string, label: string, note: string]> = [
  ["passport", "人生护照", "Glasgow 迎新会那套"],
  ["midautumn", "中秋游园会", "Soho 中秋派对那套"],
];
const DEFAULT_PREVIEW_THEME = PREVIEW_THEMES[0][0];

/** Shared measure. Everything on the page lines up on these two edges. */
const COLUMN = "mx-auto w-full max-w-[46rem] px-5 sm:px-7";

export default function GuidePage() {
  const active = useActiveSection(SECTIONS.map((section) => section.id));
  useScrollMemory(SCROLL_KEY);
  useRememberedPreviewTheme();

  return (
    /* No overflow-x here: any overflow value other than visible turns this into
       the scrollport for `position: sticky` descendants, which silently stopped
       the header below from sticking. The decorative layer clips itself. */
    <div className="relative min-h-dvh bg-desk text-ink">
      <div className="night-sky" />

      <div className="relative z-10">
        <TopBar active={active} />
        <Hero />
        <main className={COLUMN}>
          <WhatIsIt />
          <Flow />
          <TryItAll />
          <Rules />
          <Awards />
          <Sop />
          <Faq />
          <Footer />
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */

function TopBar({ active }: { active: string }) {
  return (
    <div
      className="sticky top-0 z-30 backdrop-blur-2xl"
      style={{
        background: "rgb(from var(--color-night) r g b / .88)",
        borderBottom: "1px solid rgb(from var(--color-accent-deep) r g b / .16)",
        boxShadow: "0 10px 32px rgb(from var(--color-accent-deep) r g b / .06)",
      }}
    >
      <div className={COLUMN}>
        <div className="flex min-h-[3.75rem] items-center gap-3 pt-[env(safe-area-inset-top)] text-ink">
          <UpLink label="入口" to="/" variant="icon" className="!h-10 !w-10 !bg-ink/[.06] !text-ink" />
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 grid-cols-2 gap-[3px] rounded-[9px] bg-white p-[5px] shadow-[0_2px_0_var(--color-foil-shadow)]" aria-hidden="true">
              <span className="rounded-[2px] bg-ink" />
              <span className="rounded-[2px] bg-seal-deep" />
              <span className="rounded-[2px] bg-foil" />
              <span className="rounded-[2px] bg-leaf" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-black leading-tight tracking-[-0.015em]">人生护照</span>
              <span className="block truncate text-[10px] font-bold leading-tight tracking-[0.12em] text-ink-dim">同工说明</span>
            </span>
          </div>
          <Link
            to="/library"
            className="pressable inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-white px-3.5 text-[13px] font-black text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
          >
            事件库
            <span aria-hidden="true" className="text-ink-dim">↗</span>
          </Link>
        </div>
        <nav aria-label="说明页章节" className="tool-scroll -mx-5 flex overflow-x-auto px-5 sm:-mx-7 sm:px-7">
          {SECTIONS.map((section, index) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={active === section.id ? "location" : undefined}
              className={`relative inline-flex min-h-10 shrink-0 items-center gap-1.5 px-3 text-[13px] font-black transition-colors sm:px-3.5 ${
                active === section.id ? "text-ink" : "text-ink-dim hover:text-ink"
              }`}
            >
              <span className="tabular text-[9px] font-black opacity-45">{String(index + 1).padStart(2, "0")}</span>
              {section.short}
              {active === section.id && (
                <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-foil sm:inset-x-3.5" />
              )}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <header className={`${COLUMN} pt-9 pb-2`}>
      <BrandMark className="!w-[80px] !gap-1 !rounded-[14px] !p-2" />
      <p className="mt-5 text-[11px] font-black tracking-[0.38em] text-foil-dim">
        CROWDPLAY · 同工说明
      </p>
      <h1 className="mt-2.5 text-[clamp(2rem,7.5vw,3.2rem)] font-black leading-[1.08] tracking-[-0.045em]">
        人生护照
        <br />
        是怎么跑起来的
      </h1>
      <p className="mt-4 text-[15px] font-semibold leading-7 text-ink-dim">
        一个 60 分钟的现场人生模拟游戏平台：约 50 人扫码入场，随机组成 Solo / Duo / Trio，
        一起闯 7 个站点，各自经历 3 段人生事件，最后在大屏上颁奖、在手机上生成纪念徽章。
      </p>
      <p className="mt-3 text-[15px] font-semibold leading-7 text-ink-dim">
        <b className="text-ink">下面所有深色按钮都可以直接点开真实界面</b>，
        用的是示例数据，不会影响任何真实活动。建议用手机打开。
      </p>
      <PreviewThemePicker />
      <div className="mt-6 flex flex-wrap gap-2">
        <a
          href="#try"
          className="pressable rounded-full bg-ink px-5 py-3 text-sm font-black text-white shadow-[0_3px_0_var(--color-ink-shadow)]"
        >
          直接开始试玩 ↓
        </a>
        <a
          href="#sop"
          className="pressable rounded-full bg-white px-5 py-3 text-sm font-black shadow-[0_2px_0_var(--color-foil-shadow)]"
        >
          我这个岗位怎么做
        </a>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ blocks */

function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 pt-12">
      <div className="text-[11px] font-black tracking-[0.26em] text-foil-dim">{eyebrow}</div>
      <h2 className="mt-1.5 text-[clamp(1.5rem,5vw,2.1rem)] font-black leading-[1.14] tracking-[-0.035em]">
        {title}
      </h2>
      {lede && <p className="mt-2.5 text-[14px] font-semibold leading-7 text-ink-dim">{lede}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Card({
  children,
  className = "",
  tone = "plain",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "plain" | "accent";
}) {
  return (
    <div
      className={`rounded-[18px] p-5 ${className}`}
      style={
        tone === "accent"
          ? { background: "var(--color-staff-accent-soft)", border: "1px solid var(--color-staff-accent-line)" }
          : { background: "var(--color-card)", border: "1px solid var(--color-line)" }
      }
    >
      {children}
    </div>
  );
}

function Body({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[13px] font-semibold leading-6 text-ink-dim ${className}`}>{children}</p>
  );
}

/** The one interactive affordance on this page: opens a real screen in demo mode. */
/** 手册里的演示按钮跟着页面上的「预览主题」走：选了中秋，所有演示都以中秋皮肤打开。 */
function usePreviewTheme(): [string, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = knownTheme(searchParams.get("theme"));
  const set = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === DEFAULT_PREVIEW_THEME) params.delete("theme"); else params.set("theme", next);
    // 记住这次浏览选了什么，见 useRememberedPreviewTheme。
    sessionStorage.setItem(THEME_KEY, next);
    setSearchParams(params, { replace: true });
  };
  return [current, set];
}

function knownTheme(value: string | null): string {
  return PREVIEW_THEMES.some(([id]) => id === value) ? value! : DEFAULT_PREVIEW_THEME;
}

/**
 * 选过的预览主题跟着这次浏览走，而不是跟着 URL。
 *
 * 演示屏幕上的「返回说明页」（还有事件库那两个入口）都只指向裸 /guide，
 * 回来时 ?theme= 就没了 —— 选了中秋的人每看完一个演示都被打回迎新主题，
 * 下一个演示又得重选。选择写进 sessionStorage，回到说明页时再接回 URL：
 * URL 仍然是唯一的真相，选中态和演示按钮都只读它。
 */
function useRememberedPreviewTheme() {
  const [searchParams, setSearchParams] = useSearchParams();
  // 布局阶段改回来，选中态不会先闪一帧默认主题。
  useLayoutEffect(() => {
    if (searchParams.has("theme")) return;
    const saved = knownTheme(sessionStorage.getItem(THEME_KEY));
    if (saved === DEFAULT_PREVIEW_THEME) return;
    const params = new URLSearchParams(searchParams);
    params.set("theme", saved);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);
}

function withTheme(href: string, theme: string): string {
  if (theme === DEFAULT_PREVIEW_THEME) return href;
  return `${href}${href.includes("?") ? "&" : "?"}theme=${theme}`;
}

function PreviewThemePicker() {
  const [theme, setTheme] = usePreviewTheme();
  return (
    <div className="mt-6 rounded-[18px] bg-white p-3 shadow-[0_2px_0_var(--color-foil-shadow)]" role="group" aria-label="演示用哪个主题">
      <p className="px-1 text-[11px] font-black tracking-[0.2em] text-ink-dim">预览主题 · 下面所有演示按钮都按它打开</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {PREVIEW_THEMES.map(([id, label, note]) => (
          <button
            key={id}
            type="button"
            aria-pressed={theme === id}
            onClick={() => setTheme(id)}
            className={`pressable rounded-[14px] px-3 py-2.5 text-left ${theme === id ? "bg-ink text-white" : "bg-night-raise text-ink"}`}
          >
            <span className="block text-[13px] font-black">{label}</span>
            <span className={`block text-[11px] font-semibold ${theme === id ? "opacity-70" : "text-ink-dim"}`}>{note}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DemoButton({ demo }: { demo: DemoLink }) {
  const [theme] = usePreviewTheme();
  return (
    <Link
      to={withTheme(demo.href, theme)}
      className="pressable group flex w-full items-center gap-3 rounded-[14px] px-4 py-3.5 text-left"
      style={{ background: "var(--color-ink)", color: "var(--color-card)" }}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/12 text-xl">
        {demo.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-black leading-snug">
          {demo.title}
          {demo.phone && <span className="ml-1.5 text-[10px] font-bold opacity-55">手机</span>}
        </span>
        <span className="mt-0.5 block text-[11px] font-semibold leading-4 opacity-65">
          {demo.detail}
        </span>
      </span>
      <span className="shrink-0 text-lg opacity-55 transition-transform group-hover:translate-x-0.5">→</span>
    </Link>
  );
}

/* ---------------------------------------------------------------- sections */

const PILLARS = [
  {
    emoji: "🎫",
    title: "每人一本电子护照",
    body: "扫码填名字就领到 3 位人生编号 —— 全程只有这一个号码。护照上有自己的总分、7 站盖章、3 段人生大事记，header 是自己队伍的颜色。",
  },
  {
    emoji: "🤝",
    title: "一起闯关，各自人生",
    body: "站点结果属于队伍：工作人员录一次，每位队员加同样的分。人生事件属于个人：只改变本人的分数。所以同队的人分数会分岔。",
  },
  {
    emoji: "🎨",
    title: "队友靠颜色找",
    body: "开局时每人的手机整屏亮起队伍颜色，举手机找到同色的人就是队友。没有队伍码要记，大屏上同队的人也相邻排列。",
  },
  {
    emoji: "🖥️",
    title: "大屏是现场心跳",
    body: "候场时显示二维码和名牌墙，进行中显示每个人的进度和实时播报，结束后自动变成颁奖典礼。不需要密码，可以放心投屏。",
  },
];

const PAGES: Array<[string, string, string]> = [
  ["/play", "玩家", "扫码入场、身份揭晓、护照、人生事件、结算"],
  ["/staff", "站点工作人员", "识别整队、录一次结果、Token 与纪念卡"],
  ["/admin", "后台", "机构层看全部活动；点进某一场才是总控、玩家、站点、本场设置"],
  ["/screen", "投影大屏", "无需密码：候场、进行中播报、结束后颁奖"],
  ["/library", "内容审核", "全部 30 个人生场景、60 个行动、180 个随机结果"],
];

function WhatIsIt() {
  return (
    <Section
      id="what"
      eyebrow="OVERVIEW"
      title="四句话说清这个平台"
      lede="技术上它是一个网页 + 一个数据库，没有独立后端；现场只需要一台接投影的笔记本，和每位同工自己的手机。"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {PILLARS.map((pillar) => (
          <Card key={pillar.title}>
            <div className="text-2xl">{pillar.emoji}</div>
            <h3 className="mt-2.5 text-[16px] font-black">{pillar.title}</h3>
            <Body className="mt-1.5">{pillar.body}</Body>
          </Card>
        ))}
      </div>

      <Card tone="accent" className="mt-3">
        <h3 className="text-[15px] font-black">五个页面，各管一件事</h3>
        <div className="mt-3 space-y-2.5">
          {PAGES.map(([path, who, what]) => (
            <div key={path} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13px]">
              <code className="rounded-md bg-white px-2 py-0.5 font-mono text-[12px] font-black">{path}</code>
              <span className="font-black">{who}</span>
              <span className="font-semibold text-ink-dim">{what}</span>
            </div>
          ))}
        </div>
      </Card>
    </Section>
  );
}

function Flow() {
  return (
    <Section
      id="flow"
      eyebrow="RUN OF SHOW"
      title="活动流程"
      lede="从投屏到颁奖，一共八个节点。每个节点都标了谁负责，大部分可以直接点开看效果。"
    >
      <ol className="space-y-3">
        {FLOW.map((step, index) => (
          <li key={step.title}>
            <Card>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span
                  className="tabular grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[13px] font-black"
                  style={{ background: "var(--color-accent)", color: "var(--color-ink)" }}
                >
                  {index + 1}
                </span>
                <span className="rounded-md bg-night-raise px-2 py-0.5 text-[11px] font-black">{step.time}</span>
                <h3 className="text-[16px] font-black">{step.title}</h3>
              </div>
              <div className="mt-2 text-[11px] font-black tracking-[0.06em] text-foil-dim">{step.who}</div>
              <Body className="mt-2">{step.body}</Body>
              {step.demo && (
                <div className="mt-3.5">
                  <DemoButton demo={step.demo} />
                </div>
              )}
            </Card>
          </li>
        ))}
      </ol>
    </Section>
  );
}

const ALL_DEMOS: Array<{ group: string; note: string; items: DemoLink[] }> = [
  {
    group: "玩家手机",
    note: "建议用手机打开",
    items: [
      { href: "/play?preview=join", title: "扫码入场 · 领编号", detail: "填姓名 → 领编号 → 候场区，可以真的走一遍", emoji: "📝", phone: true },
      { href: "/play?preview=reveal-solo", title: "身份揭晓 · Solo", detail: "独行色，无需组队", emoji: "🟫", phone: true },
      { href: "/play?preview=reveal-duo", title: "身份揭晓 · Duo", detail: "整屏颜色，举手机找 1 位同色队友", emoji: "🟧", phone: true },
      { href: "/play?preview=reveal", title: "身份揭晓 · Trio", detail: "举手机找 2 位同色队友", emoji: "🟦", phone: true },
      { href: "/play?preview=passport", title: "人生护照", detail: "队伍色 header + 里程碑进度条 + 七站盖章", emoji: "🎫", phone: true },
      { href: "/play?preview=lock", title: "人生事件（完整三屏）", detail: "整屏通知 → 两个行动 → 随机结果", emoji: "🎲", phone: true },
      { href: "/play?preview=sick", title: "带状态效果的护照", detail: "「重感冒卧床」这类临时限制怎么显示", emoji: "🤒", phone: true },
      { href: "/play?preview=ended-hold", title: "结算页 · 排名未公布", detail: "颁奖进行中：有总分，没名次，徽章入口关着", emoji: "🙈", phone: true },
      { href: "/play?preview=ended", title: "结算页 · 排名已公布", detail: "最终分数、全场名次、共同走过的队友", emoji: "🏁", phone: true },
      { href: "/badge?preview=1", title: "纪念徽章分享图", detail: "1080×1920，可长按保存或下载 PNG", emoji: "🖼️", phone: true },
    ],
  },
  {
    group: "投影大屏",
    note: "建议用电脑打开并全屏",
    items: [
      { href: "/screen?preview=lobby", title: "候场画面", detail: "入场二维码 + 到场人数 + 名牌墙轮播", emoji: "🖥️" },
      { href: "/screen?preview=1", title: "进行中", detail: "按队伍排列的进度板 + 实时播报 + 找回二维码", emoji: "📊" },
      { href: "/screen?preview=awards", title: "颁奖典礼", detail: "1 个队伍奖 + 3 个个人奖 + 前三名", emoji: "🏆" },
      { href: "/screen?preview=ended", title: "最终总榜", detail: "颁奖结束后的排名画面（可重播颁奖）", emoji: "📋" },
    ],
  },
  {
    group: "同工工具",
    note: "演示模式，不会写入数据",
    items: [
      { href: "/staff?preview=1", title: "工作人员界面", detail: "站点选择、识别整队、录分、恩典站", emoji: "✅", phone: true },
      { href: "/admin?preview=1", title: "管理后台", detail: "机构层的全部活动列表；进入某一场后才有现场总控、玩家护照", emoji: "🎛️" },
      { href: "/library", title: "人生事件库（可审核）", detail: "30 个场景的全部选项、随机结果、概率与分数", emoji: "📚" },
    ],
  },
];

function TryItAll() {
  return (
    <Section
      id="try"
      eyebrow="TRY IT"
      title="试玩全部效果"
      lede="下面每一个都是真实页面，只是喂了示例数据。点进去随便按，按坏了也没关系 —— 它读不到也写不了任何真实活动的数据。每个演示页面最顶上有一条「演示预览」提示，点「返回说明页」就回到这里，而且会停在你刚看到的位置。"
    >
      <div className="space-y-7">
        {ALL_DEMOS.map((group) => (
          <div key={group.group}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[17px] font-black">{group.group}</h3>
              <span className="text-[11px] font-bold text-ink-dim">{group.note}</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {group.items.map((item) => (
                <DemoButton key={item.href + item.title} demo={item} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Rules() {
  return (
    <Section
      id="rules"
      eyebrow="RULES & SCORING"
      title="规则与记分"
      lede="一句话：一起闯关，共享挑战结果；各自经历人生，保留个人结局。"
    >
      <Card>
        <h3 className="text-[16px] font-black">站点计分</h3>
        <Body className="mt-1.5">
          工作人员为整队选一次结果，每位队员加上相同的分。一支队伍一站只录一次。
        </Body>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SCORING.stations.map((tier) => (
            <div key={tier.label} className="rounded-[12px] bg-night-raise px-3 py-3 text-center">
              <div className="tabular text-[1.4rem] font-black leading-none">{tier.label}</div>
              <div className="mt-1.5 text-[11px] font-bold leading-4 text-ink-dim">{tier.note}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card tone="accent" className="mt-3">
        <h3 className="text-[16px] font-black">三段人生：分数或站数，先到者算</h3>
        <div className="mt-4 space-y-2">
          {[
            { stage: "第一段", score: "15 分", station: "第 3 站" },
            { stage: "第二段", score: "35 分", station: "第 5 站" },
            { stage: "第三段", score: "45 分", station: "第 7 站" },
          ].map((row) => (
            <div key={row.stage} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-black">
              <span className="w-[3.4rem] shrink-0">{row.stage}</span>
              <span className="rounded-md bg-white px-2.5 py-1">{row.score}</span>
              <span className="text-ink-dim">或</span>
              <span className="rounded-md bg-white px-2.5 py-1">{row.station}</span>
              <span className="text-[11px] font-bold text-ink-dim">先到即触发</span>
            </div>
          ))}
        </div>
        <Body className="mt-4">
          分数冲得快的人会早触发，分数低的人也不会漏掉 —— 每人恰好三段，
          最后一段一定落在七站跑完之后。护照上的进度条就是 7 站 + 3 段 = 10 个里程碑。
        </Body>
        <div className="mt-4">
          <DemoButton
            demo={{ href: "/play?preview=lock", title: "亲自走一次人生事件", detail: "通知 → 选择 → 随机结果，每屏都要点一下", emoji: "🎲", phone: true }}
          />
        </div>
      </Card>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {SCORING.rules.map((rule) => (
          <Card key={rule.title}>
            <h3 className="text-[15px] font-black">{rule.title}</h3>
            <Body className="mt-1.5">{rule.body}</Body>
          </Card>
        ))}
      </div>

      <Card className="mt-3">
        <h3 className="text-[15px] font-black">全部人生事件都可以提前审核</h3>
        <Body className="mt-1.5">
          30 个场景、每个场景 2 个行动、每个行动 3 个随机结果，连出现概率和分数影响都列出来了。
          玩家端永远看不到这张表 —— 结果是服务器抽的。
        </Body>
        <div className="mt-3.5">
          <DemoButton
            demo={{ href: "/library", title: "打开人生事件库", detail: "可搜索、可按人数筛选，一页读完全部内容", emoji: "📚" }}
          />
        </div>
      </Card>
    </Section>
  );
}

function Awards() {
  return (
    <Section
      id="awards"
      eyebrow="CEREMONY"
      title="结束后的颁奖"
      lede="游戏进行中大屏刻意不排名次，所以颁奖是全场第一次知道结果。一共 7 个奖，同一个人不会被叫上台两次；指标不成立的奖项（比如全场没人扣过分）由备选补上，备选也没人就少发。"
    >
      <AwardGroup
        badge="个人奖"
        note="个人奖最多 3 个，只发给还没上过台的人"
        items={AWARDS_PERSONAL}
      />
      <div className="mt-6">
        <AwardGroup
          badge="队伍奖"
          note="只有一个。站点是整队录一次分，所以队伍之间唯一不重复的指标是「谁先跑完」；已经上领奖台的队跳过"
          items={AWARDS_TEAM}
          tone="accent"
        />
      </div>
      <div className="mt-4">
        <DemoButton
          demo={{ href: "/screen?preview=awards", title: "看完整颁奖典礼", detail: "← → 翻页 · 空格前进 · P 暂停 · Esc 跳到总榜", emoji: "🏆" }}
        />
      </div>
    </Section>
  );
}

function AwardGroup({
  badge,
  note,
  items,
  tone = "plain",
}: {
  badge: string;
  note: string;
  items: Array<{ emoji: string; title: string; note: string }>;
  tone?: "plain" | "accent";
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className="rounded-md px-2 py-0.5 text-[11px] font-black"
          style={tone === "accent" ? { background: "var(--color-admin-warn-soft)", color: "var(--color-guide-accent-ink)" } : { background: "var(--color-ink)", color: "var(--color-card)" }}
        >
          {badge}
        </span>
        <span className="text-[11px] font-semibold leading-5 text-ink-dim">{note}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((award) => (
          <div
            key={award.title}
            className="flex items-center gap-3 rounded-[14px] bg-white px-4 py-3"
            style={{ border: "1px solid var(--color-line)" }}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-night-raise text-xl">
              {award.emoji}
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-black">{award.title}</div>
              <div className="text-[11px] font-semibold leading-4 text-ink-dim">{award.note}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sop() {
  const [open, setOpen] = useState<string | null>(SOP[0].role);
  return (
    <Section
      id="sop"
      eyebrow="STANDARD OPERATING PROCEDURE"
      title="同工 SOP"
      lede="按岗位分开写。点开自己那一栏，活动当天照着做就行。每一栏最后一句是「最容易出错的地方」，请一定读。"
    >
      <div className="space-y-2">
        {SOP.map((role) => {
          const isOpen = open === role.role;
          return (
            <div
              key={role.role}
              className="overflow-hidden rounded-[18px]"
              style={{ background: "var(--color-card)", border: "1px solid var(--color-line)" }}
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : role.role)}
                className="flex w-full items-center gap-3 px-4 py-4 text-left"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-night-raise text-xl">
                  {role.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-black">{role.role}</span>
                  <span className="block text-[11px] font-semibold text-ink-dim">{role.who}</span>
                </span>
                <span className="shrink-0 text-xl text-ink-dim">{isOpen ? "−" : "+"}</span>
              </button>

              {isOpen && (
                <div className="px-4 pb-5">
                  <SopList label="活动前" items={role.before} />
                  <SopList label="活动中" items={role.during} />
                  <div
                    className="mt-4 rounded-[12px] px-4 py-3"
                    style={{ background: "var(--color-admin-danger-soft)", border: "1px solid var(--color-staff-danger-line)" }}
                  >
                    <div className="text-[11px] font-black tracking-[0.14em] text-seal">最容易出错的地方</div>
                    <p className="mt-1 text-[13px] font-bold leading-6">{role.gotcha}</p>
                  </div>
                  {role.demo && (
                    <div className="mt-3">
                      <DemoButton demo={role.demo} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SopList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-4">
      <div className="text-[11px] font-black tracking-[0.16em] text-foil-dim">{label}</div>
      <ul className="mt-2 space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2.5">
            <span
              className="tabular mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-black"
              style={{ background: "var(--color-night-raise)", color: "var(--color-accent-deep)" }}
            >
              {index + 1}
            </span>
            <span className="text-[13px] font-semibold leading-6 text-ink-dim">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Faq() {
  return (
    <Section id="faq" eyebrow="FAQ" title="常见问题" lede="活动当天最常被问到的几件事。">
      <div className="space-y-2">
        {FAQ.map((item) => (
          <Card key={item.q}>
            <h3 className="text-[15px] font-black">{item.q}</h3>
            <Body className="mt-1.5">{item.a}</Body>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="mt-14 mb-16 rounded-[22px] px-6 py-8 text-center" style={{ background: "var(--color-ink)", color: "var(--color-card)" }}>
      <p className="text-[11px] font-black tracking-[0.32em]" style={{ color: "var(--color-accent)" }}>
        CROWDPLAY
      </p>
      <p className="mt-4 text-[clamp(1.25rem,5vw,1.7rem)] font-black leading-tight tracking-[-0.03em]">
        「我的恩典够你用的」
      </p>
      <p className="mt-2 text-[12px] font-semibold opacity-65">哥林多后书 12:9</p>
      <p className="mt-5 text-[15px] font-black" style={{ color: "var(--color-accent)" }}>
        You don't have to do life alone
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Link to="/" className="pressable rounded-full bg-white/12 px-5 py-2.5 text-sm font-black">
          回到入口
        </Link>
        <a href="#try" className="pressable rounded-full bg-white px-5 py-2.5 text-sm font-black text-ink">
          再试玩一次
        </a>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------- hooks */

/** Highlights the section nearest the top of the viewport. */
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-18% 0px -70% 0px", threshold: 0 },
    );
    ids.forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [ids]);
  return active;
}
