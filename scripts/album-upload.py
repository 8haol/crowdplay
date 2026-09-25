#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把一个文件夹里的照片 / 视频传进某本活动相册，走和后台网页完全一样的接口（album-sign + RPC）。
浏览器传几百张大图会崩（2026-09-25 园游会），这个脚本给「一整张存储卡」用：可以过夜跑，中断了重跑
只传剩下的（按文件名 + 大小跳过相册里已经有的）。

用法：
  python3 scripts/album-upload.py <文件夹> [--album <相册 id> | --title <新相册名>]

机构管理口令从 ~/.config/lifepassport/admin_key 读（只有第一行），脚本不打印它。
缩略图用 Pillow 生成（按 EXIF 摆正，长边 400 / 2048，JPEG 0.82），和网页生成的一致。
"""
import argparse
import concurrent.futures as cf
import json
import mimetypes
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from io import BytesIO

BASE = os.environ.get("ALBUM_BASE", "https://gohrobxiznbrrncrcmjo.supabase.co")
API_KEY = os.environ.get("ALBUM_API_KEY", "sb_publishable_Zac7Wd4Nyb1_-y1xl5Kb1Q_G8FBaiPA")
KEY_FILE = os.path.expanduser(os.environ.get("ALBUM_KEY_FILE", "~/.config/lifepassport/admin_key"))
CONCURRENCY = 4
TRIES = 4
EXTRA_TYPES = {".heic": "image/heic", ".heif": "image/heif", ".mov": "video/quicktime", ".mp4": "video/mp4",
               ".m4v": "video/x-m4v", ".mts": "video/mp2t", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".arw": "image/x-sony-arw", ".dng": "image/x-adobe-dng", ".png": "image/png"}

log_lock = threading.Lock()


def log(msg):
    with log_lock:
        print(time.strftime("%H:%M:%S"), msg, flush=True)


class ApiError(Exception):
    def __init__(self, code, status=0):
        super().__init__(code)
        self.code = code
        self.status = status


def post(path, body, timeout=60):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method="POST", headers={
        "apikey": API_KEY, "authorization": "Bearer " + API_KEY, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", "replace")
        try:
            data = json.loads(raw)
            code = data.get("error") or data.get("message") or ("HTTP_%d" % err.code)
        except ValueError:
            code = "HTTP_%d" % err.code
        raise ApiError(code, err.code)


def rpc(fn, args):
    return post("/rest/v1/rpc/" + fn, args)


def sign(action, body, timeout=120):
    return post("/functions/v1/album-sign", dict(body, action=action), timeout)


def put(url, body, content_type, length):
    req = urllib.request.Request(url, data=body, method="PUT", headers={
        "content-type": content_type, "content-length": str(length)})
    with urllib.request.urlopen(req, timeout=3600) as res:
        res.read()


def content_type_for(path):
    ext = os.path.splitext(path)[1].lower()
    return EXTRA_TYPES.get(ext) or mimetypes.guess_type(path)[0]


def exif_taken_at(img):
    try:
        exif = img.getexif()
        sub = exif.get_ifd(0x8769)
        raw = sub.get(0x9003) or sub.get(0x9004) or exif.get(0x0132)
        if not raw:
            return None
        stamp = datetime.strptime(str(raw).strip("\x00 "), "%Y:%m:%d %H:%M:%S")
        offset = sub.get(0x9011)
        if offset:
            return stamp.strftime("%Y-%m-%dT%H:%M:%S") + str(offset).strip("\x00 ")
        return stamp.astimezone().isoformat()  # 没写时区就当本机时区，和网页一致
    except Exception:
        return None


def make_thumbs(path, content_type):
    """返回 (thumb_bytes, preview_bytes, taken_at)。视频和 Pillow 解不了的返回 (None, None, None)。"""
    if not content_type.startswith("image/"):
        return None, None, None
    try:
        from PIL import Image, ImageOps
        with Image.open(path) as img:
            taken_at = exif_taken_at(img)
            img.draft("RGB", (2048, 2048))  # JPEG 按 DCT 缩放解码，快而且省内存
            img = ImageOps.exif_transpose(img).convert("RGB")
            preview = img.copy()
            preview.thumbnail((2048, 2048), Image.LANCZOS)
            thumb = preview.copy()
            thumb.thumbnail((400, 400), Image.LANCZOS)
            out = []
            for im in (thumb, preview):
                buf = BytesIO()
                im.save(buf, "JPEG", quality=82, optimize=True)
                out.append(buf.getvalue())
            return out[0], out[1], taken_at
    except Exception as err:
        log("  缩略图失败 %s: %s" % (os.path.basename(path), err))
        return None, None, None


def upload_one(admin_key, album_id, path):
    name = os.path.basename(path)
    size = os.path.getsize(path)
    ctype = content_type_for(path)
    thumb, preview, taken_at = make_thumbs(path, ctype)
    if not taken_at:
        taken_at = datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat()
    for attempt in range(1, TRIES + 1):
        photo_id = None
        try:
            signed = sign("upload", {"admin_key": admin_key, "album_id": album_id, "filename": name,
                                     "content_type": ctype, "size_bytes": size, "taken_at": taken_at})
            photo_id = signed["photo_id"]
            with open(path, "rb") as fh:
                put(signed["put_original"], fh, ctype, size)
            if thumb:
                put(signed["put_thumb"], thumb, "image/jpeg", len(thumb))
            if preview:
                put(signed["put_preview"], preview, "image/jpeg", len(preview))
            sign("complete", {"admin_key": admin_key, "photo_id": photo_id})
            return size
        except ApiError as err:
            if photo_id:
                try:
                    sign("abort", {"admin_key": admin_key, "photo_id": photo_id})
                except Exception:
                    pass
            # 口令错 / 文件不合法：重试也没用
            if err.code.split(":")[0] in ("BAD_KEY", "BAD_FILE", "ALBUM_NOT_FOUND", "NOT_CONFIGURED"):
                raise
            last = err.code
        except Exception as err:
            if photo_id:
                try:
                    sign("abort", {"admin_key": admin_key, "photo_id": photo_id})
                except Exception:
                    pass
            last = repr(err)
        wait = min(120, 5 * 2 ** attempt) + random.random() * 5
        log("  %s 第 %d 次失败（%s），%ds 后重试" % (name, attempt, last, wait))
        time.sleep(wait)
    raise RuntimeError("%s 重试 %d 次仍失败" % (name, TRIES))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--album")
    ap.add_argument("--title")
    ap.add_argument("--wait-for-key", action="store_true", help="口令文件还没有就每 30 秒看一次")
    args = ap.parse_args()

    while not (os.path.exists(KEY_FILE) and open(KEY_FILE).read().strip()):
        if not args.wait_for_key:
            sys.exit("没有口令文件 " + KEY_FILE)
        time.sleep(30)
    admin_key = open(KEY_FILE).read().splitlines()[0].strip()

    albums = rpc("admin_albums", {"p_admin_key": admin_key})
    album_id = args.album
    if album_id and not any(a["id"] == album_id for a in albums["albums"]):
        log("相册 %s 不在了" % album_id)
        album_id = None
    if not album_id and args.title:
        match = [a for a in albums["albums"] if a["title"] == args.title]
        album_id = match[0]["id"] if match else rpc("admin_album_create", {
            "p_admin_key": admin_key, "p_title": args.title, "p_event_id": None})["id"]
    if not album_id:
        sys.exit("要么给 --album，要么给 --title")

    existing = rpc("admin_album_photos", {"p_admin_key": admin_key, "p_album_id": album_id,
                                          "p_device_id": str(uuid.uuid4())})["photos"]
    have = {(p["filename"], int(p["size_bytes"])) for p in existing}

    files = []
    for dirpath, _, names in os.walk(args.folder):
        for n in names:
            if n.startswith(".") or n.startswith("._"):
                continue
            path = os.path.join(dirpath, n)
            ctype = content_type_for(path)
            if not ctype or not (ctype.startswith("image/") or ctype.startswith("video/")):
                continue
            if (n, os.path.getsize(path)) in have:
                continue
            files.append(path)
    files.sort()
    total = sum(os.path.getsize(p) for p in files)
    log("相册 %s：已有 %d 个，要传 %d 个 / %.2f GB（机构已用 %.2f GB）" % (
        album_id, len(existing), len(files), total / 1024 ** 3, albums["used_bytes"] / 1024 ** 3))

    done_bytes, done, failed = 0, 0, []
    started = time.time()
    with cf.ThreadPoolExecutor(CONCURRENCY) as pool:
        futures = {pool.submit(upload_one, admin_key, album_id, p): p for p in files}
        for fut in cf.as_completed(futures):
            path = futures[fut]
            try:
                done_bytes += fut.result()
                done += 1
            except Exception as err:
                failed.append(os.path.basename(path))
                log("失败 %s：%s" % (os.path.basename(path), err))
                if isinstance(err, ApiError) and err.code.startswith(("BAD_KEY", "NOT_CONFIGURED")):
                    pool.shutdown(cancel_futures=True)
                    break
            rate = done_bytes / max(1, time.time() - started)
            left = (total - done_bytes) / rate if rate else 0
            log("进度 %d/%d · %.2f/%.2f GB · %.2f MB/s · 还要约 %d 分钟" % (
                done, len(files), done_bytes / 1024 ** 3, total / 1024 ** 3, rate / 1024 ** 2, left / 60))
    log("完成：成功 %d，失败 %d %s" % (done, len(failed), failed[:20]))
    print(json.dumps({"done": done, "failed": failed, "album_id": album_id}), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
