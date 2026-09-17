/**
 * 全站经文的唯一来源。
 *
 * 设计纲领定的调子是「信仰元素温和不说教」，所以这里的原则不是数量而是位置：
 * 每一句都应该由当下刚发生的事赚来 —— 恩典用掉了、这一站失手了、走到最后一段
 * 人生了 —— 而不是铺在背景上。选句一律避开审判和教义辩论，只留安慰和同行，
 * 因为迎新会当晚房间里坐着大量第一次接触教会的人。
 *
 * 改词只改这个文件；呈现处不硬写任何经文。
 */

import { useEffect, useState } from "react";

export interface Verse {
  /** 和合本经文。不带书名号 —— 引号由呈现处按版面决定。 */
  text: string;
  /** 中文出处，例如「哥林多后书 12:9」。 */
  ref: string;
  /** 英文出处。只有大屏、徽章这类双语版面才会用到。 */
  refEn: string;
}

/**
 * 恩典。玩家用掉 Grace Token 之后，这句话留在那张卡原来的位置上。
 * 和结算页、颁奖末屏、纪念徽章是同一句 —— 那是整场活动的核心句，
 * 重复是有意的。
 */
export const GRACE_VERSE: Verse = {
  text: "我的恩典够你用的",
  ref: "哥林多后书 12:9",
  refEn: "2 CORINTHIANS 12:9",
};

/**
 * 失手。整队没过一站时弹出。多备几句是为了一晚上连摔两次的队伍
 * 不会收到一模一样的安慰 —— 那会让话显得是自动播放的。
 */
export const SETBACK_VERSES: Verse[] = [
  { text: "义人虽七次跌倒，仍必兴起", ref: "箴言 24:16", refEn: "PROVERBS 24:16" },
  { text: "但那等候耶和华的必从新得力", ref: "以赛亚书 40:31", refEn: "ISAIAH 40:31" },
  { text: "耶和华靠近伤心的人", ref: "诗篇 34:18", refEn: "PSALM 34:18" },
];

/** 最后一段人生的开场屏。走到这里，话该往"交托"上收。 */
export const FINAL_STAGE_VERSE: Verse = {
  text: "你们要将一切忧虑卸给神，因为他顾念你们",
  ref: "彼得前书 5:7",
  refEn: "1 PETER 5:7",
};

/**
 * 候场区和大屏的轮播。
 *
 * 硬规则：这里的句子不能对玩家的处境下判语。大屏是投给整个房间的，
 * 没有任何个人上下文，而场上一定有 Solo —— 迟到的人会自动变成 Solo，
 * 人数除不尽时也会有人被分成 Solo。传道书 4:9「两个人总比一个人好」
 * 曾经排在这里第一位，因为它贴合「不是独自通关」这个内核；但那句话
 * 作为设计师文案是在讲这场活动，印成投影上的经文就成了对独行玩家的
 * 排名。身份揭晓屏明明写着「独行也不是孤单」，大屏不能转头拆掉它。
 *
 * 换成希伯来书 13:5：同样是「你不会独自走」，但同行的是神而不是队友，
 * 所以 Solo 玩家是被包含进来，而不是被比下去。
 */
export const AMBIENT_VERSES: Verse[] = [
  { text: "我总不撇下你，也不丢弃你", ref: "希伯来书 13:5", refEn: "HEBREWS 13:5" },
  { text: "凡劳苦担重担的人，可以到我这里来", ref: "马太福音 11:28", refEn: "MATTHEW 11:28" },
  { text: "你的话是我脚前的灯，路上的光", ref: "诗篇 119:105", refEn: "PSALM 119:105" },
  { text: "与喜乐的人要同乐", ref: "罗马书 12:15", refEn: "ROMANS 12:15" },
  { text: "耶和华是我的牧者，我必不致缺乏", ref: "诗篇 23:1", refEn: "PSALM 23:1" },
];

/**
 * 从一组经文里挑一句。用 seed 而不是 Math.random()，这样同一次失手
 * 在重渲染时拿到的是同一句话，不会在玩家眼前跳字。
 */
export function pickVerse(pool: Verse[], seed: string): Verse {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return pool[Math.abs(hash) % pool.length];
}

/**
 * 候场区和大屏共用的轮播。放在这个文件里是为了守住「改词只改一处」——
 * 呈现处只管排版，不管有几句、多久换一次。
 *
 * 开了「减少动态效果」的人会停在第一句：会自己换的字也是动效。
 */
export function useAmbientVerse(intervalMs = 9000): Verse {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((value) => value + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return AMBIENT_VERSES[index % AMBIENT_VERSES.length];
}
