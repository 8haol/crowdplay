-- Life Passport · 活动相册视频的低画质版
--
-- 同工用运动相机 / 无人机拍的视频码率动辄 50Mbps 以上，灯箱里直接播原片，
-- 手机网络根本跟不上：点开要等很久，播起来一卡一卡。
-- 所以每个视频另存一份 720p、约 2.5Mbps 的 H.264 MP4（对象 <前缀>proxy.mp4），
-- 灯箱默认播它，点「原画质」再切原片。下载 / 存到相册仍然给原片。
--
-- 低画质版在浏览器里转（WebCodecs），跟原片上传并行；原片传完就 ready，
-- 低画质版晚到一会儿也没关系，这时灯箱先播原片。所以它不走 album_complete_upload，
-- 而是单独一个 album_set_proxy，由 Edge Function 在 HEAD 确认对象在了之后调。
--
-- 新列带 default false，已有的行直接得到 false，不会被约束挡住。

alter table album_photos add column if not exists has_proxy boolean not null default false;
comment on column album_photos.has_proxy is
  '视频的低画质版（<前缀>proxy.mp4）传好了没有。灯箱默认播它；没有就播原片。';

-- ---------------------------------------------------------------------------
-- 1. admin_album_photos：多带 has_proxy，其余与 20260925000100 第 223 行一致。
-- ---------------------------------------------------------------------------
create or replace function admin_album_photos(p_admin_key text, p_album_id uuid, p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    organizations;
  v_album  jsonb;
  v_photos jsonb;
begin
  v_org := _org_by_admin_key(p_admin_key);

  select jsonb_build_object('id', a.id, 'title', a.title, 'event_id', a.event_id, 'event_title', e.title)
  into v_album
  from albums a
  left join events e on e.id = a.event_id and e.org_id = a.org_id
  where a.id = p_album_id and a.org_id = v_org.id;
  if v_album is null then raise exception 'ALBUM_NOT_FOUND'; end if;

  -- 只给 ready 的：pending 的原片可能还没传完，签出来的 URL 会是半截文件。
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'filename', p.filename,
      'content_type', p.content_type,
      'size_bytes', p.size_bytes,
      'has_thumb', p.has_thumb,
      'has_preview', p.has_preview,
      'has_proxy', p.has_proxy,
      'taken_at', p.taken_at,
      'created_at', p.created_at,
      'like_count', (select count(*) from album_photo_likes l where l.photo_id = p.id),
      'liked_by_me', exists (select 1 from album_photo_likes l
                             where l.photo_id = p.id and l.device_id = p_device_id)
    ) order by coalesce(p.taken_at, p.created_at), p.id), '[]'::jsonb)
  into v_photos
  from album_photos p
  where p.album_id = p_album_id and p.status = 'ready';

  return jsonb_build_object('album', v_album, 'photos', v_photos);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. album_objects_for：多带 has_proxy，其余与 20260925000100 第 450 行一致。
-- ---------------------------------------------------------------------------
create or replace function album_objects_for(p_admin_key text, p_photo_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     organizations;
  v_objects jsonb;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if coalesce(cardinality(p_photo_ids), 0) > 500 then raise exception 'BAD_FILE'; end if;

  -- 别家的 id 静默忽略而不是报错：一批里混进一个就整批失败没有意义，
  -- 也不告诉调用方「这个 id 在别家存在」。
  select coalesce(jsonb_agg(jsonb_build_object(
      'photo_id', p.id,
      'status', p.status,
      'prefix', _album_prefix(a.org_id, a.id, p.id),
      'original_key', p.object_key,
      'filename', p.filename,
      'content_type', p.content_type,
      'has_thumb', p.has_thumb,
      'has_preview', p.has_preview,
      'has_proxy', p.has_proxy
    ) order by p.created_at, p.id), '[]'::jsonb)
  into v_objects
  from album_photos p join albums a on a.id = p.album_id
  where p.id = any(p_photo_ids) and a.org_id = v_org.id;

  return jsonb_build_object('objects', v_objects);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. album_set_proxy：Edge Function HEAD 过 proxy.mp4 之后标记。
--    只认本机构、已 ready 的视频；重复调用幂等。
-- ---------------------------------------------------------------------------
create or replace function album_set_proxy(p_admin_key text, p_photo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   organizations;
  v_photo album_photos;
begin
  v_org := _org_by_admin_key(p_admin_key);

  select p.* into v_photo
  from album_photos p join albums a on a.id = p.album_id
  where p.id = p_photo_id and a.org_id = v_org.id and p.status = 'ready'
  for update of p;
  if not found then raise exception 'PHOTO_NOT_FOUND'; end if;
  if v_photo.content_type not like 'video/%' then raise exception 'BAD_FILE'; end if;

  update album_photos set has_proxy = true where id = v_photo.id and not has_proxy;
  return jsonb_build_object('photo_id', v_photo.id, 'has_proxy', true);
end;
$$;

-- create or replace 不动 grant：两个改过的函数照原口径再断言一遍，新函数只给 service role。
grant execute on function admin_album_photos(text, uuid, uuid) to anon, authenticated;
revoke execute on function album_objects_for(text, uuid[]) from public, anon, authenticated;
grant execute on function album_objects_for(text, uuid[]) to service_role;
revoke execute on function album_set_proxy(text, uuid) from public, anon, authenticated;
grant execute on function album_set_proxy(text, uuid) to service_role;
