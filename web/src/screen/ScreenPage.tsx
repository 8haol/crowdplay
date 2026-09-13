import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { rpc, errorText } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { BoardPlayer, BoardSnapshot, FeedItem, GameLanding } from "../lib/types";
import { IDENTITY_SHORT, colorOf, soloColor } from "../lib/types";
import { ConnDot, UpLink } from "../lib/ui";
import { JoinQr } from "../lib/JoinQr";
import { joinUrl } from "../lib/gameLinks";
import Ceremony from "./Ceremony";
import { DemoRibbon } from "../lib/DemoRibbon";
import { SCREEN_AWARDS, SCREEN_PREVIEW } from "./previewData";
import { useAmbientVerse } from "../lib/scripture";

/* Projector page. No auth: it is opened on the venue laptop and shown to the
   room. It never receives 4-digit codes (see board_snapshot in SQL), so a
   photo of the screen cannot be used to open somebody's passport. */

const FEED_SHOWN = 12;

export default function ScreenPage() {
  const [searchParams] = useSearchParams();
  const { screenToken } = useParams<{ screenToken: string }>();
  const previewMode = searchParams.get("preview");
  const preview = previewMode === "1" || previewMode === "lobby" || previewMode === "awards" || previewMode === "ended";
  /* The screen token names the event; one call brings the board, the title
     and the join link, so the projector has a single 3-second heartbeat. */
  const pollFn = useMemo(
    () => (screenToken ? () => rpc<BoardSnapshot>("board_snapshot", { p_screen_token: screenToken }) : null),
    [screenToken],
  );
  const poll = usePoll<BoardSnapshot>(preview ? null : pollFn, 3000);
  const data = previewData(previewMode) ?? poll.data;
  const landing: GameLanding | null = preview
    ? ({ title: "Glasgow 新生迎新会", join_token: "preview", join_open: true, is_current: true } as GameLanding)
    : data
      ? ({ title: data.title, join_token: data.join_token, join_open: data.join_open, is_current: data.phase !== "ended" } as GameLanding)
      : null;
  const online = preview ? true : poll.online;
  const error = poll.error;
  const joinLink = landing?.join_token ? joinUrl(landing.join_token) : null;

  /* The ceremony plays once per transition into `ended`; the host can leave it
     and replay it from the standings. */
  const [ceremonyDone, setCeremonyDone] = useState(false);
  const endedRef = useRef(false);
  useEffect(() => {
    const ended = data?.phase === "ended";
    if (ended && !endedRef.current) setCeremonyDone(false);
    endedRef.current = ended;
  }, [data?.phase]);

  if (!preview && !screenToken) {
    /* `/screen` with no token. The projector link lives in the admin console
       for exactly one event; there is no "current game" to guess at. */
    return (
      <Frame online={false}>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <p className="font-mono text-[clamp(.7rem,1vw,1rem)] font-black tracking-[0.35em] text-foil-dim">PROJECTOR</p>
          <h1 className="font-serif text-[clamp(1.8rem,4vw,4rem)] font-black leading-tight">这台投影还没有连到任何一场</h1>
          <p className="max-w-2xl text-[clamp(.95rem,1.4vw,1.5rem)] font-semibold leading-relaxed text-moon-dim">
            请总控打开管理端 → 进入本场活动 → 复制「大屏链接」，在这台电脑的浏览器里打开。
            每一场都有自己的大屏链接，链接本身就是场次。
          </p>
          <Link to="/admin" className="pressable rounded-full bg-ink px-6 py-3 text-[clamp(.9rem,1.2vw,1.2rem)] font-black text-white">
            去管理端
          </Link>
        </div>
      </Frame>
    );
  }

  if (!data) {
    return (
      <Frame online={online}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="dots font-serif text-[clamp(1.5rem,3vw,3rem)] font-black">
            正在连接现场<span>.</span><span>.</span><span>.</span>
          </div>
          {!online && <div className="text-lg text-seal">{errorText(error)}</div>}
        </div>
      </Frame>
    );
  }

  if (data.phase === "ended" && data.awards && !ceremonyDone) {
    return (
      <>
        <Ceremony
          awards={data.awards}
          players={data.stats.players}
          stationsTotal={data.stations_total}
          onFinish={() => setCeremonyDone(true)}
        />
        {preview && <DemoRibbon />}
      </>
    );
  }

  return (
    <Frame online={online} data={data} demo={preview}>
      {data.phase === "waiting" ? (
        <Lobby data={data} landing={landing} joinLink={joinLink} />
      ) : (
        <div className="grid grid-cols-1 gap-8 px-4 pb-24 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_clamp(340px,26vw,460px)] lg:gap-[clamp(0.75rem,1.4vw,1.75rem)] lg:px-[clamp(0.75rem,1.6vw,2rem)] lg:pb-[clamp(0.75rem,1.4vw,1.75rem)]">
          <Board
            players={data.players}
            ended={data.phase === "ended"}
            stationsTotal={data.stations_total ?? 7}
            onReplay={data.phase === "ended" && data.awards ? () => setCeremonyDone(false) : undefined}
          />
          <aside className="flex min-h-0 flex-col gap-[clamp(0.5rem,1vw,1.25rem)]">
            <Ticker feed={data.feed} />
            {joinLink && <RejoinCard url={joinLink} />}
          </aside>
        </div>
      )}
    </Frame>
  );
}

