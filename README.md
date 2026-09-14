# Life Passport 电子护照系统

教会迎新会现场“人生模拟游戏”平台：约 50 人、7 个主线站点、手机随机人生事件、
Help Token、结算徽章。核心是“队伍共同闯关，个人独立人生”。

---

## ⚠️ 活动日 Checklist（活动前 24 小时开始逐项打钩）

- [ ] **提前 24h 唤醒 Supabase**：免费版项目不活跃会自动 pause。打开 Supabase
      Dashboard 确认项目状态为 Active（pause 了就点 Restore，等它恢复）。
      预算允许的话，活动当周临时升 Pro 最省心。
- [ ] **跑 keepalive 心跳**（从前一天晚上跑到活动结束，别关电脑）：
      ```
      SUPABASE_URL=https://<项目>.supabase.co SUPABASE_PUBLISHABLE_KEY=<publishable key> npx tsx scripts/keepalive.ts
      ```
- [ ] **首次部署后改掉占位的管理密码**：先用默认 admin 密码登录 `/admin`，在
      「系统设置 → 访问控制」里更新机构管理员密码。工作人员不再有固定密码 ——
      每场活动自动生成一个 6 位本场码，在「现场总控」里可见、可复制、可换。
      也可以在 SQL Editor 执行：
      ```sql
      update organizations set admin_key = '{sha256}' || encode(extensions.digest('当天的admin随机长密码', 'sha256'), 'hex') where slug = 'gcgc';
      ```
- [ ] **创建正式场次并验证二维码**：在 `/admin` 新建当天活动，把 `/screen`
      投到大屏，用手机扫码；应直接进入姓名登记并领取 3 位编号，不需要输入口令。
- [ ] **工作人员码分发**：在「现场总控」复制本场的 6 位工作人员码发给每站同工，
      让他们提前在 `/staff` 输入并选好自己负责的站（会记住）。这个码只对本场有效。
- [ ] **admin 密码**只给 1-2 个总控的人。
- [ ] **打印每站纸质记分表**（容灾：网络全崩时手写一位队员的 3 位编号 + 整队分数，
      赛后用 admin 端"手动修正"补录）。
- [ ] **投影大屏**：在接投影的笔记本上打开 `/screen`，浏览器按 F11 全屏
      （Mac 上 ⌃⌘F）。这页不需要密码、也不显示任何人生编号，可以放心投屏。
      管理端右上角有「实况大屏 ↗」按钮，会在新窗口打开，方便丢到第二个屏幕。
- [ ] 前端最新版已部署到 Netlify，现场用教会 WiFi 实测一遍完整流程
      （加入 → 组队 → 整队计分 → 手机人生事件 → Token → 结束）。
- [ ] 活动结束后把密钥改回随机值。
- [ ] 按 [RUNBOOK.md](RUNBOOK.md) 填好负责人和故障切换方式。

---

## 架构一句话

React (Netlify 静态托管) → Supabase Postgres，**没有独立后端**。
所有游戏逻辑在 Postgres function（RPC）里原子执行；前端**纯 3 秒轮询**，
不用 WebSocket/Realtime（教会网络最容易掐长连接）。规则的大白话解释见
[GAMEPLAY_V2.md](GAMEPLAY_V2.md)；旧版实现背景仍见 [LOGIC.md](LOGIC.md)。

## 实况大屏 `/screen`

投屏用的独立页面，和管理端分开，这样组织者可以一边在 `/admin` 操作、一边把大屏
留在投影上。每 3 秒轮询一次 `board_snapshot()`：

- **全部在场玩家**：姓名、队伍颜色、个人总分、已挑战站数和已历人生段数。
  **进行中按队伍排列、不显示名次**（同队相邻，左侧一条同色竖条），人多时分组轮播；
  只有结束后才按分数重排并显示名次。表头的「最高分」同样只在结束后出现 ——
  一整个小时的实时排行榜正是我们刻意去掉的东西。
- **实时播报**：手机人生事件结果（场景 / 选择 / 结果三段分开写，不再把场景名和结果名粘成一句）、
  整队通过 / 失手、Token 兑换。图标是内嵌 SVG，不用 emoji。
- 分数变动的那一行会闪金光约 2 秒。
- 等待阶段显示巨大的已登记人数 + 分组轮播的名牌墙（50 人以上也不会溢出）。
- 播报栏下方常驻一张「扫这里回到游戏」的二维码，给中途退出的玩家。
- **结束后自动进入整屏颁奖典礼**（`←` `→` 翻页、空格前进、`P` 暂停、`Esc` 跳到总榜）。

