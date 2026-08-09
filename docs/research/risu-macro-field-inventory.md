# RisuAI CBS 宏与 botPreset 字段穷举清单

> 纯源码研究产物，未修改任何文件。所有信息均直接取自以下源码文件，非记忆/文档推断。

## 来源文件（含行号依据）

| 文件 | 用途 | 关键行号 |
|---|---|---|
| `rius/risuai-src/src/ts/cbs.ts` | CBS 宏注册表（`registerCBS` 内逐条 `registerFunction`） | `name:` 字段第 147~2499 行；共 **176** 次注册（其中 `time` 注册 2 次，唯一名 **175** 个） |
| `rius/risuai-src/src/etc/docs/cbs_docs.cbs` | 官方 CSV 宏文档（name/description/aliases/arguments/example 五行一表） | 第 9~170 行；数据行 **142** 行，去重后 **139** 个文档名 |
| `rius/risuai-src/src/ts/parser/parser.svelte.ts` | `risuChatParser` 实现，块结构（`blockStartMatcher`/`blockEndMatcher`）与特殊语法 | `blockStartMatcher` L1153~1424；`blockEndMatcher` L1432~1505；`risuChatParser` L1538 |
| `rius/risuai-src/src/ts/gui/codearea/cbsMonaco.ts` | Monaco 高亮宏集合（`getMacroData()`） | 复用 `registerCBS`，跳过 `internalOnly`，无独立名单 |
| `rius/risuai-src/src/ts/gui/highlight.ts` | 高亮用宏名单（`normalCBS`/`normalCBSwithParams`/`displayRelatedCBS`/`nestedCBS`/`decorators`） | L162~198 |
| `rius/risuai-src/src/ts/storage/database.svelte.ts` | `botPreset` 接口、`presetTemplate` 默认值、`saveCurrentPreset`/`setPreset` 映射、`customscript` 接口 | 接口 L1580~1682；`presetTemplate` L1985~2019；`saveCurrentPreset` L2036~2120；`customscript` L1307~1313 |
| `rius/risuai-src/src/ts/process/prompt.ts` | `PromptItem` 联合类型与 `PromptType`/`PromptRole`/`PromptSettings` | L7~62 |
| `rius/risuai-src/src/ts/process/scripts.ts` | regex 脚本（customscript）执行与 flag 解析 | `ScriptMode` L18；flag 解析 L296~333；OUT 替换 L160~165、L220~233；`{{data}}` 常量 L16 |
| `rius/risuai-src/src/ts/request/request.ts` 等 | 参数单位验证（temperature/penalty 均为 ×100） | request.ts L458,672,895；openAI/requests.ts L940~941 |

---

## 一、宏清单（按 cbs.ts 注册顺序归类）

> 列：**注册名**（cbs.ts `name`，即实际可用宏）/ **别名**（cbs.ts `alias`）/ **文档名**（cbs_docs.cbs 首列）/ 参数 / 简述。
> 说明：cbs.ts 中 `name` 与 `alias` 均会被解析器识别；cbs_docs.cbs 的“文档名”多为带下划线形态，**部分在实现中并不存在**（见文末不一致清单）。

### 1.1 角色 / 用户 / 聊天数据

