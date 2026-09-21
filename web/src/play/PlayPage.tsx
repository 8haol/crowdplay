import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { rpc, errorText, RpcError } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { GameLanding, PollResult } from "../lib/types";
import { colorOf, soloColor } from "../lib/types";
import { BrandMark, ConnDot } from "../lib/ui";
import { darken, inkOnCream, lighten, readableOn } from "../lib/color";
import { DemoRibbon } from "../lib/DemoRibbon";
import Join, { CodeIssued } from "./Join";
import Passport, { PassportGlobe } from "./Passport";
import { PREVIEW_DATA, PREVIEW_STATIONS, previewState } from "./previewData";
import { useAmbientVerse } from "../lib/scripture";

export default function PlayPage() {
  const [searchParams] = useSearchParams();
  const { joinToken: routeToken } = useParams<{ joinToken: string }>();
  const preview = searchParams.get("preview");
  const [landing, setLanding] = useState<GameLanding | null>(null);
  const [landingError, setLandingError] = useState<unknown>(null);
  const [joined, setJoined] = useState<{ token: string; code: string } | null>(null);
  const [invalidCodeToken, setInvalidCodeToken] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);
  const [revealDone, setRevealDone] = useState<{ token: string; code: string } | null>(null);
  const [recovering, setRecovering] = useState<{ token: string; code: string } | null>(null);
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
    // Without a token there is no "the current game" to fall back to: several
    // organisations may each have one running. The bare /play route renders
    // guidance instead (see below), so nothing is fetched here.
    if (preview || !routeToken) return;
    let cancelled = false;
    rpc<GameLanding>("game_landing", { p_join_token: routeToken })
      .then((result) => { if (!cancelled) setLanding(result); })
      .catch((error) => { if (!cancelled) setLandingError(error); });
    return () => { cancelled = true; };
  }, [preview, routeToken]);

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
          localStorage.removeItem(`lp_join_idem:${activeToken}`);
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
    setRecovering({ token: activeToken, code: newCode });
    // Recovery restores an existing passport. Mark the original reveal as
    // seen immediately so a missing browser flag never replays identity/color.
    localStorage.setItem(`lp_reveal:${activeToken}`, newCode);
    setRevealDone({ token: activeToken, code: newCode });
    setIssuedCode(null);
  }, [activeToken, setIssuedCode, setRevealDone]);

  if (preview === "join") {
    return <Demo><PreviewJoinFlow /></Demo>;
  }
  if (preview === "code") {
    return <Demo><CodeIssued code="327" onContinue={() => {}} /></Demo>;
  }
  if (preview === "waiting") {
    return <Demo><WaitingRoom code="327" name="林沐恩" online preview /></Demo>;
  }
  if (["reveal", "reveal-duo", "reveal-solo"].includes(preview ?? "")) {
    const revealData = preview === "reveal-duo"
      ? previewState("duo")
      : preview === "reveal-solo"
        ? previewState("solo")
        : PREVIEW_DATA;
    return <Demo><Reveal data={revealData} onDone={() => {}} /></Demo>;
  }
  if (["passport", "solo", "sick", "lock", "ended", "ended-hold"].includes(preview ?? "")) {
    return (
      <Demo>
        <Passport data={previewState(preview!)} stations={PREVIEW_STATIONS} online joinToken="preview" />
      </Demo>
    );
  }

  if (!routeToken) {
    return <NoLinkGuidance />;
  }

  if (landingError) {
    return <PlayerMessage title="暂时无法连接活动" body={errorText(landingError)} />;
  }

  if (!landing || !activeToken) {
    return <PlayerLoading label="正在寻找本场活动" />;
  }

  if (landing.invalid) {
    return <NoLinkGuidance broken />;
  }

  if (!landing.is_current || sessionArchived || (landing.phase === "ended" && !code)) {
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
    return <PlayerLoading label={recovering?.token === activeToken ? "正在找回你的护照" : "正在读取你的人生"} error={!online ? errorText(error) : undefined} />;
  }

  const { phase, player } = data;

  if (phase === "waiting") {
    return <WaitingRoom code={player.code} name={player.name} online={online} colorGroup={player.color_group} orgName={data.org?.name_zh} />;
  }

  // Identity reveal: once per stored code, when playing begins.
  const isCurrentRecovery = recovering?.token === activeToken && recovering.code === player.code;
  if (phase === "playing" && player.identity && revealSeen !== player.code && !isCurrentRecovery) {
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

  /* The roster rides along with the poll: which stations an event runs is
     per-event state, and `stations` was the one table anon could read directly
     until phase 2 closed it. Nothing is fetched separately here. */
  return <Passport data={data} stations={data.stations} online={online} joinToken={activeToken} />;
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
  const [step, setStep] = useState<"form" | "code" | "waiting" | "passport">("form");
  const [code, setCode] = useState("327");
  const [name, setName] = useState("林沐恩");

  if (step === "passport") {
    return <Passport data={PREVIEW_DATA} stations={PREVIEW_STATIONS} online joinToken="preview" />;
  }
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
      onJoined={(recovered) => { setCode(recovered); setName("找回的玩家"); setStep("passport"); }}
    />
  );
}

