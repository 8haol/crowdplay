export type AwardKey = "lucky" | "unlucky" | "rollercoaster" | "steady_heart" | "fastest";

export interface Copy {
  card: string;
  cardEn: string;
  game: string;
  station: string;
  stationList: string;
  stationUnit: string;
  lifeEvent: string;
  lifeEventEyebrow: string;
  graceToken: string;
  graceStation: string;
  score: string;
  scoreEn: string;
  progress: string;
  startGame: string;
  lifeNo: string;
  lifeNoEn: string;
  identity: Record<"solo" | "duo" | "trio", { short: string; name: string; desc: string }>;
  journeyComplete: string;
  joinTitle: string;
  joinSubtitle: string;
  joinIntro: string;
  cardTagline: string;
  endedTitle: string;
  endedBody: string;
  graceLine: string;
  shareTitle: string;
  awards: Record<AwardKey, { title: string; subtitle: string }>;
}

export const PASSPORT_COPY: Copy = {
  // Passport.tsx / Join.tsx / KeepsakeBadge.tsx: existing labels, unchanged.
  card: "人生护照",
  cardEn: "LIFE PASSPORT",
  game: "人生模拟游戏", // App.tsx introduction.
  station: "站点",
  stationList: "挑战", // `${n} ${stationUnit}${stationList}` = 「N 站挑战」.
  stationUnit: "站",
  lifeEvent: "人生事件",
  lifeEventEyebrow: "LIFE EVENT",
  graceToken: "Grace Token",
  graceStation: "恩典站",
  score: "总分",
  scoreEn: "FINAL SCORE",
  progress: "进度", // GuidePage.tsx / guideContent.tsx; no standalone player label yet.
  startGame: "开始游戏", // PlayPage.tsx reveal button (arrow stays in the component).
  lifeNo: "人生编号",
  lifeNoEn: "LIFE NO.",
  // Former IDENTITY_SHORT / IDENTITY_ZH values in lib/types.ts.
  identity: {
    solo: { short: "独行", name: "Solo 独立同行", desc: "无需寻找队友，独立完成七个站点。" },
    duo: { short: "二人", name: "Duo 二人同行", desc: "举起手机，找到另一位组队颜色相同的玩家。" },
    trio: { short: "三人", name: "Trio 三人同行", desc: "举起手机，找到另外两位组队颜色相同的玩家。" },
  },
  journeyComplete: "JOURNEY COMPLETE",
  // Join.tsx's actual heading; its dynamic game title precedes the subtitle.
  joinTitle: "领取人生编号",
  joinSubtitle: "填写姓名即可，联系方式选填",
  joinIntro: "", // The current Join page has no introduction paragraph.
  cardTagline: "",
  endedTitle: "这是你走过的人生", // Passport.tsx: Ended.
  // Passport.tsx: FinishedCard's spent-token paragraph; <br /> becomes a newline.
  // The available-token branch remains conditional in the page.
  endedBody: "Token 也已经用掉了 —— 这一程你没有独自走完。\n接下来找个位置歇一会儿，等主持人宣布最终成绩和颁奖。",
  graceLine: "",
  shareTitle: "LIFE PASSPORT · SHARE",
  // Current _event_awards in 20260913000300_event_station_reads.sql.
  awards: {
    lucky: { title: "天选之子", subtitle: "人生事件加分最多" },
    unlucky: { title: "时运不济", subtitle: "人生事件扣分最多" },
    rollercoaster: { title: "人生过山车", subtitle: "同时经历了最高的加分和最重的扣分" },
    steady_heart: { title: "波澜不惊", subtitle: "经历过人生，却最稳得住" },
    fastest: { title: "最快通关", subtitle: "全场最先走完所有站点" },
  },
};

export const MIDAUTUMN_COPY: Copy = {
  card: "中秋集章卡",
  cardEn: "MOON STAMP CARD",
  game: "中秋游园会",
  station: "游园摊位",
  stationUnit: "摊",
  stationList: "位摊位",
  lifeEvent: "月下际遇",
  lifeEventEyebrow: "ENCOUNTER",
  graceToken: "同行求助券",
  graceStation: "恩典站",
  score: "游园积分",
  scoreEn: "FINAL SCORE",
  progress: "我的集章",
  startGame: "开始游园",
  lifeNo: "集章卡编号",
  lifeNoEn: "CARD NO.",
  identity: {
    solo: { short: "独自", name: "Solo 独自出发", desc: "无需寻找队友，独自逛完所有摊位。" },
    duo: { short: "两人", name: "Duo 两人同行", desc: "举起手机，找到另一位组队颜色相同的玩家。" },
    trio: { short: "三人", name: "Trio 三人结伴", desc: "举起手机，找到另外两位组队颜色相同的玩家。" },
  },
  journeyComplete: "游园完成",
  joinTitle: "中秋游园会",
  joinSubtitle: "月下相遇，一路同行。",
  joinIntro: "领取你的中秋集章卡，逛摊位、玩游戏、认识新朋友。收集一枚枚印章，也收获一段段相遇。在惊喜与挑战之间，一起发现陪伴的意义，想想什么让异乡有了家的感觉。",
  cardTagline: "收集月光下的相遇，留下属于你的中秋故事。",
  endedTitle: "游园会告一段落",
  endedBody: "今晚，你收集的不只是印章，还有相遇、欢笑与被帮助的时刻。游园会告一段落，对生命的探索仍在继续：什么让你感到被接纳？什么让一个地方成为家？",
  graceLine: "人生路上，你不必独自面对",
  shareTitle: "中秋集章卡 · SHARE",
  awards: {
    lucky: { title: "月下天选", subtitle: "月下际遇加分最多" },
    unlucky: { title: "时运不济", subtitle: "月下际遇扣分最多" },
    rollercoaster: { title: "潮起潮落", subtitle: "同时经历了最高的加分和最重的扣分" },
    steady_heart: { title: "波澜不惊", subtitle: "经历过际遇，却最稳得住" },
    fastest: { title: "最快逛完", subtitle: "全场最先走完所有摊位" },
  },
};
