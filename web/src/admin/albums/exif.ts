/*
 * 拍摄时间，给网格排序用。只认 JPEG 的 APP1 Exif 段：
 *   IFD0 → ExifIFD 指针 (0x8769) → DateTimeOriginal (0x9003)
 * 退而求其次 DateTimeDigitized (0x9004)，再退 IFD0 的 DateTime (0x0132)。
 * 有 OffsetTimeOriginal (0x9011) 就按它换算，没有就当本机时区。
 *
 * 只读文件头 128KB：Exif 段必须在图像数据之前，而且规定不超过 64KB。
 * 几十行自己解析，不为这点事引一个库。HEIC / 视频 / 读不到时返回 null，
 * 由 takenAtFor 退回文件的 lastModified。
 */
const HEAD_BYTES = 128 * 1024;

export async function readExifDate(file: Blob): Promise<string | null> {
  try {
    const buffer = await file.slice(0, HEAD_BYTES).arrayBuffer();
    return parseJpeg(new DataView(buffer));
  } catch {
    // 越界读（截断的文件）或 slice 失败：当作没有 EXIF
    return null;
  }
}

export async function takenAtFor(file: File): Promise<string | null> {
  const exif = await readExifDate(file);
  if (exif) return exif;
  return file.lastModified > 0 ? new Date(file.lastModified).toISOString() : null;
}

function parseJpeg(view: DataView): string | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xff) { offset += 1; continue; } // 填充字节
    if (marker === 0xda || marker === 0xd9) return null; // 图像数据开始了，后面不会再有 Exif
    const length = view.getUint16(offset + 2);
    // "Exif\0\0"
    if (marker === 0xe1 && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
      return parseTiff(view, offset + 10);
    }
    offset += 2 + length;
  }
  return null;
}

function parseTiff(view: DataView, start: number): string | null {
  const order = view.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const u16 = (at: number) => view.getUint16(start + at, little);
  const u32 = (at: number) => view.getUint32(start + at, little);
  if (u16(2) !== 42) return null;

  const find = (ifd: number, tag: number): number => {
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === tag) return entry;
    }
    return -1;
  };
  const ascii = (ifd: number, tag: number): string | null => {
    const entry = find(ifd, tag);
    if (entry < 0 || u16(entry + 2) !== 2) return null; // 2 = ASCII
    const count = u32(entry + 4);
    const at = count <= 4 ? entry + 8 : u32(entry + 8);
    let text = "";
    for (let i = 0; i < count; i++) {
      const code = view.getUint8(start + at + i);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text;
  };

  const ifd0 = u32(4);
  let date: string | null = null;
  let zone: string | null = null;
  const exifPointer = find(ifd0, 0x8769);
  if (exifPointer >= 0) {
    const exifIfd = u32(exifPointer + 8);
    date = ascii(exifIfd, 0x9003) ?? ascii(exifIfd, 0x9004);
    zone = ascii(exifIfd, 0x9011);
  }
  date ??= ascii(ifd0, 0x0132);
  return date ? toIso(date, zone) : null;
}

function toIso(value: string, zone: string | null): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!m || m[1] === "0000") return null;
  const [, y, mo, d, h, mi, s] = m;
  const parsed = zone && /^[+-]\d{2}:\d{2}$/.test(zone.trim())
    ? new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone.trim()}`)
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
