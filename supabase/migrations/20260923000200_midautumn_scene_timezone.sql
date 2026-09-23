-- 中秋场景时差再修：英国晚上是国内凌晨，场景里不能有家人半夜接电话 / 秒回消息。
-- 联系家里改成「家里白天录好的视频」「发语音、第二天醒来看回复」「英国早上 = 国内下午回电话」。
-- 同样只改文字，key、delta、weight、tone 不动。

update life_event_scenes set title = '视频那头的团圆饭',
  prompt = '家里人白天吃团圆饭时录了一段视频，趁你逛摊位的时候发了过来。',
  choices = $j$[{"key":"answer","label":"走到摊位边点开看","outcomes":[{"key":"grandma","label":"奶奶举着镜头把整桌菜拍了一圈","detail":"一样样报给你听。隔着屏幕，你也算上桌了。","delta":9,"weight":40,"tone":"good"},{"key":"lag","label":"视频加载到一半卡住了","detail":"你盯着转圈的画面，还是笑了。","delta":0,"weight":30,"tone":"neutral"},{"key":"blank","label":"刚点开，摊位就叫到了你的号","detail":"你把手机揣回兜里，那桌菜只看了一眼。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"later","label":"先存着，明早给家里回电话","outcomes":[{"key":"waiting","label":"第二天一早打过去，全家都守在镜头前","detail":"他们特意留了一块月饼，等着在视频里“分”给你。","delta":6,"weight":40,"tone":"good"},{"key":"asleep","label":"第二天打过去，家里人都出门了","detail":"只收到一条“我们都好，你照顾好自己”。","delta":-3,"weight":35,"tone":"bad"},{"key":"chorus","label":"又收到一段三十秒的全家合唱","detail":"五音不全，你却听了三遍。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_video_call';

update life_event_scenes set
  choices = $j$[{"key":"call","label":"给家里发一段长长的语音","outcomes":[{"key":"dawn","label":"第二天醒来，全家轮流回了语音","detail":"隔着七个小时，你们过了同一个节。","delta":9,"weight":40,"tone":"good"},{"key":"asleep","label":"等了一上午，只等来一个“👍”","detail":"你对着屏幕看了很久。","delta":-6,"weight":35,"tone":"bad"},{"key":"short","label":"录了三遍，还是删了重来","detail":"想念不一定有很多话。","delta":0,"weight":25,"tone":"neutral"}]},{"key":"stay","label":"留下来帮义工收摊","outcomes":[{"key":"supper","label":"收完摊，义工们一起吃了宵夜","detail":"你被叫住了：下周还来吗？","delta":9,"weight":40,"tone":"good"},{"key":"lastbus","label":"收得太晚，末班地铁已经走了","detail":"你坐了一个小时夜巴，月亮一路跟着。","delta":-3,"weight":35,"tone":"bad"},{"key":"quick","label":"收摊只用了十分钟","detail":"你还是一个人走回去了。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_solo_first';

update life_event_scenes set
  choices = $j$[{"key":"cook","label":"照着家里的做法做一顿","outcomes":[{"key":"taste","label":"味道意外地像","detail":"你给妈妈发了照片，第二天醒来看到她回了三个感叹号。","delta":9,"weight":40,"tone":"good"},{"key":"salty","label":"盐放多了","detail":"吃完了，还是家的味道。","delta":0,"weight":30,"tone":"neutral"},{"key":"missing","label":"做到一半发现少了关键调料","detail":"最后变成了一碗汤。","delta":-3,"weight":30,"tone":"bad"}]},{"key":"order","label":"点一份外卖","outcomes":[{"key":"gift","label":"店家多塞了一个月饼","detail":"小票上手写着“中秋快乐”。","delta":6,"weight":40,"tone":"good"},{"key":"late","label":"等了一个半小时","detail":"送到时你已经不饿了。","delta":-6,"weight":35,"tone":"bad"},{"key":"photo","label":"吃着吃着刷到家里白天的饭桌照","detail":"同一个节，两张桌子。","delta":0,"weight":25,"tone":"neutral"}]}]$j$::jsonb
where key = 'ma_solo_dinner';
