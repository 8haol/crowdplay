import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { PollResult, Station } from "../lib/types";
import { IDENTITY_ZH, colorOf, soloColor } from "../lib/types";
import { ConnDot } from "../lib/ui";
import { useCountUp } from "../lib/useCountUp";

export default function Passport(props: {
  data: PollResult;
  stations: Station[];
  online: boolean;
}) {
  const { data, stations, online } = props;
  const { player, attempts, life_events } = data;
  const [toast, setToast] = useState<string | null>(null);
  const prev = useRef<PollResult | null>(null);
  const shownScore = useCountUp(player.score);

  // Change detection -> toast (poll latency <= 3s is acceptable per spec)
  useEffect(() => {
    const p = prev.current;
    prev.current = data;
    if (!p) return;
    if (data.life_events.length > p.life_events.length) {
      const e = data.life_events[data.life_events.length - 1];
      show(`人生盲盒：${e.card_label}（${e.score_before} → ${e.score_after} 分）`);
    } else if (data.player.score !== p.player.score) {
      const diff = data.player.score - p.player.score;
      show(diff > 0 ? `+${diff} 分，总分 ${data.player.score}` : `${diff} 分，总分 ${data.player.score}`);
    } else if (p.player.token_available && !data.player.token_available) {
      show("Help Token 已使用");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const toastTimer = useRef<number | null>(null);
  function show(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }

  if (data.phase === "ended") {
    return <Ended data={data} />;
  }

  if (player.locked_for_life_event) {
    return <LifeEventLock name={player.name} code={player.code} score={player.score} />;
  }

  const id = IDENTITY_ZH[player.identity ?? "solo"];
  const color = colorOf(player.color_group) ?? (player.identity === "solo" ? soloColor(player.code) : null);
  const mains = stations.filter((s) => s.type === "main");
  const byStation = new Map(attempts.map((a) => [`${a.station_id}:${a.status}`, a]));

  const prevThreshold =
    player.next_threshold === 35 ? 15 : player.next_threshold === 45 ? 35 : 0;
  const progress =
    player.next_threshold == null
      ? 1
      : Math.min(
          1,
          Math.max(0, (player.score - prevThreshold) / (player.next_threshold - prevThreshold)),
        );
  const nearThreshold = player.next_threshold != null && progress > 0.78;

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="night-sky" />
      <div className="relative z-10 pb-12">
        {/* Player summary */}
        <header
          className="rise mx-auto mt-5 w-[calc(100%-2rem)] max-w-2xl rounded-[28px] bg-white px-5 pt-5 pb-5 shadow-[0_3px_0_#f0e4ce]"
          style={{ "--i": 0 } as React.CSSProperties}
        >
          <div className="flex items-center justify-between text-[10px] tracking-[0.3em] text-moon-dim">
            <span className="font-black">LIFE PASSPORT</span>
            <span className="flex items-center gap-1.5">
              <ConnDot online={online} />
              NO. {player.code}
            </span>
          </div>

          <div className="mt-4 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="font-black text-[26px] leading-tight truncate">{player.name}</div>
              <div className="mt-1.5 flex items-center gap-2 text-[13px] text-moon-dim">
                <span>{id.name}</span>
                {color && (
                  <span className="flex items-center gap-1.5 font-bold" style={{ color: color.hex }}>
                    <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: color.hex }} />
                    {color.zh}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-moon-dim text-[11px] tracking-[0.2em]">总分</div>
              <div className="tabular font-black text-[64px] leading-none tracking-[-0.06em] text-ink">
                {shownScore}
              </div>
            </div>
          </div>

          {/* threshold progress */}
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-moon-dim mb-1.5">
              <span>
                {player.next_threshold == null
                  ? "所有人生关口都已经历"
                  : `下一个人生关口 ${player.next_threshold} 分`}
              </span>
              {player.next_threshold != null && (
                <span className="tabular">
                  {player.score} / {player.next_threshold}
                </span>
              )}
            </div>
            <div className="h-2 rounded-full bg-night-raise overflow-hidden">
              <div
                className={`h-full rounded-full bg-foil transition-[width] duration-700 ${nearThreshold ? "glow-foil" : ""}`}
                style={{ width: `${progress * 100}%`, transitionTimingFunction: "cubic-bezier(0.25,1,0.5,1)" }}
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl bg-[#fbf4e6] px-3 py-2 text-[11px] font-black text-ink-dim">
            <span>人生编号</span><span className="tabular tracking-[0.22em] text-ink">{player.code}</span>
          </div>
        </header>

        {/* status effect notice */}
        {player.status_effect?.type === "cap_next" && (
          <div className="rise mx-auto mt-4 w-[calc(100%-2rem)] max-w-2xl rounded-2xl bg-[#ffefc2] px-4 py-3 text-sm font-black text-[#7a5200]"
               style={{ "--i": 1 } as React.CSSProperties}>
            重感冒卧床中 · 下一站最多得 {player.status_effect.value} 分
          </div>
        )}

        {/* visa pages */}
        <section className="mx-auto mt-7 max-w-2xl px-4">
          <div className="rise flex items-baseline justify-between" style={{ "--i": 2 } as React.CSSProperties}>
            <h2 className="font-black text-xl">七站挑战</h2>
            <span className="text-moon-dim text-xs tabular">
              {attempts.filter((a) => a.status !== "retry_granted").length} / 7
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {mains.map((s, i) => {
              const passed = byStation.get(`${s.id}:passed`);
              const failed = byStation.get(`${s.id}:failed`);
              const retry = byStation.get(`${s.id}:retry_granted`);
              return (
                <div
                  key={s.id}
                  className="rise relative rounded-[20px] bg-white p-3.5 min-h-[108px] shadow-[0_2px_0_#f0e4ce]"
                  style={{ "--i": 3 + i } as React.CSSProperties}
                >
                  <div className="text-[15px] font-bold">{s.name_zh}</div>
                  <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-moon-dim/70">
                    {s.slug}
                  </div>

                  {passed && <VisaStamp tone="pass" big={`+${passed.score}`} small="通过" />}
                  {failed && !retry && <VisaStamp tone="fail" big="✗" small="未通过" />}
                  {retry && (
                    <div className="absolute right-2.5 bottom-2.5 rounded-lg border border-foil-dim/70 bg-foil/15 px-2 py-1 text-[11px] font-bold text-foil">
                      ✨ 可重新挑战
                    </div>
                  )}
                  {!passed && !failed && !retry && (
                    <div className="absolute right-3 bottom-3 h-9 w-9 rounded-full bg-night-raise" />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* grace token: perforated ticket */}
        <section className="mx-auto mt-6 max-w-2xl px-4">
          <div
            className={`rise rounded-[24px] px-5 py-4 flex items-center justify-between ${
              player.token_available
                ? "bg-[#ffefc2]"
                : "bg-night-raise"
            }`}
            style={{ "--i": 10 } as React.CSSProperties}
          >
            <div>
              <div className="font-bold flex items-center gap-2">
                Help Token
                <span className={`text-[10px] tracking-[0.2em] px-1.5 py-0.5 rounded ${
                  player.token_available ? "bg-foil text-ink" : "bg-card text-ink-dim"
                }`}>
                  {player.token_available ? "可用" : "已用"}
                </span>
              </div>
              <div className="text-xs text-moon-dim mt-1">
                {player.token_available
                  ? "恩典站可换：提示 / 重来机会 / 纪念卡"
                  : "You don't have to do life alone"}
              </div>
            </div>
            <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-full text-[11px] font-black shadow-[inset_0_0_0_4px_rgba(255,255,255,.55),0_3px_0_#e0a800] ${player.token_available ? "bg-foil text-[#5c3d00]" : "bg-[#e1d5be] text-[#9f9278] line-through shadow-none"}`}>HELP</div>
          </div>
        </section>

        {/* life events */}
        {life_events.length > 0 && (
          <section className="mx-auto mt-7 max-w-2xl px-4">
            <h2 className="font-black text-xl">人生大事记</h2>
            <div className="mt-3 space-y-2">
              {life_events.map((e, i) => (
                <div key={i} className="rounded-2xl bg-white px-4 py-3 shadow-[0_2px_0_#f0e4ce]">
                  <div className="font-bold text-[15px]">{e.card_label}</div>
                  <div className="text-moon-dim text-sm mt-0.5 tabular">
                    {e.score_before} → <span className="text-ink font-black">{e.score_after}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {toast && (
          <div className="toast-in fixed inset-x-5 bottom-6 z-50 mx-auto max-w-xl rounded-2xl bg-ink px-4 py-3.5 text-center font-black text-white shadow-[0_12px_32px_rgba(38,33,27,.24)]">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

/** Double-ring visa stamp, slammed onto the page. */
function VisaStamp({ tone, big, small }: { tone: "pass" | "fail"; big: string; small: string }) {
  const cls = tone === "pass" ? "border-leaf text-leaf" : "border-seal text-seal";
  return (
    <div className={`stamp-in absolute right-2 bottom-2 h-[60px] w-[60px] rounded-full border-2 ${cls} flex items-center justify-center`}>
      <div className={`h-[48px] w-[48px] rounded-full border ${cls} opacity-90 flex flex-col items-center justify-center`}>
        <span className="tabular font-serif font-black text-lg leading-none">{big}</span>
        <span className="text-[9px] font-bold tracking-[0.15em] mt-0.5">{small}</span>
      </div>
    </div>
  );
}

function LifeEventLock({ name, code, score }: { name: string; code: string; score: number }) {
  return (
    <div className="min-h-dvh bg-seal-deep caution flex flex-col items-center justify-center p-6 text-center text-white">
      {/* ceremonial seal */}
      <div className="seal-slam h-40 w-40 rounded-full bg-white text-seal-deep flex items-center justify-center shadow-[0_5px_0_rgba(38,33,27,.18)]">
        <div className="h-[136px] w-[136px] rounded-full border-4 border-seal-deep flex flex-col items-center justify-center">
          <span className="font-black text-3xl leading-tight">人生<br />盲盒</span>
        </div>
      </div>

      <h1 className="rise font-black text-[32px] mt-8" style={{ "--i": 3 } as React.CSSProperties}>
        人生突发事件
      </h1>
      <p className="rise mt-3 text-white/90 leading-relaxed" style={{ "--i": 4 } as React.CSSProperties}>
        {name}，你的人生走到了一个关口。
        <br />
        请<b>立即前往「人生盲盒站」</b>抽取命运卡。
      </p>

      <div className="rise mt-8 rounded-[24px] bg-white px-10 py-5 text-ink shadow-[0_3px_0_rgba(38,33,27,.16)]"
           style={{ "--i": 5 } as React.CSSProperties}>
        <div className="text-[11px] tracking-[0.3em] text-moon/70">报出你的编号</div>
        <div className="tabular font-black text-6xl mt-1">{code}</div>
      </div>
      <div className="rise mt-4 text-white/85 text-sm tabular" style={{ "--i": 6 } as React.CSSProperties}>
        当前总分 {score}
      </div>
      <p className="rise mt-10 text-xs text-white/70" style={{ "--i": 7 } as React.CSSProperties}>
        抽卡完成后，这个页面会自动解锁
      </p>
    </div>
  );
}

function Ended({ data }: { data: PollResult }) {
  const { player, rank } = data;
  return (
    <div className="brand-stage relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      <div className="relative z-10 min-h-dvh flex flex-col items-center justify-center p-6 text-center">
        <p className="rise text-foil-dim text-[11px] font-black tracking-[0.45em]" style={{ "--i": 0 } as React.CSSProperties}>
          JOURNEY COMPLETE · 旅程完成
        </p>
        <h1 className="rise font-black text-4xl mt-2" style={{ "--i": 1 } as React.CSSProperties}>
          这是你走过的人生
        </h1>

        <div
          className="rise mt-9 w-full max-w-xs rounded-[32px] bg-white px-8 py-9 shadow-[0_5px_0_#e0a800]"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <div className="text-moon-dim text-sm">{player.name} 的最终成绩</div>
          <div className="tabular font-black text-[88px] leading-none tracking-[-0.07em] text-ink mt-3">
            {player.score}
          </div>
          <div className="mt-4 text-moon-dim">
            全场第 <span className="tabular font-black text-3xl text-ink">{rank}</span> 名
          </div>
        </div>

        <p className="rise mt-8 text-moon-dim text-sm leading-loose" style={{ "--i": 3 } as React.CSSProperties}>
          「我的恩典够你用的」 · 哥林多后书 12:9
          <br />
          You don't have to do life alone
        </p>
        <Link
          to="/badge"
          className="rise pressable mt-7 inline-flex min-h-[52px] items-center rounded-full bg-ink px-7 py-3.5 text-[15px] font-black text-white shadow-[0_3px_0_#0f0d0a]"
          style={{ "--i": 4 } as React.CSSProperties}
        >
          生成我的纪念徽章 →
        </Link>
      </div>
    </div>
  );
}
