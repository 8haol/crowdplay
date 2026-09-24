-- Life Passport · 机构活动相册（数据库部分）
--
-- 设计：docs/superpowers/specs/2026-09-25-org-photo-albums-design.md（以第 12 节修订为准）
-- 契约：docs/superpowers/plans/2026-09-25-org-photo-albums.md 契约 1
--
-- 原片存在 Cloudflare R2，不在 Postgres：这里只存元数据。浏览器永远拿不到 R2 密钥，
-- 上传 / 下载 / 删除的签名由 Edge Function `album-sign` 用 service role 调下面的
-- album_* 函数完成——所以那几个函数对 anon 撤销执行权，只给 service_role。
-- 浏览、爱心、建相册这些纯元数据操作照老规矩：anon 可调，靠 p_admin_key 定机构。
--
-- 对象路径全部由服务端生成（_album_prefix），浏览器只能提交「原文件名」，
-- 而且要先经 _album_safe_filename 安全化，拼不出额外的路径段。

-- ---------------------------------------------------------------------------
-- 1. 每机构额度。默认 20 GiB：一场园游会的原片 + 视频大约 10G，留一倍余量；
--    超了由超管在 /root 调（platform_set_album_quota），不让 R2 账单悄悄长大。
-- ---------------------------------------------------------------------------
alter table organizations
  add column album_quota_bytes bigint not null default 21474836480;
comment on column organizations.album_quota_bytes is
  '活动相册额度（字节）。默认 20 GiB，超管经 platform_set_album_quota 调整，范围 0–1000 GiB。';

