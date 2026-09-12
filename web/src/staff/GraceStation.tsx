import { useMemo, useState } from "react";
import { rpc, errorText, newIdemKey } from "../lib/api";
import type { StaffTeamLookup, Station } from "../lib/types";
import { ActionButton, ErrorBanner, SuccessBanner } from "../lib/ui";
import { teamLabel } from "../lib/types";
import { CodePad, MemberRow, StaffCard, StickyBar } from "./staffUi";
import { PREVIEW_STAFF_KEY, PREVIEW_TEAM } from "./previewData";

type Mode = "team" | "card";
type Usage = "hint" | "second_chance";

/**
 * The Grace station does two different jobs, and mixing them in one flow was
 * the main source of confusion: team help spends everybody's token, while a
 * keepsake card is one person's private choice. They are now two explicit tabs.
 *
 * Keepsake redemption is no longer gated on the game being over — a player who
 * has decided not to spend their token can walk over at any point.
 */
export default function GraceStation({
  staffKey,
  stations,
  stationsTotal,
}: {
  staffKey: string;
  stations: Station[];
  stationsTotal: number;
}) {
  const [mode, setMode] = useState<Mode>("team");
  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-2xl p-1" style={{ background: "#f1e7d4" }}>
        {([["team", "🤝 整队求助"], ["card", "🎴 换纪念卡"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className="flex-1 rounded-xl px-3 py-2.5 text-sm font-black transition-colors"
            style={mode === id ? { background: "#fff", color: "#26211b" } : { color: "#7d7261" }}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "team" ? (
        <TeamHelp key="team" staffKey={staffKey} stations={stations} stationsTotal={stationsTotal} />
      ) : (
        <KeepsakeCard key="card" staffKey={staffKey} stationsTotal={stationsTotal} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- team help */

function TeamHelp({
  staffKey,
  stations,
  stationsTotal,
}: {
  staffKey: string;
  stations: Station[];
  stationsTotal: number;
}) {
  const [identifier, setIdentifier] = useState("");
  const [team, setTeam] = useState<StaffTeamLookup | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [idemKey, setIdemKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const stationName = useMemo(() => new Map(stations.map((s) => [s.id, s.name_zh])), [stations]);

  const lookup = async () => {
    setErr(null);
    if (staffKey === PREVIEW_STAFF_KEY) {
      setTeam(PREVIEW_TEAM);
      setUsage(null);
      setTarget(null);
      setIdemKey("preview");
      return;
    }
    try {
      const found = await rpc<StaffTeamLookup>("staff_lookup_team", {
        p_staff_key: staffKey,
        p_identifier: identifier,
      });
      setTeam(found);
      setUsage(null);
      setTarget(null);
      setIdemKey(newIdemKey());
    } catch (error) {
      setErr(errorText(error));
    }
  };

  const submit = async () => {
    if (!usage) return;
    setErr(null);
    if (staffKey === PREVIEW_STAFF_KEY) {
      setDone(usage === "hint" ? "已登记并领取实体恩典卡（演示）" : "全队已获得重新挑战（演示）");
      return;
    }
    try {
      await rpc("use_team_token", {
        p_staff_key: staffKey,
        p_identifier: team?.team_code ?? identifier,
        p_usage_type: usage,
        p_station_id: usage === "second_chance" ? target : null,
        p_idempotency_key: idemKey,
      });
      const who = (team?.members ?? []).map((member) => member.name).join(" / ");
      setDone(
        usage === "hint"
          ? `${who} 已登记并领取实体恩典卡`
          : `${who} 已获得 Second Chance：${stationName.get(target!) ?? ""}`,
      );
    } catch (error) {
      setErr(errorText(error));
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
      <>
        <div className="space-y-4 pb-28">
          <SuccessBanner text={done} />
          <StaffCard tone="accent">
            {usage === "hint" ? (
              <p className="text-xs font-semibold leading-6 text-ink-dim">
                请现在交给队伍<b className="text-ink">一张实体恩典卡</b>。他们在挑战任意站点前向该站同工出示，
                由该站同工按本站玩法给出提示、降低难度或其他合适帮助。
              </p>
            ) : (
              <p className="text-xs font-semibold leading-6 text-ink-dim">
                重新挑战已经写进队伍和每位队员的护照，手机上该站会变成虚线的「再挑战」印章。
                请让他们回到该站；新成绩录入后会<b className="text-ink">替换旧成绩</b>，不会重复加分。
              </p>
            )}
          </StaffCard>
        </div>
        <StickyBar>
          <ActionButton onClick={reset}>服务下一位 →</ActionButton>
        </StickyBar>
      </>
    );
  }

  if (team) {
    if (!team.found) {
      return (
        <>
          <div className="space-y-3 pb-28">
            <ErrorBanner text="没有找到这支队伍，请核对编号" />
          </div>
          <StickyBar>
            <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
          </StickyBar>
        </>
      );
    }

    if (!team.all_tokens_available) {
      const spent = team.members?.filter((member) => !member.token_available) ?? [];
      return (
        <>
          <div className="space-y-3 pb-28">
            <ErrorBanner text="这支队伍无法再启用整队帮助" />
            <StaffCard>
              <p className="text-xs font-semibold leading-6 text-ink-dim">
                整队帮助需要每位成员都还有 Token。
                {spent.length > 0 && (
                  <>
                    <br />
                    已经用掉的：<b className="text-ink">{spent.map((member) => member.name).join("、")}</b>
                  </>
                )}
              </p>
            </StaffCard>
          </div>
          <StickyBar>
            <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
          </StickyBar>
        </>
      );
    }

    const attempted = team.attempted_station_ids ?? [];
    const resultByStation = new Map((team.station_results ?? []).map((result) => [result.station_id, result]));
    return (
      <>
        <div className="space-y-4 pb-44">
          <StaffCard>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 text-[1.4rem] font-black leading-tight">
                {teamLabel(team.color_group ?? null, team.identity ?? null, identifier)}
              </div>
              <div className="shrink-0 text-sm font-black text-[#7a5200]">🪙 Token 可用</div>
            </div>
            <div className="mt-3 divide-y divide-line border-t border-line">
              {team.members?.map((member) => (
                <MemberRow key={member.code} member={member} stationsTotal={stationsTotal} />
              ))}
            </div>
          </StaffCard>

          <StaffCard tone="accent">
            <p className="text-xs font-semibold leading-6 text-ink-dim">
              实体恩典卡和重新挑战都影响整队，因此会<b className="text-ink">同时消耗每位成员的一枚 Token</b>。
              Solo 消耗 1 枚，Duo 2 枚，Trio 3 枚。不同人数的队伍都只有一次完整的团队求助机会。
            </p>
          </StaffCard>

          <div className="space-y-2">
            <UsageBtn
              active={usage === "hint"}
              onClick={() => setUsage("hint")}
              title="💡 领取实体恩典卡"
              desc="挑战前交给目标站同工，由该站提示或降低难度"
            />
            <UsageBtn
              active={usage === "second_chance"}
              onClick={() => { setUsage("second_chance"); setTarget(null); }}
              title="🔄 重新挑战"
              desc={attempted.length > 0 ? "已挑战过的任意站都可以重来，包括已通过但分数不满意" : "先完成至少一个站点，再回来选择重新挑战"}
              disabled={attempted.length === 0}
            />
          </div>

          {usage === "second_chance" && attempted.length > 0 && (
            <StaffCard>
              <div className="text-[15px] font-black">重新挑战哪一站？</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {attempted.map((id) => {
                  const previous = resultByStation.get(id);
                  return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTarget(id)}
                    className="pressable rounded-xl py-3.5 text-sm font-black"
                    style={
                      target === id
                        ? { background: "#26211b", color: "#fff", border: "2px solid #26211b" }
                        : { background: "#fff", border: "2px solid #e8dcc4" }
                    }
                  >
                    <span className="block">{stationName.get(id) ?? `站点 ${id}`}</span>
                    {previous && (
                      <span className="mt-1 block text-[10px] opacity-70">上次：{previous.status === "failed" ? "未通过 · 0 分" : `${previous.score} 分`}</span>
                    )}
                  </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] font-semibold leading-5 text-ink-dim">重挑后以新成绩为准，旧成绩会被替换。</p>
            </StaffCard>
          )}

          <ErrorBanner text={err} />
        </div>

        <StickyBar>
          <ActionButton onClick={submit} disabled={!usage || (usage === "second_chance" && !target)}>
            {usage === "hint"
              ? "确认：登记并发放恩典卡"
              : usage === "second_chance" && target
                ? `确认：重新挑战${stationName.get(target) ?? ""}`
                : "先选一种帮助"}
          </ActionButton>
          <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
        </StickyBar>
      </>
    );
  }

  return (
    <>
      <div className="space-y-4 pb-28">
        <StaffCard tone="accent">
          <div className="text-[15px] font-black">整队帮助</div>
          <p className="mt-1 text-xs font-semibold leading-6 text-ink-dim">
            输入队里任意一人的 3 位人生编号。实体恩典卡 / 重新挑战会消耗全队每人一枚 Token。
          </p>
        </StaffCard>
        <CodePad
          value={identifier}
          onChange={(next) => setIdentifier(next.replace(/\D/g, "").slice(0, 3))}
          hint="任意一位队员的编号都可以带出整队"
        />
        <ErrorBanner text={err} />
      </div>
      <StickyBar>
        <ActionButton onClick={lookup} disabled={identifier.length < 3}>查询 Token 状态 →</ActionButton>
      </StickyBar>
    </>
  );
}

/* --------------------------------------------------------- keepsake card */

function KeepsakeCard({ staffKey, stationsTotal }: { staffKey: string; stationsTotal: number }) {
  const [code, setCode] = useState("");
  const [team, setTeam] = useState<StaffTeamLookup | null>(null);
  const [idemKey, setIdemKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const member = team?.members?.find((entry) => entry.code === code) ?? null;

  const lookup = async () => {
    setErr(null);
    if (code.length < 3 || /\D/.test(code)) {
      return setErr("换纪念卡必须输入玩家本人的 3 位人生编号");
    }
    if (staffKey === PREVIEW_STAFF_KEY) {
      setTeam({ ...PREVIEW_TEAM, members: (PREVIEW_TEAM.members ?? []).map((entry, index) => index === 0 ? { ...entry, code } : entry) });
      setIdemKey("preview");
      return;
    }
    try {
      const found = await rpc<StaffTeamLookup>("staff_lookup_team", {
        p_staff_key: staffKey,
        p_identifier: code,
      });
      setTeam(found);
      setIdemKey(newIdemKey());
    } catch (error) {
      setErr(errorText(error));
    }
  };

  const reset = () => {
    setCode("");
    setTeam(null);
    setDone(null);
    setErr(null);
  };

  if (done) {
    return (
      <>
        <div className="space-y-4 pb-28">
          <SuccessBanner text={done} />
          <StaffCard tone="good">
            <p className="text-xs font-semibold leading-6 text-ink-dim">
              把纪念卡交给他，并说一句：<b className="text-ink">You don't have to do life alone.</b>
            </p>
          </StaffCard>
        </div>
        <StickyBar>
          <ActionButton onClick={reset}>服务下一位 →</ActionButton>
        </StickyBar>
      </>
    );
  }

  if (team) {
    if (!team.found || !member) {
      return (
        <>
          <div className="space-y-3 pb-28">
            <ErrorBanner text={`找不到人生编号 ${code}，请让玩家打开护照核对`} />
          </div>
          <StickyBar>
            <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
          </StickyBar>
        </>
      );
    }
    if (!member.token_available) {
      return (
        <>
          <div className="space-y-3 pb-28">
            <ErrorBanner text={`${member.name} 的 Help Token 已经使用过了`} />
            <StaffCard>
              <p className="text-xs font-semibold leading-6 text-ink-dim">
                Token 只有一枚：用在队伍求助上，就换不了纪念卡；反过来也一样。
              </p>
            </StaffCard>
          </div>
          <StickyBar>
            <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
          </StickyBar>
        </>
      );
    }
    return (
      <>
        <div className="space-y-4 pb-32">
          <StaffCard>
            <div className="text-[10px] font-black tracking-[0.2em] text-ink-dim">换纪念卡</div>
            <div className="mt-3 divide-y divide-line">
              <MemberRow member={member} stationsTotal={stationsTotal} />
            </div>
            <p className="mt-3 text-xs font-semibold leading-6 text-ink-dim">
              这枚 Token 没有用在团队求助上，可以换一张个人纪念卡。兑换只影响他自己，不影响队友，
              而且随时都能换 —— 不必等活动结束。
            </p>
          </StaffCard>
          <ErrorBanner text={err} />
        </div>
        <StickyBar>
          <ActionButton
            onClick={async () => {
              setErr(null);
              if (staffKey === PREVIEW_STAFF_KEY) {
                setDone(`${member.name} 已兑换纪念卡（演示）`);
                return;
              }
              try {
                await rpc("redeem_token_card", {
                  p_staff_key: staffKey,
                  p_player_code: code,
                  p_idempotency_key: idemKey,
                });
                setDone(`${member.name} 已兑换纪念卡`);
              } catch (error) {
                setErr(errorText(error));
              }
            }}
          >
            确认给 {member.name} 一张纪念卡
          </ActionButton>
          <ActionButton variant="tool-ghost" onClick={reset}>返回</ActionButton>
        </StickyBar>
      </>
    );
  }

  return (
    <>
      <div className="space-y-4 pb-28">
        <StaffCard tone="accent">
          <div className="text-[15px] font-black">换纪念卡 · 随时可换</div>
          <p className="mt-1 text-xs font-semibold leading-6 text-ink-dim">
            输入玩家<b className="text-ink">本人</b>的 3 位人生编号。
            只要这枚 Token 还没用掉，就可以立刻换一张纪念卡，不用等活动结束。
          </p>
        </StaffCard>
        <CodePad
          value={code}
          onChange={(next) => setCode(next.replace(/\D/g, "").slice(0, 3))}
          hint="必须是本人的编号 —— 纪念卡是个人的，队友不受影响"
        />
        <ErrorBanner text={err} />
      </div>
      <StickyBar>
        <ActionButton onClick={lookup} disabled={code.length !== 4}>查询这本护照 →</ActionButton>
      </StickyBar>
    </>
  );
}

function UsageBtn({
  active,
  onClick,
  title,
  desc,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="pressable w-full rounded-[18px] p-4 text-left disabled:opacity-40"
      style={
        active
          ? { background: "#26211b", color: "#fff", border: "2px solid #26211b" }
          : { background: "#fff", color: "#26211b", border: "2px solid #e8dcc4" }
      }
    >
      <div className="text-[15px] font-black">{title}</div>
      <div className="mt-0.5 text-xs font-semibold" style={{ color: active ? "rgba(255,255,255,.7)" : "#7d7261" }}>
        {desc}
      </div>
    </button>
  );
}
