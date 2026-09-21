import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardAwards, Identity, PodiumEntry, SpecialAward, TeamAward } from "../lib/types";
import { IDENTITY_SHORT, colorOf, soloColor } from "../lib/types";
import { darken, readableOn } from "../lib/color";

/*
 * Closing ceremony for the projector. The room has just spent an hour without a
 * live leaderboard, so this is the first time anyone learns where they placed:
 * it runs one full-screen slide at a time, bottom-up, and finishes on the
 * champion. Auto-advances, but the host can drive it with the arrow keys or by
 * clicking, and can bail out to the final standings at any point.
 */

const SLIDE_MS = 7000;
const PODIUM_MS = 9000;

type Slide =
  | { kind: "intro"; players: number }
  | { kind: "team"; award: TeamAward }
  | { kind: "special"; award: SpecialAward }
  | { kind: "podium"; entry: PodiumEntry }
  | { kind: "outro" };

/*
 * Running order: team awards for the station run, then the personal specials,
 * then the podium climbing from third to first. The podium is deliberately last
 * and deliberately individual — a Solo player has to be able to win it, which is
 * why nothing here is decided by a combined team score.
 */
function buildSlides(awards: BoardAwards, players: number): Slide[] {
  const slides: Slide[] = [{ kind: "intro", players }];
  (awards.team_awards ?? []).forEach((award) => slides.push({ kind: "team", award }));
  awards.specials.forEach((award) => slides.push({ kind: "special", award }));
  [...awards.podium].sort((a, b) => b.rank - a.rank).forEach((entry) => slides.push({ kind: "podium", entry }));
  slides.push({ kind: "outro" });
  return slides;
}

