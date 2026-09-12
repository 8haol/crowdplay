-- Life Passport · 多租户阶段 1 · 移除遗留 leaderboard 视图
-- 它跨全部玩家排名、没有场次范围，多租户之后语义就是错的；没有任何函数或前端引用它，
-- 名次由 poll_player_by_link / board_snapshot 在场内计算。
drop view if exists leaderboard;
