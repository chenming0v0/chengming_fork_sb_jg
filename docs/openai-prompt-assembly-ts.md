# OpenAI 提示词装配 TS 实现指南（兼容 SillyTavern 槽位）

目标：给“让 AI 来写代码”的场景用的一份攻略。读完后，AI 能按 SillyTavern（下文简称 ST）现有格式，在 TypeScript 里写出兼容的提示词装配逻辑。

> 参考代码：ST 的核心逻辑位于 `preparePromptsForChatCompletion()`、`populateDialogueExamples()`、`populateChatHistory()` 与注入函数 `populationInjectionPrompts()`。【F:public/scripts/openai.js†L1234-L1382】【F:public/scripts/openai.js†L927-L1013】【F:public/scripts/openai.js†L795-L927】【F:public/scripts/openai.js†L721-L793】
> 默认槽位：Prompt Manager 里定义的 `chatCompletionDefaultPrompts` 和顺序数组 `promptManagerDefaultPromptOrder`。【F:public/scripts/PromptManager.js†L2011-L2145】

## 1. 必要的数据结构（保持字段名一致即可兼容）

```ts
// 角色枚举与注入位置（按 ST 的语义命名即可，不必完全相同的数值）
export type PromptRole = 'system' | 'user' | 'assistant';
export type InjectionPosition = 'BEFORE_PROMPT' | 'IN_PROMPT' | 'IN_CHAT';

export interface PromptItem {
  identifier: string;            // 槽位标识符，必须沿用 ST 的命名（main/jailbreak/worldInfoBefore...）
  role: PromptRole;              // system / user / assistant
  content: string;               // 提示正文
  system_prompt?: boolean;       // 是否当作系统提示渲染
  marker?: boolean;              // Prompt Manager 用的“插入点”标记
  injection_position?: InjectionPosition; // IN_PROMPT 表示跟主提示一起；IN_CHAT 表示塞进历史
  injection_depth?: number;      // 深度（0=紧贴最近一条历史，数字越大越靠前）
  injection_order?: number;      // 同一深度内的优先级，数字越大越先处理
  forbid_overrides?: boolean;    // 角色卡是否允许覆盖
  extension?: boolean;           // 是否来自扩展/插件
  position?: InjectionPosition;  // 兼容 ST 扩展对象的字段名
}

// Prompt 集合：行为与 ST 的 PromptCollection 保持一致即可
export interface PromptCollection {
  collection: PromptItem[];
  get(id: string): PromptItem | undefined;
  add(item: PromptItem): void;
  index(id: string): number; // 返回位置，-1 表示不存在
  override(item: PromptItem, idx: number): void;
  has(id: string): boolean;
}

// Prompt Manager 最少需要暴露这些接口
export interface PromptManager {
  getPromptCollection(type?: string): PromptCollection; // 带上 prompt 顺序与启用状态
  preparePrompt(prompt: PromptItem, originalContent?: string): PromptItem; // 负责变量替换与模板渲染
  isPromptDisabledForActiveCharacter(id: string): boolean;
}

// 扩展提示的形状（沿用 ST 的 setExtensionPrompt 输出）
export interface ExtensionPrompt {
  value: string;
  position: InjectionPosition | number; // IN_PROMPT / BEFORE_PROMPT / IN_CHAT
  depth?: number;                        // 当 position = IN_CHAT 时才有意义
  scan?: boolean;                        // 是否参与世界信息扫描
  role?: number;                         // 0 system, 1 user, 2 assistant（可自行映射）
  filter?: () => boolean | Promise<boolean>; // 通过才注入
}
export type ExtensionPromptMap = Record<string, ExtensionPrompt>;
```

## 2. 装配流程总览（按顺序实现）

1. **准备基础文本**：格式化场景、性格、群聊提示等；生成内置系统提示列表 `systemPrompts`，每条带 `identifier`。【F:public/scripts/openai.js†L1234-L1298】
2. **追加扩展提示**：把记忆、作者注释、向量结果、人格描述等扩展写入同一列表，保留 role/position/depth 信息；未知扩展需过滤 `position`、`filter` 后再入列。【F:public/scripts/openai.js†L1299-L1334】
3. **与 Prompt Manager 合并**：取出当前类型的 PromptCollection；若已有同名项，则沿用集合的 role/depth/order 设置，再经过 `preparePrompt()` 渲染；不存在则直接追加。【F:public/scripts/openai.js†L1336-L1360】
4. **角色卡覆盖**：如果角色卡提供 main/jailbreak 覆盖且槽位未被禁用，则替换内容后重新 `preparePrompt()`。【F:public/scripts/openai.js†L1362-L1380】
5. **生成消息队列**：后续 `prepareOpenAIMessages()` 会把 PromptCollection 拆成三段：
   - **IN_PROMPT**：直接按顺序写入 `MessageCollection('system')`。
   - **IN_CHAT**：按 `injection_depth` 与 `injection_order` 在历史中插入，算法见下方 TS 示例，与 `populationInjectionPrompts()` 一致。【F:public/scripts/openai.js†L721-L793】
   - **历史/示例**：示例对话可在历史前或后插入；历史按预算从新到旧回填。【F:public/scripts/openai.js†L795-L1013】