| 注册名 | 别名 | 文档名 | 参数 | 简述 |
|---|---|---|---|---|
| `char` | `bot` | `char` | - | 当前角色昵称或名字；consistantChar 模式返回 `botname` |
| `user` | - | `user` | - | 当前用户名；consistantChar 模式返回 `username` |
| `trigger_id` | `triggerid` | （文档无） | - | 点击 `risu-id` 属性元素触发的 trigger ID，无则 `null` |
| `previouscharchat` | `previouscharchat`(自名), `lastcharmessage` | `previous_char_chat` | - | 最近一条角色消息（向前搜索）；无则返回 firstMessage/所选问候 |
| `previoususerchat` | `previoususerchat`(自名), `lastusermessage` | `previous_user_chat` | - | 最近一条用户消息；chatID=-1 时返回空串 |
| `personality` | `charpersona` | `personality` | - | 角色 personality 字段（经解析器处理）；群聊返回空 |
| `description` | `chardesc` | `description` | - | 角色 desc 字段（经解析器处理）；群聊返回空 |
| `scenario` | - | `scenario` | - | 角色 scenario 字段（经解析器处理）；群聊返回空 |
| `exampledialogue` | `examplemessage`, `example_dialogue` | `example_dialogue` | - | 角色 exampleMessage 字段；群聊返回空 |
| `persona` | `userpersona` | `persona` | - | 用户 persona 提示词（经解析器处理） |
| `mainprompt` | `systemprompt`, `main_prompt` | `main_prompt` | - | 主 system prompt（`db.mainPrompt`，经解析器处理） |
| `lorebook` | `worldinfo` | `lorebook` | - | 活动 lorebook 条目 JSON 数组（角色+聊天+模块，条目被 stringify） |
| `userhistory` | `usermessages`, `user_history` | `user_history` | - | 全部用户消息 JSON 数组（data 经解析器处理） |
| `charhistory` | `charmessages`, `char_history` | `char_history` | - | 全部角色消息 JSON 数组（data 经解析器处理） |
| `jb` | `jailbreak` | （文档无） | - | jailbreak 提示词（`db.jailbreak`） |
| `globalnote` | `globalnote`(自名), `systemnote`, `ujb` | `ujb` | - | 全局/系统备注（`db.globalNote`） |
| `authornote` | `author_note` | （文档无） | - | 当前聊天作者注释，无则回退 promptTemplate 中 `authornote` 卡的 defaultText |
| `chatindex` | `chat_index` | `chat_index` | - | 当前消息索引（string，-1 表示无上下文） |
| `firstmsgindex` | `firstmessageindex`, `first_msg_index` | `first_msg_index` | - | 所选 firstMessage/问候索引（string） |
| `blank` | `none` | `blank` | - | 空字符串 |
| `messagetime` | `message_time` | `message_time` | - | 消息本地时间 HH:MM:SS；无时间/旧版本返回错误文案 |
| `messagedate` | `message_date` | `message_date` | - | 消息本地日期；同上 |
| `messageunixtimearray` | `message_unixtime_array` | `message_unixtime_array` | - | 全部消息毫秒时间戳 JSON 数组（缺省为 0） |
| `unixtime` | - | `unixtime` | - | 当前 Unix 秒时间戳（string） |
| `time` | - | `time` | - | 当前本地时间 HH:MM:SS |
| `isotime` | - | `isotime` | - | 当前 UTC 时间 HH:MM:SS |
| `isodate` | - | `isodate` | - | 当前 UTC 日期 YYYY-M-D |
| `messageidleduration` | `message_idle_duration` | `message_idle_duration` | - | 最近两条用户消息间隔 HH:MM:SS |
| `idleduration` | `idle_duration` | `idle_duration` | - | 自最后一条消息以来的时长 HH:MM:SS |
| `br` | `newline` | `br` | - | 字面换行 `\n` |
| `cbr` | `cnl`, `cnewline` | `cbr` | 可选 `次数` | 转义换行字串 `\\n`；带参数时重复 N 次（≥1） |
| `model` | - | `model` | - | 当前 AI 模型 ID（`db.aiModel`） |
| `axmodel` | - | `axmodel` | - | 当前子模型 ID（`db.subModel`） |
| `role` | - | `role` | - | 当前消息角色 user/char/system；首条消息返回 `char` |
| `isfirstmsg` | `isfirstmsg`(自名), `isfirstmessage` | `isfirstmsg` | - | 首条消息上下文返回 `1`，否则 `0` |
| `jbtoggled` | - | （文档无） | - | jailbreak 开关状态 `1`/`0` |
| `maxcontext` | - | `maxcontext` | - | 最大上下文长度（string） |
| `lastmessage` | - | `lastmessage` | - | 当前聊天最后一条消息内容（任意角色） |
| `lastmessageid` | `lastmessageindex` | `lastmessageid` | - | 最后一条消息索引（0 基，string） |
| `history` | `messages` | `history` | 可选 `role` | 聊天历史 JSON 数组；无参=完整消息对象，`role`=每条加 `role: ` 前缀 |
| `emotionlist` | - | `emotionlist` | - | 角色情感图名称 JSON 数组 |
| `assetlist` | - | `assetlist` | - | 角色附加素材名称 JSON 数组 |
| `prefillsupported` | `prefill_supported`, `prefill` | `prefill_supported` | - | 模型是否支持 prefill（claude 前缀 → `1`） |
| `screenwidth` | `screen_width` | `screen_width` | - | 视口宽度 px（string） |
| `screenheight` | `screen_height` | `screen_height` | - | 视口高度 px（string） |
| `chardisplayasset` | - | （文档无） | - | 角色显示素材名称 JSON 数组（按 prebuiltAssetExclude 过滤） |

### 1.2 变量

| 注册名 | 别名 | 文档名 | 参数 | 简述 |
|---|---|---|---|---|
| `tempvar` | `gettempvar` | `tempvar` | `name` | 读取临时变量（仅本次脚本执行期有效） |
| `settempvar` | - | `settempvar` | `name/value` | 写入临时变量，返回空串 |
| `return` | - | `return` | `value` | 设置返回值并强制结束脚本（置 `__return__`/`__force_return__`） |
| `getvar` | - | `getvar` | `name` | 读取持久化聊天变量 |
| `calc` | - | `calc` | `expression` | 计算数学表达式并返回 string |
| `addvar` | - | `addvar` | `name/value` | 聊天变量数值相加（仅 `runVar` 时执行） |
| `setvar` | - | `setvar` | `name/value` | 设置聊天变量（仅 `runVar` 时执行） |
| `setdefaultvar` | - | `setdefaultvar` | `name/value` | 变量不存在/为空时写入默认值（仅 `runVar` 时执行） |
| `getglobalvar` | - | `getglobalvar` | `name` | 读取全局聊天变量（跨聊天共享） |

### 1.3 比较 / 逻辑

| 注册名 | 别名 | 文档名 | 参数 | 简述 |
|---|---|---|---|---|
| `equal` | - | `equal` | `a/b` | a===b → `1` |
| `notequal` | `not_equal` | `not_equal` | `a/b` | a!==b → `1` |
| `greater` | - | `greater` | `a/b` | a>b → `1` |
| `less` | - | `less` | `a/b` | a<b → `1` |
| `greaterequal` | `greater_equal` | `greater_equal` | `a/b` | a>=b → `1` |
| `lessequal` | `less_equal` | `less_equal` | `a/b` | a<=b → `1` |
| `and` | - | `and` | `a/b` | 逻辑与（两端为 `1`） |
| `or` | - | `or` | `a/b` | 逻辑或（任一为 `1`） |
| `not` | - | `not` | `a` | 逻辑非 |
| `all` | - | `all` | `array/...` | 所有值均为 1 → `1` |
| `any` | - | `any` | `array/...` | 任一值为 1 → `1` |

### 1.4 字符串