function previewData(mode: string | null): BoardSnapshot | null {
  if (mode === "lobby") {
    return {
      ...SCREEN_PREVIEW,
      phase: "waiting",
      started_at: null,
      players: SCREEN_PREVIEW.players.map((player) => ({ ...player, score: 0, stations_done: 0, life_events_done: 0 })),
      stats: { ...SCREEN_PREVIEW.stats, stamps: 0, life_events: 0, tokens_used: 0, top_score: 0 },
      feed: [],
    };
  }
  if (mode === "awards") {
    return { ...SCREEN_PREVIEW, phase: "ended", awards: SCREEN_AWARDS };
  }
  if (mode === "ended") {
    return { ...SCREEN_PREVIEW, phase: "ended", awards: null };
  }
  if (mode === "1") return SCREEN_PREVIEW;
  return null;
}

/* ------------------------------------------------------------------ shell */

function Frame(props: { online: boolean; data?: BoardSnapshot; demo?: boolean; children: React.ReactNode }) {
  return (
    <div className="screen-stage relative min-h-dvh overflow-x-hidden text-ink lg:flex lg:h-dvh lg:min-h-0 lg:flex-col lg:overflow-hidden">
      <div className="night-sky" />
      <div className="screen-fit relative z-10 flex flex-col lg:h-full lg:min-h-0">
        <Header online={props.online} data={props.data} />
        {props.children}
      </div>
      {props.demo && <DemoRibbon />}
    </div>
  );
}

