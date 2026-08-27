import { useState } from "react";
import { rpc, errorText } from "../lib/api";
import { ActionButton, BrandMark, ErrorBanner } from "../lib/ui";

/* The join form is an "arrival card": a light paper immigration form
   floating on the night sky. */

const cardInput =
  "mt-1.5 w-full rounded-[14px] border-2 border-transparent bg-[#fbf4e6] px-4 py-3.5 text-lg font-bold text-ink placeholder:text-[#b5a88c] outline-none transition-shadow duration-200 focus:bg-card focus:shadow-[0_0_0_3px_#ffc838]";

export default function Join(props: {
  onJoined: (code: string) => void;
  notice: string | null;
  joinToken: string;
  gameTitle?: string;
  preview?: boolean;
}) {
  const [mode, setMode] = useState<"join" | "recover" | "show_code">("join");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const join = async () => {
    setErr(null);
    if (props.preview) {
      setErr("这是界面预览，不会提交登记数据");
      return;
    }
    try {
      const r = await rpc<{ player_id: string; code: string }>("join_by_link", {
        p_name: name,
        p_join_token: props.joinToken,
      });
      setNewCode(r.code);
      setMode("show_code");
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const recover = async () => {
    setErr(null);
    if (props.preview) {
      setErr("这是界面预览，不会查询真实玩家");
      return;
    }
    try {
      const r = await rpc<{ code: string }>("recover_by_link", {
        p_join_token: props.joinToken,
        p_code: code,
      });
      props.onJoined(r.code);
    } catch (e) {
      setErr(errorText(e));
    }
  };

  if (mode === "show_code") {
    return (
      <div className="brand-stage relative min-h-dvh overflow-hidden">
        <div className="night-sky" />
        <div className="relative z-10 min-h-dvh flex flex-col items-center justify-center p-6">
          <div className="w-full max-w-sm text-center text-ink">
            <p className="rise text-foil-dim text-[11px] font-black tracking-[0.4em]" style={{ "--i": 0 } as React.CSSProperties}>
              LIFE NO. · 已生成
            </p>
            <h1 className="rise mt-2 text-3xl font-black" style={{ "--i": 1 } as React.CSSProperties}>
              这是你的人生编号
            </h1>

            <div
              className="rise sheen mt-8 rounded-[32px] bg-white px-6 pb-7 pt-8 shadow-[0_5px_0_#e0a800]"
              style={{ "--i": 2 } as React.CSSProperties}
            >
              <div className="text-ink-dim text-[11px] font-black tracking-[0.28em]">LIFE NO. · 人生编号</div>
              <div className="tabular mt-4 text-[80px] font-black leading-none tracking-[-0.06em] text-ink">
                {newCode}
              </div>
              <div className="mx-auto mt-6 h-2 w-16 rounded-full bg-foil" />
            </div>

            <p className="rise mt-5 text-foil-dim text-sm font-semibold leading-relaxed" style={{ "--i": 3 } as React.CSSProperties}>
              请<b className="text-ink">截图保存</b>这个编号。
              <br />
              微信闪退或换手机时，凭它找回你的人生。
            </p>
            <div className="rise mt-8" style={{ "--i": 4 } as React.CSSProperties}>
              <ActionButton onClick={() => props.onJoined(newCode)}>
                我记住了 · 进入候场区 →
              </ActionButton>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      <div className="relative z-10 flex min-h-dvh w-[100vw] max-w-[100vw] flex-col items-center px-6 pt-10 pb-10">
        <BrandMark className="rise !w-[104px] !gap-1 !rounded-[18px] !p-2.5 !shadow-[0_3px_0_#e0a800]" />
        <p className="rise mt-7 text-foil-dim text-[11px] font-black tracking-[0.45em]" style={{ "--i": 0 } as React.CSSProperties}>LIFE PASSPORT</p>
        <h1 className="rise mt-2 text-[42px] font-black leading-tight tracking-[-0.05em] text-ink" style={{ "--i": 1 } as React.CSSProperties}>领取人生编号</h1>
        <p className="rise mt-2 max-w-xs text-center text-sm font-semibold text-ink-dim" style={{ "--i": 2 } as React.CSSProperties}>
          {props.gameTitle ?? "本场活动"} · 填写姓名即可入场
        </p>

        {/* arrival card */}
        <div
          className="rise w-full max-w-sm mt-8 rounded-[28px] bg-white text-ink px-6 py-6 shadow-[0_3px_0_#f0e4ce]"
          style={{ "--i": 3 } as React.CSSProperties}
        >
          <div className="flex items-baseline justify-between pb-3">
            <span className="font-black text-lg">
              {mode === "join" ? "现场登记" : "找回人生"}
            </span>
            <span className="font-mono text-[10px] tracking-[0.25em] text-ink-dim">
              {mode === "join" ? "ARRIVAL CARD" : "RE-ENTRY"}
            </span>
          </div>

          {props.notice && <div className="mt-4"><ErrorBanner text={props.notice} /></div>}

          {mode === "join" ? (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-[12px] font-black text-ink-dim tracking-[0.16em]">姓名 · NAME</span>
                <input
                  className={cardInput}
                  placeholder="怎么称呼你？"
                  maxLength={20}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <ErrorBanner text={err} />
              <ActionButton onClick={join} disabled={!name.trim()}>
                领取人生编号
              </ActionButton>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-[12px] font-black text-ink-dim tracking-[0.16em]">人生编号 · LIFE NO.</span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoFocus
                  className="mt-1.5 w-full rounded-[14px] border-2 border-transparent bg-[#fbf4e6] px-4 py-3.5 text-center text-3xl font-black tabular tracking-[0.35em] text-ink outline-none focus:bg-white focus:shadow-[0_0_0_3px_#ffc838]"
                  placeholder="0000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />
              </label>
              <ErrorBanner text={err} />
              <ActionButton onClick={recover} disabled={code.length !== 4}>
                找回我的护照
              </ActionButton>
            </div>
          )}
        </div>

        <button
          className="rise mt-6 rounded-full px-5 py-2 text-ink-dim font-bold hover:bg-white"
          style={{ "--i": 4 } as React.CSSProperties}
          onClick={() => {
            setErr(null);
            setMode(mode === "join" ? "recover" : "join");
          }}
        >
          {mode === "join" ? "已经登记过？输入 4 位码找回 →" : "← 返回现场登记"}
        </button>
      </div>
    </div>
  );
}