| 注册名 | 别名 | 文档名 | 参数 | 简述 |
|---|---|---|---|---|
| `startswith` | - | `startswith` | `string/prefix` | 是否以 prefix 开头 |
| `endswith` | - | `endswith` | `string/suffix` | 是否以 suffix 结尾 |
| `contains` | - | `contains` | `string/substring` | 是否包含子串 |
| `replace` | - | `replace` | `string/target/replacement` | 全局替换（replaceAll） |
| `split` | - | `split` | `string/delimiter` | 按分隔符拆分为 JSON 数组 |
| `join` | - | `join` | `array/delimiter` | 数组按分隔符连接 |
| `spread` | - | `spread` | `array` | 数组以 `::` 连接 |
| `trim` | - | `trim` | `string` | 去首尾空白 |
| `length` | - | `length` | `string` | 字符长度 |
| `lower` | - | `lower` | `string` | 转小写（locale） |
| `upper` | - | `upper` | `string` | 转大写（locale） |
| `capitalize` | - | `capitalize` | `string` | 首字母大写 |
| `reverse` | - | （文档无） | `string` | 反转字符串 |
| `tonumber` | - | `tonumber` | `string` | 抽取数字与小数点 |
| `unicodeencode` | `unicode_encode` | `unicode_encode` | `string/index` | 取字符 Unicode 码 |
| `unicodedecode` | `unicode_decode` | `unicode_decode` | `code` | 码点转字符 |
| `u` | `unicodedecodefromhex` | `u` | `hex` | 十六进制解码为字符 |
| `ue` | `unicodeencodefromhex` | `ue` | `hex` | 十六进制编码为码点 |
| `hash` | - | `hash` | `string` | 字符串哈希 |
| `comment` | - | （文档无） | `text` | 注释宏，**会在聊天中显示**（div.risu-comment） |
| `//` | - | （文档无） | `text` | 注释宏（doc_only），不显示 |

### 1.5 数字

| 注册名 | 别名 | 文档名 | 参数 | 简述 |
|---|---|---|---|---|
| `round` | - | `round` | `number` | 四舍五入 |
| `floor` | - | `floor` | `number` | 向下取整 |
| `ceil` | - | `ceil` | `number` | 向上取整 |
| `abs` | - | `abs` | `number` | 绝对值 |
| `remaind` | - | `remaind` | `a/b` | 取模 |
| `pow` | - | `pow` | `base/exponent` | 幂 |
| `fixnum` | `fixnum`(自名), `fixnumber` | `fixnum` | `number/decimals` | 保留 N 位小数 |
| `randint` | - | `randint` | `min/max` | 区间随机整数 |
| `dice` | - | `dice` | `NdM` | NdM 骰子（返回总数） |
| `fromhex` | - | `fromhex` | `hex` | 十六进制转十进制 |
| `tohex` | - | `tohex` | `number` | 十进制转十六进制 |
| `min` | - | `min` | `array/...` | 最小值 |
| `max` | - | `max` | `array/...` | 最大值 |
| `sum` | - | `sum` | `array/...` | 求和 |
| `average` | - | `average` | `array/...` | 平均值 |

### 1.6 数组 / 字典

| 注册名 | 别名 | 文档名 | 参数 | 简述 |
|---|---|---|---|---|
| `arraylength` | `arraylength`(自名) | `arraylength` | `array` | 数组长度 |
| `arrayelement` | `arrayelement`(自名) | `arrayelement` | `array/index` | 按下标取元素（越界 → `null`） |
| `dictelement` | `dictelement`(自名), `objectelement` | `dictelement` | `dict/key` | 按 key 取值（缺失 → `null`） |
| `objectassert` | `dictassert`, `object_assert` | `object_assert` | `dict/key/value` | key 不存在才写入（返回新对象 JSON） |
| `element` | `ele` | `element` | `json/key1/key2/...` | 逐层嵌套取值 |
| `arrayshift` | `arrayshift`(自名) | `arrayshift` | `array` | 移除首元素 |
| `arraypop` | `arraypop`(自名) | `arraypop` | `array` | 移除末元素 |
| `arraypush` | `arraypush`(自名) | `arraypush` | `array/value` | 追加元素 |
| `arraysplice` | `arraysplice`(自名) | `arraysplice` | `array/start/deleteCount/item` | 拼接/删除 |
| `arrayassert` | `arrayassert`(自名) | `arrayassert` | `array/index/value` | 越界下标才写入（拉长数组） |
| `makearray` | `array`, `a`, `makearray`(自名) | `makearray` | `item1/item2/...` | 参数转数组 |
| `makedict` | `dict`, `d`, `makedict`(自名), `makeobject`, `object`, `o` | `makedict` | `key1=value1/key2=value2/...` | key=value 转对象 |
| `range` | - | `range` | `start/end/step` | 生成数字序列数组 |
| `filter` | - | `filter` | `array/type` | 过滤（`unique`/`nonempty`/`all`，默认 all） |

### 1.7 加密 / 随机

| 注册名 | 别名 | 文档名 | 参数 | 简述 |
|---|---|---|---|---|
| `xor` | `xorencrypt`, `xorencode`, `xore` | （文档无） | `string` | XOR 0xFF 加密 → base64 |
| `xordecrypt` | `xordecode`, `xord` | （文档无） | `string` | base64 XOR 解密 |
| `crypt` | `crypto`, `caesar`, `encrypt`, `decrypt` | （文档无） | `string`/可选 `shift` | 凯撒位移（默认 32768） |
| `random` | - | `random`（两处） | 无参 或 `array`/`arg1/arg2/...` | 无参→0~1 随机数；单参→从数组或逗号/冒号分隔串随机取；多参→随机取一 |
| `pick` | - | `pick` | 同 random | 同 random 但基于消息索引哈希，结果可复现 |
| `roll` | - | `roll` | `number` 或 `NdM` | 掷骰（默认 1d6）；`roll::6`=1~6 |
| `rollp` | `rollpick` | `rollp` | 同 roll | 同 roll 但基于 chat/char ID 哈希，可复现 |
| `hiddenkey` | - | （文档无） | `value` | lore 激活用隐藏 key，不入模型请求，返回空串 |
| `iserror` | - | `iserror` | `string` | 是否以 `error:` 开头（不区分大小写） |

### 1.8 媒体 / 显示 / 样式

