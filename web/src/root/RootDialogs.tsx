import { useState } from "react";
import { rpc, errorText } from "../lib/api";
import { ErrorBanner } from "../lib/ui";
import { Btn, DialogHead, Modal } from "../admin/adminUi";
import { T, inputClass, inputStyle } from "../admin/adminTokens";
import type { PlatformOrg } from "../lib/types";
import { GB, formatBytes, formatUsage } from "../admin/adminUtils";

export function NewOrgDialog(props: {
  platformKey: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [slug, setSlug] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const slugOk = /^[a-z0-9][a-z0-9-]{1,30}$/.test(slug);
  const keyOk = key.length >= 4 && key.length <= 64;
  const ready = slugOk && keyOk && nameZh.trim() !== "" && nameEn.trim() !== "";

  return (
    <Modal onClose={props.onClose}>
      <DialogHead eyebrow="新建机构" title="开一间新教会" onClose={props.onClose} />
      <p className="mt-4 text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
        新机构第一次建场时会自动拿到平台内置的那套站点，开箱即用。slug 建好之后不能改。
      </p>
      <label className="mt-6 block">
        <span className="text-sm font-black">slug（地址用）</span>
        <input className={inputClass} style={inputStyle} autoFocus maxLength={31}
          placeholder="例如：gcgc" value={slug}
          onChange={(e) => setSlug(e.target.value)} />
        <span className="text-xs font-semibold" style={{ color: slug && !slugOk ? T.danger : T.inkFaint }}>
          小写字母、数字、连字符，2–31 位
        </span>
      </label>
      <label className="mt-4 block">
        <span className="text-sm font-black">中文名</span>
        <input className={inputClass} style={inputStyle} maxLength={40}
          placeholder="例如：格拉斯哥华人福音教会" value={nameZh}
          onChange={(e) => setNameZh(e.target.value)} />
      </label>
      <label className="mt-4 block">
        <span className="text-sm font-black">英文名</span>
        <input className={inputClass} style={inputStyle} maxLength={60}
          placeholder="例如：Glasgow Chinese Gospel Church" value={nameEn}
          onChange={(e) => setNameEn(e.target.value)} />
      </label>
      <label className="mt-4 block">
        <span className="text-sm font-black">初始管理口令</span>
        <input className={inputClass} style={inputStyle} maxLength={64}
          value={key} onChange={(e) => setKey(e.target.value)} />
        <span className="text-xs font-semibold" style={{ color: key && !keyOk ? T.danger : T.inkFaint }}>
          4–64 位。建好后交给这间教会，他们可以自己改。
        </span>
      </label>
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
        <Btn variant="primary" disabled={!ready || busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await rpc("platform_create_org", {
              p_platform_key: props.platformKey,
              p_slug: slug,
              p_name_zh: nameZh.trim(),
              p_name_en: nameEn.trim(),
              p_admin_key: key,
            });
            props.onDone(`已建好「${nameZh.trim()}」`);
          } catch (error) { setErr(errorText(error)); } finally { setBusy(false); }
        }}>创建机构</Btn>
      </div>
    </Modal>
  );
}

export function RenameOrgDialog(props: {
  platformKey: string;
  org: PlatformOrg;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [nameZh, setNameZh] = useState(props.org.name_zh);
  const [nameEn, setNameEn] = useState(props.org.name_en);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = nameZh.trim() !== "" && nameEn.trim() !== "";

  return (
    <Modal onClose={props.onClose}>
      <DialogHead eyebrow="改名" title={`给「${props.org.name_zh}」改名`} onClose={props.onClose} />
      <p className="mt-4 text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
        slug（<code>{props.org.slug}</code>）不受影响，只改显示名称。
      </p>
      <label className="mt-6 block">
        <span className="text-sm font-black">中文名</span>
        <input className={inputClass} style={inputStyle} autoFocus maxLength={40}
          value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
      </label>
      <label className="mt-4 block">
        <span className="text-sm font-black">英文名</span>
        <input className={inputClass} style={inputStyle} maxLength={60}
          value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </label>
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
        <Btn variant="primary" disabled={!ready || busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await rpc("platform_rename_org", {
              p_platform_key: props.platformKey,
              p_org_id: props.org.id,
              p_name_zh: nameZh.trim(),
              p_name_en: nameEn.trim(),
            });
            props.onDone(`已改名为「${nameZh.trim()}」`);
          } catch (error) { setErr(errorText(error)); } finally { setBusy(false); }
        }}>保存</Btn>
      </div>
    </Modal>
  );
}