**安全**：`board_snapshot()` 刻意不返回任何人生编号——它是玩家的身份凭证
（谁看到就能打开谁的护照），而这一页会投在满是人的房间里。有人拍照也没关系。

## 目录结构

```
supabase/migrations/   数据库 schema + 全部 RPC + 种子数据
supabase/tests/        SQL 测试（每个文件事务内跑完自动回滚）
scripts/test.sh        一条命令跑全部 SQL 测试
scripts/preflight.sh   lint + build + SQL 回归的一键上线门禁
scripts/keepalive.ts   防 Supabase 休眠的心跳脚本
scripts/demo-screen.sql 造一局 20 人的现场数据，用来预览 /screen
LOGIC.md               规则大白话说明（当天判断 bug vs 规则用）
web/                   前端：play / staff / admin / screen
```

## 本地开发

需要 Docker。不需要本机装 psql / supabase CLI（用 npx / docker 代劳）。

```bash
npx supabase start        # 起本地 Supabase（首次拉镜像较慢）
npx supabase db reset     # 应用全部 migrations + 种子数据（也用于清空重来）
./scripts/test.sh         # 跑全部 SQL 测试，期望输出 ALL TESTS PASSED
bash scripts/preflight.sh # 上线前完整门禁
```

前端（`web/.env.local` 已指向本地 Supabase）：

```bash
npm --prefix web install
npm --prefix web run dev  # http://localhost:5173
```

页面：

| 路由 | 谁用 | 说明 |
|---|---|---|
| `/play` | 玩家 | 加入 / 找回 / 身份揭晓 / 双分数护照 / 手机随机事件 / 结算 |
| `/staff` | 站点工作人员 | 输入本场 6 位工作人员码进入；之后输入任意一位队员的 3 位编号，整队只录一次结果 |
| `/admin` | 组织者 | 机构管理密码登录 → 全部场次 → 任意一场的工作台：总控、玩家、站点、系统设置 |
| `/screen/:screenToken` | 投影大屏 | **无需密码**，链接本身就是场次（从管理端「现场总控」复制）；`/screen` 不带令牌会显示引导 |
| `/badge/:token` | 已结算玩家 | 生成 1080×1920 的 9:16 人生护照分享图，支持微信长按保存、PNG 下载和系统分享 |
| `/guide` | **同工** | **可直接分享的说明页**：流程、规则、记分、颁奖、分岗位 SOP、常见问题，
并且每一节都能点开真实界面的演示（`?preview=`，示例数据，读不到也写不了真实活动）。
离开去看演示再回来会停在原来的位置 |
| `/library` | **同工** | 无需密码的人生事件库：30 个场景、60 个行动、180 个随机结果，含概率与分数影响。
读的是 `life_event_library()`，和管理后台的审核页同一个 payload。
**包含玩家看不到的结果表，只发给同工** |

结算徽章不会显示玩家的人生编号；内容包含姓名、身份/颜色、最终总分、
全场名次、活动日期、经文和教会中英文名称。未结束游戏或没有本机玩家记录时，
`/badge` 会显示明确的引导状态，不会生成空白图片。

**多租户模型**：`organizations → events → 一切游戏数据`。每个机构一个管理密码（本地种子机构 `gcgc`
的密码是 `change-me-admin`）；每一场活动自带三把钥匙 —— 玩家的入场链接（= 二维码）、工作人员的
6 位本场码、投影的大屏链接 —— 都在管理端「现场总控」里可复制。工作人员码随场生成、可在「系统设置」
里换掉；没有全局的 staff 密码了。玩家编号按场次唯一，两个教会可以各有一个 327。前端不用 supabase-js，只有一个 fetch 封装
（`web/src/lib/api.ts`）：写操作自动带幂等键 + 指数退避重试 ×2，10 秒超时。

**站点模型**：`站点库（内置 / 机构自建）→ 每场启用配置（快照）`。库是模板 —— 平台内置的九个站所有机构共用且只读，
需要改就「复制为自己的」；机构自建的站点只有本机构看得见。办一场活动时，从库里挑若干站点写进 `event_stations`，
**名称与计分方式是复制进去的快照**：以后在库里改名、甚至删掉，都不会改写已经办过的那几场的记录。
建场时默认复制本机构上一场的名单（没有上一场就用内置九站）。开场（`waiting`）之前可以整份改名单 ——
增删站点、改名、改计分方式、排序；开场（`playing`）之后名单锁定，只剩「撤站」一个动作：撤下的站在工作人员端消失、
不能再记分，但**已经记的分全部保留**，护照与大屏的「共几站」按剩下的站重算。
每场必须至少留一个主线站点和那个人生盲盒站。管理端在「站点运营」页同时管这两层；
工作人员端轮询 `staff_session`（本场标题 + 启用的站，`staff_stations` 仍是同一份数据的独立只读入口），玩家护照与
大屏读各自快照里的站点（`poll_player_by_link` 的 `stations` / `board_snapshot` 的 `stations_total`）——
`stations` 表不再对外直读。

