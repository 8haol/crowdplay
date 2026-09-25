import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RpcError, errorText } from "../../lib/api";
import { ErrorBanner, SuccessBanner } from "../../lib/ui";
import { AdminIcon, Btn, EmptyState, PageTitle, Panel } from "../adminUi";
import { T } from "../adminTokens";
import { formatBytes } from "../adminUtils";
import { fetchAlbumPhotos, photoUrl, togglePhotoLike } from "./albumApi";
import { loadThumb, peekThumb } from "./thumbCache";
import type { AlbumPhoto, AlbumPhotosData, ViewKind } from "./albumTypes";
import {
  applyView,
  countByType,
  dedupeKey,
  groupByDay,
  isGroupedSort,
  loadStoredView,
  paramsWithView,
  saveStoredView,
  snapshotLikes,
  sortPhotos,
  viewFromParams,
  type DayGroup,
  type LikeSnapshot,
  type ViewState,
} from "./albumView";
import { AlbumToolbar, SelectionBar } from "./AlbumToolbar";
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
import { PhotoGrid, type PhotoGridHandle } from "./PhotoGrid";
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
 * 一本相册：上传、网格、挑片、下载、删除。灯箱在 Lightbox.tsx，网格在 PhotoGrid.tsx，
 * 排序 / 筛选 / 搜索的纯逻辑在 albumView.ts。
 *
 * 打开的照片写在 URL 的 ?p=<id> 里：能把链接直接发给另一位同工，
 * 浏览器的返回键也能关掉灯箱（打开时 push 一条历史，关的时候 back）。
 * 灯箱里翻页时先只改本地状态，停下来 300ms 再 replace 一次 URL：
 * 按住方向键连翻几十张也不会把浏览器的 history 限流打满，也不会每翻一张就重排整个网格。
 */

type Notice = { tone: "ok" | "error"; text: string } | null;

const SHADOW = "shadow-[0_18px_60px_rgb(from_var(--color-admin-shadow)_r_g_b_/_.2)]";
const URL_SYNC_MS = 300;

