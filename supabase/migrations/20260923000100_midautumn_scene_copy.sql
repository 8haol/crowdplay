-- 中秋专属场景文案复审。只改文字，行动 / 结果的 key、delta、weight、tone 一律不动，
-- 平衡规则与已结算的 scene_snapshot 都不受影响。
--
-- 改动原因：
-- 1. 时差：英国晚上是国内凌晨，「家里团圆饭正开席」对不上；中秋当天（9/25）与游园会
--    （9/24）也不是同一晚，凡是写死「今晚」是中秋的改成「中秋那晚」。
-- 2. 通用人数（audience = all）的场景 solo 玩家也会抽到，不能出现「队友」「你们」「队伍」。
-- 3. 主题场景各机构共用，不写死 Soho。
-- 4. 结果写成同行队友小气、赌气、不会做饭的，改成与人无关的小意外（同行的人就站在旁边看屏幕）。
-- 5. 标成中性的结果其实明显是好事（被放假、被别人先找到），换成真正中性的。
-- 6. 满月整夜都在天上，「月亮已经落了」改掉；深夜独自走很久回家、外卖员送月饼等不太合理的细节改掉。

update life_event_scenes set title = '视频那头的家',
  prompt = '国内已是深夜，家里人还没睡，视频请求在你逛摊位的时候打了进来。',
  choices = $j$[{"key":"answer","label":"走到摊位边接起来","outcomes":[{"key":"grandma","label":"奶奶把镜头对准桌上的月饼","detail":"一样样报给你听是什么馅。隔着屏幕，你也算分到了一块。","delta":9,"weight":40,"tone":"good"},{"key":"lag","label":"信号卡成了马赛克","detail":"你们互相喊了几句“听得到吗”，还是笑了。","delta":0,"weight":30,"tone":"neutral"},{"key":"blank","label":"刚接通，摊位就叫到了你的号","detail":"你匆匆说了句“中秋快乐”，就挂断了。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"later","label":"先回一句“明天打给你们”","outcomes":[{"key":"waiting","label":"第二天打过去，全家都守在镜头前","detail":"他们特意留了一块月饼，等着在视频里“分”给你。","delta":6,"weight":40,"tone":"good"},{"key":"asleep","label":"第二天打过去，家里人都出门了","detail":"只收到一条“我们都好，你照顾好自己”。","delta":-3,"weight":35,"tone":"bad"},{"key":"chorus","label":"收到一段三十秒的全家合唱","detail":"五音不全，你却听了三遍。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_video_call';

update life_event_scenes set
  prompt = '唐人街超市的货架上只剩最后一盒月饼，另一只手和你同时伸了过去。',
  choices = $j$[{"key":"yield","label":"让给对方","outcomes":[{"key":"half","label":"对方分了一半给你","detail":"你们在门口分完，交换了微信。","delta":9,"weight":40,"tone":"good"},{"key":"gone","label":"对方说了声谢谢就走了","detail":"货架空了，你手里也空着。","delta":-3,"weight":35,"tone":"bad"},{"key":"restock","label":"店员从仓库又搬出一箱","detail":"让了半天，其实还有很多。","delta":0,"weight":25,"tone":"neutral"}]},{"key":"share","label":"提议一起买了分","outcomes":[{"key":"yes","label":"对方一口答应","detail":"一盒月饼，两个人的中秋。","delta":6,"weight":40,"tone":"good"},{"key":"misread","label":"对方说这盒是要寄回家的","detail":"你松开手，看着它被包成了礼物。","delta":-6,"weight":30,"tone":"bad"},{"key":"wallet","label":"结账时才发现忘带钱包","detail":"对方付了钱，你欠下一顿饭。","delta":0,"weight":30,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_last_mooncake';

update life_event_scenes set
  prompt = '兼职群里发来排班表，你的名字正排在中秋那晚。',
  choices = $j$[{"key":"swap","label":"找人换班","outcomes":[{"key":"covered","label":"一个不过中秋的同事接了你的班","detail":"对方说：“这个节该你过。”","delta":9,"weight":40,"tone":"good"},{"key":"silence","label":"群里没人回应","detail":"你只能按时去上班。","delta":-6,"weight":35,"tone":"bad"},{"key":"dayoff","label":"有人肯换，条件是你下周末顶两天","detail":"中秋保住了，周末没了。","delta":0,"weight":25,"tone":"neutral"}]},{"key":"work","label":"去上班","outcomes":[{"key":"boss","label":"老板给店里每个人切了月饼","detail":"打工的中秋，也是一种团圆。","delta":6,"weight":40,"tone":"good"},{"key":"busy","label":"忙到没空看一眼月亮","detail":"下班时月亮已经躲到楼后面。","delta":-3,"weight":35,"tone":"bad"},{"key":"customer","label":"一个顾客留下一句“中秋快乐”","detail":"你记了很久。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_shift';

update life_event_scenes set
  title = '群里有人问：中秋一起吃饭吗',
  prompt = '一个你不太熟的群里，有人问中秋那晚有没有人一起吃饭。'
where key = 'ma_group_dinner';

update life_event_scenes set
  prompt = '你举着手机当灯笼穿过人群，电量只剩 5%。',
  choices = $j$[{"key":"borrow","label":"向旁边的人借充电宝","outcomes":[{"key":"guide","label":"对方还顺手给你指了下一个摊位","detail":"借来的电，和顺路的人。","delta":9,"weight":40,"tone":"good"},{"key":"cable","label":"借到了，但线不匹配","detail":"两个人一起对着接口发愁。","delta":0,"weight":30,"tone":"neutral"},{"key":"empty","label":"对方的充电宝也是空的","detail":"两部手机一起进入了省电模式。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"save","label":"关掉一切，只留屏幕亮着","outcomes":[{"key":"lasted","label":"电量撑到了最后一个摊位","detail":"省下来的一点光正好够用。","delta":6,"weight":40,"tone":"good"},{"key":"dark","label":"屏幕一黑，灯笼也灭了","detail":"你只好去找义工借电。","delta":-6,"weight":35,"tone":"bad"},{"key":"found","label":"省电模式把屏幕调得太暗","detail":"灯笼还亮着，只是暗得像一盏小夜灯。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_lantern_battery';

update life_event_scenes set
  choices = $j$[{"key":"greet","label":"走过去打个招呼","outcomes":[{"key":"waiting","label":"对方等的正是有人开口","detail":"你们聊到下一个摊位开始叫号。","delta":9,"weight":40,"tone":"good"},{"key":"phone","label":"对方在等电话，只点了点头","detail":"时机不对，善意还在。","delta":0,"weight":35,"tone":"neutral"},{"key":"friend","label":"对方其实是在等朋友","detail":"你礼貌退开，多了一点不好意思。","delta":-3,"weight":25,"tone":"bad"}]},{"key":"wave","label":"远远招手请对方过来","outcomes":[{"key":"joined","label":"对方真的起身走了过来","detail":"接下来的摊位，你多了一个同行的人。","delta":6,"weight":40,"tone":"good"},{"key":"missed","label":"对方没看见","detail":"你也没有再走过去。","delta":-3,"weight":35,"tone":"bad"},{"key":"shake","label":"对方笑着摇了摇头","detail":"不是每一次邀请都需要答案。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_alone_bench';

update life_event_scenes set
  prompt = '经过街角，一家店里放着小时候中秋晚会常放的那首歌。',
  choices = $j$[{"key":"stop","label":"停下来听完","outcomes":[{"key":"replay","label":"店主看见你，又放了一遍","detail":"陌生人听懂了你为什么停下。","delta":9,"weight":40,"tone":"good"},{"key":"linger","label":"歌放完了，你还站在那里","detail":"人群从你身边流过去。","delta":0,"weight":30,"tone":"neutral"},{"key":"hurry","label":"摊位那边开始叫号了","detail":"你小跑着赶过去，歌还在脑子里。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"sing","label":"跟着哼起来","outcomes":[{"key":"duet","label":"旁边有人接上了下一句","detail":"两个不认识的人合唱了一段。","delta":6,"weight":40,"tone":"good"},{"key":"recorded","label":"一开口就跑了调","detail":"旁边的小朋友笑出了声。","delta":-3,"weight":35,"tone":"bad"},{"key":"lyrics","label":"哼到一半忘了词","detail":"原来记得的只有旋律。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_old_song';

update life_event_scenes set
  prompt = '这是你第一次不在家过中秋。游园会散场后，你打算怎么过这个节？',
  choices = $j$[{"key":"call","label":"回去和家里打一通长电话","outcomes":[{"key":"dawn","label":"聊到那边天亮","detail":"隔着七个小时，你们过了同一个节。","delta":9,"weight":40,"tone":"good"},{"key":"asleep","label":"打过去大家已经睡了","detail":"你对着通讯录看了很久。","delta":-6,"weight":35,"tone":"bad"},{"key":"short","label":"只说了几句就没话了","detail":"想念不一定有很多话。","delta":0,"weight":25,"tone":"neutral"}]},{"key":"stay","label":"留下来帮义工收摊","outcomes":[{"key":"supper","label":"收完摊，义工们一起吃了宵夜","detail":"你被叫住了：下周还来吗？","delta":9,"weight":40,"tone":"good"},{"key":"lastbus","label":"收得太晚，末班地铁已经走了","detail":"你坐了一个小时夜巴，月亮一路跟着。","delta":-3,"weight":35,"tone":"bad"},{"key":"quick","label":"收摊只用了十分钟","detail":"你还是一个人走回去了。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_solo_first';

update life_event_scenes set
  prompt = '冰箱里有材料，手机里有外卖。中秋那晚的团圆饭，你一个人怎么吃？',
  choices = $j$[{"key":"cook","label":"照着家里的做法做一顿","outcomes":[{"key":"taste","label":"味道意外地像","detail":"你给妈妈发了照片，她回了三个感叹号。","delta":9,"weight":40,"tone":"good"},{"key":"salty","label":"盐放多了","detail":"吃完了，还是家的味道。","delta":0,"weight":30,"tone":"neutral"},{"key":"missing","label":"做到一半发现少了关键调料","detail":"最后变成了一碗汤。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"order","label":"点一份外卖","outcomes":[{"key":"gift","label":"店家多塞了一个月饼","detail":"小票上手写着“中秋快乐”。","delta":6,"weight":40,"tone":"good"},{"key":"late","label":"等了一个半小时","detail":"送到时你已经不饿了。","delta":-6,"weight":35,"tone":"bad"},{"key":"photo","label":"吃着吃着刷到家里的饭桌照","detail":"同一个晚上，两张桌子。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_solo_dinner';

update life_event_scenes set
  choices = $j$[{"key":"cut","label":"一刀切开，让对方先选","outcomes":[{"key":"push","label":"对方把蛋黄多的那半推给了你","detail":"你们互相推让，最后各咬一口。","delta":9,"weight":40,"tone":"good"},{"key":"crooked","label":"切歪了，蛋黄全在一边","detail":"你们抽了签。","delta":0,"weight":30,"tone":"neutral"},{"key":"taken","label":"一刀下去，蛋黄整个滚到了地上","detail":"两个人对着地面愣了三秒。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"trade","label":"用你手里的别的换","outcomes":[{"key":"feast","label":"换成了两个人都想吃的","detail":"一场交易变成了一顿小宴。","delta":6,"weight":40,"tone":"good"},{"key":"refused","label":"对方不吃你手里的那种","detail":"谈判破裂，月饼原样放着。","delta":-3,"weight":35,"tone":"bad"},{"key":"hurried","label":"换到一半被义工催去下一个摊位","detail":"月饼揣进口袋，到最后也没分。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_duo_mooncake';

update life_event_scenes set
  choices = $j$[{"key":"vote","label":"投票，少数服从多数","outcomes":[{"key":"swing","label":"“哪里都行”的那位投了关键一票","detail":"三个人在河边坐到了很晚。","delta":9,"weight":40,"tone":"good"},{"key":"tie","label":"投出了两个“哪里都行”","detail":"你们在路口站了十分钟。","delta":0,"weight":30,"tone":"neutral"},{"key":"sulk","label":"河边的风比想象中大","detail":"月亮很好，三个人冻得直跺脚。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"both","label":"两个地方都去","outcomes":[{"key":"twice","label":"楼顶看完再走到河边","detail":"一晚上看了两次月亮。","delta":9,"weight":40,"tone":"good"},{"key":"set","label":"走到河边时，云把月亮遮住了","detail":"贪心的路线，只剩夜风。","delta":-6,"weight":35,"tone":"bad"},{"key":"hungry","label":"半路有人饿了","detail":"赏月变成了找宵夜。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_trio_moon_route';

update life_event_scenes set
  choices = $j$[{"key":"each","label":"一人一道自己家的菜","outcomes":[{"key":"three","label":"三道菜摆上桌，像三个家","detail":"每一道都吃到了对方的故乡。","delta":9,"weight":40,"tone":"good"},{"key":"clash","label":"三道菜口味打架","detail":"甜的辣的咸的，各自吃各自的。","delta":0,"weight":30,"tone":"neutral"},{"key":"burnt","label":"有一道做砸了","detail":"另外两道分着吃也够了。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"draw","label":"抽签，做一个人的菜","outcomes":[{"key":"loved","label":"抽到的那家菜大家都爱","detail":"一顿饭吃出了新的共同点。","delta":6,"weight":40,"tone":"good"},{"key":"cannot","label":"抽到的那道菜，食材这里买不到","detail":"最后叫了外卖。","delta":-3,"weight":35,"tone":"bad"},{"key":"spices","label":"另外两人偷偷加了自己的调料","detail":"一道菜混成了三个味道。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_trio_dishes';
