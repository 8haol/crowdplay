import type { Copy } from "../theme/copy";
import { useCopy, useTheme } from "../theme/ThemeProvider";
import type { ThemeId } from "../theme/themes";
import { cssVar } from "../lib/color";
import { createElement, useEffect, useMemo, useRef, useState, type FC } from "react";
import { Link } from "react-router-dom";
import type { PollResult } from "../lib/types";
import { colorOf, soloColor } from "../lib/types";
import { ActionButton, ErrorBanner } from "../lib/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { RetryIcon, SecretIcon } from "../theme/StampIcons";
import { visaPages, type VisaPage } from "./Passport";

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
  const copy = useCopy();
  const theme = useTheme();
  const themeId = theme.id;
  const [keepsake, setKeepsake] = useState<Keepsake | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [saveGuide, setSaveGuide] = useState(false);
  const [generatedAt] = useState(() => Date.now());
  const cardRef = useRef<HTMLDivElement>(null);
  const player = data.player;
  const identity = copy.identity[player.identity ?? "solo"];
  const playerColor = colorOf(player.color_group, copy) ?? soloColor(player.code, copy);
  const eventDate = useMemo(
    () => {
      const date = new Date(data.started_at ?? generatedAt);
      return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
    },
    [data.started_at, generatedAt],
  );
  const secretDone = data.full_moon?.secret_done ?? false;
  /* 每枚章带着它自己的图标：主摊位按顺序取本主题的七枚，隐藏摊位盖过才补第八枚。 */
  const stamps = useMemo<BadgeStamp[]>(() => {
    const pages = visaPages(data.stations ?? [], data.attempts ?? [], theme);
    const icons = theme.stampIcons;
    const main = pages.map((page, i) => ({
      page,
      icon: page.state === "retry" ? RetryIcon : icons.length ? icons[i % icons.length] : null,
    }));
    return secretDone
      ? [...main, { page: { key: "secret", title: copy.secretTeaser, note: "SECRET", state: "passed", score: 6 }, icon: SecretIcon, secret: true }]
      : main;
  }, [data.stations, data.attempts, theme, secretDone, copy.secretTeaser]);
  const filename = useMemo(() => `${copy.card}-${safeFilename(player.name)}.png`, [player.name, copy.card]);

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
      orgZh: data.org?.name_zh ?? copy.cardTitleCase,
      orgEn: data.org?.name_en ?? copy.cardTitleCase,
      stamps,
      stationsDone: player.stations_done,
      stationsTotal: player.stations_total,
    }, copy, themeId)
      .then(({ url, blob }) => {
        if (!active) return;
        setKeepsake({ url, file: new File([blob], filename, { type: "image/png" }) });
      })
      .catch((e: unknown) => { console.error("badge render failed", e); if (active) setError("纪念徽章生成失败，请刷新后再试"); });
    return () => { active = false; };
  }, [copy, themeId, data.org?.name_en, data.org?.name_zh, rank, eventDate, filename, identity.name, player.name, player.score, playerColor.hex, playerColor.zh, stamps, player.stations_done, player.stations_total]);

  const sharePayload = useMemo<ShareData | null>(
    () =>
      keepsake
        ? {
            title: `${player.name} 的${copy.keepsakeName}`,
            text: "You don't have to do life alone",
            files: [keepsake.file],
          }
        : null,
    [keepsake, player.name, copy.keepsakeName],
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
          <p className="text-[10px] font-black tracking-[0.4em] text-foil-dim">{copy.shareTitle}</p>
          <h1 className="mt-2 text-[22px] font-black tracking-[-0.03em]">分享图（长按保存 · 发朋友圈）</h1>
          <p className="mt-2 text-sm font-semibold text-ink-dim">你的姓名、同行身份、{copy.score}与全场名次都已写进这一程。</p>
        </div>

        <div
          ref={cardRef}
          className={`mt-5 overflow-hidden rounded-[18px] shadow-[0_5px_0_var(--color-foil-shadow)] ${saveGuide ? "ring-4 ring-seal" : ""}`}
        >
          {keepsake ? (
            <img
              src={keepsake.url}
              alt={`${player.name} 的${copy.keepsakeName}：${player.score} 分，全场第 ${rank} 名`}
              className="block h-auto w-full"
              width={WIDTH}
              height={HEIGHT}
            />
          ) : (
            <div className="grid aspect-[9/16] place-items-center bg-accent">
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
            <div className="rounded-2xl bg-night px-4 py-4 shadow-[0_3px_0_var(--color-foil-shadow)]">
              <p className="text-[10px] font-black tracking-[0.3em] text-foil-dim">保存图片 · 发给朋友</p>
              <ol className="mt-3 space-y-2 text-sm font-bold text-accent-deep">
                <li>1 · 长按上面那张{copy.cardShort}图片</li>
                <li>2 · 选择「保存图片」到相册</li>
                <li>3 · {IN_WECHAT ? "回到聊天或朋友圈，把它发出去" : "在微信里把它发给朋友"}</li>
              </ol>
              {IN_WECHAT && (
                <p className="mt-3 text-xs font-semibold leading-5 text-accent-deep">
                  也可以点右上角「···」，把这一页发给朋友。
                </p>
              )}
            </div>
          )}
          {hint && <div className="rounded-2xl bg-accent-soft px-4 py-3 text-sm font-bold text-accent-deep">{hint}</div>}
          <ActionButton onClick={share} disabled={!keepsake}>
            {canOpenShareSheet ? `分享这张${copy.card}` : "保存图片 · 发给朋友"}
          </ActionButton>
          {!IN_WECHAT && (
            <ActionButton variant="tool-ghost" onClick={save} disabled={!keepsake}>下载 PNG</ActionButton>
          )}
          <Link to="/play" className="pressable block w-full rounded-full px-5 py-3 text-center text-sm font-black text-ink-dim">
            ← 返回结算页
          </Link>
          <p className="px-4 text-center text-xs font-semibold leading-5 text-ink-dim">
            微信中建议直接长按图片保存。分享图不包含你的{copy.lifeNo}。
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
  stamps: BadgeStamp[];
  stationsDone: number;
  stationsTotal: number;
};

