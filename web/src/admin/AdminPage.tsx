import { useMemo, useState } from "react";
import { rpc, errorText } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { AdminPlayer, BoardSnapshot, Phase } from "../lib/types";
import { colorOf, soloColor } from "../lib/types";
import { ActionButton, ConnDot, ErrorBanner, SuccessBanner } from "../lib/ui";
import { Login } from "../staff/StaffPage";

const SESSION_KEY = "lp_admin_key";

interface AdminSnapshot {
  players: AdminPlayer[];
  phase: Phase;
}

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState<string | null>(() => sessionStorage.getItem(SESSION_KEY));

  if (!adminKey) {
    return (
      <Login
        title="管理端"
        admin
        onOk={(k) => {
          sessionStorage.setItem(SESSION_KEY, k);
          setAdminKey(k);
        }}
      />
    );
  }
  return <AdminMain adminKey={adminKey} onLogout={() => { sessionStorage.removeItem(SESSION_KEY); setAdminKey(null); }} />;
}

function AdminMain({ adminKey, onLogout }: { adminKey: string; onLogout: () => void }) {
  const pollFn = useMemo(
    () => async (): Promise<AdminSnapshot> => {
      const [players, board] = await Promise.all([
        rpc<AdminPlayer[]>("admin_list_players", { p_admin_key: adminKey }),
        rpc<BoardSnapshot>("board_snapshot", {}),
      ]);
      return { players, phase: board.phase };
    },
    [adminKey],
  );
  const { data, online, refresh } = usePoll<AdminSnapshot>(pollFn, 5000);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const players = data?.players ?? [];
  const filtered = players.filter(
    (p) => !search || p.name.includes(search) || p.code.includes(search),
  );
  const active = players.filter((p) => !p.is_removed);
  const sel = players.find((p) => p.code === selected) ?? null;

  return (
    <div className="min-h-dvh bg-desk pb-24 text-ink sm:pb-16">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-foil py-3.5 pr-4 pl-[4.5rem] text-ink shadow-[0_2px_0_#e0a800]">
        <div className="flex shrink-0 items-center gap-2 font-bold">
          管理端 <ConnDot online={online} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm sm:gap-3">
          <PhaseBadge phase={data?.phase} />
          {/* opens in its own window so the board can live on the projector
              while this page stays on the operator's screen */}
          <a
            href="/screen"
            target="_blank"
            rel="noreferrer"
            className="pressable rounded-full bg-white px-3 py-1.5 text-xs font-black"
          >
            实况大屏 ↗
          </a>
          <button className="pressable text-foil-dim text-xs font-bold" onClick={onLogout}>退出</button>
        </div>
      </header>

      <main className="p-4 max-w-2xl mx-auto space-y-5">
        {banner && <SuccessBanner text={banner} />}

        <GameControls
          adminKey={adminKey}
          phase={data?.phase}
          playerCount={active.length}
          onDone={(msg) => { setBanner(msg); refresh(); }}
        />

        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif font-black text-xl">玩家总表</h2>
            <span className="text-sm text-ink-dim tabular">{active.length} 人在场</span>
          </div>
          <input
            className="mt-3 w-full rounded-2xl border-2 border-line bg-card px-4 py-2.5 focus:border-ink outline-none transition-colors duration-150 placeholder:text-ink-dim/50"
            placeholder="搜索名字或 4 位码"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="mt-3 space-y-2">
            {filtered
              .slice()
              .sort((a, b) => b.score - a.score)
              .map((p) => {
                const color = colorOf(p.color_group) ?? (p.identity === "solo" ? soloColor(p.code) : null);
                return (
                  <button
                    key={p.code}
                    className={`pressable w-full rounded-2xl border bg-card p-3.5 text-left transition-colors duration-150 ${
                      p.is_removed ? "opacity-40 border-line" : "border-line hover:border-ink/40"
                    }`}
                    onClick={() => setSelected(p.code)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 break-words font-bold">
                        {p.name}
                        <span className="ml-2 text-ink-dim text-sm tabular">{p.code}</span>
                        {p.is_removed && <span className="ml-2 text-xs text-seal">已删除</span>}
                      </div>
                      <div className="tabular font-serif font-black text-2xl">{p.score}</div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-dim">
                      <span>{p.identity ?? "未分配"}</span>
                      {color && (
                        <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: color.hex }} />
                      )}
                      <span className="tabular">已挑战 {p.attempt_count}/7 站</span>
                      {p.locked_for_life_event && <span className="text-seal font-bold">🔒 盲盒锁定</span>}
                      {!p.token_available && <span>Token 已用</span>}
                      {p.status_effect && <span className="text-seal">🤒 感冒中</span>}
                    </div>
                  </button>
                );
              })}
            {filtered.length === 0 && <div className="text-ink-dim text-sm py-4 text-center">没有匹配的玩家</div>}
          </div>
        </section>
      </main>

      {sel && (
        <AdjustSheet
          key={sel.code}
          adminKey={adminKey}
          player={sel}
          onClose={() => setSelected(null)}
          onDone={(msg) => { setBanner(msg); setSelected(null); refresh(); }}
        />
      )}
    </div>
  );
}

