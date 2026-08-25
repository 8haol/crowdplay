import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { rpc, readView, errorText, RpcError } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { PollResult, Station } from "../lib/types";
import { colorOf, soloColor } from "../lib/types";
import { BrandMark, ConnDot } from "../lib/ui";
import Join from "./Join";
import Passport from "./Passport";
import { PREVIEW_DATA, PREVIEW_STATIONS, previewState } from "./previewData";

const LS_CODE = "lp_code";
const LS_REVEAL = "lp_reveal_seen";

export default function PlayPage() {
  const [searchParams] = useSearchParams();
  const preview = import.meta.env.DEV ? searchParams.get("preview") : null;
  const [code, setCode] = useState<string | null>(() => localStorage.getItem(LS_CODE));
  const [joinNotice, setJoinNotice] = useState<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [revealSeen, setRevealSeen] = useState(() => localStorage.getItem(LS_REVEAL));

  useEffect(() => {
    readView<Station[]>("stations?select=*&order=sort_order").then(setStations).catch(() => {
      // retried implicitly on next mount; passport renders without names until then
    });
  }, []);

  const pollFn = useMemo(
    () => (code ? async () => {
      try {
        return await rpc<PollResult>("poll_player", { p_code: code });
      } catch (error) {
        if (error instanceof RpcError && error.code === "PLAYER_NOT_FOUND") {
          localStorage.removeItem(LS_CODE);
          setJoinNotice("你的编号已失效，请重新加入或找回");
          setCode(null);
        }
        throw error;
      }
    } : null),
    [code],
  );
  const { data, online, error } = usePoll<PollResult>(pollFn, 3000);

  const onJoined = useCallback((newCode: string) => {
    localStorage.setItem(LS_CODE, newCode);
    setJoinNotice(null);
    setCode(newCode);
  }, []);

  if (preview === "join") {
    return <Join onJoined={() => {}} notice={null} preview />;
  }
  if (preview === "waiting") {
    return <WaitingRoom code="0427" name="林沐恩" online />;
  }
  if (["reveal", "reveal-duo", "reveal-solo"].includes(preview ?? "")) {
    const revealData = preview === "reveal-duo"
      ? previewState("duo")
      : preview === "reveal-solo"
        ? previewState("solo")
        : PREVIEW_DATA;
    return <Reveal data={revealData} onDone={() => {}} />;
  }
  if (["passport", "solo", "sick", "lock", "ended"].includes(preview ?? "")) {
    return <Passport data={previewState(preview!)} stations={PREVIEW_STATIONS} online />;
  }

  if (!code) {
    return <Join onJoined={onJoined} notice={joinNotice} />;
  }

  if (!data) {
    return (
      <div className="relative min-h-dvh overflow-hidden">
        <div className="night-sky" />
        <div className="relative z-10 min-h-dvh flex flex-col items-center justify-center gap-5 p-8">
          <BrandMark className="!w-[108px] !gap-1 !rounded-[18px] !p-2.5 !shadow-[0_3px_0_#e0a800]" />
          <div className="font-black text-2xl">正在读取你的人生</div>
          <div className="dots text-ink-dim font-semibold">
            连接现场<span>.</span><span>.</span><span>.</span>
          </div>
          {!online && <div className="text-seal text-sm">{errorText(error)}</div>}
        </div>
      </div>
    );
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
          localStorage.setItem(LS_REVEAL, player.code);
          setRevealSeen(player.code);
        }}
      />
    );
  }

  return <Passport data={data} stations={stations} online={online} />;
}

const RULES: { t: string; d: string }[] = [
  { t: "身份揭晓", d: "开场时公布：独行、二人同行或三人同行" },
  { t: "七站挑战", d: "每站一次机会，完成后分数自动计入" },
  { t: "人生关口", d: "跨过 15 / 35 / 45 分，前往人生盲盒站" },
  { t: "一枚 Help Token", d: "可换提示、重来机会或纪念卡" },
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
          请截图保存编号，它是找回身份的唯一凭证
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
          <div className="text-ink-dim text-xs mt-2">身份会自动出现，不用刷新</div>
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
  const foreground = revealForeground(background);
  const actionForeground = revealActionForeground(background);
  const identityEnglish = identity.toUpperCase();
  const identityChinese = identity === "trio" ? "三人同行" : identity === "duo" ? "二人同行" : "独行者";
  const isTeam = identity === "duo" || identity === "trio";
  const partnerCopy = identity === "trio"
    ? "确认身边是与你同色的两位伙伴"
    : "确认身边是与你同色的另一位伙伴";

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

      <div className="reveal-layout relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(5.75rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-center">
        <div className="reveal-identity flip-in flex flex-1 flex-col items-center justify-center pb-8 pt-6">
          <p className="text-[11px] font-black tracking-[0.48em]">你的身份</p>
          <h1
            className="reveal-title mt-3 whitespace-nowrap font-black leading-none tracking-[-0.06em]"
            style={{ fontSize: color && color.zh.length > 4 ? "clamp(3.4rem,15vw,5rem)" : "clamp(4.5rem,21vw,6.5rem)" }}
          >
            {color?.zh ?? "未知色"}
          </h1>
          <p className="reveal-english mt-3 text-[30px] font-bold leading-none tracking-[0.32em]">{identityEnglish}</p>
          <div
            className="reveal-pill mt-6 rounded-full bg-[#fff9f0] px-7 py-2.5 text-base font-black"
            style={{ color: actionForeground }}
          >
            {identityChinese}
          </div>
        </div>

        <div className="reveal-action flip-in w-full">
          <p className="mb-3 text-xs font-bold opacity-90">
            {isTeam ? partnerCopy : "记住你的独行色，出发完成七个站点"}
          </p>
          <button
            type="button"
            onClick={onDone}
            className="pressable min-h-14 w-full rounded-full bg-[#fff9f0] px-5 py-3 text-center shadow-[0_3px_0_rgba(38,33,27,.16)]"
            style={{ color: actionForeground }}
          >
            <span className="block text-[16px] font-black">
              {isTeam ? "已找到队友，开始你的人生 →" : "开始你的人生 →"}
            </span>
          </button>
          <p className="mx-auto mt-4 max-w-xs text-xs font-bold leading-5 opacity-90">
            {isTeam ? "找不到队友？举起手机，让工作人员帮你" : "独行也不是孤单，恩典站永远为你开着"}
          </p>
        </div>
      </div>
    </div>
  );
}

function revealForeground(hex: string): "#000000" | "#FFFFFF" {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#FFFFFF";
  const luminance = colorLuminance(normalized);
  const blackContrast = contrastRatio(luminance, 0);
  const whiteContrast = contrastRatio(luminance, 1);
  return blackContrast >= whiteContrast ? "#000000" : "#FFFFFF";
}

function revealActionForeground(hex: string): string {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#26211B";
  const contrastOnCream = contrastRatio(colorLuminance(normalized), colorLuminance("FFF9F0"));
  return contrastOnCream >= 4.5 ? hex : "#26211B";
}

function colorLuminance(hex: string): number {
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
