import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { errorText, newIdemKey, rpc } from "../lib/api";
import type { AttemptInfo, EventStation, LifeEventChoiceResult, PendingLifeEvent, PollResult } from "../lib/types";
import { IDENTITY_SHORT, IDENTITY_ZH, colorOf, journeyProgress, soloColor } from "../lib/types";
import { ConnDot } from "../lib/ui";
import { darken, readableOn } from "../lib/color";
import { useCountUp } from "../lib/useCountUp";
import { FINAL_STAGE_VERSE, GRACE_VERSE, SETBACK_VERSES, pickVerse } from "../lib/scripture";

const STAGE_ZH = ["", "第一段人生", "第二段人生", "最后一段人生"];
const PASSPORT_STYLES = ["cover", "visa", "epass"] as const;
const PASSPORT_PREVIEW_COLORS = [
  { slug: "teal", label: "墨松" },
  { slug: "navy", label: "藏青" },
  { slug: "maroon", label: "酒红" },
  { slug: "orange", label: "橙" },
  { slug: "mint", label: "薄荷" },
  { slug: "gold", label: "金棕" },
] as const;
type PassportStyle = (typeof PASSPORT_STYLES)[number];

export default function Passport(props: {
  data: PollResult;
  /** This event's stations, straight off the poll. */
  stations: EventStation[];
  online: boolean;
  joinToken: string;
}) {
  const { data, stations, online } = props;
  const { player, attempts, life_events } = data;
  const [searchParams, setSearchParams] = useSearchParams();
  const [toast, setToast] = useState<{ text: string; note?: string } | null>(null);
  const prev = useRef<PollResult | null>(null);
  const shownScore = useCountUp(player.score);

  /*
   * The life-event flow owns its own lifetime. It used to render straight off
   * `data.pending_event`, which meant the server clearing the pending row (the
   * moment a choice was submitted) yanked the result screen away on the next
   * 3-second poll — players never got to read what happened to them.
   */
  const [activeEvent, setActiveEvent] = useState<PendingLifeEvent | null>(null);
  const finished = useRef<Set<string>>(new Set());
  const pendingId = data.pending_event?.id ?? null;

  useEffect(() => {
    const incoming = data.pending_event;
    if (!incoming) return;
    if (finished.current.has(incoming.id)) return;
    setActiveEvent((current) => (current?.id === incoming.id ? current : incoming));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId]);

  // Change detection -> toast (poll latency <= 3s is acceptable per spec)
  useEffect(() => {
    const p = prev.current;
    prev.current = data;
    if (!p) return;
    if (data.life_events.length > p.life_events.length) return; // the event screen already said it
    if (data.player.score !== p.player.score) {
      const diff = data.player.score - p.player.score;
      show(diff > 0 ? `+${diff} 分，总分 ${data.player.score}` : `${diff} 分，总分 ${data.player.score}`);
    } else if (p.player.token_available && !data.player.token_available) {
      show("Help Token 已使用");
    } else {
      /* A failed station scores nothing, so the score branch above never fires
         and the phone used to say nothing at all at the one moment the player
         most needs an answer. Transient on purpose: comfort belongs to the
         moment, not stamped onto the station for the rest of the night. */
      const wasFailed = new Set(
        p.attempts.filter((a) => a.status === "failed").map((a) => a.station_id),
      );
      const fresh = data.attempts.find(
        (a) => a.status === "failed" && !wasFailed.has(a.station_id),
      );
      if (fresh) {
        const verse = pickVerse(SETBACK_VERSES, String(fresh.station_id));
        show(`「${verse.text}」`, verse.ref, 6500);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const toastTimer = useRef<number | null>(null);
  function show(text: string, note?: string, ms = 4000) {
    setToast({ text, note });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }

  if (data.phase === "ended") {
    return <Ended data={data} joinToken={props.joinToken} />;
  }

  if (activeEvent) {
    return (
      <LifeEventExperience
        key={activeEvent.id}
        event={activeEvent}
        playerCode={player.code}
        joinToken={props.joinToken}
        stationsTotal={player.stations_total}
        onDone={() => {
          finished.current.add(activeEvent.id);
          setActiveEvent(null);
        }}
      />
    );
  }

  const requestedStyle = searchParams.get("passportStyle");
  const passportStyle: PassportStyle = PASSPORT_STYLES.includes(requestedStyle as PassportStyle)
    ? requestedStyle as PassportStyle
    : "cover";
  const showStylePicker = searchParams.get("preview") === "passport";
  const requestedColor = searchParams.get("passportColor");
  const previewColor = showStylePicker && PASSPORT_PREVIEW_COLORS.some(({ slug }) => slug === requestedColor)
    ? requestedColor
    : null;
  const id = IDENTITY_ZH[player.identity ?? "solo"];
  const color = colorOf(previewColor ?? player.color_group) ?? (player.identity === "solo" ? soloColor(player.code) : null);
  const headerBg = color?.hex ?? "#ffffff";
  const headerInk = color ? readableOn(headerBg) : "#26211b";
  const headerSoft = color ? (headerInk === "#FFFFFF" ? "rgba(255,255,255,.74)" : "rgba(0,0,0,.6)") : "#7d7261";
  const headerLine = headerInk === "#FFFFFF" ? "rgba(255,255,255,.26)" : "rgba(0,0,0,.16)";
  const chipBg = headerInk === "#FFFFFF" ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.62)";
  const pages = visaPages(stations, attempts);
  const journey = journeyProgress(player);

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="night-sky" />
      <div className="relative z-10 pb-12">
        {showStylePicker && (
          <div className="rise mx-auto mt-4 w-[calc(100%-2rem)] max-w-2xl" style={{ "--i": 0 } as React.CSSProperties}>
            <div className="passport-style-picker" aria-label="护照主面板设计方案">
              {([
                ["cover", "01 经典封皮"],
                ["visa", "02 签证内页"],
                ["epass", "03 电子护照"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="pressable"
                  aria-pressed={passportStyle === value}
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.set("passportStyle", value);
                    setSearchParams(next, { replace: true });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {passportStyle === "cover" && (
              <div className="passport-color-picker" aria-label="经典封皮颜色预览">
                <span>队伍色自动套用</span>
                <div>
                  {PASSPORT_PREVIEW_COLORS.map(({ slug, label }) => {
                    const swatch = colorOf(slug);
                    const active = (previewColor ?? player.color_group) === slug;
                    return (
                      <button
                        key={slug}
                        type="button"
                        className="pressable"
                        aria-label={`${label}封皮`}
                        aria-pressed={active}
                        title={label}
                        style={{ "--swatch": swatch?.hex ?? "#888888" } as React.CSSProperties}
                        onClick={() => {
                          const next = new URLSearchParams(searchParams);
                          next.set("passportStyle", "cover");
                          next.set("passportColor", slug);
                          setSearchParams(next, { replace: true });
                        }}
                      >
                        <span aria-hidden="true" />
                        <small>{label}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <PassportHero
          styleName={passportStyle}
          player={player}
          online={online}
          shownScore={shownScore}
          identityName={id.name}
          identityShort={IDENTITY_SHORT[player.identity ?? "solo"]}
          teamColorName={color?.zh ?? null}
          teamColor={headerBg}
          teamInk={headerInk}
          teamSoft={headerSoft}
          teamLine={headerLine}
          teamChip={chipBg}
        />

        {/* status effect notice */}
        {player.status_effect?.type === "cap_next" && (
          <div className="rise mx-auto mt-4 w-[calc(100%-2rem)] max-w-2xl rounded-2xl bg-[#ffefc2] px-4 py-3 text-sm font-black text-[#7a5200]"
               style={{ "--i": 1 } as React.CSSProperties}>
            重感冒卧床中 · 下一站最多得 {player.status_effect.value} 分
          </div>
        )}

        {journey.complete && <FinishedCard player={player} />}

        {/* visa pages */}
        <section className="mx-auto mt-7 max-w-2xl px-4">
          <div className="rise flex items-baseline justify-between" style={{ "--i": 2 } as React.CSSProperties}>
            <h2 className="text-xl font-black">{player.stations_total} 站挑战</h2>
            <span className="tabular text-xs text-moon-dim">
              {player.stations_done} / {player.stations_total}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {pages.map((page, i) => (
              <div
                key={page.key}
                className="rise relative min-h-[108px] rounded-[20px] bg-white p-3.5 shadow-[0_2px_0_#f0e4ce]"
                style={{ "--i": 3 + i } as React.CSSProperties}
              >
                <div className="text-[15px] font-bold">{page.title}</div>
                <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-moon-dim/70">
                  {page.note}
                </div>

                {/* A granted Second Chance outranks the failure it replaces:
                    the station is open again, so a red stamp would be a lie. */}
                {page.state === "retry" ? (
                  <VisaStamp tone="retry" big={<RetryGlyph />} small="再挑战" />
                ) : page.state === "passed" ? (
                  <VisaStamp tone="pass" big={`+${page.score}`} small="通过" />
                ) : page.state === "failed" ? (
                  <VisaStamp tone="fail" big="✗" small="未通过" />
                ) : (
                  <div className="absolute right-3 bottom-3 h-9 w-9 rounded-full bg-night-raise" />
                )}
              </div>
            ))}
          </div>
        </section>

        {/* grace token */}
        <section className="mx-auto mt-6 max-w-2xl px-4">
          <div
            className={`rise flex items-center justify-between rounded-[24px] px-5 py-4 ${
              player.token_available ? "bg-[#ffefc2]" : "bg-night-raise"
            }`}
            style={{ "--i": 10 } as React.CSSProperties}
          >
            <div>
              <div className="flex items-center gap-2 font-bold">
                Help Token
                <span className={`rounded px-1.5 py-0.5 text-[10px] tracking-[0.2em] ${
                  player.token_available ? "bg-foil text-ink" : "bg-card text-ink-dim"
                }`}>
                  {player.token_available ? "可用" : "已用"}
                </span>
              </div>
              {player.token_available ? (
                <div className="mt-1 text-xs text-moon-dim">
                  整队可领实体恩典卡 / 重挑已玩站点；也可随时换纪念卡
                </div>
              ) : (
                /* The token is spent, so the slot is free — and this is the one
                   place a verse is earned rather than decorative: the card that
                   held the grace now holds the line it stood for, still there
                   to re-read for the rest of the night. */
                <div className="mt-1.5">
                  <div className="text-[13px] font-black leading-snug text-ink">
                    「{GRACE_VERSE.text}」
                  </div>
                  <div className="mt-0.5 text-[10px] font-bold tracking-[0.16em] text-moon-dim">
                    {GRACE_VERSE.ref}
                  </div>
                </div>
              )}
            </div>
            <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-full text-[11px] font-black shadow-[inset_0_0_0_4px_rgba(255,255,255,.55),0_3px_0_#e0a800] ${player.token_available ? "bg-foil text-[#5c3d00]" : "bg-[#e1d5be] text-[#9f9278] line-through shadow-none"}`}>HELP</div>
          </div>
        </section>

        {/* life events */}
        {life_events.length > 0 && (
          <section className="mx-auto mt-7 max-w-2xl px-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-black">人生大事记</h2>
              <span className="tabular text-xs text-moon-dim">
                {player.life_events_done} / {player.life_events_total}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {life_events.map((e, i) => {
                const delta = e.score_after - e.score_before;
                return (
                  <div key={i} className="rounded-2xl bg-white px-4 py-3 shadow-[0_2px_0_#f0e4ce]">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-[11px] font-black tracking-[0.12em] text-ink-dim">
                        {e.stage ? STAGE_ZH[e.stage] ?? "人生事件" : "人生事件"}
                        {e.scene_title && <span className="ml-1.5 font-bold">· {e.scene_title}</span>}
                      </div>
                      <div className={`tabular shrink-0 text-sm font-black ${delta > 0 ? "text-leaf-deep" : delta < 0 ? "text-seal" : "text-ink-dim"}`}>
                        {delta === 0 ? "±0" : `${delta > 0 ? "+" : ""}${delta}`}
                      </div>
                    </div>
                    {e.choice_label && (
                      <div className="mt-1.5 text-xs font-bold text-ink-dim">你的选择：{e.choice_label}</div>
                    )}
                    <div className="mt-1 text-[15px] font-black">{e.card_label}</div>
                    {e.outcome_detail && <div className="mt-1 text-xs font-semibold leading-5 text-moon-dim">{e.outcome_detail}</div>}
                    <div className="tabular mt-1.5 text-sm text-moon-dim">
                      {e.score_before} → <span className="font-black text-ink">{e.score_after}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {toast && (
          <div className="toast-in fixed inset-x-5 bottom-6 z-50 mx-auto max-w-xl rounded-2xl bg-ink px-4 py-3.5 text-center font-black text-white shadow-[0_12px_32px_rgba(38,33,27,.24)]">
            {toast.text}
            {toast.note && (
              <div className="mt-1 text-[10px] font-bold tracking-[0.18em] text-white/55">
                {toast.note}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- passport hero */

type PassportHeroProps = {
  styleName: PassportStyle;
  player: PollResult["player"];
  online: boolean;
  shownScore: number;
  identityName: string;
  identityShort: string;
  teamColorName: string | null;
  teamColor: string;
  teamInk: string;
  teamSoft: string;
  teamLine: string;
  teamChip: string;
};

function PassportHero(props: PassportHeroProps) {
  if (props.styleName === "visa") return <VisaPageHero {...props} />;
  if (props.styleName === "epass") return <ElectronicPassportHero {...props} />;
  return <ClassicCoverHero {...props} />;
}

export function PassportGlobe({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" role="img" aria-label="人生护照地球纹章">
      <circle cx="60" cy="60" r="46" fill="none" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="60" cy="60" rx="20" ry="46" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18 45h84M16 60h88M18 75h84M60 14v92" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M28 28c15 11 49 11 64 0M28 92c15-11 49-11 64 0" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 5" />
    </svg>
  );
}

function ClassicCoverHero(props: PassportHeroProps) {
  const { player } = props;
  return (
    <header
      className="passport-panel passport-cover rise"
      style={{
        "--i": 0,
        "--passport-accent": props.teamColor,
        "--passport-accent-dark": darken(props.teamColor, 0.32),
        "--passport-cover-ink": props.teamInk,
        "--passport-cover-soft": props.teamSoft,
        "--passport-cover-line": props.teamLine,
      } as React.CSSProperties}
    >
      <span className="passport-cover__spine" aria-hidden="true" />
      <div className="passport-cover__topline">
        <span>THE REPUBLIC OF LIFE</span>
        <span className="flex items-center gap-1.5"><ConnDot online={props.online} /> VALID</span>
      </div>

      <div className="passport-cover__title">
        <PassportGlobe className="passport-cover__emblem" />
        <div>
          <div className="passport-cover__zh">人生护照</div>
          <div className="passport-cover__en">LIFE PASSPORT</div>
        </div>
        <div className="passport-cover__score" aria-label={`我的总分 ${props.shownScore}`}>
          <span>总分</span>
          <strong className="tabular">{props.shownScore}</strong>
        </div>
      </div>

      <div className="passport-cover__holder">
        <div>
          <span>持照人 / HOLDER</span>
          <strong>{player.name}</strong>
        </div>
        <div>
          <span>旅行身份 / CLASS</span>
          <strong>{props.identityName}{props.teamColorName ? ` · ${props.teamColorName}` : ""}</strong>
        </div>
      </div>

      <JourneyStrip player={player} inkColor={props.teamInk} softColor={props.teamSoft} lineColor={props.teamLine} />

      <div className="passport-cover__credential">
        <div>
          <span>人生编号 · 现场报这个</span>
          <strong className="tabular">{player.code}</strong>
        </div>
        {player.teammates.length > 0 && (
          <div className="passport-cover__companions">
            <span>同行 · {props.identityShort}队</span>
            <strong>{player.teammates.join(" / ")}</strong>
          </div>
        )}
      </div>
    </header>
  );
}

function VisaPageHero(props: PassportHeroProps) {
  const { player } = props;
  return (
    <header
      className="passport-panel passport-visa rise"
      style={{ "--i": 0, "--passport-accent": props.teamColor } as React.CSSProperties}
    >
      <div className="passport-visa__binding" aria-hidden="true" />
      <div className="passport-visa__heading">
        <div>
          <span>PERSONAL PARTICULARS</span>
          <strong>人生旅行证件</strong>
        </div>
        <div className="text-right">
          <span className="flex items-center justify-end gap-1.5"><ConnDot online={props.online} /> LIVE RECORD</span>
          <strong className="tabular">P · {player.code}</strong>
        </div>
      </div>

      <div className="passport-visa__identity">
        <div className="passport-visa__portrait">
          <span>{player.name.slice(0, 1)}</span>
          <small>持照人</small>
        </div>
        <dl className="passport-visa__fields">
          <div><dt>姓名 / NAME</dt><dd>{player.name}</dd></div>
          <div><dt>旅行身份 / CLASS</dt><dd>{props.identityName}</dd></div>
          <div><dt>同行者 / COMPANIONS</dt><dd>{player.teammates.length ? player.teammates.join("、") : "独立旅行"}</dd></div>
          <div><dt>签发状态 / STATUS</dt><dd>{props.teamColorName ? `${props.teamColorName} · ` : ""}旅程进行中</dd></div>
        </dl>
        <div className="passport-visa__stamp">
          <span>POINTS</span>
          <strong className="tabular">{props.shownScore}</strong>
          <span>VALID SCORE</span>
        </div>
      </div>

      <JourneyStrip player={player} inkColor="#314c52" softColor="#756b5b" lineColor="#c9bda7" />

      <div className="passport-visa__mrz" aria-label={`人生编号 ${player.code}`}>
        <span>P&lt;LIFE&lt;{player.name.replace(/\s/g, "<")}&lt;&lt;&lt;{props.identityShort}&lt;&lt;&lt;&lt;&lt;&lt;</span>
        <span>{player.code}LIFE{String(player.stations_done).padStart(2, "0")}{String(player.life_events_done).padStart(2, "0")}&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</span>
      </div>
    </header>
  );
}

function PassportChip() {
  return (
    <svg viewBox="0 0 76 58" aria-hidden="true">
      <rect x="2" y="2" width="72" height="54" rx="11" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M27 3v52M49 3v52M3 20h21l8 9-8 9H3M73 20H52l-8 9 8 9h21" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ElectronicPassportHero(props: PassportHeroProps) {
  const { player } = props;
  return (
    <header
      className="passport-panel passport-epass rise"
      style={{ "--i": 0, "--passport-accent": props.teamColor } as React.CSSProperties}
    >
      <div className="passport-epass__scan" aria-hidden="true" />
      <div className="passport-epass__heading">
        <div>
          <span>DIGITAL TRAVEL DOCUMENT</span>
          <strong>人生护照</strong>
        </div>
        <div className="passport-epass__status"><ConnDot online={props.online} /> ACTIVE</div>
      </div>

      <div className="passport-epass__main">
        <div className="passport-epass__chip"><PassportChip /></div>
        <div className="passport-epass__holder">
          <span>HOLDER · P/{player.code}</span>
          <strong>{player.name}</strong>
          <small>{props.identityName}{props.teamColorName ? ` · ${props.teamColorName}` : ""}</small>
        </div>
        <div className="passport-epass__score">
          <span>CURRENT SCORE</span>
          <strong className="tabular">{props.shownScore}</strong>
        </div>
      </div>

      <JourneyStrip player={player} inkColor="#f5e6b8" softColor="rgba(245,230,184,.68)" lineColor="rgba(245,230,184,.22)" />

      <div className="passport-epass__footer">
        <div>
          <span>人生编号 · 现场报这个</span>
          <strong className="tabular">{player.code}</strong>
        </div>
        {player.teammates.length > 0 && (
          <div>
            <span>COMPANIONS · {props.identityShort}</span>
            <strong>{player.teammates.join(" / ")}</strong>
          </div>
        )}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ journey */

/**
 * Milestone strip: one pip per station, one star per life event, laid out in
 * the order they actually happen. This replaced a bar driven by the score,
 * which could read "complete" after three stations and hid how much of the
 * journey was left.
 */
function JourneyStrip({
  player,
  inkColor,
  softColor,
  lineColor,
}: {
  player: PollResult["player"];
  inkColor: string;
  softColor: string;
  lineColor: string;
}) {
  const journey = journeyProgress(player);
  const pips = useMemo(() => buildJourney(player), [player]);
  const filledInk = inkColor === "#FFFFFF" ? "#FFFFFF" : "#26211b";

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[11px]" style={{ color: softColor }}>
        <span className="font-bold">
          {journey.complete
            ? `旅程已经走完 · ${player.stations_total} 站与 3 段人生`
            : player.next_event_stage
              ? `下一段人生 · ${player.next_event_score} 分或第 ${player.next_event_after_station} 站，先到即触发`
              : "继续完成剩下的站点"}
        </span>
        <span className="tabular shrink-0 font-black">{journey.done} / {journey.total}</span>
      </div>
      <div className="flex items-center gap-1">
        {pips.map((pip) => (
          <span
            key={pip.key}
            title={pip.label}
            className={pip.kind === "event" ? "grid shrink-0 place-items-center" : "flex-1"}
            style={
              pip.kind === "event"
                ? {
                    width: "1.15rem",
                    height: "1.15rem",
                    borderRadius: "999px",
                    fontSize: "0.6rem",
                    fontWeight: 900,
                    background: pip.done ? "#ffc838" : pip.pending ? "#ffffff" : "transparent",
                    color: pip.done ? "#26211b" : pip.pending ? "#c4402a" : softColor,
                    boxShadow: pip.done || pip.pending ? "none" : `inset 0 0 0 1.5px ${lineColor}`,
                  }
                : {
                    height: "0.5rem",
                    borderRadius: "999px",
                    background: pip.done ? filledInk : lineColor,
                  }
            }
          >
            {pip.kind === "event" ? (pip.done ? "★" : pip.pending ? "!" : "") : null}
          </span>
        ))}
      </div>
    </div>
  );
}

type JourneyPip = {
  key: string;
  kind: "station" | "event";
  done: boolean;
  pending: boolean;
  label: string;
};

/** Interleave station pips and event stars at the same unlock points the
 *  database uses (`_stage_unlock_at`), so the strip never lies about order. */
function buildJourney(player: PollResult["player"]): JourneyPip[] {
  const total = Math.max(1, player.stations_total);
  const unlocks = [stageUnlockLabel(1, total), stageUnlockLabel(2, total), stageUnlockLabel(3, total)];
  const pips: JourneyPip[] = [];
  for (let station = 1; station <= total; station++) {
    pips.push({
      key: `s${station}`,
      kind: "station",
      done: station <= player.stations_done,
      pending: false,
      label: `第 ${station} 站`,
    });
    unlocks.forEach((unlockAt, index) => {
      if (unlockAt !== station) return;
      const stage = index + 1;
      pips.push({
        key: `e${stage}`,
        kind: "event",
        done: stage <= player.life_events_done,
        pending: player.pending_stage === stage,
        label: STAGE_ZH[stage] ?? `人生事件 ${stage}`,
      });
    });
  }
  return pips;
}

/** Shown once every station and every life event is on the record. */
function FinishedCard({ player }: { player: PollResult["player"] }) {
  return (
    <section className="mx-auto mt-5 w-[calc(100%-2rem)] max-w-2xl">
      <div
        className="rise rounded-[24px] px-5 py-5"
        style={{
          "--i": 1,
          background: player.token_available ? "#ffefc2" : "#ffffff",
          boxShadow: player.token_available ? "0 3px 0 #e0a800" : "0 3px 0 #f0e4ce",
        } as React.CSSProperties}
      >
        <div className="text-[10px] font-black tracking-[0.3em] text-[#806321]">JOURNEY COMPLETE</div>
        <h2 className="mt-1.5 text-[22px] font-black leading-tight">
          {player.stations_total} 站与 3 段人生，都走过了
        </h2>
        {player.token_available ? (
          <>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink-dim">
              你的 Help Token 还没有用掉。带着护照去<b className="text-ink">恩典站</b>，
              可以换一张属于你的纪念卡 —— 现在就能换，不用等活动结束。
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-ink px-4 py-2 text-sm font-black text-white">🪙 去恩典站换纪念卡</span>
              <span className="tabular text-xs font-bold text-ink-dim">报你的编号 {player.code}</span>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm font-semibold leading-6 text-ink-dim">
            Token 也已经用掉了 —— 这一程你没有独自走完。
            <br />
            接下来找个位置歇一会儿，等主持人宣布最终成绩和颁奖。
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * One visa page of the passport: a main station of this event, plus whatever
 * stamp the player has earned on it.
 *
 * The roster is per-event and comes down with the poll (`poll_player_by_link`
 * -> `stations`), so the names here are the event's own snapshot: a station
 * renamed for tonight reads tonight's name, and one withdrawn mid-event stops
 * taking up a page — which is the same set `player.stations_total` counts.
 */
interface VisaPage {
  key: string;
  title: string;
  note: string;
  state: "passed" | "failed" | "retry" | "blank";
  score: number;
}

function visaPages(stations: EventStation[], attempts: AttemptInfo[]): VisaPage[] {
  /* A granted Second Chance outranks the failure it replaces: the station is
     open again, so a red stamp would be a lie. */
  const stateOf = (stationId: number): Pick<VisaPage, "state" | "score"> => {
    const at = (status: AttemptInfo["status"]) =>
      attempts.find((a) => a.station_id === stationId && a.status === status);
    if (at("retry_granted")) return { state: "retry", score: 0 };
    const passed = at("passed");
    if (passed) return { state: "passed", score: passed.score };
    return at("failed") ? { state: "failed", score: 0 } : { state: "blank", score: 0 };
  };

  return stations
    .filter((station) => station.type === "main")
    .map((station, index) => ({
      key: String(station.id),
      title: station.name_zh,
      note: `NO.${String(index + 1).padStart(2, "0")}`,
      ...stateOf(station.id),
    }));
}

/*
 * A rotate arrow, inline so it inherits the stamp's currentColor and stays
 * crisp at 15px. The passport keeps emoji out of its own pages — every other
 * mark on this card is drawn, so a system emoji would be the one foreign glyph.
 */
function RetryGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[15px] w-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

/**
 * `pass` and `fail` are settled: ink is on the page, so both rings are solid.
 * `retry` is the opposite — the Second Chance reopened this station and nothing
 * has been recorded yet. It keeps the stamp's size and slot so the grid stays
 * even, but draws the rings dashed: an empty frame waiting for a stamp, not a
 * verdict of its own.
 */
function VisaStamp({ tone, big, small }: { tone: "pass" | "fail" | "retry"; big: React.ReactNode; small: string }) {
  const cls =
    tone === "pass"
      ? "border-leaf text-leaf"
      : tone === "fail"
        ? "border-seal text-seal"
        : "border-foil-dim text-foil-dim";
  /* Only the outer ring breaks. One dashed edge says "no stamp here yet";
     dashing both turned the mark into noise at reading distance. */
  const ring = tone === "retry" ? "border-dashed" : "";
  return (
    <div className={`stamp-in absolute right-2 bottom-2 h-[60px] w-[60px] rounded-full border-2 ${ring} ${cls} flex items-center justify-center`}>
      <div className={`h-[48px] w-[48px] rounded-full border ${cls} opacity-90 flex flex-col items-center justify-center`}>
        <span className="tabular font-serif font-black text-lg leading-none">{big}</span>
        <span className="text-[9px] font-bold tracking-[0.15em] mt-0.5">{small}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- life event */

/**
 * Three deliberate beats — announcement, choice, result — each needing a tap to
 * leave. Nothing here re-reads `pending_event`: once mounted the component runs
 * to the end, so a poll that clears the server-side row cannot snatch the
 * result away before it has been read.
 */
function LifeEventExperience(props: {
  event: PendingLifeEvent;
  playerCode: string;
  joinToken: string;
  stationsTotal: number;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"announce" | "choose">("announce");
  const [chosen, setChosen] = useState<string | null>(null);
  const [result, setResult] = useState<LifeEventChoiceResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const stageName = STAGE_ZH[props.event.stage] ?? "人生事件";

  const choose = async (choiceKey: string) => {
    if (chosen) return;
    setChosen(choiceKey);
    setErr(null);
    if (props.joinToken === "preview") {
      const choice = props.event.choices.find((item) => item.key === choiceKey)!;
      window.setTimeout(() => setResult({ event_id: props.event.id, stage: props.event.stage, scene_title: props.event.title, choice_label: choice.label, outcome_key: "preview", outcome_label: "小小试验打开了新方向", outcome_detail: "你们没有急着争出唯一答案，而是先试了一步。结果比继续讨论更有用。", tone: "good", score_before: 45, score_after: 51, delta: 6, next_event_stage: null, next_pending_event_id: null }), 650);
      return;
    }
    try {
      const outcome = await rpc<LifeEventChoiceResult>("choose_life_event_by_link", {
        p_join_token: props.joinToken,
        p_player_code: props.playerCode,
        p_event_id: props.event.id,
        p_choice_key: choiceKey,
        p_idempotency_key: newIdemKey(),
      });
      setResult(outcome);
    } catch (error) {
      setChosen(null);
      setErr(errorText(error));
    }
  };

  /* ---- beat 3: the result, held until the player taps away ---- */
  if (result) {
    const deltaLabel = result.delta === 0 ? "分数不变" : `${result.delta > 0 ? "+" : ""}${result.delta} 人生分`;
    const accent = result.tone === "good" ? "#2f8a56" : result.tone === "bad" ? "#bd4332" : "#b58b24";
    return (
      <div className="relative min-h-dvh overflow-hidden bg-[#f6efe3] text-ink">
        <div className="night-sky" />
        <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10 text-center">
          <div className="seal-slam mx-auto grid h-24 w-24 place-items-center rounded-[30px] text-5xl shadow-[0_5px_0_rgba(38,33,27,.14)]" style={{ background: accent }}>
            {result.tone === "good" ? "✨" : result.tone === "bad" ? "🌧️" : "✦"}
          </div>
          <p className="rise mt-7 text-[10px] font-black tracking-[0.35em] text-ink-dim" style={{ "--i": 1 } as React.CSSProperties}>
            {stageName} · RESULT
          </p>
          <h1 className="rise mt-2 text-3xl font-black leading-tight" style={{ "--i": 2 } as React.CSSProperties}>{result.outcome_label}</h1>
          <p className="rise mx-auto mt-3 max-w-sm text-sm font-semibold leading-7 text-ink-dim" style={{ "--i": 3 } as React.CSSProperties}>{result.outcome_detail}</p>
          <section className="rise mt-7 rounded-[28px] bg-white p-6 text-left shadow-[0_4px_0_#e0a800]" style={{ "--i": 4 } as React.CSSProperties}>
            <div className="text-[10px] font-black tracking-[0.18em] text-ink-dim">{result.scene_title}</div>
            <div className="mt-1 text-lg font-black">你选了「{result.choice_label}」</div>
            <div className="mt-5 flex items-end justify-between border-t-2 border-dashed border-line pt-5">
              <div>
                <div className="text-xs font-bold text-ink-dim">{deltaLabel}</div>
                <div className="tabular mt-1 text-sm font-bold text-ink-dim">{result.score_before} → {result.score_after}</div>
              </div>
              <div className="tabular text-6xl font-black leading-none" style={{ color: accent }}>{result.score_after}</div>
            </div>
          </section>
          <button
            className="rise pressable mt-6 rounded-full bg-ink px-6 py-4 font-black text-white shadow-[0_4px_0_#0f0d0a]"
            style={{ "--i": 5 } as React.CSSProperties}
            onClick={props.onDone}
          >
            {result.next_pending_event_id ? "收下这段人生，下一段已经在等 →" : "收下这段人生，回到护照 →"}
          </button>
          <p className="rise mt-3 text-xs font-semibold text-ink-dim" style={{ "--i": 6 } as React.CSSProperties}>
            这一段已经写进你的人生大事记，随时可以回去看。
          </p>
        </main>
      </div>
    );
  }

  /* ---- beat 1: the announcement, full screen, needs a tap ---- */
  if (step === "announce") {
    return (
      <div className="relative min-h-dvh overflow-hidden bg-foil text-ink">
        <div className="night-sky" />
        <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10 text-center">
          <div className="bloom mx-auto grid h-28 w-28 place-items-center rounded-[34px] bg-white text-6xl shadow-[0_6px_0_#d19c13]">
            {props.event.emoji}
          </div>
          <p className="rise mt-8 text-[11px] font-black tracking-[0.4em] text-[#7a5200]" style={{ "--i": 1 } as React.CSSProperties}>
            LIFE EVENT · 人生关口
          </p>
          <h1 className="rise mt-3 text-[40px] font-black leading-[1.06] tracking-[-0.05em]" style={{ "--i": 2 } as React.CSSProperties}>
            你走到了
            <br />
            {stageName}
          </h1>
          <p className="rise mx-auto mt-4 max-w-xs text-sm font-semibold leading-7 text-[#5c4a24]" style={{ "--i": 3 } as React.CSSProperties}>
            {props.event.stage === 3
              ? "走到这里，人生给你留了最后一道岔路。"
              : "走到这个关口，人生递给你一件事。"}
            <br />
            准备好了再打开 —— 打开后需要做一个选择。
          </p>
          {/* Only the last stage carries a verse. Printing one on every life
              event would make it wallpaper; arriving at the final fork is the
              beat that earns a word about handing things over. */}
          {props.event.stage === 3 && (
            <div className="rise mt-7" style={{ "--i": 4 } as React.CSSProperties}>
              <div className="mx-auto h-px w-10 bg-[#7a5200]/25" />
              <p className="mt-4 text-[15px] font-black leading-relaxed text-[#5c4a24]">
                「{FINAL_STAGE_VERSE.text}」
              </p>
              <p className="mt-1.5 text-[10px] font-bold tracking-[0.22em] text-[#7a5200]/75">
                {FINAL_STAGE_VERSE.ref}
              </p>
            </div>
          )}
          <button
            className="rise pressable mt-9 rounded-full bg-ink px-6 py-4 text-[15px] font-black text-white shadow-[0_4px_0_#0f0d0a]"
            style={{ "--i": 5 } as React.CSSProperties}
            onClick={() => setStep("choose")}
          >
            打开这段人生 →
          </button>
          <p className="rise mt-3 text-[11px] font-semibold text-[#7a5200]" style={{ "--i": 6 } as React.CSSProperties}>
            队伍不会因为你停下，可以边走边处理。
          </p>
        </main>
      </div>
    );
  }

  /* ---- beat 2: the scene and its two actions ---- */
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#efe4d3] text-ink">
      <div className="night-sky" />
      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
        <header className="text-center">
          <div className="seal-slam mx-auto grid h-20 w-20 place-items-center rounded-[26px] bg-foil text-4xl shadow-[0_5px_0_#d19c13]">{props.event.emoji}</div>
          <p className="rise mt-6 text-[10px] font-black tracking-[0.35em] text-ink-dim" style={{ "--i": 1 } as React.CSSProperties}>{stageName} · LIFE EVENT</p>
          <h1 className="rise mt-2 text-[34px] font-black leading-tight tracking-[-0.04em]" style={{ "--i": 2 } as React.CSSProperties}>{props.event.title}</h1>
        </header>
        <section className="rise mt-6 rounded-[28px] bg-white p-6 shadow-[0_4px_0_#e0a800]" style={{ "--i": 3 } as React.CSSProperties}>
          <p className="text-[17px] font-bold leading-8">{props.event.prompt}</p>
          <div className="mt-6 space-y-3">
            {props.event.choices.map((choice, index) => (
              <button
                key={choice.key}
                disabled={Boolean(chosen)}
                onClick={() => choose(choice.key)}
                className={`pressable flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left font-black transition-all disabled:opacity-60 ${chosen === choice.key ? "border-ink bg-ink text-white" : "border-line bg-[#fbf7f0] hover:border-ink/40"}`}
              >
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm ${chosen === choice.key ? "bg-white/15" : "bg-foil/25"}`}>{index + 1}</span>
                <span>{choice.label}</span>
                {chosen === choice.key && <span className="dots ml-auto">揭晓<span>.</span><span>.</span><span>.</span></span>}
              </button>
            ))}
          </div>
          {err && <div className="mt-4 rounded-xl bg-seal/10 px-3 py-2.5 text-sm font-bold text-seal">{err}</div>}
        </section>
        <p className="rise mt-4 px-4 text-center text-xs font-semibold leading-5 text-ink-dim" style={{ "--i": 4 } as React.CSSProperties}>没有固定正确答案。同一个行动，每次也可能走向不同结果。</p>
      </main>
    </div>
  );
}

/** Mirror of the SQL `_stage_unlock_at`: stations completed before a stage opens. */
function stageUnlockLabel(stage: number, total: number): number {
  const safeTotal = Math.max(1, total);
  if (stage === 1) return Math.max(1, Math.round((safeTotal * 3) / 7));
  if (stage === 2) return Math.max(2, Math.round((safeTotal * 5) / 7));
  return safeTotal;
}

/* ------------------------------------------------------------------- ended */

function Ended({ data, joinToken }: { data: PollResult; joinToken: string }) {
  const { player, rank, team } = data;
  return (
    <div className="brand-stage relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center p-6 text-center">
        <p className="rise text-[11px] font-black tracking-[0.45em] text-foil-dim" style={{ "--i": 0 } as React.CSSProperties}>
          JOURNEY COMPLETE · 旅程完成
        </p>
        <h1 className="rise mt-2 text-4xl font-black" style={{ "--i": 1 } as React.CSSProperties}>
          这是你走过的人生
        </h1>

        <div
          className="rise mt-9 w-full max-w-xs rounded-[32px] bg-white px-8 py-9 shadow-[0_5px_0_#e0a800]"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <div className="text-sm text-moon-dim">{player.name} 的最终人生分</div>
          <div className="tabular mt-3 text-[88px] font-black leading-none tracking-[-0.07em] text-ink">
            {player.score}
          </div>
          <div className="mt-4 text-moon-dim">
            个人第 <span className="tabular text-3xl font-black text-ink">{rank}</span> 名
          </div>
          <div className="tabular mt-4 border-t border-line pt-4 text-xs font-bold text-ink-dim">
            {player.stations_done}/{player.stations_total} 站 · {player.life_events_done}/{player.life_events_total} 段人生
          </div>
          {team && team.members.length > 1 && (
            <div className="mt-4 border-t border-line pt-4">
              <div className="text-[10px] font-black tracking-[0.12em] text-ink-dim">共同走过本场</div>
              <div className="mt-1 text-base font-black">
                {team.members.map((member) => member.name).join(" / ")}
              </div>
            </div>
          )}
        </div>

        {player.token_available && (
          <p className="rise mt-5 max-w-xs rounded-2xl bg-[#ffefc2] px-4 py-3 text-sm font-black text-[#7a5200]" style={{ "--i": 3 } as React.CSSProperties}>
            🪙 你的 Help Token 还没用 —— 去恩典站换一张纪念卡
          </p>
        )}

        <p className="rise mt-8 text-sm leading-loose text-moon-dim" style={{ "--i": 4 } as React.CSSProperties}>
          「我的恩典够你用的」 · 哥林多后书 12:9
          <br />
          You don't have to do life alone
        </p>
        <Link
          to={joinToken === "preview" ? "/badge?preview=1" : `/badge/${joinToken}`}
          className="rise pressable mt-7 inline-flex min-h-[52px] items-center rounded-full bg-ink px-7 py-3.5 text-[15px] font-black text-white shadow-[0_3px_0_#0f0d0a]"
          style={{ "--i": 5 } as React.CSSProperties}
        >
          生成我的纪念徽章 →
        </Link>
      </div>
    </div>
  );
}
