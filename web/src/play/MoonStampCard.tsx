import { useCopy, useTheme } from "../theme/ThemeProvider";
import { RetryIcon, SecretIcon } from "../theme/StampIcons";
import { ConnDot } from "../lib/ui";
import type { PassportHeroProps, VisaPage } from "./Passport";

/*
 * 中秋主题的护照主面板：一轮圆月居中，本场的摊位印章位绕着它等角排开，
 * 从 12 点顺时针。版式照 design-previews/midautumn-mockup.html 的第二张手机。
 * 环的盒子按 320 × 330 设计，印章位用百分比定位，窄屏时整体缩放而不重排。
 */
const RING_W = 320;
const RING_H = 330;
const RING_R = 135;

type SlotState = VisaPage["state"];

// index.css 把 bg-card + border-* 的边框一律压成透明（给输入框用的），所以待盖的
// 印章位用 bg-white 铺底，虚线圈才画得出来。
const SLOT_TONE: Record<SlotState, { ring: string; pill: string; name: string }> = {
  passed: {
    ring: "border-pass bg-pass-soft text-pass",
    pill: "bg-pass text-card",
    name: "text-ink shadow-[0_0_0_1.5px_var(--color-pass)]",
  },
  failed: {
    ring: "border-fail bg-fail-soft text-fail",
    pill: "bg-fail text-card",
    name: "text-ink shadow-[0_0_0_1.5px_var(--color-fail)]",
  },
  retry: {
    ring: "border-dashed border-ink-dim bg-white text-ink-dim",
    pill: "bg-ink-dim text-card text-[9px]",
    name: "text-ink shadow-[0_0_0_1.5px_var(--color-line)]",
  },
  blank: {
    ring: "border-dashed border-line bg-white text-line",
    pill: "",
    name: "text-ink-dim shadow-[0_0_0_1.5px_var(--color-line)]",
  },
};

function slotPill(page: VisaPage): string | null {
  if (page.state === "passed") return `+${page.score}`;
  if (page.state === "failed") return "✕";
  if (page.state === "retry") return "再挑战";
  return null;
}

export function MoonStampCard(props: PassportHeroProps) {
  const copy = useCopy();
  const { stampIcons } = useTheme();
  const { player, pages } = props;
  const n = Math.max(pages.length, 1);
  const identity = player.identity ?? "solo";

  return (
    <>
      <div className="rise mx-auto mt-4 flex w-[calc(100%-2rem)] max-w-md items-center justify-between px-0.5" style={{ "--i": 0 } as React.CSSProperties}>
        <span className="text-[12px] font-extrabold text-ink-dim">
          {props.teamColorName ? `${props.teamColorName} · ` : ""}{copy.teamName[identity]}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-leaf-deep">
          <ConnDot online={props.online} />
          {props.online ? "已连接" : "重连中"}
        </span>
      </div>

      <section
        className="wave-edge rise mx-auto mt-3.5 w-[calc(100%-2rem)] max-w-md rounded-[28px] bg-card px-[18px] pt-[18px] shadow-[0_3px_0_var(--color-shadow-line)]"
        style={{ "--i": 1 } as React.CSSProperties}
        aria-label={`${copy.card} ${copy.lifeNoEn} ${player.code}`}
      >
        <div className="flex items-baseline justify-between">
          <b className="text-[17px] font-black text-ink">{copy.card}</b>
          <span className="tabular text-[11px] font-black tracking-[0.18em] text-ink-dim">
            {copy.lifeNoEn} {player.code}
          </span>
        </div>

        <div className="relative mx-auto mt-3.5 w-full max-w-[320px]" style={{ aspectRatio: `${RING_W} / ${RING_H}` }}>
          {/* 圆月：奶油黄，白边一圈，再套一圈队伍色。 */}
          <div
            className="absolute left-1/2 top-1/2 grid h-[150px] w-[150px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full px-3 text-center"
            style={{
              background:
                "radial-gradient(circle at 42% 40%, var(--color-stage-orb-light) 0 30%, var(--color-foil) 60%, var(--color-stage-orb-deep) 100%)",
              boxShadow: `0 0 0 6px var(--color-card), 0 0 0 11px ${props.teamColor}, 0 12px 30px rgb(from var(--color-ink) r g b / .15)`,
            }}
          >
            <div>
              <div className="break-words text-[24px] font-black leading-[1.1] text-moon">{player.name}</div>
              <div className="mt-[5px] text-[11px] font-black tracking-[0.16em] text-foil-dim">{copy.teamName[identity]}</div>
              <div className="tabular mt-1.5 text-[13px] font-black text-moon">
                已集 {player.stations_done} / {player.stations_total}
              </div>
            </div>
          </div>

          {/* 印章环：N 个摊位，从 12 点顺时针等角排开。 */}
          {pages.map((page, i) => {
            const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
            const x = 50 + ((Math.cos(angle) * RING_R) / RING_W) * 100;
            const y = 50 + ((Math.sin(angle) * RING_R) / RING_H) * 100;
            const Icon = page.state === "retry" ? RetryIcon : stampIcons[i % Math.max(stampIcons.length, 1)];
            const tone = SLOT_TONE[page.state];
            const pill = slotPill(page);
            const longName = page.title.length > 4;
            return (
              <div
                key={page.key}
                className={`absolute grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[2.5px] ${tone.ring}`}
                style={{ left: `${x}%`, top: `${y}%` }}
                role="img"
                aria-label={`${page.title}：${pill ?? "未挑战"}`}
              >
                {Icon && <Icon className="h-[30px] w-[30px]" />}
                {pill && (
                  <span className={`tabular absolute -right-[9px] -top-[7px] min-w-[26px] rounded-full px-1.5 py-px text-center text-[10.5px] font-black leading-[1.4] ${tone.pill}`}>
                    {pill}
                  </span>
                )}
                <span
                  className={`absolute left-1/2 top-[calc(100%+3px)] -translate-x-1/2 whitespace-nowrap rounded-full bg-card px-2 py-0.5 font-black ${longName ? "text-[9.5px]" : "text-[11px]"} ${tone.name}`}
                >
                  {page.title}
                </span>
              </div>
            );
          })}
        </div>

        {/* 第八枚：隐藏摊位盖过章才出现，放在环外、积分上方，不挤七个摊位的等角排布。 */}
        {props.secretDone && (
          <div className="mt-6 flex justify-center">
            <div
              className="relative grid h-14 w-14 place-items-center rounded-full border-[2.5px] border-accent-deep bg-accent-soft text-accent-deep"
              role="img"
              aria-label={`${copy.secretTeaser}：+6`}
            >
              <SecretIcon className="h-[30px] w-[30px]" />
              <span className="tabular absolute -right-[9px] -top-[7px] min-w-[26px] rounded-full bg-accent-deep px-1.5 py-px text-center text-[10.5px] font-black leading-[1.4] text-card">
                +6
              </span>
              <span className="absolute left-1/2 top-[calc(100%+3px)] -translate-x-1/2 whitespace-nowrap rounded-full bg-card px-2 py-0.5 text-[11px] font-black text-ink shadow-[0_0_0_1.5px_var(--color-accent-deep)]">
                {copy.secretTeaser}
              </span>
            </div>
          </div>
        )}

        <div className={`${props.secretDone ? "mt-9" : "mt-2"} flex items-baseline justify-center gap-2.5`} aria-label={`${copy.score} ${props.shownScore}`}>
          <span className="text-[12px] font-black tracking-[0.16em] text-ink-dim">{copy.score}</span>
          <b className="tabular text-[40px] font-black leading-none text-ink">{props.shownScore}</b>
        </div>
        {copy.cardTagline && <p className="mt-2 text-center text-[13px] font-bold text-ink-dim">{copy.cardTagline}</p>}
        {/* .wave-edge 的锯齿会吃掉底部 14px，这里留出余量让标语不被咬到。 */}
        <div className="h-3" />
      </section>
    </>
  );
}

