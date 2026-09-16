import { useState } from "react";
import { rpc, errorText } from "../../lib/api";
import { ErrorBanner } from "../../lib/ui";
import { Btn, Field, Panel, PanelHead, PageTitle } from "../adminUi";
import { T, inputClass, inputStyle } from "../adminTokens";

/*
 * 属于整间机构、不属于任何一场活动的设置。
 *
 * 今天这里只有管理密码一项——这是如实反映现状，不是还没做完。机构名称由平台方
 * 在 /root 维护，这一页只显示。不要为了"让页面看起来充实"把本场的东西塞回来：
 * 那正是这次重构要治的病。
 */
export function OrgSettingsView({
  adminKey,
  orgName,
  onDone,
  onAdminKeyChanged,
}: {
  adminKey: string;
  orgName: string;
  onDone: (message: string) => void;
  onAdminKeyChanged: (key: string) => void;
}) {
  const [adminKeyNew, setAdminKeyNew] = useState("");
  const [err, setErr] = useState<string | null>(null);

  return (
    <div>
      <PageTitle
        eyebrow="ORGANIZATION"
        title="机构设置"
        description="这一页的设置属于整间机构，不属于任何一场活动。"
      />

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel className="overflow-hidden">
          <PanelHead eyebrow="IDENTITY" title="机构信息" note="由平台方维护" />
          <div className="p-5">
            <Field label="机构名称">
              <div className="mt-2 text-lg font-black">{orgName}</div>
            </Field>
            <p className="mt-3 text-xs font-semibold leading-5" style={{ color: T.inkFaint }}>
              机构名称由平台方在 /root 维护，这里只显示。需要改名请联系平台方。
            </p>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHead eyebrow="ACCESS" title="访问控制" note="这是整间机构的登录密码" />
          <div className="p-5">
            <Field label="新管理员密码" hint="至少 4 位；留空表示不修改。这是整个机构的密码，只以 SHA-256 摘要存库">
              <input
                type="password"
                className={inputClass}
                style={inputStyle}
                placeholder="/admin 登录用"
                value={adminKeyNew}
                onChange={(event) => setAdminKeyNew(event.target.value)}
              />
            </Field>
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
    </div>
  );
}
