import { useLayoutEffect } from "react";
import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import PlayPage from "./play/PlayPage";
import StaffPage from "./staff/StaffPage";
import AdminPage from "./admin/AdminPage";
import ScreenPage from "./screen/ScreenPage";
import BadgePage from "./play/BadgePage";
import GuidePage from "./guide/GuidePage";
import LibraryPage from "./guide/LibraryPage";
import { BrandMark } from "./lib/ui";

function Home() {
  return (
    <div className="brand-stage relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      <main className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[90rem] items-center gap-12 px-5 py-8 sm:px-8 md:grid-cols-[minmax(0,1.05fr)_minmax(22rem,.75fr)] md:px-10 md:py-10 lg:gap-20 xl:px-16">
        <section className="flex min-w-0 flex-col py-3 md:py-8">
          <div className="rise mb-7 w-fit max-w-[15rem] rounded-[16px] bg-white p-2.5 shadow-[0_3px_0_#e0a800] md:max-w-[17rem]" style={{ "--i": 0 } as React.CSSProperties}>
            <img
              src="/gloucester-chinese-church.avif"
              alt="Glasgow Chinese Gospel Church 格拉斯哥华人福音教会"
              className="block h-auto w-full"
              width="768"
              height="215"
            />
          </div>
          <p className="rise text-foil-dim text-[11px] font-black tracking-[0.45em]" style={{ "--i": 0 } as React.CSSProperties}>
            LIFE PASSPORT · 迎新会
          </p>
          <h1 className="rise mt-3 max-w-[40rem] text-[clamp(3.2rem,6vw,5.15rem)] font-black leading-[1.04] tracking-[-0.05em] text-ink md:leading-[1] md:tracking-[-0.055em]" style={{ "--i": 1 } as React.CSSProperties}>
            <span className="block">这一程，</span>
            <span className="mt-1 block">由你盖章。</span>
          </h1>
          <p className="rise mt-6 max-w-[32rem] text-[15px] font-semibold leading-7 text-foil-dim" style={{ "--i": 2 } as React.CSSProperties}>
            60 分钟人生模拟游戏。领取编号、找到同行者、完成七个站点，也接住路上意想不到的事。
          </p>

          <div className="mt-8 flex w-full max-w-[32rem] flex-col gap-3">
            <Link
              to="/play"
              className="rise pressable sheen rounded-full bg-ink px-5 py-4 text-center text-[15px] font-black text-white shadow-[0_4px_0_#0f0d0a]"
              style={{ "--i": 3 } as React.CSSProperties}
            >
              我是玩家 · 领取人生编号 →
            </Link>
            <div className="rise grid grid-cols-3 gap-2" style={{ "--i": 4 } as React.CSSProperties}>
              <Link to="/staff" className="pressable rounded-full bg-white px-3 py-3 text-center text-sm font-black text-ink shadow-[0_2px_0_#e0a800]">
                工作人员
              </Link>
              <Link to="/admin" className="pressable rounded-full bg-white px-3 py-3 text-center text-sm font-black text-ink shadow-[0_2px_0_#e0a800]">
                管理端
              </Link>
              <Link to="/screen" className="pressable rounded-full bg-white px-3 py-3 text-center text-sm font-black text-ink shadow-[0_2px_0_#e0a800]">
                现场大屏
              </Link>
            </div>
            <Link
              to="/guide"
              className="rise pressable group flex min-h-[66px] items-center gap-3 rounded-[18px] bg-white/85 p-2.5 pr-4 text-left text-ink shadow-[0_3px_0_rgba(122,82,0,.18)] backdrop-blur-sm"
              style={{ "--i": 5 } as React.CSSProperties}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-[#fff0b6] text-lg" aria-hidden="true">
                📖
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black">同工说明页</span>
                <span className="mt-0.5 block text-[11px] font-bold tracking-[0.02em] text-foil-dim">流程、规则与全部试玩</span>
              </span>
              <span className="text-lg font-black text-ink/45 transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        <section className="rise relative hidden items-center justify-center py-8 md:flex" style={{ "--i": 3 } as React.CSSProperties}>
          <div className="relative w-full max-w-[28rem]">
            <div className="absolute -bottom-3 left-4 right-[-12px] top-4 rotate-[2deg] rounded-[2.5rem_2.5rem_5.5rem_2.5rem] bg-[#eaa900]/55" aria-hidden="true" />
            <div className="relative min-h-[33rem] overflow-hidden rounded-[2.5rem_2.5rem_5.5rem_2.5rem] bg-[#fffaf0] p-8 text-ink shadow-[0_14px_0_rgba(122,82,0,.16)] lg:p-10">
              <span className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#f85a3f]/12" aria-hidden="true" />
              <span className="absolute -bottom-20 -left-20 h-52 w-52 rounded-full bg-[#2f9e65]/12" aria-hidden="true" />

              <div className="relative flex items-center justify-between text-[10px] font-black tracking-[0.22em] text-foil-dim">
                <span>GC GOSPEL CHURCH</span>
                <span>2026</span>
              </div>

              <BrandMark className="relative mt-8 !w-[11.5rem] !rounded-[24px] !bg-[#f3eadb] !p-4 !shadow-none" />

              <p className="relative mt-10 text-[11px] font-black tracking-[0.38em] text-seal">LIFE PASSPORT</p>
              <h2 className="relative mt-2 text-[clamp(3.4rem,5vw,4.6rem)] font-black leading-none tracking-[-0.07em]">人生护照</h2>

              <div className="relative mt-7 h-px w-full bg-ink/15" />
              <p className="relative mt-6 max-w-[18rem] text-lg font-black leading-7">
                不是独自通关，<br />是一起走完这一程。
              </p>

              <div className="relative mt-9 flex items-end justify-between gap-5">
                <div>
                  <p className="text-[9px] font-black tracking-[0.18em] text-foil-dim">PASSPORT NO.</p>
                  <p className="tabular mt-1 text-sm font-black tracking-[0.16em]">GLA · 001</p>
                </div>
                <div className="flex h-9 items-stretch gap-[3px]" aria-hidden="true">
                  {[2, 1, 3, 1, 2, 4, 1, 2, 1].map((width, index) => (
                    <span key={index} className="bg-ink" style={{ width }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteScrollManager />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/play" element={<PlayPage />} />
        <Route path="/play/:joinToken" element={<PlayPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/screen" element={<ScreenPage />} />
        <Route path="/screen/:screenToken" element={<ScreenPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/badge" element={<BadgePage />} />
        <Route path="/badge/:joinToken" element={<BadgePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

/**
 * React Router keeps the old document offset when it swaps screens. The guide
 * deliberately restores its own reading position, but every screen opened
 * from it should start at the top — especially preview screens whose return
 * control lives in the demo bar.
 */
function RouteScrollManager() {
  const location = useLocation();

  useLayoutEffect(() => {
    if (location.pathname === "/guide" || location.pathname === "/library") return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname, location.search]);

  return null;
}

function NotFound() {
  return (
    <main className="brand-stage relative grid min-h-dvh place-items-center overflow-hidden p-6 text-center">
      <div className="night-sky" />
      <div className="relative z-10">
        <div className="tabular text-8xl font-black text-ink">404</div>
        <h1 className="mt-3 text-2xl font-black">这一站不在地图上</h1>
        <Link to="/" className="pressable mt-7 inline-block rounded-full bg-ink px-7 py-3.5 font-black text-white">回到入口</Link>
      </div>
    </main>
  );
}
