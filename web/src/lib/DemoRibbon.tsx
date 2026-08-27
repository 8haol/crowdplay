import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

/**
 * Always-on marker for `?preview=` screens: fixture data, not a live event.
 *
 * It used to be a floating pill pinned to the top of the viewport, which landed
 * straight on top of the station console's sticky header (covering both "换站点"
 * and "退出") and on the admin top bar. It is now a real strip at the very top
 * of the document — portalled in so call sites do not have to move their JSX —
 * so it can never sit on top of anything. The host itself stays sticky while
 * the preview scrolls, which keeps the way back to the guide in reach.
 */
export function DemoRibbon({ label = "演示预览 · 数据为示例" }: { label?: string }) {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.dataset.demoRibbon = "true";
    element.style.position = "sticky";
    element.style.top = "0";
    element.style.zIndex = "80";
    return element;
  });

  useLayoutEffect(() => {
    document.body.prepend(host);
    document.documentElement.dataset.demoPreview = "true";
    // Viewport-sized layouts (the projector board) subtract this.
    const publish = () => {
      const height = host.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--demo-strip", `${Math.round(height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(host);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--demo-strip");
      delete document.documentElement.dataset.demoPreview;
      host.remove();
    };
  }, [host]);

  return createPortal(
    <div
      /* Pages paint a fixed decorative layer at z-0; without a stacking
         context of its own this strip renders underneath it. */
      className="relative flex min-h-11 items-center justify-between gap-3 px-3 text-[12px] font-black text-white sm:justify-center"
      style={{ background: "#26211b", paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}
    >
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[#ffc838]" />
        {label}
      </span>
      <Link
        to="/guide"
        className="pressable inline-flex min-h-8 shrink-0 items-center rounded-full bg-white px-3 font-black text-[#26211b]"
      >
        ← 返回说明页
      </Link>
    </div>,
    host,
  );
}
