import { useEffect, useMemo, useState } from "react";
import { rpc, readView, errorText, newIdemKey } from "../lib/api";
import type {
  AwardResultEntry,
  LifeEventResult,
  StaffLookupEntry,
  Station,
} from "../lib/types";
import { CARDS } from "../lib/types";
import { ActionButton, BrandMark, CodeInput, ErrorBanner, SuccessBanner } from "../lib/ui";

const SESSION_KEY = "lp_staff_key";
const LS_STATION = "lp_staff_station";

export default function StaffPage() {
  const [staffKey, setStaffKey] = useState<string | null>(() => sessionStorage.getItem(SESSION_KEY));
  const [stationId, setStationId] = useState<number | null>(() => {
    const v = localStorage.getItem(LS_STATION);
    return v ? Number(v) : null;
  });
  const [stations, setStations] = useState<Station[]>([]);

  useEffect(() => {
    readView<Station[]>("stations?select=*&order=sort_order").then(setStations).catch(() => {});
  }, []);

  if (!staffKey) {
    return (
      <Login
        title="工作人员"
        onOk={(k) => {
          sessionStorage.setItem(SESSION_KEY, k);
          setStaffKey(k);
        }}
      />
    );
  }

  const station = stations.find((s) => s.id === stationId) ?? null;

  if (!station) {
    return (
      <Shell title="选择你负责的站点" onLogout={() => logout(setStaffKey)}>
        <div className="space-y-2">
          {stations.map((s) => (
            <button
              key={s.id}
              className="pressable w-full rounded-2xl bg-card border border-line px-4 py-4 text-left hover:border-ink/40 transition-colors duration-150"
              onClick={() => {
                localStorage.setItem(LS_STATION, String(s.id));
                setStationId(s.id);
              }}
            >
              <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <span className="font-bold text-lg text-ink">{s.name_zh}</span>
                <span className="text-xs text-ink-dim">
                  {s.type === "main"
                    ? s.scoring_mode === "graded" ? "3 / 6 / 9 计分" : "完成得 6 分"
                    : s.type === "life_event" ? "抽卡处理" : "Token 兑换"}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-dim/60">
                {s.slug}
              </div>
            </button>
          ))}
          {stations.length === 0 && <div className="text-ink-dim">加载站点中…</div>}
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      title={station.name_zh}
      subtitle={
        station.type === "main"
          ? station.scoring_mode === "graded" ? "计分 3 / 6 / 9 或失败" : "计分 完成 6 分或失败"
          : station.type === "life_event" ? "人生盲盒" : "恩典站"
      }
      onSwitch={() => {
        localStorage.removeItem(LS_STATION);
        setStationId(null);
      }}
      onLogout={() => logout(setStaffKey)}
    >
      {station.type === "main" && (
        <MainStation key={station.id} staffKey={staffKey} station={station} />
      )}
      {station.type === "life_event" && <LifeEventStation staffKey={staffKey} />}
      {station.type === "grace" && <GraceStation staffKey={staffKey} stations={stations} />}
    </Shell>
  );
}

function logout(set: (v: null) => void) {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LS_STATION);
  set(null);
}

function Shell(props: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onSwitch?: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="min-h-dvh bg-desk text-ink">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-foil px-4 py-3.5 text-ink shadow-[0_2px_0_#e0a800]">
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{props.title}</div>
          {props.subtitle && <div className="text-xs font-semibold text-foil-dim">{props.subtitle}</div>}
        </div>
        <div className="flex shrink-0 gap-1.5 text-xs sm:gap-2">
          {props.onSwitch && (
            <button className="pressable rounded-full bg-white px-3 py-1.5 font-black" onClick={props.onSwitch}>
              换站点
            </button>
          )}
          <button className="pressable rounded-full px-2 py-1.5 font-bold text-foil-dim" onClick={props.onLogout}>
            退出
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-md p-4 pb-24 sm:pb-8">{props.children}</main>
    </div>
  );
}

