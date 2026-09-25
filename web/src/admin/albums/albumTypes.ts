/*
 * 活动相册的共享类型。形状跟 RPC / album-sign 的返回一一对应，
 * 契约见 docs/superpowers/plans/2026-09-25-org-photo-albums.md。
 */

export interface AlbumSummary {
  id: string;
  title: string;
  event_id: string | null;
  event_title: string | null;
  created_at: string;
  photo_count: number;
  total_bytes: number;
  cover_photo_id: string | null;
}

export interface AlbumsData {
  used_bytes: number;
  albums: AlbumSummary[];
}

export interface AlbumPhoto {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  has_thumb: boolean;
  has_preview: boolean;
  taken_at: string | null;
  created_at: string;
  like_count: number;
  liked_by_me: boolean;
}

export interface AlbumPhotosData {
  album: { id: string; title: string; event_id: string | null; event_title: string | null };
  photos: AlbumPhoto[];
}

export type ViewKind = "thumb" | "preview" | "original";

export function isVideo(photo: Pick<AlbumPhoto, "content_type">): boolean {
  return photo.content_type.startsWith("video/");
}

/**
 * 灯箱只管「看」：取 URL、爱心、下载都交回给调用方。
 * `getUrl` 对同一张同一种图要返回缓存里的那条 URL（调用方负责缓存和续期），
 * 拿不到（比如没有预览图）就 resolve 成 null。
 */
export interface LightboxProps {
  photos: AlbumPhoto[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  getUrl: (photo: AlbumPhoto, kind: ViewKind) => Promise<string | null>;
  /** 已经拿到手的缩略图 URL，同步读，给「先拉伸缩略图再淡入预览图」用。 */
  cachedThumb: (photo: AlbumPhoto) => string | null;
  onToggleLike: (photo: AlbumPhoto) => void;
  onDownload: (photo: AlbumPhoto) => void;
}
