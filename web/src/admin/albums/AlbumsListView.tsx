import { useEffect, useMemo, useState } from "react";
import { errorText } from "../../lib/api";
import { usePoll } from "../../lib/usePoll";
import { ErrorBanner } from "../../lib/ui";
import type { AdminEventSummary } from "../../lib/types";
import { AdminIcon, Btn, DialogHead, EmptyState, Field, Modal, PageTitle, Panel } from "../adminUi";
import { T, inputClass, inputStyle } from "../adminTokens";
import { formatBytes, formatDate, formatUsage } from "../adminUtils";
import { createAlbum, fetchAlbums, peekUrl, viewUrl } from "./albumApi";
import type { AlbumSummary, AlbumsData } from "./albumTypes";

/*
 * 机构层的相册列表。相册属于机构，可以挂在某一场活动下面，也可以不挂
 * （比如「同工退修会」这种不在系统里建场次的活动）。
 */
export function AlbumsListView({
  adminKey,
  events,
  preview,
  onOpen,
}: {
  adminKey: string;
  events: AdminEventSummary[];
  preview?: boolean;
  onOpen: (albumId: string) => void;
}) {
  const pollFn = useMemo(() => () => fetchAlbums(adminKey), [adminKey]);
  const poll = usePoll<AlbumsData>(preview ? null : pollFn, 30_000);
  const [creating, setCreating] = useState(false);
  const data = poll.data;

  const title = (
    <PageTitle
      eyebrow="ALBUMS"
      title="活动相册"
      description="机构内部用：上传原片，点爱心挑片，把原片下载给剪辑同工。"
      actions={
        preview ? undefined : (
          <Btn variant="primary" icon="plus" onClick={() => setCreating(true)}>新建相册</Btn>
        )
      }
    />
  );

  if (preview) {
    return (
      <div>
        {title}
        <Panel className="mx-auto w-full max-w-lg">
          <EmptyState
            title="演示模式不连相册"
            detail="真实后台里，这里可以按活动建相册，把整个文件夹拖进来上传原片，点爱心挑出好照片，再一次下载到剪辑同工的电脑里。"
          />
        </Panel>
      </div>
    );
  }

  return (
    <div>
      {title}

      {!data ? (
        <Panel className="p-10 text-center">
          {poll.error ? (
            <>
              <h2 className="text-lg font-black">相册读取失败</h2>
              <p className="mt-2 text-sm font-semibold" style={{ color: T.inkSoft }}>{errorText(poll.error)}</p>
              <div className="mt-4"><Btn variant="primary" onClick={poll.refresh}>重试</Btn></div>
            </>
          ) : (
            <div className="dots text-sm font-black" style={{ color: T.inkSoft }}>
              正在读取相册<span>.</span><span>.</span><span>.</span>
            </div>
          )}
        </Panel>
      ) : (
        <>
          <QuotaBar used={data.used_bytes} quota={data.quota_bytes} />

          {data.albums.length === 0 ? (
            <Panel className="mt-5">
              <EmptyState
                title="还没有相册"
                detail="建一本相册，把活动当天的照片和视频整个文件夹拖进去就行。"
                action={<Btn variant="primary" icon="plus" onClick={() => setCreating(true)}>新建相册</Btn>}
              />
            </Panel>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {data.albums.map((album) => (
                <AlbumCard key={album.id} adminKey={adminKey} album={album} onOpen={() => onOpen(album.id)} />
              ))}
            </div>
          )}
        </>
      )}

      {creating && (
        <NewAlbumDialog
          adminKey={adminKey}
          events={events}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); onOpen(id); }}
        />
      )}
    </div>
  );
}