export function Login(props: { title: string; onOk: (key: string) => void; admin?: boolean }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="relative min-h-dvh bg-desk text-ink flex flex-col items-center justify-center overflow-hidden p-6">
      <div className="night-sky" />
      <div className="relative z-10 flex w-full flex-col items-center">
      <BrandMark className="!w-[104px] !gap-1 !rounded-[18px] !p-2.5 !shadow-[0_3px_0_#e0a800]" />
      <p className="mt-6 font-mono text-[10px] font-black tracking-[0.4em] text-ink-dim">LIFE PASSPORT · CREW</p>
      <h1 className="font-black text-3xl mt-2">{props.title}</h1>
      <div className="w-full max-w-xs mt-8 space-y-3">
        <input
          type="password"
          className="w-full rounded-[14px] border-2 border-transparent bg-card px-4 py-3.5 text-lg font-bold outline-none transition-shadow duration-200 focus:shadow-[0_0_0_3px_#ffc838]"
          placeholder="密码"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <ErrorBanner text={err} />
        <ActionButton
          disabled={!key}
          onClick={async () => {
            setErr(null);
            try {
              // cheap key validation round-trip
              if (props.admin) {
                await rpc("admin_list_players", { p_admin_key: key });
              } else {
                await rpc("staff_lookup", { p_staff_key: key, p_codes: [] });
              }
              props.onOk(key);
            } catch (e) {
              setErr(errorText(e));
            }
          }}
        >
          登录
        </ActionButton>
      </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main station: batch entry of 1-3 codes
// ---------------------------------------------------------------------------
type Entry = { code: string; choice: number | "failed" | null };

function MainStation({ staffKey, station }: { staffKey: string; station: Station }) {
  const [codes, setCodes] = useState<string[]>([""]);
  const [team, setTeam] = useState<StaffLookupEntry[] | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [idemKey, setIdemKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<AwardResultEntry[] | null>(null);

  const scoreChoices = station.scoring_mode === "graded" ? [3, 6, 9] : [6];

  const lookup = async () => {
    setErr(null);
    const clean = codes.map((c) => c.trim()).filter((c) => c.length === 4);
    if (clean.length === 0) {
      setErr("请输入至少一个 4 位码");
      return;
    }
    if (new Set(clean).size !== clean.length) {
      setErr("有重复的 4 位码");
      return;
    }
    try {
      const r = await rpc<StaffLookupEntry[]>("staff_lookup", {
        p_staff_key: staffKey,
        p_codes: clean,
      });
      setTeam(r);
      setEntries(clean.map((code) => ({ code, choice: null })));
      setIdemKey(newIdemKey()); // one key per confirmed batch; retries reuse it
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const warnings = (p: StaffLookupEntry): string | null => {
    if (!p.found) return "查无此人，请核对";
    if (p.locked_for_life_event) return "被盲盒锁定，先去人生盲盒站";
    const attempted = p.attempted_station_ids?.includes(station.id);
    const retry = p.retry_station_ids?.includes(station.id);
    if (attempted && retry) return null; // second chance pending: fine
    if (attempted) return "已挑战过本站，不能再录";
    return null;
  };

  const blocked = team?.some((p) => warnings(p) !== null) ?? true;
  const allChosen = entries.length > 0 && entries.every((e) => e.choice !== null);

  const submit = async () => {
    setErr(null);
    try {
      const r = await rpc<{ results: AwardResultEntry[] }>("award_scores", {
        p_staff_key: staffKey,
        p_station_id: station.id,
        p_idempotency_key: idemKey,
        p_entries: entries.map((e) => ({
          code: e.code,
          score: e.choice === "failed" ? 0 : e.choice,
          failed: e.choice === "failed",
        })),
      });
      setResults(r.results);
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const reset = () => {
    setCodes([""]);
    setTeam(null);
    setEntries([]);
    setResults(null);
    setErr(null);
  };

  if (results) {
    return (
      <div className="space-y-3">
        <SuccessBanner text="已记分" />
        {results.map((r) => (
          <div key={r.code} className="rounded-2xl bg-card border border-line p-4">
            <div className="flex justify-between items-baseline">
              <div className="font-bold text-lg">
                {r.name} <span className="text-ink-dim text-sm tabular">{r.code}</span>
              </div>
              <div className={`font-bold tabular ${r.status === "failed" ? "text-seal" : "text-leaf-deep"}`}>
                {r.status === "failed" ? "未通过" : `+${r.awarded}`}
                {r.cap_applied && <span className="text-xs ml-1 font-medium">（感冒限 1 分）</span>}
              </div>
            </div>
            <div className="text-sm text-ink-dim mt-1 tabular">总分 {r.new_score}</div>
            {r.life_event_triggered && (
              <div className="mt-2.5 rounded-xl bg-seal/10 border border-seal/45 text-seal px-3 py-2.5 text-sm font-bold">
                触发人生盲盒（{r.threshold} 分关口），请让 TA 立即去人生盲盒站
              </div>
            )}
          </div>
        ))}
        <ActionButton onClick={reset}>录入下一组</ActionButton>
      </div>
    );
  }

  if (team) {
    return (
      <div className="space-y-3">
        {team.map((p, i) => {
          const w = warnings(p);
          const entry = entries[i];
          const retry = p.retry_station_ids?.includes(station.id);
          return (
            <div key={p.code} className={`rounded-2xl bg-card border p-4 ${w ? "border-seal/45" : "border-line"}`}>
              <div className="flex justify-between items-baseline">
                <div className="font-bold text-lg">
                  {p.found ? p.name : "？"} <span className="text-ink-dim text-sm tabular">{p.code}</span>
                </div>
                {p.found && <div className="text-sm text-ink-dim tabular">当前 {p.score} 分</div>}
              </div>
              {retry && !w && (
                <div className="mt-1 text-xs font-bold" style={{ color: "oklch(0.62 0.09 85)" }}>
                  ✨ 使用 Second Chance 重新挑战
                </div>
              )}
              {w ? (
                <div className="mt-2 text-seal text-sm font-bold">{w}</div>
              ) : (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {scoreChoices.map((s) => (
                    <ScoreBtn
                      key={s}
                      active={entry?.choice === s}
                      onClick={() => setChoice(i, s)}
                      label={station.scoring_mode === "fixed" ? `完成 ${s}` : String(s)}
                    />
                  ))}
                  <ScoreBtn
                    active={entry?.choice === "failed"}
                    danger
                    onClick={() => setChoice(i, "failed")}
                    label="失败"
                  />
                </div>
              )}
            </div>
          );
        })}
        <ErrorBanner text={err} />
        <ActionButton onClick={submit} disabled={blocked || !allChosen}>
          确认提交（{entries.length} 人）
        </ActionButton>
        <ActionButton variant="tool-ghost" onClick={reset}>
          重新输入编号
        </ActionButton>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-dim">输入本队 1~3 名玩家的 4 位码，Duo / Trio 整队一起录</p>
      {codes.map((c, i) => (
        <div key={i} className="flex gap-2">
          <CodeInput value={c} onChange={(v) => setCodes(codes.map((x, j) => (j === i ? v : x)))} />
          {codes.length > 1 && (
            <button
              className="pressable px-4 rounded-2xl border-2 border-line text-ink-dim"
              onClick={() => setCodes(codes.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {codes.length < 3 && (
        <button
          className="pressable w-full rounded-2xl border-2 border-dashed border-ink/25 py-3 text-ink-dim hover:border-ink/45 transition-colors duration-150"
          onClick={() => setCodes([...codes, ""])}
        >
          ＋ 再加一名队员
        </button>
      )}
      <ErrorBanner text={err} />
      <ActionButton onClick={lookup} disabled={!codes.some((c) => c.length === 4)}>
        查询队伍
      </ActionButton>
    </div>
  );

  function setChoice(i: number, choice: number | "failed") {
    setEntries((es) => es.map((e, j) => (j === i ? { ...e, choice } : e)));
  }
}

function ScoreBtn(props: { active: boolean; onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button
      className={`pressable rounded-xl py-3.5 font-bold tabular border-2 transition-colors duration-150 ${
        props.active
          ? props.danger
            ? "bg-seal text-card border-seal"
            : "bg-ink text-card border-ink"
          : "bg-card border-line text-ink hover:border-ink/40"
      }`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Life event (blind box) station
// ---------------------------------------------------------------------------
function LifeEventStation({ staffKey }: { staffKey: string }) {
  const [code, setCode] = useState("");
  const [player, setPlayer] = useState<StaffLookupEntry | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<LifeEventResult | null>(null);

  const lookup = async () => {
    setErr(null);
    try {
      const r = await rpc<StaffLookupEntry[]>("staff_lookup", { p_staff_key: staffKey, p_codes: [code] });
      setPlayer(r[0]);
      setCard(null);
      setIdemKey(newIdemKey());
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const apply = async () => {
    if (!card) return;
    setErr(null);
    try {
      const r = await rpc<LifeEventResult>("apply_life_event", {
        p_staff_key: staffKey,
        p_player_code: code,
        p_card_type: card,
        p_idempotency_key: idemKey,
      });
      setResult(r);
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const reset = () => {
    setCode("");
    setPlayer(null);
    setCard(null);
    setResult(null);
    setErr(null);
  };

  if (result) {
    return (
      <div className="space-y-4 text-center">
        <SuccessBanner text="已处理，玩家已解锁" />
        <div className="rounded-2xl bg-card border border-line p-6">
          <div className="font-bold text-lg">{result.name}</div>
          <div className="mt-2 text-ink-dim">{result.card_label}</div>
          <div className="mt-5 tabular font-serif font-black text-4xl">
            <span className="text-ink-dim/60">{result.score_before}</span>
            <span className="mx-3 text-ink-dim/40">→</span>
            <span className="text-ink">{result.score_after}</span>
          </div>
          <div className="mt-3 text-xs text-ink-dim">
            {result.next_threshold ? `下一个关口 ${result.next_threshold} 分` : "已过所有关口"}
          </div>
        </div>
        <ActionButton onClick={reset}>处理下一位</ActionButton>
      </div>
    );
  }

  if (player) {
    if (!player.found || !player.locked_for_life_event) {
      return (
        <div className="space-y-3">
          <ErrorBanner
            text={!player.found ? `查无 ${player.code}，请核对` : `${player.name} 没有被锁定，不需要抽卡`}
          />
          <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-card border border-line p-4 flex justify-between items-baseline">
          <div className="font-bold text-lg">
            {player.name} <span className="text-ink-dim text-sm tabular">{player.code}</span>
          </div>
          <div className="tabular text-ink-dim">当前 {player.score} 分</div>
        </div>
        <p className="text-sm text-ink-dim">玩家抽实体卡后，点选对应卡面：</p>
        <div className="grid grid-cols-2 gap-2">
          {CARDS.map((c) => (
            <button
              key={c.type}
              className={`pressable rounded-2xl border-2 p-3.5 text-left transition-colors duration-150 ${
                card === c.type
                  ? "border-ink bg-ink text-card"
                  : c.tone === "good"
                    ? "border-leaf-deep/35 bg-leaf/8 hover:border-leaf-deep/60"
                    : c.tone === "bad"
                      ? "border-seal/35 bg-seal/8 hover:border-seal/60"
                      : "border-line bg-card hover:border-ink/40"
              }`}
              onClick={() => setCard(c.type)}
            >
              <div className="font-bold text-sm">{c.label}</div>
              <div className={`text-xs mt-1 ${card === c.type ? "text-card/70" : "text-ink-dim"}`}>{c.effect}</div>
            </button>
          ))}
        </div>
        <ErrorBanner text={err} />
        <ActionButton onClick={apply} disabled={!card}>
          确认应用卡片效果
        </ActionButton>
        <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-dim">输入被锁定玩家的 4 位码</p>
      <CodeInput value={code} onChange={setCode} autoFocus />
      <ErrorBanner text={err} />
      <ActionButton onClick={lookup} disabled={code.length !== 4}>
        查询玩家
      </ActionButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grace station (token)
// ---------------------------------------------------------------------------
function GraceStation({ staffKey, stations }: { staffKey: string; stations: Station[] }) {
  const [code, setCode] = useState("");
  const [player, setPlayer] = useState<StaffLookupEntry | null>(null);
  const [usage, setUsage] = useState<"hint" | "second_chance" | "grace_card" | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [idemKey, setIdemKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const stationName = useMemo(
    () => new Map(stations.map((s) => [s.id, s.name_zh])),
    [stations],
  );

  const lookup = async () => {
    setErr(null);
    try {
      const r = await rpc<StaffLookupEntry[]>("staff_lookup", { p_staff_key: staffKey, p_codes: [code] });
      setPlayer(r[0]);
      setUsage(null);
      setTarget(null);
      setIdemKey(newIdemKey());
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const submit = async () => {
    if (!usage) return;
    setErr(null);
    try {
      await rpc("use_token", {
        p_staff_key: staffKey,
        p_player_code: code,
        p_usage_type: usage,
        p_station_id: usage === "second_chance" ? target : null,
        p_idempotency_key: idemKey,
      });
      setDone(
        usage === "hint"
          ? "已记录：换取提示"
          : usage === "grace_card"
            ? "已记录：换取纪念卡"
            : `已发放 Second Chance：${stationName.get(target!) ?? ""} 可重新挑战`,
      );
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const reset = () => {
    setCode("");
    setPlayer(null);
    setUsage(null);
    setTarget(null);
    setDone(null);
    setErr(null);
  };

  if (done) {
    return (
      <div className="space-y-4">
        <SuccessBanner text={done} />
        <ActionButton onClick={reset}>服务下一位</ActionButton>
      </div>
    );
  }

  if (player) {
    if (!player.found) {
      return (
        <div className="space-y-3">
          <ErrorBanner text={`查无 ${player.code}，请核对`} />
          <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
        </div>
      );
    }
    if (!player.token_available) {
      return (
        <div className="space-y-3">
          <ErrorBanner text={`${player.name} 的 Help Token 已经用过了`} />
          <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
        </div>
      );
    }
    const failed = player.failed_station_ids ?? [];
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-card border border-line p-4 flex justify-between items-baseline">
          <div className="font-bold text-lg">
            {player.name} <span className="text-ink-dim text-sm tabular">{player.code}</span>
          </div>
          <div className="font-bold" style={{ color: "oklch(0.62 0.09 85)" }}>🪙 Token 可用</div>
        </div>
        <p className="text-sm text-ink-dim">选择兑换方式，Token 用后不退：</p>
        <div className="space-y-2">
          <UsageBtn active={usage === "hint"} onClick={() => setUsage("hint")}
            title="💡 换提示" desc="站点给出提示，正常挑战计分" />
          <UsageBtn
            active={usage === "second_chance"}
            onClick={() => { setUsage("second_chance"); setTarget(null); }}
            title="🔄 Second Chance"
            desc={failed.length > 0 ? "选择一个失败过的站重新挑战" : "TA 还没有失败过的站，不可选"}
            disabled={failed.length === 0}
          />
          <UsageBtn active={usage === "grace_card"} onClick={() => setUsage("grace_card")}
            title="🎁 换纪念卡" desc="领取实体纪念卡，仅记录" />
        </div>
        {usage === "second_chance" && failed.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {failed.map((id) => (
              <button
                key={id}
                className={`pressable rounded-xl border-2 py-3.5 font-bold transition-colors duration-150 ${
                  target === id ? "bg-ink text-card border-ink" : "bg-card border-line hover:border-ink/40"
                }`}
                onClick={() => setTarget(id)}
              >
                {stationName.get(id) ?? `站点 ${id}`}
              </button>
            ))}
          </div>
        )}
        <ErrorBanner text={err} />
        <ActionButton onClick={submit} disabled={!usage || (usage === "second_chance" && !target)}>
          确认使用 Token
        </ActionButton>
        <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-dim">输入玩家的 4 位码</p>
      <CodeInput value={code} onChange={setCode} autoFocus />
      <ErrorBanner text={err} />
      <ActionButton onClick={lookup} disabled={code.length !== 4}>
        查询玩家
      </ActionButton>
    </div>
  );
}

function UsageBtn(props: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={`pressable w-full rounded-2xl border-2 p-3.5 text-left disabled:opacity-40 transition-colors duration-150 ${
        props.active ? "bg-ink text-card border-ink" : "bg-card border-line hover:border-ink/40"
      }`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <div className="font-bold">{props.title}</div>
      <div className={`text-xs mt-0.5 ${props.active ? "text-card/70" : "text-ink-dim"}`}>{props.desc}</div>
    </button>
  );
}