function PlayerLoading({ label, error }: { label: string; error?: string }) {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center gap-5 p-8 text-center">
        <BrandMark className="!w-[108px] !gap-1 !rounded-[18px] !p-2.5 !shadow-[0_3px_0_var(--color-foil-shadow)]" />
        <div className="text-2xl font-black">{label}</div>
        <div className="dots font-semibold text-ink-dim">连接现场<span>.</span><span>.</span><span>.</span></div>
        {error && <div className="text-sm text-seal">{error}</div>}
      </div>
    </div>
  );
}

/**
 * `/play` with no token, or with one that opens nothing. There is no "current
 * game" to redirect to — several organisations may each have one running — so
 * the page says how people actually get in: the QR on the wall, or the link
 * their staff sent. Recovery needs the same link plus the code.
 */
function NoLinkGuidance({ broken = false }: { broken?: boolean }) {
  return (
    <div className="brand-stage relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12 text-center">
        <p className="text-[11px] font-black tracking-[0.4em] text-foil-dim">
          {broken ? "LINK NOT FOUND" : "PLAYER ENTRY"}
        </p>
        <h1 className="mt-3 text-[38px] font-black leading-[1.05] tracking-[-0.05em]">
          {broken ? "这个链接打不开任何一场" : "从现场的二维码进来"}
        </h1>
        <div className="mt-8 rounded-[28px] bg-white px-6 py-7 text-left shadow-[0_4px_0_var(--color-foil-shadow)]">
          <ol className="space-y-4 text-[15px] font-bold leading-6">
            <li className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-foil text-sm font-black">1</span>
              <span>用手机相机或微信扫一扫，对准大屏或海报上的<b>入场二维码</b>。</span>
            </li>
            <li className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-foil text-sm font-black">2</span>
              <span>或者点工作人员发到群里的<b>入场链接</b> —— 二维码和链接是同一样东西。</span>
            </li>
            <li className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-night-raise text-sm font-black">?</span>
              <span className="text-ink-dim">已经登记过、手机关掉了？再点一次同一个链接就回到你的护照；找回也需要本场链接加你的 3 位编号。</span>
            </li>
          </ol>
        </div>
        {broken && (
          <p className="mx-auto mt-5 max-w-xs text-sm font-semibold leading-6 text-foil-dim">
            链接可能抄错了一位，或者那一场已经不存在。请向现场工作人员再要一次。
          </p>
        )}
        <Link to="/" className="pressable mt-7 rounded-full bg-white px-6 py-4 font-black text-ink">回到首页</Link>
      </main>
    </div>
  );
}

