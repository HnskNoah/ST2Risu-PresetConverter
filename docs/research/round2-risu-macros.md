# RisuAI 宏(CBS)系统调研报告 — Round 2

日期:2026-08-09
来源:子代理源码调研(`rius/risuai-src`)
范围:语法分类、解析引擎、内置宏清单、自定义宏/变量作用域、与正则/prompt 联动、高级能力、求值顺序与转义

---

## 0. 架构总览

RisuAI 的宏系统称为 **CBS(Curly Bracket Syntax)**,由三个核心文件组成:

| 文件 | 职责 |
|---|---|
| `src/ts/parser/parser.svelte.ts` | 解析引擎。核心入口 `risuChatParser()`(L1538)、`matcher()`(L1035)、块匹配器、转义工具 |
| `src/ts/cbs.ts` | 宏注册中心。`registerCBS()`(L117)通过 `registerFunction()` 注册全部内置宏(~171 个),每个宏带 `name`/`alias`/`description` |
| `src/ts/parser/chatVar.svelte.ts` | 自定义变量存储(`getChatVar`/`setChatVar`/`getGlobalChatVar`) |

依赖关系:`parser.svelte.ts` 的 `initMatcher()`(L956)调用 `registerCBS()`(parser.svelte.ts:997),把 cbs.ts 里的宏回调填入内部 `matcherMap`。

---

## 1. 宏语法分类

从解析器状态机(parser.svelte.ts:1613-1640 的 `case '{'`、`case '#'`、`case '}'`)可归纳出 4 大语法形式:

### ① 变量/函数宏 `{{name}}`、`{{name::arg1::arg2}}`
- 名称以 `:` 或 `::` 分隔参数。`matcher()`(parser.svelte.ts:1035)先按 `::` 切分,若参数含单 `:` 再按 `:` 切分。
- 名称会 `.toLocaleLowerCase()` 并去除空格/下划线/连字符(`/[\s_-]/g`)(parser.svelte.ts:1044)。
- 未知宏原样透传 `{{name}}`(parser.svelte.ts:1721)。

### ② 计算表达式 `{{? 1+2*3}}`
`matcher()` 开头特判 `p1.startsWith('? ')`,调用 `calcString()` 求值(parser.svelte.ts:1038-1041)。

### ③ 块级宏 `{{#xxx}}...{{/xxx}}`
由 `blockStartMatcher()`(parser.svelte.ts:1152)与 `blockEndMatcher()`(parser.svelte.ts:1411)配合实现,支持嵌套:

| 块宏 | 说明 | 代码位置 |
|---|---|---|
| `{{#if 1}}...{{/}}` | 旧条件(1/true 为真),**已废弃** | parser.svelte.ts:1153;cbs.ts:2381 |
| `{{#if_pure 1}}...{{/}}` | 旧条件变体,**已废弃** | cbs.ts:2397 |
| `{{#when ::op::...}}...{{:else}}...{{/}}` | 新条件,支持操作符链 | parser.svelte.ts:1160 |
| `{{#each arr as v}}...{{slot::v}}...{{/}}` | 数组遍历循环 | parser.svelte.ts:1194 |
| `{{#func name args}}...{{/}}` + `{{call::name::arg}}` | 自定义函数定义/调用 | parser.svelte.ts:1200, 1689 |
| `{{#pure}}...{{/}}` | 不解析原样输出(已废弃→`#puredisplay`) | parser.svelte.ts:1204 |
| `{{#puredisplay}}...{{/}}` | 显示宏,输出会二次转义 | parser.svelte.ts:1205 |
| `{{#code}}...{{/}}` | normalize 块(处理转义序列 `\n` 等) | parser.svelte.ts:1207 |
| `{{#escape}}...{{/}}`、`{{#escape::keep}}` | 转义块(把 `{}()` 换成私有 Unicode) | parser.svelte.ts:1209 |
| `{{:else}}` | `#when` 的 else 分支 | parser.svelte.ts:1455 |

### ④ 传统单括号逻辑 `{#if 1#}...{#if#}`(legacy,已废弃)
主循环 `case '#'` 处理(parser.svelte.ts:1645),由 `legacyBlockMatcher()`(parser.svelte.ts:1097)仅支持 `if`,内容需换行。