type BadgeStamp = { page: VisaPage; icon: FC<{ className?: string }> | null; secret?: boolean };

async function renderBadge(data: BadgeData, copy: Copy, theme: ThemeId = "passport"): Promise<{ url: string; blob: Blob }> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("NO_CANVAS");

  if (theme === "midautumn") {
    const icons = await loadStampIcons(data.stamps);
    drawMidautumnBadge(ctx, data, copy, icons);
  } else {
    drawPassportBadge(ctx, data, copy);
  }

  /* The <img> keeps the data URL: a long press saves it in WeChat, which a
     blob: URL cannot be trusted to do. The Blob is what the share sheet takes. */
  const url = canvas.toDataURL("image/png", 1);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
  if (!blob) throw new Error("NO_BLOB");
  return { url, blob };
}

/* 中秋：天空渐变、左上一轮月、底部两层海浪，中间一张白卡承载全部信息。取色全走 token。 */
function drawMidautumnBadge(ctx: CanvasRenderingContext2D, data: BadgeData, copy: Copy, icons: (HTMLImageElement | null)[]) {
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, cssVar("--color-sky-top"));
  sky.addColorStop(0.55, cssVar("--color-night"));
  sky.addColorStop(1, cssVar("--color-night-raise"));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  /* moon with a soft halo */
  const halo = ctx.createRadialGradient(230, 300, 240, 230, 300, 520);
  const paperHalo = cssVar("--color-card");
  halo.addColorStop(0, withAlpha(paperHalo, 0.55));
  halo.addColorStop(1, withAlpha(paperHalo, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, WIDTH, 900);
  const moon = ctx.createRadialGradient(150, 220, 20, 230, 300, 300);
  moon.addColorStop(0, cssVar("--color-stage-orb-light"));
  moon.addColorStop(0.6, cssVar("--color-foil"));
  moon.addColorStop(1, cssVar("--color-stage-orb-deep"));
  circle(ctx, 230, 300, 300, moon);

  /* two waves along the bottom */
  wave(ctx, 1420, 90, cssVar("--color-wave-a"));
  wave(ctx, 1560, 60, cssVar("--color-wave-b"));

  /* the card */
  const ink = cssVar("--color-ink");
  const dim = cssVar("--color-ink-dim");
  roundedRect(ctx, 90, 520, 900, 1170, 58, cssVar("--color-card"));
  trackedLabel(ctx, copy.card, 150, 620, 34, 6, ink, "left", 900);
  trackedLabel(ctx, copy.cardEn, 930, 616, 24, 10, dim, "right", 800);

  label(ctx, data.name, 150, 770, fitFont(ctx, data.name, 104, 780, 60), ink, "left", 900);
  const identityText = `${data.colorName} · ${data.identity.toUpperCase()}`;
  ctx.font = `800 36px -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif`;
  const identityWidth = Math.min(780, Math.ceil(ctx.measureText(identityText).width) + 140);
  roundedRect(ctx, 150, 815, identityWidth, 84, 42, cssVar("--color-accent-soft"));
  circle(ctx, 200, 857, 18, data.colorHex);
  label(ctx, identityText, 236, 870, 36, cssVar("--color-accent-deep"), "left", 800);

  trackedLabel(ctx, `${copy.score} · ${copy.scoreEn}`, 150, 990, 28, 8, dim, "left", 800);
  label(ctx, String(data.score), 140, 1200, fitFont(ctx, String(data.score), 220, 380, 160), cssVar("--color-moon"), "left", 900);
  roundedRect(ctx, 560, 1080, 370, 96, 48, cssVar("--color-accent"));
  label(ctx, `全场第 ${data.rank} 名`, 745, 1146, 40, cssVar("--color-accent-ink"), "center", 900);

  dashedLine(ctx, 150, 1250, 930, cssVar("--color-line"));
  drawStampRow(ctx, data, copy, icons, 1250);

  dashedLine(ctx, 150, 1545, 930, cssVar("--color-line"));
  label(ctx, "「我的恩典够你用的」", 150, 1610, 36, ink, "left", 900);
  label(ctx, "You don't have to do life alone.", 150, 1657, 26, cssVar("--color-leaf-deep"), "left", 800);

  /* footer on the waves */
  const paper = cssVar("--color-card");
  label(ctx, data.orgZh, 90, 1790, 26, paper, "left", 900);
  trackedLabel(ctx, data.orgEn.toUpperCase(), 90, 1834, 20, 1.5, paper, "left", 700);
  label(ctx, data.date, 990, 1802, 26, paper, "right", 800);
  trackedLabel(ctx, copy.cardTagline || copy.game, 990, 1850, 20, 2, paper, "right", 700);
}

