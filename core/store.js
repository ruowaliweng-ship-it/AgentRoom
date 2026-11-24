'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function maskSecret(secret) {
  if (!secret || typeof secret !== 'string') return '';
  const trimmed = secret.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

function getDefaultAgents() {
  return [
    {
      id: 'agent_george',
      name: '乔治',
      nameEn: 'George',
      title: '项目经理',
      titleEn: 'Project Manager',
      roleType: 'pm',
      avatarText: '乔',
      color: '#38BDF8',
      providerId: '',
      systemPrompt:
        '你是乔治，项目经理。你负责将用户需求拆解为清晰的执行步骤，指派给 @林溪（前端设计）或 @陈默（后端工程），并在各角色完成后进行汇总交付。若全部完成请在末尾标注 DONE；若需要用户做决策请标注 NEED_USER。',
      builtin: true
    },
    {
      id: 'agent_linxi',
      name: '林溪',
      nameEn: 'Linxi',
      title: '前端设计',
      titleEn: 'Frontend Designer',
      roleType: 'frontend',
      avatarText: '林',
      color: '#A855F7',
      providerId: '',
      systemPrompt:
        '你是林溪，前端设计与交互工程师。你擅长高颜值 UI 设计、可访问性与现代化前端实现。完成设计或前端代码方案后，主动 @陈默 进行技术与安全评审，或向 @乔治 汇报。',
      builtin: true
    },
    {
      id: 'agent_chenmo',
      name: '陈默',
      nameEn: 'Chenmo',
      title: '后端工程',
      titleEn: 'Backend Engineer',
      roleType: 'backend',
      avatarText: '陈',
      color: '#2DD4BF',
      providerId: '',
      systemPrompt:
        '你是陈默，后端工程师与质量评审官。你负责核心架构、数据接口、安全边界与代码质量评审。若发现严重缺陷，请明确输出 REVIEW_REJECT 并 @对应角色 整改；若验收通过，请输出 REVIEW_PASS 并 @乔治 汇总或标注 DONE。',
      builtin: true
    }
  ];
}

function getDefaultProviders() {
  return [
    {
      id: 'mock-demo',
      type: 'mock',
      builtin: true,
      name: '内置演示引擎',
      nameEn: 'Built-in Demo Engine',
      description: '开箱即用零 Key，完整体验多 AI 群聊、评审打回、熔断裁决与沙箱文件协作。',
      descriptionEn: 'Zero-key built-in multi-agent engine for instant group chat, review rejection, circuit breaker, and sandbox file collaboration.',
      enabled: true,
      baseUrl: '',
      apiKey: '',
      model: 'agentroom-mock-v1',
      cliCommand: '',
      cliArgs: '',
      timeoutMs: 30000
    },
    {
      id: 'agy-gemini-neon',
      type: 'agy',
      builtin: false,
      name: 'Antigravity · Gemini 4 Neon',
      nameEn: 'Antigravity · Gemini 4 Neon',
      description: '零额外 API 费用直连本机已登录的 agy.EXE，流式输出，适合日常规划与快速协作。',
      descriptionEn: 'Zero extra API cost via local agy.EXE with streaming output for planning & fast collaboration.',
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: 'gemini-4-neon-medium',
      cliCommand: '',
      cliArgs: '',
      timeoutMs: 90000
    },
    {
      id: 'agy-claude-sonnet',
      type: 'agy',
      builtin: false,
      name: 'Antigravity · Claude Sonnet 5.5',
      nameEn: 'Antigravity · Claude Sonnet 5.5',
      description: '直连本机 agy.EXE，均衡高效的编码与设计主力模型。',
      descriptionEn: 'Local agy.EXE streaming runner powered by Claude Sonnet 5.5 High.',
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: 'claude-sonnet-5-5-high',
      cliCommand: '',
      cliArgs: '',
      timeoutMs: 90000
    },
    {
      id: 'agy-claude-opus',
      type: 'agy',
      builtin: false,
      name: 'Antigravity · Claude Opus 5.5',
      nameEn: 'Antigravity · Claude Opus 5.5',
      description: '直连本机 agy.EXE，旗舰深度推理与严格架构安全评审模型。',
      descriptionEn: 'Local agy.EXE flagship deep reasoning & code review model.',
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: 'claude-opus-5-5-high',
      cliCommand: '',
      cliArgs: '',
      timeoutMs: 90000
    },
    {
      id: 'deepseek-api',
      type: 'openai',
      builtin: false,
      name: 'DeepSeek 官方 API',
      nameEn: 'DeepSeek Official API',
      description: '标准 OpenAI 兼容流式直连，低成本高性价比，适合中文与代码协作。',
      descriptionEn: 'OpenAI-compatible streaming API ideal for Chinese & coding collaboration.',
      enabled: false,
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      cliCommand: '',
      cliArgs: '',
      timeoutMs: 60000
    },
    {
      id: 'openai-compat',
      type: 'openai',
      builtin: false,
      name: 'OpenAI / 兼容 API',
      nameEn: 'OpenAI / Compatible API',
      description: '支持 OpenAI、Ollama、OneAPI 或任意兼容 /chat/completions 的服务端点。',
      descriptionEn: 'Supports OpenAI, Ollama, OneAPI, or any OpenAI-compatible /chat/completions endpoint.',
      enabled: false,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      cliCommand: '',
      cliArgs: '',
      timeoutMs: 60000
    },
    {
      id: 'local-cli',
      type: 'cli',
      builtin: false,
      name: '本地 CLI 适配器',
      nameEn: 'Local CLI Adapter',
      description: '挂载本地命令行 AI（如 claude / agy / 自定义脚本），强制 UTF-8 与子进程树超时清理。',
      descriptionEn: 'Attach local CLI agents (claude / agy / custom script) with UTF-8 encoding and process-tree timeout cleanup.',
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: 'local-cli',
      cliCommand: 'node',
      cliArgs: '-e "let s=\'\';process.stdin.on(\'data\',d=>s+=d);process.stdin.on(\'end\',()=>console.log(\'[Local CLI] 收到任务: \'+s.slice(0,120)))"',
      timeoutMs: 30000
    }
  ];
}