### ⑤ 注释 `{{// 注释}}`
注册为 `doc_only`(cbs.ts:2259)。

### ⑥ 预处理 `<(user|char|bot)>`
解析开头执行 `da.replace(/\<(user|char|bot)\>/gi, '{{$1}}')`(parser.svelte.ts:1612),把尖括号角色标签转成宏。

---

## 2. 解析与执行引擎

### 核心函数 `risuChatParser`(parser.svelte.ts:1538)
签名:`risuChatParser(da, {chatID, db, chara, rmVar, var, tokenizeAccurate, consistantChar, visualize, role, runVar, functions, callStack, cbsConditions})`。

**状态机实现**(parser.svelte.ts:1613-1730):
- 逐字符扫描 `while(pointer < da.length)` + `switch(da[pointer])`。
- 用 `nested[]` 数组当栈:遇 `{{` 或 `{#` 时 `nested.unshift('')`(入栈,`stackType` 记 1);遇 `}}` 时 `nested.shift()`(出栈)再交给 `matcher()` 或块匹配器求值。
- **同样支持 `<...>`** 作为第二类嵌套(stackType 记 2),用于 HTML 属性中的宏。
- **嵌套**:块内容在 `{{/}}` 出栈时用 `blockEndMatcher()` 处理(parser.svelte.ts:1697-1745)。`#each` 会通过改写 `da` 字符串实现迭代,然后继续解析(parser.svelte.ts:1710-1723)。
- **递归**:很多宏回调内部再调用 `risuChatParser`(如 `{{personality}}` 会重解析角色性格文本,cbs.ts:246);`{{call::}}` 也会递归调用解析器(parser.svelte.ts:1690-1700)。
- **防爆栈**:`arg.callStack > 20` 直接返回 `'ERROR: Call stack limit reached'`(parser.svelte.ts:1605-1606)。

### 宏查表 `matcher()`(parser.svelte.ts:1035)
按 `::` 拆分 → 取小写名称 → `matcherMap.get(name)` → 调用回调 `callback(p1, matcherArg, args, vars)`。回调返回三种类型:`string` / `{text, var}`(可附带临时变量) / `null`(透传)。

---

## 3. 内置宏列表(从 cbs.ts 全部 `registerFunction` 提取,171 个注册点)

按功能分类(仅列主名;别名见源码):

**角色/身份**: `char`(L147, alias `bot`)、`user`(L173)、`role`(L671)、`trigger_id`(L185)

**提示词段落**: `personality`(238)、`description`(253)、`scenario`(268)、`exampledialogue`(283)、`persona`(299)、`mainprompt`(308)、`jb`(373)、`globalnote`(383)、`authornote`(393)

**历史/消息**: `previouscharchat`(195)、`previoususerchat`(214)、`userhistory`(337)、`charhistory`(355)、`history`(1513)、`lastmessage`(723)、`lastmessageid`(738)、`previouschatlog`(1148)、`messagetime`(446)、`messagedate`(470)、`messageunixtimearray`(493)、`messageidleduration`(548)、`idleduration`(605)

**时间/日期**: `time`(517)、`isotime`(527)、`isodate`(537)、`date`(1565)、`unixtime`(507)。格式函数 `dateTimeFormat`(parser.svelte.ts:1060)支持 `YYYY/MM/DD/HH/mm/ss/MMMM/dddd` 等占位符。

**模型/元数据**: `model`(651)、`axmodel`(661)、`maxcontext`(713)、`metadata`(1865,支持 `version/modelname/modelprovider` 等 key)、`moduleenabled`(1609)、`moduleassetlist`(1624)、`prefillsupported`(1358)、`isfirstmsg`(691)、`jbtoggled`(703)、`chatindex`(416)、`firstmsgindex`(425)、`screenwidth/height`(1368/1377)

**变量控制**: `tempvar`/`gettempvar`(754)、`settempvar`(766)、`getvar`(793)、`calc`(802)、`addvar`(811)、`setvar`(827)、`setdefaultvar`(843)、`getglobalvar`(862)、`return`(779)、`declare`(2249)、内部 `__`(2273)

**随机**: `random`(2026)、`pick`(2035,**哈希确定性随机**)、`roll`(2049)、`rollp`(2078,**确定性掷骰**)、`randint`(1814)、`dice`(1828)、`hash`(1805)

