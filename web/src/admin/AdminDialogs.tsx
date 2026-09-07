import { useState } from "react";
import { rpc, errorText } from "../lib/api";
import type { AdminPlayer, GameSession, StationMetric } from "../lib/types";
import { ActionButton, ErrorBanner } from "../lib/ui";
import { Btn, DialogHead, Drawer, Modal } from "./adminUi";
import { T, inputClass, inputStyle } from "./adminTokens";

export function NewGameModal(props: {
  adminKey: string;
  current: GameSession;
  playerCount: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needsConfirm = props.current.phase !== "ended" && props.playerCount > 0;

  return (
    <Modal onClose={props.onClose}>
      <DialogHead eyebrow="创建场次" title="开始一场新的活动" onClose={props.onClose} />
      <p className="mt-4 text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
        当前场次「{props.current.title}」会完整归档，包括玩家、站点成绩、人生事件与管理记录。
        新场次会生成独立的入场二维码。
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
      {needsConfirm && (
        <label
          className="mt-4 flex items-start gap-3 rounded-xl p-4 text-sm font-bold"
          style={{ background: T.dangerSoft, border: "1px solid #efc5bb", color: T.danger }}
        >
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 accent-[#c4402a]"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>当前场次仍在使用中（{props.playerCount} 位玩家），我确认立即归档并创建新场次。</span>
        </label>
      )}
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
        <Btn
          variant="primary"
          disabled={!title.trim() || (needsConfirm && !confirmed)}
          onClick={async () => {
            setErr(null);
            try {
              await rpc("admin_create_game", {
                p_admin_key: props.adminKey,
                p_title: title.trim(),
                p_force: needsConfirm && confirmed,
              });
              props.onDone(`已创建「${title.trim()}」，二维码和玩家名单均已更新`);
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
  player: AdminPlayer;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const player = props.player;
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
    ["个人总分", player.score],
    ["站点", `${player.stations_done}/${player.stations_total}`],
    ["人生事件", `${player.life_events_done}/${player.life_events_total}`],
    ["下一段", player.next_event_stage ? `第 ${player.next_event_stage} 段（第 ${player.next_event_after_station} 站后）` : "已全部经历"],
  ];

  return (
    <Drawer onClose={props.onClose}>
      <div
        className="sticky top-0 z-10 p-6 backdrop-blur"
        style={{ background: "rgba(252,250,246,.95)", borderBottom: `1px solid ${T.line}` }}
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
            <StateToggle label="归还 Help Token" active={restoreToken} onChange={setRestoreToken} disabled={player.token_available} />
            <StateToggle label="恢复已删除玩家" active={restore} onChange={setRestore} disabled={!player.is_removed} />
          </div>
        </section>

        <section>
          <h3 className="text-lg font-black">手动修正个人护照</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-black">个人总分</span>
              <input
                inputMode="numeric"
                className={`${inputClass} tabular`}
                style={inputStyle}
                placeholder={String(player.score)}
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
            <h3 className="text-lg font-black" style={{ color: "#9d3728" }}>移除玩家</h3>
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
                      await rpc("admin_remove_player", { p_admin_key: props.adminKey, p_player_code: player.code });
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
          ? { border: "1px solid #e8e0d4", background: "#f3efe8", color: "#aaa090" }
          : active
            ? { border: `1px solid ${T.accent}`, background: "#fff7d8" }
            : { border: "1px solid #ded4c3", background: "#fff" }
      }
    >
      <input
        type="checkbox"
        checked={active}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-[#26211b]"
      />
      {label}
    </label>
  );
}

export function StationEditModal(props: {
  adminKey: string;
  station: StationMetric;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = useState(props.station.name_zh);
  const [mode, setMode] = useState(props.station.scoring_mode ?? "graded");
  const [err, setErr] = useState<string | null>(null);

  return (
    <Modal onClose={props.onClose} width="max-w-md">
      <DialogHead eyebrow="站点设置" title={`编辑 ${props.station.name_zh}`} onClose={props.onClose} />
      <label className="mt-6 block">
        <span className="text-sm font-black">显示名称</span>
        <input className={inputClass} style={inputStyle} value={name} maxLength={30} onChange={(event) => setName(event.target.value)} />
      </label>
      {props.station.type === "main" && (
        <label className="mt-4 block">
          <span className="text-sm font-black">计分方式</span>
          <select
            className={inputClass}
            style={inputStyle}
            value={mode}
            onChange={(event) => setMode(event.target.value as "graded" | "free" | "fixed")}
          >
            <option value="graded">分级计分（3 / 6 / 9）</option>
            <option value="free">自由计分（0–10 整数）</option>
            <option value="fixed">固定计分（6 分）</option>
          </select>
        </label>
      )}
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
        <Btn
          variant="primary"
          onClick={async () => {
            setErr(null);
            try {
              await rpc("admin_update_station", {
                p_admin_key: props.adminKey,
                p_station_id: props.station.id,
                p_name_zh: name.trim(),
                p_scoring_mode: props.station.type === "main" ? mode : null,
              });
              props.onDone(`站点「${name.trim()}」已更新`);
            } catch (error) { setErr(errorText(error)); }
          }}
        >
          保存
        </Btn>
      </div>
    </Modal>
  );
}
