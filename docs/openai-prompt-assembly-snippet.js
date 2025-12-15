/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
/**
 * 仅供阅读的“提示词装配”参考片段，直接复制自
 * `public/scripts/openai.js` 的 `preparePromptsForChatCompletion()` 并添加
 * 中文注释，方便在其他项目复刻同样的流程。本文件不会被实际加载运行。
 */
async function preparePromptsForChatCompletion({
    scenario,
    charPersonality,
    name2,
    worldInfoBefore,
    worldInfoAfter,
    charDescription,
    quietPrompt,
    bias,
    extensionPrompts,
    systemPromptOverride,
    jailbreakPromptOverride,
    type,
}) {
    // 1）规范化核心文本（场景、性格、群聊提示等）
    const scenarioText = scenario && oai_settings.scenario_format ? substituteParams(oai_settings.scenario_format) : (scenario || '');
    const charPersonalityText = charPersonality && oai_settings.personality_format ? substituteParams(oai_settings.personality_format) : (charPersonality || '');
    const groupNudge = substituteParams(oai_settings.group_nudge_prompt);
    const impersonationPrompt = oai_settings.impersonation_prompt ? substituteParams(oai_settings.impersonation_prompt) : '';

    // 2）初始化“必有”的提示项，并带上 identifier 方便后续合并
    const systemPrompts = [
        { role: 'system', content: formatWorldInfo(worldInfoBefore), identifier: 'worldInfoBefore' },
        { role: 'system', content: formatWorldInfo(worldInfoAfter), identifier: 'worldInfoAfter' },
        { role: 'system', content: charDescription, identifier: 'charDescription' },
        { role: 'system', content: charPersonalityText, identifier: 'charPersonality' },
        { role: 'system', content: scenarioText, identifier: 'scenario' },
        // 额外项（默认不强制排序）
        { role: 'system', content: impersonationPrompt, identifier: 'impersonate' },
        { role: 'system', content: quietPrompt, identifier: 'quietPrompt' },
        { role: 'system', content: groupNudge, identifier: 'groupNudge' },
        { role: 'assistant', content: bias, identifier: 'bias' },
    ];

    // 3）注入内置扩展提示（记忆、作者注释、向量检索等）
    const summary = extensionPrompts['1_memory'];
    if (summary && summary.value) systemPrompts.push({ role: getPromptRole(summary.role), content: summary.value, identifier: 'summary', position: getPromptPosition(summary.position) });

    const authorsNote = extensionPrompts['2_floating_prompt'];
    if (authorsNote && authorsNote.value) systemPrompts.push({ role: getPromptRole(authorsNote.role), content: authorsNote.value, identifier: 'authorsNote', position: getPromptPosition(authorsNote.position) });

    const vectorsMemory = extensionPrompts['3_vectors'];
    if (vectorsMemory && vectorsMemory.value) systemPrompts.push({ role: 'system', content: vectorsMemory.value, identifier: 'vectorsMemory', position: getPromptPosition(vectorsMemory.position) });

    const vectorsDataBank = extensionPrompts['4_vectors_data_bank'];
    if (vectorsDataBank && vectorsDataBank.value) systemPrompts.push({ role: getPromptRole(vectorsDataBank.role), content: vectorsDataBank.value, identifier: 'vectorsDataBank', position: getPromptPosition(vectorsDataBank.position) });

    const smartContext = extensionPrompts['chromadb'];
    if (smartContext && smartContext.value) systemPrompts.push({ role: 'system', content: smartContext.value, identifier: 'smartContext', position: getPromptPosition(smartContext.position) });

    // 4）可选：把“人物描述”直接塞进提示词（需要配置为 IN_PROMPT）
    if (power_user.persona_description && power_user.persona_description_position === persona_description_positions.IN_PROMPT) {
        systemPrompts.push({ role: 'system', content: power_user.persona_description, identifier: 'personaDescription' });
    }

    // 5）处理其他扩展提示（只接受 BEFORE_PROMPT/IN_PROMPT 且通过过滤条件）
    const knownExtensionPrompts = ['1_memory', '2_floating_prompt', '3_vectors', '4_vectors_data_bank', 'chromadb', 'PERSONA_DESCRIPTION', 'QUIET_PROMPT', 'DEPTH_PROMPT'];
    for (const key in extensionPrompts) {
        if (Object.hasOwn(extensionPrompts, key)) {
            const prompt = extensionPrompts[key];
            if (knownExtensionPrompts.includes(key)) continue;
            if (!extensionPrompts[key].value) continue;
            if (![extension_prompt_types.BEFORE_PROMPT, extension_prompt_types.IN_PROMPT].includes(prompt.position)) continue;
            const hasFilter = typeof prompt.filter === 'function';
            if (hasFilter && !await prompt.filter()) continue;
            systemPrompts.push({
                identifier: key.replace(/\W/g, '_'),
                position: getPromptPosition(prompt.position),
                role: getPromptRole(prompt.role),
                content: prompt.value,
                extension: true,
            });
        }
    }

    // 6）从 Prompt Manager 读取当前提示集合（包含顺序、深度、角色等设定）
    const prompts = promptManager.getPromptCollection(type);

    // 7）将系统收集的提示并入集合；若集合已有同名项，则优先沿用集合的角色/深度/顺序设定
    systemPrompts.forEach(prompt => {
        const collectionPrompt = prompts.get(prompt.identifier);
        if (collectionPrompt) {
            prompt.injection_position = collectionPrompt.injection_position ?? prompt.injection_position;
            prompt.injection_depth = collectionPrompt.injection_depth ?? prompt.injection_depth;
            prompt.injection_order = collectionPrompt.injection_order ?? prompt.injection_order;
            prompt.role = collectionPrompt.role ?? prompt.role;
        }
        const newPrompt = promptManager.preparePrompt(prompt);
        const markerIndex = prompts.index(prompt.identifier);
        if (-1 !== markerIndex) prompts.collection[markerIndex] = newPrompt;
        else prompts.add(newPrompt);
    });

    // 8）应用角色卡对 main/jailbreak 的覆盖（槽位禁止覆盖或已禁用时跳过）
    const systemPrompt = prompts.get('main') ?? null;
    const isSystemPromptDisabled = promptManager.isPromptDisabledForActiveCharacter('main');
    if (systemPromptOverride && systemPrompt && systemPrompt.forbid_overrides !== true && !isSystemPromptDisabled) {
        const mainOriginalContent = systemPrompt.content;
        systemPrompt.content = systemPromptOverride;
        const mainReplacement = promptManager.preparePrompt(systemPrompt, mainOriginalContent);
        prompts.override(mainReplacement, prompts.index('main'));
    }

    const jailbreakPrompt = prompts.get('jailbreak') ?? null;
    const isJailbreakPromptDisabled = promptManager.isPromptDisabledForActiveCharacter('jailbreak');
    if (jailbreakPromptOverride && jailbreakPrompt && jailbreakPrompt.forbid_overrides !== true && !isJailbreakPromptDisabled) {
        const jbOriginalContent = jailbreakPrompt.content;
        jailbreakPrompt.content = jailbreakPromptOverride;
        const jbReplacement = promptManager.preparePrompt(jailbreakPrompt, jbOriginalContent);
        prompts.override(jbReplacement, prompts.index('jailbreak'));
    }

    // 9）返回合并后的 Prompt 集合，后续步骤会基于它把内容插入历史和示例
    return prompts;
}
