import { useMemo, useState } from "react";
import { RpcError, rpc, errorText } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type {
  AdminPlayer,
  EventStation,
  GameSession,
  PlayerAttemptRow,
  PlayerState,
  ScoringMode,
  Station,
  StationHiddenFields,
  StationType,
} from "../lib/types";
import { ActionButton, ErrorBanner } from "../lib/ui";
import { Btn, DialogHead, Drawer, Modal, ThemeRadio, Toggle } from "./adminUi";
import { T, inputClass, inputStyle } from "./adminTokens";
import { TYPE_ZH, themeLabel, type ThemeId } from "./adminUtils";

export function NewGameModal(props: {
  adminKey: string;
  /** Absent for an organisation that has never run an event yet. */
  current?: GameSession;
  playerCount: number;
  onClose: () => void;
  onDone: (message: string, eventId?: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [theme, setTheme] = useState<ThemeId>("passport");
  const [err, setErr] = useState<string | null>(null);
  const current = props.current;
  const livePlaying = current?.phase === "playing";

  return (
    <Modal onClose={props.onClose}>
      <DialogHead eyebrow="创建场次" title="开始一场新的活动" onClose={props.onClose} />
      <p className="mt-4 text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
        新场次拿到自己的入场二维码、工作人员码和大屏链接。
        {current && (
          <>「{current.title}」原样留在活动列表里，玩家、成绩和记录一个都不会动。</>
        )}
      </p>
      <label className="mt-6 block">
        <span className="text-sm font-black">场次名称</span>
        <input
          autoFocus
          className={inputClass}
          style={inputStyle}
          placeholder="例如：2026 秋季新生迎新会"
          maxLength={60}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="mt-5">
        <span className="text-sm font-black">主题</span>
        <p className="mb-2 mt-0.5 text-xs font-semibold" style={{ color: T.inkFaint }}>
          决定玩家手机、大屏和义工页的样子；建好之后在「本场设置」里随时能换。
        </p>
        <ThemeRadio value={theme} onChange={setTheme} />
      </div>
      {current && livePlaying && (
        <div
          className="mt-4 rounded-xl p-4 text-sm font-bold leading-6"
          style={{ background: T.dangerSoft, border: "1px solid var(--color-admin-danger-line)", color: T.danger }}
        >
          「{current.title}」还在进行中。同一机构同时只能有一场在跑 —— 请先在现场总控结束它，再开新场。
        </div>
      )}
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
        <Btn
          variant="primary"
          disabled={!title.trim() || livePlaying}
          onClick={async () => {
            setErr(null);
            try {
              const created = await rpc<{ event_id: string }>("admin_create_event", {
                p_admin_key: props.adminKey,
                p_title: title.trim(),
                p_theme: theme,
              });
              props.onDone(`已创建「${title.trim()}」· ${themeLabel(theme)}`, created.event_id);
            } catch (error) { setErr(errorText(error)); }
          }}
        >
          创建场次
        </Btn>
      </div>
    </Modal>
  );
}

export function PlayerDrawer(props: {
  adminKey: string;
  eventId: string;
  player: AdminPlayer;
  onClose: () => void;
  onDone: (message: string) => void;
  /** Something changed but the drawer should stay open (per-station edits). */
  onChanged?: (message: string) => void;
}) {
  const player = props.player;
  /* admin_set_attempt returns the player as it now stands; show that total at
     once instead of waiting for the shell's next poll to catch up. */
  const [liveScore, setLiveScore] = useState<number | null>(null);
  const total = liveScore ?? player.score;
  const [score, setScore] = useState("");
  const [reason, setReason] = useState("");
  const [unlock, setUnlock] = useState(false);
  const [clearEffect, setClearEffect] = useState(false);
  const [restoreToken, setRestoreToken] = useState(false);
  const [restore, setRestore] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = score !== "" || unlock || clearEffect || restoreToken || restore;

  const facts: Array<[string, string | number]> = [
    ["联系方式", player.contact || "未填写"],
    ["同行", player.teammates.length > 0 ? player.teammates.join(" / ") : "独自同行"],
    ["身份", player.identity ?? "待分配"],
    ["个人总分", total],
    ["站点", `${player.stations_done}/${player.stations_total}`],
    ["人生事件", `${player.life_events_done}/${player.life_events_total}`],
    ["下一段", player.next_event_stage ? `第 ${player.next_event_stage} 段（第 ${player.next_event_after_station} 站后）` : "已全部经历"],
  ];

  return (
    <Drawer onClose={props.onClose}>
      <div
        className="sticky top-0 z-10 p-6 backdrop-blur"
        style={{ background: "rgb(from var(--color-admin-table-footer) r g b / .95)", borderBottom: `1px solid ${T.line}` }}
      >
        <DialogHead eyebrow={`玩家档案 · ${player.code}`} title={player.name} onClose={props.onClose} />
      </div>

      <div className="space-y-7 p-6">
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl sm:grid-cols-3" style={{ background: T.line, border: `1px solid ${T.line}` }}>
          {facts.map(([label, value]) => (
            <div key={label} className="bg-white p-4">
              <div className="text-xs font-bold" style={{ color: T.inkSoft }}>{label}</div>
              <div className="tabular mt-1 text-lg font-black">{value}</div>
            </div>
          ))}
        </section>

        <section>
          <h3 className="text-lg font-black">状态处理</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <StateToggle label="取消手机待选事件" active={unlock} onChange={setUnlock} disabled={!player.locked_for_life_event} />
            <StateToggle label="清除旧版下一站限制" active={clearEffect} onChange={setClearEffect} disabled={!player.status_effect} />
            <StateToggle label="归还 Grace Token" active={restoreToken} onChange={setRestoreToken} disabled={player.token_available} />
            <StateToggle label="恢复已删除玩家" active={restore} onChange={setRestore} disabled={!player.is_removed} />
          </div>
        </section>

        <section>
          <h3 className="text-lg font-black">手动修正个人护照</h3>

          <StationAdjust
            adminKey={props.adminKey}
            eventId={props.eventId}
            player={player}
            reason={reason}
            onChanged={(message, updated) => {
              setLiveScore(updated.score);
              props.onChanged?.(message);
            }}
          />

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-black">个人总分</span>
              <input
                inputMode="numeric"
                className={`${inputClass} tabular`}
                style={inputStyle}
                placeholder={String(total)}
                value={score}
                onChange={(event) => setScore(event.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className="block">
              <span className="text-sm font-black">修正原因</span>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="会写入审计记录"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
          <p className="mt-2 text-xs font-semibold" style={{ color: T.inkFaint }}>
            修正只影响这名玩家；共同挑战仍会按相同分值给每位队员加分。人生事件的触发点看的是完成站点数，
            改分数不会额外触发或取消事件。
          </p>
          <div className="mt-4"><ErrorBanner text={err} /></div>
          <div className="mt-4 max-w-xs">
            <ActionButton
              disabled={!dirty || !reason.trim()}
              onClick={async () => {
                setErr(null);
                try {
                  await rpc("admin_adjust", {
                    p_admin_key: props.adminKey,
                    p_event_id: props.eventId,
                    p_player_code: player.code,
                    p_new_score: score === "" ? null : Number(score),
                    p_unlock: unlock,
                    p_clear_effect: clearEffect,
                    p_restore_token: restoreToken,
                    p_restore: restore,
                    p_reason: reason.trim(),
                  });
                  props.onDone(`已更新 ${player.name} 的玩家数据`);
                } catch (error) { setErr(errorText(error)); }
              }}
            >
              保存修改
            </ActionButton>
          </div>
        </section>

        {!player.is_removed && (
          <section className="pt-6" style={{ borderTop: `1px solid ${T.line}` }}>
            <h3 className="text-lg font-black" style={{ color: "var(--color-outcome-bad-ink)" }}>移除玩家</h3>
            <p className="mt-1 text-sm font-semibold" style={{ color: T.inkSoft }}>
              用于处理测试或垃圾登记。数据会保留，可随时恢复。
            </p>
            {!confirmRemove ? (
              <Btn variant="danger" className="mt-4" onClick={() => setConfirmRemove(true)}>移除这名玩家</Btn>
            ) : (
              <div className="mt-4 flex gap-2">
                <Btn
                  variant="dangerSolid"
                  onClick={async () => {
                    try {
                      await rpc("admin_remove_player", { p_admin_key: props.adminKey, p_event_id: props.eventId, p_player_code: player.code });
                      props.onDone(`已移除 ${player.name}`);
                    } catch (error) { setErr(errorText(error)); }
                  }}
                >
                  确认移除
                </Btn>
                <Btn variant="quiet" onClick={() => setConfirmRemove(false)}>取消</Btn>
              </div>
            )}
          </section>
        )}
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------ per-station */

/*
 * 按站改分。总分那个输入框改的是一个数字，印章和奖项统计却是从 attempts 算
 * 的——两边一改就对不上。这里改的是某一站的那条记录，总分跟着差值走。
 *
 * 「未通过」在这个游戏里永远是 0 分（和 award_team_score 一致），所以切到未通
 * 过就收起分数选择器、送 0。
 */
const SCORE_LABEL: Record<Exclude<ScoringMode, null>, string> = {
  graded: "3 / 6 / 9",
  free: "0–10",
  fixed: "固定 6 分",
};

function attemptErrorText(error: unknown): string {
  if (error instanceof RpcError) {
    if (error.code === "BAD_SCORE") return "这一站不允许这个分数";
    if (error.code === "BAD_STATION") return "不是本场的主站";
  }
  return errorText(error);
}

function StationAdjust({
  adminKey,
  eventId,
  player,
  reason,
  onChanged,
}: {
  adminKey: string;
  eventId: string;
  player: AdminPlayer;
  /** Shared with the total-score form: whatever is typed there is audited here too. */
  reason: string;
  onChanged: (message: string, updated: PlayerState) => void;
}) {
  const [wholeTeam, setWholeTeam] = useState(false);
  const hasTeam = player.teammates.length > 0;

  /* 15 s 一轮：义工那边可能正在给这名玩家盖章，行里的「当前」不该是打开那一刻的旧账。 */
  const pollFn = useMemo(
    () => () => rpc<PlayerAttemptRow[]>("admin_player_attempts", {
      p_admin_key: adminKey,
      p_event_id: eventId,
      p_player_code: player.code,
    }),
    [adminKey, eventId, player.code],
  );
  const poll = usePoll<PlayerAttemptRow[]>(pollFn, 15_000);
  const rows = poll.data;
  const loadErr = rows === null && poll.error ? errorText(poll.error) : null;

  return (
    <div className="mt-3 rounded-2xl" style={{ background: T.panelAlt, border: `1px solid ${T.lineSoft}` }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
        <div>
          <div className="text-sm font-black">按站改分</div>
          <div className="mt-0.5 text-[11px] font-semibold" style={{ color: T.inkFaint }}>
            改某一站的成绩，总分按差值跟着走，印章和奖项统计不会对不上。
          </div>
        </div>
        {hasTeam && (
          <label className="flex items-center gap-2 text-xs font-black">
            <input
              type="checkbox"
              className="h-4 w-4 accent-ink"
              checked={wholeTeam}
              onChange={(event) => setWholeTeam(event.target.checked)}
            />
            整队一起改
            <span className="font-semibold" style={{ color: T.inkFaint }}>（{player.teammates.join(" / ")}）</span>
          </label>
        )}
      </div>

      {loadErr ? (
        <div className="px-4 py-3">
          <ErrorBanner text={loadErr} />
          <div className="mt-2"><Btn onClick={poll.refresh}>重试</Btn></div>
        </div>
      ) : rows === null ? (
        <div className="dots px-4 py-4 text-xs font-black" style={{ color: T.inkSoft }}>
          正在读取各站成绩<span>.</span><span>.</span><span>.</span>
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-4 text-xs font-bold" style={{ color: T.inkFaint }}>这一场没有启用中的主站。</p>
      ) : (
        <ul className="divide-y px-4" style={{ borderColor: T.lineSoft }}>
          {rows.map((row) => (
            <AttemptRow
              key={row.station_id}
              row={row}
              onSubmit={async (score, status) => {
                const updated = await rpc<PlayerState>("admin_set_attempt", {
                  p_admin_key: adminKey,
                  p_event_id: eventId,
                  p_player_code: player.code,
                  p_station_id: row.station_id,
                  p_score: score,
                  p_status: status,
                  p_whole_team: hasTeam && wholeTeam,
                  p_reason: reason.trim() || null,
                });
                poll.refresh();
                onChanged(
                  `已把${hasTeam && wholeTeam ? "整队" : ` ${player.name} `}在「${row.name_zh}」的成绩改为${
                    status === "passed" ? ` ${score} 分` : "未通过"
                  }`,
                  updated,
                );
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AttemptRow({
  row,
  onSubmit,
}: {
  row: PlayerAttemptRow;
  onSubmit: (score: number, status: "passed" | "failed") => Promise<void>;
}) {
  const mode = row.scoring_mode ?? "graded";
  const startScore =
    mode === "fixed" ? 6
    : mode === "graded" ? (row.score !== null && [3, 6, 9].includes(row.score) ? row.score : 6)
    : Math.min(10, Math.max(0, row.score ?? 0));
  const [status, setStatus] = useState<"passed" | "failed">(row.status ?? "passed");
  const [score, setScore] = useState<number>(startScore);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sending = status === "failed" ? 0 : score;
  const dirty = status !== row.status || (status === "passed" && sending !== row.score);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[8rem] flex-1">
          <div className="font-black">{row.name_zh}</div>
          <div className="tabular text-[11px] font-bold" style={{ color: T.inkFaint }}>
            {row.status === null
              ? "还没打过"
              : row.status === "passed" ? `通过 · ${row.score} 分` : "未通过 · 0 分"}
            {" · "}{SCORE_LABEL[mode]}
          </div>
        </div>

        <div className="flex rounded-lg p-0.5" style={{ background: "var(--color-admin-neutral)" }} role="group" aria-label={`${row.name_zh} 结果`}>
          {(["passed", "failed"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={status === option}
              disabled={busy}
              onClick={() => setStatus(option)}
              className="rounded-md px-2.5 py-1.5 text-xs font-black"
              style={
                status === option
                  ? { background: "var(--color-card)", color: option === "passed" ? T.good : T.danger }
                  : { background: "transparent", color: T.inkSoft }
              }
            >
              {option === "passed" ? "通过" : "未通过"}
            </button>
          ))}
        </div>

        {status === "passed" && (
          mode === "graded" ? (
            <div className="flex gap-1" role="group" aria-label={`${row.name_zh} 分数`}>
              {[3, 6, 9].map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={score === option}
                  disabled={busy}
                  onClick={() => setScore(option)}
                  className="tabular h-9 w-9 rounded-lg text-sm font-black"
                  style={
                    score === option
                      ? { background: T.ink, color: "var(--color-card)", border: `1px solid ${T.ink}` }
                      : { background: "var(--color-card)", color: T.ink, border: "1px solid var(--color-admin-panel-line)" }
                  }
                >
                  {option}
                </button>
              ))}
            </div>
          ) : mode === "free" ? (
            <select
              className={`${inputClass} tabular !mt-0 !w-auto shrink-0`}
              style={inputStyle}
              value={score}
              disabled={busy}
              aria-label={`${row.name_zh} 分数`}
              onChange={(event) => setScore(Number(event.target.value))}
            >
              {Array.from({ length: 11 }, (_, i) => i).map((option) => (
                <option key={option} value={option}>{option} 分</option>
              ))}
            </select>
          ) : (
            <span className="tabular shrink-0 text-sm font-black" style={{ color: T.inkSoft }}>6 分</span>
          )
        )}

        <Btn
          variant="primary"
          disabled={!dirty || busy}
          onClick={async () => {
            setErr(null);
            setBusy(true);
            try {
              await onSubmit(sending, status);
            } catch (error) {
              setErr(attemptErrorText(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "改…" : "改"}
        </Btn>
      </div>
      {err && <div className="mt-2"><ErrorBanner text={err} /></div>}
    </li>
  );
}

function StateToggle({
  label,
  active,
  onChange,
  disabled,
}: {
  label: string;
  active: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label
      className="flex items-center gap-3 rounded-xl p-3 text-sm font-bold"
      style={
        disabled
          ? { border: "1px solid var(--color-admin-skeleton)", background: "var(--color-admin-disabled)", color: "var(--color-admin-disabled-ink)" }
          : active
            ? { border: `1px solid ${T.accent}`, background: "var(--color-admin-accent-soft)" }
            : { border: "1px solid var(--color-admin-line-strong)", background: "var(--color-card)" }
      }
    >
      <input
        type="checkbox"
        checked={active}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-ink"
      />
      {label}
    </label>
  );
}

/*
 * Library row editor. A station is now a template owned by the organisation,
 * so this writes to the library (`admin_library_create` / `admin_library_update`)
 * and never to a running event: events carry their own copy of the name and
 * scoring mode, and renaming a template must not rewrite past scorecards.
 * Builtin rows are read-only — the library view offers "copy" instead.
 *
 * 隐藏摊位（神秘嘉宾）：后端强制 type = main、scoring_mode = fixed，所以开关一开
 * 这两项就锁死，只剩「集齐印章后给玩家的提示」可填。
 */
export function LibraryStationModal(props: {
  adminKey: string;
  /** null = create a new station. */
  station: (Station & StationHiddenFields) | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const editing = props.station;
  const [name, setName] = useState(editing?.name_zh ?? "");
  const [type, setType] = useState<StationType>(editing?.type ?? "main");
  const [mode, setMode] = useState<Exclude<ScoringMode, null>>(editing?.scoring_mode ?? "graded");
  const [hidden, setHidden] = useState(editing?.hidden ?? false);
  const [hint, setHint] = useState(editing?.hint ?? "");
  const [err, setErr] = useState<string | null>(null);
  const effectiveType: StationType = hidden ? "main" : (editing?.type ?? type);
  const effectiveMode: ScoringMode = effectiveType !== "main" ? null : hidden ? "fixed" : mode;
  /* A second tap while the first request is still out would create a second
     station with the same name — the create RPC carries no idempotency key. */
  const [busy, setBusy] = useState(false);

  return (
    <Modal onClose={props.onClose} width="max-w-md">
      <DialogHead
        eyebrow="站点库"
        title={editing ? `编辑 ${editing.name_zh}` : "新增站点"}
        onClose={props.onClose}
      />
      <p className="mt-4 text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
        {editing
          ? "改的是库里的模板。已经办过的活动保留当时的站点名称与计分方式，不受影响。"
          : "只填名字就行，内部标识由系统生成。建好之后在「本场站点」里挑进某一场才会真正启用。"}
      </p>
      <label className="mt-6 block">
        <span className="text-sm font-black">站点名称</span>
        <input
          autoFocus
          className={inputClass}
          style={inputStyle}
          value={name}
          maxLength={30}
          placeholder="例如：默契挑战"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {editing ? (
        <p className="mt-3 text-xs font-semibold" style={{ color: T.inkFaint }}>
          类型：{TYPE_ZH[editing.type]}（建好之后不能改，需要别的类型请新建一个）
        </p>
      ) : (
        <label className="mt-4 block">
          <span className="text-sm font-black">类型</span>
          <select
            className={inputClass}
            style={inputStyle}
            value={effectiveType}
            disabled={hidden}
            onChange={(event) => setType(event.target.value as StationType)}
          >
            <option value="main">主线挑战（工作人员整队记分）</option>
            <option value="grace">恩典站（Token 求助与纪念卡）</option>
            <option value="life_event">人生盲盒（玩家手机自动完成）</option>
          </select>
        </label>
      )}
      {effectiveType === "main" && (
        <label className="mt-4 block">
          <span className="text-sm font-black">计分方式</span>
          {hidden ? (
            <div className={`${inputClass} cursor-not-allowed`} style={{ ...inputStyle, background: "var(--color-admin-disabled)", color: "var(--color-admin-disabled-ink)" }}>
              固定计分（6 分）· 隐藏摊位不可改
            </div>
          ) : (
            <select
              className={inputClass}
              style={inputStyle}
              value={mode}
              onChange={(event) => setMode(event.target.value as Exclude<ScoringMode, null>)}
            >
              <option value="graded">分级计分（3 / 6 / 9）</option>
              <option value="free">自由计分（0–10 整数）</option>
              <option value="fixed">固定计分（6 分）</option>
            </select>
          )}
        </label>
      )}
      {(effectiveType === "main" || hidden) && (
        <div className="mt-4">
          <Toggle
            checked={hidden}
            label="隐藏摊位（神秘嘉宾）"
            note="玩家护照和大屏都不列出这一站，也不计入「共几站」；集齐可见印章后玩家才收到提示去找。固定 +6 分。"
            onChange={() => setHidden((value) => !value)}
          />
          {hidden && (
            <label className="mt-3 block">
              <span className="text-sm font-black">集齐印章后给玩家的提示</span>
              <textarea
                className={`${inputClass} min-h-[5.5rem] resize-y`}
                style={inputStyle}
                value={hint}
                maxLength={200}
                placeholder="例如：场地里有一位系着红丝带的人，去找他。"
                onChange={(event) => setHint(event.target.value)}
              />
              <span className="mt-1.5 block text-[11px] font-semibold" style={{ color: T.inkFaint }}>
                写清楚去哪儿、找谁。留空的话玩家只会看到「月圆时刻」，不知道去哪找神秘嘉宾。
              </span>
            </label>
          )}
        </div>
      )}
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
        <Btn
          variant="primary"
          disabled={!name.trim() || busy}
          onClick={async () => {
            setErr(null);
            setBusy(true);
            const clean = name.trim();
            try {
              if (editing) {
                await rpc("admin_library_update", {
                  p_admin_key: props.adminKey,
                  p_station_id: editing.id,
                  p_name_zh: clean,
                  p_scoring_mode: effectiveMode,
                  p_hidden: hidden,
                  p_hint: hidden ? hint.trim() || null : null,
                });
                props.onDone(`站点「${clean}」已更新`);
              } else {
                await rpc("admin_library_create", {
                  p_admin_key: props.adminKey,
                  p_name_zh: clean,
                  p_type: effectiveType,
                  p_scoring_mode: effectiveMode,
                  p_hidden: hidden,
                  p_hint: hidden ? hint.trim() || null : null,
                });
                props.onDone(`已新增站点「${clean}」`);
              }
            } catch (error) {
              setErr(errorText(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "保存中…" : editing ? "保存" : "新增"}
        </Btn>
      </div>
    </Modal>
  );
}

/*
 * Withdrawing a station from a running event. Worth a confirmation because it
 * is the one station action that happens mid-event, usually because a
 * volunteer did not show up — and because the operator needs to be told, in
 * the moment, that the scores already recorded there are safe.
 */
export function DisableStationModal(props: {
  adminKey: string;
  eventId: string;
  station: EventStation;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal onClose={props.onClose} width="max-w-md">
      <DialogHead eyebrow="本场站点" title={`撤下「${props.station.name_zh}」`} onClose={props.onClose} />
      <ul className="mt-5 space-y-2 text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
        <li>· <span className="font-black" style={{ color: T.ink }}>已经记的分会保留</span>，玩家的总分不变。</li>
        <li>· 工作人员端不再显示这个站，也不能再在这里记分。</li>
        <li>· 玩家护照和大屏的「共几站」会少一站，进度按剩下的站重新算。</li>
        <li>· 本场之内撤了就不能再加回来；下一场不受影响。</li>
      </ul>
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
        <Btn
          variant="dangerSolid"
          disabled={busy}
          onClick={async () => {
            setErr(null);
            setBusy(true);
            try {
              await rpc("admin_disable_event_station", {
                p_admin_key: props.adminKey,
                p_event_id: props.eventId,
                p_station_id: props.station.station_id,
              });
              props.onDone(`已撤下「${props.station.name_zh}」，已记的分保留`);
            } catch (error) {
              setErr(errorText(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "撤站中…" : "确认撤站"}
        </Btn>
      </div>
    </Modal>
  );
}

/*
 * 删除一场活动。分级确认，规则和后端 admin_delete_event 里的那一条一模一样：
 * 没开始过且没人报名的，删了不损失任何真实记录，免手敲；其余必须手敲活动名称。
 *
 * 前端这一份只是体验，真正挡住误删的是后端那道——这个弹窗拦不住直接调 RPC。
 */
export function DeleteEventDialog(props: {
  adminKey: string;
  event: { event_id: string; title: string; phase: string; player_count: number };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trivial = props.event.phase === "waiting" && props.event.player_count === 0;
  const ready = trivial || confirm === props.event.title;

  return (
    <Modal onClose={props.onClose}>
      <DialogHead eyebrow="删除活动" title={`删除「${props.event.title}」`} onClose={props.onClose} />
      <div
        className="mt-4 rounded-xl p-4 text-sm font-bold leading-6"
        style={{ background: T.dangerSoft, border: "1px solid var(--color-admin-danger-line)", color: T.danger }}
      >
        {trivial
          ? "这场还没开始、也没有人报名，删掉不会丢任何记录。"
          : `这会连同这一场的 ${props.event.player_count} 位玩家，以及他们的分数、盖章、人生事件和人工修正记录一起删除，不可恢复，也没有回收站。`}
      </div>
      {!trivial && (
        <label className="mt-6 block">
          <span className="text-sm font-black">手打活动名称确认</span>
          <input
            className={inputClass}
            style={inputStyle}
            autoFocus
            placeholder={props.event.title}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
      )}
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
        <Btn
          variant="dangerSolid"
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true); setErr(null);
            try {
              await rpc("admin_delete_event", {
                p_admin_key: props.adminKey,
                p_event_id: props.event.event_id,
                p_confirm: trivial ? null : confirm,
              });
              props.onDone(`已删除「${props.event.title}」`);
            } catch (error) { setErr(errorText(error)); } finally { setBusy(false); }
          }}
        >
          永久删除
        </Btn>
      </div>
    </Modal>
  );
}