/* 集章一栏：标题行写已集几枚，下面一排章，章下写摊位名。和集章卡主面板同一套配色。 */
function drawStampRow(ctx: CanvasRenderingContext2D, data: BadgeData, copy: Copy, icons: (HTMLImageElement | null)[], top: number) {
  const dim = cssVar("--color-ink-dim");
  trackedLabel(ctx, `集章 · ${copy.cardEn.replace(/^MOON /, "")}`, 150, top + 70, 28, 8, dim, "left", 800);
  label(ctx, `已集 ${data.stationsDone} / ${data.stationsTotal}`, 930, top + 70, 30, cssVar("--color-leaf-deep"), "right", 900);

  const n = data.stamps.length;
  if (!n) return;
  const span = 780;
  const gap = n > 7 ? 12 : 16;
  const size = Math.min(104, (span - gap * (n - 1)) / n);
  const r = size / 2;
  const cy = top + 110 + r + 6;
  data.stamps.forEach((stamp, i) => {
    const cx = 150 + r + i * (size + gap);
    const tone = stampTone(stamp);
    circle(ctx, cx, cy, r, tone.fill);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = tone.ring;
    if (tone.dashed) ctx.setLineDash([8, 7]);
    ctx.stroke();
    ctx.restore();

    const icon = icons[i];
    if (icon) {
      const s = size * 0.56;
      ctx.drawImage(icon, cx - s / 2, cy - s / 2, s, s);
    }

    const pill = stamp.page.state === "passed" ? `+${stamp.page.score}` : stamp.page.state === "failed" ? "✕" : null;
    if (pill) {
      ctx.font = `900 22px -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif`;
      const w = Math.max(40, ctx.measureText(pill).width + 18);
      const px = cx + r - w + 12;
      const py = cy - r - 10;
      roundedRect(ctx, px, py, w, 32, 16, tone.ring);
      label(ctx, pill, px + w / 2, py + 24, 22, cssVar("--color-card"), "center", 900);
    }

    const name = stamp.page.title;
    const nameSize = fitFont(ctx, name, 22, size + gap - 4, 14);
    label(ctx, name, cx, cy + r + 38, nameSize, stamp.page.state === "blank" ? dim : cssVar("--color-ink"), "center", 800);
  });
}

function stampTone(stamp: BadgeStamp): { ring: string; fill: string; icon: string; dashed: boolean } {
  if (stamp.secret) {
    return { ring: cssVar("--color-accent-deep"), fill: cssVar("--color-accent-soft"), icon: cssVar("--color-accent-deep"), dashed: false };
  }
  switch (stamp.page.state) {
    case "passed":
      return { ring: cssVar("--color-pass"), fill: cssVar("--color-pass-soft"), icon: cssVar("--color-pass"), dashed: false };
    case "failed":
      return { ring: cssVar("--color-fail"), fill: cssVar("--color-fail-soft"), icon: cssVar("--color-fail"), dashed: false };
    case "retry":
      return { ring: cssVar("--color-ink-dim"), fill: cssVar("--color-card"), icon: cssVar("--color-ink-dim"), dashed: true };
    default:
      return { ring: cssVar("--color-line"), fill: cssVar("--color-card"), icon: cssVar("--color-line"), dashed: true };
  }
}