/**
 * 候场页的集章卡：还没有一枚章，环上是本主题的摊位别名空位。
 * 和 MoonStampCard 同一套几何，只是没有分数、没有队伍色（颜色开场才揭晓）。
 */
export function MoonWaitingCard({ name, code, online }: { name: string; code: string; online: boolean }) {
  const copy = useCopy();
  const { stampIcons, boothNames } = useTheme();
  const slots = boothNames.length ? boothNames : Array.from({ length: 7 }, (_, i) => `${copy.station} ${i + 1}`);
  const n = slots.length;
  const tone = SLOT_TONE.blank;
  return (
    <section
      className="wave-edge rise mx-auto w-[calc(100%-2rem)] max-w-md rounded-[28px] bg-card px-[18px] pt-[18px] shadow-[0_3px_0_var(--color-shadow-line)]"
      aria-label={`${copy.card} ${copy.lifeNoEn} ${code}`}
    >
      <div className="flex items-baseline justify-between">
        <b className="text-[17px] font-black text-ink">{copy.card}</b>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-leaf-deep">
          <ConnDot online={online} />
          {online ? "已连接" : "重连中"}
        </span>
      </div>
      <div className="relative mx-auto mt-3.5 w-full max-w-[320px]" style={{ aspectRatio: `${RING_W} / ${RING_H}` }}>
        <div
          className="absolute left-1/2 top-1/2 grid h-[150px] w-[150px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full px-3 text-center"
          style={{
            background:
              "radial-gradient(circle at 42% 40%, var(--color-stage-orb-light) 0 30%, var(--color-foil) 60%, var(--color-stage-orb-deep) 100%)",
            boxShadow: "0 0 0 6px var(--color-card), 0 0 0 11px var(--color-line), 0 12px 30px rgb(from var(--color-ink) r g b / .15)",
          }}
        >
          <div>
            <div className="break-words text-[24px] font-black leading-[1.1] text-moon">{name}</div>
            <div className="mt-[5px] text-[11px] font-black tracking-[0.16em] text-foil-dim">{copy.lifeNoEn}</div>
            <div className="tabular mt-1 text-[26px] font-black leading-none text-moon">{code}</div>
          </div>
        </div>
        {slots.map((label, i) => {
          const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
          const x = 50 + ((Math.cos(angle) * RING_R) / RING_W) * 100;
          const y = 50 + ((Math.sin(angle) * RING_R) / RING_H) * 100;
          const Icon = stampIcons[i % Math.max(stampIcons.length, 1)];
          return (
            <div
              key={label + i}
              className={`absolute grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[2.5px] ${tone.ring}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              role="img"
              aria-label={`${label}：未挑战`}
            >
              {Icon && <Icon className="h-[30px] w-[30px]" />}
              <span className={`absolute left-1/2 top-[calc(100%+3px)] -translate-x-1/2 whitespace-nowrap rounded-full bg-card px-2 py-0.5 font-black ${label.length > 4 ? "text-[9.5px]" : "text-[11px]"} ${tone.name}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[13px] font-bold text-ink-dim">请截图保存编号 · 现场报分和找回都只用它</p>
      {copy.cardTagline && <p className="mt-1 text-center text-[12px] font-bold text-ink-dim/80">{copy.cardTagline}</p>}
      <div className="h-3" />
    </section>
  );
}