function getDefaultData() {
  const agents = getDefaultAgents();
  const now = new Date().toISOString();
  const groupRoomId = 'room_project_default';

  const rooms = [
    {
      id: groupRoomId,
      type: 'group',
      name: '核心项目协作群',
      nameEn: 'Core Project Room',
      memberIds: agents.map((a) => a.id),
      createdAt: now,
      updatedAt: now
    },
    ...agents.map((a) => ({
      id: `dm_${a.id}`,
      type: 'dm',
      name: a.name,
      nameEn: a.nameEn,
      memberIds: [a.id],
      createdAt: now,
      updatedAt: now
    }))
  ];

  const welcomeMessage = {
    id: createId('msg'),
    roomId: groupRoomId,
    senderType: 'system',
    senderId: 'system',
    senderName: '系统',
    content:
      '欢迎来到 **AgentRoom**！当前已就绪三位 AI 协作者：@乔治（项目经理）、@林溪（前端设计）、@陈默（后端工程）。\n\n- 默认启用**内置演示引擎**（零 Key 开箱即用），也可在右上角「模型设置」切换 DeepSeek / OpenAI 兼容 API 或本地 CLI。\n- 点击顶部「授权目录」即可在安全沙箱内读写项目文件。\n- 试试发送：`请大家一起设计一个登录页面并完成代码评审`，或发送含 `评审测试` 的消息体验 **2 次打回 → 第 3 次强制熔断** 机制！',
    createdAt: now,
    meta: { kind: 'welcome' }
  };

  return {
    version: 1,
    settings: {
      theme: 'dark',
      language: 'zh-CN',
      activeProviderId: 'mock-demo',
      maxRounds: 3,
      maxReviewRejects: 2,
      hasAutoDiscovered: false,
      sidebarWidth: 268
    },
    grants: [],
    agents,
    providers: getDefaultProviders(),
    rooms,
    messages: {
      [groupRoomId]: [welcomeMessage]
    }
  };
}

class LocalStore {
  constructor(dataDir) {
    if (!dataDir) {
      throw new Error('LocalStore 需要提供 dataDir');
    }
    this.dataDir = path.resolve(dataDir);
    this.filePath = path.join(this.dataDir, 'agentroom-store.json');
    this.data = null;
    this.load();
  }

