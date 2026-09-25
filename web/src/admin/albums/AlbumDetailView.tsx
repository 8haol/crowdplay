import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RpcError, errorText } from "../../lib/api";
import { ErrorBanner, SuccessBanner } from "../../lib/ui";
import { AdminIcon, Btn, EmptyState, PageTitle, Panel, Segmented } from "../adminUi";
import { T } from "../adminTokens";
import { formatBytes } from "../adminUtils";
import { fetchAlbumPhotos, fetchAlbums, peekUrl, photoUrl, togglePhotoLike, viewUrl } from "./albumApi";
import { isVideo, type AlbumPhoto, type AlbumPhotosData, type ViewKind } from "./albumTypes";
import { DeleteAlbumDialog, DeletePhotosDialog, RenameAlbumDialog } from "./AlbumDialogs";
import {
  canSaveToFolder,
  downloadOneByOne,
  downloadPhoto,
  downloadToFolder,
  pickFolder,
  type DirHandleLike,
  type FolderProgress,
} from "./downloadAll";
import { Lightbox } from "./Lightbox";
import {
  filesFromEntries,
  holdUnload,
  screenFiles,
  uploadQueueFor,
  type UploadItemView,
  type UploadQueue,
  type UploadSnapshot,
} from "./uploadQueue";

/*
 * 一本相册：上传、网格、挑片、下载、删除。灯箱在 Lightbox.tsx。
 *
 * 打开的照片写在 URL 的 ?p=<id> 里：能把链接直接发给另一位同工，
 * 浏览器的返回键也能关掉灯箱（打开时 push 一条历史，关的时候 back）。
 */

type Sort = "taken" | "likes";
type Notice = { tone: "ok" | "error"; text: string } | null;

const SHADOW = "shadow-[0_18px_60px_rgb(from_var(--color-admin-shadow)_r_g_b_/_.2)]";
const PILL = { background: "rgb(from var(--color-admin-overlay) r g b / .58)", color: "var(--color-card)" };

