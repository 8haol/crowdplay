import { useState } from "react";
import { errorText } from "../../lib/api";
import { ErrorBanner } from "../../lib/ui";
import { Btn, DialogHead, Field, Modal } from "../adminUi";
import { T, inputClass, inputStyle } from "../adminTokens";
import { formatBytes } from "../adminUtils";
import { deleteAlbum, deletePhotos, renameAlbum, usesProxy } from "./albumApi";
import type { AlbumPhoto, DownloadQuality } from "./albumTypes";
import { forgetThumbs } from "./thumbCache";

/* 相册详情页的对话框：改名、删整本相册、删所选照片、下载时选画质。写法照 AdminDialogs.tsx。 */

const dangerBox = { background: T.dangerSoft, border: "1px solid var(--color-admin-danger-line)", color: T.danger };

export function RenameAlbumDialog(props: {
  adminKey: string;
  album: { id: string; title: string };
  onClose: () => void;
  onDone: (title: string) => void;
}) {
  const [title, setTitle] = useState(props.album.title);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trimmed = title.trim();

  return (
    <Modal onClose={props.onClose}>
      <DialogHead eyebrow="改名" title="给相册改个名字" onClose={props.onClose} />
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!trimmed || busy) return;
          setBusy(true);
          setErr(null);
          try {
            const result = await renameAlbum(props.adminKey, props.album.id, trimmed);
            props.onDone(result.title ?? trimmed);
          } catch (error) {
            setErr(errorText(error));
            setBusy(false);
          }
        }}
      >
        <div className="mt-6">
          <Field label="相册名称" hint="1~60 个字">
            <input
              autoFocus
              className={inputClass}
              style={inputStyle}
              maxLength={60}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
        </div>
        <div className="mt-4"><ErrorBanner text={err} /></div>
        <div className="mt-6 flex justify-end gap-2">
          <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
          <Btn variant="primary" type="submit" disabled={!trimmed || busy || trimmed === props.album.title}>保存</Btn>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteAlbumDialog(props: {
  adminKey: string;
  album: { id: string; title: string };
  photoCount: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = confirm.trim() === props.album.title;

  return (
    <Modal onClose={busy ? () => undefined : props.onClose}>
      <DialogHead eyebrow="删除相册" title={`删除「${props.album.title}」`} onClose={busy ? () => undefined : props.onClose} />
      <div className="mt-4 rounded-xl p-4 text-sm font-bold leading-6" style={dangerBox}>
        {props.photoCount > 0
          ? `相册里的 ${props.photoCount} 个原片、缩略图和爱心会一起删掉，不可恢复，也没有回收站。还没下载的原片请先下载。`
          : "这本相册是空的，删掉不会丢任何照片。"}
      </div>
      <label className="mt-6 block">
        <span className="text-sm font-black">手打相册名称确认</span>
        <input
          className={inputClass}
          style={inputStyle}
          autoFocus
          placeholder={props.album.title}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </label>
      {busy && (
        <p className="mt-3 text-xs font-semibold" style={{ color: T.inkSoft }}>
          正在删除，照片多的话要一会儿，别关这个页面。
        </p>
      )}
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" disabled={busy} onClick={props.onClose}>取消</Btn>
        <Btn
          variant="dangerSolid"
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await deleteAlbum(props.adminKey, props.album.id);
              props.onDeleted();
            } catch (error) {
              setErr(errorText(error));
              setBusy(false);
            }
          }}
        >
          永久删除
        </Btn>
      </div>
    </Modal>
  );
}

export function DeletePhotosDialog(props: {
  adminKey: string;
  photoIds: string[];
  onClose: () => void;
  onDeleted: (count: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const count = props.photoIds.length;

  return (
    <Modal onClose={busy ? () => undefined : props.onClose}>
      <DialogHead eyebrow="删除照片" title={`删除所选的 ${count} 个文件？`} onClose={busy ? () => undefined : props.onClose} />
      <div className="mt-4 rounded-xl p-4 text-sm font-bold leading-6" style={dangerBox}>
        原片、缩略图和爱心会一起删掉，不可恢复，也没有回收站。
      </div>
      <div className="mt-4"><ErrorBanner text={err} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" disabled={busy} onClick={props.onClose}>取消</Btn>
        <Btn
          variant="dangerSolid"
          disabled={busy || count === 0}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await deletePhotos(props.adminKey, props.photoIds);
              forgetThumbs(props.photoIds);
              props.onDeleted(count);
            } catch (error) {
              setErr(errorText(error));
              setBusy(false);
            }
          }}
        >
          {busy ? "正在删除…" : `删除 ${count} 个`}
        </Btn>
      </div>
    </Modal>
  );
}

/**
 * 要下载的里面有带低画质版的视频：问一句要哪个版本。照片、没有低画质版的视频不受影响，照样是原片。
 * 两个按钮本身就是用户手势，点了直接开始（选文件夹、弹系统面板都要手势）。
 */
export function DownloadQualityDialog(props: {
  photos: AlbumPhoto[];
  /** iPhone / iPad 上是「存到相册」。 */
  savingToPhotos: boolean;
  onClose: () => void;
  onPick: (quality: DownloadQuality) => void;
}) {
  const videos = props.photos.filter((photo) => usesProxy(photo, "proxy"));
  const videoBytes = videos.reduce((sum, photo) => sum + photo.size_bytes, 0);
  const others = props.photos.length - videos.length;
  const verb = props.savingToPhotos ? "存" : "下载";
  const option = "flex w-full flex-col items-start gap-1 rounded-xl px-4 py-3 text-left transition-colors hover:brightness-[0.98]";

  return (
    <Modal onClose={props.onClose} width="max-w-md">
      <DialogHead eyebrow={props.savingToPhotos ? "存到相册" : "下载"} title="视频要哪个版本？" onClose={props.onClose} />
      <p className="mt-3 text-sm font-semibold leading-6" style={{ color: T.inkSoft }}>
        {others > 0
          ? `这 ${props.photos.length} 个文件里，${videos.length} 个视频有低画质版；其余 ${others} 个照原片${verb}。`
          : `这 ${videos.length} 个视频都有低画质版。`}
      </p>
      <div className="mt-5 space-y-2">
        <button type="button" className={option} style={{ background: T.ink, color: T.panel }} onClick={() => props.onPick("original")}>
          <span className="text-sm font-black">原画质</span>
          <span className="text-xs font-semibold opacity-80">视频原片，共 {formatBytes(videoBytes)}，适合剪辑、存档</span>
        </button>
        <button type="button" className={option} style={{ background: T.panelAlt, color: T.ink, border: `1px solid ${T.line}` }} onClick={() => props.onPick("proxy")}>
          <span className="text-sm font-black">低画质 720p</span>
          <span className="text-xs font-semibold" style={{ color: T.inkSoft }}>大约只有原片的十分之一，适合发群、手机上看</span>
        </button>
      </div>
      <div className="mt-5 flex justify-end">
        <Btn variant="quiet" onClick={props.onClose}>取消</Btn>
      </div>
    </Modal>
  );
}