-- ---------------------------------------------------------------------------
-- 2. 表
-- ---------------------------------------------------------------------------
create table albums (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  title      text not null check (length(title) between 1 and 60),
  -- 可选关联某场活动。活动删了相册留着：照片比那场活动的记录更值钱。
  event_id   uuid references events(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table albums is '机构层的活动相册。只对机构内部（持 admin 口令的人）开放。';
create index albums_org_idx on albums (org_id, created_at desc);

create table album_photos (
  id            uuid primary key default gen_random_uuid(),
  album_id      uuid not null references albums(id) on delete cascade,
  -- 原文件名，下载时原样还给用户；落到对象路径里的是安全化之后的版本。
  filename      text not null check (length(filename) between 1 and 200),
  content_type  text not null,
  -- 上限 5,000,000,000：R2 单次 PUT 最多 4.995 GiB，本版不做分片上传。
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 5000000000),
  object_key    text not null,        -- 原片的完整对象路径，服务端生成
  status        text not null default 'pending' check (status in ('pending','ready')),
  has_thumb     boolean not null default false,
  has_preview   boolean not null default false,
  taken_at      timestamptz,          -- 浏览器读 EXIF / 文件 lastModified，排序用
  created_at    timestamptz not null default now()
);
comment on table album_photos is
  'pending = 已登记、原片还在传；ready = complete 核对过大小。pending 预占额度 24 小时，'
  '过期的行在下次登记上传时删掉，其对象前缀交给 Edge Function 去 R2 删。';
create index album_photos_album_status_idx on album_photos (album_id, status);

create table album_photo_likes (
  photo_id   uuid not null references album_photos(id) on delete cascade,
  -- 按设备而不是按人：本项目没有个人账号，同一口令下的每台设备各算一票。
  device_id  uuid not null,
  created_at timestamptz not null default now(),
  primary key (photo_id, device_id)
);

-- 三张表只经 security definer 的 RPC 触达。
alter table albums            enable row level security;
alter table album_photos      enable row level security;
alter table album_photo_likes enable row level security;
revoke all on table albums            from public, anon, authenticated;
revoke all on table album_photos      from public, anon, authenticated;
revoke all on table album_photo_likes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 内部助手
-- ---------------------------------------------------------------------------

-- 已用容量 = ready 的大小 + 24 小时内 pending 的大小。pending 也算，是为了让
-- 并发上传不会各自看到「还有空间」而一起冲破上限；超过 24 小时的 pending 视为
-- 被放弃（关了标签页），不再计入——与 album_reserve_upload 里删过期行的条件
-- 恰好互补（>= 计入，< 删除），不会有一行既不计入又不被清理。
create or replace function _album_used_bytes(p_org_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(p.size_bytes), 0)::bigint
  from album_photos p
  join albums a on a.id = p.album_id
  where a.org_id = p_org_id
    and (p.status = 'ready'
         or (p.status = 'pending' and p.created_at >= now() - interval '24 hours'));
$$;

-- 一张照片在 R2 上的全部对象都在这个前缀下（original/…、thumb.jpg、preview.jpg），
-- 删一张就是删这个前缀。只由 id 拼出，不含任何用户输入。
create or replace function _album_prefix(p_org_id uuid, p_album_id uuid, p_photo_id uuid)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select format('orgs/%s/albums/%s/%s/', p_org_id, p_album_id, p_photo_id);
$$;

-- 文件名安全化：/ \ 与控制字符换成 _，去掉开头的点（挡住 ../ 与隐藏文件），
-- 空了用 file，截到 200 字。结果里不可能再有 /，所以拼不出额外的路径段。
create or replace function _album_safe_filename(p_filename text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select left(coalesce(nullif(
    ltrim(regexp_replace(coalesce(p_filename, ''), '[/\\[:cntrl:]]', '_', 'g'), '.'),
  ''), 'file'), 200);
$$;

revoke execute on function _album_used_bytes(uuid) from public, anon, authenticated, service_role;
revoke execute on function _album_prefix(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function _album_safe_filename(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. admin RPC（anon 可调）
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
    'quota_bytes', v_org.album_quota_bytes,
    'albums', v_albums);
end;
$$;

create or replace function admin_album_create(p_admin_key text, p_title text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   organizations;
  v_title text := btrim(p_title);
  v_id    uuid;
begin
  v_org := _org_by_admin_key(p_admin_key);
  -- 按 trim 后的长度校验并落库 trim 后的值：前端的 .trim() 挡不住直接调用 RPC。
  if v_title is null or length(v_title) not between 1 and 60 then
    raise exception 'BAD_ALBUM_TITLE';
  end if;
  -- 关联的活动必须是本机构的，否则就能把相册挂到别家的活动名下。
  if p_event_id is not null
     and not exists (select 1 from events where id = p_event_id and org_id = v_org.id) then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  insert into albums (org_id, title, event_id)
  values (v_org.id, v_title, p_event_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function admin_album_rename(p_admin_key text, p_album_id uuid, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   organizations;
  v_title text := btrim(p_title);
  v_album albums;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if v_title is null or length(v_title) not between 1 and 60 then
    raise exception 'BAD_ALBUM_TITLE';
  end if;

  update albums set title = v_title
  where id = p_album_id and org_id = v_org.id
  returning * into v_album;
  if not found then raise exception 'ALBUM_NOT_FOUND'; end if;
  return jsonb_build_object('id', v_album.id, 'title', v_album.title);
end;
$$;

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

create or replace function admin_photo_like_toggle(
  p_admin_key text, p_photo_id uuid, p_device_id uuid, p_liked boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   organizations;
  v_liked boolean;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if not exists (
    select 1 from album_photos p join albums a on a.id = p.album_id
    where p.id = p_photo_id and a.org_id = v_org.id and p.status = 'ready'
  ) then
    raise exception 'PHOTO_NOT_FOUND';
  end if;
  -- 前端总会带设备 id；空的只可能是直接调 RPC，不值得单独一个错误码。
  if p_device_id is null then raise exception 'BAD_REQUEST'; end if;

  -- 先删：删到了就是「取消」；没删到再插。on conflict 兜住同一设备的并发双击，
  -- 两次都落到「已点」而不是报主键冲突。
  --
  -- 前端会带上想要的结果 p_liked：api.ts 遇到网络错误会自动重试，纯切换被重试一次就翻回去了，
  -- 「设成已点 / 未点」重试多少次都一样。不带时退回切换，给直接调 RPC 的人用。
  if p_liked is not null then
    if p_liked then
      insert into album_photo_likes (photo_id, device_id) values (p_photo_id, p_device_id)
      on conflict do nothing;
    else
      delete from album_photo_likes where photo_id = p_photo_id and device_id = p_device_id;
    end if;
    v_liked := p_liked;
  else
  delete from album_photo_likes where photo_id = p_photo_id and device_id = p_device_id;
  if found then
    v_liked := false;
  else
    insert into album_photo_likes (photo_id, device_id) values (p_photo_id, p_device_id)
    on conflict do nothing;
    v_liked := true;
  end if;
  end if;

  return jsonb_build_object(
    'liked', v_liked,
    'like_count', (select count(*) from album_photo_likes where photo_id = p_photo_id));
end;
$$;

grant execute on function
  admin_albums(text),
  admin_album_create(text, text, uuid),
  admin_album_rename(text, uuid, text),
  admin_album_photos(text, uuid, uuid),
  admin_photo_like_toggle(text, uuid, uuid, boolean)
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. service role only（Edge Function album-sign 调用）
--    这些函数要么产出对象路径、要么删行，前面必须有函数先签名 / 删 R2 对象，
--    浏览器直接调它们会造出对不上 R2 的元数据，所以对 anon 撤销执行权。
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
  v_quota  bigint;
  v_used   bigint;
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

  -- 锁机构行，把同一机构的登记串起来。不锁的话两个并发事务会各自算出
  -- 「还有空间」然后一起插进去，额度就被冲破了。额度也在锁里重读，
  -- 超管恰好同时改额度时以改完的为准。
  select album_quota_bytes into v_quota from organizations where id = v_org.id for update;

  -- 顺手清理本机构超过 24 小时的 pending（关掉标签页留下的）。删掉的行的前缀
  -- 必须交回给 Edge Function 去删 R2 对象，否则半截原片会变成不计额度、
  -- 数据库里又找不到的孤儿。
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

  v_used := _album_used_bytes(v_org.id);
  if v_used + p_size_bytes > v_quota then
    -- 剩余字节给前端提示「还能传多少」；超管把额度调到已用之下时剩余是 0，不是负数。
    raise exception 'ALBUM_QUOTA_EXCEEDED:%', greatest(v_quota - v_used, 0);
  end if;

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

create or replace function album_complete_upload(
  p_admin_key text,
  p_photo_id uuid,
  p_actual_size bigint,
  p_has_thumb boolean,
  p_has_preview boolean)
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
  where p.id = p_photo_id and a.org_id = v_org.id
  for update of p;
  if not found then raise exception 'PHOTO_NOT_FOUND'; end if;

  -- 幂等：网络重试让 complete 来第二次时，照原样说「好了」，不重复改行。
  if v_photo.status = 'ready' then
    return jsonb_build_object('photo_id', v_photo.id, 'status', 'ready');
  end if;

  -- 大小由 Edge Function 对 R2 做 HEAD 得来（浏览器不许脚本设 Content-Length，
  -- 预签名 URL 里签不进大小）。对不上就说明登记的额度不作数，这一行不能变 ready。
  --
  -- 注意：这里抛异常会让本次调用的整个事务回滚，函数里先删行再抛也删不掉——
  -- Postgres 没有自治事务。所以行留给调用方清：Edge Function 删完对象后走
  -- abort（album_delete_photos）；万一连 abort 也没来，这行 24 小时后按过期
  -- pending 被下一次登记清掉，前缀照样交回去删对象。
  if p_actual_size is distinct from v_photo.size_bytes then
    raise exception 'ALBUM_SIZE_MISMATCH';
  end if;

  update album_photos
     set status = 'ready',
         has_thumb = coalesce(p_has_thumb, false),
         has_preview = coalesce(p_has_preview, false)
   where id = v_photo.id;
  return jsonb_build_object('photo_id', v_photo.id, 'status', 'ready');
end;
$$;

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
      'has_preview', p.has_preview
    ) order by p.created_at, p.id), '[]'::jsonb)
  into v_objects
  from album_photos p join albums a on a.id = p.album_id
  where p.id = any(p_photo_ids) and a.org_id = v_org.id;

  return jsonb_build_object('objects', v_objects);
end;
$$;

create or replace function album_photo_ids(p_admin_key text, p_album_id uuid, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_ids jsonb;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if not exists (select 1 from albums where id = p_album_id and org_id = v_org.id) then
    raise exception 'ALBUM_NOT_FOUND';
  end if;

  -- 含 pending：删整本相册时，还在传的那几张的对象也得删。
  select coalesce(jsonb_agg(t.id order by t.created_at, t.id), '[]'::jsonb) into v_ids
  from (
    select p.id, p.created_at from album_photos p
    where p.album_id = p_album_id
    order by p.created_at, p.id
    limit greatest(coalesce(p_limit, 500), 0)
  ) t;

  return jsonb_build_object('photo_ids', v_ids);
end;
$$;

create or replace function album_delete_photos(p_admin_key text, p_photo_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_n   int;
begin
  v_org := _org_by_admin_key(p_admin_key);
  -- 只删本机构的行；R2 对象由 Edge Function 在调这里之前已经删掉。
  delete from album_photos p
  using albums a
  where p.album_id = a.id and a.org_id = v_org.id and p.id = any(p_photo_ids);
  get diagnostics v_n = row_count;
  return jsonb_build_object('deleted', v_n);
end;
$$;

create or replace function album_delete(p_admin_key text, p_album_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if not exists (select 1 from albums where id = p_album_id and org_id = v_org.id) then
    raise exception 'ALBUM_NOT_FOUND';
  end if;
  -- 还有照片行就拒绝：级联删行不会删 R2 对象，那些原片会变成找不到的孤儿。
  -- Edge Function 要先分批删完照片（album_photo_ids → 删对象 → album_delete_photos）。
  if exists (select 1 from album_photos where album_id = p_album_id) then
    raise exception 'ALBUM_NOT_EMPTY';
  end if;
  delete from albums where id = p_album_id;
  return jsonb_build_object('deleted', p_album_id);
end;
$$;

revoke execute on function
  album_reserve_upload(text, uuid, text, text, bigint, timestamptz),
  album_complete_upload(text, uuid, bigint, boolean, boolean),
  album_objects_for(text, uuid[]),
  album_photo_ids(text, uuid, int),
  album_delete_photos(text, uuid[]),
  album_delete(text, uuid)
from public, anon, authenticated;
grant execute on function
  album_reserve_upload(text, uuid, text, text, bigint, timestamptz),
  album_complete_upload(text, uuid, bigint, boolean, boolean),
  album_objects_for(text, uuid[]),
  album_photo_ids(text, uuid, int),
  album_delete_photos(text, uuid[]),
  album_delete(text, uuid)
to service_role;

-- ---------------------------------------------------------------------------
-- 6. 超管
-- ---------------------------------------------------------------------------

-- 源：20260915000300_visible_admin_keys.sql 第 156 行，唯一改动是多带
-- album_used_bytes、album_quota_bytes 两个字段。
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
      'album_used_bytes', _album_used_bytes(o.id),
      'album_quota_bytes', o.album_quota_bytes
    ) as row
    from organizations o
  ) t;
  return jsonb_build_object('orgs', v);
end;
$$;

-- 源：20260914000200_platform_rpcs.sql 第 177 行，唯一改动是在活动进行中的
-- 检查之后多一道「还有相册照片就拒绝」：级联删机构会删掉照片行，但删不了
-- R2 上的原片，之后数据库里再也找不到它们，成了只花钱的孤儿。
create or replace function platform_delete_org(
  p_platform_key text,
  p_org_id uuid,
  p_confirm_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
begin
  perform _platform_guard(p_platform_key);

  select * into v_org from organizations where id = p_org_id;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  if p_confirm_slug is distinct from v_org.slug then raise exception 'CONFIRM_MISMATCH'; end if;
  if exists (select 1 from events where org_id = p_org_id and phase = 'playing') then
    raise exception 'ORG_HAS_LIVE_EVENT';
  end if;
  if exists (select 1 from album_photos p join albums a on a.id = p.album_id
             where a.org_id = p_org_id) then
    raise exception 'ORG_HAS_ALBUM_PHOTOS';
  end if;

  delete from organizations where id = p_org_id;
  return jsonb_build_object('deleted', v_org.slug);
end;
$$;

create or replace function platform_set_album_quota(
  p_platform_key text,
  p_org_id uuid,
  p_quota_bytes bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
begin
  perform _platform_guard(p_platform_key);
  -- 上限 1000 GiB：/root 的输入框按 GB 填，这里挡住手滑多打几个 0。
  -- 允许调到已用之下：那只是让这间机构暂时传不了新的，已有的照片不受影响。
  if p_quota_bytes is null or p_quota_bytes not between 0 and 1073741824000 then
    raise exception 'BAD_QUOTA';
  end if;

  update organizations set album_quota_bytes = p_quota_bytes
  where id = p_org_id
  returning * into v_org;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  return jsonb_build_object('org_id', v_org.id, 'quota_bytes', v_org.album_quota_bytes);
end;
$$;

-- 权限跟着原迁移的口径重新断言一遍（create or replace 本身不动 grant）。
grant execute on function platform_orgs(text) to anon;
grant execute on function platform_delete_org(text, uuid, text) to anon;
grant execute on function platform_set_album_quota(text, uuid, bigint) to anon, authenticated;