export default function Ceremony({
  awards,
  players,
  stationsTotal,
  onFinish,
}: {
  awards: BoardAwards;
  players: number;
  /** Main stations this event actually ran — the podium counts out of it. */
  stationsTotal: number;
  onFinish: () => void;
}) {
  const slides = useMemo(() => buildSlides(awards, players), [awards, players]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const slide = slides[Math.min(index, slides.length - 1)];

  const next = useCallback(() => {
    setIndex((current) => {
      if (current >= slides.length - 1) {
        onFinish();
        return current;
      }
      return current + 1;
    });
  }, [onFinish, slides.length]);

  const back = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(next, slide.kind === "podium" ? PODIUM_MS : SLIDE_MS);
    return () => clearTimeout(timer);
  }, [index, next, paused, slide.kind]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter") { event.preventDefault(); next(); }
      if (event.key === "ArrowLeft") back();
      if (event.key === "p" || event.key === "P") setPaused((value) => !value);
      if (event.key === "Escape") onFinish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, next, onFinish]);

  return (
    <div
      className="ceremony fixed inset-0 z-40 overflow-hidden bg-foil text-ink"
      onClick={next}
      role="presentation"
    >
      <div className="night-sky" />

      <div className="relative z-10 flex h-full flex-col">
        <header className="flex items-center justify-between px-[clamp(1.5rem,3vw,3.5rem)] pt-[clamp(1rem,2vw,2rem)]">
          <div className="text-[clamp(.6rem,.9vw,1rem)] font-black tracking-[0.45em] text-accent-deep">
            LIFE PASSPORT · 颁奖典礼
          </div>
          <div className="flex items-center gap-3">
            <span className="tabular text-[clamp(.6rem,.9vw,1rem)] font-black text-accent-deep">
              {Math.min(index + 1, slides.length)} / {slides.length}
            </span>
            <button
              type="button"
              className="pressable rounded-full bg-white/80 px-4 py-2 text-[clamp(.6rem,.85vw,.95rem)] font-black text-ink"
              onClick={(event) => { event.stopPropagation(); setPaused((value) => !value); }}
            >
              {paused ? "▶ 继续" : "⏸ 暂停"}
            </button>
            <button
              type="button"
              className="pressable rounded-full bg-ink px-4 py-2 text-[clamp(.6rem,.85vw,.95rem)] font-black text-white"
              onClick={(event) => { event.stopPropagation(); onFinish(); }}
            >
              跳到总榜 →
            </button>
          </div>
        </header>

        <div key={index} className="ceremony-slide flex flex-1 min-h-0 items-center justify-center px-[clamp(1.5rem,4vw,6rem)] py-[clamp(1rem,2vw,2.5rem)]">
          {slide.kind === "intro" && <IntroSlide players={slide.players} awards={awards} />}
          {slide.kind === "special" && <SpecialSlide award={slide.award} />}
          {slide.kind === "team" && <TeamSlide award={slide.award} />}
          {slide.kind === "podium" && <PodiumSlide entry={slide.entry} stationsTotal={stationsTotal} />}
          {slide.kind === "outro" && <OutroSlide />}
        </div>

        <footer className="flex items-center justify-center gap-1.5 pb-[clamp(.75rem,1.5vw,1.75rem)]">
          {slides.map((_, i) => (
            <span
              key={i}
              className="rounded-full transition-all"
              style={{
                width: i === index ? "1.75rem" : "0.45rem",
                height: "0.45rem",
                background: i <= index ? "var(--color-ink)" : "rgb(from var(--color-ink) r g b / .22)",
              }}
            />
          ))}
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ slides */

function IntroSlide({ players, awards }: { players: number; awards: BoardAwards }) {
  return (
    <div className="text-center">
      <p className="text-[clamp(.75rem,1.1vw,1.2rem)] font-black tracking-[0.5em] text-accent-deep">
        JOURNEY COMPLETE
      </p>
      {/* Two CJK lines at 10rem: leading below 1 makes them overlap on a
          1080p projector, which is exactly where this slide is shown. */}
      <h1 className="mt-[clamp(1rem,2vw,2rem)] text-[clamp(3.5rem,8vw,9rem)] font-black leading-[1.04] tracking-[-0.06em]">
        这一程
        <br />
        走完了
      </h1>
      <div className="mt-[clamp(2rem,4vw,4rem)] flex flex-wrap items-end justify-center gap-[clamp(2rem,5vw,5rem)]">
        <IntroStat value={players} label="位旅客" />
        <IntroStat value={awards.specials.length + awards.podium.length + (awards.team_awards?.length ?? 0)} label="个奖项" />
        <IntroStat value={awards.podium[0]?.score ?? 0} label="最高人生分" />
      </div>
      <p className="mt-[clamp(2rem,3.5vw,3.5rem)] text-[clamp(1rem,1.6vw,1.8rem)] font-black text-ceremony-ink">
        接下来，我们一个一个看看这些人生
      </p>
    </div>
  );
}

function IntroStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="tabular text-[clamp(3rem,7vw,7rem)] font-black leading-[0.8] tracking-[-0.06em]">{value}</div>
      <div className="mt-2 text-[clamp(.8rem,1.1vw,1.2rem)] font-black text-accent-deep">{label}</div>
    </div>
  );
}

function SpecialSlide({ award }: { award: SpecialAward }) {
  const color = tone(award.color_group, award.name, award.identity);
  return (
    <div className="grid w-full max-w-[92rem] items-center gap-[clamp(1.5rem,4vw,5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="text-center lg:text-left">
        <div className="ceremony-pop mx-auto grid aspect-square w-[clamp(9rem,17vw,17rem)] place-items-center rounded-[clamp(2rem,3.5vw,3.5rem)] bg-white text-[clamp(4.5rem,9vw,9rem)] shadow-[0_8px_0_var(--color-ceremony-shadow)] lg:mx-0">
          {award.emoji}
        </div>
        <p className="mt-[clamp(1rem,2vw,2rem)] text-[clamp(.7rem,1vw,1.05rem)] font-black tracking-[0.4em] text-accent-deep">
          SPECIAL AWARD
        </p>
        <h2 className="mt-2 text-[clamp(2.4rem,5.5vw,5.5rem)] font-black leading-[1] tracking-[-0.05em]">
          {award.title}
        </h2>
        <p className="mt-2 text-[clamp(.95rem,1.5vw,1.7rem)] font-black text-ceremony-ink">{award.subtitle}</p>
        <p className="mt-1.5 text-[clamp(.7rem,1vw,1.05rem)] font-bold text-accent-deep">
          个人奖 · 队友之间也会不同
        </p>
      </div>

      <WinnerCard
        name={award.name}
        color={color}
        identity={award.identity}
        caption={award.caption}
        score={award.score}
      />
    </div>
  );
}

