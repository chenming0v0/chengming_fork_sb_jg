# 提示词相关数据结构速查（角色卡、世界信息、人格描述、作者注释、向量记忆）

下面把常见几类提示词素材的数据结构用中文说明，并附上“长相示例”，方便在别处复刻。示例均基于仓库内的类型定义或装配代码。

## 角色卡（Tavern Card v2）

角色卡遵循 `chara_card_v2` 规范，核心结构见 `spec-v2.d.ts`。主要字段：

```jsonc
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "名字",
    "description": "角色背景/描述",
    "personality": "人格/性格描述",
    "scenario": "当前场景设定",
    "first_mes": "首句问候",
    "mes_example": "示例对话",
    "creator_notes": "作者注释（对话风格或约束）",
    "system_prompt": "系统提示（可用于强制规则）",
    "post_history_instructions": "历史消息之后的附加指令",
    "alternate_greetings": ["备用问候1", "备用问候2"],
    "character_book": { "entries": [...] },
    "tags": ["标签1", "标签2"],
    "creator": "作者名",
    "character_version": "版本号",
    "extensions": { "自定义扩展": "..." }
  }
}
```

- 人格描述(`personality`) 和作者注释(`creator_notes`) 都是字符串，填入后会在装配时各自进入对应的提示槽位。
- `character_book` 可嵌入“世界信息”形式的条目（见下节）。

引用：`src/types/spec-v2.d.ts` 中的字段定义。【F:src/types/spec-v2.d.ts†L1-L52】

## 世界信息 / 角色书（CharacterBook）

世界信息导入后会被转成 `character_book`，内部由若干条目组成：

```jsonc
{
  "name": "可选：世界信息名称",
  "description": "可选：说明文字",
  "scan_depth": 4,
  "token_budget": 800,
  "recursive_scanning": false,
  "extensions": {},
  "entries": [
    {
      "id": 1,                // 可选：原始 UID
      "keys": ["关键词1", "关键词2"],
      "secondary_keys": ["次级匹配词"],
      "content": "命中后插入的文本",
      "comment": "作者注释（仅展示用）",
      "enabled": true,
      "insertion_order": 0,   // 排序用
      "position": "before_char", // 或 "after_char"
      "extensions": {
        "depth": 4,               // 扫描深度
        "group": "",             // 分组名（可空）
        "probability": null,      // 触发概率
        "vectorized": false,      // 是否已向量化
        "match_persona_description": false // 是否要求匹配人格描述
        // ... 其他可选扩展同样保留
      }
    }
  ]
}
```

- `keys`/`secondary_keys`：命中关键词（SillyTavern 默认当作正则）。
- `position`：决定条目插在角色描述前还是后。
- `extensions` 中保留了触发概率、分组、向量化标记等大量可选开关。

引用：转换逻辑会把世界信息文件的 `entries` 映射到上面的结构，详见 `convertWorldInfoToCharacterBook`。【F:src/endpoints/characters.js†L670-L729】

## 人格描述（Persona Description）

人格描述是用户自己的“我是谁”文本，存放在 `power_user.persona_description` 里，用时会按设置注入扩展提示：

```js
setExtensionPrompt('PERSONA_DESCRIPTION', power_user.persona_description, position, depth, /*scan*/ true, role);
```

- `position`：`IN_PROMPT` 表示塞进主提示；`IN_CHAT` 搭配 `depth` 表示插入历史消息上方第 N 层。
- `role`：扩展提示角色（system/user/assistant）。
- 也可与作者注释合并（把文本前/后拼进 A/N）。

引用：人格描述如何写入扩展提示，见 `addPersonaDescriptionExtensionPrompt()`。【F:public/script.js†L2951-L2972】

## 作者注释（Author's Note / 浮动提示）

作者注释是扩展提示的一种，存放在 `extension_prompts['2_floating_prompt']`（别名 NOTE_MODULE_NAME）。所有扩展提示的统一结构由 `setExtensionPrompt()` 设定：

```jsonc
{
  "value": "要注入的文字",
  "position": 0,       // 0=故事前，1=历史内（对应 extension_prompt_types）
  "depth": 0,          // 当 position=1 时，距离历史底部的层数
  "scan": true,        // 是否参与世界信息扫描
  "role": 0,           // 角色枚举：0 system / 1 user / 2 assistant
  "filter": null       // 可选：返回 true/false 的动态过滤函数
}
```

引用：扩展提示对象的形状定义在 `setExtensionPrompt` 中。【F:public/script.js†L8368-L8387】

## 向量记忆与数据仓库（Vectors）

向量扩展会把检索结果写入扩展提示 `3_vectors`（聊天摘要）与 `4_vectors_data_bank`（文件/资料片段），同样沿用上面的通用结构，标签常量定义如下：

```js
export const EXTENSION_PROMPT_TAG = '3_vectors';
export const EXTENSION_PROMPT_TAG_DB = '4_vectors_data_bank';
```

扩展设置中还记录了向量模块的配置（模型、chunk 大小、深度、角色等），常见字段示例：

```jsonc
{
  "template": "Past events:\n{{text}}",  // 聊天检索模板
  "depth": 2,                            // 注入深度
  "position": 0,                         // 注入位置（IN_PROMPT）
  "file_template_db": "Related information:\n{{text}}",
  "file_position_db": 0,                 // 数据仓库提示位置
  "file_depth_db": 4,                    // 数据仓库提示深度
  "file_depth_role_db": 0                // 数据仓库提示角色（system）
}
```

引用：向量扩展的标签与配置对象定义在 `public/scripts/extensions/vectors/index.js` 开头。【F:public/scripts/extensions/vectors/index.js†L48-L112】

