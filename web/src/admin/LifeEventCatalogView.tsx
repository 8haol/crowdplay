import { useMemo, useState } from "react";
import { errorText, rpc } from "../lib/api";
import type { LifeEventAudience, LifeEventCatalog, LifeEventChoiceDefinition, LifeEventOutcomeDefinition } from "../lib/types";
import { usePoll } from "../lib/usePoll";
import { PageTitle, Panel } from "./adminUi";

const AUDIENCE: Record<LifeEventAudience, { label: string; short: string }> = {
  all: { label: "所有人数", short: "通用" },
  solo: { label: "Solo 单人", short: "Solo" },
  duo: { label: "Duo 双人", short: "Duo" },
  trio: { label: "Trio 三人", short: "Trio" },
};

export function LifeEventCatalogView({ adminKey, preview }: { adminKey: string; preview?: boolean }) {
  const pollFn = useMemo(() => () => rpc<LifeEventCatalog>("admin_life_event_catalog", { p_admin_key: adminKey }), [adminKey]);
  const poll = usePoll<LifeEventCatalog>(preview ? null : pollFn, 60_000);
  const catalog = preview ? PREVIEW_CATALOG : poll.data;
  const [audience, setAudience] = useState<LifeEventAudience | "any">("any");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);

  const scenes = useMemo(() => (catalog?.scenes ?? []).filter((scene) => audience === "any" || scene.audience === audience).filter((scene) => {
    const haystack = [scene.title, scene.prompt, ...scene.choices.flatMap((choice) => [choice.label, ...choice.outcomes.flatMap((outcome) => [outcome.label, outcome.detail])])].join(" ").toLowerCase();
    return !search.trim() || haystack.includes(search.trim().toLowerCase());
  }), [audience, catalog, search]);

  const selected = scenes.find((scene) => scene.key === selectedKey) ?? scenes[0] ?? null;
  const activeChoice = selected?.choices.some((choice) => choice.key === selectedChoice) ? selectedChoice : selected?.choices[0]?.key ?? null;

  if (!catalog) return <div className="grid min-h-[55dvh] place-items-center"><div className="max-w-md text-center">{poll.error ? <><div className="text-3xl font-black">事件库读取失败</div><p className="mt-3 text-sm font-semibold leading-6 text-catalog-label">{errorText(poll.error)}</p><button className="mt-5 rounded-xl bg-ink px-5 py-3 text-sm font-black text-white" onClick={poll.refresh}>重新读取</button></> : <div className="dots text-xl font-black">正在整理全部人生事件<span>.</span><span>.</span><span>.</span></div>}</div></div>;

  return <div className="space-y-7">
    <PageTitle
      eyebrow="内容审核"
      title="人生事件库"
      description="逐条审核玩家看到的场景与行动，以及全部随机结果、出现概率和分数影响。玩家端不会收到这张结果表。"
      actions={
        /* Same payload, no password — the link to hand to volunteers who need
           to proof-read the script but should not hold the admin key. */
        <a
          href="/library"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg px-3 py-2 text-xs font-black"
          style={{ background: "var(--color-card)", border: "1px solid var(--color-admin-panel-line)" }}
        >
          打开可分享的审核页 /library ↗
        </a>
      }
    />

    <section className="grid grid-cols-3 gap-3 lg:grid-cols-6">
      <CatalogMetric label="场景" value={catalog.stats.scenes} />
      <CatalogMetric label="行动" value={catalog.stats.choices} />
      <CatalogMetric label="随机结果" value={catalog.stats.outcomes} />
      {(["all", "solo", "duo"] as const).map((key) => <CatalogMetric key={key} label={AUDIENCE[key].short} value={catalog.stats.by_audience[key] ?? 0} muted />)}
    </section>

    {preview && <div className="rounded-xl border border-catalog-preview-line bg-catalog-preview-soft px-4 py-3 text-sm font-bold text-catalog-preview-ink">开发预览仅放入代表性样本；管理员登录后的正式页面会读取数据库中的全部场景。</div>}

    <Panel className="overflow-hidden">
      <div className="grid border-b border-admin-line bg-admin-panel-alt lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="border-b border-admin-line p-4 lg:border-r lg:border-b-0">
          <input className="w-full rounded-xl border border-admin-input-line bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-catalog-input-focus" placeholder="搜索场景、行动或结果" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="flex gap-1 overflow-x-auto p-3">
          <FilterButton active={audience === "any"} onClick={() => setAudience("any")}>全部 {catalog.stats.scenes}</FilterButton>
          {(Object.keys(AUDIENCE) as LifeEventAudience[]).map((key) => <FilterButton key={key} active={audience === key} onClick={() => setAudience(key)}>{AUDIENCE[key].short} {catalog.stats.by_audience[key] ?? 0}</FilterButton>)}
        </div>
      </div>

      <div className="grid min-h-[44rem] lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="max-h-[70dvh] overflow-y-auto border-b border-admin-line bg-white lg:border-r lg:border-b-0">
          {scenes.map((scene, index) => <button key={scene.key} className={`flex w-full items-start gap-3 border-b border-admin-line-soft px-4 py-4 text-left transition-colors ${selected?.key === scene.key ? "bg-catalog-selected" : "hover:bg-catalog-hover"}`} onClick={() => setSelectedKey(scene.key)}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-catalog-icon text-xl">{scene.emoji}</span>
            <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><b className="truncate text-sm">{scene.title}</b><small className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-black text-catalog-audience-ink">{AUDIENCE[scene.audience].short}</small></span><span className="mt-1 block text-xs font-semibold text-catalog-meta-ink">{scene.choices.length} 个行动 · {scene.choices.reduce((sum, choice) => sum + choice.outcomes.length, 0)} 个结果</span></span>
            <span className="tabular mt-1 text-[10px] font-bold text-catalog-number-ink">{String(index + 1).padStart(2, "0")}</span>
          </button>)}
          {scenes.length === 0 && <div className="p-10 text-center text-sm font-bold text-catalog-meta-ink">没有匹配的场景</div>}
        </aside>

        {selected && <main className="min-w-0 bg-admin-bg p-4 sm:p-6 xl:p-8">
          <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[18rem_minmax(0,1fr)] xl:items-start">
            <section className="xl:sticky xl:top-32">
              <div className="overflow-hidden rounded-[28px] border border-admin-line-strong bg-event-paper shadow-[0_4px_0_var(--color-catalog-preview-shadow)]">
                <div className="bg-ink px-5 py-3 text-[10px] font-black tracking-[0.2em] text-white">玩家手机预览</div>
                <div className="p-5">
                  <div className="mx-auto grid h-16 w-16 place-items-center rounded-[20px] bg-catalog-accent text-3xl shadow-[0_3px_0_var(--color-catalog-accent-shadow)]">{selected.emoji}</div>
                  <div className="mt-5 text-center text-[10px] font-black tracking-[0.18em] text-catalog-eyebrow-ink">LIFE EVENT · {AUDIENCE[selected.audience].label}</div>
                  <h2 className="mt-1 text-center text-2xl font-black tracking-[-0.04em]">{selected.title}</h2>
                  <p className="mt-4 text-sm font-bold leading-6 text-catalog-prompt-ink">{selected.prompt}</p>
                  <div className="mt-5 space-y-2">{selected.choices.map((choice, index) => <button key={choice.key} className={`flex w-full items-center gap-3 rounded-xl border-2 px-3 py-3 text-left text-sm font-black ${activeChoice === choice.key ? "border-ink bg-ink text-white" : "border-admin-input-line bg-white"}`} onClick={() => setSelectedChoice(choice.key)}><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-catalog-accent/25 text-xs">{index + 1}</span>{choice.label}</button>)}</div>
                  <p className="mt-4 text-center text-[11px] font-semibold leading-5 text-catalog-meta-ink">同一个行动每次可能出现不同结果</p>
                </div>
              </div>
            </section>

            <section className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-admin-line-strong pb-5"><div><div className="text-xs font-black tracking-[0.14em] text-catalog-meta-ink">{AUDIENCE[selected.audience].label} · {selected.key}</div><h2 className="mt-1 text-3xl font-black tracking-[-0.04em]">全部随机结果</h2></div><span className={`rounded-lg px-3 py-2 text-xs font-black ${selected.active ? "bg-catalog-enabled-soft text-catalog-enabled-ink" : "bg-admin-neutral text-catalog-inactive-ink"}`}>{selected.active ? "启用中" : "已停用"}</span></div>
              <div className="mt-5 space-y-5">{selected.choices.map((choice, index) => <ChoiceAudit key={choice.key} choice={choice} index={index} active={activeChoice === choice.key} onSelect={() => setSelectedChoice(choice.key)} />)}</div>
            </section>
          </div>
        </main>}
      </div>
    </Panel>
  </div>;
}

function CatalogMetric({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return <div className={`rounded-[16px] border border-admin-line p-4 ${muted ? "bg-catalog-icon" : "bg-white"}`}><div className="text-[10px] font-black tracking-[0.12em] text-catalog-label">{label}</div><div className="tabular mt-2 text-3xl font-black tracking-[-0.05em]">{value}</div></div>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`shrink-0 rounded-lg px-3 py-2 text-xs font-black ${active ? "bg-ink text-white" : "bg-white text-catalog-inactive-ink hover:bg-admin-neutral"}`} onClick={onClick}>{children}</button>;
}

function ChoiceAudit({ choice, index, active, onSelect }: { choice: LifeEventChoiceDefinition; index: number; active: boolean; onSelect: () => void }) {
  const total = choice.outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
  return <section className={`overflow-hidden rounded-[18px] border bg-white ${active ? "border-catalog-accent-shadow ring-3 ring-catalog-accent/18" : "border-admin-line"}`}>
    <button className="flex w-full items-center gap-3 border-b border-admin-line-soft px-4 py-3.5 text-left" onClick={onSelect}><span className="grid h-8 w-8 place-items-center rounded-full bg-catalog-accent/25 text-sm font-black">{index + 1}</span><span className="font-black">行动：{choice.label}</span><span className="ml-auto text-xs font-bold text-catalog-meta-ink">{choice.outcomes.length} 种结果</span></button>
    <div>{choice.outcomes.map((outcome) => <OutcomeRow key={outcome.key} outcome={outcome} probability={total > 0 ? outcome.weight / total : 0} />)}</div>
  </section>;
}

function OutcomeRow({ outcome, probability }: { outcome: LifeEventOutcomeDefinition; probability: number }) {
  const tone = { good: ["好结果", "bg-outcome-good-soft text-outcome-good-ink"], bad: ["坏结果", "bg-outcome-bad-soft text-outcome-bad-ink"], neutral: ["中性", "bg-admin-neutral text-outcome-neutral-ink"] }[outcome.tone];
  return <div className="grid gap-3 border-b border-admin-line-soft px-4 py-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_6rem_7.5rem] sm:items-center">
    <div><div className="flex flex-wrap items-center gap-2"><b className="text-sm">{outcome.label}</b><span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${tone[1]}`}>{tone[0]}</span></div><p className="mt-1 text-xs font-semibold leading-5 text-catalog-detail-ink">{outcome.detail}</p></div>
    <div className="sm:text-right"><div className="text-[10px] font-black text-catalog-stat-ink">随机概率</div><div className="tabular mt-0.5 font-black">{Math.round(probability * 100)}%</div></div>
    <div className="sm:text-right"><div className="text-[10px] font-black text-catalog-stat-ink">分数结果</div><div className="tabular mt-0.5 font-black">{effectOf(outcome)}</div></div>
  </div>;
}

function effectOf(outcome: LifeEventOutcomeDefinition): string {
  const parts: string[] = [];
  if (outcome.multiplier != null && outcome.multiplier !== 100) parts.push(`总分 ×${outcome.multiplier / 100}`);
  if (outcome.delta) parts.push(`${outcome.delta > 0 ? "+" : ""}${outcome.delta} 分`);
  return parts.length ? parts.join("，") : "分数不变";
}

const makeOutcome = (key: string, label: string, detail: string, delta: number, weight: number, tone: LifeEventOutcomeDefinition["tone"], multiplier?: number): LifeEventOutcomeDefinition => ({ key, label, detail, delta, weight, tone, ...(multiplier ? { multiplier } : {}) });

const PREVIEW_CATALOG_RAW: LifeEventCatalog = {
  stats: { scenes: 4, choices: 8, outcomes: 24, by_audience: { all: 1, solo: 1, duo: 1, trio: 1 } },
  scenes: [
    { key: "all_last_bus", audience: "all", title: "末班车刚刚开走", prompt: "你站在陌生的站牌下，手机只剩 8% 电。今晚要怎么回去？", emoji: "🚌", active: true, sort_order: 1, choices: [{ key: "walk", label: "沿着地图走回去", outcomes: [makeOutcome("shortcut", "发现河边近路", "绕开拥堵，还看到一段漂亮夜景。", 9, 20, "good"), makeOutcome("rain", "突然下起大雨", "鞋袜湿透，回程比想象中狼狈。", -6, 60, "bad"), makeOutcome("company", "遇见同路的人", "一路聊天，陌生城市没那么陌生。", 6, 20, "good")] }, { key: "taxi", label: "叫一辆出租车", outcomes: [makeOutcome("share", "有人提出拼车", "车费减半，还交换了旅行故事。", 6, 25, "good"), makeOutcome("surge", "遇到高峰加价", "安全到家，但钱包有点受伤。", -3, 60, "bad"), makeOutcome("driver", "司机送你到门口", "一次可靠的选择结束了慌乱。", 3, 15, "good")] }] },
    { key: "solo_blackout", audience: "solo", title: "单人公寓突然停电", prompt: "夜里整栋楼停电，你独自在房间，外面也没有明显动静。", emoji: "🕯️", active: true, sort_order: 105, choices: [{ key: "check", label: "带手电去楼道查看", outcomes: [makeOutcome("neighbors", "邻居们正一起找原因", "大家分工，很快联系到物业。", 6, 20, "good"), makeOutcome("stair", "在楼梯上崴到脚", "问题没找到，行动还变得更慢。", -6, 60, "bad"), makeOutcome("switch", "只是自家开关跳闸", "你第一次独立解决了这个问题。", 9, 20, "good")] }, { key: "wait", label: "留在房里等待恢复", outcomes: [makeOutcome("stars", "窗外星星突然很清楚", "没有电的半小时安静得难得。", 6, 20, "good"), makeOutcome("long", "停电持续到凌晨", "手机没电，冰箱也开始升温。", 0, 60, "bad", 50), makeOutcome("call", "一通久违的电话陪你等完", "黑暗反而让一段关系重新连上。", 9, 20, "good")] }] },
    { key: "duo_menu", audience: "duo", title: "双人默契菜单", prompt: "你们必须背对背各选一道菜；选中同一道就有隐藏奖励。", emoji: "🍜", active: true, sort_order: 203, choices: [{ key: "favorite", label: "各自选自己最想吃的", outcomes: [makeOutcome("match", "答案完全一致", "原来你们的默契藏在胃里。", 9, 35, "good"), makeOutcome("different", "一个辣一个甜", "完全不同，但正好可以交换着尝。", 3, 45, "neutral"), makeOutcome("soldout", "两道菜都刚好售罄", "默契还没验证，厨房先给了答案。", -3, 20, "bad")] }, { key: "predict", label: "猜队友会选什么", outcomes: [makeOutcome("readmind", "准确猜中队友", "对方惊讶得重新看了你一眼。", 9, 30, "good"), makeOutcome("both", "两人都在猜对方", "交叉错过，却成了最好笑的结果。", 3, 45, "neutral"), makeOutcome("assume", "猜测和现实差很远", "你发现自己其实还不够了解对方。", -3, 25, "bad")] }] },
    { key: "trio_vote", audience: "trio", title: "三人投票僵局", prompt: "你们要在三个方案里选一个，恰好每个人支持不同选项。", emoji: "🗳️", active: true, sort_order: 301, choices: [{ key: "pitch", label: "每人用二十秒推销方案", outcomes: [makeOutcome("consensus", "一个理由说服所有人", "被理解比赢得投票更重要。", 9, 35, "good"), makeOutcome("louder", "推销变成抢话", "每个人都说得更多，听得更少。", -6, 25, "bad"), makeOutcome("merge", "拼出第四个方案", "没有任何人全赢，却比原选项都好。", 6, 40, "good")] }, { key: "random", label: "交给随机转盘决定", outcomes: [makeOutcome("fun", "抽中的方案意外好玩", "三个人都放松下来。", 6, 40, "good"), makeOutcome("blame", "结果不好开始怪运气", "没有人负责，也没有人满意。", -3, 35, "bad"), makeOutcome("jackpot", "转盘触发隐藏选项", "一个惊喜改变了整天。", 9, 25, "good")] }] },
  ],
};

// Keep the development preview under the same probability invariant as the
// database migration, so reviewers never see a misleading old distribution.
const PREVIEW_CATALOG: LifeEventCatalog = {
  ...PREVIEW_CATALOG_RAW,
  scenes: PREVIEW_CATALOG_RAW.scenes.map((scene) => ({
    ...scene,
    choices: scene.choices.map((choice) => {
      const isPositive = (outcome: LifeEventOutcomeDefinition) =>
        (outcome.multiplier ?? 100) > 100
        || ((outcome.multiplier ?? 100) === 100 && (outcome.delta ?? 0) > 0);
      const positiveTotal = choice.outcomes.filter(isPositive).reduce((sum, outcome) => sum + outcome.weight, 0);
      const nonpositiveTotal = choice.outcomes.filter((outcome) => !isPositive(outcome)).reduce((sum, outcome) => sum + outcome.weight, 0);
      return {
        ...choice,
        outcomes: choice.outcomes.map((outcome) => {
          const positive = isPositive(outcome);
          const weight = positive
            ? Math.max(1, Math.floor(outcome.weight * 40 / Math.max(1, positiveTotal)))
            : Math.max(1, Math.ceil(outcome.weight * 60 / Math.max(1, nonpositiveTotal)));
          const tone = positive
            ? "good"
            : (outcome.multiplier ?? 100) < 100 || (outcome.delta ?? 0) < 0
              ? "bad"
              : "neutral";
          return { ...outcome, weight, tone };
        }),
      };
    }),
  })),
};
