import { useState } from "react";
import { rpc, errorText } from "../../lib/api";
import type { AdminConsoleData } from "../../lib/types";
import { ErrorBanner } from "../../lib/ui";
import { Btn, Field, Panel, PanelHead, PageTitle, ThemeRadio, Toggle } from "../adminUi";
import { T, inputClass, inputStyle } from "../adminTokens";
import { themeLabel } from "../adminUtils";

/*
 * 只属于这一场活动的设置。
 *
 * 这一页存在的理由：以前活动名称和登记开关藏在「系统设置」里，那一页看着像
 * 机构级的，实际改的是一个隐式选中的场次——于是「待开始的活动完全没法改」。
 * 现在它明确属于某一场，作用对象写在地址栏里。
 *
 * 后端 admin_update_game / admin_update_access 从来不看 phase，所以待开始的
 * 场次一直都能改，缺的只是入口。这里不要再加任何 phase 限制。
 */
export function EventSettingsView({
  adminKey,
  session,
  onDone,
}: {
  adminKey: string;
  session: AdminConsoleData["current"];
  onDone: (message: string) => void;
}) {
  const [title, setTitle] = useState(session.title);
  const [err, setErr] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [themeBusy, setThemeBusy] = useState(false);
  // 已结束的场次不再收人、也不再需要轮换工作人员码；两项关掉但仍然显示，
  // 并写清楚为什么——藏起来会让人以为功能没了。
  const ended = session.phase === "ended";

  return (
    <div>
      <PageTitle
        eyebrow="EVENT SETTINGS"
        title="本场设置"
        description="只影响这一场活动。改动立即生效。"
      />

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel className="overflow-hidden">
          <PanelHead eyebrow="BASICS" title="名称与登记" note="任何状态下都能改名" />
          <div className="p-5">
            <Field label="活动名称">
              <div className="mt-2 flex gap-2">
                <input
                  className={`${inputClass} !mt-0 min-w-0 flex-1`}
                  style={inputStyle}
                  value={title}
                  maxLength={60}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <Btn
                  variant="primary"
                  disabled={!title.trim() || title === session.title}
                  onClick={async () => {
                    setErr(null);
                    try {
                      await rpc("admin_update_game", {
                        p_admin_key: adminKey,
                        p_event_id: session.event_id,
                        p_title: title.trim(),
                        p_join_open: null,
                      });
                      onDone("活动名称已更新");
                    } catch (error) { setErr(errorText(error)); }
                  }}
                >
                  保存
                </Btn>
              </div>
            </Field>

            <div className="mt-5">
              <Toggle
                checked={session.join_open}
                disabled={ended}
                label="开放玩家登记"
                note={
                  ended
                    ? "活动已结束，不再接受新玩家登记"
                    : "关闭后二维码仍然有效，但不能再创建新编号"
                }
                onChange={async () => {
                  setErr(null);
                  try {
                    await rpc("admin_update_game", {
                      p_admin_key: adminKey,
                      p_event_id: session.event_id,
                      p_title: null,
                      p_join_open: !session.join_open,
                    });
                    onDone(session.join_open ? "玩家登记已关闭" : "玩家登记已开放");
                  } catch (error) { setErr(errorText(error)); }
                }}
              />
            </div>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHead eyebrow="THEME" title="主题" note="玩家、大屏、义工页立即换皮；后台不变" />
          <div className="p-5">
            {/* 点即生效，没有「保存」键：换皮不改任何分数或名单，撤回就是再点一下。 */}
            <ThemeRadio
              value={session.theme}
              disabled={themeBusy}
              onChange={async (next) => {
                setErr(null);
                setThemeBusy(true);
                try {
                  await rpc("admin_update_game", {
                    p_admin_key: adminKey,
                    p_event_id: session.event_id,
                    p_title: null,
                    p_join_open: null,
                    p_theme: next,
                  });
                  onDone(`主题已切换为「${themeLabel(next)}」`);
                } catch (error) { setErr(errorText(error)); } finally { setThemeBusy(false); }
              }}
            />
            <p className="mt-3 text-xs font-semibold" style={{ color: T.inkFaint }}>
              进行中的场次也能换：玩家下一次刷新就是新皮，分数、印章、名单都不动。
            </p>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHead eyebrow="STAFF" title="工作人员码" note="属于这一场，换了旧码立即失效" />
          <div className="p-5">
            {/* 复制在前，换码在后，中间隔一条线。这两件事以前挤在一起，只有
                一个「换一个」按钮：想抄码的人点下去，码就当场变了。 */}
            <Field label="本场工作人员码" hint="志愿者在 /staff 输入它">
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="font-mono text-2xl font-black tracking-[0.3em]">{session.staff_code}</span>
                <Btn
                  icon="copy"
                  onClick={async () => {
                    await navigator.clipboard.writeText(session.staff_code);
                    onDone("工作人员码已复制");
                  }}
                >
                  复制
                </Btn>
              </div>
            </Field>

            {ended ? (
              <p className="mt-4 text-xs font-semibold" style={{ color: T.inkFaint }}>
                活动已结束，工作人员码不再需要更换。
              </p>
            ) : (
              <div className="mt-5 border-t pt-5" style={{ borderColor: T.lineSoft }}>
                <Field
                  label="换一个码"
                  hint="留空就随机生成六位；也可以自己定一个好记的，4–12 位字母或数字"
                >
                  {/* No toUpperCase in onChange: rewriting the value mid-IME-composition
                      duplicates what was typed. CSS shows it upper-case; it is
                      normalised where it is used. */}
                  <input
                    className={`${inputClass} uppercase`}
                    style={inputStyle}
                    value={custom}
                    maxLength={12}
                    placeholder="留空 = 随机生成"
                    onChange={(e) => { setCustom(e.target.value); setConfirmRotate(false); }}
                  />
                </Field>
                {confirmRotate ? (
                  <div className="mt-3 rounded-xl p-4" style={{ background: T.dangerSoft, border: "1px solid var(--color-admin-alert-line)" }}>
                    <div className="text-sm font-black" style={{ color: T.danger }}>
                      确定把 {session.staff_code} 换成{custom.trim() ? ` ${custom.trim().toUpperCase()}` : "一个新的随机码"}？旧码立即失效，正在用旧码的同工要重新输入新码。
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Btn
                        variant="dangerSolid"
                        onClick={async () => {
                          setErr(null);
                          try {
                            const result = await rpc<{ staff_code: string | null }>("admin_update_access", {
                              p_admin_key: adminKey,
                              p_new_admin_key: null,
                              p_rotate_staff_event_id: session.event_id,
                              p_staff_code: custom.trim().toUpperCase() || null,
                            });
                            setCustom("");
                            setConfirmRotate(false);
                            onDone(`工作人员码已换成 ${result.staff_code ?? ""}，请重新发给同工`);
                          } catch (error) { setErr(errorText(error)); }
                        }}
                      >
                        确认更换
                      </Btn>
                      <Btn variant="quiet" onClick={() => setConfirmRotate(false)}>取消</Btn>
                    </div>
                  </div>
                ) : (
                  <Btn className="mt-3" onClick={() => setConfirmRotate(true)}>换一个</Btn>
                )}
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-5"><ErrorBanner text={err} /></div>
    </div>
  );
}
