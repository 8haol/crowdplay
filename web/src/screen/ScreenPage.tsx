import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { rpc, errorText } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { BoardPlayer, BoardSnapshot, FeedItem } from "../lib/types";
import { colorOf, soloColor } from "../lib/types";
import { ConnDot } from "../lib/ui";
import { SCREEN_PREVIEW } from "./previewData";

/* Projector page. No auth: it is opened on the venue laptop and shown to the
   room. It never receives 4-digit codes (see board_snapshot in SQL), so a
   photo of the screen cannot be used to open somebody's passport. */

const FEED_SHOWN = 14;
const IDENTITY_SHORT: Record<string, string> = { solo: "独行", duo: "二人", trio: "三人" };

export default function ScreenPage() {
  const [searchParams] = useSearchParams();
  const preview = import.meta.env.DEV && searchParams.get("preview") === "1";
  const pollFn = useMemo(() => () => rpc<BoardSnapshot>("board_snapshot", {}), []);
  const poll = usePoll<BoardSnapshot>(preview ? null : pollFn, 3000);
  const data = preview ? SCREEN_PREVIEW : poll.data;
  const online = preview ? true : poll.online;
  const error = poll.error;

  if (!data) {
    return (
      <Frame online={online}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="dots font-serif font-black text-[clamp(1.5rem,3vw,3rem)]">
            正在连接现场<span>.</span><span>.</span><span>.</span>
          </div>
          {!online && <div className="text-seal text-lg">{errorText(error)}</div>}
        </div>
      </Frame>
    );
  }

  return (
    <Frame online={online} data={data}>
      {data.phase === "waiting" ? (
        <Lobby data={data} />
      ) : (
        <div className="grid grid-cols-1 gap-8 px-4 pb-24 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_clamp(340px,26vw,460px)] lg:gap-[clamp(0.75rem,1.4vw,1.75rem)] lg:px-[clamp(0.75rem,1.6vw,2rem)] lg:pb-[clamp(0.75rem,1.4vw,1.75rem)]">
          <Board players={data.players} ended={data.phase === "ended"} />
          <Ticker feed={data.feed} />
        </div>
      )}
    </Frame>
  );
}

/* ------------------------------------------------------------------ shell */

function Frame(props: { online: boolean; data?: BoardSnapshot; children: React.ReactNode }) {
  return (
    <div className="screen-stage relative min-h-dvh overflow-x-hidden text-ink lg:flex lg:h-dvh lg:min-h-0 lg:flex-col lg:overflow-hidden">
      <div className="night-sky" />
      <div className="relative z-10 flex min-h-dvh flex-col lg:h-full lg:min-h-0">
        <Header online={props.online} data={props.data} />
        {props.children}
      </div>
    </div>
  );
}

