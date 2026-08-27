import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { rpc, readView, errorText, RpcError } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { GameLanding, PollResult, Station } from "../lib/types";
import { colorOf, soloColor } from "../lib/types";
import { BrandMark, ConnDot } from "../lib/ui";
import { inkOnCream, readableOn } from "../lib/color";
import { DemoRibbon } from "../lib/DemoRibbon";
import Join, { CodeIssued } from "./Join";
import Passport from "./Passport";
import { PREVIEW_DATA, PREVIEW_STATIONS, previewState } from "./previewData";

export default function PlayPage() {
  const [searchParams] = useSearchParams();
  const { joinToken: routeToken } = useParams<{ joinToken: string }>();
  const navigate = useNavigate();
  const preview = searchParams.get("preview");
  const [landing, setLanding] = useState<GameLanding | null>(null);
  const [landingError, setLandingError] = useState<unknown>(null);
  const [joined, setJoined] = useState<{ token: string; code: string } | null>(null);
  const [invalidCodeToken, setInvalidCodeToken] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [revealDone, setRevealDone] = useState<{ token: string; code: string } | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [sessionArchived, setSessionArchived] = useState(false);
  const activeToken = routeToken ?? landing?.join_token;
  const code = activeToken
    ? invalidCodeToken === activeToken
      ? null
      : joined?.token === activeToken
        ? joined.code
        : localStorage.getItem(`lp_code:${activeToken}`)
    : null;
  const revealSeen = activeToken
    ? revealDone?.token === activeToken
      ? revealDone.code
      : localStorage.getItem(`lp_reveal:${activeToken}`)
    : null;

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    rpc<GameLanding>("game_landing", { p_join_token: routeToken ?? null })
      .then((result) => {
        if (cancelled) return;
        setLanding(result);
        if (!routeToken && result.join_token) {
          navigate(`/play/${result.join_token}`, { replace: true });
        }
      })
      .catch((error) => { if (!cancelled) setLandingError(error); });
    return () => { cancelled = true; };
  }, [navigate, preview, routeToken]);

  useEffect(() => {
    readView<Station[]>("stations?select=*&order=sort_order").then(setStations).catch(() => {
      // retried implicitly on next mount; passport renders without names until then
    });
  }, []);

  const pollFn = useMemo(
    () => (code && activeToken ? async () => {
      try {
        return await rpc<PollResult>("poll_player_by_link", {
          p_join_token: activeToken,
          p_code: code,
        });
      } catch (error) {
        if (error instanceof RpcError && error.code === "PLAYER_NOT_FOUND") {
          localStorage.removeItem(`lp_code:${activeToken}`);
          setJoinNotice("这个编号不属于当前场次，请重新加入或找回");
          setInvalidCodeToken(activeToken);
        }
        if (error instanceof RpcError && (error.code === "GAME_ARCHIVED" || error.code === "BAD_GAME_LINK")) {
          setSessionArchived(true);
        }
        throw error;
      }
    } : null),
    [activeToken, code],
  );
  const { data, online, error } = usePoll<PollResult>(pollFn, 3000);

  /*
   * Registration is complete the moment the server issues a code, not when the
   * player taps "我记住了". Persisting here means polling starts straight away,
   * so a phone left on the number screen is still carried into the identity
   * reveal when the host starts the game (see `issuedCode` below).
   */
  const onCodeIssued = useCallback((newCode: string) => {
    if (!activeToken) return;
    localStorage.setItem(`lp_code:${activeToken}`, newCode);
    setInvalidCodeToken(null);
    setJoinNotice(null);
    setJoined({ token: activeToken, code: newCode });
    setIssuedCode(newCode);
  }, [activeToken, setIssuedCode]);

  const onJoined = useCallback((newCode: string) => {
    if (!activeToken) return;
    localStorage.setItem(`lp_code:${activeToken}`, newCode);
    setInvalidCodeToken(null);
    setJoinNotice(null);
    setJoined({ token: activeToken, code: newCode });
    setIssuedCode(null);
  }, [activeToken, setIssuedCode]);

  if (preview === "join") {
    return <Demo><PreviewJoinFlow /></Demo>;
  }
  if (preview === "code") {
    return <Demo><CodeIssued code="427" onContinue={() => {}} /></Demo>;
  }
  if (preview === "waiting") {
    return <Demo><WaitingRoom code="0427" name="林沐恩" online /></Demo>;
  }
  if (["reveal", "reveal-duo", "reveal-solo"].includes(preview ?? "")) {
    const revealData = preview === "reveal-duo"
      ? previewState("duo")
      : preview === "reveal-solo"
        ? previewState("solo")
        : PREVIEW_DATA;
    return <Demo><Reveal data={revealData} onDone={() => {}} /></Demo>;
  }
  if (["passport", "solo", "sick", "lock", "ended"].includes(preview ?? "")) {
    return (
      <Demo>
        <Passport data={previewState(preview!)} stations={PREVIEW_STATIONS} online joinToken="preview" />
      </Demo>
    );
  }

  if (landingError) {
    return <PlayerMessage title="暂时无法连接活动" body={errorText(landingError)} />;
  }

  if (!landing || !activeToken) {
    return <PlayerLoading label="正在寻找本场活动" />;
  }

  if (!landing.is_current || landing.invalid || sessionArchived || (landing.phase === "ended" && !code)) {
    return <ArchivedSession landing={landing} />;
  }

  if (!code) {
    if (!landing.join_open) {
      return <PlayerMessage title="本场登记已关闭" body="如果你已经登记过，可以联系工作人员帮你找回编号。" />;
    }
    return (
      <Join
        onJoined={onJoined}
        onCodeIssued={onCodeIssued}
        notice={joinNotice}
        joinToken={activeToken}
        gameTitle={landing.title}
      />
    );
  }

  /*
   * The number screen stays up from the moment the code is issued — including
   * before the first poll has landed — and clears itself when the player taps
   * or when the host starts the game, whichever comes first.
   */
  if (issuedCode && (!data || data.phase === "waiting")) {
    return <CodeIssued code={issuedCode} onContinue={() => setIssuedCode(null)} />;
  }

  if (!data) {
    return <PlayerLoading label="正在读取你的人生" error={!online ? errorText(error) : undefined} />;
  }

  const { phase, player } = data;

  if (phase === "waiting") {
    return <WaitingRoom code={player.code} name={player.name} online={online} />;
  }

  // Identity reveal: once per stored code, when playing begins.
  if (phase === "playing" && player.identity && revealSeen !== player.code) {
    return (
      <Reveal
        data={data}
        onDone={() => {
          localStorage.setItem(`lp_reveal:${activeToken}`, player.code);
          setRevealDone({ token: activeToken, code: player.code });
        }}
      />
    );
  }

  return <Passport data={data} stations={stations} online={online} joinToken={activeToken} />;
}

