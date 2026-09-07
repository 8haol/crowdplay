import { useState } from "react";
import { rpc, errorText, newIdemKey } from "../lib/api";
import type { AwardTeamResult, StaffTeamLookup, Station } from "../lib/types";
import { ActionButton, ErrorBanner, SuccessBanner } from "../lib/ui";
import { teamLabel } from "../lib/types";
import { CodePad, Kv, MemberRow, StaffCard, Stepper, StickyBar } from "./staffUi";
import { PREVIEW_STAFF_KEY, PREVIEW_TEAM, previewAward } from "./previewData";

const STEPS = ["识别队伍", "选择结果", "完成"];

/**
 * One main station, one job: identify a team once, record one shared result.
 * Laid out as three explicit steps because the previous single-scroll form let
 * staff submit before they had read who they were scoring.
 */
export default function MainStation({
  staffKey,
  station,
  stationsTotal,
}: {
  staffKey: string;
  station: Station;
  stationsTotal: number;
}) {
  const [identifier, setIdentifier] = useState("");
  const [team, setTeam] = useState<StaffTeamLookup | null>(null);
  const [choice, setChoice] = useState<number | "failed" | null>(null);
  const [freeScore, setFreeScore] = useState("");
  const [idemKey, setIdemKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AwardTeamResult | null>(null);

  const scoreChoices = station.scoring_mode === "graded" ? [3, 6, 9] : [6];
  const usesFreeScore = station.scoring_mode === "free";
  const step = result ? 2 : team ? 1 : 0;

  const lookup = async () => {
    setErr(null);
    const clean = identifier.trim();
    if (clean.length < 3) return setErr("请输入队里任意一位队员的 3 位人生编号");
    if (staffKey === PREVIEW_STAFF_KEY) {
      setTeam(PREVIEW_TEAM);
      setChoice(null);
      setFreeScore("");
      setIdemKey("preview");
      return;
    }
    try {
      const found = await rpc<StaffTeamLookup>("staff_lookup_team", {
        p_staff_key: staffKey,
        p_identifier: clean,
      });
      setTeam(found);
      setChoice(null);
      setFreeScore("");
      setIdemKey(newIdemKey()); // one key per confirmed batch; retries reuse it
    } catch (error) {
      setErr(errorText(error));
    }
  };

  const blocker = (): string | null => {
    if (!team?.found) return "没有找到这支队伍，请核对编号";
    if (staffKey === PREVIEW_STAFF_KEY) return null;
    const attempted = team.attempted_station_ids?.includes(station.id);
    const retry = team.retry_station_ids?.includes(station.id);
    if (attempted && retry) return null; // a Second Chance re-opens the station
    if (attempted) return "这支队伍已经挑战过本站，不能重复录分";
    return null;
  };

  const submit = async () => {
    if (choice == null) return;
    setErr(null);
    if (staffKey === PREVIEW_STAFF_KEY) {
      setResult(previewAward(choice === "failed" ? 0 : choice, choice === "failed"));
      return;
    }
    try {
      const awarded = await rpc<AwardTeamResult>("award_team_score", {
        p_staff_key: staffKey,
        p_identifier: team?.team_code ?? identifier,
        p_station_id: station.id,
        p_idempotency_key: idemKey,
        p_score: choice === "failed" ? 0 : choice,
        p_failed: choice === "failed",
      });
      setResult(awarded);
    } catch (error) {
      setErr(errorText(error));
    }
  };

  const reset = () => {
    setIdentifier("");
    setTeam(null);
    setChoice(null);
    setFreeScore("");
    setResult(null);
    setErr(null);
  };

  /* ---------------------------------------------------------- step 3: done */
  if (result) {
    const triggered = result.members.filter((member) => member.life_event_triggered);
    return (
      <>
        <div className="space-y-4 pb-28">
          <Stepper steps={STEPS} current={step} />
          <SuccessBanner text="整队记分已完成" />

          <StaffCard tone={result.status === "failed" ? "danger" : "good"}>
            <div className="flex items-start justify-between gap-4">
              <Kv
                label="本次队伍"
                value={result.members.map((member) => member.name).join(" / ")}
              />
              <div
                className="rounded-xl px-4 py-3 text-right text-[15px] font-black"
                style={
                  result.status === "failed"
                    ? { background: "rgba(196,64,42,.1)", color: "#c4402a" }
                    : { background: "rgba(47,158,99,.12)", color: "#1e7a34" }
                }
              >
                {result.status === "failed" ? "本队本次未得分" : `每位队员 +${result.awarded} 分`}
              </div>
            </div>
            <div className="mt-3 divide-y divide-line border-t border-line">
              {result.members.map((member) => (
                <div key={member.code} className="flex items-center justify-between py-2.5">
                  <span className="text-[15px] font-bold">
                    {member.name} <small className="tabular text-ink-dim">{member.code}</small>
                  </span>
                  <span className="tabular font-black">总分 {member.new_score}</span>
                </div>
              ))}
            </div>
          </StaffCard>

          {triggered.length > 0 && (
            <StaffCard tone="accent">
              <div className="text-[10px] font-black tracking-[0.2em] text-[#7a5200]">LIFE EVENT</div>
              <div className="mt-1.5 text-[15px] font-black">
                {triggered.map((member) => member.name).join("、")} 触发了人生事件
              </div>
              <p className="mt-1.5 text-xs font-semibold leading-6 text-ink-dim">
                请提醒他们看一下手机 —— 屏幕上会先弹出一个整屏通知，点开才会出现选择。
                队伍不用停在这里等，可以直接去下一站。
              </p>
            </StaffCard>
          )}
        </div>

        <StickyBar>
          <ActionButton onClick={reset}>录入下一队 →</ActionButton>
        </StickyBar>
      </>
    );
  }

  /* -------------------------------------------------- step 2: pick result */
  if (team) {
    const blocked = blocker();
    const retry = team.retry_station_ids?.includes(station.id);
    return (
      <>
        <div className="space-y-4 pb-40">
          <Stepper steps={STEPS} current={step} />

          <StaffCard tone={blocked ? "danger" : "plain"}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] font-black tracking-[0.2em] text-ink-dim">已识别整队</div>
                {/* A team is named by its colour and its people, not by a code. */}
                <div className="mt-1 text-[1.6rem] font-black leading-tight">
                  {team.found ? teamLabel(team.color_group ?? null, team.identity ?? null, identifier) : "未找到"}
                </div>
              </div>
              {team.found && (
                <div className="rounded-xl bg-night-raise px-3 py-2 text-right">
                  <div className="text-[10px] font-bold text-ink-dim">本次同步记分</div>
                  <div className="mt-0.5 text-[15px] font-black">{team.members?.length ?? 0} 位队员</div>
                </div>
              )}
            </div>

            {team.found && team.members && (
              <div className="mt-3 divide-y divide-line border-t border-line">
                {team.members.map((member) => (
                  <MemberRow key={member.code} member={member} stationsTotal={stationsTotal} />
                ))}
              </div>
            )}

            {retry && !blocked && (
              <div className="mt-3 rounded-xl bg-foil/20 px-3 py-2.5 text-xs font-black text-[#7a5200]">
                ✨ 本次使用整队 Second Chance，会替换掉之前那次失败记录
              </div>
            )}
            {blocked && <div className="mt-3 text-sm font-black text-seal">{blocked}</div>}
            {team.found && !blocked && (
              <p className="mt-3 text-[11px] font-semibold leading-5 text-ink-dim">
                请核对屏幕上的名字和眼前的人对得上，再选结果。
              </p>
            )}
          </StaffCard>

          {!blocked && (
            <StaffCard>
              <div className="text-[15px] font-black">这一队本次表现如何？</div>
              <p className="mt-1 text-xs font-semibold text-ink-dim">
                {usesFreeScore
                  ? "根据现场表现输入 0–10 的整数分；0 分也是有效成绩"
                  : station.scoring_mode === "graded"
                    ? "3 分 = 勉强完成 · 6 分 = 顺利完成 · 9 分 = 表现出色"
                    : "完成即 6 分，没完成选失败"}
              </p>
              {usesFreeScore ? (
                <label className="mt-4 block rounded-[18px] border-2 border-line bg-white px-4 py-4 focus-within:border-ink">
                  <span className="block text-[11px] font-black tracking-[0.14em] text-ink-dim">本次得分</span>
                  <span className="mt-2 flex items-end gap-3">
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={1}
                      inputMode="numeric"
                      value={freeScore}
                      onChange={(event) => {
                        const next = event.target.value;
                        setFreeScore(next);
                        const parsed = Number(next);
                        setChoice(next !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : null);
                      }}
                      placeholder="0–10"
                      className="tabular min-w-0 flex-1 bg-transparent text-[3rem] font-black leading-none outline-none placeholder:text-[#c9bea9]"
                      aria-label="输入 0 到 10 分"
                    />
                    <span className="pb-1 text-lg font-black text-ink-dim">/ 10 分</span>
                  </span>
                  {freeScore !== "" && choice == null && (
                    <span className="mt-2 block text-xs font-black text-seal">请输入 0–10 之间的整数</span>
                  )}
                </label>
              ) : (
                <div className={`mt-4 grid gap-2 ${scoreChoices.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {scoreChoices.map((score) => (
                    <ScoreBtn
                      key={score}
                      active={choice === score}
                      onClick={() => setChoice(score)}
                      big={String(score)}
                      small={station.scoring_mode === "fixed" ? "完成" : score === 3 ? "勉强完成" : score === 6 ? "顺利完成" : "表现出色"}
                    />
                  ))}
                  <ScoreBtn
                    active={choice === "failed"}
                    danger
                    onClick={() => setChoice("failed")}
                    big="✗"
                    small="未通过 · 0 分"
                  />
                </div>
              )}
            </StaffCard>
          )}

          <ErrorBanner text={err} />
        </div>

        <StickyBar>
          <ActionButton onClick={submit} disabled={Boolean(blocked) || choice == null}>
            {choice == null
              ? "先选一个结果"
              : choice === "failed"
                ? "确认：本站未通过，全队 0 分"
                : `确认：每位队员 +${choice} 分`}
          </ActionButton>
          <ActionButton variant="tool-ghost" onClick={reset}>重新识别</ActionButton>
        </StickyBar>
      </>
    );
  }

  /* ---------------------------------------------------- step 1: identify */
  return (
    <>
      <div className="space-y-4 pb-28">
        <Stepper steps={STEPS} current={step} />
        <StaffCard tone="accent">
          <div className="text-[15px] font-black">只有一个编号</div>
          <p className="mt-1 text-xs font-semibold leading-6 text-ink-dim">
            问队里<b>任意一人</b>的 3 位人生编号就行 —— 系统会自动带出整队。
            没有第二个号码要记。
          </p>
        </StaffCard>

        <CodePad
          value={identifier}
          onChange={setIdentifier}
          hint="护照上写着「现场报这个 · 人生编号」的那三位数字"
        />
        <ErrorBanner text={err} />
      </div>

      <StickyBar>
        <ActionButton onClick={lookup} disabled={identifier.length < 3}>识别整队 →</ActionButton>
      </StickyBar>
    </>
  );
}

function ScoreBtn({
  active,
  onClick,
  big,
  small,
  danger,
}: {
  active: boolean;
  onClick: () => void;
  big: string;
  small: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable rounded-[18px] px-3 py-4 text-center"
      style={
        active
          ? danger
            ? { background: "#c4402a", color: "#fff", border: "2px solid #c4402a" }
            : { background: "#26211b", color: "#fff", border: "2px solid #26211b" }
          : { background: "#fff", color: "#26211b", border: "2px solid #e8dcc4" }
      }
    >
      <span className="tabular block text-[2rem] font-black leading-none">{big}</span>
      <span className="mt-1 block text-[11px] font-black opacity-75">{small}</span>
    </button>
  );
}