export function AlbumDetailView({
  adminKey,
  albumId,
  onBack,
  onDone,
}: {
  adminKey: string;
  albumId: string;
  onBack: () => void;
  /** 相册被删掉之后：回列表并报一句。 */
  onDone: (message: string) => void;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<AlbumPhotosData | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [sort, setSort] = useState<Sort>("taken");
  // 「最多爱心」按上次读取时的票数排；在网格或灯箱里点爱心不会让照片在手指下面跳走。
  const [rank, setRank] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = useState<"rename" | "delete-album" | "delete-photos" | null>(null);
  const [dragging, setDragging] = useState(false);
  const [download, setDownload] = useState<FolderProgress | null>(null);
  const [sendingOneByOne, setSendingOneByOne] = useState(false);
  const downloadCtrl = useRef<AbortController | null>(null);
  const lastDir = useRef<DirHandleLike | null>(null);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const likeBusy = useRef(new Set<string>());
  const openedHere = useRef(false);
  const alive = useRef(true);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canFolder = useMemo(() => canSaveToFolder(), []);

  const queue = useMemo(() => uploadQueueFor(adminKey, albumId), [adminKey, albumId]);
  const uploads = useSyncExternalStore(queue.subscribe, queue.getSnapshot);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      downloadCtrl.current?.abort();
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = null;
    };
  }, []);

  // React 的 JSX 类型里没有 webkitdirectory，只能拿到元素再设。用 ref 回调而不是挂载时的 effect：
  // 挂载那一刻相册还在加载、这个 input 还没渲染，effect 设不上，「选择文件夹」就退化成了普通多选。
  const setFolderInput = useCallback((node: HTMLInputElement | null) => {
    if (node) node.webkitdirectory = true;
    folderInput.current = node;
  }, []);

  const load = useCallback(() => {
    fetchAlbumPhotos(adminKey, albumId).then(
      (result) => {
        if (!alive.current) return;
        setData(result);
        setLoadError(null);
        setRank(new Map(result.photos.map((photo) => [photo.id, photo.like_count])));
      },
      (error) => { if (alive.current) setLoadError(error); },
    );
  }, [adminKey, albumId]);

  useEffect(() => { load(); }, [load]);

  // 传完一张就要重新拉列表；连着传完很多张时合并成 1.2 秒一次。
  useEffect(() => {
    if (uploads.completedVersion === 0 || reloadTimer.current) return;
    reloadTimer.current = setTimeout(() => { reloadTimer.current = null; load(); }, 1200);
  }, [uploads.completedVersion, load]);

  const photos = useMemo(() => data?.photos ?? [], [data]);
  const sorted = useMemo(() => {
    if (sort === "taken") return photos;
    const order = new Map(photos.map((photo, index) => [photo.id, index]));
    const votes = (photo: AlbumPhoto) => rank.get(photo.id) ?? photo.like_count;
    return [...photos].sort((a, b) => votes(b) - votes(a) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [photos, sort, rank]);
  const totalBytes = useMemo(() => photos.reduce((sum, photo) => sum + photo.size_bytes, 0), [photos]);

  /* ------------------------------------------------------------ 灯箱 */

  const openId = searchParams.get("p");
  const lightboxIndex = openId ? sorted.findIndex((photo) => photo.id === openId) : -1;

  useEffect(() => {
    // 用户按了浏览器返回键：URL 里已经没有 p 了，下次关灯箱不能再 back 一次。
    if (!openId) openedHere.current = false;
  }, [openId]);

  const setPhotoParam = useCallback((id: string | null, replace: boolean) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("p", id);
      else next.delete("p");
      return next;
    }, { replace });
  }, [setSearchParams]);

  const openPhoto = useCallback((photo: AlbumPhoto) => {
    openedHere.current = true;
    setPhotoParam(photo.id, false);
  }, [setPhotoParam]);

  const closeLightbox = useCallback(() => {
    if (openedHere.current) {
      openedHere.current = false;
      navigate(-1);
    } else {
      setPhotoParam(null, true);
    }
  }, [navigate, setPhotoParam]);

  const changeIndex = useCallback((index: number) => {
    const photo = sorted[index];
    if (photo) setPhotoParam(photo.id, true);
  }, [sorted, setPhotoParam]);

  const getUrl = useCallback((photo: AlbumPhoto, kind: ViewKind) => photoUrl(adminKey, photo, kind), [adminKey]);
  const cachedThumb = useCallback((photo: AlbumPhoto) => (photo.has_thumb ? peekUrl("thumb", photo.id) : null), []);

  /* ------------------------------------------------------------ 爱心 */

  const patchPhoto = useCallback((id: string, patch: Partial<AlbumPhoto>) => {
    setData((current) => current && {
      ...current,
      photos: current.photos.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)),
    });
  }, []);

  const toggleLike = useCallback((photo: AlbumPhoto) => {
    if (likeBusy.current.has(photo.id)) return;
    likeBusy.current.add(photo.id);
    const before = { liked_by_me: photo.liked_by_me, like_count: photo.like_count };
    patchPhoto(photo.id, {
      liked_by_me: !before.liked_by_me,
      like_count: Math.max(0, before.like_count + (before.liked_by_me ? -1 : 1)),
    });
    togglePhotoLike(adminKey, photo.id, !before.liked_by_me)
      .then(
        (result) => patchPhoto(photo.id, { liked_by_me: result.liked, like_count: result.like_count }),
        (error) => {
          patchPhoto(photo.id, before);
          if (alive.current) setNotice({ tone: "error", text: errorText(error) });
        },
      )
      .finally(() => likeBusy.current.delete(photo.id));
  }, [adminKey, patchPhoto]);

  /* ------------------------------------------------------------ 多选 */

  const toggleSelect = useCallback((photo: AlbumPhoto) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(photo.id)) next.delete(photo.id);
      else next.add(photo.id);
      return next;
    });
  }, []);

  const startSelecting = useCallback((photo: AlbumPhoto) => {
    setSelecting(true);
    setSelected((current) => new Set(current).add(photo.id));
  }, []);

  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const selectedPhotos = useMemo(() => sorted.filter((photo) => selected.has(photo.id)), [sorted, selected]);
  const allSelected = sorted.length > 0 && selectedPhotos.length === sorted.length;

  /* ------------------------------------------------------------ 上传 */

  const addFiles = async (files: File[]) => {
    const screened = screenFiles(files);
    const skipped: string[] = [];
    if (screened.unsupported) skipped.push(`${screened.unsupported} 个不是照片或视频`);
    if (screened.tooLarge) skipped.push(`${screened.tooLarge} 个超过 5GB`);
    if (screened.accepted.length === 0) {
      setNotice({ tone: "error", text: skipped.length ? `没有可以上传的文件：${skipped.join("，")}` : "没有可以上传的照片或视频" });
      return;
    }
    const bytes = screened.accepted.reduce((sum, item) => sum + item.file.size, 0);
    try {
      const usage = await fetchAlbums(adminKey);
      const remaining = Math.max(0, usage.quota_bytes - usage.used_bytes - queue.unreservedBytes());
      if (bytes > remaining) {
        setNotice({
          tone: "error",
          text: `空间不够：这批共 ${formatBytes(bytes)}，相册只剩 ${formatBytes(remaining)}。删掉一些原片，或请平台管理员加额度。`,
        });
        return;
      }
    } catch {
      // 查不到额度就先传，服务端登记时还会再把关一次。
    }
    queue.add(screened.accepted);
    setNotice(
      skipped.length
        ? { tone: "ok", text: `已加入 ${screened.accepted.length} 个文件，跳过 ${skipped.join("，")}` }
        : null,
    );
  };

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

  const dropHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      // items 只在这个事件里有效：先同步把入口全拿出来，再慢慢展开文件夹。
      const entries: FileSystemEntry[] = [];
      const loose: File[] = [];
      for (const item of Array.from(event.dataTransfer.items)) {
        if (item.kind !== "file") continue;
        const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
        if (entry) entries.push(entry);
        else {
          const file = item.getAsFile();
          if (file) loose.push(file);
        }
      }
      if (entries.length === 0 && loose.length === 0) loose.push(...Array.from(event.dataTransfer.files));
      void filesFromEntries(entries).then((found) => addFiles([...loose, ...found]));
    },
  };

  /* ------------------------------------------------------------ 下载 */

  const startFolderDownload = async (list: AlbumPhoto[], reuseFolder = false) => {
    if (downloadCtrl.current || list.length === 0) return;
    let dir = reuseFolder ? lastDir.current : null;
    if (!dir) {
      try {
        dir = await pickFolder();
      } catch {
        setNotice({ tone: "error", text: "没能打开这个文件夹，换一个试试" });
        return;
      }
      if (!dir) return;
    }
    lastDir.current = dir;
    const ctrl = new AbortController();
    downloadCtrl.current = ctrl;
    holdUnload(ctrl, true);
    try {
      await downloadToFolder({
        adminKey,
        dir,
        photos: list,
        signal: ctrl.signal,
        onProgress: (progress) => { if (alive.current) setDownload(progress); },
      });
    } finally {
      holdUnload(ctrl, false);
      downloadCtrl.current = null;
    }
  };

  const downloadSelected = async () => {
    if (canFolder) {
      await startFolderDownload(selectedPhotos);
      return;
    }
    setSendingOneByOne(true);
    try {
      await downloadOneByOne(adminKey, selectedPhotos);
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error) });
    } finally {
      if (alive.current) setSendingOneByOne(false);
    }
  };

  const downloadSingle = useCallback((photo: AlbumPhoto) => {
    downloadPhoto(adminKey, photo).catch((error) => {
      if (alive.current) setNotice({ tone: "error", text: errorText(error) });
    });
  }, [adminKey]);

  /* ------------------------------------------------------------ 渲染 */

  if (!data) {
    const notFound = loadError instanceof RpcError && loadError.code === "ALBUM_NOT_FOUND";
    return (
      <div>
        <PageTitle eyebrow="ALBUM" title="活动相册" onBack={{ label: "全部相册", onClick: onBack }} />
        <Panel className="p-10 text-center">
          {loadError ? (
            <>
              <h2 className="text-lg font-black">{notFound ? "找不到这本相册" : "相册读取失败"}</h2>
              <p className="mt-2 text-sm font-semibold" style={{ color: T.inkSoft }}>
                {notFound ? "它可能已经被删除了。" : errorText(loadError)}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                {!notFound && <Btn variant="primary" onClick={load}>重试</Btn>}
                <Btn variant={notFound ? "primary" : "quiet"} onClick={onBack}>回到全部相册</Btn>
              </div>
            </>
          ) : (
            <div className="dots text-sm font-black" style={{ color: T.inkSoft }}>
              正在读取照片<span>.</span><span>.</span><span>.</span>
            </div>
          )}
        </Panel>
      </div>
    );
  }

  const album = data.album;
  const floating = uploads.items.length > 0 || download !== null;
  const downloading = Boolean(download?.running);

  return (
    <div {...dropHandlers} className={floating ? "pb-48" : ""}>
      <PageTitle
        eyebrow="ALBUM"
        title={album.title}
        description={[album.event_title, `${photos.length} 张`, formatBytes(totalBytes)].filter(Boolean).join(" · ")}
        onBack={{ label: "全部相册", onClick: onBack }}
        actions={
          <>
            {canFolder && photos.length > 0 && (
              <Btn icon="download" disabled={downloading} onClick={() => void startFolderDownload(sorted)}>
                全部下载到文件夹
              </Btn>
            )}
            <Btn variant="quiet" onClick={() => setDialog("rename")}>改名</Btn>
            <Btn variant="danger" disabled={uploads.active > 0} onClick={() => setDialog("delete-album")}>删除相册</Btn>
          </>
        }
      />

      {notice && (
        <div className="mb-4">
          {notice.tone === "error" ? <ErrorBanner text={notice.text} /> : <SuccessBanner text={notice.text} />}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void addFiles(files);
        }}
      />
      <input
        ref={setFolderInput}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void addFiles(files);
        }}
      />

      <Panel className="p-3 sm:p-4">
        <div
          className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors sm:flex-row sm:text-left"
          style={{
            borderColor: dragging ? T.ink : "var(--color-admin-line-strong)",
            background: dragging ? T.accentSoft : T.panelAlt,
          }}
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: T.panel, color: T.ink }}>
            <AdminIcon name="upload" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black">
              <span className="hidden sm:inline">{dragging ? "松手就开始上传" : "把照片、视频或整个文件夹拖到这里"}</span>
              <span className="sm:hidden">上传照片和视频</span>
            </div>
            <div className="mt-0.5 text-xs font-semibold" style={{ color: T.inkSoft }}>
              原片原样保存，单个不超过 5GB；同时传 4 个，失败的可以单独重试。
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-center gap-2">
            <Btn variant="primary" icon="plus" onClick={() => fileInput.current?.click()}>选择文件</Btn>
            <Btn className="max-sm:hidden" onClick={() => folderInput.current?.click()}>选择文件夹</Btn>
          </div>
        </div>
      </Panel>

      {photos.length === 0 ? (
        <Panel className="mt-5">
          <EmptyState title="还没有照片" detail="传完的照片会出现在这里。点爱心挑片，剪辑同工按「最多爱心」一看就知道用哪些。" />
        </Panel>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Segmented<Sort>
              value={sort}
              options={[{ id: "taken", label: "拍摄时间" }, { id: "likes", label: "最多爱心" }]}
              onChange={(next) => {
                setRank(new Map(photos.map((photo) => [photo.id, photo.like_count])));
                setSort(next);
              }}
            />
            {!selecting && <Btn icon="check" onClick={() => setSelecting(true)}>多选</Btn>}
          </div>

          {selecting && (
            <div
              className="sticky top-[62px] z-20 -mx-4 mt-3 flex flex-wrap items-center gap-2 px-4 py-2.5 sm:mx-0 sm:rounded-xl sm:px-3"
              style={{ background: "rgb(from var(--color-admin-bg) r g b / .96)", border: `1px solid ${T.line}` }}
            >
              <span className="tabular text-sm font-black">已选 {selectedPhotos.length} 个</span>
              <div className="ml-auto flex flex-wrap justify-end gap-1.5">
                <Btn variant="quiet" className="!px-3" onClick={() => setSelected(allSelected ? new Set() : new Set(sorted.map((p) => p.id)))}>
                  {allSelected ? "全不选" : "全选"}
                </Btn>
                <Btn
                  icon="download"
                  className="!px-3"
                  disabled={selectedPhotos.length === 0 || downloading || sendingOneByOne}
                  onClick={() => void downloadSelected()}
                >
                  下载
                </Btn>
                <Btn variant="danger" className="!px-3" disabled={selectedPhotos.length === 0} onClick={() => setDialog("delete-photos")}>
                  删除
                </Btn>
                <Btn variant="primary" className="!px-3" onClick={exitSelecting}>完成</Btn>
              </div>
            </div>
          )}

          <div className="mt-3 grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2 md:grid-cols-5 xl:grid-cols-6">
            {sorted.map((photo) => (
              <PhotoTile
                key={photo.id}
                adminKey={adminKey}
                photo={photo}
                selecting={selecting}
                selected={selected.has(photo.id)}
                onOpen={openPhoto}
                onSelect={toggleSelect}
                onLongPress={startSelecting}
                onLike={toggleLike}
              />
            ))}
          </div>
        </>
      )}

      {floating && (
        <div className="fixed inset-x-3 bottom-3 z-30 flex flex-col gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[23rem]">
          {download && (
            <DownloadPanel
              progress={download}
              onCancel={() => downloadCtrl.current?.abort()}
              onClose={() => setDownload(null)}
              onRetry={() => {
                const failedIds = new Set(download.failed.map((item) => item.id));
                void startFolderDownload(photos.filter((photo) => failedIds.has(photo.id)), true);
              }}
            />
          )}
          <UploadPanel snapshot={uploads} queue={queue} />
        </div>
      )}

      {lightboxIndex >= 0 && (
        <Lightbox
          photos={sorted}
          index={lightboxIndex}
          onIndexChange={changeIndex}
          onClose={closeLightbox}
          getUrl={getUrl}
          cachedThumb={cachedThumb}
          onToggleLike={toggleLike}
          onDownload={downloadSingle}
        />
      )}

      {dialog === "rename" && (
        <RenameAlbumDialog
          adminKey={adminKey}
          album={album}
          onClose={() => setDialog(null)}
          onDone={(title) => {
            setDialog(null);
            setData((current) => current && { ...current, album: { ...current.album, title } });
            setNotice({ tone: "ok", text: `已改名为「${title}」` });
          }}
        />
      )}
      {dialog === "delete-album" && (
        <DeleteAlbumDialog
          adminKey={adminKey}
          album={album}
          photoCount={photos.length}
          onClose={() => setDialog(null)}
          onDeleted={() => onDone(`已删除相册「${album.title}」`)}
        />
      )}
      {dialog === "delete-photos" && (
        <DeletePhotosDialog
          adminKey={adminKey}
          photoIds={selectedPhotos.map((photo) => photo.id)}
          onClose={() => setDialog(null)}
          onDeleted={(count) => {
            const gone = new Set(selectedPhotos.map((photo) => photo.id));
            setDialog(null);
            setData((current) => current && { ...current, photos: current.photos.filter((photo) => !gone.has(photo.id)) });
            exitSelecting();
            setNotice({ tone: "ok", text: `已删除 ${count} 个文件` });
            load();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 网格 */

/*
 * 整个网格共用一个 IntersectionObserver：几千格各开一个太浪费。
 * 提前 600px 开始要 URL，滚到时图多半已经在路上了。
 */
const watchers = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;

function watch(element: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    queueMicrotask(onVisible);
    return () => undefined;
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = watchers.get(entry.target);
        if (!callback) continue;
        watchers.delete(entry.target);
        observer?.unobserve(entry.target);
        callback();
      }
    },
    { rootMargin: "600px 0px" },
  );
  watchers.set(element, onVisible);
  observer.observe(element);
  return () => {
    watchers.delete(element);
    observer?.unobserve(element);
  };
}

function useSeen(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    return watch(element, () => setSeen(true));
  }, [ref, seen]);
  return seen;
}

