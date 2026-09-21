/*
 * 20260921000300_award_pool 之后 specials 只发 lucky / unlucky / comeback /
 * solo_star / grace_witness / median，队伍奖是 fastest / full_moon。旧 key
 * （rollercoaster / steady_heart）留着，已结束场次的旧 payload 还要能渲染。
 */
export type AwardKey =
  | "fastest"
  | "full_moon"
  | "lucky"
  | "unlucky"
  | "comeback"
  | "solo_star"
  | "grace_witness"
  | "median"
  | "rollercoaster"
  | "steady_heart";

export interface Copy {
  stageNames: [string, string, string];
  lifeEventLog: string;
  cardDocumentLabel: string;
  scoreUnit: string;
  stageIntroFinal: string;
  stageIntro: string;
  nextStage: string;
  stageUnit: string;
  recoverTitle: string;
  keepsakeName: string;
  stagesLabel: string;
  boardTitle: string;
  feedEmpty: string;
  stageShort: string;
  acceptStage: string;
  stageCheckpoint: string;
  openStage: string;
  loadingPlayer: string;
  loadingRecord: string;
  ceremonyIntro: string;
  cardShort: string;
  cardTitleCase: string;
  lifeEventBox: string;
  graceLabel: string;
  tokenShort: string;
  joinHeading: string;
  joinAction: string;
  issuingCard: string;
  queryCard: string;
  soloColorLabel: string;
  card: string;
  cardEn: string;
  game: string;
  station: string;
  stationList: string;
  stationUnit: string;
  /** 结束页统计行的量词：「7/7 站」/「7/7 摊位」。 */
  stationCountUnit: string;
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
  teamName: Record<"solo" | "duo" | "trio", string>;
  identity: Record<"solo" | "duo" | "trio", { short: string; name: string; desc: string }>;
  journeyComplete: string;
  joinTitle: string;
  joinSubtitle: string;
  joinIntro: string;
  /** 标题的展示写法（可含换行）；空串 = 用 joinTitle / joinHeading。 */
  joinTitleDisplay: string;
  joinCardTitle: string;
  joinCardEyebrow: string;
  endedSaveButton: string;
  endedGraceButton: string;
  cardTagline: string;
  endedTitle: string;
  endedBody: string;
  graceLine: string;
  shareTitle: string;
  awards: Record<AwardKey, { title: string; subtitle: string }>;
  /* Join.tsx: the two entry pills, the duplicate-name card, and the contact-based recovery tab. */
  joinEntryNew: string;
  joinEntryReturn: string;
  /** {name} / {hint} are filled in by the page. */
  duplicateAsk: string;
  duplicateYes: string;
  duplicateNo: string;
  recoverHaveCode: string;
  recoverForgotCode: string;
  recoverContactNote: string;
  recoverContactMiss: string;
  /* FullMoonMoment / MoonStampCard / ScreenPage feed: the hidden-station easter egg. */
  fullMoonTitle: string;
  fullMoonBody: string;
  secretTeaser: string;
  /** {team} is filled in by the board. */
  secretFeed: string;
  /* 队伍色是现场找人的功能色，也是揭晓页整屏的底色，所以连同色名一起归主题管。
     null = 用 lib/types.ts 里的默认表（人生护照那 24 色）。 */
  colors: Record<string, { hex: string; zh: string }> | null;
  soloColors: string[] | null;
  /** 揭晓页眉题：「组队颜色」/「个人颜色」在中秋是灯笼。 */
  revealTeamLabel: string;
  revealSoloLabel: string;
  /** 揭晓页的找人动作，{n} 是还要找几个人。 */
  revealFindTeam: string;
  revealFindSolo: string;
  /** 揭晓前那几秒的等待文案。 */
  revealLoading: string;
}

