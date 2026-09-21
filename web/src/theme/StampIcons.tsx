import type { FC } from "react";

/*
 * 中秋集章卡的七枚印章图标，逐一从 design-previews/midautumn-mockup.html 的
 * <defs> 里搬过来。线稿单色、走 currentColor；填充区用 0.18 的透明度，这样
 * 印章位换成通过 / 未通过 / 空位的颜色时，图标自己会跟着变。
 */
type IconProps = { className?: string };

function Frame({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const MoonIcon: FC<IconProps> = ({ className }) => (
  <Frame className={className}>
    <circle cx="24" cy="24" r="15" fill="currentColor" opacity=".18" stroke="none" />
    <circle cx="24" cy="24" r="15" />
    <path d="M28 12a13 13 0 0 0 0 24" />
  </Frame>
);

export const MooncakeIcon: FC<IconProps> = ({ className }) => (
  <Frame className={className}>
    <rect x="9" y="12" width="30" height="24" rx="8" fill="currentColor" opacity=".18" stroke="none" />
    <rect x="9" y="12" width="30" height="24" rx="8" />
    <circle cx="24" cy="24" r="5" />
    <path d="M14 24h5M29 24h5M24 14v5M24 29v5" />
  </Frame>
);

export const RabbitIcon: FC<IconProps> = ({ className }) => (
  <Frame className={className}>
    <path d="M17 26c-3-6-4-14-1-15 3 0 5 6 6 12M31 26c3-6 4-14 1-15-3 0-5 6-6 12" />
    <ellipse cx="24" cy="31" rx="11" ry="8" fill="currentColor" opacity=".18" stroke="none" />
    <ellipse cx="24" cy="31" rx="11" ry="8" />
    <circle cx="20" cy="30" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="28" cy="30" r="1.4" fill="currentColor" stroke="none" />
  </Frame>
);

export const OsmanthusIcon: FC<IconProps> = ({ className }) => (
  <Frame className={className}>
    <g fill="currentColor" opacity=".18" stroke="none">
      <circle cx="24" cy="15" r="6" />
      <circle cx="33" cy="21" r="6" />
      <circle cx="30" cy="31" r="6" />
      <circle cx="18" cy="31" r="6" />
      <circle cx="15" cy="21" r="6" />
    </g>
    <circle cx="24" cy="15" r="6" />
    <circle cx="33" cy="21" r="6" />
    <circle cx="30" cy="31" r="6" />
    <circle cx="18" cy="31" r="6" />
    <circle cx="15" cy="21" r="6" />
    <circle cx="24" cy="24" r="3.5" fill="currentColor" stroke="none" />
  </Frame>
);

export const LanternIcon: FC<IconProps> = ({ className }) => (
  <Frame className={className}>
    <path d="M20 9h8M22 9v3M26 9v3" />
    <ellipse cx="24" cy="24" rx="11" ry="12" fill="currentColor" opacity=".18" stroke="none" />
    <ellipse cx="24" cy="24" rx="11" ry="12" />
    <path d="M19 13v22M29 13v22" strokeWidth="1.6" opacity=".6" />
    <path d="M22 36v4M26 36v4M24 36v5" />
  </Frame>
);

export const TeacupIcon: FC<IconProps> = ({ className }) => (
  <Frame className={className}>
    <path d="M11 18h22v8a9 9 0 0 1-9 9h-4a9 9 0 0 1-9-9z" fill="currentColor" opacity=".18" stroke="none" />
    <path d="M11 18h22v8a9 9 0 0 1-9 9h-4a9 9 0 0 1-9-9z" />
    <path d="M33 21h3a4 4 0 0 1 0 8h-3" />
    <path d="M12 40h20" />
    <path d="M19 10c0 3-3 3-3 6M25 10c0 3-3 3-3 6" strokeWidth="1.8" />
  </Frame>
);

export const StarIcon: FC<IconProps> = ({ className }) => (
  <Frame className={className}>
    <path d="M24 8l4.6 10.2 11.1 1.2-8.3 7.5 2.4 10.9L24 32.3l-9.8 5.5 2.4-10.9-8.3-7.5 11.1-1.2z" fill="currentColor" opacity=".18" stroke="none" />
    <path d="M24 8l4.6 10.2 11.1 1.2-8.3 7.5 2.4 10.9L24 32.3l-9.8 5.5 2.4-10.9-8.3-7.5 11.1-1.2z" />
  </Frame>
);

/** 再挑战：一枚待盖的印章位上画的回转箭头。 */
export const RetryIcon: FC<IconProps> = ({ className }) => (
  <Frame className={className}>
    <path d="M33 20a11 11 0 1 0 3 9" strokeWidth="2.4" />
    <path d="M34 12v8h-8" strokeWidth="2.4" />
  </Frame>
);

/** 神秘惊喜：一轮带光环的满月，只在隐藏摊位盖过章之后出现。 */
export const SecretIcon: FC<IconProps> = ({ className }) => (
  <Frame className={className}>
    <circle cx="24" cy="24" r="19" strokeWidth="1.6" opacity=".45" strokeDasharray="3 4" />
    <circle cx="24" cy="24" r="12" fill="currentColor" opacity=".18" stroke="none" />
    <circle cx="24" cy="24" r="12" />
    <path d="M24 3v3M24 42v3M3 24h3M42 24h3" strokeWidth="1.8" opacity=".7" />
  </Frame>
);

// 七枚图标的固定顺序与图标本身放在一起；主题表按它循环取用。
// eslint-disable-next-line react/only-export-components
export const MIDAUTUMN_STAMPS: FC<IconProps>[] = [
  MoonIcon,
  MooncakeIcon,
  RabbitIcon,
  OsmanthusIcon,
  LanternIcon,
  TeacupIcon,
  StarIcon,
];
