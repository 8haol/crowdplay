/* Contrast helpers. Team colours are picked for distinctiveness across a room,
   not for legibility, so every surface painted with one has to derive its own
   text colour instead of assuming a light or dark background. */

const INK = "#26211b";
const CREAM = "#fff9f0";

function channels(hex: string): [number, number, number] | null {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  const [r, g, b] = [0, 2, 4].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
  );
  return [r, g, b];
}

export function luminance(hex: string): number {
  const rgb = channels(hex);
  if (!rgb) return 1;
  const linear = rgb.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Whichever of black / white reads better on `hex`. */
export function readableOn(hex: string): "#000000" | "#FFFFFF" {
  const l = luminance(hex);
  return contrastRatio(l, 0) >= contrastRatio(l, 1) ? "#000000" : "#FFFFFF";
}

/** `hex` if it is legible on cream paper, otherwise the brand ink. */
export function inkOnCream(hex: string): string {
  if (!channels(hex)) return INK;
  return contrastRatio(luminance(hex), luminance(CREAM)) >= 4.5 ? hex : INK;
}

/** Blend `hex` toward white by `amount` (0-1). Used for tinted surfaces. */
export function lighten(hex: string, amount: number): string {
  const rgb = channels(hex);
  if (!rgb) return hex;
  const mixed = rgb.map((value) => Math.round((value + (1 - value) * amount) * 255));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** Blend `hex` toward black by `amount` (0-1). Used for pressed shadows. */
export function darken(hex: string, amount: number): string {
  const rgb = channels(hex);
  if (!rgb) return hex;
  const mixed = rgb.map((value) => Math.round(value * (1 - amount) * 255));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
