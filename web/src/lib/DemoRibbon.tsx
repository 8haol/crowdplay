import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

/**
 * Always-on marker for `?preview=` screens: fixture data, not a live event.
 *
 * It used to be a floating pill pinned to the top of the viewport, which landed
 * straight on top of the station console's sticky header (covering both "换站点"
 * and "退出") and on the admin top bar. It is now a real strip at the very top
 * of the document — portalled in so call sites do not have to move their JSX —
 * so it can never sit on top of anything. Sticky page headers scroll up under
 * it and take the viewport top as usual.
 */
export function DemoRibbon({ label = "演示预览 · 数据为示例" }: { label?: string }) {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.dataset.demoRibbon = "true";
    return element;
  });

  useEffect(() => {
    document.body.prepend(host);
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
      host.remove();
    };
  }, [host]);

  return createPortal(
    <div
      /* Pages paint a fixed decorative layer at z-0; without a stacking
         context of its own this strip renders underneath it. */
      className="relative z-[80] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-1.5 text-[12px] font-black text-white"
      style={{ background: "#26211b", paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}
    >
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[#ffc838]" />
        {label}
      </span>
      <Link
        to="/guide"
        className="inline-flex min-h-8 items-center rounded-full bg-white/18 px-3 font-black hover:bg-white/28"
      >
        返回说明页
      </Link>
    </div>,
    host,
  );
}
