import { useEffect, useMemo, useState } from "react";
import { rpc, readView, errorText, newIdemKey } from "../lib/api";
import type {
  AwardTeamResult,
  StaffTeamLookup,
  Station,
} from "../lib/types";
import { ActionButton, BrandMark, ErrorBanner, SuccessBanner } from "../lib/ui";

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
                    : s.type === "life_event" ? "手机自动事件" : "Token 兑换"}
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
          : station.type === "life_event" ? "手机人生事件说明" : "恩典站"
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
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-foil py-3.5 pr-4 pl-[4.5rem] text-ink shadow-[0_2px_0_#e0a800]">
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
// Main station: one team identifier, one shared result
// ---------------------------------------------------------------------------
function MainStation({ staffKey, station }: { staffKey: string; station: Station }) {
  const [identifier, setIdentifier] = useState("");
  const [team, setTeam] = useState<StaffTeamLookup | null>(null);
  const [choice, setChoice] = useState<number | "failed" | null>(null);
  const [idemKey, setIdemKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AwardTeamResult | null>(null);

  const scoreChoices = station.scoring_mode === "graded" ? [3, 6, 9] : [6];

  const lookup = async () => {
    setErr(null);
    const clean = identifier.trim().toUpperCase();
    if (clean.length < 3) return setErr("请输入队伍码，或任意一位队员的 4 位人生编号");
    try {
      const r = await rpc<StaffTeamLookup>("staff_lookup_team", {
        p_staff_key: staffKey,
        p_identifier: clean,
      });
      setTeam(r);
      setChoice(null);
      setIdemKey(newIdemKey()); // one key per confirmed batch; retries reuse it
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const warning = (): string | null => {
    if (!team?.found) return "没有找到这支队伍，请核对编号";
    const attempted = team.attempted_station_ids?.includes(station.id);
    const retry = team.retry_station_ids?.includes(station.id);
    if (attempted && retry) return null;
    if (attempted) return "这支队伍已经挑战过本站，不能重复录分";
    return null;
  };

  const submit = async () => {
    if (choice == null) return;
    setErr(null);
    try {
      const r = await rpc<AwardTeamResult>("award_team_score", {
        p_staff_key: staffKey,
        p_identifier: team?.team_code ?? identifier,
        p_station_id: station.id,
        p_idempotency_key: idemKey,
        p_score: choice === "failed" ? 0 : choice,
        p_failed: choice === "failed",
      });
      setResult(r);
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const reset = () => {
    setIdentifier("");
    setTeam(null);
    setChoice(null);
    setResult(null);
    setErr(null);
  };

  if (result) {
    const triggered = result.members.filter((member) => member.life_event_triggered);
    return (
      <div className="space-y-3">
        <SuccessBanner text={`${result.team_code} 已完成整队记分，每位队员已同步更新`} />
        <div className="rounded-[24px] border border-line bg-card p-5">
          <div className="flex items-end justify-between gap-4">
            <div><div className="text-xs font-black tracking-[0.18em] text-ink-dim">本次队伍</div><div className="mt-1 text-2xl font-black">{result.team_code}</div></div>
            <div className={`rounded-xl px-4 py-3 text-right font-black ${result.status === "failed" ? "bg-seal/10 text-seal" : "bg-leaf/10 text-leaf-deep"}`}>{result.status === "failed" ? "本队本次未得分" : `每位队员 +${result.awarded} 分`}</div>
          </div>
          <div className="mt-4 divide-y divide-line border-t border-line">
            {result.members.map((member) => <div key={member.code} className="flex items-center justify-between py-3 text-sm"><span className="font-bold">{member.name} <small className="tabular text-ink-dim">{member.code}</small></span><span className="tabular font-black">总分 {member.new_score}</span></div>)}
          </div>
          {triggered.length > 0 && <div className="mt-2 rounded-xl border border-foil-dim/45 bg-foil/15 px-3 py-3 text-sm font-bold"><div>{triggered.map((member) => member.name).join("、")} 已触发手机人生事件</div><div className="mt-1 text-xs font-semibold text-ink-dim">事件在各自手机上完成，队伍不用停下来等待。</div></div>}
        </div>
        <ActionButton onClick={reset}>录入下一队</ActionButton>
      </div>
    );
  }

  if (team) {
    const w = warning();
    const retry = team.retry_station_ids?.includes(station.id);
    return (
      <div className="space-y-3">
        <div className={`rounded-[24px] border bg-card p-5 ${w ? "border-seal/45" : "border-line"}`}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="text-xs font-black tracking-[0.18em] text-ink-dim">已识别整队</div><div className="tabular mt-1 text-4xl font-black">{team.found ? team.team_code : "未找到"}</div></div>
            {team.found && <div className="rounded-xl bg-night-raise px-3 py-2 text-right"><div className="text-xs font-bold text-ink-dim">本次将同步记分</div><div className="mt-1 text-sm font-black">{team.members?.length ?? 0} 位队员</div></div>}
          </div>
          {team.found && <div className="mt-4 flex flex-wrap gap-2">{team.members?.map((member) => <span key={member.code} className="rounded-full bg-night-raise px-3 py-1.5 text-sm font-bold">{member.name} <small className="tabular text-ink-dim">{member.code}</small></span>)}</div>}
          {retry && !w && <div className="mt-3 rounded-lg bg-foil/15 px-3 py-2 text-xs font-black">✨ 本次使用整队 Second Chance</div>}
          {w && <div className="mt-3 text-sm font-bold text-seal">{w}</div>}
        </div>
        {!w && <div className="rounded-[24px] border border-line bg-card p-4"><div className="mb-3 text-sm font-black">选择全队本次结果</div><div className="grid grid-cols-4 gap-2">
          {scoreChoices.map((score) => <ScoreBtn key={score} active={choice === score} onClick={() => setChoice(score)} label={station.scoring_mode === "fixed" ? `完成 ${score}` : String(score)} />)}
          <ScoreBtn active={choice === "failed"} danger onClick={() => setChoice("failed")} label="失败" />
        </div></div>}
        <ErrorBanner text={err} />
        <ActionButton onClick={submit} disabled={Boolean(w) || choice == null}>确认整队记分</ActionButton>
        <ActionButton variant="tool-ghost" onClick={reset}>重新识别</ActionButton>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-card p-4"><div className="text-sm font-black">只需一个编号</div><p className="mt-1 text-sm leading-6 text-ink-dim">优先输入短队伍码（如 D03 / T07）；也可以输入队内任意一人的 4 位人生编号，系统会自动带出整队。</p></div>
      <input autoFocus inputMode="text" autoCapitalize="characters" maxLength={4} className="tabular w-full rounded-[20px] border-2 border-line bg-card px-5 py-5 text-center text-4xl font-black uppercase tracking-[0.16em] outline-none focus:border-foil" placeholder="D03" value={identifier} onChange={(event) => setIdentifier(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter" && identifier.length >= 3) lookup(); }} />
      <ErrorBanner text={err} />
      <ActionButton onClick={lookup} disabled={identifier.length < 3}>识别整队</ActionButton>
    </div>
  );
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
function LifeEventStation({ staffKey: _staffKey }: { staffKey: string }) {
  return <div className="space-y-4">
    <div className="rounded-[28px] border border-foil-dim/45 bg-card p-6 text-center shadow-[0_3px_0_#e0a800]">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-foil/20 text-3xl">📱</div>
      <h2 className="mt-5 text-2xl font-black">人生事件已经数字化</h2>
      <p className="mt-3 text-sm font-semibold leading-7 text-ink-dim">玩家跨过 15 / 35 / 45 分关口后，场景会直接出现在自己的手机上。玩家做出选择后，服务器随机揭晓结果并自动计分。</p>
    </div>
    <div className="rounded-2xl border border-line bg-night-raise p-4 text-sm leading-6 text-ink-dim"><b className="text-ink">工作人员不用操作：</b>不需要输入人生编号、不需要选实体卡，也不用让整队在这里等待。若玩家手机无法完成，请到管理后台的玩家档案中处理异常。</div>
  </div>;
}

// ---------------------------------------------------------------------------
// Grace station (token)
// ---------------------------------------------------------------------------
function GraceStation({ staffKey, stations }: { staffKey: string; stations: Station[] }) {
  const [identifier, setIdentifier] = useState("");
  const [team, setTeam] = useState<StaffTeamLookup | null>(null);
  const [usage, setUsage] = useState<"hint" | "second_chance" | null>(null);
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
      const r = await rpc<StaffTeamLookup>("staff_lookup_team", { p_staff_key: staffKey, p_identifier: identifier });
      setTeam(r);
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
      await rpc("use_team_token", {
        p_staff_key: staffKey,
        p_identifier: team?.team_code ?? identifier,
        p_usage_type: usage,
        p_station_id: usage === "second_chance" ? target : null,
        p_idempotency_key: idemKey,
      });
      setDone(
        usage === "hint"
          ? `${team?.team_code} 全队已换取提示`
          : `${team?.team_code} 已获得 Second Chance：${stationName.get(target!) ?? ""}`,
      );
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const reset = () => {
    setIdentifier("");
    setTeam(null);
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

  if (team) {
    if (!team.found) {
      return (
        <div className="space-y-3">
          <ErrorBanner text="没有找到这支队伍，请核对编号" />
          <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
        </div>
      );
    }
    const personalMember = team.members?.find((member) => member.code === identifier);
    if (team.phase === "ended") {
      if (!personalMember) return <div className="space-y-3"><ErrorBanner text="结算换卡必须输入玩家本人的 4 位人生编号，不能使用队伍码" /><ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton></div>;
      if (!personalMember.token_available) return <div className="space-y-3"><ErrorBanner text={`${personalMember.name} 的 Help Token 已经使用过`} /><ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton></div>;
      return <div className="space-y-4"><div className="rounded-[24px] border border-line bg-card p-5"><div className="text-xs font-black tracking-[0.18em] text-ink-dim">结算换卡</div><div className="mt-2 text-2xl font-black">{personalMember.name}</div><p className="mt-2 text-sm leading-6 text-ink-dim">这枚 Token 未用于团队求助，可以兑换一张个人纪念卡。兑换不会影响队友。</p></div><ErrorBanner text={err} /><ActionButton onClick={async () => { setErr(null); try { await rpc("redeem_token_card", { p_staff_key: staffKey, p_player_code: identifier, p_idempotency_key: idemKey }); setDone(`${personalMember.name} 已兑换纪念卡`); } catch (error) { setErr(errorText(error)); } }}>确认兑换纪念卡</ActionButton><ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton></div>;
    }
    if (!team.all_tokens_available) {
      return (
        <div className="space-y-3">
          <ErrorBanner text={`${team.team_code} 有队员的 Token 已使用，无法再启用整队帮助`} />
          <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
        </div>
      );
    }
    const failed = team.failed_station_ids ?? [];
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-card border border-line p-4">
          <div className="flex items-baseline justify-between"><div className="tabular text-2xl font-black">{team.team_code}</div><div className="font-bold" style={{ color: "oklch(0.62 0.09 85)" }}>🪙 全队可用</div></div>
          <div className="mt-3 flex flex-wrap gap-2">{team.members?.map((member) => <span key={member.code} className="rounded-full bg-night-raise px-2.5 py-1 text-xs font-bold">{member.name}</span>)}</div>
        </div>
        <p className="text-sm leading-6 text-ink-dim">提示或 Second Chance 会影响整队，因此将同时消耗每位成员的一枚 Token。未使用的个人 Token 可在活动结束后换纪念卡。</p>
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
          确认全队使用 Token
        </ActionButton>
        <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-card p-4 text-sm leading-6 text-ink-dim">游戏中输入队伍码或任意队员编号，可使用整队帮助；活动结束后输入个人 4 位编号，可用未消耗的 Token 换纪念卡。</div>
      <input autoFocus maxLength={4} className="tabular w-full rounded-[20px] border-2 border-line bg-card px-5 py-5 text-center text-4xl font-black uppercase tracking-[0.16em] outline-none focus:border-foil" placeholder="D03" value={identifier} onChange={(event) => setIdentifier(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())} />
      <ErrorBanner text={err} />
      <ActionButton onClick={lookup} disabled={identifier.length < 3}>
        查询 Token 状态
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