function Header({ online, data }: { online: boolean; data?: BoardSnapshot }) {
  const elapsed = useElapsed(data?.started_at ?? null);
  const phase = data?.phase;
  return (
    <header className="flex flex-col gap-3 pr-4 pl-[4.5rem] pb-5 pt-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6 lg:pr-[clamp(0.75rem,1.6vw,2rem)] lg:pl-[5rem] lg:pb-[clamp(0.5rem,1vw,1rem)] lg:pt-[clamp(0.75rem,1.4vw,1.5rem)]">
      <div className="flex items-end justify-between gap-3 lg:justify-start lg:gap-[clamp(0.75rem,1.5vw,1.75rem)]">
        <div>
          <div className="text-[9px] font-black tracking-[0.36em] text-foil-dim lg:text-[clamp(0.5rem,0.75vw,0.8rem)] lg:tracking-[0.5em]">
            LIFE PASSPORT · LIVE
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
            <Stat label="已盖章" value={data.stats.stamps} />
            <Stat label="人生事件" value={data.stats.life_events} />
            <Stat label="最高分" value={data.stats.top_score} foil />
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

function Lobby({ data }: { data: BoardSnapshot }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-[clamp(1rem,2vw,2.5rem)] px-8 pb-10">
      <div className="text-center">
        <div className="tabular font-serif font-black text-[clamp(4rem,14vw,16rem)] leading-none tracking-[-0.08em] text-ink">
          {data.stats.players}
        </div>
        <div className="text-moon-dim text-[clamp(0.9rem,1.6vw,1.8rem)] tracking-[0.3em] mt-2">
          位旅客已登记
        </div>
      </div>

      <p className="text-moon-dim text-[clamp(0.8rem,1.3vw,1.4rem)] text-center leading-relaxed">
        打开活动页面 · 输入主持人公布的入场口令 · 领取你的 4 位护照编号
        <br />
        <span className="dots text-moon-dim/70">
          等待主持人宣布启程<span>.</span><span>.</span><span>.</span>
        </span>
      </p>

      {data.players.length > 0 && (
        <div className="w-full max-w-[min(92vw,1600px)] flex flex-wrap justify-center gap-[clamp(0.35rem,0.7vw,0.8rem)]">
          {data.players.map((p, i) => (
            <span
              key={p.id}
              className="rise rounded-full bg-white px-[clamp(0.6rem,1vw,1.1rem)] py-[clamp(0.2rem,0.4vw,0.5rem)] text-[clamp(0.7rem,1.1vw,1.2rem)] font-bold shadow-[0_2px_0_#e0a800]"
              style={{ "--i": Math.min(i, 18) } as React.CSSProperties}
            >
              {p.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- departures board */

function Board({ players, ended }: { players: BoardPlayer[]; ended: boolean }) {
  const changed = useChangedScores(players);
  const n = players.length;
  const pinnedCount = Math.min(3, n);
  const rotatingPageSize = 13;
  const pageCount = Math.max(1, Math.ceil(Math.max(0, n - pinnedCount) / rotatingPageSize));
  const page = useRotatingPage(pageCount);
  const visible = useMemo(() => {
    const pinned = players.slice(0, pinnedCount);
    const rotating = players.slice(
      pinnedCount + page * rotatingPageSize,
      pinnedCount + (page + 1) * rotatingPageSize,
    );
    return [...pinned, ...rotating];
  }, [page, pinnedCount, players]);
  const rows = Math.ceil(visible.length / 2) || 1;

  const ranks = useMemo(() => {
    const result = new Map<string, number>();
    let rank = 0;
    let previousScore: number | null = null;
    players.forEach((player, index) => {
      if (previousScore !== player.score) rank = index + 1;
      result.set(player.id, rank);
      previousScore = player.score;
    });
    return result;
  }, [players]);
  const ranked = visible.map((player) => ({ player, rank: ranks.get(player.id) ?? 0 }));

  return (
    <section className="screen-board min-h-0 flex flex-col">
      <div className="flex items-baseline justify-between mb-[clamp(0.35rem,0.7vw,0.9rem)]">
        <h2 className="font-serif font-black text-[clamp(1rem,1.7vw,2rem)]">
          {ended ? "最终成绩" : "旅程进度"}
        </h2>
        <span aria-live="polite" className="font-mono text-[clamp(0.55rem,0.8vw,0.85rem)] tracking-[0.12em] text-moon-dim">
          {pageCount > 1 ? `前三名固定 · 第 ${page + 1}/${pageCount} 组` : "DEPARTURES"}
        </span>
      </div>

      <div className="flex-1 min-h-0">
        <div
          className="board-grid h-full grid content-start gap-2 lg:gap-[clamp(0.2rem,0.4vw,0.5rem)]"
          style={{
            // column-major: the first column is the top of the standings,
            // which is how people read a leaderboard
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gridTemplateRows: `repeat(${rows}, min-content)`,
            gridAutoFlow: "column",
          }}
        >
          {ranked.map(({ player: p, rank }) => {
            const color = colorOf(p.color_group) ?? (p.identity === "solo" ? soloColor(p.id) : null);
            const isLead = rank === 1 && p.score > 0;
            const flashed = changed.has(p.id);
            return (
              <div
                key={p.id}
                className={`${flashed ? "row-flash" : ""} screen-player-row flex items-center gap-[clamp(0.3rem,0.6vw,0.8rem)] rounded-xl border px-[clamp(0.4rem,0.7vw,0.9rem)] ${
                  isLead ? "lead-glow border-transparent bg-white" : "border-transparent bg-white/85"
                }`}
                style={{ paddingTop: "clamp(0.42rem,0.52vw,0.65rem)", paddingBottom: "clamp(0.42rem,0.52vw,0.65rem)" }}
              >
                <span
                  className={`screen-player-rank tabular shrink-0 text-center font-serif font-black ${
                    rank <= 3 ? "text-seal" : "text-moon-dim/60"
                  }`}
                  style={{ fontSize: "clamp(0.85rem,1.05vw,1.2rem)", width: "2rem" }}
                >
                  {rank}
                </span>

                <span
                  className="screen-player-dot shrink-0 rounded-full"
                  style={{
                    width: "clamp(0.55rem,0.7vw,0.8rem)",
                    height: "clamp(0.55rem,0.7vw,0.8rem)",
                    background: color ? color.hex : "transparent",
                    border: color ? undefined : "1px solid oklch(0.72 0.02 265 / 0.4)",
                  }}
                  title={color?.zh ?? "Solo"}
                />

                <span className="min-w-0 flex-1">
                  <span
                    className="screen-player-name block truncate font-bold leading-tight"
                    style={{ fontSize: "clamp(0.92rem,1.2vw,1.35rem)" }}
                  >
                    {p.name}
                  </span>
                  <span
                    className="screen-player-meta block truncate text-moon-dim leading-tight"
                    style={{ fontSize: "clamp(0.65rem,0.78vw,0.86rem)" }}
                  >
                    {p.identity ? IDENTITY_SHORT[p.identity] : "未分配"} · {p.stations_done}/7
                    {p.locked && <span className="text-seal font-bold"> · 盲盒中</span>}
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
          {n === 0 && (
            <div className="text-moon-dim text-[clamp(0.8rem,1.2vw,1.3rem)]">还没有旅客</div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ ticker */

function Ticker({ feed }: { feed: FeedItem[] }) {
  const fresh = useFreshIds(feed);
  const shown = feed.slice(0, FEED_SHOWN);

  return (
    <section className="screen-ticker min-h-0 flex flex-col">
      <div className="flex items-baseline justify-between mb-[clamp(0.35rem,0.7vw,0.9rem)]">
        <h2 className="font-serif font-black text-[clamp(1rem,1.7vw,2rem)]">实时播报</h2>
        <span className="font-mono text-[clamp(0.55rem,0.8vw,0.85rem)] tracking-[0.25em] text-moon-dim">
          LIVE FEED
        </span>
      </div>

      {/* The rail holds more lines than fit; a bottom fade makes the cut read
          as "more below" instead of a half-clipped row. */}
      <div
        className="screen-feed-rail flex-1 min-h-0 overflow-hidden rounded-[24px] bg-white/90 p-3 shadow-[0_3px_0_#e0a800] lg:p-[clamp(0.5rem,0.9vw,1.1rem)]"
        style={{
          maskImage: "linear-gradient(to bottom, black 86%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 86%, transparent 100%)",
        }}
      >
        {shown.length === 0 ? (
          <div className="h-full flex items-center justify-center text-moon-dim text-[clamp(0.75rem,1.1vw,1.2rem)]">
            等待第一个人生瞬间
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

interface Line {
  mark: string;
  tone: "foil" | "leaf" | "seal" | "plain";
  body: React.ReactNode;
  chip: string | null;
}

function describe(item: FeedItem): Line {
  if (item.kind === "life_event") {
    const good = item.card === "fortune_double" || item.card === "fortune_plus3";
    const neutral = item.card === "unexpected_married";
    const delta = item.after - item.before;
    return {
      mark: good ? "🎉" : neutral ? "💍" : "🌧",
      tone: good ? "foil" : neutral ? "plain" : "seal",
      body: (
        <>
          <b>{item.name}</b>
          {item.threshold ? ` 在 ${item.threshold} 分关口` : " "}抽到「{item.label}」
        </>
      ),
      chip: delta === 0 ? `${item.after} 分` : `${delta > 0 ? "+" : ""}${delta} → ${item.after} 分`,
    };
  }

  if (item.kind === "attempt") {
    if (item.status === "failed") {
      return {
        mark: "✗",
        tone: "seal",
        body: (
          <>
            <b>{item.name}</b> 在「{item.station}」失手了
          </>
        ),
        chip: `总分 ${item.total}`,
      };
    }
    const perfect = item.score >= 9; // graded max; fixed stations award 6
    return {
      mark: perfect ? "★" : "✓",
      tone: perfect ? "foil" : "leaf",
      body: (
        <>
          <b>{item.name}</b> 在「{item.station}」{perfect ? "拿下满分" : "通过挑战"}
        </>
      ),
      chip: `+${item.score} → ${item.total} 分`,
    };
  }

  const usage = {
    hint: "换了一个提示",
    second_chance: `换到一次重来机会${item.station ? `（${item.station}）` : ""}`,
    grace_card: "领了一张纪念卡",
  }[item.usage];
  return {
    mark: "🪙",
    tone: "foil",
    body: (
      <>
        <b>{item.name}</b> 用掉 Help Token，{usage}
      </>
    ),
    chip: null,
  };
}

const TONE_CLASS = {
  foil: "border-foil-dim/45 text-foil-dim",
  leaf: "border-leaf/40 text-leaf",
  seal: "border-seal/45 text-seal",
  plain: "border-moon/20 text-moon-dim",
} as const;

function FeedLine({ item, fresh }: { item: FeedItem; fresh: boolean }) {
  const line = describe(item);
  return (
    <li
      className={`${fresh ? "feed-in" : ""} flex items-start gap-[clamp(0.4rem,0.7vw,0.8rem)] rounded-xl bg-night-raise/70 px-[clamp(0.5rem,0.8vw,1rem)] py-[clamp(0.35rem,0.6vw,0.75rem)]`}
    >
      <span
        className={`shrink-0 grid place-items-center rounded-lg border h-[clamp(1.3rem,2vw,2.2rem)] w-[clamp(1.3rem,2vw,2.2rem)] text-[clamp(0.65rem,1vw,1.15rem)] ${TONE_CLASS[line.tone]}`}
      >
        {line.mark}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[clamp(0.72rem,1.05vw,1.2rem)] leading-snug">{line.body}</span>
        <span className="flex items-baseline gap-2 mt-0.5">
          {line.chip && (
            <span className="tabular text-[clamp(0.6rem,0.85vw,0.95rem)] font-black text-seal">
              {line.chip}
            </span>
          )}
          <span className="tabular text-[clamp(0.55rem,0.75vw,0.85rem)] text-moon-dim/60">
            {timeOf(item.at)}
          </span>
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

/** Keep the leaders visible while rotating everyone else every eight seconds. */
function useRotatingPage(pageCount: number): number {
  const [rawPage, setRawPage] = useState(0);
  useEffect(() => {
    if (pageCount <= 1) return;
    const timer = window.setInterval(() => setRawPage((value) => value + 1), 8000);
    return () => clearInterval(timer);
  }, [pageCount]);
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