/* 印章图标是 React 线稿（currentColor），画进 canvas 前先按章的颜色转成 SVG 图片。 */
async function loadStampIcons(stamps: BadgeStamp[]): Promise<(HTMLImageElement | null)[]> {
  return Promise.all(
    stamps.map(async (stamp) => {
      if (!stamp.icon) return null;
      const markup = renderToStaticMarkup(createElement(stamp.icon))
        .replace("<svg", `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" color="${stampTone(stamp).icon}"`);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      try {
        await img.decode();
        return img;
      } catch {
        return null;
      }
    }),
  );
}

/** `#rrggbb` → `rgba(r, g, b, a)`; canvas gradients cannot take relative colour syntax on older phones. */
function withAlpha(hex: string, alpha: number): string {
  /* 生产构建会把 #ffffff 压成 #fff；认不出就退回不透明，月晕会铺满上半张图。 */
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex.trim());
  if (short) hex = `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function wave(ctx: CanvasRenderingContext2D, top: number, amplitude: number, fill: string) {
  ctx.beginPath();
  ctx.moveTo(0, top + amplitude);
  ctx.bezierCurveTo(WIDTH * 0.2, top - amplitude, WIDTH * 0.35, top - amplitude, WIDTH * 0.5, top + amplitude * 0.4);
  ctx.bezierCurveTo(WIDTH * 0.68, top + amplitude * 1.6, WIDTH * 0.85, top + amplitude * 0.6, WIDTH, top - amplitude * 0.4);
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.lineTo(0, HEIGHT);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawPassportBadge(ctx: CanvasRenderingContext2D, data: BadgeData, copy: Copy) {

  ctx.fillStyle = cssVar("--color-accent");
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  circle(ctx, 980, 105, 320, cssVar("--color-stage-orb-light"));
  circle(ctx, 30, 890, 210, cssVar("--color-stage-orb-deep"));
  circle(ctx, 1040, 1500, 175, cssVar("--color-stage-orb-light"));

  trackedLabel(ctx, copy.card, 90, 145, 30, 9, cssVar("--color-moon"), "left", 900);
  trackedLabel(ctx, copy.cardEn, 990, 145, 27, 12, cssVar("--color-moon"), "right", 700);

  label(ctx, data.name, 90, 405, fitFont(ctx, data.name, 106, 900, 62), cssVar("--color-moon"), "left", 900);

  const identityText = `${data.colorName} · ${data.identity.toUpperCase()}`;
  ctx.font = `800 38px -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif`;
  const identityWidth = Math.min(900, Math.ceil(ctx.measureText(identityText).width) + 150);
  roundedRect(ctx, 90, 470, identityWidth, 90, 45, cssVar("--color-night"));
  circle(ctx, 143, 515, 19, data.colorHex);
  label(ctx, identityText, 183, 528, 38, cssVar("--color-moon"), "left", 800);

  trackedLabel(ctx, `最终${copy.score} · ${copy.scoreEn}`, 90, 710, 30, 10, cssVar("--color-moon"), "left", 800);
  label(ctx, String(data.score), 80, 1068, fitFont(ctx, String(data.score), 310, 430, 220), cssVar("--color-moon"), "left", 900);
  roundedRect(ctx, 535, 895, 410, 104, 52, cssVar("--color-moon"));
  label(ctx, `全场第 ${data.rank} 名`, 740, 966, 42, cssVar("--color-accent"), "center", 900);

  roundedRect(ctx, 90, 1270, 900, 445, 58, cssVar("--color-night"));
  label(ctx, "「我的恩典够你用的」", 145, 1395, 45, cssVar("--color-moon"), "left", 900);
  label(ctx, "My grace is sufficient for you", 145, 1470, 31, cssVar("--color-moon"), "left", 700);
  trackedLabel(ctx, "哥林多后书 12:9 · 2 CORINTHIANS 12:9", 145, 1545, 21, 2, cssVar("--color-badge-caption"), "left", 800);
  dashedLine(ctx, 145, 1592, 935, cssVar("--color-badge-line"));
  label(ctx, "You don't have to do life alone.", 145, 1665, 31, cssVar("--color-seal-deep"), "left", 800);

  label(ctx, data.orgZh, 90, 1810, 24, cssVar("--color-moon"), "left", 900);
  trackedLabel(ctx, data.orgEn.toUpperCase(), 90, 1852, 20, 1.5, cssVar("--color-moon"), "left", 700);
  label(ctx, data.date, 990, 1832, 25, cssVar("--color-moon"), "right", 800);
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

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string | CanvasGradient) {
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