| 注册名 | 别名 | 文档名 | 参数 | 简述 |
|---|---|---|---|---|
| `button` | - | `button` | `label/action` | 生成 `<button risu-trigger="action">label</button>` |
| `risu` | - | `risu` | 可选 `size` | Risu 图标（默认 45px） |
| `file` | - | `file` | `name/base64data` | 显示文件名 div；或 base64 解码为 UTF-8 |
| `asset` | - | `asset` | `name` | 按类型显示附加素材 A |
| `emotion` | - | `emotion` | `name` | 显示情感图 |
| `audio` | - | `audio` | `name` | 显示音频 |
| `bg` | - | `bg` | `name` | 100% 宽高背景图 |
| `bgm` | - | `bgm` | `name` | 隐藏式背景音乐 |
| `video` | - | `video` | `name` | 显示视频 |
| `video-img` | - | `video-img` | `name` | 图片样式视频 |
| `image` | - | `image` | `name` | 显示图片（带样式） |
| `img` | - | `img` | `name` | 显示无样式图片 |
| `path` | `raw` | `path` | `name` | 返回素材文件路径字符串 |
| `inlay` | - | `inlay` | `name` | 无样式 inlay 素材（不入模型请求） |
| `inlayed` | - | `inlayed` | `name` | 带样式 inlay 素材（不入模型请求） |
| `inlayeddata` | - | `inlayeddata` | `name` | 带样式+数据的 inlay 素材（入模型请求） |
| `source` | - | （文档无） | `user` 或 `char` | 用户/角色头像 source URL |
| `tex` | `latex`, `katex` | （文档无） | `expr` | LaTeX 渲染（包 `$$...$$`） |
| `ruby` | `furigana` | （文档无） | `text/reading` | 注音（ruby）HTML |
| `codeblock` | - | （文档无） | 可选 `lang`, `code` | 代码块（带语言高亮占位） |
| `bkspc` | - | （文档无） | - | 退格：删除输出末尾一个词 |
| `erase` | - | （文档无） | - | 删除输出末尾一个句子 |
| `declare` | - | （文档无） | `name` | 声明数据以改变解析器行为 |
| `__` | - | （文档无） | `args` | 内部函数调用（`internalOnly`，勿用） |
| `position` | - | （文档无） | `name` | 定义位置，供 `@@position <name>` 装饰器使用 |
| `slot` | - | `slot` | 可选 `name` | 在 `#each` 中取当前元素；无参时依上下文变化 |
| `metadata` | - | `metadata` | `key` | 元数据：mobile/local/node/version/major/lang/browserlang/modelshortname/modelname/modelformat/modelprovider/modeltokenizer/risutype/maxcontext |
| `moduleenabled` | `module_enabled` | `module_enabled` | `namespace` | 模块是否启用 |
| `moduleassetlist` | `module_assetlist` | `module_assetlist` | `namespace` | 模块素材名数组 |
| `date` | `datetimeformat` | `date`（两处） | 可选 `format`/可选 `timestamp` | 无参→`Y-M-D`；有参→Moment.js 子集格式化 |
| `time`（第二处 L1609） | - | `time` | 可选 `format`/`timestamp` | 无参→`h:m:s`；有参→格式化 |

### 1.9 转义字符宏（返回 Unicode 私用区字符，显示为字面符）

| 注册名 | 别名 | 文档名 | 参数 | 简述 |
|---|---|---|---|---|
| `decbo` | `displayescapedcurlybracketopen` | `decbo` | - | 显示 `{`（U+E9B8） |
| `decbc` | `displayescapedcurlybracketclose` | `decbc` | - | 显示 `}`（U+E9B9） |
| `bo` | `ddecbo`, `doubledisplayescapedcurlybracketopen` | `bo` | - | 显示 `{{`（U+E9B8×2） |
| `bc` | `ddecbc`, `doubledisplayescapedcurlybracketclose` | `bc` | - | 显示 `}}`（U+E9B9×2） |
| `displayescapedbracketopen` | `debo`, `(` | （文档无） | - | 显示 `(`（U+E9BA） |
| `displayescapedbracketclose` | `debc`, `)` | （文档无） | - | 显示 `)`（U+E9BB） |
| `displayescapedanglebracketopen` | `deabo`, `<` | （文档无） | - | 显示 `<`（U+E9BC） |
| `displayescapedanglebracketclose` | `deabc`, `>` | （文档无） | - | 显示 `>`（U+E9BD） |
| `displayescapedcolon` | `dec`, `:` | （文档无） | - | 显示 `:`（U+E9BE） |
| `displayescapedsemicolon` | `;` | （文档无） | - | 显示 `;`（U+E9BF） |

### 1.10 特殊运算符宏（`doc_only`）

| 注册名 | 别名 | 文档名 | 参数 | 简述 |
|---|---|---|---|---|
| `?` | - | `?` | 表达式 | 数学运算：`+ - * / % ^ < > <= >= == != !` 与括号，`{{? 1+2*6}}` |
| `#if` | - | （文档无） | 条件 | 条件块（**已废弃**，`1`/`true` 为真；建议改用 `#when`） |
| `#if_pure` | - | （文档无） | 条件 | 保留空白的条件块（**已废弃**，改用 `#when::keep`） |
| `#when` | - | （文档无） | 条件 + 运算符 | 条件块；运算符见下“控制结构” |
| `:else` | - | （文档无） | - | `#when` 的 else 分支 |
| `#pure` | - | （文档无） | - | 原样输出块（**已废弃**，改用 `#puredisplay`） |
| `#puredisplay` | - | （文档无） | - | 不解析任何 CBS 的原样输出块 |
| `#escape` | - | （文档无） | 可选 `::keep` | 转义花括号/括号为字面文本 |
| `#each` | `:each` | （文档无） | `A as V`（可选 `::keep`） | 数组迭代块，配合 `slot` |

---

## 二、控制结构 / 特殊语法（自 parser.svelte.ts + cbs.ts 提取）

> `risuChatParser`（parser.svelte.ts L1538 起）逐字符解析，块结构由 `blockStartMatcher`（L1153~1424）识别开始标签、`blockEndMatcher`（L1432~1505）处理结尾。块标签以 `{{#...}}` 开头、`{{/...}}` 结尾。

