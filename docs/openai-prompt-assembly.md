# OpenAI 提示词装配：给 13 岁同学的简单讲解

下面用日常例子解释 SillyTavern 在调用 OpenAI Chat Completion 时怎么把提示词“拼成一条长指令”。涉及的代码主要在 `public/scripts/openai.js`，提示槽位的定义在 `public/scripts/PromptManager.js`。

## 一、角色是什么？

- **system（系统）**：像老师的规则说明，告诉 AI 你是谁、要遵守什么。代码里为世界信息、角色介绍等生成 system 消息。【F:public/scripts/openai.js†L1234-L1253】【F:public/scripts/openai.js†L1040-L1074】
- **user（用户）**：像你发的问题或要求，由玩家输入或程序追加的提醒组成。【F:public/scripts/openai.js†L1095-L1133】
- **assistant（助手）**：AI 之前的回答或示例对话，让模型知道应该怎么说话。【F:public/scripts/openai.js†L1180-L1207】

## 二、预设是什么？

可以把预设理解成“默认模板”。SillyTavern 会在打开 OpenAI 频道时创建 Prompt Manager，把主提示、NSFW、Jailbreak 等默认文本先放好，方便后面直接用。【F:public/scripts/openai.js†L593-L639】【F:public/scripts/openai.js†L99-L138】

如果你换了别的预设，默认文字就会被新的内容覆盖；没有换时，就用这些内置的初始值。【F:public/scripts/openai.js†L99-L112】

### 预设里有哪些“固定槽位”？

Prompt Manager 预先给 OpenAI 频道准备了 12 个槽位（许多人口头会说“13 个”，通常是把 `groupNudge` 之类的动态提示也算进来）。每个槽位都有固定的 `identifier`，方便后面被同名内容覆盖或重排：

- **main**：主提示（默认“写出 {{char}} 的下一句”）。
- **nsfw**：辅助提示，给成年内容用，默认为空。
- **jailbreak**：后置指导，默认为空。
- **dialogueExamples**（标记位）：示例对话插入点。
- **chatHistory**（标记位）：真实聊天记录的插入点。
- **worldInfoBefore / worldInfoAfter**（标记位）：世界信息上下两段。
- **charDescription / charPersonality / scenario / personaDescription**（标记位）：角色卡描述、性格、场景、自定义人设。
- **enhanceDefinitions**：可选的“扩写角色设定”提示，默认关闭。

这些默认槽位在 Prompt Manager 的 `chatCompletionDefaultPrompts` 里定义，加载时会被复制到你的设置里；用户界面的“提示顺序”列表使用同样的 identifier 来控制显示顺序和启用状态。【F:public/scripts/PromptManager.js†L2011-L2140】

### 预设怎么被新内容覆盖？

1. **拷贝默认槽位**：初始化时把 `chatCompletionDefaultPrompts.prompts` 拷贝到当前 preset。
2. **角色卡覆盖**：如果角色卡提供了 `main` 或 `jailbreak` 的覆盖文本，而且对应槽位未禁止 override，就用角色卡内容替换默认文案。
3. **扩展/插件注入**：扩展的浮动提示、向量结果等会作为新 prompt 项目追加到同一集合里，并带上 `identifier` 和可选 `position`/`depth`。
4. **相同 identifier 合并**：当系统生成的 prompt 与集合中已有同名项时，角色、深度、优先级等字段会优先使用已有项的设置，再交给 Prompt Manager 渲染模板。没有同名项时直接追加到集合中。

整套合并逻辑发生在 `preparePromptsForChatCompletion()`：系统先收集世界信息、角色描述等，再按照上面的规则与 Prompt Manager 里的同名 prompt 合并，最后返回合并后的集合给消息组装阶段使用。【F:public/scripts/openai.js†L1234-L1382】

## 三、深度（depth）是什么意思？

假设聊天记录像书的页面，越早的消息“离现在越远”。深度就是“这段提示想插在历史的哪个位置”。数值越大，放得越靠前；数值小就贴近最新对话。SillyTavern 会在放入消息时，把带深度的提示按照大小排序后插入消息队列里。【F:public/scripts/openai.js†L721-L793】【F:public/scripts/openai.js†L1095-L1213】