  load() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      this.data = getDefaultData();
      this.save();
      return this.data;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const defaults = getDefaultData();
      this.data = {
        version: 1,
        settings: { ...defaults.settings, ...(parsed.settings || {}) },
        grants: Array.isArray(parsed.grants) ? parsed.grants : [],
        agents: Array.isArray(parsed.agents) && parsed.agents.length > 0 ? parsed.agents : defaults.agents,
        deletedProviderIds: Array.isArray(parsed.deletedProviderIds) ? parsed.deletedProviderIds : [],
        providers: this._mergeProviders(
          defaults.providers,
          parsed.providers,
          Array.isArray(parsed.deletedProviderIds) ? parsed.deletedProviderIds : []
        ),
        rooms: Array.isArray(parsed.rooms) && parsed.rooms.length > 0 ? parsed.rooms : defaults.rooms,
        messages: parsed.messages && typeof parsed.messages === 'object' ? parsed.messages : defaults.messages
      };
    } catch (_) {
      this.data = getDefaultData();
      this.save();
    }
    return this.data;
  }

  _mergeProviders(defaultProviders, savedProviders, deletedIds = []) {
    if (!Array.isArray(savedProviders) || savedProviders.length === 0) {
      return defaultProviders;
    }
    const deletedSet = new Set(deletedIds || []);
    const map = new Map();
    for (const def of defaultProviders) {
      if (def.id !== 'mock-demo' && deletedSet.has(def.id)) continue;
      map.set(def.id, { ...def });
    }
    for (const saved of savedProviders) {
      if (saved && saved.id) {
        const base = map.get(saved.id) || {};
        map.set(saved.id, { ...base, ...saved });
      }
    }
    return Array.from(map.values());
  }

  save() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    const payload = JSON.stringify(this.data, null, 2);
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, payload, 'utf8');
    try {
      fs.renameSync(tmpPath, this.filePath);
    } catch (_) {
      // Windows 偶发文件占用时直接覆写并清理临时文件
      fs.writeFileSync(this.filePath, payload, 'utf8');
      try {
        fs.unlinkSync(tmpPath);
      } catch (__) {
        // ignore
      }
    }
  }

  getSettings() {
    return { ...this.data.settings };
  }

  updateSettings(patch = {}) {
    const next = { ...this.data.settings };
    if (patch.theme === 'dark' || patch.theme === 'light') {
      next.theme = patch.theme;
    }
    if (patch.language === 'zh-CN' || patch.language === 'en-US') {
      next.language = patch.language;
    }
    if (typeof patch.activeProviderId === 'string' && patch.activeProviderId) {
      next.activeProviderId = patch.activeProviderId;
    }
    if (patch.maxRounds !== undefined) {
      const n = Number(patch.maxRounds);
      if (Number.isFinite(n)) {
        next.maxRounds = Math.min(10, Math.max(1, Math.round(n)));
      }
    }
    if (patch.maxReviewRejects !== undefined) {
      const n = Number(patch.maxReviewRejects);
      if (Number.isFinite(n)) {
        next.maxReviewRejects = Math.min(5, Math.max(1, Math.round(n)));
      }
    }
    if (typeof patch.hasAutoDiscovered === 'boolean') {
      next.hasAutoDiscovered = patch.hasAutoDiscovered;
    }
    if (patch.sidebarWidth !== undefined) {
      const w = Number(patch.sidebarWidth);
      if (Number.isFinite(w)) {
        next.sidebarWidth = Math.min(380, Math.max(230, Math.round(w)));
      }
    }
    this.data.settings = next;
    this.save();
    return { ...next };
  }

  getGrants() {
    return this.data.grants.map((g) => ({ ...g }));
  }

  setGrants(grants) {
    this.data.grants = grants.map((g) => ({
      path: g.path,
      realPath: g.realPath,
      name: g.name,
      grantedAt: g.grantedAt
    }));
    this.save();
  }

  listAgents() {
    return this.data.agents.map((a) => ({ ...a }));
  }

  getAgent(agentId) {
    const found = this.data.agents.find((a) => a.id === agentId);
    return found ? { ...found } : null;
  }

  upsertAgent(agentInput) {
    const now = new Date().toISOString();
    if (!agentInput || !agentInput.name || !agentInput.name.trim()) {
      throw new Error('角色名称不能为空');
    }
    const name = agentInput.name.trim();
    const existingIdx = agentInput.id
      ? this.data.agents.findIndex((a) => a.id === agentInput.id)
      : -1;

    if (existingIdx >= 0) {
      const prev = this.data.agents[existingIdx];
      const updated = {
        ...prev,
        name,
        nameEn: (agentInput.nameEn || prev.nameEn || name).trim(),
        title: (agentInput.title || prev.title || '协作专员').trim(),
        titleEn: (agentInput.titleEn || prev.titleEn || 'Specialist').trim(),
        roleType: agentInput.roleType || prev.roleType || 'custom',
        avatarText: (agentInput.avatarText || name.slice(0, 1)).trim().slice(0, 2),
        color: agentInput.color || prev.color || '#6366F1',
        providerId: agentInput.providerId !== undefined ? String(agentInput.providerId) : prev.providerId || '',
        systemPrompt: (agentInput.systemPrompt || prev.systemPrompt || '').trim()
      };
      this.data.agents[existingIdx] = updated;
      // 同步更新对应私聊名称
      const dmRoom = this.data.rooms.find((r) => r.id === `dm_${updated.id}`);
      if (dmRoom) {
        dmRoom.name = updated.name;
        dmRoom.nameEn = updated.nameEn;
      }
      this.save();
      return { ...updated };
    }

    const newAgent = {
      id: createId('agent'),
      name,
      nameEn: (agentInput.nameEn || name).trim(),
      title: (agentInput.title || 'AI 协作专员').trim(),
      titleEn: (agentInput.titleEn || 'AI Specialist').trim(),
      roleType: agentInput.roleType || 'custom',
      avatarText: (agentInput.avatarText || name.slice(0, 1)).trim().slice(0, 2),
      color: agentInput.color || '#F59E0B',
      providerId: agentInput.providerId ? String(agentInput.providerId) : '',
      systemPrompt: (
        agentInput.systemPrompt ||
        `你是${name}，专业 AI 协作者。请高效清晰地协助团队完成任务。`
      ).trim(),
      builtin: false
    };
    this.data.agents.push(newAgent);

    // 自动创建私聊会话并加入默认项目群
    this.data.rooms.push({
      id: `dm_${newAgent.id}`,
      type: 'dm',
      name: newAgent.name,
      nameEn: newAgent.nameEn,
      memberIds: [newAgent.id],
      createdAt: now,
      updatedAt: now
    });
    const defaultGroup = this.data.rooms.find((r) => r.id === 'room_project_default');
    if (defaultGroup && !defaultGroup.memberIds.includes(newAgent.id)) {
      defaultGroup.memberIds.push(newAgent.id);
    }
    this.save();
    return { ...newAgent };
  }

  deleteAgent(agentId) {
    const agent = this.data.agents.find((a) => a.id === agentId);
    if (!agent) return false;
    if (agent.builtin) {
      throw new Error('预置核心角色不支持删除，但可以编辑其提示词与模型');
    }
    this.data.agents = this.data.agents.filter((a) => a.id !== agentId);
    this.data.rooms = this.data.rooms.filter((r) => r.id !== `dm_${agentId}`);
    for (const room of this.data.rooms) {
      room.memberIds = room.memberIds.filter((id) => id !== agentId);
    }
    delete this.data.messages[`dm_${agentId}`];
    this.save();
    return true;
  }

  listProvidersRaw() {
    return this.data.providers.map((p) => ({ ...p }));
  }

  listProvidersSanitized() {
    return this.data.providers.map((p) => ({
      ...p,
      hasApiKey: Boolean(p.apiKey && p.apiKey.trim()),
      apiKeyMasked: maskSecret(p.apiKey),
      apiKey: '' // 永不向渲染进程回传明文 Key
    }));
  }

  getProviderRaw(providerId) {
    const found = this.data.providers.find((p) => p.id === providerId);
    return found ? { ...found } : null;
  }

  saveProvider(providerInput) {
    if (!providerInput || !providerInput.id) {
      throw new Error('模型卡片 ID 不能为空');
    }
    const idx = this.data.providers.findIndex((p) => p.id === providerInput.id);
    if (idx < 0) {
      throw new Error(`未找到模型配置卡片: ${providerInput.id}`);
    }
    const prev = this.data.providers[idx];
    const next = {
      ...prev,
      name: providerInput.name !== undefined ? String(providerInput.name).trim() || prev.name : prev.name,
      baseUrl: providerInput.baseUrl !== undefined ? String(providerInput.baseUrl).trim() : prev.baseUrl,
      model: providerInput.model !== undefined ? String(providerInput.model).trim() : prev.model,
      cliCommand: providerInput.cliCommand !== undefined ? String(providerInput.cliCommand).trim() : prev.cliCommand,
      cliArgs: providerInput.cliArgs !== undefined ? String(providerInput.cliArgs) : prev.cliArgs,
      timeoutMs:
        providerInput.timeoutMs !== undefined && Number.isFinite(Number(providerInput.timeoutMs))
          ? Math.min(300000, Math.max(3000, Number(providerInput.timeoutMs)))
          : prev.timeoutMs,
      userModified: true
    };

    // 只有明确传入新 Key（且不是脱敏占位符）时才更新；clearApiKey 为 true 时清空
    if (providerInput.clearApiKey === true) {
      next.apiKey = '';
    } else if (
      typeof providerInput.apiKey === 'string' &&
      providerInput.apiKey.trim() !== '' &&
      !providerInput.apiKey.includes('****')
    ) {
      next.apiKey = providerInput.apiKey.trim();
    }

    this.data.providers[idx] = next;
    if (providerInput.setActive === true) {
      this.data.settings.activeProviderId = next.id;
    }
    this.save();
    return {
      ...next,
      hasApiKey: Boolean(next.apiKey && next.apiKey.trim()),
      apiKeyMasked: maskSecret(next.apiKey),
      apiKey: ''
    };
  }

  createProvider(providerInput = {}) {
    const allowedTypes = new Set(['agy', 'openai', 'cli']);
    const type = allowedTypes.has(providerInput.type) ? providerInput.type : 'agy';
    const id = createId(`provider_${type}`);

    const defaultsByType = {
      agy: {
        name: 'Antigravity 本机模型',
        nameEn: 'Antigravity Local Model',
        description: '直连本机已登录的 agy.EXE，零额外 API 费用。',
        descriptionEn: 'Local agy.EXE streaming model with zero extra API cost.',
        baseUrl: '',
        model: 'gemini-4-neon-medium',
        cliCommand: '',
        cliArgs: '',
        timeoutMs: 90000
      },
      openai: {
        name: '自定义 OpenAI 兼容 API',
        nameEn: 'Custom OpenAI Compatible API',
        description: '连接任意兼容 /chat/completions 的云端或本地模型服务。',
        descriptionEn: 'Connect any OpenAI-compatible /chat/completions endpoint.',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        cliCommand: '',
        cliArgs: '',
        timeoutMs: 60000
      },
      cli: {
        name: '自定义本地 CLI 引擎',
        nameEn: 'Custom Local CLI Engine',
        description: '挂载任意本地命令行 AI 或脚本，UTF-8 流式交互。',
        descriptionEn: 'Attach any local CLI agent or script with UTF-8 I/O.',
        baseUrl: '',
        model: 'custom-cli',
        cliCommand: 'node',
        cliArgs: '',
        timeoutMs: 30000
      }
    };

    const base = defaultsByType[type];
    const name = (providerInput.name && String(providerInput.name).trim()) || base.name;
    const created = {
      id,
      type,
      builtin: false,
      custom: true,
      name,
      nameEn: (providerInput.nameEn && String(providerInput.nameEn).trim()) || name,
      description: (providerInput.description && String(providerInput.description).trim()) || base.description,
      descriptionEn: (providerInput.descriptionEn && String(providerInput.descriptionEn).trim()) || base.descriptionEn,
      enabled: false,
      baseUrl: providerInput.baseUrl !== undefined ? String(providerInput.baseUrl).trim() : base.baseUrl,
      apiKey:
        typeof providerInput.apiKey === 'string' && !providerInput.apiKey.includes('****')
          ? providerInput.apiKey.trim()
          : '',
      model: providerInput.model !== undefined ? String(providerInput.model).trim() || base.model : base.model,
      cliCommand: providerInput.cliCommand !== undefined ? String(providerInput.cliCommand).trim() : base.cliCommand,
      cliArgs: providerInput.cliArgs !== undefined ? String(providerInput.cliArgs) : base.cliArgs,
      timeoutMs:
        providerInput.timeoutMs !== undefined && Number.isFinite(Number(providerInput.timeoutMs))
          ? Math.min(300000, Math.max(3000, Number(providerInput.timeoutMs)))
          : base.timeoutMs
    };

    this.data.providers.push(created);
    if (providerInput.setActive === true) {
      this.data.settings.activeProviderId = created.id;
    }
    this.save();
    return {
      ...created,
      hasApiKey: Boolean(created.apiKey && created.apiKey.trim()),
      apiKeyMasked: maskSecret(created.apiKey),
      apiKey: ''
    };
  }

  deleteProvider(providerId) {
    if (!providerId) {
      throw new Error('模型卡片 ID 不能为空');
    }
    if (providerId === 'mock-demo') {
      throw new Error('内置演示引擎（mock-demo）不可删除');
    }
    const existing = this.data.providers.find((p) => p.id === providerId);
    if (!existing) {
      return false;
    }
    this.data.providers = this.data.providers.filter((p) => p.id !== providerId);
    if (!Array.isArray(this.data.deletedProviderIds)) {
      this.data.deletedProviderIds = [];
    }
    if ((!existing.custom || existing.autoDiscovered) && !this.data.deletedProviderIds.includes(providerId)) {
      this.data.deletedProviderIds.push(providerId);
    }

    // 若删除了当前默认引擎，自动回退到 mock-demo
    if (this.data.settings.activeProviderId === providerId) {
      this.data.settings.activeProviderId = 'mock-demo';
    }

    // 自动清理引用该引擎的 agent 的 providerId
    for (const agent of this.data.agents) {
      if (agent.providerId === providerId) {
        agent.providerId = '';
      }
    }

    this.save();
    return true;
  }

  /**
   * 将自动发现的本机 AI 工具与本地大模型服务按稳定 ID 无损去重接入。
   * - 绝不覆盖用户手动修改过的卡片（userModified === true）
   * - 绝不复活用户显式删除过的卡片（除非 restoreDeleted === true）
   * - agy 复用已有 agy-* 卡片不重复创建
   * - 若当前默认引擎仍为 mock-demo 且 autoSwitchDefault 为 true，则按优先级自动切为首个可用本机 AI
   */
  applyDiscoveredProviders(foundList = [], options = {}) {
    const { autoSwitchDefault = true, restoreDeleted = false } = options;
    if (!Array.isArray(this.data.deletedProviderIds)) {
      this.data.deletedProviderIds = [];
    }

    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const connectedIds = [];

    for (const item of foundList) {
      if (!item || !item.id || !item.providerTemplate) continue;
      const tpl = item.providerTemplate;
      const stableId = item.id;

      // agy 复用已有 agy-* 卡片，不重复创建
      if (item.key === 'agy' || tpl.type === 'agy') {
        const existingAgy = this.data.providers.find((p) => p.type === 'agy');
        if (existingAgy) {
          connectedIds.push(existingAgy.id);
          skippedCount += 1;
          continue;
        }
      }

      const wasDeleted = this.data.deletedProviderIds.includes(stableId);
      if (wasDeleted) {
        if (!restoreDeleted) {
          skippedCount += 1;
          continue;
        }
        this.data.deletedProviderIds = this.data.deletedProviderIds.filter((id) => id !== stableId);
      }

      const existingIdx = this.data.providers.findIndex((p) => p.id === stableId);
      if (existingIdx >= 0) {
        const existing = this.data.providers[existingIdx];
        connectedIds.push(existing.id);
        if (existing.userModified) {
          skippedCount += 1;
          continue;
        }
        this.data.providers[existingIdx] = {
          ...existing,
          baseUrl: tpl.baseUrl !== undefined ? tpl.baseUrl : existing.baseUrl,
          model: tpl.model !== undefined ? tpl.model : existing.model,
          cliCommand: tpl.cliCommand !== undefined ? tpl.cliCommand : existing.cliCommand,
          cliArgs: tpl.cliArgs !== undefined ? tpl.cliArgs : existing.cliArgs,
          description: tpl.description || existing.description,
          descriptionEn: tpl.descriptionEn || existing.descriptionEn
        };
        updatedCount += 1;
      } else {
        const created = {
          id: stableId,
          type: tpl.type,
          builtin: false,
          custom: true,
          autoDiscovered: true,
          userModified: false,
          name: tpl.name || item.name,
          nameEn: tpl.nameEn || item.nameEn || tpl.name || item.name,
          description: tpl.description || '',
          descriptionEn: tpl.descriptionEn || tpl.description || '',
          enabled: false,
          baseUrl: tpl.baseUrl || '',
          apiKey: tpl.apiKey || '',
          model: tpl.model || '',
          cliCommand: tpl.cliCommand || '',
          cliArgs: tpl.cliArgs || '',
          timeoutMs: tpl.timeoutMs || 60000
        };
        this.data.providers.push(created);
        connectedIds.push(created.id);
        addedCount += 1;
      }
    }

    let switchedToProviderId = null;
    if (
      autoSwitchDefault &&
      this.data.settings.activeProviderId === 'mock-demo' &&
      connectedIds.length > 0
    ) {
      this.data.settings.activeProviderId = connectedIds[0];
      switchedToProviderId = connectedIds[0];
    }

    if (addedCount > 0 || updatedCount > 0 || switchedToProviderId) {
      this.save();
    }

    return {
      addedCount,
      updatedCount,
      skippedCount,
      switchedToProviderId,
      connectedIds
    };
  }

  listRooms() {
    return this.data.rooms.map((r) => {
      const msgs = this.data.messages[r.id] || [];
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      return {
        ...r,
        lastMessage: last
          ? {
              senderName: last.senderName,
              content: last.content.slice(0, 80),
              createdAt: last.createdAt
            }
          : null,
        messageCount: msgs.length
      };
    });
  }

  getRoom(roomId) {
    const found = this.data.rooms.find((r) => r.id === roomId);
    return found ? { ...found } : null;
  }

  createRoom({ name, memberIds }) {
    if (!name || !name.trim()) {
      throw new Error('群聊名称不能为空');
    }
    const validIds = (Array.isArray(memberIds) ? memberIds : []).filter((id) =>
      this.data.agents.some((a) => a.id === id)
    );
    const finalMembers = validIds.length > 0 ? validIds : this.data.agents.map((a) => a.id);
    const now = new Date().toISOString();
    const room = {
      id: createId('room'),
      type: 'group',
      name: name.trim(),
      nameEn: name.trim(),
      memberIds: finalMembers,
      createdAt: now,
      updatedAt: now
    };
    this.data.rooms.unshift(room);
    this.data.messages[room.id] = [
      {
        id: createId('msg'),
        roomId: room.id,
        senderType: 'system',
        senderId: 'system',
        senderName: '系统',
        content: `已创建项目群聊「${room.name}」，成员已就绪。发送任务即可启动多 AI 协作！`,
        createdAt: now,
        meta: { kind: 'info' }
      }
    ];
    this.save();
    return { ...room };
  }

  getMessages(roomId) {
    const list = this.data.messages[roomId] || [];
    return list.map((m) => ({ ...m }));
  }

  appendMessage(roomId, msgInput) {
    if (!this.data.messages[roomId]) {
      this.data.messages[roomId] = [];
    }
    const msg = {
      id: msgInput.id || createId('msg'),
      roomId,
      senderType: msgInput.senderType || 'user',
      senderId: msgInput.senderId || 'user',
      senderName: msgInput.senderName || '我',
      senderTitle: msgInput.senderTitle || '',
      senderColor: msgInput.senderColor || '',
      avatarText: msgInput.avatarText || '',
      content: String(msgInput.content || ''),
      createdAt: msgInput.createdAt || new Date().toISOString(),
      meta: msgInput.meta || {}
    };
    this.data.messages[roomId].push(msg);
    const room = this.data.rooms.find((r) => r.id === roomId);
    if (room) {
      room.updatedAt = msg.createdAt;
    }
    this.save();
    return { ...msg };
  }

  clearRoomMessages(roomId) {
    this.data.messages[roomId] = [];
    this.save();
  }

  deleteMessage(roomId, messageId) {
    const list = this.data.messages[roomId];
    if (!Array.isArray(list)) return false;
    const before = list.length;
    this.data.messages[roomId] = list.filter((m) => m.id !== messageId);
    if (this.data.messages[roomId].length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  listRoomTemplates() {
    return ROOM_TEMPLATES.map((tpl) => ({
      ...tpl,
      roles: tpl.roles.map((r) => ({ ...r }))
    }));
  }

  createRoomFromTemplate({ templateId, name, extraMemberIds = [] } = {}) {
    const tpl = ROOM_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) {
      throw new Error(`未找到场景模板: ${templateId}`);
    }
    const memberIds = [];
    for (const roleSpec of tpl.roles) {
      let agent = null;
      if (roleSpec.existingAgentId) {
        agent = this.data.agents.find((a) => a.id === roleSpec.existingAgentId);
      }
      if (!agent) {
        agent = this.data.agents.find((a) => a.name === roleSpec.name);
      }
      if (!agent) {
        agent = this.upsertAgent({
          name: roleSpec.name,
          nameEn: roleSpec.nameEn,
          title: roleSpec.title,
          titleEn: roleSpec.titleEn,
          roleType: roleSpec.roleType,
          avatarText: roleSpec.avatarText,
          color: roleSpec.color,
          systemPrompt: roleSpec.systemPrompt
        });
      }
      if (!memberIds.includes(agent.id)) {
        memberIds.push(agent.id);
      }
    }
    for (const extraId of Array.isArray(extraMemberIds) ? extraMemberIds : []) {
      if (this.data.agents.some((a) => a.id === extraId) && !memberIds.includes(extraId)) {
        memberIds.push(extraId);
      }
    }

    const roomName = (name && name.trim()) || tpl.name;
    const room = this.createRoom({ name: roomName, memberIds });
    // 同步写入英文模板名
    const storedRoom = this.data.rooms.find((r) => r.id === room.id);
    if (storedRoom && (!name || !name.trim())) {
      storedRoom.nameEn = tpl.nameEn;
      this.save();
    }
    return {
      room: { ...room, nameEn: storedRoom ? storedRoom.nameEn : room.name },
      template: tpl
    };
  }

  formatRoomMarkdownExport(roomId) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`未找到会话房间: ${roomId}`);
    }
    const agentsMap = new Map(this.data.agents.map((a) => [a.id, a]));
    const members = (room.memberIds || []).map((id) => agentsMap.get(id)).filter(Boolean);
    const messages = this.getMessages(roomId);
    const exportedAt = new Date().toLocaleString('zh-CN', { hour12: false });

    const lines = [
      `# AgentRoom 协作决策纪要：${room.name}`,
      '',
      `> 导出时间：${exportedAt}  `,
      `> 会话类型：${room.type === 'group' ? '多 AI 项目群聊' : 'AI 员工私聊'}  `,
      `> 消息总数：${messages.length} 条`,
      '',
      '## 参与协作者',
      '',
      '| 角色 | 头衔 | 角色定位 |',
      '| :--- | :--- | :--- |',
      ...members.map((m) => `| **${m.name}** | ${m.title} | ${m.roleType || 'custom'} |`),
      '',
      '## 协作讨论时间线',
      ''
    ];

    for (const msg of messages) {
      const timeStr = msg.createdAt
        ? new Date(msg.createdAt).toLocaleString('zh-CN', { hour12: false })
        : '';
      const roleTag = msg.senderTitle ? `（${msg.senderTitle}）` : '';
      const roundTag = msg.meta && msg.meta.round ? ` · 第 ${msg.meta.round} 轮` : '';
      lines.push(`### ${msg.senderName}${roleTag}${roundTag}  \`${timeStr}\``);
      lines.push('');
      lines.push(msg.content || '');
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}