function TeamSlide({ award }: { award: TeamAward }) {
  const color = colorOf(award.color_group)?.hex ?? "var(--color-ink)";
  const ink = readableOn(color);
  return (
    <div className="w-full max-w-[84rem] text-center">
      <div className="ceremony-pop mx-auto grid aspect-square w-[clamp(7rem,12vw,12rem)] place-items-center rounded-[clamp(1.75rem,3vw,3rem)] bg-white text-[clamp(3.5rem,7vw,7rem)] shadow-[0_8px_0_var(--color-ceremony-shadow)]">
        {award.emoji}
      </div>
      <p className="mt-[clamp(1rem,2vw,2rem)] text-[clamp(.7rem,1vw,1.05rem)] font-black tracking-[0.4em] text-accent-deep">
        TEAM AWARD · 队伍奖
      </p>
      <h2 className="mt-2 text-[clamp(2.4rem,5.5vw,5.5rem)] font-black leading-[1] tracking-[-0.05em]">
        {award.title}
      </h2>
      <p className="mt-2 text-[clamp(.95rem,1.5vw,1.7rem)] font-black text-ceremony-ink">{award.subtitle}</p>
      {/* Stations are scored once per team, so this belongs to everyone who
          walked it — naming one member would be a coin flip. */}
      <p className="mt-1.5 text-[clamp(.7rem,1vw,1.05rem)] font-bold text-accent-deep">
        挑战按队伍进行，这个奖属于整队
      </p>

      <div
        className="ceremony-rise mx-auto mt-[clamp(1.25rem,2.5vw,2.5rem)] max-w-[64rem] rounded-[clamp(1.5rem,2.5vw,2.5rem)] px-[clamp(1.5rem,3vw,3.5rem)] py-[clamp(1.5rem,3vw,3rem)]"
        style={{ background: color, color: ink, boxShadow: `0 8px 0 ${darken(color, 0.3)}` }}
      >
        <div className="text-[clamp(1.6rem,4.5vw,4.5rem)] font-black leading-[1.05] tracking-[-0.04em]">
          {award.members}
        </div>
        <div className="mt-3 text-[clamp(.85rem,1.3vw,1.4rem)] font-black opacity-80">
          {colorOf(award.color_group)?.zh ?? ""} · {IDENTITY_SHORT[award.identity] ?? award.identity}同行
        </div>
        <div
          className="mt-[clamp(1rem,2vw,2rem)] inline-block rounded-full bg-white px-[clamp(1rem,2vw,2rem)] py-[clamp(.5rem,1vw,1rem)] text-[clamp(1rem,1.8vw,2rem)] font-black text-ink"
        >
          {award.caption}
        </div>
      </div>
    </div>
  );
}

const PODIUM_LOOK: Record<number, { label: string; english: string; medal: string; size: string }> = {
  1: { label: "全场第一", english: "CHAMPION", medal: "🥇", size: "clamp(4rem,11vw,13rem)" },
  2: { label: "全场第二", english: "RUNNER-UP", medal: "🥈", size: "clamp(3.2rem,8.5vw,10rem)" },
  3: { label: "全场第三", english: "THIRD PLACE", medal: "🥉", size: "clamp(2.8rem,7.5vw,8.5rem)" },
};