function PhaseBadge({ phase }: { phase?: Phase }) {
  const map: Record<Phase, { t: string; c: string }> = {
    waiting: { t: "等待开始", c: "bg-white text-ink" },
    playing: { t: "进行中", c: "bg-leaf text-white" },
    ended: { t: "已结束", c: "bg-ink text-white" },
  };
  if (!phase) return null;
  const m = map[phase];
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${m.c}`}>{m.t}</span>;
}

function GameControls(props: {
  adminKey: string;
  phase?: Phase;
  playerCount: number;
  onDone: (msg: string) => void;
}) {
  const [trio, setTrio] = useState("6");
  const [duo, setDuo] = useState("10");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const numInput =
    "mt-1 w-full rounded-xl border-2 border-line bg-card px-3 py-2.5 tabular text-lg focus:border-ink outline-none transition-colors duration-150";

  if (props.phase === "waiting") {
    const trioN = Number(trio) || 0;
    const duoN = Number(duo) || 0;
    const grouped = trioN * 3 + duoN * 2;
    return (
      <section className="rounded-2xl border border-line bg-card p-4 space-y-3">
        <h2 className="font-serif font-black text-xl">开始游戏</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="font-bold">Trio 组数</span>
            <span className="text-ink-dim">（每组 3 人）</span>
            <input inputMode="numeric" className={numInput}
              value={trio} onChange={(e) => setTrio(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="text-sm">
            <span className="font-bold">Duo 对数</span>
            <span className="text-ink-dim">（每对 2 人）</span>
            <input inputMode="numeric" className={numInput}
              value={duo} onChange={(e) => setDuo(e.target.value.replace(/\D/g, ""))} />
          </label>
        </div>
        <p className="text-xs text-ink-dim leading-relaxed">
          当前 {props.playerCount} 人在场，组队占 {grouped} 人，其余全部为 Solo。
          人数不足时不足的组自动降级为 Solo。<b className="text-ink">开始后不可撤销、不可再分组。</b>
        </p>
        <ErrorBanner text={err} />
        <ActionButton
          onClick={async () => {
            setErr(null);
            try {
              const r = await rpc<{ total_players: number; trio_groups: number; duo_groups: number; solo_players: number }>(
                "start_game",
                { p_admin_key: props.adminKey, p_quota: { trio: trioN, duo: duoN } },
              );
              props.onDone(
                `游戏开始！${r.total_players} 人：${r.trio_groups} 个三人组、${r.duo_groups} 对、${r.solo_players} 名 Solo`,
              );
            } catch (e) {
              setErr(errorText(e));
            }
          }}
          disabled={props.playerCount === 0}
        >
          开始游戏（分配身份）
        </ActionButton>
      </section>
    );
  }

  if (props.phase === "playing") {
    return (
      <section className="rounded-2xl border border-line bg-card p-4 space-y-3">
        <h2 className="font-serif font-black text-xl">游戏进行中</h2>
        <ErrorBanner text={err} />
        {!confirmEnd ? (
          <ActionButton variant="tool-ghost" onClick={() => setConfirmEnd(true)}>
            结束游戏…
          </ActionButton>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-seal font-bold">确定结束？所有玩家将立即进入结算页，无法恢复。</p>
            <div className="grid grid-cols-2 gap-2">
              <ActionButton variant="danger" onClick={async () => {
                setErr(null);
                try {
                  await rpc("end_game", { p_admin_key: props.adminKey });
                  props.onDone("游戏已结束，玩家进入结算页");
                } catch (e) {
                  setErr(errorText(e));
                }
              }}>
                确认结束
              </ActionButton>
              <ActionButton variant="tool-ghost" onClick={() => setConfirmEnd(false)}>取消</ActionButton>
            </div>
          </div>
        )}
      </section>
    );
  }

  if (props.phase === "ended") {
    return (
      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="font-serif font-black text-xl">游戏已结束</h2>
        <p className="text-sm text-ink-dim mt-1">仍可用玩家详情里的「手动修正」做赛后补录。</p>
      </section>
    );
  }
  return null;
}

function AdjustSheet(props: {
  adminKey: string;
  player: AdminPlayer;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const p = props.player;
  const [score, setScore] = useState("");
  const [unlock, setUnlock] = useState(false);
  const [clearEffect, setClearEffect] = useState(false);
  const [restoreToken, setRestoreToken] = useState(false);
  const [restore, setRestore] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const dirty = score !== "" || unlock || clearEffect || restoreToken || restore;

  const fieldInput =
    "mt-1 w-full rounded-xl border-2 border-line bg-card px-3 py-2.5 focus:border-ink outline-none transition-colors duration-150 placeholder:text-ink-dim/50";

  return (
    <div className="fixed inset-0 z-20 bg-ink/45 flex items-end sm:items-center sm:justify-center" onClick={props.onClose}>
      <div
        className="toast-in max-h-[85dvh] w-full space-y-3 overflow-y-auto rounded-t-3xl bg-desk p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink sm:max-w-md sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-baseline">
          <div className="font-serif font-black text-2xl">
            {p.name} <span className="text-sm text-ink-dim tabular font-sans font-normal">{p.code}</span>
          </div>
          <button className="pressable text-ink-dim text-2xl leading-none px-1" onClick={props.onClose}>×</button>
        </div>
        <div className="text-sm text-ink-dim">
          总分 <b className="text-ink tabular">{p.score}</b> · 下一关口{" "}
          <b className="text-ink tabular">{p.next_threshold ?? "无"}</b>
          {p.locked_for_life_event && <span className="text-seal font-bold"> · 🔒 盲盒锁定</span>}
          {p.status_effect && <span className="text-seal"> · 🤒 感冒中</span>}
          {!p.token_available && <span> · Token 已用</span>}
          {p.is_removed && <span className="text-seal font-bold"> · 已删除</span>}
        </div>

        <label className="block text-sm">
          <span className="font-bold">改总分（留空 = 不改）</span>
          <input inputMode="numeric" className={`${fieldInput} tabular`}
            placeholder={String(p.score)} value={score}
            onChange={(e) => setScore(e.target.value.replace(/\D/g, ""))} />
        </label>
        <div className="space-y-2 text-sm">
          <Check v={unlock} set={setUnlock} label="强制解锁（清除盲盒锁定）" show={p.locked_for_life_event || unlock} />
          <Check v={clearEffect} set={setClearEffect} label="清除感冒效果（cap_next）" show={p.status_effect != null || clearEffect} />
          <Check v={restoreToken} set={setRestoreToken} label="归还 Help Token" show={!p.token_available || restoreToken} />
          <Check v={restore} set={setRestore} label="恢复此玩家（撤销删除）" show={p.is_removed || restore} />
        </div>
        <label className="block text-sm">
          <span className="font-bold">修正原因（必填，会留审计记录）</span>
          <input className={fieldInput}
            placeholder="例如：3 号站误录成 9 分" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <ErrorBanner text={err} />
        <ActionButton
          disabled={!dirty || !reason.trim()}
          onClick={async () => {
            setErr(null);
            try {
              await rpc("admin_adjust", {
                p_admin_key: props.adminKey,
                p_player_code: p.code,
                p_new_score: score === "" ? null : Number(score),
                p_unlock: unlock,
                p_clear_effect: clearEffect,
                p_restore_token: restoreToken,
                p_restore: restore,
                p_reason: reason.trim(),
              });
              props.onDone(`已修正 ${p.name}（${p.code}）`);
            } catch (e) {
              setErr(errorText(e));
            }
          }}
        >
          应用修正
        </ActionButton>

        {!p.is_removed && (
          !confirmRemove ? (
            <button className="pressable w-full py-2 text-seal text-sm underline underline-offset-4"
              onClick={() => setConfirmRemove(true)}>
              删除此玩家（垃圾注册）…
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <ActionButton variant="danger" onClick={async () => {
                setErr(null);
                try {
                  await rpc("admin_remove_player", { p_admin_key: props.adminKey, p_player_code: p.code });
                  props.onDone(`已删除 ${p.name}（${p.code}），可随时恢复`);
                } catch (e) {
                  setErr(errorText(e));
                }
              }}>
                确认删除
              </ActionButton>
              <ActionButton variant="tool-ghost" onClick={() => setConfirmRemove(false)}>取消</ActionButton>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function Check(props: { v: boolean; set: (v: boolean) => void; label: string; show: boolean }) {
  if (!props.show) return null;
  return (
    <label className="flex items-center gap-2.5">
      <input type="checkbox" className="h-5 w-5 accent-[oklch(0.28_0.045_265)]" checked={props.v} onChange={(e) => props.set(e.target.checked)} />
      {props.label}
    </label>
  );
}
