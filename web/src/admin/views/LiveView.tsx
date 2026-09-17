import { useState } from "react";
import { rpc, errorText } from "../../lib/api";
import { JoinQr } from "../../lib/JoinQr";
import { joinUrl, screenUrl } from "../../lib/gameLinks";
import type { AdminConsoleData, AdminPlayer } from "../../lib/types";
import { IDENTITY_SHORT, colorOf } from "../../lib/types";
import { ErrorBanner } from "../../lib/ui";
import { AdminIcon, Btn, EmptyState, Field, Metric, Panel, PanelHead, PageTitle, PhaseLabel } from "../adminUi";
import { T, inputClass, inputStyle } from "../adminTokens";
import { elapsedLabel, feedLabel, formatDate } from "../adminUtils";

/*
 * The control room for whatever session is live right now. Everything the host
 * touches during the hour is on this one page, in the order they need it:
 * what to do next → who to let in → who needs attention → what just happened.
 */
export function LiveView({
  adminKey,
  consoleData,
  players,
  onDone,
  onPlayer,
  onNewGame,
}: {
  adminKey: string;
  consoleData: AdminConsoleData;
  players: AdminPlayer[];
  onDone: (message: string) => void;
  onPlayer: (code: string) => void;
  onNewGame: () => void;
}) {
  const session = consoleData.current;
  const locked = players.filter((player) => player.locked_for_life_event && !player.is_removed);
  const elapsed = elapsedLabel(session.started_at);

  return (
    <div>
      <PageTitle
        eyebrow="LIVE CONSOLE · 现场总控"
        title={session.title}
        description={`创建于 ${formatDate(session.created_at)}${elapsed ? ` · ${elapsed}` : ""}。开局、结束、入场二维码和现场异常都在这一页。`}
        actions={
          <>
            <a
              href={screenUrl(session.screen_token)}
              target="_blank"
              rel="noreferrer"
              className="pressable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black"
              style={{ background: T.panel, color: T.ink, border: "1px solid #d9cebc" }}
            >
              <AdminIcon name="screen" className="h-4 w-4" />
              打开实况大屏
            </a>
            <PhaseLabel phase={session.phase} />
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="到场玩家" value={consoleData.stats.players} note={`${consoleData.stats.teams} 支队伍`} tone="accent" />
        <Metric label="整队盖章" value={consoleData.stats.stamps} note={`${consoleData.stats.life_events} 次人生事件`} />
        <Metric label="Token 已用" value={consoleData.stats.tokens_used} note="含提示 / 重来 / 纪念卡" />
        <Metric
          label="手机待选事件"
          value={consoleData.stats.locked_players}
          note={consoleData.stats.locked_players > 0 ? "玩家自己在手机上处理" : "现场无异常"}
          tone={consoleData.stats.locked_players > 0 ? "danger" : "good"}
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,.6fr)]">
        <div className="space-y-5">
          <OperationPanel adminKey={adminKey} consoleData={consoleData} onDone={onDone} onNewGame={onNewGame} />
          <ActivityPanel consoleData={consoleData} />
        </div>
        <div className="space-y-5">
          <JoinPanel session={session} onDone={onDone} />
          <AttentionPanel locked={locked} onPlayer={onPlayer} />
          <TeamPanel consoleData={consoleData} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- operations */

function OperationPanel({
  adminKey,
  consoleData,
  onDone,
  onNewGame,
}: {
  adminKey: string;
  consoleData: AdminConsoleData;
  onDone: (message: string) => void;
  onNewGame: () => void;
}) {
  const session = consoleData.current;
  const [trio, setTrio] = useState("6");
  const [duo, setDuo] = useState("10");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const planned = Number(trio || 0) * 3 + Number(duo || 0) * 2;
  const solo = Math.max(0, consoleData.stats.players - planned);

  return (
    <Panel className="overflow-hidden">
      <PanelHead eyebrow="NEXT STEP" title="下一步操作" note="整场活动只有三个动作：开局、结束、开新场" />
      <div className="p-5">
        {session.phase === "waiting" && (
          <div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Trio 三人组" hint="每组 3 人">
                <input inputMode="numeric" className={`${inputClass} tabular text-xl`} style={inputStyle} value={trio}
                  onChange={(event) => setTrio(event.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Duo 二人组" hint="每组 2 人">
                <input inputMode="numeric" className={`${inputClass} tabular text-xl`} style={inputStyle} value={duo}
                  onChange={(event) => setDuo(event.target.value.replace(/\D/g, ""))} />
              </Field>
            </div>
            <div className="mt-4 rounded-xl p-4 text-sm font-semibold leading-6" style={{ background: T.panelAlt, color: T.inkSoft }}>
              现在有 <b style={{ color: T.ink }}>{consoleData.stats.players}</b> 人。计划组队 {planned} 人，
              其余 <b style={{ color: T.ink }}>{solo}</b> 人自动成为 Solo。
              开局会给每支队伍分配一个颜色，队友靠颜色互相找到；
              工作人员只需要队里<b style={{ color: T.ink }}>任意一人</b>的 3 位人生编号，整队录一次分。
            </div>
            <div className="mt-4"><ErrorBanner text={err} /></div>
            <Btn
              variant="primary"
              className="mt-4"
              disabled={consoleData.stats.players === 0}
              onClick={async () => {
                setErr(null);
                try {
                  await rpc("start_game", { p_admin_key: adminKey, p_event_id: session.event_id, p_quota: { trio: Number(trio || 0), duo: Number(duo || 0) } });
                  onDone("游戏已开始，组队颜色已经分配");
                } catch (error) { setErr(errorText(error)); }
              }}
            >
              生成队伍并开始游戏
            </Btn>
          </div>
        )}

        {session.phase === "playing" && (
          <div>
            <div className="flex items-center gap-3 rounded-xl p-4" style={{ background: T.goodSoft }}>
              <span className="h-3 w-3 animate-pulse rounded-full" style={{ background: "#319a5d" }} />
              <div>
                <div className="font-black" style={{ color: "#236c43" }}>游戏正在进行</div>
                <div className="text-sm font-semibold" style={{ color: "#4c7860" }}>
                  个人总分、人生事件和站点数据每 3 秒刷新一次
                </div>
              </div>
            </div>
            <div className="mt-4"><ErrorBanner text={err} /></div>
            {confirmEnd ? (
              <div className="mt-4 rounded-xl p-4" style={{ background: T.dangerSoft, border: "1px solid #e5b5aa" }}>
                <div className="text-sm font-black" style={{ color: T.danger }}>
                  确定结束本场？登记会关闭，大屏立刻开始颁奖典礼。玩家进入结算页，但看不到名次 —— 等你颁完奖再点「公布排名」。
                </div>
                <div className="mt-3 flex gap-2">
                  <Btn
                    variant="dangerSolid"
                    onClick={async () => {
                      setErr(null);
                      try {
                        await rpc("end_game", { p_admin_key: adminKey, p_event_id: session.event_id });
                        onDone("本场已结束，大屏开始颁奖");
                      } catch (error) { setErr(errorText(error)); }
                    }}
                  >
                    确认结束并颁奖
                  </Btn>
                  <Btn variant="quiet" onClick={() => setConfirmEnd(false)}>取消</Btn>
                </div>
              </div>
            ) : (
              <Btn variant="danger" className="mt-4" onClick={() => setConfirmEnd(true)}>结束本场并开始颁奖</Btn>
            )}
          </div>
        )}

        {session.phase === "ended" && (
          <div>
            <div className="rounded-xl p-4" style={{ background: T.panelAlt }}>
              <div className="font-black">本场已经结束</div>
              <p className="mt-1 text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
                大屏正在播放颁奖（可用 ← → 翻页、Esc 跳到总榜）。玩家能看到自己的总分；
                恩典站也仍然可以为还有 Token 的玩家兑换纪念卡。
              </p>
            </div>

            {/* 第二步。结束和公布分开，就是为了让全场先抬头看完大屏，而不是
                一点结束就集体低头看自己的名次。 */}
            {session.ranks_published_at ? (
              <div className="mt-4 flex items-center gap-3 rounded-xl p-4" style={{ background: T.goodSoft }}>
                <span className="h-3 w-3 rounded-full" style={{ background: "#319a5d" }} />
                <div>
                  <div className="font-black" style={{ color: "#236c43" }}>排名已公布到玩家手机</div>
                  <div className="text-sm font-semibold" style={{ color: "#4c7860" }}>
                    {formatDate(session.ranks_published_at, true)} · 纪念徽章也已开放
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl p-4" style={{ background: T.warnSoft }}>
                <div className="text-sm font-black" style={{ color: T.warn }}>
                  玩家手机上还看不到名次
                </div>
                <p className="mt-1 text-sm font-semibold leading-6" style={{ color: T.warn }}>
                  颁完奖再点下面这个按钮，所有人的手机会同时解锁名次和纪念徽章。
                  忘了点也没关系：结束满 15 分钟会自动公布。
                </p>
                <Btn
                  variant="primary"
                  className="mt-3"
                  onClick={async () => {
                    setErr(null);
                    try {
                      await rpc("publish_ranks", { p_admin_key: adminKey, p_event_id: session.event_id });
                      onDone("排名已公布，玩家手机现在能看到名次和纪念徽章");
                    } catch (error) { setErr(errorText(error)); }
                  }}
                >
                  公布排名到玩家手机
                </Btn>
              </div>
            )}

            <div className="mt-4"><ErrorBanner text={err} /></div>
            <Btn variant="primary" icon="plus" className="mt-4" onClick={onNewGame}>创建新场次</Btn>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ panels */

/*
 * The three keys to this event, side by side. Each one is what a different
 * group of people needs and nothing more: players scan or tap the link, staff
 * type the six-character code, the projector laptop opens the screen link.
 */
function JoinPanel({ session, onDone }: { session: AdminConsoleData["current"]; onDone: (message: string) => void }) {
  const url = joinUrl(session.join_token);
  const screen = screenUrl(session.screen_token);
  const copy = async (text: string, message: string) => {
    await navigator.clipboard.writeText(text);
    onDone(message);
  };
  return (
    <Panel className="overflow-hidden">
      <PanelHead eyebrow="EVENT KEYS" title="本场的三把钥匙" note={session.join_open ? "入场链接开放中" : "登记当前已关闭"} />
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-4 p-5">
        <JoinQr url={url} className="aspect-square w-full rounded-lg" />
        <div className="min-w-0 self-center">
          <div className="text-[10px] font-black tracking-[0.25em]" style={{ color: T.inkFaint }}>玩家 · 入场链接</div>
          <div className="mt-1 truncate font-mono text-[10px]" style={{ color: T.inkFaint }}>{url}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn icon="copy" onClick={() => copy(url, "入场链接已复制，可直接发到群里")}>复制入场链接</Btn>
          </div>
          <p className="mt-2 text-[11px] font-semibold leading-5" style={{ color: T.inkSoft }}>
            二维码和链接是同一样东西。大屏会显示同一个码，玩家中途退出也能从大屏角落重新扫码进入。
          </p>
        </div>
      </div>

      <div className="grid gap-3 border-t px-5 py-4 sm:grid-cols-2" style={{ borderColor: "#ebe2d2" }}>
        <div className="rounded-xl p-4" style={{ background: T.panelAlt }}>
          <div className="text-[10px] font-black tracking-[0.25em]" style={{ color: T.inkFaint }}>工作人员 · 本场码</div>
          <div className="mt-1 font-mono text-2xl font-black tracking-[0.3em]">{session.staff_code}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn icon="copy" onClick={() => copy(session.staff_code, "工作人员码已复制")}>复制</Btn>
          </div>
          <p className="mt-2 text-[11px] font-semibold leading-5" style={{ color: T.inkSoft }}>
            志愿者在 /staff 输入这 6 位，就只能给这一场录分。要换码去「系统设置」。
          </p>
        </div>
        <div className="rounded-xl p-4" style={{ background: T.panelAlt }}>
          <div className="text-[10px] font-black tracking-[0.25em]" style={{ color: T.inkFaint }}>投影 · 大屏链接</div>
          <div className="mt-1 truncate font-mono text-[10px]" style={{ color: T.inkFaint }}>{screen}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn icon="copy" onClick={() => copy(screen, "大屏链接已复制")}>复制</Btn>
            <a
              href={screen}
              target="_blank"
              rel="noreferrer"
              className="pressable inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black"
              style={{ background: "#fff", border: "1px solid #d9cebc", color: T.ink }}
            >
              <AdminIcon name="screen" className="h-4 w-4" />
              新窗口打开
            </a>
          </div>
          <p className="mt-2 text-[11px] font-semibold leading-5" style={{ color: T.inkSoft }}>
            在接投影的电脑上打开这条链接即可。它只显示这一场，不含任何人生编号。
          </p>
        </div>
      </div>
    </Panel>
  );
}

function AttentionPanel({ locked, onPlayer }: { locked: AdminPlayer[]; onPlayer: (code: string) => void }) {
  if (locked.length === 0) {
    return (
      <Panel className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl font-black" style={{ background: T.goodSoft, color: T.good }}>
            <AdminIcon name="check" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-black">现场状态正常</h2>
            <p className="mt-1 text-sm font-semibold leading-5" style={{ color: T.inkSoft }}>
              没有玩家卡在人生事件选择上。
            </p>
          </div>
        </div>
      </Panel>
    );
  }
  return (
    <Panel className="overflow-hidden">
      <PanelHead
        eyebrow="需要留意"
        title={`${locked.length} 位玩家正在经历人生事件`}
        note="玩家在自己手机上处理，不会锁住整队"
      />
      <div>
        {locked.slice(0, 8).map((player) => (
          <button
            key={player.code}
            type="button"
            className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-[#fff9ed]"
            style={{ borderBottom: `1px solid ${T.lineSoft}` }}
            onClick={() => onPlayer(player.code)}
          >
            <div>
              <div className="font-black">{player.name}</div>
              <div className="text-xs font-semibold" style={{ color: T.inkSoft }}>
                {colorOf(player.color_group)?.zh ?? "未分配"} · 第 {player.pending_stage ?? "?"} 段人生
              </div>
            </div>
            <AdminIcon name="chevron" className="h-4 w-4" />
          </button>
        ))}
      </div>
    </Panel>
  );
}

function TeamPanel({ consoleData }: { consoleData: AdminConsoleData }) {
  /* How many stations this event runs, not the platform's old fixed seven —
     same count `_event_teams_detail.stations_done` is measured against
     (this event's roster, withdrawn ones excluded). Mirrors the Ceremony
     podium slide's `stationsTotal`. */
  const stationsTotal = Math.max(
    1,
    consoleData.station_metrics.filter((s) => s.type === "main" && !s.disabled).length,
  );
  if (consoleData.teams.length === 0) {
    return (
      <Panel>
        <EmptyState title="还没有分队" detail="开局后这里会列出所有 S / D / T 队伍及其成员。" />
      </Panel>
    );
  }
  return (
    <Panel className="overflow-hidden">
      <PanelHead
        eyebrow="TEAMS"
        title={`${consoleData.teams.length} 支队伍`}
        note="队伍靠颜色识别；分数属于个人"
      />
      <div className="tool-scroll max-h-[26rem] overflow-y-auto">
        {consoleData.teams.map((team) => {
          const color = colorOf(team.color_group);
          return (
            <div key={team.team_id} className="px-5 py-3" style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color?.hex ?? "#8c8171" }} />
                  <span className="shrink-0 text-xs font-black">
                    {color?.zh ?? IDENTITY_SHORT[team.identity]}
                  </span>
                  <span className="truncate text-xs font-bold" style={{ color: T.inkSoft }}>
                    {team.members.map((member) => member.name).join(" / ")}
                  </span>
                </div>
                <span className="tabular shrink-0 text-sm font-black">{team.stations_done}/{stationsTotal}</span>
              </div>
              {team.pending_events > 0 && (
                <div className="mt-1 text-[11px] font-bold" style={{ color: T.danger }}>
                  {team.pending_events} 人手机待选择
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

const KIND_LOOK: Record<string, { bg: string; fg: string; mark: string }> = {
  attempt: { bg: T.warnSoft, fg: "#765400", mark: "分" },
  life_event: { bg: "#ffe5df", fg: "#983b2c", mark: "事" },
  token: { bg: "#e5f0fb", fg: "#2a6294", mark: "T" },
  admin: { bg: "#eee8de", fg: T.inkSoft, mark: "管" },
};

function ActivityPanel({ consoleData }: { consoleData: AdminConsoleData }) {
  return (
    <Panel className="overflow-hidden">
      <PanelHead eyebrow="TIMELINE" title="最近动态" note="自动更新" />
      {consoleData.activity.length === 0 ? (
        <EmptyState title="活动还没有动态" detail="玩家开始挑战后，这里会出现实时记录。" />
      ) : (
        <div className="tool-scroll max-h-[30rem] overflow-y-auto">
          {consoleData.activity.slice(0, 20).map((item) => {
            const look = KIND_LOOK[item.kind] ?? KIND_LOOK.admin;
            return (
              <div
                key={item.id}
                className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-3 px-5 py-3.5"
                style={{ borderBottom: `1px solid ${T.lineSoft}` }}
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg text-xs font-black" style={{ background: look.bg, color: look.fg }}>
                  {look.mark}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black">{item.player_name ?? "系统"} · {feedLabel(item.label)}</div>
                  <div className="mt-0.5 text-xs font-semibold" style={{ color: T.inkSoft }}>{item.detail}</div>
                </div>
                <time className="shrink-0 text-[11px]" style={{ color: T.inkFaint }}>{formatDate(item.at, true)}</time>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