/** Demo wrapper: fixture screens always carry the ribbon. */
function Demo({ children }: { children: React.ReactNode }) {
  return <>{children}<DemoRibbon /></>;
}

/**
 * `/play?preview=join` — the arrival flow, end to end, with no network:
 * form → your number → waiting room. Used from /guide so volunteers can see
 * exactly what a new person sees on their phone.
 */
function PreviewJoinFlow() {
  const [step, setStep] = useState<"form" | "code" | "waiting">("form");
  const [code, setCode] = useState("427");
  const [name, setName] = useState("林沐恩");

  if (step === "waiting") {
    return <WaitingRoom code={code} name={name} online />;
  }
  if (step === "code") {
    return <CodeIssued code={code} onContinue={() => setStep("waiting")} />;
  }
  return (
    <Join
      preview
      joinToken="preview"
      gameTitle="Glasgow 新生迎新会"
      notice={null}
      onCodeIssued={(issued, entered) => { setCode(issued); setName(entered); setStep("code"); }}
      onJoined={(recovered) => { setCode(recovered); setName("找回的玩家"); setStep("waiting"); }}
    />
  );
}

function PlayerLoading({ label, error }: { label: string; error?: string }) {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center gap-5 p-8 text-center">
        <BrandMark className="!w-[108px] !gap-1 !rounded-[18px] !p-2.5 !shadow-[0_3px_0_#e0a800]" />
        <div className="text-2xl font-black">{label}</div>
        <div className="dots font-semibold text-ink-dim">连接现场<span>.</span><span>.</span><span>.</span></div>
        {error && <div className="text-sm text-seal">{error}</div>}
      </div>
    </div>
  );
}