### 2.1 条件块
- `{{#if 条件}}...{{/if}}` — 真值（`1`/`true`）为真；`{{#if_pure 条件}}...{{/if_pure}}` 保留空白（`type:'ifpure'`）。两者均已标记废弃。
- `{{#when 条件}}...{{/when}}` 与 `{{#when::A::and::B}}...{{/when}}` — 类型 `newif`/`newif-falsy`，支持运算符（见下）。
- `{{:else}}` — 单行或独立一行（多行时 `{{:else}}` 必须独占一行；`legacy` 模式不支持）。

`#when` 运算符（cbs.ts 描述 + parser L1165~1390 实现）：

| 运算符 | 含义 |
|---|---|
| `and` / `or` | 逻辑与 / 或 |
| `is` / `isnot` | 相等 / 不等 |
| `>` `<` `>=` `<=` | 数值比较 |
| `not` | 取反（对后续条件） |
| `keep` | 保留块内空白（不 trim） |
| `legacy` | 旧的空白处理（等同废弃的 #if） |
| `var` | 判定变量 A 是否为真 |
| `vis` / `visnot` | 变量 A 与字面量 B 相等/不等 |
| `toggle` / `tis` / `tisnot` | toggle 状态判定 |
| 可组合 | `{{#when::keep::not::条件}}`、`{{#when::keep::A::and::B}}`；无条件时可用空格 `{{#when 条件}}` |

### 2.2 迭代块
- `{{#each A as V}}...{{/each}}`（别名 `:each`）— 类型 `each`；`::keep` 保留空白；块内 `{{slot::V}}` 取当前元素（parser L1723 将 `{{slot::<名>}}` 替换为数组元素，对象则 JSON.stringify）。
- **不存在** `{{loop}}` / `{{continue}}` / `{{break}}` 宏（源码无此三者注册；lang 文件的 `v2Loop`/`v2BreakLoop` 是 UI 文案，非 CBS）。

### 2.3 输出控制块
- `{{#puredisplay}}...{{/puredisplay}}` — 类型 `pure-display`，内容完全不做 CBS 处理（可内嵌 HTML）。
- `{{#pure}}...{{/pure}}` — 同 `pure-display`（废弃别名）。
- `{{#escape}}...{{/escape}}` — 类型 `escape`，把花括号/括号当字面量；`::keep` 保留空白。
- `{{#code}}...{{/code}}` — 类型 `normalize`，去换行/制表、解码 `\uXXXX`。
- `{{#func ...}}...{{/func}}` — 类型 `function`，用户自定义函数块。
- 结束标签 `{{/if}}` `{{/if_pure}}` `{{/when}}` `{{/each}}` `{{/pure}}` `{{/pure_display}}` `{{/escape}}` `{{/func}}` `{{/code}}` 由解析器匹配。

### 2.4 其他特殊语法
- **`@@` 装饰器**（lorebook / 位置）：`@@position <name>`（`position` 宏描述）；完整列表见 highlight.ts `decorators`（L169~172）：`activate_only_after, activate_only_every, keep_activate_after_match, dont_activate_after_match, depth, reverse_depth, instruct_depth, reverse_instruct_depth, instruct_scan_depth, role, scan_depth, is_greeting, position, ignore_on_max_context, additional_keys, exclude_keys, is_user_icon, activate, dont_activate, disable_ui_prompt, probability, exclude_keys_all, match_full_word, match_partial_word`。废弃装饰器：`end, assistant, user, system`。
- **`{{data}}`**：**不是宏**。仅用于 regex 脚本（customscript）的 `out` 字段，作为正则整段匹配的替换令牌（scripts.ts L16：`const dreg = /{{data}}/g` → `$&`）。
- **`$n`**：regex `out` 字段中替换为换行（scripts.ts L161）。
- 解析器对无注册函数/空块有兜底：未注册宏保留原文。

---

## 三、botPreset 顶层字段表

> 来源：`interface botPreset`（database.svelte.ts L1580~1682）+ `presetTemplate` 默认值（L1985~2019）+ `saveCurrentPreset` 映射（L2036~2120）。单位说明：temperature/frequencyPenalty/PresensePenalty 在请求层 `/ 100`（request.ts L458/672/895、openAI/requests.ts L940~941），即**存储值为 ×100**。`PresensePenalty` 为源码拼写（Presence 误写）。