const LONG_PRESS_MS = 480;

const PhotoTile = memo(function PhotoTile({
  adminKey,
  photo,
  selecting,
  selected,
  onOpen,
  onSelect,
  onLongPress,
  onLike,
}: {
  adminKey: string;
  photo: AlbumPhoto;
  selecting: boolean;
  selected: boolean;
  onOpen: (photo: AlbumPhoto) => void;
  onSelect: (photo: AlbumPhoto) => void;
  onLongPress: (photo: AlbumPhoto) => void;
  onLike: (photo: AlbumPhoto) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  const [fetched, setFetched] = useState<{ id: string; url: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const photoId = photo.id;
  const hasThumb = photo.has_thumb;

  useEffect(() => {
    if (!seen || !hasThumb || peekUrl("thumb", photoId)) return;
    let alive = true;
    viewUrl(adminKey, photoId, "thumb").then((url) => { if (alive) setFetched({ id: photoId, url }); });
    return () => { alive = false; };
  }, [seen, hasThumb, photoId, adminKey]);

  const url = hasThumb ? peekUrl("thumb", photoId) ?? (fetched?.id === photoId ? fetched.url : null) : null;
  const video = isVideo(photo);
  const showImage = Boolean(url) && !broken;
  const waiting = hasThumb && !broken && (!url || !loaded) && !(fetched?.id === photoId && fetched.url === null);

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    longPressed.current = false;
    cancelPress();
    press.current = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        press.current = null;
        longPressed.current = true;
        onLongPress(photo);
      }, LONG_PRESS_MS),
    };
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const start = press.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancelPress();
  };

  return (
    <div
      ref={ref}
      className="relative aspect-square min-w-0 overflow-hidden rounded-md sm:rounded-lg"
      style={{ background: T.panelAlt }}
    >
      <button
        type="button"
        aria-label={photo.filename}
        aria-pressed={selecting ? selected : undefined}
        className="absolute inset-0 h-full w-full select-none"
        style={{ WebkitTouchCallout: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(event) => { if (longPressed.current || press.current) event.preventDefault(); }}
        onClick={() => {
          if (longPressed.current) { longPressed.current = false; return; }
          if (selecting) onSelect(photo);
          else onOpen(photo);
        }}
      >
        {showImage && url ? (
          <img
            src={url}
            alt=""
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setBroken(true)}
            className="pointer-events-none h-full w-full object-cover transition-opacity duration-150 motion-reduce:transition-none"
            style={{ opacity: loaded ? 1 : 0 }}
          />
        ) : waiting ? (
          <span className="block h-full w-full animate-pulse bg-admin-skeleton" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2" style={{ color: T.inkFaint }}>
            <AdminIcon name={video ? "video" : "image"} className="h-6 w-6 shrink-0" />
            <span className="line-clamp-2 w-full break-all text-center text-[10px] font-bold leading-tight" style={{ color: T.inkSoft }}>
              {photo.filename}
            </span>
          </span>
        )}
      </button>

      {video && showImage && (
        <span className="pointer-events-none absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full sm:right-1.5 sm:top-1.5" style={PILL}>
          <AdminIcon name="video" className="h-3 w-3" />
        </span>
      )}

      {selecting && (
        <>
          <span
            className="pointer-events-none absolute inset-0 transition-shadow duration-150"
            style={{ boxShadow: selected ? "inset 0 0 0 3px var(--color-ink)" : "none" }}
          />
          <span
            className="pointer-events-none absolute left-1 top-1 grid h-6 w-6 place-items-center rounded-full sm:left-1.5 sm:top-1.5"
            style={
              selected
                ? { background: T.ink, color: "var(--color-card)", border: "2px solid var(--color-card)" }
                : { background: "rgb(from var(--color-admin-overlay) r g b / .25)", border: "2px solid var(--color-card)" }
            }
          >
            {selected && <AdminIcon name="check" className="h-3.5 w-3.5" />}
          </span>
        </>
      )}

      <button
        type="button"
        aria-label={photo.liked_by_me ? `取消爱心，现在 ${photo.like_count} 个` : `点爱心，现在 ${photo.like_count} 个`}
        aria-pressed={photo.liked_by_me}
        className="pressable tabular absolute bottom-1 right-1 inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-black sm:bottom-1.5 sm:right-1.5"
        style={PILL}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onLike(photo); }}
      >
        <span aria-hidden="true" className="text-[12px] leading-none">{photo.liked_by_me ? "❤️" : "🤍"}</span>
        {photo.like_count > 0 && <span>{photo.like_count}</span>}
      </button>
    </div>
  );
});