举例：
- 深度 100：放在所有历史最前面，像“故事背景”。
- 深度 10：放在最近消息附近，像“下一句回答别剧透”。

## 四、提示词是怎么一步步组装的？

> 需要直接看代码的话，可以参考新整理的注释版片段：`docs/openai-prompt-assembly-snippet.js`，里面把组装函数逐段拆开写了中文注释，便于在别处复刻。【F:docs/openai-prompt-assembly-snippet.js†L1-L108】

> 想直接用 TypeScript 复刻？看新的《TS 实现指南》：`docs/openai-prompt-assembly-ts.md`，内含完整类型定义与可运行的装配骨架，已对齐 ST 的槽位、深度与覆盖规则。【F:docs/openai-prompt-assembly-ts.md†L1-L191】

1. **收集素材**：角色卡、世界信息、人格描述、作者注释、向量记忆等都会被收集成一张“提示清单”。每条清单项都带着角色（system/user）、插入位置和深度。【F:public/scripts/openai.js†L1234-L1334】
2. **预设合并**：如果预设里有同名条目（比如自定义主提示），它会替换默认内容或修改角色、深度等设置，让你的模板生效；角色卡覆盖也在这一步完成。【F:public/scripts/openai.js†L1336-L1382】
3. **标识符排序**：Prompt Manager 会按“提示顺序”数组决定主顺序，并在需要插入聊天内部的提示上记录 `injection_position`（相对/聊天中）和 `injection_depth`（离当前有多远）。【F:public/scripts/PromptManager.js†L2097-L2139】【F:public/scripts/openai.js†L1343-L1359】
4. **控制提示排队**：像“冒充模式”“静默提示”这类控制开关，会集中放在结尾的队列里，等预算够了再一起写入。【F:public/scripts/openai.js†L1075-L1133】
5. **预算检查**：`ChatCompletion` 会计算还有多少 token 可以用（总上下文减去预期回复长度）。每次加入一条消息都会扣除预算，不够就报错提醒。【F:public/scripts/openai.js†L3341-L3395】
6. **插入历史和示例**：在核心提示写完并预留好预算后，才把最近的聊天历史和示例对话插入，避免挤掉重要规则。【F:public/scripts/openai.js†L795-L927】【F:public/scripts/openai.js†L1180-L1207】
7. **扁平化发送**：最后 `getChat()` 把这些分层的消息展平成 OpenAI 需要的 `{role, content, name}` 列表，这就是实际发给模型的指令。【F:public/scripts/openai.js†L3348-L3393】

### 提示顺序细节（要复刻时尤其注意）

- **提示槽位→Prompt 集合**：收集到的系统提示和扩展提示都会以 `identifier` 为键放进 Prompt 集合。
- **深度与优先级**：`injection_depth` 决定插入到历史的第几层（从当前往回数），`injection_order` 决定同一层里 system/user/assistant 拼接的先后；默认顺序是 system→user→assistant，同层 order 数字越大越先被处理。【F:public/scripts/openai.js†L721-L789】
- **历史写入顺序**：调用 `populateChatHistory()` 时，会先为“新聊天”标记和可能的群聊/续写提示预留预算，再从最新消息往前插入，直到预算不够为止。【F:public/scripts/openai.js†L795-L927】
- **示例插入**：`populateDialogueExamples()` 在历史写入前后（取决于设置）插入示例，每段示例自动加上 `example_user`/`example_assistant` 的 name，方便模型区分角色。【F:public/scripts/openai.js†L927-L1013】

## 五、一步到位的记忆口诀

1. **先定角色**：system 说规则，user 问问题，assistant 给示范。
2. **用好预设**：默认模板自动填；想换风格就改预设。
3. **看好深度**：背景放远，提醒放近。
4. **记住预算**：提示太多会超长，系统会提前挡掉。
5. **最后展平**：所有内容排好队，打包成一串消息发给 OpenAI。