const EMPTY_TEXT: Record<ViewState["type"], string> = {
  all: "文件",
  photo: "照片",
  video: "视频",
  hearted: "有人点过爱心的照片",
  liked: "你点过爱心的照片",
  nothumb: "缺缩略图的文件",
};

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
  const [stored, setStored] = useState(() => loadStoredView(albumId));
  const [searchKey, setSearchKey] = useState(0);
  const [snap, setSnap] = useState<LikeSnapshot>(() => snapshotLikes([]));
  const [selectMode, setSelectMode] = useState(false);
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
  const gridRef = useRef<PhotoGridHandle>(null);
  const alive = useRef(true);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<string | null>(null);
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
        setSnap(snapshotLikes(result.photos));
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

  /* ------------------------------------------------------------ 怎么看 */

  const photos = useMemo(() => data?.photos ?? [], [data]);
  // 按字段记忆：灯箱写回 ?p= 时 searchParams 会换新对象，但看法没变，网格不该跟着重算。
  const parsed = viewFromParams(searchParams, stored);
  const view = useMemo<ViewState>(
    () => ({ sort: parsed.sort, type: parsed.type, q: parsed.q, size: parsed.size }),
    [parsed.sort, parsed.type, parsed.q, parsed.size],
  );
  const counts = useMemo(() => countByType(photos, view.q), [photos, view.q]);
  const visible = useMemo(() => applyView(photos, view, snap), [photos, view, snap]);
  const grouped = isGroupedSort(view.sort);
  const groups = useMemo<DayGroup[]>(
    () => (grouped ? groupByDay(visible) : [{ key: "all", label: "", photos: visible }]),
    [grouped, visible],
  );
  const totalBytes = useMemo(() => photos.reduce((sum, photo) => sum + photo.size_bytes, 0), [photos]);
  const videoCount = counts.video;

  // 回调里读最新值用；网格收到的回调保持不变，挑一张不会重画几百格。
  const latest = useRef({ photos, view, visible, selecting: false });
  const selecting = selectMode || selected.size > 0;
  useLayoutEffect(() => {
    latest.current = { photos, view, visible, selecting };
  });

  const updateView = useCallback((patch: Partial<ViewState>) => {
    const { photos: all, view: current } = latest.current;
    const next = { ...current, ...patch };
    const nextSnap = snapshotLikes(all);
    setStored(next);
    saveStoredView(albumId, next);
    setSnap(nextSnap);
    setSearchParams((prev) => paramsWithView(prev, next), { replace: true });
    // 筛掉的照片同时退出选择：免得看不见的也被一起删掉。
    if (patch.type !== undefined || patch.q !== undefined) {
      const keep = new Set(applyView(all, next, nextSnap).map((photo) => photo.id));
      setSelected((cur) => {
        if ([...cur].every((id) => keep.has(id))) return cur;
        return new Set([...cur].filter((id) => keep.has(id)));
      });
    }
  }, [albumId, setSearchParams]);

  const clearFilters = () => {
    updateView({ type: "all", q: "" });
    setSearchKey((key) => key + 1);
  };

  /* ------------------------------------------------------------ 灯箱 */

  const openId = searchParams.get("p");
  // lb.id 是灯箱此刻显示的那张；lb.url 是上次看到的 ?p=，用来分辨 URL 是不是被外面改了（返回键、深链）。
  const [lb, setLb] = useState<{ id: string | null; url: string | null }>(() => ({ id: openId, url: openId }));
  let lightboxId = lb.id;
  if (openId !== lb.url) {
    // URL 没了 p：返回键关掉了灯箱。URL 换了一张而灯箱开着：那是我们自己延后写回的，不跟。
    lightboxId = openId === null ? null : lb.id ?? openId;
    setLb({ id: lightboxId, url: openId });
  }

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

  // 翻页停下来再把 ?p= 改成当前这张。
  useEffect(() => {
    if (!lb.id || !openId || lb.id === openId) return;
    const id = lb.id;
    const timer = setTimeout(() => setPhotoParam(id, true), URL_SYNC_MS);
    return () => clearTimeout(timer);
  }, [lb.id, openId, setPhotoParam]);

  const openPhoto = useCallback((photo: AlbumPhoto) => {
    openedHere.current = true;
    setLb((prev) => ({ id: photo.id, url: prev.url }));
    setPhotoParam(photo.id, false);
  }, [setPhotoParam]);

  const closeLightbox = useCallback(() => {
    const lastId = lb.id;
    setLb((prev) => ({ id: null, url: prev.url }));
    if (openedHere.current) {
      openedHere.current = false;
      navigate(-1);
    } else {
      setPhotoParam(null, true);
    }
    // 回到网格时，把刚才看到的那张滚进视野（翻了很多张之后，它可能早就不在原来的位置了）。
    if (lastId) {
      requestAnimationFrame(() => gridRef.current?.reveal(lastId));
    }
  }, [lb.id, navigate, setPhotoParam]);

  // 灯箱翻页范围 = 当前排序 + 筛选后的列表。深链打开的那张不在筛选结果里时，退回整本相册。
  const sortedAll = useMemo(() => sortPhotos(photos, view.sort, snap), [photos, view.sort, snap]);
  const inVisible = lightboxId ? visible.findIndex((photo) => photo.id === lightboxId) : -1;
  const lightboxPhotos = inVisible >= 0 ? visible : sortedAll;
  const lightboxIndex = inVisible >= 0 ? inVisible : lightboxId ? sortedAll.findIndex((photo) => photo.id === lightboxId) : -1;

  const changeIndex = useCallback((index: number) => {
    const photo = lightboxPhotos[index];
    if (photo) setLb((prev) => ({ ...prev, id: photo.id }));
  }, [lightboxPhotos]);

  // 缩略图走按 id 的本地缓存（thumbCache）；预览图和原片仍用签名 URL。
  const getUrl = useCallback(
    (photo: AlbumPhoto, kind: ViewKind) =>
      kind === "thumb" ? (photo.has_thumb ? loadThumb(adminKey, photo.id) : Promise.resolve(null)) : photoUrl(adminKey, photo, kind),
    [adminKey],
  );
  const cachedThumb = useCallback((photo: AlbumPhoto) => (photo.has_thumb ? peekThumb(photo.id) : null), []);

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

  /** 点一张：Shift 时把上一次点的那张到这张之间整段选上，否则切换这一张。 */
  const pick = useCallback((photo: AlbumPhoto, shift: boolean) => {
    const list = latest.current.visible;
    const from = shift && anchor.current ? list.findIndex((p) => p.id === anchor.current) : -1;
    const to = from >= 0 ? list.findIndex((p) => p.id === photo.id) : -1;
    anchor.current = photo.id;
    if (from >= 0 && to >= 0 && from !== to) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      setSelected((cur) => {
        const next = new Set(cur);
        for (let i = lo; i <= hi; i++) next.add(list[i].id);
        return next;
      });
      return;
    }
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(photo.id)) next.delete(photo.id);
      else next.add(photo.id);
      return next;
    });
  }, []);

  const onTile = useCallback((photo: AlbumPhoto, shift: boolean) => {
    if (latest.current.selecting || shift) pick(photo, shift);
    else openPhoto(photo);
  }, [pick, openPhoto]);

  const onLongPress = useCallback((photo: AlbumPhoto) => {
    anchor.current = photo.id;
    setSelected((cur) => (cur.has(photo.id) ? cur : new Set(cur).add(photo.id)));
  }, []);

  const onSelectDay = useCallback((group: DayGroup, select: boolean) => {
    anchor.current = group.photos[group.photos.length - 1]?.id ?? null;
    setSelected((cur) => {
      const next = new Set(cur);
      for (const photo of group.photos) {
        if (select) next.add(photo.id);
        else next.delete(photo.id);
      }
      return next;
    });
  }, []);

  const exitSelecting = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
    anchor.current = null;
  }, []);

  const selectedPhotos = useMemo(() => visible.filter((photo) => selected.has(photo.id)), [visible, selected]);
  const allSelected = visible.length > 0 && selectedPhotos.length === visible.length;
  const lightboxOpen = lightboxIndex >= 0;

  // Esc 取消多选。灯箱开着时 Esc 归灯箱（它在捕获阶段先处理并 preventDefault）；对话框开着时不动。
  useEffect(() => {
    if (!selecting || lightboxOpen || dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      exitSelecting();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, lightboxOpen, dialog, exitSelecting]);

  /* ------------------------------------------------------------ 上传 */

  const addFiles = async (files: File[]) => {
    const screened = screenFiles(files);
    // 和相册里已经传好的、以及队列里还在传 / 已传完的比：同名同大小就跳过。
    // 浏览器崩了之后重新拖整个文件夹，只会传剩下的。
    const known = new Set(latest.current.photos.map((photo) => dedupeKey(photo.filename, photo.size_bytes)));
    for (const item of queue.getSnapshot().items) {
      if (item.status !== "failed") known.add(dedupeKey(item.name, item.size));
    }
    const fresh: typeof screened.accepted = [];
    let duplicates = 0;
    for (const entry of screened.accepted) {
      const key = dedupeKey(entry.file.name, entry.file.size);
      if (known.has(key)) { duplicates++; continue; }
      known.add(key);
      fresh.push(entry);
    }

    const skipped: string[] = [];
    if (duplicates) skipped.push(`${duplicates} 个已经在相册里的文件`);
    if (screened.unsupported) skipped.push(`${screened.unsupported} 个不是照片或视频`);
    if (screened.tooLarge) skipped.push(`${screened.tooLarge} 个超过 5GB`);
    if (fresh.length === 0) {
      if (duplicates && !screened.unsupported && !screened.tooLarge) {
        setNotice({ tone: "ok", text: `跳过 ${duplicates} 个已经在相册里的文件，没有新的要传` });
      } else {
        setNotice({ tone: "error", text: skipped.length ? `没有可以上传的文件：跳过 ${skipped.join("，")}` : "没有可以上传的照片或视频" });
      }
      return;
    }
    queue.add(fresh);
    setNotice(skipped.length ? { tone: "ok", text: `已加入 ${fresh.length} 个文件，跳过 ${skipped.join("，")}` } : null);
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
  const hasPhotos = photos.length > 0;
  const countText = videoCount > 0 ? `${photos.length - videoCount} 张照片 · ${videoCount} 个视频` : `${photos.length} 张`;
  const query = view.q.trim();

  const pickFiles = <Btn variant="primary" icon="plus" className={hasPhotos ? "!px-3 !py-2" : ""} onClick={() => fileInput.current?.click()}>选择文件</Btn>;
  const pickDir = <Btn className={`max-sm:hidden ${hasPhotos ? "!px-3 !py-2" : ""}`} onClick={() => folderInput.current?.click()}>选择文件夹</Btn>;

  return (
    <div {...dropHandlers} className={floating ? "pb-24" : ""}>
      <PageTitle
        eyebrow="ALBUM"
        title={album.title}
        description={[album.event_title, countText, formatBytes(totalBytes)].filter(Boolean).join(" · ")}
        onBack={{ label: "全部相册", onClick: onBack }}
        actions={
          <>
            {canFolder && hasPhotos && (
              <Btn icon="download" disabled={downloading} onClick={() => void startFolderDownload(sortedAll)}>
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

      {hasPhotos ? (
        // 有照片之后上传区收成一行，把屏幕留给照片；拖到页面任何地方都能传。
        <Panel className="px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: T.panelAlt, color: T.ink }}>
              <AdminIcon name="upload" className="h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1 text-xs font-semibold" style={{ color: T.inkSoft }}>
              <span className="hidden sm:inline">把照片、视频或整个文件夹拖到页面上就能继续上传；已经在相册里的会自动跳过。</span>
              <span className="sm:hidden">继续上传，重复的会自动跳过</span>
            </p>
            <div className="flex shrink-0 gap-2">{pickFiles}{pickDir}</div>
          </div>
        </Panel>
      ) : (
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
            <div className="flex shrink-0 flex-wrap justify-center gap-2">{pickFiles}{pickDir}</div>
          </div>
        </Panel>
      )}

      {dragging && hasPhotos && (
        // 盖满整个窗口：松手落在侧栏或顶栏上也算数（事件照样冒泡到这一页的根上）。
        <div aria-hidden="true" className="fixed inset-0 z-40 p-3 sm:p-5">
          <div
            className="grid h-full w-full place-items-center rounded-[24px] border-2 border-dashed"
            style={{ borderColor: T.ink, background: "rgb(from var(--color-admin-accent-soft) r g b / .78)" }}
          >
            <div className="flex items-center gap-2 rounded-2xl px-5 py-3 text-base font-black" style={{ background: T.panel, color: T.ink }}>
              <AdminIcon name="upload" className="h-5 w-5" />
              松手就开始上传
            </div>
          </div>
        </div>
      )}

      {!hasPhotos ? (
        <Panel className="mt-5">
          <EmptyState title="还没有照片" detail="传完的照片会出现在这里。点爱心挑片，剪辑同工按「最多爱心」一看就知道用哪些。" />
        </Panel>
      ) : (
        <>
          <div
            className="sticky top-[62px] z-20 -mx-4 mt-3 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
            style={{ background: "rgb(from var(--color-admin-bg) r g b / .94)" }}
          >
            <div className="relative">
              <div className={selecting ? "invisible" : undefined} aria-hidden={selecting || undefined}>
                <AlbumToolbar
                  view={view}
                  counts={counts}
                  searchKey={searchKey}
                  onChange={updateView}
                  onStartSelect={() => setSelectMode(true)}
                />
              </div>
              {selecting && (
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full">
                    <SelectionBar
                      count={selectedPhotos.length}
                      total={visible.length}
                      busy={downloading || sendingOneByOne}
                      onToggleAll={() => setSelected(allSelected ? new Set() : new Set(visible.map((p) => p.id)))}
                      onDownload={() => void downloadSelected()}
                      onDelete={() => setDialog("delete-photos")}
                      onCancel={exitSelecting}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <Panel className="mt-3">
              <EmptyState
                title="没有符合条件的文件"
                detail={query ? `文件名里带「${query}」的${EMPTY_TEXT[view.type]}，这本相册里没有。` : `这本相册里还没有${EMPTY_TEXT[view.type]}。`}
                action={<Btn variant="primary" onClick={clearFilters}>清除筛选</Btn>}
              />
            </Panel>
          ) : (
            <div className={grouped ? "" : "mt-2"}>
              <PhotoGrid
                gridRef={gridRef}
                adminKey={adminKey}
                groups={groups}
                grouped={grouped}
                size={view.size}
                selecting={selecting}
                selected={selected}
                onTile={onTile}
                onCheck={pick}
                onLongPress={onLongPress}
                onLike={toggleLike}
                onSelectDay={onSelectDay}
              />
            </div>
          )}
        </>
      )}

      {floating && (
        <div
          className="pointer-events-none fixed inset-x-3 z-30 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:w-[23rem] [&>*]:pointer-events-auto"
          style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
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

      {lightboxOpen && (
        <Lightbox
          photos={lightboxPhotos}
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

/*
 * 上传进度默认收成右下角一颗圆钮（外圈是进度，里面是「传完几个 / 共几个」），
 * 手机上整张面板会挡住半屏照片。点圆钮展开成完整列表，点标题栏再收回去。
 */
function UploadPanel({ snapshot, queue }: { snapshot: UploadSnapshot; queue: UploadQueue }) {
  const [open, setOpen] = useState(false);
  const { items, totalBytes, loadedBytes, active, failed, done } = snapshot;
  if (items.length === 0) return null;
  const pct = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0;
  const heading =
    active > 0 ? `正在上传 ${done} / ${items.length}` : failed > 0 ? `${failed} 个没传上` : `已传完 ${done} 个`;

  if (!open) return <UploadBubble heading={heading} pct={pct} done={done} total={items.length} active={active} failed={failed} onOpen={() => setOpen(true)} />;

  return (
    <section className={`w-full overflow-hidden rounded-[18px] ${SHADOW}`} style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded
        aria-label={`${heading}，收起上传列表`}
        onClick={() => setOpen(false)}
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
        <AdminIcon name="chevron" className="h-4 w-4 shrink-0 rotate-90" />
      </button>
      <ProgressBar pct={pct} tone={failed > 0 && active === 0 ? T.danger : T.ink} />
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
    </section>
  );
}

const RING_R = 24;
const RING_C = 2 * Math.PI * RING_R;

function UploadBubble({
  heading,
  pct,
  done,
  total,
  active,
  failed,
  onOpen,
}: {
  heading: string;
  pct: number;
  done: number;
  total: number;
  active: number;
  failed: number;
  onOpen: () => void;
}) {
  const bad = failed > 0 && active === 0;
  const finished = active === 0 && failed === 0;
  const tone = bad ? T.danger : T.ink;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${heading}，展开上传列表`}
      title={heading}
      className={`pressable relative grid h-14 w-14 place-items-center rounded-full ${SHADOW}`}
      style={{ background: T.panel, border: `1px solid ${T.line}`, color: tone }}
    >
      <svg aria-hidden="true" viewBox="0 0 56 56" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="28" cy="28" r={RING_R} fill="none" strokeWidth="3" style={{ stroke: "var(--color-admin-neutral)" }} />
        <circle
          cx="28"
          cy="28"
          r={RING_R}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - (finished ? 100 : pct) / 100)}
          className="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
          style={{ stroke: tone }}
        />
      </svg>
      {finished ? (
        <AdminIcon name="check" className="h-5 w-5" />
      ) : bad ? (
        <span className="text-lg font-black leading-none">!</span>
      ) : (
        <span className="tabular text-[11px] font-black leading-none">{done}/{total}</span>
      )}
    </button>
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
    <section className={`w-full overflow-hidden rounded-[18px] ${SHADOW}`} style={{ background: T.panel, border: `1px solid ${T.line}` }}>
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