function PodiumSlide({ entry, stationsTotal }: { entry: PodiumEntry; stationsTotal: number }) {
  const look = PODIUM_LOOK[entry.rank] ?? PODIUM_LOOK[3];
  const color = tone(entry.color_group, entry.name, entry.identity);
  const ink = readableOn(color);
  return (
    <div className="w-full max-w-[86rem] text-center">
      <div className="ceremony-pop text-[clamp(4rem,9vw,9rem)] leading-none">{look.medal}</div>
      <p className="mt-[clamp(.5rem,1vw,1rem)] text-[clamp(.7rem,1vw,1.05rem)] font-black tracking-[0.45em] text-accent-deep">
        {look.english}
      </p>
      <h2 className="mt-1 text-[clamp(1.6rem,3.4vw,3.4rem)] font-black tracking-[-0.03em]">{look.label}</h2>

      <div
        className="ceremony-rise mx-auto mt-[clamp(1.25rem,2.5vw,2.5rem)] rounded-[clamp(1.5rem,3vw,3rem)] px-[clamp(1.5rem,4vw,4.5rem)] py-[clamp(1.5rem,3vw,3rem)]"
        style={{ background: color, color: ink, boxShadow: `0 9px 0 ${darken(color, 0.3)}` }}
      >
        <div className="font-black leading-[0.9] tracking-[-0.06em]" style={{ fontSize: look.size }}>
          {entry.name}
        </div>
        <div className="mt-[clamp(1rem,2vw,2rem)] flex flex-wrap items-end justify-center gap-[clamp(1.5rem,3.5vw,3.5rem)]">
          <PodiumStat value={String(entry.score)} label="最终人生分" ink={ink} big />
          {/* Out of what this event ran, never a fixed 7: an event that
              dropped two stations must not announce its winner as 5/7. */}
          <PodiumStat value={`${entry.stations_done}/${stationsTotal}`} label="完成站点" ink={ink} />
          <PodiumStat value={`${entry.life_events}/3`} label="经历人生" ink={ink} />
          {/* The card is already painted in this player's team colour, so the
              colour name would only add a word the room does not need. */}
          <PodiumStat value={IDENTITY_SHORT[entry.identity ?? "solo"] ?? "独行"} label="同行" ink={ink} />
        </div>
      </div>
    </div>
  );
}

function PodiumStat({ value, label, ink, big }: { value: string; label: string; ink: string; big?: boolean }) {
  return (
    <div className="text-center">
      <div
        className="tabular font-black leading-none tracking-[-0.05em]"
        style={{ fontSize: big ? "clamp(3rem,7vw,7rem)" : "clamp(1.6rem,3.2vw,3.2rem)" }}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[clamp(.7rem,1vw,1.1rem)] font-black opacity-75" style={{ color: ink }}>
        {label}
      </div>
    </div>
  );
}

function OutroSlide() {
  return (
    <div className="text-center">
      <h1 className="text-[clamp(2.5rem,6.5vw,7rem)] font-black leading-[1.02] tracking-[-0.05em]">
        「我的恩典够你用的」
      </h1>
      <p className="mt-[clamp(1rem,2vw,2rem)] text-[clamp(1rem,1.8vw,2rem)] font-black text-ceremony-ink">
        哥林多后书 12:9 · 2 CORINTHIANS 12:9
      </p>
      <p className="mt-[clamp(2rem,4vw,4rem)] text-[clamp(1.6rem,4vw,4rem)] font-black tracking-[-0.03em] text-seal-deep">
        You don't have to do life alone
      </p>
      <p className="mt-[clamp(2rem,3.5vw,3.5rem)] text-[clamp(.9rem,1.3vw,1.4rem)] font-black text-accent-deep">
        每个人都可以在手机上生成自己的纪念徽章 · 别忘了去恩典站
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

function WinnerCard({
  name,
  color,
  identity,
  caption,
  score,
}: {
  name: string;
  color: string;
  identity: Identity;
  caption: string;
  score: number;
}) {
  const ink = readableOn(color);
  return (
    <div
      className="ceremony-rise rounded-[clamp(1.5rem,3vw,3rem)] px-[clamp(1.5rem,3vw,3.5rem)] py-[clamp(1.5rem,3vw,3rem)] text-center lg:text-left"
      style={{ background: color, color: ink, boxShadow: `0 9px 0 ${darken(color, 0.3)}` }}
    >
      <div className="font-black leading-[0.92] tracking-[-0.05em]" style={{ fontSize: "clamp(2.8rem,7vw,7rem)" }}>
        {name}
      </div>
      <div className="mt-3 text-[clamp(.85rem,1.2vw,1.3rem)] font-black opacity-80">
        {IDENTITY_SHORT[identity ?? "solo"] ?? ""}同行 · 最终 {score} 分
      </div>
      <div
        className="mt-[clamp(1rem,2vw,2rem)] inline-block rounded-full bg-white px-[clamp(1rem,2vw,2rem)] py-[clamp(.5rem,1vw,1rem)] text-[clamp(1rem,1.8vw,2rem)] font-black text-ink"
      >
        {caption}
      </div>
    </div>
  );
}

function tone(colorGroup: string | null, seed: string, identity: Identity): string {
  return colorOf(colorGroup)?.hex ?? (identity === "solo" ? soloColor(seed).hex : "var(--color-ink)");
}