function ArchivedSession({ landing }: { landing: GameLanding }) {
  const canJoinCurrent = landing.current_join_open && landing.current_phase !== "ended" && landing.current_join_token;
  return (
    <div className="brand-stage relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12 text-center">
        <p className="text-[11px] font-black tracking-[0.4em] text-foil-dim">SESSION ARCHIVED</p>
        <h1 className="mt-3 text-[42px] font-black leading-[1.05] tracking-[-0.05em]">这一程已收好</h1>
        <div className="ticket-notch mt-8 rounded-[28px] bg-white px-6 py-7 text-left shadow-[0_4px_0_#e0a800]">
          <div className="text-xs font-black tracking-[0.18em] text-ink-dim">往期场次</div>
          <div className="mt-2 text-2xl font-black">{landing.title ?? "这场活动"}</div>
          <div className="mt-5 flex items-end justify-between border-t-2 border-dashed border-line pt-5">
            <span className="text-sm font-bold text-ink-dim">最终到场</span>
            <span className="tabular text-4xl font-black">{landing.player_count ?? 0}<small className="ml-1 text-sm">人</small></span>
          </div>
        </div>
        <p className="mx-auto mt-5 max-w-xs text-sm font-semibold leading-6 text-foil-dim">
          这个二维码只属于上一场活动，不会把你带进新的玩家名单。
        </p>
        {canJoinCurrent ? (
          <Link to={`/play/${landing.current_join_token}`} className="pressable mt-7 rounded-full bg-ink px-6 py-4 font-black text-white shadow-[0_4px_0_#0f0d0a]">
            加入当前场次 · {landing.current_title} →
          </Link>
        ) : (
          <Link to="/" className="pressable mt-7 rounded-full bg-white px-6 py-4 font-black text-ink">回到首页</Link>
        )}
      </main>
    </div>
  );
}

function PlayerMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden p-6 text-center">
      <div className="night-sky" />
      <div className="relative z-10 max-w-sm rounded-[28px] bg-white p-7 shadow-[0_3px_0_#f0e4ce]">
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-ink-dim">{body}</p>
        <Link to="/" className="pressable mt-6 inline-block rounded-full bg-ink px-6 py-3 font-black text-white">回到首页</Link>
      </div>
    </div>
  );
}

const RULES: { t: string; d: string }[] = [
  { t: "组队揭晓", d: "开场时会显示同行方式和颜色；Duo / Trio 请寻找同色队友" },
  { t: "整队闯七站", d: "报你的人生编号，工作人员只录一次，每位队员获得相同加分" },
  { t: "三段人生", d: "分数到 15 / 35 / 45，或走完第 3 / 5 / 7 站，先到就触发一段人生事件" },
  { t: "一枚 Help Token", d: "整队可换提示或重来；不用的话，随时能在恩典站换一张纪念卡" },
];

