-- Life Passport · 活动相册去掉每机构额度
--
-- 20260925000100_org_albums.sql 给每个机构设了 20 GiB 上限。视频动辄几个 G，
-- 一场活动就能顶满；R2 存储按量计费、很便宜（每 GB·月 $0.015，前 10 GB 免费），
-- 不值得让同工在活动现场卡在「空间不够」上。所以额度整个拿掉，只保留「已用多少」。
--
-- 单个文件 5,000,000,000 字节的上限不动：那是 R2 单次 PUT 的物理上限，不是额度。
--
-- 顺序：先把三个读了 album_quota_bytes 的函数换掉，再删函数和列。

-- ---------------------------------------------------------------------------
-- 1. admin_albums：返回里去掉 quota_bytes，其余与原迁移第 128 行一致。
-- ---------------------------------------------------------------------------
create or replace function admin_albums(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    organizations;
  v_albums jsonb;
begin
  v_org := _org_by_admin_key(p_admin_key);

  -- 张数、字节数只计 ready：还在传的不该让卡片上的数字跳来跳去。
  -- 封面 = 有缩略图的 ready 照片里爱心最多的，平手取最早拍的。
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'title', a.title,
      'event_id', a.event_id,
      'event_title', e.title,
      'created_at', a.created_at,
      'photo_count', (select count(*) from album_photos p
                      where p.album_id = a.id and p.status = 'ready'),
      'total_bytes', (select coalesce(sum(p.size_bytes), 0)::bigint from album_photos p
                      where p.album_id = a.id and p.status = 'ready'),
      'cover_photo_id', (select p.id from album_photos p
                         where p.album_id = a.id and p.status = 'ready' and p.has_thumb
                         order by (select count(*) from album_photo_likes l where l.photo_id = p.id) desc,
                                  coalesce(p.taken_at, p.created_at), p.id
                         limit 1)
    ) order by a.created_at desc, a.id), '[]'::jsonb)
  into v_albums
  from albums a
  left join events e on e.id = a.event_id and e.org_id = a.org_id
  where a.org_id = v_org.id;

  return jsonb_build_object(
    'used_bytes', _album_used_bytes(v_org.id),
    'albums', v_albums);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. album_reserve_upload：去掉额度检查和为它加的机构行锁，其余与原迁移第 330 行一致。
--    过期 pending 的清理照旧：两个并发登记同时删同一批行时，后到的那个
--    只会拿回自己真正删掉的前缀，不会重复交给 Edge Function。
-- ---------------------------------------------------------------------------
create or replace function album_reserve_upload(
  p_admin_key text,
  p_album_id uuid,
  p_filename text,
  p_content_type text,
  p_size_bytes bigint,
  p_taken_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    organizations;
  v_album  albums;
  v_stale  jsonb;
  v_id     uuid := gen_random_uuid();
  v_prefix text;
  v_key    text;
begin
  v_org := _org_by_admin_key(p_admin_key);

  if p_filename is null or length(p_filename) not between 1 and 200
     or p_content_type is null or p_content_type !~ '^(image|video)/'
     or p_size_bytes is null or p_size_bytes not between 1 and 5000000000 then
    raise exception 'BAD_FILE';
  end if;

  select * into v_album from albums where id = p_album_id and org_id = v_org.id;
  if not found then raise exception 'ALBUM_NOT_FOUND'; end if;

  -- 顺手清理本机构超过 24 小时的 pending（关掉标签页留下的）。删掉的行的前缀
  -- 必须交回给 Edge Function 去删 R2 对象，否则半截原片会变成数据库里找不到、
  -- 却一直在计费的孤儿。
  with gone as (
    delete from album_photos p
    using albums a
    where p.album_id = a.id
      and a.org_id = v_org.id
      and p.status = 'pending'
      and p.created_at < now() - interval '24 hours'
    returning _album_prefix(a.org_id, a.id, p.id) as prefix
  )
  select coalesce(jsonb_agg(prefix), '[]'::jsonb) into v_stale from gone;

  v_prefix := _album_prefix(v_org.id, v_album.id, v_id);
  v_key := v_prefix || 'original/' || _album_safe_filename(p_filename);

  insert into album_photos (id, album_id, filename, content_type, size_bytes, object_key, taken_at)
  values (v_id, v_album.id, p_filename, p_content_type, p_size_bytes, v_key, p_taken_at);

  return jsonb_build_object(
    'photo_id', v_id,
    'prefix', v_prefix,
    'original_key', v_key,
    'stale_prefixes', v_stale);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. platform_orgs：去掉 album_quota_bytes，album_used_bytes 留着——
--    超管看哪家用得多、R2 账单从哪来，还用得上。其余与原迁移第 577 行一致。
-- ---------------------------------------------------------------------------
create or replace function platform_orgs(p_platform_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform _platform_guard(p_platform_key);
  select coalesce(jsonb_agg(t.row order by t.slug), '[]'::jsonb) into v
  from (
    select o.slug, jsonb_build_object(
      'id', o.id,
      'slug', o.slug,
      'name_zh', o.name_zh,
      'name_en', o.name_en,
      'admin_key_plain', o.admin_key_plain,
      'created_at', o.created_at,
      'event_count', (select count(*) from events e where e.org_id = o.id),
      'last_event_at', (select max(e.created_at) from events e where e.org_id = o.id),
      'has_live_event', exists (
        select 1 from events e where e.org_id = o.id and e.phase = 'playing'),
      'album_used_bytes', _album_used_bytes(o.id)
    ) as row
    from organizations o
  ) t;
  return jsonb_build_object('orgs', v);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 删改额度的 RPC 和列
-- ---------------------------------------------------------------------------
drop function platform_set_album_quota(text, uuid, bigint);
alter table organizations drop column album_quota_bytes;

-- create or replace 不动 grant，这里照原口径再断言一遍。
grant execute on function admin_albums(text) to anon, authenticated;
revoke execute on function album_reserve_upload(text, uuid, text, text, bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function album_reserve_upload(text, uuid, text, text, bigint, timestamptz) to service_role;
grant execute on function platform_orgs(text) to anon;
