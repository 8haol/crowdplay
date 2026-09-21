import { useCopy } from "../theme/ThemeProvider";
import { useRef, useState } from "react";
import { rpc, errorText, newIdemKey, RpcError } from "../lib/api";
import { ActionButton, BrandMark, ErrorBanner, UpLink } from "../lib/ui";

/* The join form is an "arrival card": a light paper immigration form
   floating on the night sky. */

const cardInput =
  "mt-1.5 w-full rounded-[14px] border-2 border-transparent bg-join-input px-4 py-3.5 text-lg font-bold text-ink placeholder:text-ink-disabled outline-none transition-shadow duration-200 focus:bg-card focus:shadow-[0_0_0_3px_var(--color-accent)]";

function admissionKey(joinToken: string): string {
  const storageKey = `lp_join_idem:${joinToken}`;
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const created = newIdemKey();
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    // Private/locked-down webviews can deny storage; the in-memory key still
    // protects retries and rapid taps for the lifetime of this page.
    return newIdemKey();
  }
}

export default function Join(props: {
  /** Fires the instant a passport exists, before the player taps anything.
      The parent owns the "here is your number" screen from then on. */
  onCodeIssued: (code: string, name: string) => void;
  onJoined: (code: string) => void;
  notice: string | null;
  joinToken: string;
  gameTitle?: string;
  preview?: boolean;
}) {
  const copy = useCopy();
  const [mode, setMode] = useState<"join" | "recover">("join");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const joinIdempotencyKey = useRef(admissionKey(props.joinToken));

  const normalizedName = (value: string) => value.trim().replace(/\s+/g, "").toLocaleLowerCase();

  const join = async () => {
    if (submittingRef.current) return;
    setErr(null);
    /*
     * Demo mode walks the whole flow instead of refusing at the first tap. The
     * /guide page exists so a volunteer can see what a new arrival sees, and a
     * form that says "this is only a preview" showed them nothing.
     */
    if (props.preview) {
      props.onCodeIssued(String(100 + Math.floor(Math.random() * 900)), name.trim() || "新朋友");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const r = await rpc<{ player_id: string; code: string }>("join_by_link", {
        p_name: name,
        p_join_token: props.joinToken,
        p_contact: contact.trim() || null,
        p_idempotency_key: joinIdempotencyKey.current,
      });
      /*
       * Hand the code up immediately. The player row already exists server-side,
       * so they are on the roster and will be assigned an identity when the host
       * starts the game — but until the code is stored locally their phone never
       * starts polling. Somebody who screenshotted the number and pocketed the
       * phone used to be stranded on the number screen while the rest of the
       * room saw their colours.
       */
      props.onCodeIssued(r.code, name.trim());
    } catch (e) {
      setErr(errorText(e));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const recover = async () => {
    if (submittingRef.current) return;
    setErr(null);
    if (props.preview) {
      props.onJoined(code);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const r = await rpc<{ code: string; name: string }>("recover_by_link", {
        p_join_token: props.joinToken,
        p_code: code,
      });
      if (normalizedName(r.name) !== normalizedName(name)) {
        throw new RpcError("PLAYER_NAME_MISMATCH");
      }
      props.onJoined(r.code);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      {/* Corner chrome. This is the only player screen with a way out: before
          you have a passport, landing here by accident is a real possibility.
          After the number is issued there is deliberately no exit. */}
      <div className="absolute inset-x-0 top-0 z-20 flex p-4 text-ink">
        <UpLink label="入口" to="/" />
      </div>
      <div className="relative z-10 flex min-h-dvh w-[100vw] max-w-[100vw] flex-col items-center px-6 pt-16 pb-10">
        <BrandMark className="rise !w-[104px] !gap-1 !rounded-[18px] !p-2.5 !shadow-[0_3px_0_var(--color-foil-shadow)]" />
        <p className="rise mt-7 text-[11px] font-black tracking-[0.45em] text-foil-dim" style={{ "--i": 0 } as React.CSSProperties}>
          {copy.cardEn}
        </p>
        <h1 className="rise mt-2 text-[42px] font-black leading-tight tracking-[-0.05em] text-ink" style={{ "--i": 1 } as React.CSSProperties}>
          {copy.joinTitle || copy.joinHeading}
        </h1>
        <p className="rise mt-2 max-w-xs text-center text-sm font-semibold text-ink-dim" style={{ "--i": 2 } as React.CSSProperties}>
          {!copy.joinTitle && <>{props.gameTitle ?? "本场活动"} · </>}{copy.joinSubtitle}
        </p>

        {copy.joinIntro && <p className="rise mt-4 max-w-sm text-center text-sm font-semibold leading-6 text-ink-dim">{copy.joinIntro}</p>}

        {/* arrival card */}
        <div
          className="rise mt-8 w-full max-w-sm rounded-[28px] bg-white px-6 py-6 text-ink shadow-[0_3px_0_var(--color-shadow-line)]"
          style={{ "--i": 3 } as React.CSSProperties}
        >
          <div className="flex items-baseline justify-between pb-3">
            <span className="text-lg font-black">{mode === "join" ? "现场登记" : copy.recoverTitle}</span>
            <span className="font-mono text-[10px] tracking-[0.25em] text-ink-dim">
              {mode === "join" ? "ARRIVAL CARD" : "RE-ENTRY"}
            </span>
          </div>

          {props.notice && <div className="mt-4"><ErrorBanner text={props.notice} /></div>}

          {mode === "join" ? (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-[12px] font-black tracking-[0.16em] text-ink-dim">姓名 · NAME</span>
                <input
                  className={cardInput}
                  placeholder="怎么称呼你？"
                  maxLength={20}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-black tracking-[0.12em] text-ink-dim">微信号 / WHATSAPP · 选填</span>
                <input
                  className={cardInput}
                  placeholder="方便活动后联系你"
                  maxLength={80}
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                />
                <span className="mt-2 block text-[11px] font-semibold leading-5 text-ink-dim">
                  仅供活动管理员后续联系；不显示在游戏、记分端或大屏。留空不影响参加。
                </span>
              </label>
              <ErrorBanner text={err} />
              <ActionButton onClick={join} disabled={!name.trim() || submitting}>
                {submitting ? copy.issuingCard : (copy.joinTitle ? copy.startGame : copy.joinAction)}
              </ActionButton>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-[12px] font-black tracking-[0.16em] text-ink-dim">登记姓名 · NAME</span>
                <input
                  className={cardInput}
                  placeholder="登记时填写的姓名"
                  maxLength={20}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-black tracking-[0.16em] text-ink-dim">{copy.lifeNo} · {copy.lifeNoEn}</span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoFocus
                  className="tabular mt-1.5 w-full rounded-[14px] border-2 border-transparent bg-join-input px-4 py-3.5 text-center text-3xl font-black tracking-[0.35em] text-ink outline-none focus:bg-white focus:shadow-[0_0_0_3px_var(--color-accent)]"
                  placeholder="000"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))}
                />
              </label>
              <ErrorBanner text={err} />
              {/* Codes are 3 digits now; 4 stays accepted so a passport issued
                  by an older session can still be recovered. */}
              <ActionButton onClick={recover} disabled={code.length < 3 || !name.trim() || submitting}>
                {submitting ? "正在核对…" : `找回我的${copy.cardShort}`}
              </ActionButton>
            </div>
          )}
        </div>

        <button
          type="button"
          className="rise mt-6 inline-flex min-h-11 items-center rounded-full px-5 text-[14px] font-bold text-ink-dim hover:bg-white"
          style={{ "--i": 4 } as React.CSSProperties}
          onClick={() => {
            setErr(null);
            setMode(mode === "join" ? "recover" : "join");
          }}
        >
          {mode === "join" ? `已经登记过？输入${copy.lifeNo}找回 →` : "← 返回现场登记"}
        </button>
      </div>
    </div>
  );
}