function WaitingRoom({ code, name, online }: { code: string; name: string; online: boolean }) {
  return (
    <div className="relative min-h-dvh overflow-hidden text-ink">
      <div className="night-sky" />
      <div className="relative z-10 min-h-dvh flex flex-col items-center px-6 pt-12 pb-8">
        <p className="rise text-foil-dim text-[11px] font-black tracking-[0.45em]" style={{ "--i": 0 } as React.CSSProperties}>
          READY · 等待开始
        </p>
        <h1 className="rise text-3xl font-black mt-2" style={{ "--i": 1 } as React.CSSProperties}>
          你已到场
        </h1>

        {/* boarding pass */}
        <div
          className="rise w-full max-w-sm mt-8 rounded-[28px] bg-white px-6 pt-6 pb-5 shadow-[0_3px_0_#f0e4ce]"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <div className="flex items-center justify-between text-[10px] font-black tracking-[0.28em] text-ink-dim">
            <span>LIFE PASSPORT</span>
            <span className="flex items-center gap-1.5">
              <ConnDot online={online} />
              {online ? "已连接" : "重连中"}
            </span>
          </div>
          <div className="mt-5 flex items-end justify-between">
            <div>
              <div className="text-ink-dim text-xs">玩家 · PLAYER</div>
              <div className="font-black text-2xl mt-1">{name}</div>
            </div>
            <div className="text-right">
              <div className="text-ink-dim text-xs">人生编号 · NO.</div>
              <div className="tabular font-black text-4xl text-ink leading-none mt-1">{code}</div>
            </div>
          </div>
          <div className="mt-5 h-2 w-full rounded-full bg-foil" />
        </div>

        <p className="rise mt-3 text-ink-dim text-xs font-semibold" style={{ "--i": 3 } as React.CSSProperties}>
          请截图保存编号 —— 现场报分和找回护照都只用它
        </p>

        {/* rules as a journey timeline (real sequence) */}
        <div className="w-full max-w-sm mt-9 space-y-0">
          {RULES.map((r, i) => (
            <div
              key={r.t}
              className="rise relative flex gap-4 pb-6 last:pb-0"
              style={{ "--i": 4 + i } as React.CSSProperties}
            >
              {i < RULES.length - 1 && (
                <div className="absolute left-[13px] top-8 bottom-0 w-0.5 bg-line" />
              )}
              <div className="h-7 w-7 shrink-0 rounded-full bg-foil text-ink flex items-center justify-center text-xs font-black tabular shadow-[0_2px_0_#e0a800]">
                {i + 1}
              </div>
              <div className="pt-0.5">
                <div className="font-black text-ink">{r.t}</div>
                <div className="text-sm font-semibold text-ink-dim mt-0.5 leading-relaxed">{r.d}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="rise mt-auto pt-10 text-center" style={{ "--i": 8 } as React.CSSProperties}>
          <div className="dots text-ink-dim text-sm font-black">
            等待主持人开始游戏<span>.</span><span>.</span><span>.</span>
          </div>
          <div className="text-ink-dim text-xs mt-2">同行方式和组队颜色会自动出现，不用刷新</div>
        </div>
      </div>
    </div>
  );
}

function Reveal({ data, onDone }: { data: PollResult; onDone: () => void }) {
  const { player } = data;
  const identity = player.identity ?? "solo";
  const color = colorOf(player.color_group) ?? (player.identity === "solo" ? soloColor(player.code) : null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setStep(1), 1600);
    return () => clearTimeout(t);
  }, []);

  if (step === 0) {
    return (
      <div className="brand-stage relative min-h-dvh overflow-hidden">
        <div className="night-sky" />
        <div className="relative z-10 min-h-dvh flex flex-col items-center justify-center p-6">
          <div className="dots font-black text-3xl tracking-[0.1em] text-ink">
            正在分配身份<span>.</span><span>.</span><span>.</span>
          </div>
        </div>
      </div>
    );
  }

  const background = color?.hex ?? "#26211B";
  const foreground = readableOn(background);
  const actionForeground = inkOnCream(background);
  const identityEnglish = identity.toUpperCase();
  const identityChinese = identity === "trio" ? "三人同行" : identity === "duo" ? "二人同行" : "独立同行";
  const isTeam = identity === "duo" || identity === "trio";
  const colorName = color?.zh ?? "未知色";
  const revealLabel = isTeam ? "组队颜色" : "个人颜色";
  const actionTitle = identity === "trio"
    ? "举起手机，找 2 位同色队友"
    : identity === "duo"
      ? "举起手机，找 1 位同色队友"
      : "无需组队，直接开始";
  const actionDetail = identity === "trio"
    ? `确认另外两人的屏幕也显示「${colorName}」`
    : identity === "duo"
      ? `确认对方的屏幕也显示「${colorName}」`
      : "你将以 Solo 身份独立完成七个站点";

  return (
    <div
      className="reveal-page relative min-h-dvh overflow-hidden"
      style={{ background, color: foreground }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full opacity-[0.13]"
        style={{ background: foreground }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-24 h-64 w-64 rounded-full opacity-[0.13]"
        style={{ background: foreground }}
      />

      <div className="reveal-layout relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))] text-center">
        <div className="reveal-identity flip-in flex flex-1 flex-col items-center justify-center pb-7 pt-5">
          <p className="text-[10px] font-black tracking-[0.36em] opacity-75">{revealLabel}</p>
          <h1
            className="reveal-title mt-3 whitespace-nowrap font-black leading-none tracking-[-0.06em]"
            style={{ fontSize: color && color.zh.length > 4 ? "clamp(3.2rem,14vw,4.8rem)" : "clamp(4.5rem,21vw,6.5rem)" }}
          >
            {colorName}
          </h1>
          <div
            className="reveal-pill mt-5 rounded-full bg-[#fff9f0] px-5 py-2 text-sm font-black"
            style={{ color: actionForeground }}
          >
            <span className="mr-2 tracking-[0.12em]">{identityEnglish}</span>
            <span className="opacity-45">·</span>
            <span className="ml-2">{identityChinese}</span>
          </div>
        </div>

        <div className="reveal-action flip-in w-full">
          <p className="text-[15px] font-black leading-6">{actionTitle}</p>
          <p className="mt-0.5 text-xs font-semibold leading-5 opacity-80">{actionDetail}</p>
          <button
            type="button"
            onClick={onDone}
            className="pressable mt-4 min-h-14 w-full rounded-full bg-[#fff9f0] px-5 py-3 text-center shadow-[0_3px_0_rgba(38,33,27,.16)]"
            style={{ color: actionForeground }}
          >
            <span className="block text-[15px] font-black">
              {isTeam ? "队友找齐了，开始游戏 →" : "开始游戏 →"}
            </span>
          </button>
          <p className="mx-auto mt-3 max-w-xs text-[11px] font-semibold leading-5 opacity-75">
            {isTeam ? "没找到？继续举着手机，或请工作人员帮忙" : "独行也不是孤单，恩典站永远为你开着"}
          </p>
        </div>
      </div>
    </div>
  );
}