function ArchivedSession({ landing }: { landing: GameLanding }) {
  return (
    <div className="brand-stage relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12 text-center">
        <p className="text-[11px] font-black tracking-[0.4em] text-foil-dim">SESSION ARCHIVED</p>
        <h1 className="mt-3 text-[42px] font-black leading-[1.05] tracking-[-0.05em]">这一程已收好</h1>
        <div className="ticket-notch mt-8 rounded-[28px] bg-white px-6 py-7 text-left shadow-[0_4px_0_var(--color-foil-shadow)]">
          <div className="text-xs font-black tracking-[0.18em] text-ink-dim">往期场次</div>
          <div className="mt-2 text-2xl font-black">{landing.title ?? "这场活动"}</div>
          <div className="mt-5 flex items-end justify-between border-t-2 border-dashed border-line pt-5">
            <span className="text-sm font-bold text-ink-dim">最终到场</span>
            <span className="tabular text-4xl font-black">{landing.player_count ?? 0}<small className="ml-1 text-sm">人</small></span>
          </div>
        </div>
        <p className="mx-auto mt-5 max-w-xs text-sm font-semibold leading-6 text-foil-dim">
          这个二维码只属于已经结束的那一场。新一场有自己的二维码，请向现场工作人员要。
        </p>
        <Link to="/" className="pressable mt-7 rounded-full bg-white px-6 py-4 font-black text-ink">回到首页</Link>
      </main>
    </div>
  );
}

function PlayerMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden p-6 text-center">
      <div className="night-sky" />
      <div className="relative z-10 max-w-sm rounded-[28px] bg-white p-7 shadow-[0_3px_0_var(--color-shadow-line)]">
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
  { t: "一枚 Grace Token", d: "整队可领实体恩典卡，或重挑任意已玩站点；不用的话，随时可换纪念卡" },
];

const WAITING_COVER_COLORS = [
  { slug: "maroon", label: "酒红", hex: colorOf("maroon")!.hex },
  { slug: "coral-red", label: "珊瑚红", hex: "var(--color-passport-cover-coral)" },
  { slug: "teal", label: "墨松", hex: colorOf("teal")!.hex },
  { slug: "navy", label: "藏青", hex: colorOf("navy")!.hex },
  { slug: "orange", label: "暖橙", hex: colorOf("orange")!.hex },
  { slug: "mint", label: "薄荷", hex: colorOf("mint")!.hex },
] as const;