| 字段 | 类型 | 默认值（presetTemplate） | 说明 |
|---|---|---|---|
| `name` | string | `"New Preset"` | 预设名 |
| `apiType` | string | `"gemini-3-flash-preview"` | API 类型 |
| `openAIKey` | string | `""` | 密钥 |
| `localNetworkMode` | boolean | `false` | 本地网络模式 |
| `localNetworkTimeoutSec` | number | `600` | 本地网络超时（秒） |
| `mainPrompt` | string | `defaultMainPrompt` | 主提示词 |
| `jailbreak` | string | `defaultJailbreak` | 越狱提示词 |
| `globalNote` | string | `""` | 全局备注 |
| `temperature` | number | `80` | 温度，**×100**（0.8） |
| `maxContext` | number | `4000` | 最大上下文 |
| `maxResponse` | number | `300` | 最大回复 token |
| `frequencyPenalty` | number | `70` | 频率惩罚，**×100**（0.7） |
| `PresensePenalty` | number | `70` | 存在惩罚，**×100**（0.7） |
| `formatingOrder` | `FormatingOrderItem[]` | `['main','description','personaPrompt','chats','lastChat','jailbreak','lorebook','globalNote','authorNote']` | 顺序；枚举见下 |
| `aiModel` | string | `"gemini-3-flash-preview"` | 主模型 |
| `subModel` | string | `"gemini-3-flash-preview"` | 子模型 |
| `currentPluginProvider` | string | `""` | 当前插件提供方 |
| `textgenWebUIStreamURL` | string | `''` | textgen 流式 URL |
| `textgenWebUIBlockingURL` | string | `''` | textgen 阻塞 URL |
| `forceReplaceUrl` | string | `''` | 强制替换 URL |
| `forceReplaceUrl2` | string | `''` | 强制替换 URL 2 |
| `promptPreprocess` | boolean | `false` | 提示词预处理 |
| `bias` | `[string, number][]` | `[]` | 日志偏置（token → 偏置值） |
| `ooba` | `OobaSettings` | `defaultOoba` | Ooba 设置 |
| `ainconfig` | `AINsettings` | `defaultAIN` | AI Novel 设置 |
| `proxyRequestModel` | string | - | 代理请求模型 |
| `openrouterRequestModel` | string | - | OpenRouter 请求模型 |
| `proxyKey` | string | `''` | 代理密钥 |
| `koboldURL` | string | - | Kobold URL |
| `NAISettings` | `NAISettings` | - | NAI 设置 |
| `autoSuggestPrompt` | string | - | 自动建议提示词 |
| `autoSuggestPrefix` | string | - | 自动建议前缀 |
| `autoSuggestClean` | boolean | - | 自动建议清理 |
| `promptTemplate` | `PromptItem[]` | - | 提示词卡模板（见下） |
| `NAIadventure` | boolean | - | NAI 冒险模式 |
| `NAIappendName` | boolean | - | NAI 附加名字 |
| `localStopStrings` | string[] | - | 本地停用词 |
| `customProxyRequestModel` | string | - | 自定义代理模型 |
| `reverseProxyOobaArgs` | `OobaChatCompletionRequestParams` | `{ mode: 'instruct' }` | 反向代理 Ooba 参数 |
| `top_p` | number | `1` | 核采样 |
| `top_k` | number | 数据库默认 `0` | 保留 top-k |
| `top_a` | number | - | top-a |
| `min_p` | number | - | min-p |
| `repetition_penalty` | number | - | 重复惩罚 |
| `promptSettings` | `PromptSettings` | 见下 | 提示词设置对象 |
| `openrouterProvider` | `{ order: string[]; only: string[]; ignore: string[] }` | - | 供应商过滤 |
| `useInstructPrompt` | boolean | `false` | 使用 instruct 提示 |
| `customPromptTemplateToggle` | string | `""` | 自定义模板开关 |
| `templateDefaultVariables` | string | `""` | 模板默认变量 |
| `moduleIntergration` | string | `""` | 模块集成 |
| `instructChatTemplate` | string | - | instruct 聊天模板 |
| `JinjaTemplate` | string | `''` | Jinja 模板 |
| `jsonSchemaEnabled` | boolean | - | 启用 JSON Schema |
| `jsonSchema` | string | `''` | JSON Schema 文本 |
| `strictJsonSchema` | boolean | `true` | 严格 JSON Schema |
| `extractJson` | string | `''` | 提取 JSON |
| `groupTemplate` | string | `''` | 群聊模板 |
| `groupOtherBotRole` | string | `'user'` | 群聊其他角色扮演身份 |
| `seperateParametersEnabled` | boolean | - | 启用独立参数 |
| `seperateParameters` | `{ memory/emotion/translate/otherAx: SeparateParameters; overrides: Record<string, SeparateParameters> }` | - | 独立参数对象 |
| `customAPIFormat` | `LLMFormat` | - | 自定义 API 格式 |
| `systemContentReplacement` | string | - | system content 替换 |
| `systemRoleReplacement` | `'user' \| 'assistant'` | - | system role 替换 |
| `enableCustomFlags` | boolean | - | 启用自定义 flags |
| `customFlags` | `LLMFlags[]` | - | 自定义 flags |
| `image` | string | `''` | 预设图标 |
| `regex` | `customscript[]` | - | **预设级正则脚本**（保存时取 `db.presetRegex`） |
| `reasonEffort` | number | `0` | 推理强度（reasoning effort） |
| `thinkingTokens` | number | `null` | thinking token 预算 |
| `thinkingType` | `'off' \| 'budget' \| 'adaptive'` | `'budget'` | thinking 类型 |
| `deepseekThinkingType` | `'off' \| 'enabled'` | `'off'` | DeepSeek thinking |
| `adaptiveThinkingEffort` | `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` | `'high'` | 自适应推理强度 |
| `deepseekReasoningEffort` | `'high' \| 'max'` | `'high'` | DeepSeek 推理强度 |
| `outputImageModal` | boolean | `false` | 图像输出模式 |
| `seperateModelsForAxModels` | boolean | - | 子模型独立模型 |
| `seperateModels` | `{ memory/emotion/translate/otherAx: string }` | - | 子模型映射 |
| `modelTools` | string[] | - | 模型工具 |
| `fallbackModels` | `{ memory/emotion/translate/otherAx/model: string[] }` | - | 回退模型 |
| `fallbackWhenBlankResponse` | boolean | `false` | 空响应回退 |
| `verbosity` | number | `1` | 冗长程度 |
| `dynamicOutput` | `DynamicOutput` | `null` | 动态输出 |

`FormatingOrderItem` 枚举（database.svelte.ts L1743）：
`'main' | 'jailbreak' | 'chats' | 'lorebook' | 'globalNote' | 'authorNote' | 'lastChat' | 'description' | 'postEverything' | 'personaPrompt'`

`PromptSettings`（process/prompt.ts L13~21）默认值（database.svelte.ts L441~452）：
`assistantPrefill: ''`、`postEndInnerFormat: ''`、`sendChatAsSystem: false`、`sendName: false`、`utilOverride: false`、`customChainOfThought: false`、`maxThoughtTagDepth: -1`

---

## 四、promptTemplate 卡字段与枚举

> 来源：`export type PromptItem = PromptItemPlain | PromptItemTyped | PromptItemChat | PromptItemAuthorNote | PromptItemChatML | PromptItemCache`（process/prompt.ts L7~62）。
> `PromptRole = 'user' | 'bot' | 'system'`（L19）。