/**
 * The "here is your number" screen. Exported because PlayPage decides how long
 * it stays up: the player dismisses it, or it clears itself the moment the host
 * starts the game — so nobody misses their identity reveal by leaving the phone
 * on this screen.
 */
export function CodeIssued({ code, onContinue }: { code: string; onContinue: () => void }) {
  const copy = useCopy();
  return (
    <div className="brand-stage relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm text-center text-ink">
          <p className="rise text-[11px] font-black tracking-[0.4em] text-foil-dim" style={{ "--i": 0 } as React.CSSProperties}>
            {copy.lifeNoEn} · 已生成
          </p>
          <h1 className="rise mt-2 text-3xl font-black" style={{ "--i": 1 } as React.CSSProperties}>
            这是你的{copy.lifeNo}
          </h1>

          <div
            className="rise sheen mt-8 rounded-[32px] bg-white px-6 pb-7 pt-8 shadow-[0_5px_0_var(--color-foil-shadow)]"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            <div className="text-[11px] font-black tracking-[0.28em] text-ink-dim">{copy.lifeNoEn} · {copy.lifeNo}</div>
            <div className="tabular mt-4 text-[80px] font-black leading-none tracking-[-0.06em] text-ink">
              {code}
            </div>
            <div className="mx-auto mt-6 h-2 w-16 rounded-full bg-foil" />
          </div>

          <p className="rise mt-5 text-sm font-semibold leading-relaxed text-foil-dim" style={{ "--i": 3 } as React.CSSProperties}>
            请<b className="text-ink">截图保存</b>这三位数字。
            <br />
            现场报分、找回{copy.cardShort}，全程只用这一个编号。
          </p>
          <div className="rise mt-8" style={{ "--i": 4 } as React.CSSProperties}>
            <ActionButton onClick={onContinue}>我记住了 · 进入候场区 →</ActionButton>
          </div>
          <p className="rise mt-3 text-xs font-semibold text-foil-dim" style={{ "--i": 5 } as React.CSSProperties}>
            你已经登记成功了 —— 主持人开局时，这台手机会自动跳到身份揭晓。
          </p>
        </div>
      </div>
    </div>
  );
}
