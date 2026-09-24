-- Tests: 机构活动相册。机构隔离、额度（pending 预占 / 过期清理）、complete 核对大小、
-- 文件名安全化、按设备爱心、删除闸门、超管额度与删机构闸门、service-role-only 权限。
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values
  ('alpha', '甲教会', 'Alpha Church', 'alpha-admin'),
  ('beta',  '乙教会', 'Beta Church',  'beta-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase)
select id, '甲场', 'join-alpha', 'ALPHA1', 'screen-alpha', 'ended' from organizations where slug = 'alpha';
insert into events (org_id, title, join_token, staff_code, screen_token, phase)
select id, '乙场', 'join-beta', 'BETA01', 'screen-beta', 'ended' from organizations where slug = 'beta';

-- 测试自己设平台口令：迁移里种下的是随机值，谁也不知道。
update platform_config set super_key = '{sha256}' || encode(extensions.digest('root-pass', 'sha256'), 'hex');

-- 断言一段 SQL 抛出的正好是这个错误码（不是别的错，也不是没报错）。
create function pg_temp.expect_err(p_sql text, p_code text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected % from: %', p_code, p_sql;
exception when others then
  if sqlerrm <> p_code then
    raise exception 'TEST FAILED: expected % but got "%" from: %', p_code, sqlerrm, p_sql;
  end if;
end;
$$;

do $$
declare
  v_alpha uuid := (select id from organizations where slug = 'alpha');
  v_beta  uuid := (select id from organizations where slug = 'beta');
  ev_a uuid := (select id from events where join_token = 'join-alpha');
  ev_b uuid := (select id from events where join_token = 'join-beta');
  a1 uuid; a2 uuid; b1 uuid;
  r jsonb; r1 jsonb; r2 jsonb; rf jsonb;
  p1 uuid; p2 uuid; p_fresh uuid; p_stale uuid; p_bstale uuid; p_big uuid; bp uuid; bp_pending uuid;
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid();
  v_key text; v_tail text;
  v_ids uuid[];
begin
  -- -------------------------------------------------------------------------
  -- 1. 默认额度、建相册、改名
  -- -------------------------------------------------------------------------
  assert (select album_quota_bytes from organizations where id = v_alpha) = 21474836480, '默认额度 20 GiB';

  r := admin_album_create('alpha-admin', '  园游会  ', ev_a);
  a1 := (r ->> 'id')::uuid;
  assert (select title from albums where id = a1) = '园游会', '标题落库的是 trim 后的值';
  assert (select event_id from albums where id = a1) = ev_a, '关联本机构的活动';
  a2 := (admin_album_create('alpha-admin', '空相册', null) ->> 'id')::uuid;
  assert (select event_id from albums where id = a2) is null, '活动可以不关联';
  b1 := (admin_album_create('beta-admin', '乙相册', ev_b) ->> 'id')::uuid;

  perform pg_temp.expect_err($q$select admin_album_create('alpha-admin', '   ', null)$q$, 'BAD_ALBUM_TITLE');
  perform pg_temp.expect_err(format('select admin_album_create(%L, %L, null)', 'alpha-admin', repeat('甲', 61)), 'BAD_ALBUM_TITLE');
  perform pg_temp.expect_err($q$select admin_album_create('alpha-admin', null, null)$q$, 'BAD_ALBUM_TITLE');
  -- 60 字正好合法
  perform admin_album_create('alpha-admin', repeat('甲', 60), null);
  delete from albums where org_id = v_alpha and title = repeat('甲', 60);

  r := admin_album_rename('alpha-admin', a2, ' 改名了 ');
  assert r ->> 'title' = '改名了' and (r ->> 'id')::uuid = a2, '改名返回 trim 后的新标题';
  perform pg_temp.expect_err(format('select admin_album_rename(%L, %L, %L)', 'alpha-admin', a2, ''), 'BAD_ALBUM_TITLE');

  -- -------------------------------------------------------------------------
  -- 2. BAD_FILE：类型、大小、文件名长度
  -- -------------------------------------------------------------------------
  perform pg_temp.expect_err(format('select album_reserve_upload(%L, %L, %L, %L, 100, null)', 'alpha-admin', a1, 'a.pdf', 'application/pdf'), 'BAD_FILE');
  perform pg_temp.expect_err(format('select album_reserve_upload(%L, %L, %L, null, 100, null)', 'alpha-admin', a1, 'a.jpg'), 'BAD_FILE');
  perform pg_temp.expect_err(format('select album_reserve_upload(%L, %L, %L, %L, 0, null)', 'alpha-admin', a1, 'a.jpg', 'image/jpeg'), 'BAD_FILE');
  perform pg_temp.expect_err(format('select album_reserve_upload(%L, %L, %L, %L, 5000000001, null)', 'alpha-admin', a1, 'a.mp4', 'video/mp4'), 'BAD_FILE');
  perform pg_temp.expect_err(format('select album_reserve_upload(%L, %L, %L, %L, 100, null)', 'alpha-admin', a1, '', 'image/jpeg'), 'BAD_FILE');
  perform pg_temp.expect_err(format('select album_reserve_upload(%L, %L, %L, %L, 100, null)', 'alpha-admin', a1, repeat('a', 201), 'image/jpeg'), 'BAD_FILE');
  -- 「以 image/ 开头」要锚在开头，不能是中间出现
  perform pg_temp.expect_err(format('select album_reserve_upload(%L, %L, %L, %L, 100, null)', 'alpha-admin', a1, 'a.jpg', 'x-image/jpeg'), 'BAD_FILE');

  -- 5,000,000,000 字节正好合法（默认额度 20 GiB 放得下）
  r := album_reserve_upload('alpha-admin', a1, 'big.mp4', 'video/mp4', 5000000000, null);
  p_big := (r ->> 'photo_id')::uuid;
  assert (select size_bytes from album_photos where id = p_big) = 5000000000, '5e9 字节的文件可以登记';
  assert (album_delete_photos('alpha-admin', array[p_big]) ->> 'deleted')::int = 1, '清掉这张大文件';

  -- -------------------------------------------------------------------------
  -- 3. 额度：pending 预占、超额带剩余字节、过期 pending 不计入并被清理
  -- -------------------------------------------------------------------------
  r := platform_set_album_quota('root-pass', v_alpha, 1000);
  assert (r ->> 'quota_bytes')::bigint = 1000 and (r ->> 'org_id')::uuid = v_alpha, '额度设成 1000 字节';

  r1 := album_reserve_upload('alpha-admin', a1, 'IMG_0001.JPG', 'image/jpeg', 600, now());
  p1 := (r1 ->> 'photo_id')::uuid;
  assert r1 ->> 'prefix' = format('orgs/%s/albums/%s/%s/', v_alpha, a1, p1), '前缀由服务端按 id 拼出';
  assert r1 ->> 'original_key' = (r1 ->> 'prefix') || 'original/IMG_0001.JPG', '原片路径 = 前缀 + original/ + 文件名';
  assert r1 -> 'stale_prefixes' = '[]'::jsonb, '没有过期的 pending 时 stale_prefixes 是空数组';
  assert (select status from album_photos where id = p1) = 'pending', '登记后是 pending';
  assert (select object_key from album_photos where id = p1) = r1 ->> 'original_key', 'object_key 落库';

  r := admin_albums('alpha-admin');
  assert (r ->> 'used_bytes')::bigint = 600, 'pending 占额度';
  assert (r ->> 'quota_bytes')::bigint = 1000, 'admin_albums 带额度';
  assert (select (x ->> 'photo_count')::int from jsonb_array_elements(r -> 'albums') x where (x ->> 'id')::uuid = a1) = 0,
         '相册卡片的张数只计 ready';
  assert (select (x ->> 'total_bytes')::bigint from jsonb_array_elements(r -> 'albums') x where (x ->> 'id')::uuid = a1) = 0,
         '相册卡片的字节数只计 ready';

  perform pg_temp.expect_err(format('select album_reserve_upload(%L, %L, %L, %L, 500, null)', 'alpha-admin', a1, 'x.jpg', 'image/jpeg'),
                             'ALBUM_QUOTA_EXCEEDED:400');

  -- 23 小时前的 pending 仍计入；25 小时前的不计入。乙教会也放一行过期 pending，
  -- 甲教会登记时不能顺手删别家的。
  insert into album_photos (album_id, filename, content_type, size_bytes, object_key, created_at)
  values (a1, 'fresh.jpg', 'image/jpeg', 100, 'k-fresh', now() - interval '23 hours') returning id into p_fresh;
  insert into album_photos (album_id, filename, content_type, size_bytes, object_key, created_at)
  values (a1, 'stale.jpg', 'image/jpeg', 900, 'k-stale', now() - interval '25 hours') returning id into p_stale;
  insert into album_photos (album_id, filename, content_type, size_bytes, object_key, created_at)
  values (b1, 'bstale.jpg', 'image/jpeg', 900, 'k-bstale', now() - interval '25 hours') returning id into p_bstale;
  assert (admin_albums('alpha-admin') ->> 'used_bytes')::bigint = 700, '24h 内的 pending 计入，过期的不计入';

  r2 := album_reserve_upload('alpha-admin', a1, 'IMG_0002.JPG', 'image/jpeg', 300, now() - interval '1 hour');
  p2 := (r2 ->> 'photo_id')::uuid;
  assert r2 -> 'stale_prefixes' = jsonb_build_array(format('orgs/%s/albums/%s/%s/', v_alpha, a1, p_stale)),
         '过期 pending 的前缀交回给调用方去删 R2 对象';
  assert not exists (select 1 from album_photos where id = p_stale), '过期 pending 行被删';
  assert exists (select 1 from album_photos where id = p_fresh), '24h 内的 pending 不删';
  assert exists (select 1 from album_photos where id = p_bstale), '别家机构的过期 pending 不动';
  assert (admin_albums('alpha-admin') ->> 'used_bytes')::bigint = 1000, '正好用满额度也允许';

  perform pg_temp.expect_err(format('select album_reserve_upload(%L, %L, %L, %L, 1, null)', 'alpha-admin', a1, 'x.jpg', 'image/jpeg'),
                             'ALBUM_QUOTA_EXCEEDED:0');
  -- 超管把额度调到已用之下：剩余报 0，不是负数
  perform platform_set_album_quota('root-pass', v_alpha, 500);
  perform pg_temp.expect_err(format('select album_reserve_upload(%L, %L, %L, %L, 1, null)', 'alpha-admin', a1, 'x.jpg', 'image/jpeg'),
                             'ALBUM_QUOTA_EXCEEDED:0');
  perform platform_set_album_quota('root-pass', v_alpha, 21474836480);

  -- -------------------------------------------------------------------------
  -- 4. 文件名安全化：拼不出额外的路径段
  -- -------------------------------------------------------------------------
  rf := album_reserve_upload('alpha-admin', a1, '../a/b.jpg', 'image/jpeg', 10, null);
  v_key := rf ->> 'original_key';
  v_tail := substr(v_key, length((rf ->> 'prefix') || 'original/') + 1);
  assert v_key = (rf ->> 'prefix') || 'original/_a_b.jpg', '../a/b.jpg → _a_b.jpg，实际：' || v_key;
  assert position('/' in v_tail) = 0, '安全化后的文件名里没有 /';
  assert length(v_key) - length(replace(v_key, '/', '')) = 6, '路径段数固定，没有多出来的层级';
  assert v_key not like '%..%', '路径里没有 ..';
  assert (select filename from album_photos where id = (rf ->> 'photo_id')::uuid) = '../a/b.jpg',
         'filename 列存原文件名（下载时还给用户），只有对象路径用安全化的';
  v_ids := array[(rf ->> 'photo_id')::uuid];

  rf := album_reserve_upload('alpha-admin', a1, '..', 'image/jpeg', 10, null);
  assert rf ->> 'original_key' = (rf ->> 'prefix') || 'original/file', '只剩点的文件名换成 file';
  v_ids := v_ids || (rf ->> 'photo_id')::uuid;
  rf := album_reserve_upload('alpha-admin', a1, E'a\\b\x01c.jpg', 'image/jpeg', 10, null);
  assert rf ->> 'original_key' = (rf ->> 'prefix') || 'original/a_b_c.jpg', '反斜杠与控制字符换成 _';
  v_ids := v_ids || (rf ->> 'photo_id')::uuid;
  rf := album_reserve_upload('alpha-admin', a1, '.bashrc', 'image/jpeg', 10, null);
  assert rf ->> 'original_key' = (rf ->> 'prefix') || 'original/bashrc', '去掉开头的点';
  v_ids := v_ids || (rf ->> 'photo_id')::uuid;
  assert (album_delete_photos('alpha-admin', v_ids) ->> 'deleted')::int = 4, '清掉安全化测试的四行';

  -- -------------------------------------------------------------------------
  -- 5. complete：大小不符报错、通过变 ready、幂等
  -- -------------------------------------------------------------------------
  perform pg_temp.expect_err(format('select album_complete_upload(%L, %L, 599, true, true)', 'alpha-admin', p1), 'ALBUM_SIZE_MISMATCH');
  perform pg_temp.expect_err(format('select album_complete_upload(%L, %L, null, true, true)', 'alpha-admin', p1), 'ALBUM_SIZE_MISMATCH');
  -- 抛异常会回滚整个调用，行删不掉（Postgres 没有自治事务）：它仍是 pending，
  -- 绝不能变成 ready；清理由调用方 abort（album_delete_photos）或 24h 过期兜底。
  assert (select status from album_photos where id = p1) = 'pending', '大小不符时绝不会变 ready';

  r := album_complete_upload('alpha-admin', p1, 600, true, true);
  assert r ->> 'status' = 'ready' and (r ->> 'photo_id')::uuid = p1, 'complete 返回 ready';
  assert (select status = 'ready' and has_thumb and has_preview from album_photos where id = p1), '行标为 ready，带小图标记';
  r := album_complete_upload('alpha-admin', p1, 600, false, false);
  assert r ->> 'status' = 'ready', '重复 complete 照样返回 ready';
  assert (select has_thumb and has_preview from album_photos where id = p1), '重复 complete 不改已 ready 的行';
  r := album_complete_upload('alpha-admin', p1, 1, false, false);
  assert r ->> 'status' = 'ready', '已 ready 后再来一次（哪怕大小不同）也是幂等返回，不删行';
  assert exists (select 1 from album_photos where id = p1), '已 ready 的行不会被误删';
  perform pg_temp.expect_err(format('select album_complete_upload(%L, %L, 1, false, false)', 'alpha-admin', gen_random_uuid()), 'PHOTO_NOT_FOUND');

  perform album_complete_upload('alpha-admin', p2, 300, true, false);

  -- -------------------------------------------------------------------------
  -- 6. 相册列表：只计 ready、封面、排序
  -- -------------------------------------------------------------------------
  update albums set created_at = now() - interval '1 day' where id = a1;   -- a2 更新，排前面
  r := admin_albums('alpha-admin');
  assert jsonb_array_length(r -> 'albums') = 2, '甲教会只看到自己的两本';
  assert (r -> 'albums' -> 0 ->> 'id')::uuid = a2, '按 created_at 倒序';
  assert r -> 'albums' -> 1 ->> 'event_title' = '甲场', '带关联活动名';
  assert r -> 'albums' -> 0 -> 'event_title' = 'null'::jsonb, '没关联活动时 event_title 是 null';
  assert r -> 'albums' -> 0 -> 'cover_photo_id' = 'null'::jsonb, '空相册没有封面';
  assert (r -> 'albums' -> 1 ->> 'photo_count')::int = 2, '两张 ready（23h 的 pending 不算）';
  assert (r -> 'albums' -> 1 ->> 'total_bytes')::bigint = 900, '600 + 300';
  -- 都没有爱心时，封面是最早拍的那张（p2 拍摄时间早一小时）
  assert (r -> 'albums' -> 1 ->> 'cover_photo_id')::uuid = p2, '无爱心时封面取最早拍的';

  -- -------------------------------------------------------------------------
  -- 7. 爱心：按设备切换、计数、liked_by_me
  -- -------------------------------------------------------------------------
  r := admin_photo_like_toggle('alpha-admin', p1, d1);
  assert (r ->> 'liked')::boolean and (r ->> 'like_count')::int = 1, 'd1 点爱心';
  r := admin_photo_like_toggle('alpha-admin', p1, d2);
  assert (r ->> 'liked')::boolean and (r ->> 'like_count')::int = 2, 'd2 点爱心';
  r := admin_photo_like_toggle('alpha-admin', p1, d1);
  assert not (r ->> 'liked')::boolean and (r ->> 'like_count')::int = 1, 'd1 再点一次是取消';
  r := admin_photo_like_toggle('alpha-admin', p1, d1);
  assert (r ->> 'liked')::boolean and (r ->> 'like_count')::int = 2, 'd1 第三次又点上，计数回到 2';

  -- 带 p_liked 是「设成」而不是切换：同一请求重试几次结果都不变。
  r := admin_photo_like_toggle('alpha-admin', p1, d1, true);
  r := admin_photo_like_toggle('alpha-admin', p1, d1, true);
  assert (r->>'liked')::boolean and exists (select 1 from album_photo_likes where photo_id = p1 and device_id = d1), 'set liked is idempotent';
  r := admin_photo_like_toggle('alpha-admin', p1, d1, false);
  r := admin_photo_like_toggle('alpha-admin', p1, d1, false);
  assert not (r->>'liked')::boolean and not exists (select 1 from album_photo_likes where photo_id = p1 and device_id = d1), 'set unliked is idempotent';
  r := admin_photo_like_toggle('alpha-admin', p1, d1, true);  -- 复原，后面的断言按「d1 已点」写
  assert (select count(*) from album_photo_likes where photo_id = p1) = 2, '一台设备最多一票';

  r := admin_album_photos('alpha-admin', a1, d1);
  assert (r -> 'album' ->> 'id')::uuid = a1 and r -> 'album' ->> 'title' = '园游会', '带相册信息';
  assert r -> 'album' ->> 'event_title' = '甲场', '相册信息带活动名';
  assert jsonb_array_length(r -> 'photos') = 2, '只列 ready（23h 的 pending 不在里面）';
  assert (r -> 'photos' -> 0 ->> 'id')::uuid = p2, '按拍摄时间排序';
  assert (r -> 'photos' -> 1 ->> 'like_count')::int = 2, 'p1 两颗心';
  assert (r -> 'photos' -> 1 ->> 'liked_by_me')::boolean, 'd1 看 p1 是已点';
  assert not (r -> 'photos' -> 0 ->> 'liked_by_me')::boolean, 'd1 没点 p2';
  assert (r -> 'photos' -> 1 ->> 'size_bytes')::bigint = 600 and r -> 'photos' -> 1 ->> 'filename' = 'IMG_0001.JPG', '带文件信息';
  r := admin_album_photos('alpha-admin', a1, d3);
  assert not (r -> 'photos' -> 1 ->> 'liked_by_me')::boolean, 'd3 没点过，liked_by_me 按设备算';
  r := admin_album_photos('alpha-admin', a1, null);
  assert not (r -> 'photos' -> 1 ->> 'liked_by_me')::boolean, '不带设备 id 时 liked_by_me 为 false';

  assert (select (x ->> 'cover_photo_id')::uuid from jsonb_array_elements(admin_albums('alpha-admin') -> 'albums') x
          where (x ->> 'id')::uuid = a1) = p1, '有爱心后封面换成爱心最多的';
  update album_photos set has_thumb = false where id = p1;
  assert (select (x ->> 'cover_photo_id')::uuid from jsonb_array_elements(admin_albums('alpha-admin') -> 'albums') x
          where (x ->> 'id')::uuid = a1) = p2, '没缩略图的照片不当封面';
  update album_photos set has_thumb = true where id = p1;

  perform pg_temp.expect_err(format('select admin_photo_like_toggle(%L, %L, %L)', 'alpha-admin', p_fresh, d1), 'PHOTO_NOT_FOUND');
  perform pg_temp.expect_err(format('select admin_photo_like_toggle(%L, %L, null)', 'alpha-admin', p1), 'BAD_REQUEST');

  -- -------------------------------------------------------------------------
  -- 8. 机构隔离：甲的口令碰乙的相册 / 照片 / 爱心，每个 RPC 都拒绝或忽略
  -- -------------------------------------------------------------------------
  bp := (album_reserve_upload('beta-admin', b1, 'beta.jpg', 'image/jpeg', 100, null) ->> 'photo_id')::uuid;
  perform album_complete_upload('beta-admin', bp, 100, true, true);
  bp_pending := (album_reserve_upload('beta-admin', b1, 'beta2.jpg', 'image/jpeg', 50, null) ->> 'photo_id')::uuid;
  perform admin_photo_like_toggle('beta-admin', bp, d1);
  -- 正对照：乙自己的口令看得到自己的照片，下面的拒绝不是「东西不存在」导致的假阳性
  assert jsonb_array_length(admin_album_photos('beta-admin', b1, d1) -> 'photos') = 1, '乙看得到自己的照片';

  assert not exists (select 1 from jsonb_array_elements(admin_albums('alpha-admin') -> 'albums') x
                     where (x ->> 'id')::uuid = b1), '甲的列表里没有乙的相册';
  perform pg_temp.expect_err(format('select admin_album_rename(%L, %L, %L)', 'alpha-admin', b1, 'hack'), 'ALBUM_NOT_FOUND');
  assert (select title from albums where id = b1) = '乙相册', '乙的相册名没被改';
  perform pg_temp.expect_err(format('select admin_album_photos(%L, %L, %L)', 'alpha-admin', b1, d1), 'ALBUM_NOT_FOUND');
  perform pg_temp.expect_err(format('select admin_photo_like_toggle(%L, %L, %L)', 'alpha-admin', bp, d1), 'PHOTO_NOT_FOUND');
  assert (select count(*) from album_photo_likes where photo_id = bp) = 1, '乙照片的爱心没被甲动过';
  perform pg_temp.expect_err(format('select admin_album_create(%L, %L, %L)', 'alpha-admin', '挂别家', ev_b), 'EVENT_NOT_FOUND');
  perform pg_temp.expect_err(format('select album_reserve_upload(%L, %L, %L, %L, 1, null)', 'alpha-admin', b1, 'x.jpg', 'image/jpeg'), 'ALBUM_NOT_FOUND');
  perform pg_temp.expect_err(format('select album_complete_upload(%L, %L, 50, true, true)', 'alpha-admin', bp_pending), 'PHOTO_NOT_FOUND');
  assert (select status from album_photos where id = bp_pending) = 'pending', '乙的 pending 没被甲 complete';
  r := album_objects_for('alpha-admin', array[bp, bp_pending, p1]);
  assert jsonb_array_length(r -> 'objects') = 1 and (r -> 'objects' -> 0 ->> 'photo_id')::uuid = p1,
         'album_objects_for 静默忽略别家的 id';
  perform pg_temp.expect_err(format('select album_photo_ids(%L, %L, 500)', 'alpha-admin', b1), 'ALBUM_NOT_FOUND');
  r := album_delete_photos('alpha-admin', array[bp, bp_pending]);
  assert (r ->> 'deleted')::int = 0, '甲删不了乙的照片';
  assert (select count(*) from album_photos where id in (bp, bp_pending)) = 2, '乙的照片行都还在';
  perform pg_temp.expect_err(format('select album_delete(%L, %L)', 'alpha-admin', b1), 'ALBUM_NOT_FOUND');
  assert exists (select 1 from albums where id = b1), '乙的相册还在';
  -- 额度各算各的：乙 = 100 ready + 50 pending（过期的 900 不算），与甲无关
  assert (admin_albums('beta-admin') ->> 'used_bytes')::bigint = 150, '乙的用量只算乙自己的';
  -- 乙的口令同样碰不到甲
  perform pg_temp.expect_err(format('select admin_album_photos(%L, %L, %L)', 'beta-admin', a1, d1), 'ALBUM_NOT_FOUND');
  perform pg_temp.expect_err(format('select admin_photo_like_toggle(%L, %L, %L)', 'beta-admin', p1, d1), 'PHOTO_NOT_FOUND');

  -- -------------------------------------------------------------------------
  -- 9. album_objects_for / album_photo_ids / 删除
  -- -------------------------------------------------------------------------
  r := album_objects_for('alpha-admin', array[p1, p_fresh]);
  assert jsonb_array_length(r -> 'objects') = 2, 'album_objects_for 含 pending';
  assert (select x ->> 'status' from jsonb_array_elements(r -> 'objects') x where (x ->> 'photo_id')::uuid = p_fresh) = 'pending',
         'pending 的对象带 status';
  assert (select x ->> 'prefix' = format('orgs/%s/albums/%s/%s/', v_alpha, a1, p1)
                 and x ->> 'original_key' = r1 ->> 'original_key'
                 and x ->> 'filename' = 'IMG_0001.JPG'
                 and x ->> 'content_type' = 'image/jpeg'
                 and (x ->> 'has_thumb')::boolean and (x ->> 'has_preview')::boolean
          from jsonb_array_elements(r -> 'objects') x where (x ->> 'photo_id')::uuid = p1),
         'album_objects_for 字段齐全';
  assert album_objects_for('alpha-admin', '{}'::uuid[]) -> 'objects' = '[]'::jsonb, '空数组返回空列表';
  perform pg_temp.expect_err(
    format('select album_objects_for(%L, %L::uuid[])', 'alpha-admin',
           (select array_agg(gen_random_uuid()) from generate_series(1, 501))),
    'BAD_FILE');

  r := album_photo_ids('alpha-admin', a1, 500);
  assert jsonb_array_length(r -> 'photo_ids') = 3, 'album_photo_ids 含 pending（p1、p2、23h 的那张）';
  assert r -> 'photo_ids' @> to_jsonb(array[p1, p2, p_fresh]), '三个 id 都在';
  assert jsonb_array_length(album_photo_ids('alpha-admin', a1, 2) -> 'photo_ids') = 2, 'p_limit 限制个数';
  assert album_photo_ids('alpha-admin', a2, 500) -> 'photo_ids' = '[]'::jsonb, '空相册返回空数组';

  perform pg_temp.expect_err(format('select album_delete(%L, %L)', 'alpha-admin', a1), 'ALBUM_NOT_EMPTY');
  r := album_delete('alpha-admin', a2);
  assert (r ->> 'deleted')::uuid = a2, '空相册可以删';
  assert not exists (select 1 from albums where id = a2), '空相册行没了';
  perform pg_temp.expect_err(format('select album_delete(%L, %L)', 'alpha-admin', a2), 'ALBUM_NOT_FOUND');

  -- 删照片时爱心跟着级联
  assert (album_delete_photos('alpha-admin', array[p1]) ->> 'deleted')::int = 1, '删掉 p1';
  assert not exists (select 1 from album_photo_likes where photo_id = p1), 'p1 的爱心跟着级联删掉';

  -- -------------------------------------------------------------------------
  -- 10. 超管：platform_orgs 带用量、额度范围、删机构闸门
  -- -------------------------------------------------------------------------
  r := (select x from jsonb_array_elements(platform_orgs('root-pass') -> 'orgs') x where x ->> 'slug' = 'alpha');
  assert (r ->> 'album_used_bytes')::bigint = 400, '甲的用量 = p2 300 + 23h pending 100';
  assert (r ->> 'album_quota_bytes')::bigint = 21474836480, '带额度';
  assert r ? 'admin_key_plain' and r ? 'event_count' and r ? 'has_live_event', 'platform_orgs 原有字段都还在';

  perform pg_temp.expect_err(format('select platform_set_album_quota(%L, %L, -1)', 'root-pass', v_alpha), 'BAD_QUOTA');
  perform pg_temp.expect_err(format('select platform_set_album_quota(%L, %L, 1073741824001)', 'root-pass', v_alpha), 'BAD_QUOTA');
  perform pg_temp.expect_err(format('select platform_set_album_quota(%L, %L, null)', 'root-pass', v_alpha), 'BAD_QUOTA');
  perform pg_temp.expect_err(format('select platform_set_album_quota(%L, %L, 1)', 'root-pass', gen_random_uuid()), 'ORG_NOT_FOUND');
  perform pg_temp.expect_err(format('select platform_set_album_quota(%L, %L, 1)', 'alpha-admin', v_alpha), 'BAD_PLATFORM_KEY');
  assert (platform_set_album_quota('root-pass', v_alpha, 0) ->> 'quota_bytes')::bigint = 0, '0 合法';
  assert (platform_set_album_quota('root-pass', v_alpha, 1073741824000) ->> 'quota_bytes')::bigint = 1073741824000, '1000 GiB 合法';
  assert (select album_quota_bytes from organizations where id = v_alpha) = 1073741824000, '额度落库';

  -- 确认 slug 的闸门优先
  perform pg_temp.expect_err(format('select platform_delete_org(%L, %L, %L)', 'root-pass', v_alpha, 'nope'), 'CONFIRM_MISMATCH');
  perform pg_temp.expect_err(format('select platform_delete_org(%L, %L, %L)', 'root-pass', v_alpha, 'alpha'), 'ORG_HAS_ALBUM_PHOTOS');
  -- 只剩 pending 也要拒绝：pending 的原片可能已经在 R2 上了
  perform album_delete_photos('alpha-admin', array[p2]);
  assert (select count(*) from album_photos p join albums a on a.id = p.album_id where a.org_id = v_alpha) = 1, '只剩一张 pending';
  perform pg_temp.expect_err(format('select platform_delete_org(%L, %L, %L)', 'root-pass', v_alpha, 'alpha'), 'ORG_HAS_ALBUM_PHOTOS');
  perform album_delete_photos('alpha-admin', array[p_fresh]);
  -- 照片清空后可以删；空相册跟着级联
  r := platform_delete_org('root-pass', v_alpha, 'alpha');
  assert r ->> 'deleted' = 'alpha', '清空照片后机构可以删';
  assert not exists (select 1 from albums where org_id = v_alpha), '空相册跟着机构级联删掉';

  -- 活动删了，相册留着，只是不再关联
  delete from events where id = ev_b;
  assert (select event_id from albums where id = b1) is null, '活动删了相册还在，event_id 置空';

  raise notice 'PASS 25_albums (main)';
end $$;

-- ---------------------------------------------------------------------------
-- 11. 权限：anon 调不了 service-role-only 的函数，也读不了表；service_role 可以调。
--     参数随便给：执行权检查发生在函数体运行之前。
-- ---------------------------------------------------------------------------
set local role anon;
do $$
declare
  v_sql text;
  v_fn text;
begin
  foreach v_sql in array array[
    $q$select album_reserve_upload('beta-admin', gen_random_uuid(), 'a.jpg', 'image/jpeg', 1, null)$q$,
    $q$select album_complete_upload('beta-admin', gen_random_uuid(), 1, false, false)$q$,
    $q$select album_objects_for('beta-admin', '{}'::uuid[])$q$,
    $q$select album_photo_ids('beta-admin', gen_random_uuid(), 10)$q$,
    $q$select album_delete_photos('beta-admin', '{}'::uuid[])$q$,
    $q$select album_delete('beta-admin', gen_random_uuid())$q$,
    $q$select _album_used_bytes(gen_random_uuid())$q$,
    $q$select _album_safe_filename('a')$q$,
    $q$select _album_prefix(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$q$,
    $q$select count(*) from albums$q$,
    $q$select count(*) from album_photos$q$,
    $q$select count(*) from album_photo_likes$q$
  ] loop
    begin
      execute v_sql;
      raise exception 'TEST FAILED: anon should not be able to run: %', v_sql;
    exception when insufficient_privilege then
      null;
    end;
  end loop;

  -- 正对照：anon 能调 admin 那几个（被拒绝不是因为 anon 什么都调不了）
  assert (admin_albums('beta-admin') ->> 'quota_bytes')::bigint = 21474836480, 'anon 可以调 admin_albums';
  raise notice 'PASS 25_albums (anon)';
end $$;
reset role;

set local role service_role;
do $$
begin
  assert album_objects_for('beta-admin', '{}'::uuid[]) -> 'objects' = '[]'::jsonb, 'service_role 可以调 album_objects_for';
  raise notice 'PASS 25_albums (service_role)';
end $$;
reset role;

rollback;
