import type { Phase } from "../lib/types";
import type { AdminTab } from "./adminUtils";

export function AdminIcon({ name, className = "" }: { name: AdminTab | "screen" | "plus" | "download" | "close" | "chevron"; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    overview: <><path d="M4 4h6v6H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 14h6v6H4z" /></>,
    events: <><path d="M5 4h14v16H5zM8 2v4M16 2v4M5 9h14" /></>,
    players: <><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 21v-2a6 6 0 0 1 12 0v2M17 8a3 3 0 0 1 0 6M17 16a5 5 0 0 1 4 5" /></>,
    "life-events": <><path d="M12 21s7-3.8 7-10.2A4.8 4.8 0 0 0 10.1 8 4.8 4.8 0 0 0 5 6.2C2.7 6.2 1 8.1 1 10.8 1 17.2 8 21 12 21Z" /><path d="m8.7 12.2 2-2 1.8 1.8 2.8-3" /></>,
    stations: <><path d="M4 19V9M12 19V4M20 19v-7M2 19h20" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    screen: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    chevron: <><path d="m9 18 6-6-6-6" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function PhaseLabel({ phase }: { phase: Phase }) {
  const look = {
    waiting: ["等待开始", "bg-[#fff0bf] text-[#755200]"],
    playing: ["进行中", "bg-[#e2f5e9] text-[#1f7543]"],
    ended: ["已归档", "bg-[#eeeae2] text-[#6c6458]"],
  }[phase];
  return <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-black ${look[1]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{look[0]}</span>;
}

export function PageTitle({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div>{eyebrow && <div className="text-xs font-black tracking-[0.18em] text-[#8b806f]">{eyebrow}</div>}<h1 className="mt-1 text-[clamp(2rem,4vw,3.25rem)] font-black leading-none tracking-[-0.05em]">{title}</h1>{description && <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[#746b5e]">{description}</p>}</div>{actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}</header>;
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[22px] border border-[#e4dac8] bg-white ${className}`}>{children}</section>;
}

export function Modal({ children, onClose, width = "max-w-xl" }: { children: React.ReactNode; onClose: () => void; width?: string }) {
  return <div className="fixed inset-0 z-40 flex items-end justify-center bg-[#211d18]/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={onClose}><div className={`toast-in max-h-[92dvh] w-full ${width} overflow-y-auto rounded-t-[26px] bg-[#fcfaf6] p-6 shadow-[0_24px_80px_rgba(45,35,22,.22)] sm:rounded-[26px]`} onMouseDown={(event) => event.stopPropagation()}>{children}</div></div>;
}

export function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-40 bg-[#211d18]/45 backdrop-blur-[2px]" onMouseDown={onClose}><aside className="toast-in absolute inset-y-0 right-0 w-full max-w-3xl overflow-y-auto bg-[#fcfaf6] shadow-[-20px_0_70px_rgba(45,35,22,.18)]" onMouseDown={(event) => event.stopPropagation()}>{children}</aside></div>;
}