## 部署到生产

```bash
npx supabase link --project-ref <项目ref>
npx supabase db push      # 应用 migrations 到云端
```

无需再接第二套数据库：生产环境建立独立的 Supabase 项目即可。前端推荐继续使用
Netlify（仓库已包含 SPA rewrite、安全响应头和静态资源缓存）。Netlify 构建 `web/`，环境变量 `VITE_SUPABASE_URL`、
`VITE_SUPABASE_PUBLISHABLE_KEY`。staff/admin 密钥和入场口令**只存数据库
`app_config` 表的 SHA-256 摘要**，绝不进前端 bundle；工作人员和管理端
输入的密码仅保存在当前浏览器标签会话中。每场玩家入场 token 由数据库随机生成，
创建下一场时自动轮换。

## 关键设计决定（规格未覆盖处的取舍，详细见 LOGIC.md 末尾）

1. attempts 增加 `superseded` / `retry_used` 状态：任务书的部分唯一索引会
   挡住"失败 → Second Chance → 重打"，改为唯一索引只覆盖 `passed/failed`。
2. 玩家轮询走 `poll_player(code)` RPC（一次返回 phase + 玩家 + 记录 + 名次），
   因为共享 anon key 下 RLS 无法实现"只能查自己的行"。人生编号仍是凭证；无效码
   会在数据库内全局串行节流，生产环境还应在 Supabase/API 边缘设置请求速率告警。
3. 幂等：写操作带客户端生成的 idempotency key，结果存 `rpc_results` 表，
   重试请求原样返回首次结果，绝不重复记分。
4. admin key 可通行一切 staff 操作（反之不行）。
5. 15 / 35 / 45 分关口每人只触发一次；场景选择和隐藏结果由数据库随机并固化，
   同一个行动也不保证同一结果。待选事件不阻塞整队继续挑战。
6. `game_state.join_passphrase` 不暴露给前端：状态和排行榜走刻意公开且不含凭据的
   `board_snapshot()` RPC；旧 `leaderboard` 仅数据库 owner 可读。
7. RLS 全开且无 anon 策略，全部写操作走 security definer RPC，内部 `_` 开头
   的辅助函数不授权给 anon。

## 测试覆盖（supabase/tests/）

| 文件 | 覆盖 |
|---|---|
| 01_join_recover | 口令/名字校验、3 位编号生成、找回、轮询、中途加入、结束后拒绝 |
| 02_start_game | 配额分配、颜色组、人数不足降级、重复开始、排除已删玩家 |
| 03_award_scores | 批量、整批回滚、幂等、阈值锁定、cap_next、fixed/graded、重试消耗 |
| 04_life_event | 六种卡全覆盖、下限 0、跳阈值、阈值不复活、幂等 |
| 05_token | 三种用法、单枚限制、Second Chance 目标站校验、幂等 |
| 06_admin | 结束、万能修正 + 审计、软删/恢复、排行榜、staff_lookup、密钥分级 |
| 07_full_flow | 端到端小型完整对局（只走公开 RPC） |
| 08_board | 大屏快照：载荷结构、**不含任何编号**、事件流三种来源、锁定/感冒标记、anon 可读 |
| 09_security_hardening | RPC 权限、密钥哈希、错误节流与安全边界 |
| 10_game_sessions | 二维码入场、旧链接归档、新场次事务、完整后台查询与配置 |
| 11_team_journey | 单码识别整队、混合门（分数或站数）、非阻塞随机事件、隐藏结果、整队 Token 成本 |
| 12_single_score_event_review | 单一公开分数、事件库审核载荷（30/60/180）、`/library` 与后台同源、helper 不授权 |
| 13_journey_stages | 每本护照恰好三段人生、站点门兜底、颁奖载荷（唯一队伍奖、过山车用落差） |
| 14_registration_safety_contact | 加入幂等、选填联系方式隐私边界、迟到玩家 Solo |