function WaitingRoom({ code, name, online, colorGroup = null, preview = false, orgName = null }: {
  code: string;
  name: string;
  online: boolean;
  colorGroup?: string | null;
  preview?: boolean;
  /** The organisation running this event; printed on the passport cover. */
  orgName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedColor = searchParams.get("passportColor");
  const previewCover = WAITING_COVER_COLORS.find(({ slug }) => slug === requestedColor) ?? WAITING_COVER_COLORS[0];
  const assignedColor = colorOf(colorGroup);
  const coverColor = preview
    ? previewCover
    : { slug: colorGroup ?? "coral-red", label: assignedColor?.zh ?? "珊瑚红", hex: assignedColor?.hex ?? WAITING_COVER_COLORS[0].hex };

  return (
    <div className="brand-stage passport-stage min-h-dvh overflow-hidden text-ink">
      <div className="night-sky" />
      <div className="passport-waiting-layout relative z-10">
        {preview && (
          <div className="waiting-cover-picker" aria-label="等待页护照封面颜色预览">
            <span>封面试色</span>
            <div>
              {WAITING_COVER_COLORS.map((option) => (
                <button
                  key={option.slug}
                  type="button"
                  className="pressable"
                  aria-label={`${option.label}封面`}
                  aria-pressed={coverColor.slug === option.slug}
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.set("passportColor", option.slug);
                    setSearchParams(next, { replace: true });
                    setOpen(false);
                    setOpening(false);
                  }}
                >
                  <span style={{ background: option.hex }} aria-hidden="true" />
                  <small>{option.label}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-center font-mono text-[10px] font-black tracking-[0.36em] text-foil-dim">
          {open ? "BRIEFING · 入场说明" : "ISSUED · 已签发"}
        </p>
        <div className="passport-reader">
          <Briefing code={code} name={name} online={online} onClose={() => setOpen(false)} interactive={open} />
          {!open && (
            <PassportCoverCard
              code={code}
              name={name}
              online={online}
              orgName={orgName}
              opening={opening}
              coverColor={coverColor.hex}
              onOpen={() => setOpening(true)}
              onOpened={() => {
                setOpen(true);
                setOpening(false);
              }}
            />
          )}
        </div>
        <p className="text-center text-xs font-bold leading-5 text-foil-dim">
          {open ? "玩法已经写在护照内页 · 随时可以合上" : "等待主持人开始游戏 · 同行颜色会自动出现"}
        </p>
        {/* The wait is the one dead stretch in the night, so it is where an
            ambient line costs nothing — it fills time the player already has
            instead of interrupting something they were doing. */}
        <WaitingVerse />
      </div>
    </div>
  );
}

/** A quiet rotating line under the closed passport, only while waiting. */
function WaitingVerse() {
  const verse = useAmbientVerse();
  return (
    <div key={verse.ref} className="rise mt-4 text-center">
      <div className="mx-auto h-px w-8 bg-foil-dim/25" />
      <p className="mt-3 text-[13px] font-black leading-relaxed text-ink/75">
        「{verse.text}」
      </p>
      <p className="mt-1 text-[10px] font-bold tracking-[0.22em] text-foil-dim/70">
        {verse.ref}
      </p>
    </div>
  );
}

/** The whole phone is the closed document. */
function PassportCoverCard(props: {
  code: string;
  name: string;
  online: boolean;
  orgName?: string | null;
  opening: boolean;
  coverColor: string;
  onOpen: () => void;
  onOpened: () => void;
}) {
  const coverInk = readableOn(props.coverColor);
  const darkCover = coverInk === "var(--color-card)";
  const coverStyle = {
    "--doc-cover": props.coverColor,
    "--doc-cover-light": lighten(props.coverColor, 0.14),
    "--doc-cover-deep": darken(props.coverColor, 0.2),
    "--doc-cover-spine": darken(props.coverColor, 0.34),
    "--doc-foil": darkCover ? "var(--color-passport-cover-foil)" : "var(--color-ink)",
    "--doc-text": coverInk,
    "--doc-soft": darkCover ? "rgb(from var(--color-night) r g b / .74)" : "rgb(from var(--color-ink) r g b / .68)",
    "--doc-line": darkCover ? "rgb(from var(--color-passport-cover-foil) r g b / .5)" : "rgb(from var(--color-ink) r g b / .32)",
    "--doc-action-bg": darkCover ? "var(--color-night)" : "var(--color-ink)",
    "--doc-action-ink": darkCover ? darken(props.coverColor, 0.3) : "var(--color-night)",
    "--doc-action-shadow": darken(props.coverColor, 0.42),
  } as React.CSSProperties;

  return (
    <button
      type="button"
      onClick={props.onOpen}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && props.opening) props.onOpened();
      }}
      disabled={props.opening}
      aria-expanded={false}
      aria-label={`翻开 ${props.name} 的人生护照，编号 ${props.code}`}
      className={`doc-cover w-full text-left ${props.opening ? "doc-cover--opening" : ""}`}
      style={coverStyle}
    >
        <span className="doc-cover__spine" aria-hidden="true" />
        <span className="doc-cover__hatch" aria-hidden="true" />
        <span className="doc-cover__frame" aria-hidden="true" />

        <span className="doc-cover__content relative z-10">
          <span className="doc-cover__foil flex items-center justify-between font-mono text-[9px] font-black tracking-[0.22em]">
            <span className="truncate">{props.orgName ?? "LIFE PASSPORT"}</span>
            <span className="flex items-center gap-1.5">
              <ConnDot online={props.online} />
              <span className="doc-cover__soft">{props.online ? "已连接" : "重连中"}</span>
            </span>
          </span>

          <span className="doc-cover__middle flex flex-col items-center justify-center text-center">
            <span className="doc-crest"><PassportGlobe className="w-[3.75rem]" /></span>
            <span className="doc-cover__foil mt-5 text-[34px] font-black leading-none tracking-[0.18em]">人生护照</span>
            <span className="doc-cover__soft mt-2.5 font-mono text-[10px] font-black tracking-[0.34em]">LIFE PASSPORT</span>
          </span>

          <span className="doc-cover__footer block">
            <span className="doc-cover__divider grid grid-cols-[1fr_auto] items-end gap-4 border-t border-dashed pt-5">
              <span className="block min-w-0">
                <span className="doc-cover__soft block font-mono text-[9px] font-black tracking-[0.22em]">HOLDER · 持有人</span>
                <span className="doc-cover__text mt-1.5 block truncate text-xl font-black">{props.name}</span>
              </span>
              <span className="block text-right">
                <span className="doc-cover__soft block font-mono text-[9px] font-black tracking-[0.22em]">LIFE NO.</span>
                <span className="doc-cover__foil tabular mt-1 block text-[42px] font-black leading-none tracking-[0.04em]">{props.code}</span>
              </span>
            </span>
            <span className="doc-cover__action mt-5 flex items-center justify-center gap-2 rounded-full py-3 text-[13px] font-black">
              轻触翻开护照 <span aria-hidden="true">›</span>
            </span>
            <span className="doc-cover__soft mt-3 block text-center text-[10px] font-bold leading-4">请截图保存编号 · 现场报分和找回都只用它</span>
          </span>
        </span>
    </button>
  );
}

/** The opened passport page fills the phone too. */
function Briefing(props: { code: string; name: string; online: boolean; onClose: () => void; interactive: boolean }) {
  return (
    <main
      className="passport-open-page"
      aria-hidden={!props.interactive}
      style={{ pointerEvents: props.interactive ? "auto" : "none" }}
    >
      <div className="passport-open-page__content">
        <div className="flex items-end justify-between border-b-2 border-dashed border-line pb-4">
          <div className="min-w-0">
            <div className="font-mono text-[9px] font-black tracking-[0.22em] text-ink-dim">HOLDER · 持有人</div>
            <div className="mt-1 truncate text-lg font-black">{props.name}</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[9px] font-black tracking-[0.22em] text-ink-dim">LIFE NO.</div>
            <div className="tabular mt-0.5 text-3xl font-black leading-none">{props.code}</div>
          </div>
        </div>

        <div className="mt-4 flex-1 space-y-0">
          {RULES.map((r, i) => (
            <div key={r.t} className="relative flex gap-3 pb-3.5 last:pb-0">
              {i < RULES.length - 1 && <div className="absolute bottom-0 left-[13px] top-8 w-0.5 bg-line" />}
              <div className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foil text-xs font-black text-ink shadow-[0_2px_0_var(--color-foil-shadow)]">{i + 1}</div>
              <div className="pt-0.5">
                <div className="text-sm font-black">{r.t}</div>
                <div className="mt-0.5 text-[12px] font-semibold leading-[1.55] text-ink-dim">{r.d}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-1 flex items-center justify-center gap-1.5 border-t-2 border-dashed border-line pt-4 text-xs font-black text-ink-dim">
          <ConnDot online={props.online} />
          {props.online ? "已连接现场" : "重连中，护照编号仍保存在本机"}
        </div>
        <button type="button" onClick={props.onClose} className="pressable mt-3 min-h-10 w-full rounded-full bg-ink text-xs font-black text-white shadow-[0_3px_0_var(--color-ink-shadow)]">‹ 合上护照</button>
      </div>
    </main>
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

  const background = color?.hex ?? "var(--color-ink)";
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
            className="reveal-pill mt-5 rounded-full bg-night px-5 py-2 text-sm font-black"
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
            className="pressable mt-4 min-h-14 w-full rounded-full bg-night px-5 py-3 text-center shadow-[0_3px_0_rgb(from_var(--color-ink)_r_g_b_/_.16)]"
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
