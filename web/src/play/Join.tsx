import { useCopy, useTheme } from "../theme/ThemeProvider";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { rpc, errorText, newIdemKey, RpcError } from "../lib/api";
import type { DuplicateJoin, JoinResult, RecoveredPlayer } from "../lib/types";
import { ActionButton, BrandMark, ErrorBanner, UpLink } from "../lib/ui";

/* The join form is an "arrival card": a light paper immigration form
   floating on the night sky. */

const cardInput =
  "mt-1.5 w-full rounded-[14px] border-2 border-transparent bg-join-input px-4 py-3.5 text-lg font-bold text-ink placeholder:text-ink-disabled outline-none transition-shadow duration-200 focus:bg-card focus:shadow-[0_0_0_3px_var(--color-accent)]";

function admissionKey(joinToken: string, fresh = false): string {
  const storageKey = `lp_join_idem:${joinToken}`;
  try {
    const existing = fresh ? null : localStorage.getItem(storageKey);
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
  /** 主办方一行小字（中秋主题的加入页顶部）。 */
  orgLabel?: string | null;
  preview?: boolean;
}) {
  const copy = useCopy();
  const midautumn = useTheme().id === "midautumn";
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"join" | "recover">("join");
  /* 找回有两条路：报编号，或报登记时留的联系方式。 */
  const [recoverTab, setRecoverTab] = useState<"code" | "contact">("code");
  /* 服务器发现今晚已有同名登记时先问一句，而不是直接再发一本。 */
  const [dup, setDup] = useState<DuplicateJoin | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const joinIdempotencyKey = useRef(admissionKey(props.joinToken));

  const normalizedName = (value: string) => value.trim().replace(/\s+/g, "").toLocaleLowerCase();

  const join = async (force = false) => {
    if (submittingRef.current) return;
    setErr(null);
    /*
     * Demo mode walks the whole flow instead of refusing at the first tap. The
     * /guide page exists so a volunteer can see what a new arrival sees, and a
     * form that says "this is only a preview" showed them nothing.
     * `?preview=join&dup=1` shows the duplicate-name card on the first submit.
     */
    if (props.preview) {
      if (!force && searchParams.get("dup") === "1") {
        setDup({ name: name.trim() || "林沐恩", code_hint: "3●●", has_contact: true, contact_hint: "wx…26" });
        return;
      }
      props.onCodeIssued(String(100 + Math.floor(Math.random() * 900)), name.trim() || "新朋友");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      /* 「不是我」= 明知同名也要一本新的：换一个幂等键，否则服务器会把它当成
         刚才那次请求的重放而原样返回撞名卡。 */
      if (force) joinIdempotencyKey.current = admissionKey(props.joinToken, true);
      const r = await rpc<JoinResult>("join_by_link", {
        p_name: name,
        p_join_token: props.joinToken,
        p_contact: contact.trim() || null,
        p_idempotency_key: joinIdempotencyKey.current,
        p_force: force,
      });
      if ("duplicate" in r) {
        setDup(r.duplicate);
        return;
      }
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
      const r = await rpc<RecoveredPlayer>("recover_by_link", {
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

  /* 忘了编号：名字 + 登记时留的微信号 / WhatsApp。 */
  const recoverByContact = async () => {
    if (submittingRef.current) return;
    setErr(null);
    if (props.preview) {
      props.onJoined("327");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const r = await rpc<RecoveredPlayer>("recover_by_contact", {
        p_join_token: props.joinToken,
        p_name: name,
        p_contact: contact.trim(),
      });
      props.onJoined(r.code);
    } catch (e) {
      setErr(e instanceof RpcError && e.code === "PLAYER_NOT_FOUND" ? copy.recoverContactMiss : errorText(e));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const switchMode = (next: "join" | "recover") => {
    setErr(null);
    setDup(null);
    setMode(next);
  };

  const pillClass = (active: boolean) =>
    `pressable min-h-11 flex-1 whitespace-nowrap rounded-full px-2 text-[12.5px] font-black transition-colors ${
      active ? "bg-ink text-card shadow-[0_2px_0_var(--color-ink-shadow)]" : "bg-card/70 text-ink-dim"
    }`;
  const tabClass = (active: boolean) =>
    `pressable min-h-10 flex-1 rounded-full px-3 text-[13px] font-black ${
      active ? "bg-accent text-accent-ink" : "bg-join-input text-ink-dim"
    }`;

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      {/* Corner chrome. This is the only player screen with a way out: before
          you have a passport, landing here by accident is a real possibility.
          After the number is issued there is deliberately no exit. */}
      <div className="absolute inset-x-0 top-0 z-20 flex p-4 text-ink">
        <UpLink label="入口" to="/" />
      </div>
      <div className="relative z-10 flex min-h-dvh w-full flex-col items-center px-6 pt-16 pb-10">
        {midautumn ? (
          /* 中秋：照效果图，左对齐的海报式标题，没有几何标记和英文眉题。 */
          <div className="w-full max-w-sm self-center">
            {props.orgLabel && <p className="rise text-[12px] font-extrabold text-ink-dim">{props.orgLabel}</p>}
            <h1 className="rise mt-5 whitespace-nowrap text-[42px] font-black leading-[1.05] tracking-[0.02em] text-ink" style={{ "--i": 1 } as React.CSSProperties}>
              {copy.joinTitleDisplay || copy.joinTitle || copy.joinHeading}
            </h1>
            <p className="rise mt-2.5 text-[18px] font-extrabold text-leaf-deep" style={{ "--i": 2 } as React.CSSProperties}>{copy.joinSubtitle}</p>
            {copy.joinIntro && <p className="rise mt-3.5 max-w-[32ch] text-[13.5px] font-semibold leading-7 text-ink/85">{copy.joinIntro}</p>}
          </div>
        ) : (
          <>
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
          </>
        )}

        {/* Two doors, equal weight: most people are new, but the ones who are
            not used to hunt for a small grey link under the form. */}
        <div
          className="rise mt-8 flex w-full max-w-sm gap-2 self-center rounded-full bg-card/50 p-1"
          style={{ "--i": 3 } as React.CSSProperties}
          role="tablist"
          aria-label="登记或找回"
        >
          <button type="button" role="tab" aria-selected={mode === "join"} aria-pressed={mode === "join"} className={pillClass(mode === "join")} onClick={() => switchMode("join")}>
            {copy.joinEntryNew}
          </button>
          <button type="button" role="tab" aria-selected={mode === "recover"} aria-pressed={mode === "recover"} className={pillClass(mode === "recover")} onClick={() => switchMode("recover")}>
            {copy.joinEntryReturn}
          </button>
        </div>

        {/* arrival card */}
        <div
          className="rise mt-3 w-full max-w-sm self-center rounded-[28px] bg-white px-6 py-6 text-ink shadow-[0_3px_0_var(--color-shadow-line)]"
          style={{ "--i": 4 } as React.CSSProperties}
        >
          <div className="flex items-baseline justify-between pb-3">
            <span className="text-lg font-black">{mode === "join" ? copy.joinCardTitle : copy.recoverTitle}</span>
            <span className="font-mono text-[10px] tracking-[0.25em] text-ink-dim">
              {mode === "join" ? copy.joinCardEyebrow : "RE-ENTRY"}
            </span>
          </div>

          {props.notice && <div className="mt-4"><ErrorBanner text={props.notice} /></div>}

          {mode === "join" && dup ? (
            /* Somebody with this name already has a card tonight. Ask before
               issuing a second one — most of the time it is the same person
               on a new phone, and a fresh code would strand their score. */
            <div className="mt-4 space-y-4" role="group" aria-label={copy.duplicateAsk.replace("{name}", dup.name).replace("{hint}", dup.code_hint)}>
              <div className="rounded-[20px] bg-accent-soft px-4 py-4">
                <p className="text-[15px] font-black leading-6 text-accent-deep">
                  {copy.duplicateAsk.replace("{name}", dup.name).replace("{hint}", dup.code_hint)}
                </p>
                {dup.has_contact && dup.contact_hint && (
                  <p className="mt-2 text-[12px] font-bold text-accent-deep/80">登记时留的联系方式：{dup.contact_hint}</p>
                )}
              </div>
              <ErrorBanner text={err} />
              <ActionButton
                onClick={() => {
                  setErr(null);
                  setDup(null);
                  setRecoverTab(dup.has_contact ? "contact" : "code");
                  setMode("recover");
                }}
              >
                {copy.duplicateYes}
              </ActionButton>
              <ActionButton variant="night-ghost" onClick={() => join(true)} disabled={submitting}>
                {submitting ? copy.issuingCard : copy.duplicateNo}
              </ActionButton>
            </div>
          ) : mode === "join" ? (
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
              <ActionButton onClick={() => join()} disabled={!name.trim() || submitting}>
                {submitting ? copy.issuingCard : (copy.joinTitle ? copy.startGame : copy.joinAction)}
              </ActionButton>
            </div>
          ) : recoverTab === "contact" ? (
            <div className="mt-4 space-y-4">
              <div className="flex gap-1.5 rounded-full bg-join-input p-1" role="tablist" aria-label="找回方式">
                <button type="button" role="tab" aria-selected={false} className={tabClass(false)} onClick={() => { setErr(null); setRecoverTab("code"); }}>{copy.recoverHaveCode}</button>
                <button type="button" role="tab" aria-selected className={tabClass(true)}>{copy.recoverForgotCode}</button>
              </div>
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
                <span className="text-[12px] font-black tracking-[0.12em] text-ink-dim">微信号 / WHATSAPP</span>
                <input
                  className={cardInput}
                  placeholder="登记时留的那一个"
                  maxLength={80}
                  autoFocus
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                />
              </label>
              <ErrorBanner text={err} />
              <ActionButton onClick={recoverByContact} disabled={!name.trim() || !contact.trim() || submitting}>
                {submitting ? "正在核对…" : `找回我的${copy.cardShort}`}
              </ActionButton>
              <p className="text-[11px] font-semibold leading-5 text-ink-dim">{copy.recoverContactNote}</p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex gap-1.5 rounded-full bg-join-input p-1" role="tablist" aria-label="找回方式">
                <button type="button" role="tab" aria-selected className={tabClass(true)}>{copy.recoverHaveCode}</button>
                <button type="button" role="tab" aria-selected={false} className={tabClass(false)} onClick={() => { setErr(null); setRecoverTab("contact"); }}>{copy.recoverForgotCode}</button>
              </div>
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
