import { useEffect, useLayoutEffect } from "react";

/**
 * Keeps a long document's reading position across visits.
 *
 * /guide and /library are read in one hand while the other opens demo screens,
 * and every trip out and back used to land at the top of the page. The position
 * is stored per key in sessionStorage (so it lasts the browsing session and
 * nothing longer) and restored on the way back.
 *
 * `ready` defers the restore until the content that gives the page its height
 * has arrived — restoring against a half-built page just clamps to the bottom
 * of whatever was rendered.
 *
 * An explicit `#section` in the URL always wins. That case also fixes a plain
 * SPA problem: on a cold load the browser looks for the anchor before React has
 * rendered it, gives up, and leaves the reader at the top.
 */
export function useScrollMemory(key: string, ready = true) {
  useLayoutEffect(() => {
    if (!ready) return;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const target = hash ? document.getElementById(hash) : null;
    const saved = hash ? 0 : Number(sessionStorage.getItem(key) ?? "0");
    if (!target && !saved) return;

    const apply = () => {
      if (target) target.scrollIntoView({ behavior: "instant", block: "start" });
      else window.scrollTo({ top: saved, behavior: "instant" });
    };
    // Twice: once after the first paint, once after fonts and images settle.
    const frame = requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
    return () => cancelAnimationFrame(frame);
  }, [key, ready]);

  useEffect(() => {
    /* Only record while the reader is actually still on this page. Leaving for
       a demo screen scrolls the *next* route to the top (RouteScrollManager)
       while this listener is still attached — a deleted subtree's passive
       cleanup runs after the commit that scrolled — and that stray event used
       to overwrite the stored position with 0, which is why every trip back
       from a demo landed at the very top. The path is checked when the value
       is written, not when the listener is attached. */
    const path = window.location.pathname;
    let frame = 0;
    const save = () => {
      frame = 0;
      if (window.location.pathname !== path) return;
      sessionStorage.setItem(key, String(Math.round(window.scrollY)));
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(save);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key]);
}