export const PASSPORT_COPY: Copy = {
  stageNames: ["第一段人生", "第二段人生", "最后一段人生"],
  lifeEventLog: "人生大事记",
  cardDocumentLabel: "人生旅行证件",
  scoreUnit: "人生分",
  stageIntroFinal: "走到这里，人生给你留了最后一道岔路。",
  stageIntro: "走到这个关口，人生递给你一件事。",
  nextStage: "下一段人生",
  stageUnit: "段人生",
  recoverTitle: "找回人生",
  keepsakeName: "人生纪念徽章",
  stagesLabel: "经历人生",
  boardTitle: "全场人生旅程",
  feedEmpty: "等待第一个人生瞬间",
  stageShort: "人生",
  acceptStage: "收下这段人生",
  stageCheckpoint: "人生关口",
  openStage: "打开这段人生",
  loadingPlayer: "正在读取你的人生",
  loadingRecord: "正在读取人生记录",
  ceremonyIntro: "接下来，我们一个一个看看这些人生",
  cardShort: "护照",
  cardTitleCase: "Life Passport",
  lifeEventBox: "人生盲盒",
  graceLabel: "GRACE",
  tokenShort: "Token",
  joinHeading: "领取人生编号",
  joinAction: "领取人生编号",
  issuingCard: "正在签发护照…",
  queryCard: "查询这本护照 →",
  soloColorLabel: "独行色",
  // Passport.tsx / Join.tsx / KeepsakeBadge.tsx: existing labels, unchanged.
  card: "人生护照",
  cardEn: "LIFE PASSPORT",
  game: "人生模拟游戏", // App.tsx introduction.
  station: "站点",
  stationList: "挑战", // `${n} ${stationUnit}${stationList}` = 「N 站挑战」.
  stationUnit: "站",
  stationCountUnit: "站",
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
  teamName: { solo: "独行同行", duo: "二人同行", trio: "三人同行" },
  // Former IDENTITY_SHORT / IDENTITY_ZH values in lib/types.ts.
  identity: {
    solo: { short: "独行", name: "Solo 独立同行", desc: "无需寻找队友，独立完成七个站点。" },
    duo: { short: "二人", name: "Duo 二人同行", desc: "举起手机，找到另一位组队颜色相同的玩家。" },
    trio: { short: "三人", name: "Trio 三人同行", desc: "举起手机，找到另外两位组队颜色相同的玩家。" },
  },
  journeyComplete: "JOURNEY COMPLETE",
  // Join.tsx keeps its original heading and dynamic event-title fallback.
  joinTitle: "", // Preserve the event-title fallback on the existing registration page.
  joinSubtitle: "填写姓名即可，联系方式选填",
  joinIntro: "", // The current Join page has no introduction paragraph.
  joinTitleDisplay: "",
  joinCardTitle: "现场登记",
  joinCardEyebrow: "ARRIVAL CARD",
  endedSaveButton: "生成我的纪念徽章 →",
  endedGraceButton: "去恩典站换纪念卡",
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
    full_moon: { title: "满月收集", subtitle: "拿下最多个满分" },
    comeback: { title: "月下逆袭", subtitle: "从最低谷追回来最多分" },
    solo_star: { title: "独行明星", subtitle: "独自走完，也走得漂亮" },
    grace_witness: { title: "恩典见证", subtitle: "用了 Grace Token，再挑战时拿下高分" },
    median: { title: "不偏不倚", subtitle: "分数正好落在全场正中间" },
  },
  joinEntryNew: "第一次来 · 现场登记",
  joinEntryReturn: "已经登记过 · 找回",
  duplicateAsk: "今晚已经有一位「{name}」领过护照（人生编号 {hint}）。是你吗？",
  duplicateYes: "是我，找回",
  duplicateNo: "不是我，新登记",
  recoverHaveCode: "我有编号",
  recoverForgotCode: "忘了编号",
  recoverContactNote: "没填过联系方式？找工作人员报名字，义工能查到你的人生编号。",
  recoverContactMiss: "没找到匹配的登记，检查名字和联系方式的写法",
  fullMoonTitle: "七站走完",
  fullMoonBody: "你的护照盖满了。还有一件事没有写在护照上。",
  secretTeaser: "神秘惊喜",
  secretFeed: "{team} 遇见了神秘人物",
  colors: null,
  soloColors: null,
  revealTeamLabel: "组队颜色",
  revealSoloLabel: "个人颜色",
  revealFindTeam: "举起手机，找 {n} 位同色队友",
  revealFindSolo: "无需组队，直接开始",
  revealLoading: "正在分配身份",
};

