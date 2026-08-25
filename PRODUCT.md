# PRODUCT.md — Life Passport 人生护照

## What it is

A live, 60-minute "life simulation" game platform for a church welcome party
in the UK. ~50 players (mostly 18–25 Chinese international students, on phones
inside WeChat) roam 7 physical stations, earn personal scores, hit "life
threshold" events (blind-box cards themed on UK student life: First Class
essays, £10 on the street, locked out of the flat), and finish with a
shareable keepsake badge.

## Users

- **Players**: young Chinese students at their first welcome event. Phone in
  hand, WeChat webview, walking around a bright social hall. They should feel
  the game is writing their "life journey" into a beautiful keepsake object.
- **Staff**: volunteers running stations. Need fast, unambiguous scoring with
  big touch targets, under time pressure, in bright light.
- **Admin**: 1–2 organizers. Full roster control, manual fixes, start/end.

## Register

- `/play` (and the home route): **brand**. The design IS the experience.
  Ceremony, atmosphere, keepsake quality. Ambitious motion is welcome.
- `/staff`, `/admin`: **product**. The design serves a task. Earned
  familiarity, quiet precision, state-conveying motion only.

## Brand voice

夜航 (night flight) · 烫金 (foil-stamped) · 仪式感 (ceremony).
The physical object is a midnight-blue passport: gold foil numerals, visa
stamps, machine-readable code lines, boarding-pass perforations. Faith
undertone is warm, not preachy: "我的恩典够你用的" (2 Cor 12:9),
"You don't have to do life alone."

## Anti-references

- Generic SaaS gradients, glassmorphism, hero-metric dashboards.
- Cutesy game-show confetti UI; this is a keepsake, not a slot machine.
- Cream-paper + terracotta "AI default" landing aesthetics.

## Hard constraints

- Venue wifi is hostile: **no external font/CDN requests**. System CJK fonts
  only (PingFang SC / Songti SC and fallbacks). All assets bundled.
- 375px-first. WeChat webview (iOS/Android). Big type, big targets.
- Stability > richness: CSS-driven motion, no heavy animation libraries.
- Chinese UI text, English code comments.