6. **预算检查并展平**：`ChatCompletion` 按顺序扣减 token 预算，最后输出 `{role, content, name}` 列表发送给 OpenAI。【F:public/scripts/openai.js†L1200-L1214】【F:public/scripts/openai.js†L3341-L3393】

## 3. TypeScript 参考实现片段

下面的示例刻意贴近 ST 的字段命名，方便 AI 直接复刻；你只需把变量替换/日志等细节接入自己的工程即可。

```ts
// role 数值到字符串的简单映射，可根据自己的枚举调整
const roleMap = { 0: 'system', 1: 'user', 2: 'assistant' } as const;

interface AssembleOptions {
  scenario?: string;
  charPersonality?: string;
  worldInfoBefore?: string;
  worldInfoAfter?: string;
  charDescription?: string;
  quietPrompt?: string;
  bias?: string;
  extensionPrompts: ExtensionPromptMap;
  systemPromptOverride?: string;
  jailbreakPromptOverride?: string;
  type?: string; // 生成类型：普通/impersonate/continue...
}

export async function assemblePromptCollection(
  opts: AssembleOptions,
  promptManager: PromptManager,
  formatters: {
    formatWorldInfo: (text?: string) => string;
    substituteScenario: (tpl?: string) => string;
    substitutePersonality: (tpl?: string) => string;
    substituteGroupNudge: () => string;
    substituteImpersonation: () => string;
    getPromptPosition: (pos: InjectionPosition | number) => InjectionPosition;
    getPromptRole: (role?: number) => PromptRole;
  },
): Promise<PromptCollection> {
  const {
    scenario,
    charPersonality,
    worldInfoBefore,
    worldInfoAfter,
    charDescription,
    quietPrompt,
    bias,
    extensionPrompts,
    systemPromptOverride,
    jailbreakPromptOverride,
    type,
  } = opts;

  const scenarioText = formatters.substituteScenario();
  const charPersonalityText = formatters.substitutePersonality();
  const groupNudge = formatters.substituteGroupNudge();
  const impersonationPrompt = formatters.substituteImpersonation();

  // 1) 基础系统提示（含标记位与可选项）
  const systemPrompts: PromptItem[] = [
    { role: 'system', content: formatters.formatWorldInfo(worldInfoBefore), identifier: 'worldInfoBefore' },
    { role: 'system', content: formatters.formatWorldInfo(worldInfoAfter), identifier: 'worldInfoAfter' },
    { role: 'system', content: charDescription || '', identifier: 'charDescription' },
    { role: 'system', content: charPersonalityText, identifier: 'charPersonality' },
    { role: 'system', content: scenarioText, identifier: 'scenario' },
    { role: 'system', content: impersonationPrompt, identifier: 'impersonate' },
    { role: 'system', content: quietPrompt || '', identifier: 'quietPrompt' },
    { role: 'system', content: groupNudge, identifier: 'groupNudge' },
    { role: 'assistant', content: bias || '', identifier: 'bias' },
  ];

  // 2) 追加已知扩展（记忆/作者注释/向量/人格描述等）
  const addIfAny = (key: string, identifier: string, fallbackRole: PromptRole = 'system') => {
    const prompt = extensionPrompts[key];
    if (prompt?.value) {
      systemPrompts.push({
        identifier,
        role: formatters.getPromptRole(prompt.role ?? 0) ?? fallbackRole,
        content: prompt.value,
        position: formatters.getPromptPosition(prompt.position),
        injection_depth: prompt.depth,
      });
    }
  };

  addIfAny('1_memory', 'summary');
  addIfAny('2_floating_prompt', 'authorsNote');
  addIfAny('3_vectors', 'vectorsMemory');
  addIfAny('4_vectors_data_bank', 'vectorsDataBank');
  addIfAny('chromadb', 'smartContext');
  addIfAny('PERSONA_DESCRIPTION', 'personaDescription');

  // 3) 未知扩展：仅接受 BEFORE_PROMPT / IN_PROMPT，且通过过滤
  for (const key of Object.keys(extensionPrompts)) {
    if (['1_memory', '2_floating_prompt', '3_vectors', '4_vectors_data_bank', 'chromadb', 'PERSONA_DESCRIPTION', 'QUIET_PROMPT', 'DEPTH_PROMPT'].includes(key)) continue;
    const prompt = extensionPrompts[key];
    if (!prompt?.value) continue;
    const position = formatters.getPromptPosition(prompt.position);
    if (!['BEFORE_PROMPT', 'IN_PROMPT'].includes(position)) continue;
    if (typeof prompt.filter === 'function' && !(await prompt.filter())) continue;
    systemPrompts.push({
      identifier: key.replace(/\W/g, '_'),
      role: formatters.getPromptRole(prompt.role ?? 0),
      content: prompt.value,
      position,
      injection_depth: prompt.depth,
      extension: true,
    });
  }

  // 4) 与 Prompt Manager 合并、渲染
  const prompts = promptManager.getPromptCollection(type);
  systemPrompts.forEach(prompt => {
    const existing = prompts.get(prompt.identifier);
    if (existing) {
      prompt.injection_position = existing.injection_position ?? prompt.injection_position;
      prompt.injection_depth = existing.injection_depth ?? prompt.injection_depth;
      prompt.injection_order = existing.injection_order ?? prompt.injection_order;
      prompt.role = (existing.role as PromptRole) ?? prompt.role;
    }
    const rendered = promptManager.preparePrompt(prompt, existing?.content);
    const idx = prompts.index(prompt.identifier);
    if (idx >= 0) prompts.override(rendered, idx);
    else prompts.add(rendered);
  });

  // 5) 角色卡覆盖 main/jailbreak
  const mainPrompt = prompts.get('main');
  if (systemPromptOverride && mainPrompt && mainPrompt.forbid_overrides !== true && !promptManager.isPromptDisabledForActiveCharacter('main')) {
    const replaced = promptManager.preparePrompt({ ...mainPrompt, content: systemPromptOverride }, mainPrompt.content);
    prompts.override(replaced, prompts.index('main'));
  }

  const jailbreakPrompt = prompts.get('jailbreak');
  if (jailbreakPromptOverride && jailbreakPrompt && jailbreakPrompt.forbid_overrides !== true && !promptManager.isPromptDisabledForActiveCharacter('jailbreak')) {
    const replaced = promptManager.preparePrompt({ ...jailbreakPrompt, content: jailbreakPromptOverride }, jailbreakPrompt.content);
    prompts.override(replaced, prompts.index('jailbreak'));
  }

  return prompts;
}

// 6) 把 IN_CHAT 提示按深度插入历史（与 ST 的 populationInjectionPrompts 对齐）
export async function injectPromptsIntoHistory(
  prompts: PromptItem[],
  history: PromptItem[],
  getExtensionPrompt: (depth: number, role: PromptRole) => Promise<string>,
): Promise<PromptItem[]> {
  let inserted = 0;
  const maxDepth = Math.max(...prompts.map(p => p.injection_depth ?? 0), 0);

  for (let depth = 0; depth <= maxDepth; depth++) {
    const depthPrompts = prompts.filter(p => p.injection_depth === depth && p.content);
    const orders = new Set(depthPrompts.map(p => p.injection_order ?? 100));

    const roleOrder: PromptRole[] = ['system', 'user', 'assistant'];
    const messages: PromptItem[] = [];

    [...orders].sort((a, b) => b - a).forEach(order => {
      roleOrder.forEach(role => {
        const merged = depthPrompts
          .filter(p => (p.injection_order ?? 100) === order && p.role === role)
          .map(p => p.content)
          .join('\n');
        const extra = order === 100 ? getExtensionPrompt(depth, role) : Promise.resolve('');
        messages.push({ role, content: [merged, await extra].filter(Boolean).join('\n'), identifier: `inject-${role}-${depth}-${order}`, injected: true } as PromptItem);
      });
    });

    const clean = messages.filter(m => m.content?.trim());
    if (clean.length) {
      const idx = depth + inserted;
      history.splice(idx, 0, ...clean);
      inserted += clean.length;
    }
  }

  return history.reverse();
}
```

### 如何在项目里使用

1. 调 `assemblePromptCollection()`：传入已解析的场景/角色卡文本和扩展提示，得到合并后的 PromptCollection。
2. 将集合拆成三类：
   - `injection_position === 'IN_PROMPT'` → 按 `promptManager` 顺序直接 push 到系统消息。
   - `injection_position === 'IN_CHAT'` → 交给 `injectPromptsIntoHistory()` 与聊天历史合并。
   - `identifier === 'dialogueExamples'`/`chatHistory` → 按 ST 的示例和历史写入顺序插入，再做 token 预算检查。
3. 展平成 `{role, content, name?}` 列表发送给 OpenAI 即可。

这样写出的 TS 代码与 ST 的槽位、深度、顺序规则保持一致，可以直接复刻同样的提示词装配效果。
