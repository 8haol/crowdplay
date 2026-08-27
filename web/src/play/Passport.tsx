import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { errorText, newIdemKey, rpc } from "../lib/api";
import type { LifeEventChoiceResult, PendingLifeEvent, PollResult, Station } from "../lib/types";
import { IDENTITY_ZH, colorOf, soloColor } from "../lib/types";
import { ConnDot } from "../lib/ui";
import { useCountUp } from "../lib/useCountUp";

export default function Passport(props: {
  data: PollResult;
  stations: Station[];
  online: boolean;
  joinToken: string;
}) {
  const { data, stations, online } = props;
  const { player, attempts, life_events } = data;
  const [toast, setToast] = useState<string | null>(null);
  const prev = useRef<PollResult | null>(null);
  const shownScore = useCountUp(player.score);
  const [dismissedEvent, setDismissedEvent] = useState<string | null>(null);

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

  if (data.pending_event && dismissedEvent !== data.pending_event.id) {
    return <LifeEventExperience event={data.pending_event} playerCode={player.code} joinToken={props.joinToken} onDone={() => setDismissedEvent(data.pending_event!.id)} />;
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
          className="rise mx-auto mt-5 w-[calc(100%-2rem)] max-w-2xl rounded-[28px] bg-white pr-5 pl-12 pt-5 pb-5 shadow-[0_3px_0_#f0e4ce] sm:px-5"
          style={{ "--i": 0 } as React.CSSProperties}
        >
          <div className="flex items-center justify-between text-[10px] tracking-[0.3em] text-moon-dim">
            <span className="font-black">LIFE PASSPORT</span>
            <span className="flex items-center gap-1.5">
              <ConnDot online={online} />
              NO. {player.code}
            </span>
          </div>

          <div className="mt-4 flex items-start justify-between gap-3">
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
            <div className="shrink-0 rounded-2xl bg-[#ffefc2] px-5 py-3 text-right shadow-[0_2px_0_#e0a800]"><div className="text-[#806321] text-[9px] font-black tracking-[0.15em]">我的总分</div><div className="tabular mt-1 text-5xl font-black leading-none">{shownScore}</div></div>
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

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-line bg-[#fbf4e6] px-3 py-2"><div className="text-[9px] font-black tracking-[0.16em] text-ink-dim">现场报这个 · 队伍码</div><div className="tabular mt-1 text-2xl font-black tracking-[0.12em]">{player.team_code ?? "待分配"}</div></div>
            <div className="rounded-xl border border-line bg-white px-3 py-2"><div className="text-[9px] font-black tracking-[0.16em] text-ink-dim">护照找回 · 人生编号</div><div className="tabular mt-1 text-2xl font-black tracking-[0.12em]">{player.code}</div></div>
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
                  ? "整队可换提示 / 重来；未使用可在结算换纪念卡"
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
                  <div className="text-[11px] font-black tracking-[0.12em] text-ink-dim">{e.scene_title ?? "人生事件"}</div>
                  <div className="mt-1 font-bold text-[15px]">{e.card_label}</div>
                  {e.outcome_detail && <div className="mt-1 text-xs font-semibold leading-5 text-moon-dim">{e.outcome_detail}</div>}
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

function LifeEventExperience(props: { event: PendingLifeEvent; playerCode: string; joinToken: string; onDone: () => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [result, setResult] = useState<LifeEventChoiceResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const choose = async (choiceKey: string) => {
    if (chosen) return;
    setChosen(choiceKey);
    setErr(null);
    if (props.joinToken === "preview") {
      const choice = props.event.choices.find((item) => item.key === choiceKey)!;
      window.setTimeout(() => setResult({ event_id: props.event.id, scene_title: props.event.title, choice_label: choice.label, outcome_key: "preview", outcome_label: "小小试验打开了新方向", outcome_detail: "你们没有急着争出唯一答案，而是先试了一步。结果比继续讨论更有用。", tone: "good", score_before: 45, score_after: 51, delta: 6, next_threshold: null }), 650);
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

  if (result) {
    const deltaLabel = result.delta === 0 ? "分数不变" : `${result.delta > 0 ? "+" : ""}${result.delta} 人生分`;
    const accent = result.tone === "good" ? "#2f8a56" : result.tone === "bad" ? "#bd4332" : "#b58b24";
    return <div className="relative min-h-dvh overflow-hidden bg-[#f6efe3] text-ink">
      <div className="night-sky" />
      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10 text-center">
        <div className="seal-slam mx-auto grid h-24 w-24 place-items-center rounded-[30px] text-5xl shadow-[0_5px_0_rgba(38,33,27,.14)]" style={{ background: accent }}>{result.tone === "good" ? "✨" : result.tone === "bad" ? "🌧️" : "✦"}</div>
        <p className="rise mt-7 text-[10px] font-black tracking-[0.35em] text-ink-dim" style={{ "--i": 1 } as React.CSSProperties}>命运已经回应 · RESULT</p>
        <h1 className="rise mt-2 text-3xl font-black leading-tight" style={{ "--i": 2 } as React.CSSProperties}>{result.outcome_label}</h1>
        <p className="rise mx-auto mt-3 max-w-sm text-sm font-semibold leading-7 text-ink-dim" style={{ "--i": 3 } as React.CSSProperties}>{result.outcome_detail}</p>
        <section className="rise mt-7 rounded-[28px] bg-white p-6 text-left shadow-[0_4px_0_#e0a800]" style={{ "--i": 4 } as React.CSSProperties}>
          <div className="text-[10px] font-black tracking-[0.18em] text-ink-dim">你的行动</div>
          <div className="mt-1 text-lg font-black">{result.choice_label}</div>
          <div className="mt-5 flex items-end justify-between border-t-2 border-dashed border-line pt-5"><div><div className="text-xs font-bold text-ink-dim">{deltaLabel}</div><div className="tabular mt-1 text-sm font-bold text-ink-dim">{result.score_before} → {result.score_after}</div></div><div className="tabular text-6xl font-black leading-none" style={{ color: accent }}>{result.score_after}</div></div>
        </section>
        <button className="rise pressable mt-6 rounded-full bg-ink px-6 py-4 font-black text-white shadow-[0_4px_0_#0f0d0a]" style={{ "--i": 5 } as React.CSSProperties} onClick={props.onDone}>收下这段人生，继续闯关 →</button>
      </main>
    </div>;
  }

  return <div className="relative min-h-dvh overflow-hidden bg-[#efe4d3] text-ink">
    <div className="night-sky" />
    <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <header className="text-center">
        <div className="seal-slam mx-auto grid h-24 w-24 place-items-center rounded-[30px] bg-foil text-5xl shadow-[0_5px_0_#d19c13]">{props.event.emoji}</div>
        <p className="rise mt-7 text-[10px] font-black tracking-[0.35em] text-ink-dim" style={{ "--i": 1 } as React.CSSProperties}>{props.event.threshold} 分人生关口 · LIFE EVENT</p>
        <h1 className="rise mt-2 text-[34px] font-black leading-tight tracking-[-0.04em]" style={{ "--i": 2 } as React.CSSProperties}>{props.event.title}</h1>
      </header>
      <section className="rise mt-6 rounded-[28px] bg-white p-6 shadow-[0_4px_0_#e0a800]" style={{ "--i": 3 } as React.CSSProperties}>
        <p className="text-[17px] font-bold leading-8">{props.event.prompt}</p>
        <div className="mt-6 space-y-3">
          {props.event.choices.map((choice, index) => <button key={choice.key} disabled={Boolean(chosen)} onClick={() => choose(choice.key)} className={`pressable flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left font-black transition-all disabled:opacity-60 ${chosen === choice.key ? "border-ink bg-ink text-white" : "border-line bg-[#fbf7f0] hover:border-ink/40"}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm ${chosen === choice.key ? "bg-white/15" : "bg-foil/25"}`}>{index + 1}</span><span>{choice.label}</span>{chosen === choice.key && <span className="dots ml-auto">揭晓<span>.</span><span>.</span><span>.</span></span>}</button>)}
        </div>
        {err && <div className="mt-4 rounded-xl bg-seal/10 px-3 py-2.5 text-sm font-bold text-seal">{err}</div>}
      </section>
      <p className="rise mt-4 px-4 text-center text-xs font-semibold leading-5 text-ink-dim" style={{ "--i": 4 } as React.CSSProperties}>没有固定正确答案。同一个行动，每次也可能走向不同结果。</p>
    </main>
  </div>;
}

function Ended({ data }: { data: PollResult }) {
  const { player, rank, team } = data;
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
          <div className="text-moon-dim text-sm">{player.name} 的最终人生分</div>
          <div className="tabular font-black text-[88px] leading-none tracking-[-0.07em] text-ink mt-3">
            {player.score}
          </div>
          <div className="mt-4 text-moon-dim">
            个人第 <span className="tabular font-black text-3xl text-ink">{rank}</span> 名
          </div>
          {team && <div className="mt-5 border-t border-line pt-5"><div className="text-[10px] font-black tracking-[0.12em] text-ink-dim">共同走过本场</div><div className="tabular mt-1 text-xl font-black">队伍 {team.code} · {team.members.map((member) => member.name).join(" / ")}</div></div>}
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
