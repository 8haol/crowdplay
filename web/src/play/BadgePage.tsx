import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMemo, type ReactNode } from "react";
import { rpc, errorText } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { PollResult } from "../lib/types";
import KeepsakeBadge from "./KeepsakeBadge";
import { previewState } from "./previewData";
import { DemoRibbon } from "../lib/DemoRibbon";

/*
 * A passport is always addressed by its event link plus its code: the join
 * token in the URL first, then whatever this browser has stored for a session.
 * There is no token-less lookup any more — a code alone names nobody once
 * several events can each hand out 327.
 */
const CODE_PREFIX = "lp_code:";

interface Stored {
  token: string;
  code: string;
}

function storedPassport(preferredToken?: string): Stored | null {
  if (preferredToken) {
    const scoped = localStorage.getItem(`${CODE_PREFIX}${preferredToken}`);
    if (scoped) return { token: preferredToken, code: scoped };
  }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(CODE_PREFIX)) continue;
    const code = localStorage.getItem(key);
    if (code) return { token: key.slice(CODE_PREFIX.length), code };
  }
  return null;
}

export default function BadgePage() {
  const [searchParams] = useSearchParams();
  const { joinToken } = useParams<{ joinToken: string }>();
  const preview = searchParams.get("preview") === "1";
  const stored = useMemo(() => (preview ? null : storedPassport(joinToken)), [joinToken, preview]);

  const pollFn = useMemo(
    () =>
      !preview && stored
        ? () => rpc<PollResult>("poll_player_by_link", { p_join_token: stored.token, p_code: stored.code })
        : null,
    [preview, stored],
  );
  const { data, online, error } = usePoll<PollResult>(pollFn, 3000);

  if (preview) return badgeOrHold(previewState(searchParams.get("state") === "hold" ? "ended-hold" : "ended"), <DemoRibbon />);

  if (!stored) {
    return (
      <BadgeUnavailable
        title="这台手机上没有护照"
        detail="纪念徽章从本机保存的人生编号生成。请回到玩家页，用你的人生编号找回护照后再来。"
      />
    );
  }

  if (!data) {
    return (
      <main className="relative grid min-h-dvh place-items-center overflow-hidden p-6 text-center">
        <div className="night-sky" />
        <div className="relative z-10">
          <div className="dots text-2xl font-black">正在读取人生记录<span>.</span><span>.</span><span>.</span></div>
          {!online && <p className="mt-3 text-sm font-bold text-seal">{errorText(error)}</p>}
          {!online && (
            <Link to="/play" className="pressable mt-6 inline-block rounded-full bg-ink px-6 py-3 font-black text-white">
              返回玩家页
            </Link>
          )}
        </div>
      </main>
    );
  }

  if (data.phase !== "ended") {
    return <BadgeUnavailable title="旅程还没有结束" detail="主持人结束游戏后，纪念徽章会自动开放。" />;
  }

  return badgeOrHold(data);
}

/*
 * The badge prints the player's place into the PNG, so it cannot exist while
 * the stage is still handing out the awards. One gate for both the live page
 * and the demo, and it also narrows `rank` away from null for the badge.
 */
function badgeOrHold(data: PollResult, extra?: ReactNode) {
  if (!data.ranks_published || data.rank === null) {
    return (
      <BadgeUnavailable
        title="排名还没公布"
        detail="主持人正在台上颁奖。大屏公布名次之后，纪念徽章会自动开放 —— 先抬头看大屏。"
      />
    );
  }
  return <>{<KeepsakeBadge data={data} rank={data.rank} />}{extra}</>;
}

function BadgeUnavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="brand-stage relative grid min-h-dvh place-items-center overflow-hidden p-6 text-center">
      <div className="night-sky" />
      <div className="relative z-10 max-w-xs">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-foil text-4xl font-black text-ink shadow-[0_4px_0_var(--color-foil-shadow)]">LP</div>
        <h1 className="mt-7 text-3xl font-black tracking-[-0.04em]">{title}</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-ink-dim">{detail}</p>
        <Link to="/play" className="pressable mt-7 inline-block rounded-full bg-ink px-7 py-3.5 font-black text-white">返回玩家页</Link>
      </div>
    </main>
  );
}
