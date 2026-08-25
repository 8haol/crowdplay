import { Link, useSearchParams } from "react-router-dom";
import { useMemo } from "react";
import { rpc, errorText } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { PollResult } from "../lib/types";
import KeepsakeBadge from "./KeepsakeBadge";
import { previewState } from "./previewData";

export default function BadgePage() {
  const [searchParams] = useSearchParams();
  const preview = import.meta.env.DEV && searchParams.get("preview") === "1";
  const code = preview ? "0427" : localStorage.getItem("lp_code");
  const pollFn = useMemo(
    () => (!preview && code ? () => rpc<PollResult>("poll_player", { p_code: code }) : null),
    [code, preview],
  );
  const { data, online, error } = usePoll<PollResult>(pollFn, 3000);

  if (preview) return <KeepsakeBadge data={previewState("ended")} />;

  if (!code) {
    return <BadgeUnavailable title="还没有人生记录" detail="先领取人生编号并完成游戏，才能生成纪念徽章。" />;
  }

  if (!data) {
    return (
      <main className="relative grid min-h-dvh place-items-center overflow-hidden p-6 text-center">
        <div className="night-sky" />
        <div className="relative z-10">
          <div className="dots text-2xl font-black">正在读取人生记录<span>.</span><span>.</span><span>.</span></div>
          {!online && <p className="mt-3 text-sm font-bold text-seal">{errorText(error)}</p>}
        </div>
      </main>
    );
  }

  if (data.phase !== "ended") {
    return <BadgeUnavailable title="旅程还没有结束" detail="主持人结束游戏后，纪念徽章会自动开放。" />;
  }

  return <KeepsakeBadge data={data} />;
}

function BadgeUnavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="brand-stage relative grid min-h-dvh place-items-center overflow-hidden p-6 text-center">
      <div className="night-sky" />
      <div className="relative z-10 max-w-xs">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-foil text-4xl font-black text-ink shadow-[0_4px_0_#e0a800]">LP</div>
        <h1 className="mt-7 text-3xl font-black tracking-[-0.04em]">{title}</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-ink-dim">{detail}</p>
        <Link to="/play" className="pressable mt-7 inline-block rounded-full bg-ink px-7 py-3.5 font-black text-white">返回玩家页</Link>
      </div>
    </main>
  );
}