/*
 * 中秋的 24 个队伍色。色相顺序和默认表一一对应（red 还是红、teal 还是墨绿），
 * 换掉的是饱和度和名字：正红 #E02E24 那种荧光色摆在奶油黄月亮和青蓝海浪中间
 * 太跳，颁奖大屏整块铺开尤其难看。这里统一压到水彩纸上调得出来的浓度，
 * 名字换成当晚看得见摸得着的东西（灯笼、桂花、石榴、月饼馅），
 * 但仍然是「大色块 + 色名」一起出现，找人不靠单独认颜色。
 * 相邻两色的色相仍然拉开 ≥ 25°，大厅灯光下不会认错。
 */
const MIDAUTUMN_COLORS: Record<string, { hex: string; zh: string }> = {
  red: { hex: "#c9453c", zh: "灯笼" },
  violet: { hex: "#a892c8", zh: "藕荷" },
  pink: { hex: "#e890a6", zh: "桃酥" },
  rose: { hex: "#bf4060", zh: "石榴" },
  maroon: { hex: "#78303c", zh: "枣泥" },
  fuchsia: { hex: "#a8508e", zh: "紫苏" },
  purple: { hex: "#7d4fa8", zh: "夜合" },
  plum: { hex: "#4e2c66", zh: "暮紫" },
  indigo: { hex: "#5a5cb8", zh: "靛月" },
  navy: { hex: "#2b3a6b", zh: "夜空" },
  blue: { hex: "#2a62a8", zh: "深潮" },
  sky: { hex: "#63aed2", zh: "月光" },
  cyan: { hex: "#3e9aa4", zh: "潮青" },
  teal: { hex: "#2f6152", zh: "松影" },
  green: { hex: "#3a7845", zh: "桂叶" },
  mint: { hex: "#6dbf95", zh: "荷叶" },
  lime: { hex: "#8cb958", zh: "青柚" },
  olive: { hex: "#8f8f3f", zh: "秋草" },
  yellow: { hex: "#e8c145", zh: "桂花" },
  gold: { hex: "#b5893c", zh: "烤金" },
  orange: { hex: "#e8874a", zh: "柿子" },
  coral: { hex: "#8a5a3a", zh: "栗子" },
  amber: { hex: "#b3a684", zh: "芦苇" },
  emerald: { hex: "#85898c", zh: "青石" },
};

/* 独自出发的人也拿一盏灯：同一族陶土暖红，深浅不同，靠编号区分。
   这一族刻意不落在上面 24 色的任何一格里 —— 柿子、栗子、烤金都在更黄的一侧，
   免得 Duo / Trio 把独行的人错当成自己的队友举着灯找过来。 */
const MIDAUTUMN_SOLO_COLORS = [
  "#a85c4e", "#b86e5c", "#96503f", "#c4806c",
  "#9d5a46", "#b07463", "#8c4c3c", "#bd8570",
];