**数学**: `min/max/sum/average`(1695-1755)、`round/floor/ceil/abs/remaind`(1103-1143)、`pow`(1171)、`tonumber`(1160)、`fixnum`(1760)、`range`(1546)

**字符串**: `startswith/endswith/contains`(985-1012)、`replace/split/join/spread/trim/length`(1021-1066)、`lower/upper/capitalize`(1076-1098)、`reverse`(2122)、`unicodeencode/unicodedecode`(1769-1786)、`u/ue`(1787-1804)、`fromhex/tohex`(1847-1865)

**比较/逻辑**: `equal/notequal/greater/less/greaterequal/lessequal`(891-940)、`and/or/not`(945-972)、`xor`(1949)

**数组/对象**: `makearray`(1296)、`makedict`(1305)、`arraylength`(1067)、`arrayelement`(1180)、`dictelement`(1190)、`objectassert`(1200)、`element`(1213)、`arrayshift/arraypop/arraypush/arraysplice/arrayassert`(1238-1291)、`filter`(1641)、`all/any`(1669-1695)

**显示/HTML**: `br`(642)、`cbr`(1386)、`bo/bc`(1417/1426)、`decbo/decbc`(1399/1408)、`ddecbo/ddecbc`、`displayescaped*` 系列(1435-1488)、`risu`(880)、`button`(871)、`comment`(2131)、`tex`(2143)、`ruby`(2152)、`codeblock`(2161)、`bkspc`(2181)、`erase`(2213)

**资产(仅文档,实际由 UI 层实现)**: `asset/emotion/audio/bg/bgm/video/video-img/image/img/path/inlay/inlayed/inlayeddata/source`(2284-2377,均为 `doc_only`)

**加密**: `xor`(1962)、`xordecrypt`(1975)、`crypt`(1985,凯撒)

**特殊**: `blank`(437,alias `none`)、`hiddenkey`(2113)、`//`(2259)、`?`(2266)、`slot`(2492)、`position`(2499)、`#escape/#each/#if/#when/:else/#pure/#puredisplay`(2468-2501,均为 `doc_only` 文档注册,逻辑在 parser 内)

> ⚠️ **关于 `{{data}}`**:cbs.ts 中**没有**名为 `data` 的宏。RisuAI 中 `data` 不直接作为宏使用;模型请求的整段 prompt 通过触发器脚本的 `arg.displayData` 暴露(triggers.ts:1066,2353)。Playground 里出现的是 `{{slot::data}}`(PlaygroundSubtitle.svelte:302)。若需模型输出上下文,应用 `{{lastmessage}}` 或触发器 displayData 机制。

---

## 4. 自定义宏 / 变量作用域

### 持久化聊天变量(最常用)
- `{{setvar::name::value}}`(cbs.ts:827)、`{{setdefaultvar::name::value}}`(cbs.ts:843)、`{{addvar::name::n}}`(cbs.ts:811)
- `{{getvar::name}}`(cbs.ts:793)
- 存储位置:`chat.scriptstate['$'+key]`(chatVar.svelte.ts:29-33),存于数据库 `scriptstate?:{...}`(database.svelte.ts:1458)
- **仅在 `runVar: true` 时真正写入**,否则返回空(避免预览时污染状态)(cbs.ts:833)。

### 作用域层级(chatVar.svelte.ts 全文件)
| 作用域 | 存储 | 读取优先级 | 代码 |
|---|---|---|---|
| 聊天级(可写) | `chat.scriptstate` | 最高 | chatVar.svelte.ts:8-16 |
| 角色默认 | `char.defaultVariables`(字符串 `k=v` 格式) | 次高 | chatVar.svelte.ts:17-22,database.svelte.ts:1483 |
| 模板/全局默认 | `db.templateDefaultVariables` | 最低 | chatVar.svelte.ts:17,database.svelte.ts:531,1632 |
| 全局变量(跨角色/聊天) | `db.globalChatVariables` | 独立 | chatVar.svelte.ts:38-40,database.svelte.ts:1059 |

### 临时变量(单次解析)
- `{{settempvar::k::v}}`(cbs.ts:766)、`{{tempvar::k}}`(cbs.ts:754),存于 `vars` 对象随解析栈传递。

