import { useState } from "react";
import { rpc, errorText } from "../../lib/api";
import type { AdminConsoleData } from "../../lib/types";
import { ErrorBanner } from "../../lib/ui";
import { Btn, Field, Panel, PanelHead, PageTitle, Toggle } from "../adminUi";
import { T, inputClass, inputStyle } from "../adminTokens";

export function SettingsView({
  adminKey,
  consoleData,
  onDone,
  onNewGame,
  onAdminKeyChanged,
}: {
  adminKey: string;
  consoleData: AdminConsoleData;
  onDone: (message: string) => void;
  onNewGame: () => void;
  onAdminKeyChanged: (key: string) => void;
}) {
  const session = consoleData.current;
  const [title, setTitle] = useState(session.title);
  const [adminKeyNew, setAdminKeyNew] = useState("");
  const [err, setErr] = useState<string | null>(null);

  return (
    <div>
      <PageTitle
        eyebrow="CONFIGURATION"
        title="系统设置"
        description="场次基础信息、玩家登记开关和访问密码。全部改动立即生效，不需要进 Supabase。"
      />

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel className="overflow-hidden">
          <PanelHead eyebrow="CURRENT EVENT" title="当前场次" note="改名称和登记状态" />
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
                      await rpc("admin_update_game", { p_admin_key: adminKey, p_event_id: session.event_id, p_title: title.trim(), p_join_open: null });
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
                label="开放玩家登记"
                note="关闭后二维码仍然有效，但不能再创建新编号"
                onChange={async () => {
                  setErr(null);
                  try {
                    await rpc("admin_update_game", { p_admin_key: adminKey, p_event_id: session.event_id, p_title: null, p_join_open: !session.join_open });
                    onDone(session.join_open ? "玩家登记已关闭" : "玩家登记已开放");
                  } catch (error) { setErr(errorText(error)); }
                }}
              />
            </div>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHead eyebrow="ACCESS" title="访问控制" note="管理密码属于机构；工作人员码属于这一场" />
          <div className="p-5">
            <Field label="本场工作人员码" hint="志愿者在 /staff 输入它。泄露了就换一个，旧码立即失效">
              <div className="mt-2 flex items-center gap-3">
                <span className="font-mono text-2xl font-black tracking-[0.3em]">{session.staff_code}</span>
                <Btn
                  onClick={async () => {
                    setErr(null);
                    try {
                      const result = await rpc<{ staff_code: string | null }>("admin_update_access", {
                        p_admin_key: adminKey,
                        p_new_admin_key: null,
                        p_rotate_staff_event_id: session.event_id,
                      });
                      onDone(`工作人员码已换成 ${result.staff_code ?? ""}，请重新发给同工`);
                    } catch (error) { setErr(errorText(error)); }
                  }}
                >
                  换一个
                </Btn>
              </div>
            </Field>
            <div className="mt-5">
              <Field label="新管理员密码" hint="至少 8 位；留空表示不修改。这是整个机构的密码，只以 SHA-256 摘要存库">
                <input
                  type="password"
                  className={inputClass}
                  style={inputStyle}
                  placeholder="/admin 登录用"
                  value={adminKeyNew}
                  onChange={(event) => setAdminKeyNew(event.target.value)}
                />
              </Field>
            </div>
            <Btn
              variant="primary"
              className="mt-5"
              disabled={!adminKeyNew}
              onClick={async () => {
                setErr(null);
                try {
                  await rpc("admin_update_access", {
                    p_admin_key: adminKey,
                    p_new_admin_key: adminKeyNew,
                    p_rotate_staff_event_id: null,
                  });
                  onAdminKeyChanged(adminKeyNew);
                  setAdminKeyNew("");
                  onDone("管理员密码已更新");
                } catch (error) { setErr(errorText(error)); }
              }}
            >
              更新管理员密码
            </Btn>
          </div>
        </Panel>
      </div>

      <div className="mt-5"><ErrorBanner text={err} /></div>

      <Panel tone="danger" className="mt-5 p-5">
        <h2 className="text-lg font-black" style={{ color: "#963c2e" }}>场次生命周期</h2>
        <p className="mt-1 max-w-2xl text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
          每一场都有自己的入场二维码、工作人员码和大屏链接。新建场次不会动现有任何一场的数据；
          结束的场次带着完整的玩家、成绩和记录留在「全部活动」里，随时可以点进去。
          同一机构同时只能有一场在进行中。
        </p>
        <Btn variant="danger" className="mt-5" onClick={onNewGame}>创建新场次</Btn>
      </Panel>
    </div>
  );
}