function Header({ online, data }: { online: boolean; data?: BoardSnapshot }) {
  const elapsed = useElapsed(data?.started_at ?? null);
  const phase = data?.phase;
  return (
    <header className="flex flex-col gap-3 px-4 pb-5 pt-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6 lg:px-[clamp(0.75rem,1.6vw,2rem)] lg:pb-[clamp(0.5rem,1vw,1rem)] lg:pt-[clamp(0.75rem,1.4vw,1.5rem)]">
      <div className="flex items-end justify-between gap-3 lg:justify-start lg:gap-[clamp(0.75rem,1.5vw,1.75rem)]">
        <div>
          {/* The arrow sits after the label, not before it: anything in front
              would push the eyebrow off the title's left edge. It is also the
              faintest thing in the header — the room sees this wall, the
              operator is the only person who needs the way out. */}
          <div className="flex items-center gap-1.5">
            <div className="text-[9px] font-black tracking-[0.36em] text-foil-dim lg:text-[clamp(0.5rem,0.75vw,0.8rem)] lg:tracking-[0.5em]">
              LIFE PASSPORT · LIVE
            </div>
            <UpLink label="入口" to="/" variant="icon" className="!h-5 !w-5 !text-[11px]" />
          </div>
          <h1 className="mt-1 text-2xl font-black leading-none tracking-[-0.04em] lg:text-[clamp(1.5rem,2.9vw,3.4rem)]">
            人生护照实况
          </h1>
        </div>
        <div className="flex items-end gap-2">
          {phase && <PhaseTag phase={phase} />}
          {phase === "playing" && elapsed && (
            <div className="pb-0.5 lg:pb-1">
              <div className="text-[9px] font-bold tracking-[0.18em] text-moon-dim lg:text-[clamp(0.5rem,0.7vw,0.75rem)]">已进行</div>
              <div className="tabular text-xl font-black leading-none lg:text-[clamp(1.1rem,1.9vw,2.2rem)]">
                {elapsed}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-5 items-end gap-2 rounded-2xl bg-white/75 p-3 shadow-[0_2px_0_#e0a800] lg:flex lg:gap-[clamp(0.75rem,1.6vw,2rem)] lg:bg-transparent lg:p-0 lg:pb-1 lg:shadow-none">
        {data && (
          <>
            <Stat label="旅客" value={data.stats.players} />
            <Stat label="队伍" value={data.stats.teams ?? data.players.length} />
            <Stat label="已盖章" value={data.stats.stamps} />
            <Stat label="人生事件" value={data.stats.life_events} />
            {/* The top score is deliberately withheld until the end: an hour of
                "who is winning" on the wall is exactly what we removed. */}
            {data.phase === "ended" ? (
              <Stat label="最高分" value={data.stats.top_score} foil />
            ) : (
              <Stat label="Token" value={data.stats.tokens_used} />
            )}
          </>
        )}
        <span className="flex flex-col items-center gap-1 pb-0 text-center text-[9px] font-bold text-moon-dim lg:flex-row lg:gap-2 lg:pb-1 lg:text-[clamp(0.6rem,0.85vw,0.9rem)]">
          <ConnDot online={online} />
          {online ? "已连接" : "重连中"}
        </span>
      </div>
    </header>
  );
}

function Stat({ label, value, foil }: { label: string; value: number; foil?: boolean }) {
  return (
    <div className="text-center lg:text-right">
      <div className="text-[9px] font-bold text-moon-dim lg:text-[clamp(0.5rem,0.7vw,0.75rem)] lg:tracking-[0.25em]">{label}</div>
      <div
        className={`tabular text-xl font-black leading-none lg:text-[clamp(1.1rem,1.9vw,2.2rem)] ${foil ? "text-seal" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function PhaseTag({ phase }: { phase: BoardSnapshot["phase"] }) {
  const map = {
    waiting: { t: "等待开始", c: "bg-white text-ink" },
    playing: { t: "进行中", c: "bg-leaf text-white" },
    ended: { t: "已结束", c: "bg-ink text-white" },
  }[phase];
  return (
    <span
      className={`mb-0.5 rounded-full px-3 py-1.5 text-xs font-black lg:mb-1.5 lg:px-[clamp(0.6rem,1vw,1.1rem)] lg:py-[clamp(0.15rem,0.3vw,0.4rem)] lg:text-[clamp(0.65rem,0.95vw,1.05rem)] ${map.c}`}
    >
      {map.t}
    </span>
  );
}

/* ------------------------------------------------------------------ lobby */

const NAME_WALL_PAGE = 28;

function Lobby({
  data,
  landing,
  joinLink,
}: {
  data: BoardSnapshot;
  landing: GameLanding | null;
  joinLink: string | null;
}) {
  return (
    <div className="grid flex-1 min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-[clamp(1rem,2vw,2.5rem)] px-[clamp(1.5rem,5vw,6rem)] pb-[clamp(1rem,2vw,2.5rem)]">
      <div className="grid min-h-0 items-center gap-[clamp(2rem,5vw,6rem)] lg:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)]">
        <div>
          <p className="text-[clamp(.7rem,1vw,1rem)] font-black tracking-[0.35em] text-foil-dim">SCAN TO JOIN · 扫码入场</p>
          <h2 className="mt-3 max-w-4xl text-balance text-[clamp(2.6rem,6.5vw,7rem)] font-black leading-[0.95] tracking-[-0.06em]">
            {landing?.title ?? "Life Passport"}
          </h2>
          <div className="mt-[clamp(1.5rem,3vw,3rem)] flex items-end gap-5">
            <div className="tabular font-serif text-[clamp(3.5rem,9vw,9rem)] font-black leading-[0.78] tracking-[-0.08em] text-ink">
              {data.stats.players}
            </div>
            <div className="pb-1 text-[clamp(1rem,1.7vw,1.8rem)] font-black text-moon-dim">位旅客<br />已到场</div>
          </div>
          <p className="mt-[clamp(1rem,2vw,2rem)] max-w-2xl text-[clamp(.9rem,1.3vw,1.35rem)] font-semibold leading-relaxed text-moon-dim">
            用<b className="text-ink">手机相机</b>或<b className="text-ink">微信扫一扫</b>对准二维码，
            填写姓名，就能领到属于你的 3 位人生编号。
          </p>
          <ScreenVerse className="mt-[clamp(1.25rem,2.5vw,2.75rem)] max-w-2xl" />
        </div>

        <div className="flex flex-col items-center rounded-[clamp(1.25rem,2.5vw,2.5rem)] bg-white p-[clamp(1rem,2vw,2rem)] shadow-[0_7px_0_#e0a800]">
          {joinLink ? (
            <JoinQr url={joinLink} className="aspect-square w-full rounded-2xl" />
          ) : (
            <div className="aspect-square w-full animate-pulse rounded-2xl bg-line" />
          )}
          <div className="mt-4 text-[clamp(1rem,1.6vw,1.7rem)] font-black">扫码加入游戏</div>
          <div className="mt-1.5 text-center text-[clamp(.7rem,.95vw,1rem)] font-bold text-ink-dim">
            镜头对准二维码 · 自动打开本场链接
          </div>
          {!landing?.join_open && (
            <div className="mt-3 rounded-lg bg-[#fff0eb] px-4 py-2 text-sm font-black text-seal">登记暂时关闭</div>
          )}
        </div>
      </div>

      <NameWall players={data.players} />
    </div>
  );
}

/**
 * Arrival wall. With 50+ registrations a single wrapped row overflowed the
 * projector, so the wall is a fixed-height band that pages through everybody
 * and shrinks its chips as the room fills.
 */
function NameWall({ players }: { players: BoardPlayer[] }) {
  const pageCount = Math.max(1, Math.ceil(players.length / NAME_WALL_PAGE));
  const page = useRotatingPage(pageCount, 7000);
  const shown = players.slice(page * NAME_WALL_PAGE, (page + 1) * NAME_WALL_PAGE);
  const dense = players.length > 32;

  if (players.length === 0) {
    return (
      <div className="flex h-[clamp(4rem,9vh,7rem)] items-center justify-center rounded-2xl bg-white/45 text-[clamp(.85rem,1.2vw,1.3rem)] font-bold text-moon-dim">
        第一位旅客还没有登记
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-[clamp(.6rem,.85vw,.9rem)] font-black text-foil-dim">
        <span>已到场旅客</span>
        <span aria-live="polite" className="font-mono tracking-[0.12em]">
          {pageCount > 1 ? `第 ${page + 1}/${pageCount} 组 · 共 ${players.length} 位` : `共 ${players.length} 位`}
        </span>
      </div>
      <div className="flex h-[clamp(5rem,13vh,10rem)] flex-wrap content-start justify-center gap-[clamp(0.3rem,0.6vw,0.7rem)] overflow-hidden">
        {shown.map((p, i) => (
          <span
            key={p.id}
            className="rise rounded-full bg-white font-bold shadow-[0_2px_0_#e0a800]"
            style={{
              "--i": Math.min(i, 18),
              padding: dense ? "0.18rem 0.7rem" : "0.28rem 0.95rem",
              fontSize: dense ? "clamp(0.7rem,0.95vw,1rem)" : "clamp(0.8rem,1.15vw,1.25rem)",
              maxWidth: "14rem",
            } as React.CSSProperties}
          >
            {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- departures board */

/**
 * While playing this is a *progress* board, not a leaderboard: rows arrive
 * grouped by team code (see board_snapshot) with no rank column, so the room
 * cannot watch a running scoreboard for an hour. Ranks only appear once the
 * game has ended, at which point the rows are re-sorted by final score.
 */
function Board({
  players,
  ended,
  stationsTotal,
  onReplay,
}: {
  players: BoardPlayer[];
  ended: boolean;
  stationsTotal: number;
  onReplay?: () => void;
}) {
  const changed = useChangedScores(players);
  const ordered = useMemo(
    () => (ended ? [...players].sort((a, b) => b.score - a.score) : players),
    [ended, players],
  );
  // The projector is whatever the venue has: a fixed page size either wasted a
  // third of a 1080p board or clipped the last row on a 768p laptop. Measure
  // one rendered row against the space the board actually has.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const pageSize = useBoardCapacity(gridRef, rowRef);
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const page = useRotatingPage(pageCount, 9000);
  const visible = useMemo(
    () => ordered.slice(page * pageSize, (page + 1) * pageSize),
    [ordered, page, pageSize],
  );
  const rows = Math.ceil(visible.length / 2) || 1;

  const ranks = useMemo(() => {
    const result = new Map<string, number>();
    if (!ended) return result;
    let rank = 0;
    let previousScore: number | null = null;
    ordered.forEach((player, index) => {
      if (previousScore !== player.score) rank = index + 1;
      result.set(player.id, rank);
      previousScore = player.score;
    });
    return result;
  }, [ended, ordered]);

  return (
    <section className="screen-board flex min-h-0 flex-col">
      <div className="mb-[clamp(0.35rem,0.7vw,0.9rem)] flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-[clamp(1rem,1.7vw,2rem)] font-black">
          {ended ? "最终个人排名" : "全场人生旅程"}
        </h2>
        <div className="flex items-baseline gap-3">
          {onReplay && (
            <button
              type="button"
              onClick={onReplay}
              className="pressable rounded-full bg-ink px-3 py-1.5 text-[clamp(0.55rem,0.8vw,0.85rem)] font-black text-white"
            >
              ↻ 重播颁奖
            </button>
          )}
          <span aria-live="polite" className="font-mono text-[clamp(0.55rem,0.8vw,0.85rem)] tracking-[0.12em] text-moon-dim">
            {pageCount > 1
              ? `第 ${page + 1}/${pageCount} 组 · 共 ${ordered.length} 人`
              : ended ? "FINAL" : "按队伍排列 · 不按分数"}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div
          ref={gridRef}
          className="board-grid grid h-full content-evenly gap-2 lg:gap-[clamp(0.2rem,0.4vw,0.5rem)]"
          style={{
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gridTemplateRows: `repeat(${rows}, min-content)`,
            gridAutoFlow: "column",
          }}
        >
          {visible.map((p, rowIndex) => {
            const color = colorOf(p.color_group) ?? (p.identity === "solo" ? soloColor(p.id) : null);
            const rank = ranks.get(p.id) ?? 0;
            const isLead = ended && rank === 1 && p.score > 0;
            const flashed = changed.has(p.id);
            return (
              <div
                key={p.id}
                ref={rowIndex === 0 ? rowRef : undefined}
                className={`${flashed ? "row-flash" : ""} screen-player-row flex items-center gap-[clamp(0.3rem,0.6vw,0.8rem)] overflow-hidden rounded-xl border px-[clamp(0.4rem,0.7vw,0.9rem)] ${
                  isLead ? "lead-glow border-transparent bg-white" : "border-transparent bg-white/85"
                }`}
                style={{
                  paddingTop: "clamp(0.42rem,0.52vw,0.65rem)",
                  paddingBottom: "clamp(0.42rem,0.52vw,0.65rem)",
                  borderLeft: color ? `4px solid ${color.hex}` : undefined,
                }}
              >
                {ended && (
                  <span
                    className={`screen-player-rank tabular shrink-0 text-center font-serif font-black ${
                      rank <= 3 ? "text-seal" : "text-moon-dim/60"
                    }`}
                    style={{ fontSize: "clamp(0.85rem,1.05vw,1.2rem)", width: "2rem" }}
                  >
                    {rank}
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span
                    className="screen-player-name block truncate font-bold leading-tight"
                    style={{ fontSize: "clamp(0.92rem,1.2vw,1.35rem)" }}
                  >
                    {p.name}
                  </span>
                  <span
                    className="screen-player-meta block truncate leading-tight text-moon-dim"
                    style={{ fontSize: "clamp(0.65rem,0.78vw,0.86rem)" }}
                  >
                    {p.identity ? IDENTITY_SHORT[p.identity] : "未分配"}
                    {" · "}
                    {p.stations_done}/{stationsTotal} 站 · {p.life_events_done ?? 0}/3 人生
                    {p.locked && <span className="font-bold text-seal"> · 事件待选</span>}
                    {p.sick && <span className="text-seal"> · 感冒</span>}
                    {!p.token_available && <span className="text-moon-dim/55"> · 无 Token</span>}
                  </span>
                </span>

                <span
                  className={`${flashed ? "score-flash" : ""} screen-player-score tabular shrink-0 font-serif font-black leading-none ${
                    isLead ? "text-ink" : ""
                  }`}
                  style={{ fontSize: "clamp(1.35rem,1.75vw,2rem)" }}
                >
                  {p.score}
                </span>
              </div>
            );
          })}
          {ordered.length === 0 && (
            <div className="text-[clamp(0.8rem,1.2vw,1.3rem)] text-moon-dim">还没有旅客</div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ rejoin */

/** Anyone who closed the tab can get back in by rescanning from the wall. */
function RejoinCard({ url }: { url: string }) {
  return (
    <div className="flex shrink-0 items-center gap-[clamp(0.6rem,1vw,1.1rem)] rounded-[20px] bg-white/90 p-[clamp(0.5rem,0.9vw,1rem)] shadow-[0_3px_0_#e0a800]">
      <JoinQr url={url} className="h-[clamp(4.5rem,7vw,7rem)] w-[clamp(4.5rem,7vw,7rem)] shrink-0 rounded-lg" />
      <div className="min-w-0">
        <div className="text-[clamp(0.55rem,0.75vw,0.8rem)] font-black tracking-[0.28em] text-foil-dim">REJOIN</div>
        <div className="mt-1 text-[clamp(0.9rem,1.25vw,1.35rem)] font-black leading-tight">
          手机关掉了？
          <br />
          扫这里回到游戏
        </div>
        <div className="mt-1.5 text-[clamp(0.6rem,0.8vw,0.88rem)] font-semibold leading-snug text-moon-dim">
          进去后点「已经登记过？」，输入你的 3 位人生编号即可找回
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- verse */

/**
 * Deliberately confined to the two stretches where the screen has nothing to
 * say: the lobby, and the feed before the first broadcast lands. Once results
 * are flowing they own the rail — a verse parked next to live scores would be
 * competing with them, and the room is full of people visiting a church for
 * the first time. Gentle, not preached, is a dosage decision as much as a
 * wording one.
 */
function ScreenVerse({ className = "" }: { className?: string }) {
  const verse = useAmbientVerse();
  return (
    <div key={verse.ref} className={`feed-in ${className}`}>
      <div className="h-px w-[clamp(1.5rem,3vw,3rem)] bg-foil-dim/30" />
      <p className="mt-[clamp(.5rem,1vw,1rem)] text-[clamp(1rem,1.6vw,1.8rem)] font-black leading-snug text-ink/80">
        「{verse.text}」
      </p>
      <p className="mt-[clamp(.2rem,.5vw,.5rem)] font-mono text-[clamp(.55rem,.8vw,.85rem)] font-bold tracking-[0.22em] text-foil-dim/75">
        {verse.ref} · {verse.refEn}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ ticker */

function Ticker({ feed }: { feed: FeedItem[] }) {
  const fresh = useFreshIds(feed);
  const shown = feed.slice(0, FEED_SHOWN);

  return (
    <section className="screen-ticker flex min-h-0 flex-1 flex-col">
      <div className="mb-[clamp(0.35rem,0.7vw,0.9rem)] flex items-baseline justify-between">
        <h2 className="font-serif text-[clamp(1rem,1.7vw,2rem)] font-black">实时播报</h2>
        <span className="font-mono text-[clamp(0.55rem,0.8vw,0.85rem)] tracking-[0.25em] text-moon-dim">
          LIVE FEED
        </span>
      </div>

      {/* The rail holds more lines than fit; a bottom fade makes the cut read
          as "more below" instead of a half-clipped row. */}
      <div
        className="screen-feed-rail min-h-0 flex-1 overflow-hidden rounded-[24px] bg-white/90 p-3 shadow-[0_3px_0_#e0a800] lg:p-[clamp(0.5rem,0.9vw,1.1rem)]"
        style={{
          maskImage: "linear-gradient(to bottom, black 88%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 88%, transparent 100%)",
        }}
      >
        {shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="text-[clamp(0.75rem,1.1vw,1.2rem)] text-moon-dim">等待第一个人生瞬间</div>
            <ScreenVerse className="mt-[clamp(0.75rem,1.5vw,1.5rem)]" />
          </div>
        ) : (
          <ul className="flex flex-col gap-[clamp(0.3rem,0.55vw,0.7rem)]">
            {shown.map((item) => (
              <FeedLine key={item.id} item={item} fresh={fresh.has(item.id)} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

type Glyph = "star" | "check" | "cross" | "coin" | "spark" | "rain" | "ring";
type Tone = "foil" | "leaf" | "seal" | "plain";

interface Line {
  glyph: Glyph;
  tone: Tone;
  /** Who this is about, e.g. `林沐恩 / 周以诺`. Never carries a colour word. */
  who: string;
  /** Team colour, shown as a dot in front of the name instead of as text. */
  dot?: string | null;
  /** What happened, one short clause. */
  what: string;
  /** Optional supporting clause, e.g. the action they picked. */
  detail: string | null;
  /** Right-aligned numeric badge. */
  chip: string | null;
}

const STAGE_ZH = ["", "第一段人生", "第二段人生", "最后一段人生"];

/**
 * Feed copy. The previous version glued a scene title onto an outcome label
 * ("在 15 分关口抽到「独自坐在面试门外 · 信息越看越乱」"), which read as
 * nonsense: the scene is where the player *was*, the outcome is what *happened*.
 * They are now separate clauses.
 */
function describe(item: FeedItem): Line {
  if (item.kind === "life_event") {
    const delta = item.after - item.before;
    const good = delta > 0;
    const neutral = delta === 0;
    const stage = item.stage ? STAGE_ZH[item.stage] ?? "人生事件" : "人生事件";
    return {
      glyph: good ? "spark" : neutral ? "ring" : "rain",
      tone: good ? "foil" : neutral ? "plain" : "seal",
      who: item.name,
      what: item.scene ? `${stage}·${item.scene}` : stage,
      detail: item.choice
        ? `选了「${item.choice}」→ ${item.outcome ?? item.label}`
        : item.outcome ?? item.label,
      chip: neutral ? "分数不变" : `${delta > 0 ? "+" : ""}${delta} → ${item.after} 分`,
    };
  }

  if (item.kind === "attempt") {
    const who = item.name;
    if (item.status === "failed") {
      return {
        glyph: "cross",
        tone: "seal",
        who,
        dot: colorOf(item.color_group ?? null)?.hex ?? null,
        what: `在「${item.station}」失手了`,
        detail: null,
        chip: "本次未得分",
      };
    }
    const perfect = item.score >= 9; // graded max; fixed stations award 6
    return {
      glyph: perfect ? "star" : "check",
      tone: perfect ? "foil" : "leaf",
      who,
      dot: colorOf(item.color_group ?? null)?.hex ?? null,
      what: `在「${item.station}」${perfect ? "拿下满分" : "通过挑战"}`,
      detail: null,
      chip: `每人 +${item.score} 分`,
    };
  }

  const usage = {
    hint: "换了一个提示",
    second_chance: `换到一次重来机会${item.station ? `（${item.station}）` : ""}`,
    grace_card: "领了一张纪念卡",
  }[item.usage];
  return {
    glyph: "coin",
    tone: "foil",
    who: item.name,
    what: `用掉 Help Token，${usage}`,
    detail: null,
    chip: null,
  };
}

const TONE_CLASS: Record<Tone, { rail: string; icon: string; chip: string }> = {
  foil: { rail: "#e0a800", icon: "#7a5200", chip: "#7a5200" },
  leaf: { rail: "#2f9e63", icon: "#1e7a34", chip: "#1e7a34" },
  seal: { rail: "#c4402a", icon: "#c4402a", chip: "#c4402a" },
  plain: { rail: "#c9bda6", icon: "#7d7261", chip: "#7d7261" },
};

/** Hand-drawn glyph set. Emoji rendered inconsistently across the venue
 *  laptop and looked cheap next to the rest of the board. */
function FeedGlyph({ glyph, color }: { glyph: Glyph; color: string }) {
  const paths: Record<Glyph, React.ReactNode> = {
    star: <path d="M12 3.6l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.9l6-.8z" />,
    check: <path d="M4.5 12.8l4.6 4.6L19.5 7" />,
    cross: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
    coin: <><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.6 10.2h4.8M9.6 13.8h4.8" /></>,
    spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.6 2.6M15.4 15.4L18 18M18 6l-2.6 2.6M8.6 15.4L6 18" />,
    rain: <><path d="M6.5 12.5a4 4 0 0 1 .6-8 5.4 5.4 0 0 1 10 1.3 3.4 3.4 0 0 1-.6 6.7z" /><path d="M9 16.5l-1 3M13 16.5l-1 3M17 16.5l-1 3" /></>,
    ring: <><circle cx="12" cy="14.5" r="4.5" /><path d="M9.5 8l2.5-4 2.5 4" /></>,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke={color}
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[62%] w-[62%]"
    >
      {paths[glyph]}
    </svg>
  );
}

function FeedLine({ item, fresh }: { item: FeedItem; fresh: boolean }) {
  const line = describe(item);
  const tone = TONE_CLASS[line.tone];
  return (
    <li
      className={`${fresh ? "feed-in" : ""} flex items-start gap-[clamp(0.4rem,0.7vw,0.85rem)] rounded-xl bg-night-raise/70 py-[clamp(0.4rem,0.62vw,0.8rem)] pl-[clamp(0.5rem,0.8vw,1rem)] pr-[clamp(0.5rem,0.8vw,1rem)]`}
      style={{ borderLeft: `4px solid ${tone.rail}` }}
    >
      <span
        className="grid shrink-0 place-items-center rounded-lg bg-white"
        style={{
          height: "clamp(1.5rem,2.2vw,2.4rem)",
          width: "clamp(1.5rem,2.2vw,2.4rem)",
          boxShadow: `inset 0 0 0 1.5px ${tone.rail}55`,
        }}
      >
        <FeedGlyph glyph={line.glyph} color={tone.icon} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-[clamp(0.25rem,0.4vw,0.45rem)] text-[clamp(0.74rem,1.05vw,1.2rem)] font-black leading-snug">
          {line.dot && (
            <span
              aria-hidden="true"
              className="h-[0.6em] w-[0.6em] shrink-0 rounded-full"
              style={{ background: line.dot }}
            />
          )}
          <span className="truncate">{line.who}</span>
        </span>
        <span className="block text-[clamp(0.7rem,0.98vw,1.1rem)] leading-snug text-ink">
          {line.what}
        </span>
        {line.detail && (
          <span className="mt-0.5 block text-[clamp(0.62rem,0.85vw,0.95rem)] leading-snug text-moon-dim">
            {line.detail}
          </span>
        )}
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
        {line.chip && (
          <span
            className="tabular whitespace-nowrap text-[clamp(0.6rem,0.85vw,0.95rem)] font-black"
            style={{ color: tone.chip }}
          >
            {line.chip}
          </span>
        )}
        <span className="tabular text-[clamp(0.55rem,0.72vw,0.82rem)] text-moon-dim/60">
          {timeOf(item.at)}
        </span>
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ hooks */

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Elapsed clock since started_at, ticking locally between polls. */
function useElapsed(startedAt: string | null): string | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!startedAt) return;
    const update = () => setNow(Date.now());
    const first = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [startedAt]);
  if (!startedAt || now === null) return null;
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Cycle through pages of a list that does not fit the projector. */
/**
 * How many rows fit on this projector, from a real measurement of one row and
 * the box the board has to live in. Below the 1024px breakpoint the board is a
 * vertically scrolling list (see index.css), where the box is as tall as its
 * content — measuring there would just feed itself, so it takes a fixed page.
 */
function useBoardCapacity(
  gridRef: React.RefObject<HTMLDivElement | null>,
  rowRef: React.RefObject<HTMLDivElement | null>,
): number {
  const [capacity, setCapacity] = useState(16);

  useEffect(() => {
    const measure = () => {
      if (!window.matchMedia("(min-width: 1024px)").matches) {
        setCapacity(12);
        return;
      }
      const grid = gridRef.current;
      const row = rowRef.current;
      if (!grid || !row) return;
      const rowHeight = row.getBoundingClientRect().height;
      if (rowHeight < 8) return;
      const gap = parseFloat(getComputedStyle(grid).rowGap) || 8;
      const perColumn = Math.floor((grid.clientHeight + gap) / (rowHeight + gap));
      setCapacity(Math.max(6, Math.min(30, perColumn * 2)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    if (gridRef.current) observer.observe(gridRef.current);
    if (rowRef.current) observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, [gridRef, rowRef]);

  return capacity;
}

function useRotatingPage(pageCount: number, intervalMs: number): number {
  const [rawPage, setRawPage] = useState(0);
  useEffect(() => {
    if (pageCount <= 1) return;
    const timer = window.setInterval(() => setRawPage((value) => value + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, pageCount]);
  return rawPage % pageCount;
}

/** Ids whose score moved since the previous snapshot (flash for ~2s). */
function useChangedScores(players: BoardPlayer[]): Set<string> {
  const prev = useRef<Map<string, number> | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const timer = useRef(0);

  useEffect(() => {
    const now = new Map(players.map((p) => [p.id, p.score]));
    const before = prev.current;
    prev.current = now;
    if (!before) return; // first snapshot: nothing to flash

    const moved = new Set<string>();
    now.forEach((score, id) => {
      const old = before.get(id);
      if (old !== undefined && old !== score) moved.add(id);
    });
    if (moved.size === 0) return;

    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setChanged(moved);
      timer.current = window.setTimeout(() => setChanged(new Set()), 2400);
    }, 0);
  }, [players]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return changed;
}

/** Feed ids seen for the first time, so only new lines animate in. */
function useFreshIds(feed: FeedItem[]): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const timer = useRef(0);

  useEffect(() => {
    const ids = feed.map((f) => f.id);
    if (seen.current === null) {
      seen.current = new Set(ids); // first load: no animation wall
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    ids.forEach((id) => seen.current!.add(id));
    if (added.length > 0) {
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setFresh(new Set(added));
        timer.current = window.setTimeout(() => setFresh(new Set()), 900);
      }, 0);
    }
  }, [feed]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return fresh;
}