### 函数定义
- `{{#func 名字 arg1 arg2}}...{{/}}` 定义(parser.svelte.ts:1200-1202,1685-1691),`{{call::名字::参数}}` 调用(parser.svelte.ts:1689-1700),函数体内 `{{arg::0}}` 引用参数。`functions` Map 通过参数在递归间传递。

### 行为声明
- `{{declare::declaration_name}}` 设置 `__declared_X__` 标志(cbs.ts:2249),供解析器改行为。

### 触发器/脚本中的变量
- `triggers.ts` 提供完整 `getVar/setVar` API 与 `setVar` 副作用宏(triggers.ts:1570 等大量调用),支持数组/字典/数学表达式等 60+ 种 effect 类型。

---

## 5. 宏与正则脚本的关系

正则脚本处理在 `process/scripts.ts` 的 `processScriptFull()`(L115):

1. **数据先过宏**:`data = risuChatParser(data, {chatID, cbsConditions})`(L133)。
2. **IN 支持宏**:仅当 flag 含 `<cbs>` 时,IN 才做宏展开(L77、L178: `input = risuChatParser(input, ...)`)。这是**用户可选**的,普通脚本 IN 是字面正则。
3. **OUT 替换后再跑宏**:替换结果再次 `risuChatParser(data.replace(reg, outScript))`(L248、L291),所以 OUT 里的 `{{...}}` 会在替换后展开。
4. **脚本缓存键**也把 `<cbs>` 的 IN 展开后计入哈希(L77),避免缓存错位。
5. 执行顺序支持 `@@move_top`/`@@inject`/`@@repeat_back` 等指令宏(L249-340)与 `<order>` 排序(L296-330)。
6. `{{hiddenkey}}` 专门用于触发脚本但不出现在请求中(cbs.ts:2113)。

注意:脚本的 `{{slot::data}}`、`{{position}}` 等是 prompt 模板装饰器,不在脚本引擎内展开。

---

## 6. 宏与提示词组装的关系

所有发往模型的文本段都在 `process/index.svelte.ts` 的 prompt 构建处做宏展开,典型调用:

- 主提示词:index.svelte.ts:433(`mainp + additionalPrompt`)
- Jailbreak:index.svelte.ts:436
- 全局注释(Global Note,支持 `{{original}}` 占位):index.svelte.ts:439
- 作者注:index.svelte.ts:449、455
- 描述/性格/场景拼接:index.svelte.ts:467-480
- 世界书条目:`risuChatParser(resolvePosition(lorebook.prompt))`(index.svelte.ts:537,548,588,609 等)
- 人格(persona):index.svelte.ts:563
- 示例消息:index.svelte.ts:693-716(`{{slot}}` 占位)
- 每条聊天历史:`runCurrentChatFunction` 用 `runVar: true` 重跑宏(index.svelte.ts:146)
- 发送前消息重解析:`processScriptFull(msg.data, ...)`(index.svelte.ts:902)

**发送前最后一次处理**:`request.ts` L218 `m.content = risuUnescape(m.content)`(还原转义字符);若开启 escape 模式,L282 收到模型输出后 `da.result = risuEscape(da.result)`。世界书激活判定也先算宏:lorebook.svelte.ts:576。

---

## 7. 高级宏示例(来自官方测试与 description 文档)

### JSON 对象
```
{{makedict::a::1::b::2}}          → 构造字典(cbs.ts:1305)
{{dictelement::json::key}}        → 取对象成员(cbs.ts:1190)
{{objectassert::json::key}}       → 断言成员存在(cbs.ts:1200)
{{lorebook}}                      → 返回世界书 JSON 数组(cbs.ts:318)
```

### 数组遍历/循环
```
{{#each [1, 2, 3] as n}}{{slot::n}}{{/}}          → "123"(loop.test.ts:34)
{{#each::keep [[1,2],[3,4]] as x}}...嵌套...{{/}} → 二维数组+嵌套循环(loop.test.ts:46)
{{#each {{getvar::arr}} as n}}{{slot::n}}{{/}}    → 变量数组(loop.test.ts:40)
{{makearray::1::2::3}} / {{arraylength::...}} / {{filter::...}}
```

