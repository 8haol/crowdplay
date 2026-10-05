import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { errorText, rpc } from "../lib/api";
import type {
  LifeEventAudience, LifeEventCatalog, LifeEventChoiceDefinition,
  LifeEventOutcomeDefinition, LifeEventSceneDefinition,
} from "../lib/types";
import { UpLink } from "../lib/ui";
import { useScrollMemory } from "../lib/useScrollMemory";

/*
 * /library — the whole life-event script on one page, for proof-reading.
 *
 * Reads `life_event_library()`, the same payload the admin console audits, so a
 * scene edited in the database shows up here and nowhere can drift. No password:
 * volunteers get sent a link and read. That does mean the hidden outcome tables
 * are readable by anyone with the URL, which is why this route is linked from
 * /guide and /admin only, never from a player screen.
 *
 * Unlike the admin view (master-detail, one scene at a time) this is a linear
 * document: every scene in order, everything expanded, because the job here is to
 * read all of it rather than look one thing up. Theme-specific scenes (中秋) sit
 * after the shared ones and carry a dark tag, so a volunteer proof-reading for one
 * event can filter down to what that event will actually draw.
 */

const COLUMN = "mx-auto w-full max-w-[52rem] px-5 sm:px-7";
const SCROLL_KEY = "lp_library_scroll";

const AUDIENCE: Record<LifeEventAudience, { short: string; long: string }> = {
  all: { short: "通用", long: "所有人都可能抽到" },
  solo: { short: "Solo", long: "只发给单人玩家" },
  duo: { short: "Duo", long: "只发给两人同行" },
  trio: { short: "Trio", long: "只发给三人同行" },
};

type Filter = LifeEventAudience | "any";
/** `shared` = 各主题通用的场景；其余是主题 id。 */
type ThemeFilter = "any" | "shared" | "midautumn";
const THEME_LABEL: Record<string, string> = { midautumn: "中秋" };

