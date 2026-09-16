import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { PollResult } from "../lib/types";
import { IDENTITY_ZH, colorOf, soloColor } from "../lib/types";
import { ActionButton, ErrorBanner } from "../lib/ui";

const WIDTH = 1080;
const HEIGHT = 1920;

/*
 * Most of these badges are shared from inside WeChat, whose webview never
 * exposes navigator.share at all, and the rest from iOS, where WebKit hands out
 * the share sheet only while the tap that asked for it is still fresh. So the
 * PNG becomes a File the moment it is drawn, the button calls share() inside
 * the tap with nothing awaited in front of it, and anywhere the sheet cannot
 * open the same button drops straight into the save-by-long-press route. It
 * must never end in a shrug.
 */
const IN_WECHAT = /MicroMessenger/i.test(navigator.userAgent);

type Keepsake = { url: string; file: File };

/* `rank` is passed in rather than read off `data`: the badge prints "全场第 N
   名" into the PNG, so it simply cannot be drawn before the host has published
   the ranks. Taking it as a required prop makes the page that opens this one
   prove it has one. */
export default function KeepsakeBadge({ data, rank }: { data: PollResult; rank: number }) {
  const [keepsake, setKeepsake] = useState<Keepsake | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [saveGuide, setSaveGuide] = useState(false);
  const [generatedAt] = useState(() => Date.now());
  const cardRef = useRef<HTMLDivElement>(null);
  const player = data.player;
  const identity = IDENTITY_ZH[player.identity ?? "solo"];
  const playerColor = colorOf(player.color_group) ?? soloColor(player.code);
  const eventDate = useMemo(
    () => {
      const date = new Date(data.started_at ?? generatedAt);
      return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
    },
    [data.started_at, generatedAt],
  );
  const filename = useMemo(() => `人生护照-${safeFilename(player.name)}.png`, [player.name]);

  useEffect(() => {
    let active = true;
    renderBadge({
      name: player.name,
      identity: identity.name,
      colorName: playerColor.zh,
      colorHex: playerColor.hex,
      score: player.score,
      rank,
      date: eventDate,
      orgZh: data.org?.name_zh ?? "Life Passport",
      orgEn: data.org?.name_en ?? "Life Passport",
    })
      .then(({ url, blob }) => {
        if (!active) return;
        setKeepsake({ url, file: new File([blob], filename, { type: "image/png" }) });
      })
      .catch(() => { if (active) setError("纪念徽章生成失败，请刷新后再试"); });
    return () => { active = false; };
  }, [data.org?.name_en, data.org?.name_zh, rank, eventDate, filename, identity.name, player.name, player.score, playerColor.hex, playerColor.zh]);

  const sharePayload = useMemo<ShareData | null>(
    () =>
      keepsake
        ? {
            title: `${player.name} 的人生纪念徽章`,
            text: "You don't have to do life alone",
            files: [keepsake.file],
          }
        : null,
    [keepsake, player.name],
  );

  /* Asked before the tap, so the button can promise only what this browser can
     actually do instead of failing once it is pressed. */
  const canOpenShareSheet = useMemo(() => {
    if (!sharePayload) return false;
    if (typeof navigator.share !== "function") return false;
    return typeof navigator.canShare !== "function" || navigator.canShare(sharePayload);
  }, [sharePayload]);

  const openSaveGuide = (note: string | null = null) => {
    setSaveGuide(true);
    setHint(note);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /** WeChat's webview swallows a[download]; there the long press is the only way. */
  const saveToDisk = () => {
    if (!keepsake || IN_WECHAT) return false;
    const link = document.createElement("a");
    link.href = keepsake.url;
    link.download = filename;
    link.click();
    return true;
  };

  const save = () => {
    openSaveGuide(saveToDisk() ? "已开始下载 PNG。" : null);
  };

  const share = () => {
    if (!sharePayload) return;
    if (!canOpenShareSheet) {
      save();
      return;
    }
    /* Nothing may be awaited between the tap and this call — iOS drops the
       sheet the moment the gesture goes stale. */
    return navigator.share(sharePayload).catch((shareError: unknown) => {
      if ((shareError as DOMException)?.name === "AbortError") return;
      save();
    });
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-night px-4 pb-28 pt-8 text-ink">
      <div className="night-sky" />
      <div className="relative z-10 mx-auto w-full max-w-md">
        <div>
          <p className="text-[10px] font-black tracking-[0.4em] text-foil-dim">LIFE PASSPORT · SHARE</p>
          <h1 className="mt-2 text-[22px] font-black tracking-[-0.03em]">分享图（长按保存 · 发朋友圈）</h1>
          <p className="mt-2 text-sm font-semibold text-ink-dim">你的姓名、同行身份、总分与全场名次都已写进这一程。</p>
        </div>

        <div
          ref={cardRef}
          className={`mt-5 overflow-hidden rounded-[18px] shadow-[0_5px_0_#e0a800] ${saveGuide ? "ring-4 ring-seal" : ""}`}
        >
          {keepsake ? (
            <img
              src={keepsake.url}
              alt={`${player.name} 的人生纪念徽章：${player.score} 分，全场第 ${rank} 名`}
              className="block h-auto w-full"
              width={WIDTH}
              height={HEIGHT}
            />
          ) : (
            <div className="grid aspect-[9/16] place-items-center bg-[#ffc838]">
              <div className="text-center">
                <div className="mx-auto h-16 w-16 animate-pulse rounded-full bg-foil" />
                <p className="mt-4 text-sm font-black text-ink-dim">正在生成你的徽章…</p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 space-y-3">
          <ErrorBanner text={error} />
          {saveGuide && (
            <div className="rounded-2xl bg-[#fff9f0] px-4 py-4 shadow-[0_3px_0_#e0a800]">
              <p className="text-[10px] font-black tracking-[0.3em] text-foil-dim">保存图片 · 发给朋友</p>
              <ol className="mt-3 space-y-2 text-sm font-bold text-[#7a5200]">
                <li>1 · 长按上面那张护照图片</li>
                <li>2 · 选择「保存图片」到相册</li>
                <li>3 · {IN_WECHAT ? "回到聊天或朋友圈，把它发出去" : "在微信里把它发给朋友"}</li>
              </ol>
              {IN_WECHAT && (
                <p className="mt-3 text-xs font-semibold leading-5 text-[#7a5200]">
                  也可以点右上角「···」，把这一页发给朋友。
                </p>
              )}
            </div>
          )}
          {hint && <div className="rounded-2xl bg-[#ffefc2] px-4 py-3 text-sm font-bold text-[#7a5200]">{hint}</div>}
          <ActionButton onClick={share} disabled={!keepsake}>
            {canOpenShareSheet ? "分享这张人生护照" : "保存图片 · 发给朋友"}
          </ActionButton>
          {!IN_WECHAT && (
            <ActionButton variant="tool-ghost" onClick={save} disabled={!keepsake}>下载 PNG</ActionButton>
          )}
          <Link to="/play" className="pressable block w-full rounded-full px-5 py-3 text-center text-sm font-black text-ink-dim">
            ← 返回结算页
          </Link>
          <p className="px-4 text-center text-xs font-semibold leading-5 text-ink-dim">
            微信中建议直接长按图片保存。分享图不包含你的人生编号。
          </p>
        </div>
      </div>
    </main>
  );
}

type BadgeData = {
  name: string;
  identity: string;
  colorName: string;
  colorHex: string;
  score: number;
  rank: number;
  date: string;
  /** The organisation that ran the event; the badge is their keepsake, not ours. */
  orgZh: string;
  orgEn: string;
};

async function renderBadge(data: BadgeData): Promise<{ url: string; blob: Blob }> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("NO_CANVAS");

  ctx.fillStyle = "#FFC838";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  circle(ctx, 980, 105, 320, "#FFDD7A");
  circle(ctx, 30, 890, 210, "#F6B21B");
  circle(ctx, 1040, 1500, 175, "#FFDD7A");

  trackedLabel(ctx, "人生护照", 90, 145, 30, 9, "#26211B", "left", 900);
  trackedLabel(ctx, "LIFE PASSPORT", 990, 145, 27, 12, "#26211B", "right", 700);

  label(ctx, data.name, 90, 405, fitFont(ctx, data.name, 106, 900, 62), "#26211B", "left", 900);

  const identityText = `${data.colorName} · ${data.identity.toUpperCase()}`;
  ctx.font = `800 38px -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif`;
  const identityWidth = Math.min(900, Math.ceil(ctx.measureText(identityText).width) + 150);
  roundedRect(ctx, 90, 470, identityWidth, 90, 45, "#FFF9F0");
  circle(ctx, 143, 515, 19, data.colorHex);
  label(ctx, identityText, 183, 528, 38, "#26211B", "left", 800);

  trackedLabel(ctx, "最终总分 · FINAL SCORE", 90, 710, 30, 10, "#26211B", "left", 800);
  label(ctx, String(data.score), 80, 1068, fitFont(ctx, String(data.score), 310, 430, 220), "#26211B", "left", 900);
  roundedRect(ctx, 535, 895, 410, 104, 52, "#26211B");
  label(ctx, `全场第 ${data.rank} 名`, 740, 966, 42, "#FFC838", "center", 900);

  roundedRect(ctx, 90, 1270, 900, 445, 58, "#FFF9F0");
  label(ctx, "「我的恩典够你用的」", 145, 1395, 45, "#26211B", "left", 900);
  label(ctx, "My grace is sufficient for you", 145, 1470, 31, "#26211B", "left", 700);
  trackedLabel(ctx, "哥林多后书 12:9 · 2 CORINTHIANS 12:9", 145, 1545, 21, 2, "#9A8766", "left", 800);
  dashedLine(ctx, 145, 1592, 935, "#CBB997");
  label(ctx, "You don't have to do life alone.", 145, 1665, 31, "#F25C3D", "left", 800);

  label(ctx, data.orgZh, 90, 1810, 24, "#26211B", "left", 900);
  trackedLabel(ctx, data.orgEn.toUpperCase(), 90, 1852, 20, 1.5, "#26211B", "left", 700);
  label(ctx, data.date, 990, 1832, 25, "#26211B", "right", 800);

  /* The <img> keeps the data URL: a long press saves it in WeChat, which a
     blob: URL cannot be trusted to do. The Blob is what the share sheet takes. */
  const url = canvas.toDataURL("image/png", 1);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
  if (!blob) throw new Error("NO_BLOB");
  return { url, blob };
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign,
  weight: number,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function trackedLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  tracking: number,
  color: string,
  align: "left" | "right",
  weight: number,
) {
  ctx.save();
  ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  const glyphs = Array.from(text);
  const widths = glyphs.map((glyph) => ctx.measureText(glyph).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + tracking * Math.max(0, glyphs.length - 1);
  let cursor = align === "right" ? x - total : x;
  glyphs.forEach((glyph, index) => {
    ctx.fillText(glyph, cursor, y);
    cursor += widths[index] + tracking;
  });
  ctx.restore();
}

function dashedLine(ctx: CanvasRenderingContext2D, x1: number, y: number, x2: number, color: string) {
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([12, 10]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, max: number, width: number, min: number): number {
  let size = max;
  while (size > min) {
    ctx.font = `900 ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
    if (ctx.measureText(text).width <= width) break;
    size -= 2;
  }
  return size;
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "").trim() || "玩家";
}
