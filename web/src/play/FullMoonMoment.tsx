import { useEffect, useState } from "react";
import { useCopy } from "../theme/ThemeProvider";

/*
 * Shown once every visible main station is stamped. The first time a phone
 * sees it, a full-screen veil takes over: a crescent fills into a full moon,
 * then the title and the hidden station's hint rise under it — the card at the
 * bottom of the page is too easy to miss (it sits under the +6 toast). After
 * the player dismisses it, the card stays under the hero holding the hint,
 * until that stamp lands too.
 */
export function FullMoonMoment({ reached, hint, secretDone, playerCode }: {
  reached: boolean;
  hint: string | null;
  secretDone: boolean;
  playerCode: string;
}) {
  const copy = useCopy();
  const key = `fullmoon:${playerCode}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!reached) return;
    let seen = false;
    try { seen = localStorage.getItem(key) === "1"; } catch { /* storage denied: play it again, no harm */ }
    if (seen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(true);
    try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
  }, [reached, key]);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  if (!reached) return null;
  const showHint = hint && !secretDone;
  return (
    <>
      <section
        className="rise mx-auto mt-4 w-[calc(100%-2rem)] max-w-md rounded-[24px] bg-card px-5 py-5 shadow-[0_3px_0_var(--color-shadow-line)]"
        style={{ "--i": 2 } as React.CSSProperties}
        aria-label={copy.fullMoonTitle}
      >
        <div className="text-lg font-black text-ink">{copy.fullMoonTitle}</div>
        <p className="mt-1 text-sm font-semibold leading-6 text-ink-dim">{copy.fullMoonBody}</p>
        {showHint && (
          <div className="mt-3 rounded-2xl bg-accent-soft px-4 py-3">
            <div className="text-[11px] font-black tracking-[0.18em] text-accent-deep">{copy.secretTeaser}</div>
            <p className="mt-1 text-sm font-bold leading-6 text-accent-deep">{hint}</p>
          </div>
        )}
      </section>

      {open && (
        <div
          className="veil fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-[rgb(from_var(--color-ink)_r_g_b_/_.78)] px-5 py-8 backdrop-blur-[6px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="full-moon-title"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
            <div className="full-moon-orb relative mx-auto h-40 w-40 overflow-hidden rounded-full" aria-hidden="true">
              <span className="full-moon-shade absolute inset-0 rounded-full" />
            </div>
            <h2 id="full-moon-title" className="full-moon-line mt-8 text-[30px] font-black tracking-[0.12em] text-white"
                style={{ "--d": "1300ms" } as React.CSSProperties}>
              {copy.fullMoonTitle}
            </h2>
            <p className="full-moon-line mt-2 text-balance text-sm font-semibold leading-6 text-white/75"
               style={{ "--d": "1500ms" } as React.CSSProperties}>
              {copy.fullMoonBody}
            </p>
            {showHint && (
              <div className="full-moon-line mt-5 rounded-2xl bg-card px-4 py-4 text-left shadow-[0_12px_32px_rgb(from_var(--color-ink)_r_g_b_/_.3)]"
                   style={{ "--d": "1900ms" } as React.CSSProperties}>
                <div className="text-[11px] font-black tracking-[0.18em] text-accent-deep">{copy.secretTeaser}</div>
                <p className="mt-1 text-[15px] font-bold leading-7 text-ink">{hint}</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="full-moon-line pressable mt-6 min-h-[52px] w-full rounded-full bg-foil px-5 py-3.5 text-[15px] font-black text-ink"
              style={{ "--d": showHint ? "2300ms" : "1800ms" } as React.CSSProperties}
            >
              {showHint ? "悄悄去找" : "好"}
            </button>
            {showHint && (
              <p className="full-moon-line mt-3 text-[11px] font-bold text-white/55"
                 style={{ "--d": "2300ms" } as React.CSSProperties}>
                关掉以后，这段提示会一直留在集章卡下面
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