### 4.1 六种卡类型

| 卡类型 | 判别字段 `type` | 字段 | 类型 | 说明 |
|---|---|---|---|---|
| `PromptItemPlain` | `'plain' \| 'jailbreak' \| 'cot'` | `type2` | `'normal' \| 'globalNote' \| 'main'` | 子类型 |
| | | `text` | string | 正文 |
| | | `role` | `PromptRole` | 角色 |
| | | `name?` | string | 可选名 |
| `PromptItemChatML` | `'chatML'` | `text` | string | 正文 |
| | | `name?` | string | 可选名 |
| `PromptItemTyped` | `'persona' \| 'description' \| 'lorebook' \| 'postEverything' \| 'memory'` | `innerFormat?` | string | 内部格式 |
| | | `role2?` | `PromptRole` | 角色覆盖 |
| | | `name?` | string | 可选名 |
| `PromptItemAuthorNote` | `'authornote'` | `innerFormat?` | string | 内部格式 |
| | | `defaultText?` | string | 默认文本（`{{authornote}}` 回退用） |
| | | `role2?` | `PromptRole` | 角色覆盖 |
| | | `name?` | string | 可选名 |
| `PromptItemChat` | `'chat'` | `rangeStart` | number | 范围起点 |
| | | `rangeEnd` | `number \| 'end'` | 范围终点（`'end'` 表示到结尾） |
| | | `chatAsOriginalOnSystem?` | boolean | 作为 system 原样聊天 |
| | | `name?` | string | 可选名 |
| `PromptItemCache` | `'cache'` | `name` | string | 缓存名 |
| | | `depth` | number | 深度 |
| | | `role` | `'user' \| 'assistant' \| 'system' \| 'all'` | 角色作用域 |

### 4.2 全部 `type` 枚举并集
`'plain' | 'jailbreak' | 'cot' | 'chatML' | 'persona' | 'description' | 'lorebook' | 'postEverything' | 'memory' | 'authornote' | 'chat' | 'cache'`

> 注：`main/globalNote` 不是 `type`，而是 **plain/jailbreak/cot 卡的 `type2` 子字段**取值；`role2` 仅在 typed/authornote 卡上存在，`role` 仅在 plain/cache 卡上存在。

---

## 五、regex（customscript）字段与 flag

> 来源：`interface customscript`（database.svelte.ts L1307~1313）；执行见 `process/scripts.ts`。

### 5.1 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `comment` | string | 是 | 注释说明 |
| `in` | string | 是 | 正则表达式（不含首尾 `/` 与 flag） |
| `out` | string | 是 | 替换文本；支持 `$n`（换行）、`{{data}}`（整段匹配）、`$&`、`$1..`、`$(name)`、`$<group>` 等 JS 替换模式；可带 `@@` 指令前缀 |
| `type` | `ScriptMode` | 是 | `'editinput' \| 'editoutput' \| 'editprocess' \| 'editdisplay'`（scripts.ts L18） |
| `flag` | string | 否 | 正则 flag + 尖括号元 flag 组合（见下） |
| `ableFlag` | boolean | 否 | 是否启用 flag 解析；为 false 时默认仅 `g` |

### 5.2 flag 合法取值

**原生正则 flag（scripts.ts L170：`flag.replace(/[^dgimsuvy]/g, '')`，去重后，空则兜底 `u`）：**
`d`（hasIndices）、`g`（global）、`i`（ignoreCase）、`m`（multiline）、`s`（dotAll）、`u`（unicode）、`v`（unicodeSets）、`y`（sticky）

**尖括号元 flag（scripts.ts L296~333 解析，`<>` 内以逗号分隔；`order n` 单独识别为排序，其余压入 `actions`）：**

| 元 flag | 实现判定 | 作用 |
|---|---|---|
| `<order n>` | `m.startsWith('order ')` → `parseInt(m.substring(6))` | 结果顺序，数值越高越靠前；默认 0；存在时按 order 降序执行 |
| `<cbs>` | `actions.includes('cbs')` / flag 含 `<cbs>` | `in` 中的 CBS 先经 `risuChatParser` 解析 |
| `<inject>` | `out` 以 `@@inject` 开头 或 `actions.includes('inject')` | 将结果注入当前字符串 |
| `<move_top>` | `out` 以 `@@move_top` 开头 或 `actions.includes('move_top')` | 结果移到字符串顶部 |
| `<move_bottom>` | `out` 以 `@@move_bottom` 开头 或 `actions.includes('move_bottom')` | 结果移到字符串底部 |
| `<repeat_back>` | `out` 以 `@@repeat_back` 开头 或 `actions.includes('repeat_back')` | 当前无匹配时用上一条同角色消息的匹配结果；`@@repeat_back <start\|end\|start_nl\|end_nl>` 控制放置方式 |
| `<no_end_nl>` | `actions.includes('no_end_nl')` | 不自动追加结尾换行（默认 `out` 以 `>` 结尾时补 `\n`） |
| `<emo ...>` | `out` 以 `@@emo ` 开头 | 切换角色情感（`@@emo <情感名>`） |

**`out` 字段的 `@@` 指令前缀**（与元 flag 等价，可混用）：`@@move_top`、`@@move_bottom`、`@@inject`、`@@repeat_back [start|end|start_nl|end_nl]`、`@@emo <name>`。

