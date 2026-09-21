import { cssVar } from "./color";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

/*
 * `level` 是纠错等级，等级越高格子越密。同一条链接 M 级要 33×33 格，L 级只要
 * 29×29 —— 印在同样大的框里，每格就大了一成四，后排举手机才扫得到。大屏上的码
 * 干净、没有磨损也不会被手指挡住，L 级的 7% 冗余够用；管理端那张是给人凑近扫或
 * 打印出来的，留在 M。
 */
export function JoinQr({ url, level = "M", className = "" }: {
  url: string;
  level?: "L" | "M" | "Q" | "H";
  className?: string;
}) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      width: 1080,
      margin: 2,
      color: { dark: cssVar("--color-ink"), light: cssVar("--color-card") },
      errorCorrectionLevel: level,
    }).then((data) => { if (!cancelled) setSrc(data); });
    return () => { cancelled = true; };
  }, [url, level]);

  return src ? (
    <img className={className} src={src} alt="扫码加入当前游戏" width="1080" height="1080" />
  ) : (
    <div className={`animate-pulse bg-line ${className}`} aria-label="正在生成二维码" />
  );
}