export function QuotaBar({ used, quota }: { used: number; quota: number }) {
  const ratio = quota > 0 ? used / quota : used > 0 ? 1 : 0;
  const full = ratio >= 1;
  const warn = ratio > 0.8;
  const tone = full ? T.danger : warn ? T.warn : T.ink;
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-black">相册空间</span>
        <span className="tabular text-sm font-black" style={{ color: tone }}>已用 {formatUsage(used, quota)}</span>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full"
        style={{ background: "var(--color-admin-neutral)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(1, ratio) * 100)}
        aria-label="相册空间用量"
      >
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: tone }} />
      </div>
      {warn && (
        <p className="mt-2 text-xs font-semibold" style={{ color: tone }}>
          {full ? "空间满了，传不进新照片。" : "空间快满了。"}删掉不要的原片，或请平台管理员加额度。
        </p>
      )}
    </Panel>
  );
}

function AlbumCard({ adminKey, album, onOpen }: { adminKey: string; album: AlbumSummary; onOpen: () => void }) {
  const coverId = album.cover_photo_id;
  const [fetched, setFetched] = useState<{ id: string; url: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!coverId || peekUrl("thumb", coverId)) return;
    let alive = true;
    viewUrl(adminKey, coverId, "thumb").then((url) => { if (alive) setFetched({ id: coverId, url }); });
    return () => { alive = false; };
  }, [adminKey, coverId]);

  const coverUrl = coverId ? peekUrl("thumb", coverId) ?? (fetched?.id === coverId ? fetched.url : null) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="pressable group min-w-0 overflow-hidden rounded-[18px] text-left"
      style={{ background: T.panel, border: `1px solid ${T.line}` }}
    >
      <div className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden" style={{ background: T.panelAlt }}>
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-150"
            style={{ opacity: loaded ? 1 : 0 }}
          />
        ) : (
          <AdminIcon name="albums" className="h-10 w-10" />
        )}
      </div>
      <div className="p-4">
        <div className="truncate text-base font-black">{album.title}</div>
        <div className="tabular mt-1 text-xs font-bold" style={{ color: T.inkSoft }}>
          {album.photo_count} 张 · {formatBytes(album.total_bytes)}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold" style={{ color: T.inkFaint }}>
          <span className="min-w-0 truncate">{album.event_title ?? "未关联活动"}</span>
          <span className="tabular shrink-0">{formatDate(album.created_at)}</span>
        </div>
      </div>
    </button>
  );
}

function NewAlbumDialog({
  adminKey,
  events,
  onClose,
  onCreated,
}: {
  adminKey: string;
  events: AdminEventSummary[];
  onClose: () => void;
  onCreated: (albumId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trimmed = title.trim();

  return (
    <Modal onClose={onClose}>
      <DialogHead eyebrow="新建相册" title="建一本活动相册" onClose={onClose} />
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!trimmed || busy) return;
          setBusy(true);
          setErr(null);
          try {
            const created = await createAlbum(adminKey, trimmed, eventId || null);
            onCreated(created.id);
          } catch (error) {
            setErr(errorText(error));
            setBusy(false);
          }
        }}
      >
        <div className="mt-6 space-y-4">
          <Field label="关联活动" hint="可以不选。关联后相册卡片上会显示活动名。">
            <select
              className={inputClass}
              style={inputStyle}
              value={eventId}
              onChange={(event) => {
                const next = event.target.value;
                setEventId(next);
                // 还没起名时，顺手用活动名当相册名。
                const picked = events.find((item) => item.event_id === next);
                if (picked && !trimmed) setTitle(picked.title.slice(0, 60));
              }}
            >
              <option value="">不关联</option>
              {events.map((item) => (
                <option key={item.event_id} value={item.event_id}>{item.title}</option>
              ))}
            </select>
          </Field>
          <Field label="相册名称" hint="1~60 个字，之后可以改。">
            <input
              autoFocus
              className={inputClass}
              style={inputStyle}
              maxLength={60}
              placeholder="例如：2026 中秋园游会"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
        </div>
        <div className="mt-4"><ErrorBanner text={err} /></div>
        <div className="mt-6 flex justify-end gap-2">
          <Btn variant="quiet" onClick={onClose}>取消</Btn>
          <Btn variant="primary" type="submit" disabled={!trimmed || busy}>建好了，去上传</Btn>
        </div>
      </form>
    </Modal>
  );
}
