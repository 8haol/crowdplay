-- Tests: 视频低画质版的标记。只认本机构、已 ready 的视频；幂等；列表和对象查询都带出 has_proxy；
-- album_set_proxy 只给 service role。
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values
  ('alpha', '甲教会', 'Alpha Church', 'alpha-admin'),
  ('beta',  '乙教会', 'Beta Church',  'beta-admin');

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
  a1 uuid; b1 uuid;
  v_video uuid; v_photo uuid; v_pending uuid; v_beta uuid;
  r jsonb;
begin
  a1 := (admin_album_create('alpha-admin', '甲相册', null) ->> 'id')::uuid;
  b1 := (admin_album_create('beta-admin', '乙相册', null) ->> 'id')::uuid;

  v_video   := (album_reserve_upload('alpha-admin', a1, 'clip.mp4', 'video/mp4', 100, null) ->> 'photo_id')::uuid;
  v_photo   := (album_reserve_upload('alpha-admin', a1, 'a.jpg', 'image/jpeg', 100, null) ->> 'photo_id')::uuid;
  v_pending := (album_reserve_upload('alpha-admin', a1, 'b.mov', 'video/quicktime', 100, null) ->> 'photo_id')::uuid;
  v_beta    := (album_reserve_upload('beta-admin', b1, 'c.mp4', 'video/mp4', 100, null) ->> 'photo_id')::uuid;
  perform album_complete_upload('alpha-admin', v_video, 100, true, true);
  perform album_complete_upload('alpha-admin', v_photo, 100, true, true);
  perform album_complete_upload('beta-admin', v_beta, 100, true, true);

  r := admin_album_photos('alpha-admin', a1, null);
  assert (select bool_and(not (p ->> 'has_proxy')::boolean) from jsonb_array_elements(r -> 'photos') p),
    '新上传的默认没有低画质版';

  r := album_set_proxy('alpha-admin', v_video);
  assert (r ->> 'has_proxy')::boolean, 'set_proxy 回 has_proxy = true';
  assert (select has_proxy from album_photos where id = v_video), '视频标上了低画质版';
  r := album_set_proxy('alpha-admin', v_video);
  assert (r ->> 'has_proxy')::boolean, '重复标记幂等';

  r := admin_album_photos('alpha-admin', a1, null);
  assert (select (p ->> 'has_proxy')::boolean from jsonb_array_elements(r -> 'photos') p
          where p ->> 'id' = v_video::text), '列表带出 has_proxy';
  r := album_objects_for('alpha-admin', array[v_video]);
  assert (r -> 'objects' -> 0 ->> 'has_proxy')::boolean, 'album_objects_for 带出 has_proxy';

  perform pg_temp.expect_err(format('select album_set_proxy(%L, %L)', 'alpha-admin', v_photo), 'BAD_FILE');
  perform pg_temp.expect_err(format('select album_set_proxy(%L, %L)', 'alpha-admin', v_pending), 'PHOTO_NOT_FOUND');
  perform pg_temp.expect_err(format('select album_set_proxy(%L, %L)', 'alpha-admin', v_beta), 'PHOTO_NOT_FOUND');
  perform pg_temp.expect_err(format('select album_set_proxy(%L, %L)', 'alpha-admin', gen_random_uuid()), 'PHOTO_NOT_FOUND');
  assert not (select has_proxy from album_photos where id = v_beta), '别家的视频没被改';

  raise notice 'PASS 26_album_proxy (main)';
end $$;

set local role anon;
do $$
begin
  begin
    perform album_set_proxy('beta-admin', gen_random_uuid());
    raise exception 'TEST FAILED: anon should not be able to run album_set_proxy';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform album_objects_for('beta-admin', '{}'::uuid[]);
    raise exception 'TEST FAILED: anon should not be able to run album_objects_for';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS 26_album_proxy (anon)';
end $$;
reset role;

set local role service_role;
do $$
begin
  perform pg_temp.expect_err(format('select album_set_proxy(%L, %L)', 'beta-admin', gen_random_uuid()), 'PHOTO_NOT_FOUND');
  raise notice 'PASS 26_album_proxy (service_role)';
end $$;
reset role;

rollback;