export const MIDAUTUMN_COPY: Copy = {
  stageNames: ["第一次际遇", "第二次际遇", "最后一次际遇"],
  lifeEventLog: "月下际遇记",
  cardDocumentLabel: "中秋游园凭证",
  scoreUnit: "游园积分",
  stageIntroFinal: "走到这里，月光下还留着最后一道岔路。",
  stageIntro: "走到这个摊位前，月色里递来一件事。",
  nextStage: "下一次际遇",
  stageUnit: "段际遇",
  recoverTitle: "找回集章卡",
  keepsakeName: "中秋纪念徽章",
  stagesLabel: "经历际遇",
  boardTitle: "全场游园进度",
  feedEmpty: "等待第一段月下相遇",
  stageShort: "际遇",
  acceptStage: "收下这段际遇",
  stageCheckpoint: "月下相遇",
  openStage: "打开这段际遇",
  loadingPlayer: "正在读取你的游园进度",
  loadingRecord: "正在读取游园记录",
  ceremonyIntro: "接下来，我们一个一个看看这些月下故事",
  cardShort: "集章卡",
  cardTitleCase: "中秋集章卡",
  lifeEventBox: "月下际遇",
  graceLabel: "同行求助券",
  tokenShort: "求助券",
  joinHeading: "中秋游园会",
  joinAction: "开始游园",
  issuingCard: "正在领取集章卡…",
  queryCard: "查询这张集章卡 →",
  soloColorLabel: "独行灯",
  card: "中秋集章卡",
  cardEn: "MOON STAMP CARD",
  game: "中秋游园会",
  station: "游园摊位",
  stationUnit: "个",
  stationList: "摊位", // With stationUnit, renders 「N 个摊位」.
  stationCountUnit: "摊位",
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
  teamName: { solo: "独自出发", duo: "两人同行", trio: "三人结伴" },
  identity: {
    solo: { short: "独自", name: "Solo 独自出发", desc: "无需寻找队友，独自逛完所有摊位。" },
    duo: { short: "两人", name: "Duo 两人同行", desc: "举起手机当灯笼，找到另一位灯笼色相同的玩家。" },
    trio: { short: "三人", name: "Trio 三人结伴", desc: "举起手机当灯笼，找到另外两位灯笼色相同的玩家。" },
  },
  journeyComplete: "游园完成",
  joinTitle: "中秋游园会",
  joinSubtitle: "月下相遇，一路同行。",
  joinTitleDisplay: "中秋游园会",
  joinCardTitle: "领取集章卡",
  joinCardEyebrow: "STAMP CARD",
  endedSaveButton: "保存我的集章卡",
  endedGraceButton: "去恩典站换纪念卡",
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
    full_moon: { title: "满月收集", subtitle: "收集了最多枚满分印章" },
    comeback: { title: "月下逆袭", subtitle: "从最低谷追回来最多分" },
    solo_star: { title: "独行明星", subtitle: "独自逛完，也逛得精彩" },
    grace_witness: { title: "恩典见证", subtitle: "用了同行求助券，再挑战时拿下高分" },
    median: { title: "不偏不倚", subtitle: "分数正好落在全场正中间" },
  },
  joinEntryNew: "第一次来 · 现场登记",
  joinEntryReturn: "已经登记过 · 找回",
  duplicateAsk: "今晚已经有一位「{name}」领过集章卡（集章卡编号 {hint}）。是你吗？",
  duplicateYes: "是我，找回",
  duplicateNo: "不是我，新登记",
  recoverHaveCode: "我有编号",
  recoverForgotCode: "忘了编号",
  recoverContactNote: "没填过联系方式？找工作人员报名字，义工能查到你的集章卡编号。",
  recoverContactMiss: "没找到匹配的登记，检查名字和联系方式的写法",
  fullMoonTitle: "月圆了",
  fullMoonBody: "七枚印章都亮了。今晚还有一件事，没有写在集章卡上。",
  secretTeaser: "神秘惊喜",
  secretFeed: "{team} 找到了神秘嘉宾",
  colors: MIDAUTUMN_COLORS,
  soloColors: MIDAUTUMN_SOLO_COLORS,
  revealTeamLabel: "组队灯笼色",
  revealSoloLabel: "你的灯笼色",
  revealFindTeam: "举起手机当灯笼，找 {n} 位同色的人",
  revealFindSolo: "一个人也有一盏灯，直接开逛",
  revealLoading: "正在点亮你的灯笼",
};
