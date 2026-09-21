import { cssVar } from "./color";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function JoinQr({ url, className = "" }: { url: string; className?: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      width: 720,
      margin: 2,
      color: { dark: cssVar("--color-ink"), light: cssVar("--color-card") },
      errorCorrectionLevel: "M",
    }).then((data) => { if (!cancelled) setSrc(data); });
    return () => { cancelled = true; };
  }, [url]);

  return src ? (
    <img className={className} src={src} alt="扫码加入当前游戏" width="720" height="720" />
  ) : (
    <div className={`animate-pulse bg-line ${className}`} aria-label="正在生成二维码" />
  );
}