/* ------------------------------------------------------------ 浮动面板 */

function ProgressBar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div className="h-1 w-full" style={{ background: "var(--color-admin-neutral)" }}>
      <div className="h-full" style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}

const rowButton = "pressable shrink-0 rounded-lg px-2 py-1 text-xs font-black";

function uploadStatusText(item: UploadItemView): string {
  switch (item.status) {
    case "queued": return `排队中 · ${formatBytes(item.size)}`;
    case "preparing": return "准备中";
    case "uploading": {
      const pct = item.size > 0 ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : 0;
      return `${pct}% · ${formatBytes(item.size)}`;
    }
    case "finishing": return "收尾中";
    case "done": return `已完成 · ${formatBytes(item.size)}`;
    case "failed": return item.error ?? "没传上";
  }
}

function UploadPanel({ snapshot, queue }: { snapshot: UploadSnapshot; queue: UploadQueue }) {
  const [open, setOpen] = useState(true);
  const { items, totalBytes, loadedBytes, active, failed, done } = snapshot;
  if (items.length === 0) return null;
  const pct = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0;
  const heading =
    active > 0 ? `正在上传 ${done} / ${items.length}` : failed > 0 ? `${failed} 个没传上` : `已传完 ${done} 个`;

  return (
    <section className={`overflow-hidden rounded-[18px] ${SHADOW}`} style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <AdminIcon name="upload" className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-black" style={{ color: failed > 0 && active === 0 ? T.danger : T.ink }}>
            {heading}
          </span>
          <span className="tabular block truncate text-[11px] font-semibold" style={{ color: T.inkFaint }}>
            {formatBytes(loadedBytes)} / {formatBytes(totalBytes)} · {pct}%
          </span>
        </span>
        <AdminIcon name="chevron" className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : "-rotate-90"}`} />
      </button>
      <ProgressBar pct={pct} tone={failed > 0 && active === 0 ? T.danger : T.ink} />
      {open && (
        <>
          <ul className="tool-scroll max-h-[38dvh] overflow-y-auto px-2 py-1.5">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-black">{item.name}</div>
                  <div
                    className="tabular truncate text-[11px] font-semibold"
                    style={{ color: item.status === "failed" ? T.danger : item.status === "done" ? T.good : T.inkFaint }}
                  >
                    {uploadStatusText(item)}
                  </div>
                </div>
                {item.status === "failed" && (
                  <button type="button" className={rowButton} style={{ color: T.ink, background: T.panelAlt }} onClick={() => queue.retry(item.id)}>
                    重试
                  </button>
                )}
                {item.status === "done" ? (
                  <AdminIcon name="check" className="h-4 w-4 shrink-0" />
                ) : (
                  <button
                    type="button"
                    className={`${rowButton} grid h-7 w-7 place-items-center !p-0`}
                    style={{ color: T.inkSoft }}
                    aria-label={item.status === "failed" ? `移出列表：${item.name}` : `取消上传：${item.name}`}
                    onClick={() => queue.remove(item.id)}
                  >
                    <AdminIcon name="close" className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-end gap-2 px-3 py-2.5" style={{ borderTop: `1px solid ${T.lineSoft}` }}>
            {failed > 0 && <Btn className="!px-3 !py-2 !text-xs" onClick={() => queue.retryFailed()}>全部重试</Btn>}
            {active > 0 ? (
              <Btn variant="quiet" className="!px-3 !py-2 !text-xs" onClick={() => queue.cancelAll()}>全部取消</Btn>
            ) : (
              done > 0 && <Btn variant="quiet" className="!px-3 !py-2 !text-xs" onClick={() => queue.clearFinished()}>清除已完成</Btn>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function DownloadPanel({
  progress,
  onCancel,
  onClose,
  onRetry,
}: {
  progress: FolderProgress;
  onCancel: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [showFailed, setShowFailed] = useState(false);
  const failed = progress.failed.length;
  const finished = progress.done + progress.skipped + failed;
  const pct = progress.totalBytes > 0 ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100)) : 0;
  const heading = progress.running
    ? `正在下载 ${finished} / ${progress.total}`
    : progress.cancelled
      ? "下载已取消"
      : failed > 0
        ? `下载完了，${failed} 个没下成`
        : "全部下载完成";

  return (
    <section className={`overflow-hidden rounded-[18px] ${SHADOW}`} style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      <div className="flex items-center gap-3 px-4 py-3">
        <AdminIcon name="download" className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black" style={{ color: !progress.running && failed > 0 ? T.danger : T.ink }}>
            {heading}
          </div>
          <div className="tabular truncate text-[11px] font-semibold" style={{ color: T.inkFaint }}>
            {formatBytes(progress.loadedBytes)} / {formatBytes(progress.totalBytes)} · {pct}%
            {progress.skipped > 0 && ` · 跳过 ${progress.skipped} 个已有的`}
          </div>
        </div>
        {progress.running ? (
          <Btn variant="quiet" className="!px-3 !py-2 !text-xs" onClick={onCancel}>取消</Btn>
        ) : (
          <Btn variant="quiet" className="!px-3 !py-2 !text-xs" onClick={onClose}>关闭</Btn>
        )}
      </div>
      <ProgressBar pct={pct} tone={!progress.running && failed > 0 ? T.danger : T.ink} />
      {failed > 0 && !progress.running && (
        <div className="px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="text-xs font-black underline underline-offset-2" style={{ color: T.inkSoft }} onClick={() => setShowFailed((v) => !v)}>
              {showFailed ? "收起" : "看看哪些没下成"}
            </button>
            <Btn className="!px-3 !py-2 !text-xs" onClick={onRetry}>重下这 {failed} 个</Btn>
          </div>
          {showFailed && (
            <ul className="tool-scroll mt-2 max-h-40 space-y-1 overflow-y-auto">
              {progress.failed.map((item) => (
                <li key={item.id} className="text-[11px] font-semibold">
                  <span className="font-black">{item.filename}</span>
                  <span style={{ color: T.danger }}> · {item.error}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