export function ResetKeyDialog(props: {
  platformKey: string;
  org: PlatformOrg;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const keyOk = key.length >= 4 && key.length <= 64;

  return (
    <Modal onClose={props.onClose}>
      <DialogHead eyebrow="重置口令" title={`重置「${props.org.name_zh}」的管理口令`} onClose={props.onClose} />
      <div className="mt-4 rounded-xl p-4 text-sm font-bold leading-6"
        style={{ background: T.dangerSoft, border: "1px solid var(--color-admin-danger-line)", color: T.danger }}>
        重置后这间教会当前登录的管理员会立刻掉线，已经发出去的代入令牌不受影响。
      </div>
      <label className="mt-6 block">
        <span className="text-sm font-black">新管理口令</span>
        <input className={inputClass} style={inputStyle} autoFocus maxLength={64}
          value={key} onChange={(e) => setKey(e.target.value)} />
        <span className="text-xs font-semibold" style={{ color: key && !keyOk ? T.danger : T.inkFaint }}>
          4–64 位
        </span>
      </label>
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
        <Btn variant="primary" disabled={!keyOk || busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await rpc("platform_reset_key", {
              p_platform_key: props.platformKey,
              p_org_id: props.org.id,
              p_new_admin_key: key,
            });
            props.onDone(`已重置「${props.org.name_zh}」的管理口令`);
          } catch (error) { setErr(errorText(error)); } finally { setBusy(false); }
        }}>重置口令</Btn>
      </div>
    </Modal>
  );
}

export function DeleteOrgDialog(props: {
  platformKey: string;
  org: PlatformOrg;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = confirm === props.org.slug;

  return (
    <Modal onClose={props.onClose}>
      <DialogHead eyebrow="删除机构" title={`删除「${props.org.name_zh}」`} onClose={props.onClose} />
      <div className="mt-4 rounded-xl p-4 text-sm font-bold leading-6"
        style={{ background: T.dangerSoft, border: "1px solid var(--color-admin-danger-line)", color: T.danger }}>
        这会连同这间机构的 {props.org.event_count} 场活动、以及它们下面的玩家、队伍、成绩
        一起删除，<strong>不可恢复</strong>，也没有回收站。
      </div>
      <label className="mt-6 block">
        <span className="text-sm font-black">手打它的 slug 确认</span>
        <input className={inputClass} style={inputStyle} autoFocus
          placeholder={props.org.slug} value={confirm}
          onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
        <Btn variant="dangerSolid" disabled={!ready || busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await rpc("platform_delete_org", {
              p_platform_key: props.platformKey,
              p_org_id: props.org.id,
              p_confirm_slug: confirm,
            });
            props.onDone(`已删除「${props.org.name_zh}」`);
          } catch (error) { setErr(errorText(error)); } finally { setBusy(false); }
        }}>永久删除</Btn>
      </div>
    </Modal>
  );
}

/** 改某个机构的相册额度。单位 GB（1024³ 字节），0–1000。 */
export function AlbumQuotaDialog(props: {
  platformKey: string;
  org: PlatformOrg;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const used = props.org.album_used_bytes ?? 0;
  const quota = props.org.album_quota_bytes ?? 0;
  const [value, setValue] = useState(() => String(Math.round((quota / GB) * 10) / 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const gb = value.trim() === "" ? Number.NaN : Number(value);
  const valid = Number.isFinite(gb) && gb >= 0 && gb <= 1000;
  const bytes = valid ? Math.round(gb * GB) : 0;
  const belowUsage = valid && bytes < used;

  return (
    <Modal onClose={props.onClose}>
      <DialogHead eyebrow="相册额度" title={`「${props.org.name_zh}」的相册空间`} onClose={props.onClose} />
      <p className="mt-4 text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
        现在已用 {formatUsage(used, quota)}。额度只挡新的上传，调低不会删掉已经传上去的照片。
      </p>
      <label className="mt-6 block">
        <span className="text-sm font-black">额度（GB）</span>
        <input className={inputClass} style={inputStyle} autoFocus inputMode="decimal"
          value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} />
        <span className="text-xs font-semibold" style={{ color: value && !valid ? T.danger : belowUsage ? T.warn : T.inkFaint }}>
          {value && !valid
            ? "要在 0–1000 之间"
            : belowUsage
              ? `比已用的 ${formatBytes(used)} 还少，这间机构暂时传不了新照片`
              : "0–1000，可以有一位小数"}
        </span>
      </label>
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
        <Btn variant="primary" disabled={!valid || busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await rpc("platform_set_album_quota", {
              p_platform_key: props.platformKey,
              p_org_id: props.org.id,
              p_quota_bytes: bytes,
            });
            props.onDone(`「${props.org.name_zh}」的相册额度改成了 ${formatBytes(bytes)}`);
          } catch (error) { setErr(errorText(error)); } finally { setBusy(false); }
        }}>保存</Btn>
      </div>
    </Modal>
  );
}