export default function LibraryPage() {
  const [catalog, setCatalog] = useState<LifeEventCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("any");
  const [themeFilter, setThemeFilter] = useState<ThemeFilter>("any");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    rpc<LifeEventCatalog>("life_event_library", {})
      .then((result) => { if (active) setCatalog(result); })
      .catch((cause) => { if (active) setError(errorText(cause)); });
    return () => { active = false; };
  }, []);

  const scenes = useMemo(() => {
    const all = catalog?.scenes ?? [];
    const needle = search.trim().toLowerCase();
    return all
      .filter((scene) => filter === "any" || scene.audience === filter)
      .filter((scene) => themeFilter === "any" || (themeFilter === "shared" ? !scene.theme : scene.theme === themeFilter))
      .filter((scene) => !needle || haystack(scene).includes(needle));
  }, [catalog, filter, themeFilter, search]);

  useScrollMemory(SCROLL_KEY, Boolean(catalog));

  return (
    /* No overflow-x here: any overflow value other than visible turns this into
       the scrollport for `position: sticky` descendants, which silently stopped
       the header below from sticking. The decorative layer clips itself. */
    <div className="relative min-h-dvh bg-desk text-ink">
      <div className="night-sky" />

      <div className="relative z-10">
        <div
          className="sticky top-0 z-30 backdrop-blur-xl"
          style={{ background: "rgb(from var(--color-night) r g b / .94)", borderBottom: "1px solid var(--color-line)" }}
        >
          <div className={COLUMN}>
            <div className="flex items-center gap-2.5 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-ink">
              <UpLink label="说明页" to="/guide" />
              <span className="hidden truncate text-[14px] font-black text-ink sm:inline">人生事件库</span>
              {catalog && (
                <span className="tabular ml-auto shrink-0 text-[13px] font-bold text-ink/60">
                  {scenes.length}/{catalog.scenes.length} 个场景
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-2.5">
              <input
                className="min-h-11 min-w-[10rem] flex-1 rounded-full bg-white px-4 text-[14px] font-semibold outline-none focus:shadow-[0_0_0_3px_var(--color-accent)]"
                style={{ border: "1px solid var(--color-line)" }}
                placeholder="搜索场景 / 行动 / 结果"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="tool-scroll flex max-w-full shrink-0 gap-1.5 overflow-x-auto">
                {(["any", "all", "solo", "duo", "trio"] as Filter[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className="inline-flex min-h-10 shrink-0 items-center rounded-full px-3.5 text-[13.5px] font-black transition-colors"
                    style={
                      filter === key
                        ? { background: "var(--color-ink)", color: "var(--color-card)" }
                        : { background: "var(--color-card)", color: "var(--color-guide-tab-ink)", border: "1px solid var(--color-line)" }
                    }
                  >
                    {key === "any" ? "全部" : AUDIENCE[key].short}
                  </button>
                ))}
                <span aria-hidden="true" className="mx-0.5 w-px shrink-0 self-stretch" style={{ background: "var(--color-line)" }} />
                {(["shared", "midautumn"] as const).map((key) => {
                  const count = catalog?.stats.by_theme?.[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setThemeFilter(themeFilter === key ? "any" : key)}
                      className="inline-flex min-h-10 shrink-0 items-center rounded-full px-3.5 text-[13.5px] font-black transition-colors"
                      style={
                        themeFilter === key
                          ? { background: "var(--color-ink)", color: "var(--color-card)" }
                          : { background: "var(--color-card)", color: "var(--color-guide-tab-ink)", border: "1px solid var(--color-line)" }
                      }
                    >
                      {key === "shared" ? "通用" : THEME_LABEL[key]}
                      {count !== undefined && <span className="tabular ml-1 opacity-70">{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <header className={`${COLUMN} pt-9`}>
          <p className="text-[11px] font-black tracking-[0.38em] text-foil-dim">
            CROWDPLAY · 内容审核
          </p>
          <h1 className="mt-2.5 text-[clamp(2rem,7.5vw,3.2rem)] font-black leading-[1.08] tracking-[-0.045em]">
            全部人生事件
          </h1>
          <p className="mt-4 text-[15px] font-semibold leading-7 text-ink-dim">
            玩家看到的场景和两个行动，以及每个行动背后<b className="text-ink">全部随机结果、出现概率和分数影响</b>。
            这一页直接读数据库，和现场跑的内容永远一致。
          </p>
          <div
            className="mt-5 rounded-[16px] px-4 py-3.5"
            style={{ background: "var(--color-admin-danger-soft)", border: "1px solid var(--color-staff-danger-line)" }}
          >
            <div className="text-[11px] font-black tracking-[0.14em] text-seal">仅供同工审核</div>
            <p className="mt-1 text-[13px] font-bold leading-6">
              这是玩家永远看不到的结果表 —— 结果由服务器随机抽取。请只发给同工，不要发到玩家群里。
            </p>
          </div>

          {catalog && (
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Metric label="场景" value={catalog.stats.scenes} />
              <Metric label="行动" value={catalog.stats.choices} />
              <Metric label="随机结果" value={catalog.stats.outcomes} />
            </div>
          )}
        </header>

        <main className={`${COLUMN} pt-8 pb-16`}>
          {error && (
            <div className="rounded-[18px] bg-white p-6 text-center" style={{ border: "1px solid var(--color-line)" }}>
              <div className="text-[17px] font-black">读不到事件库</div>
              <p className="mt-2 text-[13px] font-semibold leading-6 text-ink-dim">{error}</p>
              <button
                type="button"
                className="pressable mt-4 rounded-full bg-ink px-5 py-2.5 text-sm font-black text-white"
                onClick={() => window.location.reload()}
              >
                重新读取
              </button>
            </div>
          )}

          {!catalog && !error && (
            <div className="dots py-16 text-center text-[15px] font-black text-ink-dim">
              正在读取全部人生事件<span>.</span><span>.</span><span>.</span>
            </div>
          )}

          {catalog && scenes.length === 0 && (
            <div className="py-16 text-center text-[15px] font-black text-ink-dim">没有匹配的场景</div>
          )}

          <div className="space-y-4">
            {scenes.map((scene, index) => (
              <Scene key={scene.key} scene={scene} index={index + 1} />
            ))}
          </div>

          <div className="mt-12 flex flex-wrap gap-2">
            <Link
              to="/guide"
              className="pressable rounded-full bg-ink px-5 py-3 text-sm font-black text-white shadow-[0_3px_0_var(--color-ink-shadow)]"
            >
              ← 回到同工说明页
            </Link>
            <Link
              to="/play?preview=lock"
              className="pressable rounded-full bg-white px-5 py-3 text-sm font-black shadow-[0_2px_0_var(--color-foil-shadow)]"
            >
              看玩家手机上的效果 →
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[14px] bg-white px-3 py-3" style={{ border: "1px solid var(--color-line)" }}>
      <div className="text-[10px] font-black tracking-[0.12em] text-ink-dim">{label}</div>
      <div className="tabular mt-1 text-[1.6rem] font-black leading-none tracking-[-0.04em]">{value}</div>
    </div>
  );
}

function Scene({ scene, index }: { scene: LifeEventSceneDefinition; index: number }) {
  const audience = AUDIENCE[scene.audience];
  return (
    <article className="overflow-hidden rounded-[20px] bg-white" style={{ border: "1px solid var(--color-line)" }}>
      <div className="flex items-start gap-3 px-4 py-4 sm:px-5" style={{ background: "var(--color-staff-accent-soft)" }}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-white text-2xl shadow-[0_2px_0_var(--color-foil-shadow)]">
          {scene.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular text-[11px] font-black text-foil-dim">
              {String(index).padStart(2, "0")}
            </span>
            <h2 className="text-[17px] font-black leading-tight">{scene.title}</h2>
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-black"
              style={{ background: "var(--color-card)", color: "var(--color-accent-deep)", border: "1px solid var(--color-line)" }}
            >
              {audience.short}
            </span>
            {scene.theme && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-black"
                style={{ background: "var(--color-ink)", color: "var(--color-card)" }}
              >
                {THEME_LABEL[scene.theme] ?? scene.theme}
              </span>
            )}
            {!scene.active && (
              <span className="rounded-md bg-night-raise px-1.5 py-0.5 text-[10px] font-black text-ink-dim">
                已停用
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13.5px] font-semibold leading-6">{scene.prompt}</p>
          <p className="mt-1 text-[11px] font-bold text-ink-dim">
            {scene.theme ? `只在${THEME_LABEL[scene.theme] ?? scene.theme}主题的场次出现 · ` : ""}
            {audience.long} · {scene.choices.length} 个行动 ·{" "}
            {scene.choices.reduce((sum, choice) => sum + choice.outcomes.length, 0)} 个随机结果
          </p>
        </div>
      </div>

      <div className="divide-y" style={{ borderColor: "var(--color-guide-line)" }}>
        {scene.choices.map((choice, choiceIndex) => (
          <Choice key={choice.key} choice={choice} index={choiceIndex + 1} />
        ))}
      </div>
    </article>
  );
}

function Choice({ choice, index }: { choice: LifeEventChoiceDefinition; index: number }) {
  const total = choice.outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
  return (
    <section className="px-4 py-4 sm:px-5">
      <div className="flex items-center gap-2.5">
        <span
          className="tabular grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black"
          style={{ background: "var(--color-accent)", color: "var(--color-ink)" }}
        >
          {index}
        </span>
        <h3 className="min-w-0 text-[14.5px] font-black">行动：{choice.label}</h3>
      </div>

      <ul className="mt-3 space-y-2">
        {choice.outcomes.map((outcome) => (
          <Outcome
            key={outcome.key}
            outcome={outcome}
            probability={total > 0 ? outcome.weight / total : 0}
          />
        ))}
      </ul>
    </section>
  );
}

const TONE: Record<LifeEventOutcomeDefinition["tone"], { label: string; bg: string; ink: string }> = {
  good: { label: "好结果", bg: "var(--color-outcome-good-soft)", ink: "var(--color-outcome-good-ink)" },
  bad: { label: "坏结果", bg: "var(--color-outcome-bad-soft)", ink: "var(--color-outcome-bad-ink)" },
  neutral: { label: "中性", bg: "var(--color-admin-neutral)", ink: "var(--color-outcome-neutral-ink)" },
};

function Outcome({
  outcome,
  probability,
}: {
  outcome: LifeEventOutcomeDefinition;
  probability: number;
}) {
  const tone = TONE[outcome.tone];
  return (
    <li className="rounded-[14px] px-3.5 py-3" style={{ background: "var(--color-admin-panel-alt)", border: "1px solid var(--color-guide-line)" }}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <b className="text-[13.5px]">{outcome.label}</b>
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-black"
          style={{ background: tone.bg, color: tone.ink }}
        >
          {tone.label}
        </span>
      </div>
      <p className="mt-1 text-[12.5px] font-semibold leading-5 text-ink-dim">{outcome.detail}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] font-black">
        <span className="tabular">
          <span className="text-ink-dim">概率 </span>
          {Math.round(probability * 100)}%
        </span>
        <span className="tabular">
          <span className="text-ink-dim">分数 </span>
          {effectOf(outcome)}
        </span>
      </div>
    </li>
  );
}

function effectOf(outcome: LifeEventOutcomeDefinition): string {
  const parts: string[] = [];
  if (outcome.multiplier != null && outcome.multiplier !== 100) {
    parts.push(`总分 ×${outcome.multiplier / 100}`);
  }
  if (outcome.delta) parts.push(`${outcome.delta > 0 ? "+" : ""}${outcome.delta} 分`);
  return parts.length ? parts.join(" · ") : "不变";
}

function haystack(scene: LifeEventSceneDefinition): string {
  return [
    scene.title,
    scene.prompt,
    ...scene.choices.flatMap((choice) => [
      choice.label,
      ...choice.outcomes.flatMap((outcome) => [outcome.label, outcome.detail]),
    ]),
  ]
    .join(" ")
    .toLowerCase();
}