### 条件判断
```
{{#if 1}}CBS{{/}}                                  → "CBS"(conditionals.test.ts:26)
{{#when::A::and::B}}...{{:else}}...{{/}}           → 与(操作符见 cbs.ts:2421-2446)
{{#when::not::condition}}...{{/}}                  → 非
{{#when::var::varName}}...{{/}}                    → 变量真值
{{#when::toggle::toggleName}}...{{/}}              → 开关
{{#when::A::>::B}} / {{::>=::}} / {{::<::}} / {{::<=::}} / {{::is::}} / {{::isnot::}}
{{#when 1}}正文{{:else}}回退{{/}}                  → 单行 else(parser.svelte.ts:1455)
```

### 数学表达式
```
{{? (2*3)+4}}    → 10(支持 + - * / % ^ 与括号,cbs.ts:2266)
{{calc::2+2*3}}  → 8(cbs.ts:802)
{{range::1::5}}  → 1..5(数组生成,cbs.ts:1546)
```

### 函数定义/调用
```
{{#func greet name}}Hello {{arg::0}}!{{/}}{{call::greet::World}}  → "Hello World!"
```

---

## 8. 求值顺序与转义

### 求值顺序
1. **单趟左到右**逐字符扫描(parser.svelte.ts:1613)。
2. **嵌套由栈保证**:内层 `{{}}` 先出栈求值;`#each` 通过"重写 da + 继续解析"实现,因此在外部遍历中块内新生成的宏会继续被解析(parser.svelte.ts:1720-1723)。
3. **`#puredisplay` 二次防解析**:输出时把 `{{`→`\{{`、`}}`→`\}}`(parser.svelte.ts:1737)。
4. **递归深度限制 20 层**(parser.svelte.ts:1605)。
5. 宏参数 `::` 优先于 `:` 拆分(parser.svelte.ts:1038-1042)。
6. 未知宏原样保留;未闭合花括号在结尾会补 `{{` 前缀(parser.svelte.ts:1755-1759)。

### 转义机制(重点:`\{{` **不存在**)
RisuAI **没有** `\{{` 反斜杠转义。转义方案有 3 套:

1. **私有 Unicode 区间 `U+E9B8–E9BF`**:`risuEscape()` 把 `{}()<>:;` 替换为私有字符(parser.svelte.ts:140-149),`risuUnescape()` 反向还原(L133-138)。用于 `{{#escape}}` 块、以及发送给模型前/收到后(request.ts:218,282)。
2. **`{{#escape}}...{{/}}` 块**(parser.svelte.ts:1209,1530;escapes.test.ts:71-88):块内 `{}()` 全部被转义,`::keep` 保留空白。
3. **显示宏**:`{{bo}}/{{bc}}`(→`{{`/`}}`)、`{{decbo}}/{{decbc}}`(→`{`/`}`)、`{{(}}/{{)}}`、`{{<}}/{{>}}`、`{{;}}`(escapes.test.ts:17-62)。

使用范式:`risuUnescape(risuChatParser(text))` —— 先解析宏,再还原转义字符(escapes.test.ts:65)。

---

## 9. 结论

1. RisuAI 宏系统是**自研字符级状态机 + 注册表回调**架构,核心在 `parser.svelte.ts:1538` 与 `cbs.ts:117`,无第三方模板引擎依赖。
2. 语法覆盖:变量(`{{x}}`)、带参函数(`{{x::a::b}}`)、数学(`{{? expr}}`)、块级逻辑(`#when/#if/:else`)、循环(`#each`)、函数(`#func/call::`)、转义(`#escape`)、注释、HTML/资产装饰器。
3. 内置宏**非常丰富**(171 注册点),足以覆盖变量、时间、随机、历史、提示词段落、数组/对象、字符串/数学/比较、显示与加密等全部需求。
4. 自定义变量分 4 层作用域(全局/角色默认/聊天/临时),聊天级通过 `setvar/getvar` 持久化到 `chat.scriptstate`。
5. 正则脚本通过 `<cbs>` flag 选择性地对 IN 做宏展开,OUT 替换后必然二次展开;`{{hiddenkey}}` 实现"仅激活脚本不占用 token"。
6. 提示词组装时每个段落独立执行宏,发送前 `risuUnescape`、接收后按需 `risuEscape`。
7. 转义走私有 Unicode 字符方案,无 `\{{` 反斜杠语法——若需导入 `\{{` 格式的角色卡,需在解析前自行转换。
