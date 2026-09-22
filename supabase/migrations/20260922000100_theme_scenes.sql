-- 主题专属的人生事件场景。
-- 见 docs/superpowers/specs/2026-09-22-midautumn-life-event-scenes-design.md
--
-- `theme` 为 null 的场景各主题通用（现有 30 个不动）；写了主题的只在那个主题的场次出现。
-- 抽取时先抽本主题专属，抽空了再退回通用库；人生护照主题没有专属场景，行为与从前逐字相同。

alter table life_event_scenes add column theme text
  check (theme is null or _check_theme(theme) is not null);
comment on column life_event_scenes.theme is
  'null = 各主题通用；否则只在 events.theme 相同的场次里抽到。取值由 _check_theme 校验。';

create index life_event_scenes_theme_idx on life_event_scenes (theme) where active;

-- ---------------------------------------------------------------------------
-- 抽取：本主题专属优先，再退回通用
-- 源：20260912000200_tenant_resolve.sql
-- ---------------------------------------------------------------------------
create or replace function _create_event_for_player(p_player players, p_stage integer, p_score integer)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scene life_event_scenes;
  v_theme text;
  v_identity text := coalesce(p_player.identity, 'solo');
  v_audience text;
  v_id uuid;
begin
  select e.theme into v_theme from events e where e.id = p_player.event_id;
  v_audience := case when random() < 0.62 then v_identity else 'all' end;

  -- 第一层：本主题专属，先按抽到的人数身份，再放宽到本身份 + 通用人数。
  select * into v_scene from life_event_scenes s
  where s.active and s.theme = v_theme and s.audience = v_audience
    and not exists (select 1 from life_event_instances i
                    where i.player_id = p_player.id and i.scene_key = s.key)
  order by random() limit 1;

  if not found then
    select * into v_scene from life_event_scenes s
    where s.active and s.theme = v_theme and s.audience in ('all', v_identity)
      and not exists (select 1 from life_event_instances i
                      where i.player_id = p_player.id and i.scene_key = s.key)
    order by random() limit 1;
  end if;

  -- 第二层：通用库，与从前完全一致。
  if not found then
    select * into v_scene from life_event_scenes s
    where s.active and s.theme is null and s.audience = v_audience
      and not exists (select 1 from life_event_instances i
                      where i.player_id = p_player.id and i.scene_key = s.key)
    order by random() limit 1;
  end if;

  if not found then
    select * into v_scene from life_event_scenes s
    where s.active and s.theme is null and s.audience in ('all', v_identity)
      and not exists (select 1 from life_event_instances i
                      where i.player_id = p_player.id and i.scene_key = s.key)
    order by random() limit 1;
  end if;

  if not found then raise exception 'NO_EVENT_SCENE'; end if;

  insert into life_event_instances (
    event_id, player_id, stage, scene_key, scene_snapshot, score_at_trigger
  ) values (
    p_player.event_id, p_player.id, p_stage,
    v_scene.key,
    jsonb_build_object('title', v_scene.title, 'prompt', v_scene.prompt,
                       'emoji', v_scene.emoji, 'choices', v_scene.choices),
    p_score
  ) returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 目录：每个场景带 theme，统计多一组 by_theme