**`out` 替换模式（zh-Hant.ts L67 文档 + scripts.ts 实现）：**
`$$`（字面 `$`）、`$&`（整段匹配）、`` $` ``（匹配前内容）、`$1..n`（捕获组）、`$(name)`（命名组）、`$<name>`（命名组 JS 语法）、`$n`（换行）、`{{data}}`（整段匹配）。

> 语法说明：`type` 四个取值对应 UI 的 修改输入(editinput) / 修改输出(editoutput) / 修改发送数据(editprocess) / 修改显示(editdisplay)。flag 可组合，如 `gi<cbs><move_top>`。

---

## 六、不一致清单（cbs_docs.cbs ↔ cbs.ts）

### 6.1 文档有、实现没有的别名（cbs.ts 未注册，实际 `{{...}}` 无效）

| 宏（文档名） | 文档列出的别名 | cbs.ts 实际注册（name + alias） |
|---|---|---|
| `previous_char_chat` | `previous_char_chat` | 仅 `previouscharchat`, `lastcharmessage` |
| `previous_user_chat` | `previous_user_chat` | 仅 `previoususerchat`, `lastusermessage` |
| `personality` | `char_persona` | 仅 `personality`, `charpersona` |
| `description` | `char_desc` | 仅 `description`, `chardesc` |
| `persona` | `user_persona` | 仅 `persona`, `userpersona` |
| `main_prompt` | `system_prompt` | 仅 `mainprompt`, `systemprompt`, `main_prompt` |
| `lorebook` | `world_info` | 仅 `lorebook`, `worldinfo` |
| `isfirstmsg` | `is_first_msg`, `is_first_message` | 仅 `isfirstmsg`, `isfirstmessage` |
| `arraylength` | `array_length` | 仅 `arraylength` |
| `arrayelement` | `array_element` | 仅 `arrayelement` |
| `dictelement` | `dict_element`, `object_element` | 仅 `dictelement`, `objectelement` |
| `object_assert` | `dict_assert` | 仅 `objectassert`, `dictassert`, `object_assert` |
| `makearray` | `make_array` | 仅 `makearray`, `array`, `a` |
| `makedict` | `make_dict`, `make_object` | 仅 `makedict`, `dict`, `d`, `makeobject`, `object`, `o` |
| `fixnum` | `fix_num`, `fix_number` | 仅 `fixnum`, `fixnumber` |
| `arrayshift` | `array_shift` | 仅 `arrayshift` |
| `arraypop` | `array_pop` | 仅 `arraypop` |
| `arraypush` | `array_push` | 仅 `arraypush` |
| `arraysplice` | `array_splice` | 仅 `arraysplice` |
| `arrayassert` | `array_assert` | 仅 `arrayassert` |
| `date`（格式化版） | `date_time_format` | 仅 `date`, `time`, `datetimeformat` |
| `previous_chat_log` | `previous_chat_log`（无别名） | 实现为 `previouschatlog` + 别名 `previous_chat_log` → **`previous_chat_log` 文档名可用（作别名）** |

> 注：上表“文档有、实现没有”多数是**下划线形态的别名文档写全了、实现里没注册**。文档的“首列名”本身部分是可用的（因为实现把下划线形态挂到了 alias），但 `previous_char_chat`、`previous_user_chat`、`array_length`、`array_element`、`dict_element`、`object_element`、`dict_assert`、`make_array`、`make_dict`、`make_object`、`fix_num`、`fix_number`、`array_shift`、`array_pop`、`array_push`、`array_splice`、`array_assert`、`date_time_format`、`system_prompt`、`char_persona`、`char_desc`、`user_persona`、`world_info`、`is_first_msg`、`is_first_message` 等**在实现中完全不存在**。

### 6.2 实现有、文档没有的宏（cbs.ts 独有，约 40 个）

`trigger_id`/`triggerid`、`jb`/`jailbreak`、`jbtoggled`、`authornote`/`author_note`、`hiddenkey`、`reverse`、`comment`、`tex`/`latex`/`katex`、`ruby`/`furigana`、`codeblock`、`bkspc`、`erase`、`declare`、`//`、`__`（internal）、`xor`/`xorencrypt`/`xorencode`/`xore`、`xordecrypt`/`xordecode`/`xord`、`crypt`/`crypto`/`caesar`/`encrypt`/`decrypt`、`source`、`chardisplayasset`、`displayescapedbracketopen`/`debo`/`(`、`displayescapedbracketclose`/`debc`/`)`、`displayescapedanglebracketopen`/`deabo`/`<`、`displayescapedanglebracketclose`/`deabc`/`>`、`displayescapedcolon`/`dec`/`:`、`displayescapedsemicolon`/`;`、`#if`、`#if_pure`、`#when`、`:else`、`#pure`、`#puredisplay`、`#escape`、`#each`/`:each`、`slot`、`position`

### 6.3 其他差异
- 文档重复条目：`random`（L42/L165）、`date`（L32/L110）、`slot`（L169/L170）各出现 2 次；`time` 仅在 L31。
- cbs.ts 中 `time` **注册了 2 次**（L517 无参版、L1609 格式化版），`date` 注册 1 次（L1587，含格式化）。
- `previouscharchat`/`previoususerchat` 的实现 name 与 alias 含**同名自引用**（`alias: ['previouscharchat', ...]`），无实际影响。
- cbs.ts 内 `arraylength`、`arrayelement`、`dictelement`、`objectassert`、`arrayshift`、`arraypop`、`arraypush`、`arraysplice`、`arrayassert`、`makearray`、`makedict`、`fixnum`、`isfirstmsg`、`globalnote` 等别名数组同样存在**自名重复**。
- `#if` 用双引号 `name:"#if"` 注册（其余均为单引号）。
- `#if`、`#if_pure`、`#pure` 已标记 `deprecated`（建议分别改用 `#when`、`#when::keep`、`#puredisplay`）。
- `__` 标记 `internalOnly`（cbsMonaco `getMacroData()` 会跳过它，其余宏均进入 Monaco 高亮）。
- 文档 `path` 的别名列写的是 `path/raw`，实现 alias 为 `['raw']`（`path` 为 name，一致可用）。

---

*清单生成日期：2026-08-09。宏总数以 cbs.ts 为准：**176 次注册 / 175 个唯一宏名**；cbs_docs.cbs 共 142 条数据行 / 139 个唯一文档名。*
