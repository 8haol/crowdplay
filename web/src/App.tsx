import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import PlayPage from "./play/PlayPage";
import StaffPage from "./staff/StaffPage";
import AdminPage from "./admin/AdminPage";
import ScreenPage from "./screen/ScreenPage";
import BadgePage from "./play/BadgePage";
import { BrandMark } from "./lib/ui";

function Home() {
  return (
    <div className="brand-stage relative min-h-dvh overflow-hidden">
      <div className="night-sky" />
      <main className="relative z-10 mx-auto grid min-h-dvh w-full max-w-6xl content-center gap-10 px-6 py-10 md:grid-cols-[1.05fr_.95fr] md:items-center md:px-10">
        <section>
          <div className="rise mb-7 w-fit max-w-[17rem] rounded-[18px] bg-white p-3 shadow-[0_3px_0_#e0a800] md:max-w-[20rem]" style={{ "--i": 0 } as React.CSSProperties}>
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
          <h1 className="rise mt-3 max-w-xl text-[clamp(3.4rem,7vw,6rem)] font-black leading-[1.06] tracking-[-0.045em] text-ink md:leading-[0.98] md:tracking-[-0.06em]" style={{ "--i": 1 } as React.CSSProperties}>
            <span className="block">这一程，</span>
            <span className="mt-1 block md:mt-2">由你盖章。</span>
          </h1>
          <p className="rise mt-6 max-w-sm text-[15px] font-semibold leading-7 text-foil-dim" style={{ "--i": 2 } as React.CSSProperties}>
            60 分钟人生模拟游戏。领取编号、找到同行者、完成七个站点，也接住路上意想不到的事。
          </p>

          <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
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
        </div>
        </section>

        <section className="rise flex flex-col items-center md:items-end" style={{ "--i": 3 } as React.CSSProperties}>
          <BrandMark className="md:w-[22rem]" />
          <p className="mt-5 text-center text-xs font-black tracking-[0.18em] text-foil-dim md:text-right">
            YOU DON'T HAVE TO DO LIFE ALONE
          </p>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteBack />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/play" element={<PlayPage />} />
        <Route path="/play/:joinToken" element={<PlayPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/screen" element={<ScreenPage />} />
        <Route path="/badge" element={<BadgePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

function RouteBack() {
  const { pathname } = useLocation();
  if (pathname === "/") return null;

  return (
    <Link
      to="/"
      className="route-back pressable fixed z-[60] grid h-11 w-11 place-items-center rounded-full border-2 border-ink bg-card text-2xl font-black leading-none text-ink shadow-[0_3px_0_#0f0d0a]"
      aria-label="返回入口"
      title="返回入口"
    >
      <span aria-hidden="true">←</span>
    </Link>
  );
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
