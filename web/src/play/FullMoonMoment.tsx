import { useEffect, useState } from "react";
import { useCopy } from "../theme/ThemeProvider";

/*
 * Shown once every visible main station is stamped. The first time a phone
 * sees it the card plays the moon-fill glow; afterwards it just sits under
 * the hero holding the hidden station's hint, until that stamp lands too.
 */
export function FullMoonMoment({ reached, hint, secretDone, playerCode }: {
  reached: boolean;
  hint: string | null;
  secretDone: boolean;
  playerCode: string;
}) {
  const copy = useCopy();
  const key = `fullmoon:${playerCode}`;
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (!reached) return;
    let seen = false;
    try { seen = localStorage.getItem(key) === "1"; } catch { /* storage denied: play it again, no harm */ }
    if (seen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnimate(true);
    try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
  }, [reached, key]);

  if (!reached) return null;
  return (
    <section
      className={`rise mx-auto mt-4 w-[calc(100%-2rem)] max-w-md rounded-[24px] bg-card px-5 py-5 shadow-[0_3px_0_var(--color-shadow-line)] ${animate ? "moon-fill" : ""}`}
      style={{ "--i": 2 } as React.CSSProperties}
      aria-label={copy.fullMoonTitle}
    >
      <div className="text-lg font-black text-ink">{copy.fullMoonTitle}</div>
      <p className="mt-1 text-sm font-semibold leading-6 text-ink-dim">{copy.fullMoonBody}</p>
      {hint && !secretDone && (
        <div className="mt-3 rounded-2xl bg-accent-soft px-4 py-3">
          <div className="text-[11px] font-black tracking-[0.18em] text-accent-deep">{copy.secretTeaser}</div>
          <p className="mt-1 text-sm font-bold leading-6 text-accent-deep">{hint}</p>
        </div>
      )}
    </section>
  );
}
