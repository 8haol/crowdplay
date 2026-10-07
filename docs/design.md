# DESIGN.md — Life Passport visual system

## Color (OKLCH, no pure #000/#fff anywhere)

### Player world (brand register, Drenched: the surface IS the night)

| Token | OKLCH | Role |
|---|---|---|
| `night` | `oklch(0.21 0.04 265)` | The surface. Whole-screen midnight ink |
| `night-deep` | `oklch(0.16 0.035 265)` | Recessed panels, sky gradient base |
| `night-raise` | `oklch(0.26 0.045 265)` | Raised cards on night |
| `foil` | `oklch(0.78 0.12 85)` | Gold foil: numerals, seals, progress |
| `foil-dim` | `oklch(0.62 0.09 85)` | Secondary gold, borders |
| `moon` | `oklch(0.94 0.012 85)` | Primary text on night (warm off-white) |
| `moon-dim` | `oklch(0.72 0.02 265)` | Secondary text on night |
| `seal` | `oklch(0.56 0.17 25)` | Stamp red: fail stamps, lock world |
| `leaf` | `oklch(0.68 0.11 155)` | Pass green: pass stamps only |

Lock screen is its own drench: `seal` red floods the viewport.

### Tool world (product register, Restrained: warm paper + one ink accent)

| Token | OKLCH | Role |
|---|---|---|
| `desk` | `oklch(0.965 0.008 85)` | App background (warm paper) |
| `card` | `oklch(0.99 0.004 85)` | Raised surfaces |
| `line` | `oklch(0.88 0.012 85)` | Borders |
| `ink` | `oklch(0.28 0.045 265)` | Text + primary actions (passport navy) |
| `ink-dim` | `oklch(0.52 0.02 265)` | Secondary text |
| `seal` / `leaf` / `foil` | shared | Error / success / highlight states |

## Typography (system-only, no CDN)

- Sans: `-apple-system, "PingFang SC", "Noto Sans SC", "Microsoft YaHei"` —
  all UI, staff/admin everything.
- Display (player ceremony only): `"Songti SC", "Noto Serif SC", "SimSun",
  serif` at weight 900 for headlines and hero numerals.
- MRZ / passport code lines: `ui-monospace, "SF Mono", Menlo` — passport
  machine-readable-zone flavor only, never general UI.
- Scale: player display steps ×1.4+ (ceremony); tool UI steps ×1.2.
- Numerals: `font-variant-numeric: tabular-nums` everywhere data lives.

## Signature elements (what this is remembered by)

1. **The night passport**: starfield sky (pure CSS, two twinkle layers),
   gold-foil passport number with a sheen sweep, an MRZ line
   (`P<LIFE<<NAME<<<<0000<<<`) under the ID block.
2. **Visa stamps**: stations stamp in with a slam (scale 1.6→1, -8°),
   double-ring seal, ink texture. Green pass / red fail.
3. **Arrival card**: the join form is a light paper "入境登记卡 ARRIVAL CARD"
   floating on the night, with perforated ticket edges.

## The board surface (/screen)

Same night world, but landscape and read from across a room: type sized in `vw`
so it scales from a laptop to a 4K projector, column count derived from the
headcount so the whole room fits one screen, column-major order (first column
is the top of the standings, like an airport departures board). Motion is
strictly informational: a new ticker line slides in, a changed score flashes
gold for ~2s, the leader row breathes. Nothing else moves.

## Motion

- Easing tokens: `--ease-out-expo: cubic-bezier(0.16,1,0.3,1)` (entrances),
  `--ease-out-quart: cubic-bezier(0.25,1,0.5,1)` (micro), ease-in for exits.
- Player: orchestrated page-load (rise+fade, 600ms, 60ms stagger via `--i`),
  score odometer count-up (700ms), foil sheen sweep once on mount, stamp slam
  350ms, lock-screen seal slam + caution stripes.
- Tools: 150–250ms state transitions only. Press feedback `scale(0.98)`.
  No entrance choreography.
- `prefers-reduced-motion`: spatial motion collapses to fast crossfades.

## Bans (enforced)

No gradient text, no side-stripe borders, no glassmorphism-by-default,
no bounce/elastic easing, no animating layout properties, no em dashes in copy.