-- 源：20260828081613_awards_and_event_library.sql
-- ---------------------------------------------------------------------------
create or replace function _life_event_catalog_json()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'scenes', (select count(*) from life_event_scenes where active),
      'choices', (select coalesce(sum(jsonb_array_length(choices)), 0)
                  from life_event_scenes where active),
      'outcomes', (select count(*) from life_event_scenes s
        cross join lateral jsonb_array_elements(s.choices) choice
        cross join lateral jsonb_array_elements(choice -> 'outcomes') outcome
        where s.active),
      'by_audience', jsonb_build_object(
        'all', (select count(*) from life_event_scenes where active and audience = 'all'),
        'solo', (select count(*) from life_event_scenes where active and audience = 'solo'),
        'duo', (select count(*) from life_event_scenes where active and audience = 'duo'),
        'trio', (select count(*) from life_event_scenes where active and audience = 'trio')
      ),
      'by_theme', jsonb_build_object(
        'shared', (select count(*) from life_event_scenes where active and theme is null),
        'midautumn', (select count(*) from life_event_scenes where active and theme = 'midautumn')
      )
    ),
    'scenes', coalesce((select jsonb_agg(jsonb_build_object(
      'key', key, 'audience', audience, 'theme', theme, 'title', title, 'prompt', prompt,
      'emoji', emoji, 'choices', choices, 'active', active, 'sort_order', sort_order
    ) order by sort_order, key) from life_event_scenes), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- 中秋专属场景：英国留学生的中秋。每个 2 个行动 × 3 个结果；
-- 每个行动正结果权重合计 40、非正 60（沿用 20260907000100 的平衡规则）。
-- ---------------------------------------------------------------------------
insert into life_event_scenes (key, audience, theme, title, prompt, emoji, choices, sort_order) values
('ma_video_call','all','midautumn','视频那头的团圆饭','家里的团圆饭正开席，视频请求在你逛摊位的时候打了进来。','🌕',
$j$[{"key":"answer","label":"走到摊位边接起来","outcomes":[{"key":"grandma","label":"奶奶把镜头对准整桌菜","detail":"一样样报给你听。隔着屏幕，你也算上桌了。","delta":9,"weight":40,"tone":"good"},{"key":"lag","label":"信号卡成了马赛克","detail":"你们互相喊了几句“听得到吗”，还是笑了。","delta":0,"weight":30,"tone":"neutral"},{"key":"blank","label":"妈妈问的近况你一句也答不上","detail":"挂了电话，你在摊位边站了一会儿。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"later","label":"先回一句“晚点打给你们”","outcomes":[{"key":"waiting","label":"晚上打过去，全家还围在桌边等你","detail":"他们把最后一块月饼留到了你上线。","delta":6,"weight":40,"tone":"good"},{"key":"asleep","label":"回拨时家里已经睡了","detail":"只剩一条“我们都好，你早点睡”。","delta":-3,"weight":35,"tone":"bad"},{"key":"chorus","label":"收到一段三十秒的全桌合唱","detail":"五音不全，你却听了三遍。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1001),
('ma_extra_mooncake','all','midautumn','多出来的一盒月饼','摊位上发月饼，你手里莫名多了一盒。','🥮',
$j$[{"key":"give","label":"送给刚认识的人","outcomes":[{"key":"alone","label":"对方今晚正好一个人过节","detail":"一盒月饼变成了一顿宵夜的约定。","delta":9,"weight":40,"tone":"good"},{"key":"polite","label":"对方客气地推了回来","detail":"你们礼貌地推让了三个回合。","delta":0,"weight":35,"tone":"neutral"},{"key":"vegan","label":"对方吃素，里面是蛋黄的","detail":"好意还在，月饼原路返回。","delta":-3,"weight":25,"tone":"bad"}]},{"key":"keep","label":"带回去给室友","outcomes":[{"key":"double","label":"室友刚好也带了一盒回来","detail":"你们把两种口味切开对半分。","delta":6,"weight":40,"tone":"good"},{"key":"away","label":"室友今晚不回来","detail":"月饼在桌上放到了第二天。","delta":-3,"weight":35,"tone":"bad"},{"key":"squashed","label":"路上被压扁了","detail":"味道没变，样子有点狼狈。","delta":-3,"weight":25,"tone":"bad"}]}]$j$::jsonb,1002),
('ma_last_mooncake','all','midautumn','唐人街的最后一盒','超市货架上只剩最后一盒月饼，另一只手和你同时伸了过去。','🛒',
$j$[{"key":"yield","label":"让给对方","outcomes":[{"key":"half","label":"对方分了一半给你","detail":"你们在门口分完，交换了微信。","delta":9,"weight":40,"tone":"good"},{"key":"gone","label":"对方说了声谢谢就走了","detail":"货架空了，你手里也空着。","delta":-3,"weight":35,"tone":"bad"},{"key":"restock","label":"店员从仓库又搬出一箱","detail":"让了半天，其实还有很多。","delta":0,"weight":25,"tone":"neutral"}]},{"key":"share","label":"提议一起买了分","outcomes":[{"key":"yes","label":"对方一口答应","detail":"一盒月饼，两个人的中秋。","delta":6,"weight":40,"tone":"good"},{"key":"misread","label":"对方误会你在讨价还价","detail":"场面尴尬，最后谁也没拿。","delta":-6,"weight":30,"tone":"bad"},{"key":"wallet","label":"结账时才发现忘带钱包","detail":"对方付了钱，你欠下一顿饭。","delta":0,"weight":30,"tone":"neutral"}]}]$j$::jsonb,1003),
('ma_shift','all','midautumn','中秋夜的排班表','兼职群里发来排班表，你的名字排在今晚。','🧾',
$j$[{"key":"swap","label":"找人换班","outcomes":[{"key":"covered","label":"一个不过中秋的同事接了你的班","detail":"他说：“这个节该你过。”","delta":9,"weight":40,"tone":"good"},{"key":"silence","label":"群里没人回应","detail":"你只能按时去上班。","delta":-6,"weight":35,"tone":"bad"},{"key":"dayoff","label":"经理直接给你放了假","detail":"换班没成，反而多了一个晚上。","delta":0,"weight":25,"tone":"neutral"}]},{"key":"work","label":"去上班","outcomes":[{"key":"boss","label":"老板给店里每个人切了月饼","detail":"打工的中秋，也是一种团圆。","delta":6,"weight":40,"tone":"good"},{"key":"busy","label":"忙到没空看一眼月亮","detail":"下班时月亮已经落到楼后面。","delta":-3,"weight":35,"tone":"bad"},{"key":"customer","label":"一个顾客留下一句“中秋快乐”","detail":"你记了很久。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1004),
('ma_group_dinner','all','midautumn','群里有人问：今晚一起吃饭吗','一个你不太熟的群里，有人问今晚有没有人一起吃饭。','💬',
$j$[{"key":"reply","label":"回一句“我来”","outcomes":[{"key":"table","label":"到了才发现桌上都是新面孔","detail":"一顿饭吃到店家打烊。","delta":9,"weight":40,"tone":"good"},{"key":"two","label":"只有你和发消息的人两个人","detail":"有点尴尬，也聊得很深。","delta":0,"weight":30,"tone":"neutral"},{"key":"queue","label":"餐厅排队排到放弃","detail":"最后各自买了外卖回家。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"ignore","label":"假装没看到","outcomes":[{"key":"dm","label":"另一个人私聊来问你","detail":"原来有人注意到你一直没说话。","delta":6,"weight":40,"tone":"good"},{"key":"photos","label":"刷了一晚上他们的合照","detail":"你有点后悔没有回那句话。","delta":-6,"weight":35,"tone":"bad"},{"key":"solo","label":"你一个人吃了顿好的","detail":"安静，但也不差。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1005),
('ma_lantern_battery','all','midautumn','当灯笼的手机快没电了','你举着手机当灯笼找同伴，电量只剩 5%。','🔋',
$j$[{"key":"borrow","label":"向旁边的人借充电宝","outcomes":[{"key":"guide","label":"对方顺手帮你找到了队友","detail":"借来的电，和顺路的人。","delta":9,"weight":40,"tone":"good"},{"key":"cable","label":"借到了，但线不匹配","detail":"大家一起对着接口发愁。","delta":0,"weight":30,"tone":"neutral"},{"key":"empty","label":"充电宝也是空的","detail":"两个人一起笑了出来。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"save","label":"关掉一切，只留屏幕亮着","outcomes":[{"key":"lasted","label":"电量撑到了最后一个摊位","detail":"省下来的一点光正好够用。","delta":6,"weight":40,"tone":"good"},{"key":"dark","label":"屏幕一黑，人还没找到","detail":"你只好回义工那里报编号。","delta":-6,"weight":35,"tone":"bad"},{"key":"found","label":"有人先认出了你的灯笼色","detail":"不用你找，别人先找到了你。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1006),
('ma_alone_bench','all','midautumn','摊位边独坐的人','排队时你看见一个人独自坐在角落，手里捧着一杯凉掉的茶。','🪑',
$j$[{"key":"greet","label":"走过去打个招呼","outcomes":[{"key":"waiting","label":"对方等的正是有人开口","detail":"你们聊到下一个摊位开始叫号。","delta":9,"weight":40,"tone":"good"},{"key":"phone","label":"对方在等电话，只点了点头","detail":"时机不对，善意还在。","delta":0,"weight":35,"tone":"neutral"},{"key":"friend","label":"对方其实是在等朋友","detail":"你礼貌退开，多了一点不好意思。","delta":-3,"weight":25,"tone":"bad"}]},{"key":"wave","label":"远远招手让他过来","outcomes":[{"key":"joined","label":"他真的站起来加入了你们","detail":"你的队伍多了一个临时成员。","delta":6,"weight":40,"tone":"good"},{"key":"missed","label":"他没看见","detail":"你也没有再走过去。","delta":-3,"weight":35,"tone":"bad"},{"key":"shake","label":"他笑着摇了摇头","detail":"不是每一次邀请都需要答案。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1007),
('ma_old_song','all','midautumn','街角飘来一首老歌','经过 Soho 街角，一家店里放着小时候中秋晚会常放的那首歌。','🎵',
$j$[{"key":"stop","label":"停下来听完","outcomes":[{"key":"replay","label":"店主看见你，又放了一遍","detail":"陌生人听懂了你为什么停下。","delta":9,"weight":40,"tone":"good"},{"key":"linger","label":"歌放完了，你还站在那里","detail":"人群从你身边流过去。","delta":0,"weight":30,"tone":"neutral"},{"key":"hurry","label":"队友在前面喊你快点","detail":"你小跑着追上，歌还在脑子里。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"sing","label":"跟着哼起来","outcomes":[{"key":"duet","label":"旁边有人接上了下一句","detail":"两个不认识的人合唱了一段。","delta":6,"weight":40,"tone":"good"},{"key":"recorded","label":"跑调被队友录了下来","detail":"视频在群里传了一晚上。","delta":-3,"weight":35,"tone":"bad"},{"key":"lyrics","label":"哼到一半忘了词","detail":"原来记得的只有旋律。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1008),
('ma_cloud','all','midautumn','云遮住了月亮','大家都举着手机等拍月亮，一片厚云正好飘了过来。','🌥️',
$j$[{"key":"wait","label":"等云散开","outcomes":[{"key":"big","label":"云一开，月亮比想象中大","detail":"等的人拍到了今晚最好的一张。","delta":9,"weight":40,"tone":"good"},{"key":"thicker","label":"等了十分钟，云更厚了","detail":"你收起手机，月亮留在了心里。","delta":0,"weight":30,"tone":"neutral"},{"key":"cold","label":"等到脚冷也没散","detail":"照片没有，感冒预警倒是有了。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"people","label":"先拍身边的人","outcomes":[{"key":"natural","label":"拍下了今晚最自然的一张合照","detail":"月亮没拍到，人都在。","delta":6,"weight":40,"tone":"good"},{"key":"blink","label":"有人闭眼了，要重拍","detail":"重拍了四次，笑得越来越真。","delta":0,"weight":35,"tone":"neutral"},{"key":"storage","label":"手机存储满了","detail":"你删了三百张旧截图。","delta":-3,"weight":25,"tone":"bad"}]}]$j$::jsonb,1009),

('ma_solo_first','solo','midautumn','异乡的第一个中秋','这是你第一次不在家过中秋。今晚游园会散场后，你打算怎么过？','🏮',
$j$[{"key":"call","label":"回去和家里打一通长电话","outcomes":[{"key":"dawn","label":"聊到那边天亮","detail":"隔着七个小时，你们过了同一个节。","delta":9,"weight":40,"tone":"good"},{"key":"asleep","label":"打过去大家已经睡了","detail":"你对着通讯录看了很久。","delta":-6,"weight":35,"tone":"bad"},{"key":"short","label":"只说了几句就没话了","detail":"想念不一定有很多话。","delta":0,"weight":25,"tone":"neutral"}]},{"key":"stay","label":"留下来帮义工收摊","outcomes":[{"key":"supper","label":"收完摊，义工们一起吃了宵夜","detail":"你被叫住了：下周还来吗？","delta":9,"weight":40,"tone":"good"},{"key":"lastbus","label":"收得太晚，错过了末班车","detail":"你走了很久，月亮一路跟着。","delta":-3,"weight":35,"tone":"bad"},{"key":"quick","label":"收摊只用了十分钟","detail":"你还是一个人走回去了。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1101),
('ma_solo_dinner','solo','midautumn','一人份的团圆饭','冰箱里有材料，手机里有外卖。今晚这顿团圆饭，你一个人怎么吃？','🍲',
$j$[{"key":"cook","label":"照着家里的做法做一顿","outcomes":[{"key":"taste","label":"味道意外地像","detail":"你给妈妈发了照片，她回了三个感叹号。","delta":9,"weight":40,"tone":"good"},{"key":"salty","label":"盐放多了","detail":"吃完了，还是家的味道。","delta":0,"weight":30,"tone":"neutral"},{"key":"missing","label":"做到一半发现少了关键调料","detail":"最后变成了一碗汤。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"order","label":"点一份外卖","outcomes":[{"key":"gift","label":"外卖员多送了一盒月饼","detail":"备注里写着“中秋快乐”。","delta":6,"weight":40,"tone":"good"},{"key":"late","label":"等了一个半小时","detail":"送到时你已经不饿了。","delta":-6,"weight":35,"tone":"bad"},{"key":"photo","label":"吃着吃着刷到家里的饭桌照","detail":"同一个晚上，两张桌子。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1102),

('ma_duo_mooncake','duo','midautumn','两人分一块月饼','只有一块月饼，你想吃蛋黄那一半，队友也是。','🥮',
$j$[{"key":"cut","label":"一刀切开，让对方先选","outcomes":[{"key":"push","label":"对方把蛋黄多的那半推给了你","detail":"你们互相推让，最后各咬一口。","delta":9,"weight":40,"tone":"good"},{"key":"crooked","label":"切歪了，蛋黄全在一边","detail":"你们抽了签。","delta":0,"weight":30,"tone":"neutral"},{"key":"taken","label":"对方毫不犹豫拿走了蛋黄","detail":"你笑着接受了教训。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"trade","label":"用你手里的别的换","outcomes":[{"key":"feast","label":"换成了两个人都想吃的","detail":"一场交易变成了一顿小宴。","delta":6,"weight":40,"tone":"good"},{"key":"refused","label":"对方不吃你手里的那种","detail":"谈判破裂，月饼原样放着。","delta":-3,"weight":35,"tone":"bad"},{"key":"hurried","label":"换到一半被义工催去下一个摊位","detail":"月饼揣进口袋，到最后也没分。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1201),
('ma_duo_lost','duo','midautumn','摊位间走散了','人群一挤，你和队友走散了，两边的手机灯笼都淹在人海里。','🔦',
$j$[{"key":"call","label":"打电话找","outcomes":[{"key":"seen","label":"对方一接就说“我看见你了”","detail":"原来只隔了一个摊位。","delta":9,"weight":40,"tone":"good"},{"key":"muted","label":"对方的手机静音了","detail":"你在原地转了三圈。","delta":-6,"weight":35,"tone":"bad"},{"key":"noisy","label":"电话通了，但谁也听不见","detail":"你们靠喊的找到了彼此。","delta":0,"weight":25,"tone":"neutral"}]},{"key":"stay","label":"站在最亮的地方不动","outcomes":[{"key":"quick","label":"队友很快找回来了","detail":"不动的人最好找。","delta":6,"weight":40,"tone":"good"},{"key":"crowd","label":"站了十分钟，人越来越多","detail":"你开始怀疑自己的方法。","delta":-3,"weight":35,"tone":"bad"},{"key":"another","label":"另一个走散的人先找到了你","detail":"两个人一起等，比一个人等好。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1202),

('ma_trio_moon_route','trio','midautumn','三个人的赏月路线','一个想去河边，一个想上楼顶，一个说哪里都行。散场后去哪看月亮？','🌉',
$j$[{"key":"vote","label":"投票，少数服从多数","outcomes":[{"key":"swing","label":"“哪里都行”的那位投了关键一票","detail":"三个人在河边坐到了很晚。","delta":9,"weight":40,"tone":"good"},{"key":"tie","label":"投出了两个“哪里都行”","detail":"你们在路口站了十分钟。","delta":0,"weight":30,"tone":"neutral"},{"key":"sulk","label":"输的那位一路沉默","detail":"月亮很好，气氛一般。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"both","label":"两个地方都去","outcomes":[{"key":"twice","label":"楼顶看完再走到河边","detail":"一晚上看了两次月亮。","delta":9,"weight":40,"tone":"good"},{"key":"set","label":"走到河边时月亮已经落了","detail":"贪心的路线，只剩夜风。","delta":-6,"weight":35,"tone":"bad"},{"key":"hungry","label":"半路有人饿了","detail":"赏月变成了找宵夜。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1301),
('ma_trio_dishes','trio','midautumn','三个人的家乡菜','三个人来自三个地方，商量中秋一起做饭，菜单却怎么也定不下来。','🍽️',
$j$[{"key":"each","label":"一人一道自己家的菜","outcomes":[{"key":"three","label":"三道菜摆上桌，像三个家","detail":"每一道都吃到了对方的故乡。","delta":9,"weight":40,"tone":"good"},{"key":"clash","label":"三道菜口味打架","detail":"甜的辣的咸的，各自吃各自的。","delta":0,"weight":30,"tone":"neutral"},{"key":"burnt","label":"有一道做砸了","detail":"另外两道分着吃也够了。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"draw","label":"抽签，做一个人的菜","outcomes":[{"key":"loved","label":"抽到的那家菜大家都爱","detail":"一顿饭吃出了新的共同点。","delta":6,"weight":40,"tone":"good"},{"key":"cannot","label":"抽到的那位不会做","detail":"最后叫了外卖。","delta":-3,"weight":35,"tone":"bad"},{"key":"spices","label":"另外两人偷偷加了自己的调料","detail":"一道菜混成了三个味道。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb,1302);
