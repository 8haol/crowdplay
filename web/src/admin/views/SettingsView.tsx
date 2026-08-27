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
  const [staffKey, setStaffKey] = useState("");
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
                      await rpc("admin_update_game", { p_admin_key: adminKey, p_title: title.trim(), p_join_open: null });
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
                    await rpc("admin_update_game", { p_admin_key: adminKey, p_title: null, p_join_open: !session.join_open });
                    onDone(session.join_open ? "玩家登记已关闭" : "玩家登记已开放");
                  } catch (error) { setErr(errorText(error)); }
                }}
              />
            </div>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHead eyebrow="ACCESS" title="访问控制" note="密码只以 SHA-256 摘要存在数据库里" />
          <div className="p-5">
            <Field label="新工作人员密码" hint="至少 6 位；留空表示不修改">
              <input
                type="password"
                className={inputClass}
                style={inputStyle}
                placeholder="/staff 登录用"
                value={staffKey}
                onChange={(event) => setStaffKey(event.target.value)}
              />
            </Field>
            <div className="mt-4">
              <Field label="新管理员密码" hint="至少 8 位；留空表示不修改。管理员密码可以通行一切工作人员操作">
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
              disabled={!staffKey && !adminKeyNew}
              onClick={async () => {
                setErr(null);
                try {
                  await rpc("admin_update_access", {
                    p_admin_key: adminKey,
                    p_new_staff_key: staffKey || null,
                    p_new_admin_key: adminKeyNew || null,
                  });
                  if (adminKeyNew) onAdminKeyChanged(adminKeyNew);
                  setStaffKey("");
                  setAdminKeyNew("");
                  onDone("访问密码已更新");
                } catch (error) { setErr(errorText(error)); }
              }}
            >
              更新访问密码
            </Btn>
          </div>
        </Panel>
      </div>

      <div className="mt-5"><ErrorBanner text={err} /></div>

      <Panel tone="danger" className="mt-5 p-5">
        <h2 className="text-lg font-black" style={{ color: "#963c2e" }}>场次生命周期</h2>
        <p className="mt-1 max-w-2xl text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
          创建新场次会先把当前数据完整归档（玩家、队伍、站点成绩、人生事件、管理记录），
          再生成新的二维码和统计空间。历史场次不会被删除，随时可以在「全部活动」里回看。
        </p>
        <Btn variant="danger" className="mt-5" onClick={onNewGame}>归档当前场次并创建新场次</Btn>
      </Panel>
    </div>
  );
}