const ROOM_TEMPLATES = [
  {
    id: 'fullstack',
    name: '全栈研发团队',
    nameEn: 'Full-Stack Engineering Team',
    badge: '研发',
    badgeEn: 'DEV',
    description: '需求拆解 → 前端交互实现 → 后端架构与安全评审完整闭环。',
    descriptionEn: 'Planning, frontend implementation, and backend security review loop.',
    roles: [
      { existingAgentId: 'agent_george', name: '乔治', nameEn: 'George', title: '项目经理', titleEn: 'Project Manager', roleType: 'pm', avatarText: '乔', color: '#38BDF8' },
      { existingAgentId: 'agent_linxi', name: '林溪', nameEn: 'Linxi', title: '前端设计', titleEn: 'Frontend Designer', roleType: 'frontend', avatarText: '林', color: '#A855F7' },
      { existingAgentId: 'agent_chenmo', name: '陈默', nameEn: 'Chenmo', title: '后端工程', titleEn: 'Backend Engineer', roleType: 'backend', avatarText: '陈', color: '#2DD4BF' }
    ]
  },
  {
    id: 'research',
    name: '深度研报与论文组',
    nameEn: 'Deep Research & Paper Group',
    badge: '研报',
    badgeEn: 'RESEARCH',
    description: '首席研究员深挖论据、逻辑审校官核查严谨性、学术排版编辑成稿。',
    descriptionEn: 'Lead researcher, logic reviewer, and academic editor collaborating on rigorous reports.',
    roles: [
      {
        name: '苏研',
        nameEn: 'Suyan',
        title: '首席研究员',
        titleEn: 'Lead Researcher',
        roleType: 'pm',
        avatarText: '研',
        color: '#38BDF8',
        systemPrompt: '你是苏研，首席研究员。擅长拆解研究课题、提炼核心论点与结构化大纲，完成后请 @严审 核查逻辑严密性。'
      },
      {
        name: '严审',
        nameEn: 'Yanshen',
        title: '逻辑审校官',
        titleEn: 'Logic Reviewer',
        roleType: 'backend',
        avatarText: '审',
        color: '#F59E0B',
        systemPrompt: '你是严审，逻辑审校官。专门核查论证漏洞、数据一致性与推理严密性。若有重大逻辑缺陷输出 REVIEW_REJECT 并 @苏研；通过则输出 REVIEW_PASS 并 @文清 定稿。'
      },
      {
        name: '文清',
        nameEn: 'Wenqing',
        title: '学术排版编辑',
        titleEn: 'Academic Editor',
        roleType: 'frontend',
        avatarText: '编',
        color: '#10B981',
        systemPrompt: '你是文清，学术排版与润色编辑。负责将通过审校的观点整理为层次清晰、表达优雅的 Markdown 终稿，完成后输出 DONE。'
      }
    ]
  },
  {
    id: 'redblue',
    name: '产品方案红蓝对抗',
    nameEn: 'Product Red-Blue Debate',
    badge: '对抗',
    badgeEn: 'DEBATE',
    description: '产品总监提出方案、红军挑刺官极限施压找漏洞、核心用户代言人拍板体验。',
    descriptionEn: 'Product lead proposes, red-team critic stress-tests, and user advocate validates UX.',
    roles: [
      {
        name: '顾策',
        nameEn: 'Guce',
        title: '产品总监',
        titleEn: 'Product Director',
        roleType: 'pm',
        avatarText: '策',
        color: '#38BDF8',
        systemPrompt: '你是顾策，产品总监。负责提出清晰的产品价值主张、MVP 范围与商业闭环，主动 @红军 发起压力测试。'
      },
      {
        name: '红军',
        nameEn: 'RedTeam',
        title: '红军挑刺官',
        titleEn: 'Red-Team Critic',
        roleType: 'backend',
        avatarText: '红',
        color: '#EF4444',
        systemPrompt: '你是红军挑刺官。专门从最尖锐的视角寻找方案盲区、竞品反制与落地风险。若存在致命漏洞输出 REVIEW_REJECT 并 @顾策；若风险可控输出 REVIEW_PASS 并 @小禾 评估体验。'
      },
      {
        name: '小禾',
        nameEn: 'Xiaohe',
        title: '核心用户代言人',
        titleEn: 'User Advocate',
        roleType: 'frontend',
        avatarText: '户',
        color: '#10B981',
        systemPrompt: '你是小禾，真实高频用户代言人。只关心上手门槛、直觉体验与是否真正省时间，给出最终体验建议并标注 DONE。'
      }
    ]
  },
  {
    id: 'security',
    name: '代码安全审计组',
    nameEn: 'Code Security Audit Squad',
    badge: '安全',
    badgeEn: 'SEC',
    description: '安全架构师定威胁模型、渗透测试员挖越界/注入、修复工程师产出 Diff 补丁。',
    descriptionEn: 'Security architect, pentester, and remediation engineer producing Diff patches.',
    roles: [
      {
        name: '盾安',
        nameEn: 'Dunan',
        title: '安全架构师',
        titleEn: 'Security Architect',
        roleType: 'pm',
        avatarText: '盾',
        color: '#38BDF8',
        systemPrompt: '你是盾安，安全架构师。负责识别攻击面与信任边界，指派 @影测 进行渗透分析。'
      },
      {
        name: '影测',
        nameEn: 'Yingce',
        title: '渗透测试员',
        titleEn: 'Pentester',
        roleType: 'backend',
        avatarText: '测',
        color: '#F43F5E',
        systemPrompt: '你是影测，渗透测试员。专注检查路径穿越、命令注入、密钥泄漏与权限绕过。发现高危问题输出 REVIEW_REJECT 并 @修岩 给出修复补丁；无高危风险则输出 REVIEW_PASS 与 DONE。'
      },
      {
        name: '修岩',
        nameEn: 'Xiuyan',
        title: '修复工程师',
        titleEn: 'Remediation Engineer',
        roleType: 'frontend',
        avatarText: '修',
        color: '#10B981',
        systemPrompt: '你是修岩，安全修复工程师。负责输出最小侵入的安全加固代码（优先使用 ```file-edit:相对路径``` 协议提出变更），完成后 @影测 复验。'
      }
    ]
  }
];

module.exports = {
  LocalStore,
  createId,
  maskSecret,
  getDefaultAgents,
  getDefaultProviders,
  ROOM_TEMPLATES
};
