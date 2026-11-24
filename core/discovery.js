'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI_SPECS = [
  {
    key: 'agy',
    id: 'agy-gemini-neon',
    type: 'agy',
    name: 'Antigravity CLI (agy)',
    nameEn: 'Antigravity CLI (agy)',
    description: '本机已安装的 Antigravity CLI，零额外 API 费用流式直连。',
    descriptionEn: 'Locally installed Antigravity CLI with zero extra API cost.',
    cliArgs: '',
    model: 'gemini-4-neon-medium',
    timeoutMs: 90000,
    priority: 100
  },
  {
    key: 'claude',
    id: 'auto-claude',
    type: 'cli',
    name: 'Claude Code CLI',
    nameEn: 'Claude Code CLI',
    description: '自动检测到的本机 Claude Code 命令行工具。',
    descriptionEn: 'Auto-detected local Claude Code CLI.',
    cliArgs: '-p',
    model: 'claude-cli',
    timeoutMs: 90000,
    priority: 80
  },
  {
    key: 'codex',
    id: 'auto-codex',
    type: 'cli',
    name: 'OpenAI Codex CLI',
    nameEn: 'OpenAI Codex CLI',
    description: '自动检测到的本机 OpenAI Codex 命令行工具。',
    descriptionEn: 'Auto-detected local OpenAI Codex CLI.',
    cliArgs: '',
    model: 'codex-cli',
    timeoutMs: 90000,
    priority: 75
  },
  {
    key: 'opencode',
    id: 'auto-opencode',
    type: 'cli',
    name: 'OpenCode CLI',
    nameEn: 'OpenCode CLI',
    description: '自动检测到的本机 OpenCode 命令行工具。',
    descriptionEn: 'Auto-detected local OpenCode CLI.',
    cliArgs: '',
    model: 'opencode-cli',
    timeoutMs: 90000,
    priority: 70
  },
  {
    key: 'dsh',
    id: 'auto-dsh',
    type: 'cli',
    name: 'DeepSeek Harness (dsh)',
    nameEn: 'DeepSeek Harness (dsh)',
    description: '自动检测到的本机 DeepSeek Harness CLI（无头模式）。',
    descriptionEn: 'Auto-detected local DeepSeek Harness CLI (headless profile).',
    cliArgs: '--profile headless',
    model: 'dsh-cli',
    timeoutMs: 90000,
    priority: 65
  },
  {
    key: 'gemini',
    id: 'auto-gemini',
    type: 'cli',
    name: 'Gemini CLI',
    nameEn: 'Gemini CLI',
    description: '自动检测到的本机 Gemini 命令行工具。',
    descriptionEn: 'Auto-detected local Gemini CLI.',
    cliArgs: '-p',
    model: 'gemini-cli',
    timeoutMs: 90000,
    priority: 60
  },
  {
    key: 'aider',
    id: 'auto-aider',
    type: 'cli',
    name: 'Aider CLI',
    nameEn: 'Aider CLI',
    description: '自动检测到的本机 Aider AI 编程命令行工具。',
    descriptionEn: 'Auto-detected local Aider CLI.',
    cliArgs: '',
    model: 'aider-cli',
    timeoutMs: 90000,
    priority: 55
  }
];

function getDefaultSearchDirs(env = process.env) {
  const dirs = [];
  const seen = new Set();
  const addDir = (d) => {
    if (!d || typeof d !== 'string') return;
    const trimmed = d.trim().replace(/^"(.*)"$/, '$1');
    if (!trimmed) return;
    const key = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
    if (!seen.has(key)) {
      seen.add(key);
      dirs.push(trimmed);
    }
  };

  const pathEnv = env.PATH || env.Path || '';
  for (const part of pathEnv.split(path.delimiter)) {
    addDir(part);
  }

  // Windows 常见标准 AI CLI 安装目录
  if (env.APPDATA) {
    addDir(path.join(env.APPDATA, 'npm'));
  }
  if (env.LOCALAPPDATA) {
    addDir(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
    addDir(path.join(env.LOCALAPPDATA, 'Programs', 'antigravity-cli'));
    addDir(path.join(env.LOCALAPPDATA, 'pnpm'));
  }
  const home = env.USERPROFILE || env.HOME || os.homedir();
  if (home) {
    addDir(path.join(home, '.local', 'bin'));
    addDir(path.join(home, '.cargo', 'bin'));
  }

  return dirs;
}

function isFileSafe(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

/**
 * 在给定搜索目录中查找命令行工具。
 * Windows 下严格保证 .exe / .cmd / .bat 优先于 .ps1，避免 spawn 拉 .ps1 报 ENOENT；
 * 若仅存在 .ps1，则自动包装为 powershell.exe -File <ps1Path>。
 */
function resolveCliBinary(cmdName, searchDirs, platform = process.platform) {
  const dirs = Array.isArray(searchDirs) ? searchDirs : getDefaultSearchDirs();
  if (platform !== 'win32') {
    for (const dir of dirs) {
      const candidate = path.join(dir, cmdName);
      if (isFileSafe(candidate)) {
        return {
          command: candidate,
          extraArgs: '',
          resolvedPath: candidate,
          ext: ''
        };
      }
    }
    return null;
  }

  // 优先级 1：.exe -> .cmd -> .bat（跨目录优先找到原生可执行或 cmd 包装）
  const primaryExts = ['.exe', '.cmd', '.bat'];
  for (const dir of dirs) {
    for (const ext of primaryExts) {
      const candidate = path.join(dir, `${cmdName}${ext}`);
      if (isFileSafe(candidate)) {
        return {
          command: candidate,
          extraArgs: '',
          resolvedPath: candidate,
          ext
        };
      }
    }
  }

  // 优先级 2：兜底检测 .ps1（若有同名 .cmd 已在上面命中；仅剩 .ps1 时用 powershell 包装）
  for (const dir of dirs) {
    const ps1Candidate = path.join(dir, `${cmdName}.ps1`);
    if (isFileSafe(ps1Candidate)) {
      return {
        command: 'powershell.exe',
        extraArgs: `-NoProfile -ExecutionPolicy Bypass -File "${ps1Candidate}"`,
        resolvedPath: ps1Candidate,
        ext: '.ps1'
      };
    }
  }

  return null;
}

async function fetchJsonWithTimeout(url, timeoutMs = 600, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal
    });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeOllama(timeoutMs = 600, fetchImpl = global.fetch) {
  const data = await fetchJsonWithTimeout('http://127.0.0.1:11434/api/tags', timeoutMs, fetchImpl);
  if (!data || !Array.isArray(data.models)) return null;
  const models = data.models
    .map((m) => (m && (m.name || m.model) ? String(m.name || m.model).trim() : ''))
    .filter(Boolean);
  const firstModel = models[0] || 'llama3';
  return {
    id: 'auto-ollama',
    key: 'ollama',
    name: 'Ollama 本地大模型',
    nameEn: 'Ollama Local LLM',
    type: 'openai',
    sourceKind: 'service',
    location: 'http://127.0.0.1:11434',
    priority: 90,
    models,
    providerTemplate: {
      id: 'auto-ollama',
      type: 'openai',
      name: 'Ollama 本地服务',
      nameEn: 'Ollama Local Server',
      description: `自动检测到的本机 Ollama 服务（已就绪 ${models.length} 个模型）。`,
      descriptionEn: `Auto-detected local Ollama server (${models.length} model(s) ready).`,
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: 'ollama',
      model: firstModel,
      timeoutMs: 60000,
      autoDiscovered: true
    }
  };
}

async function probeLmStudio(timeoutMs = 600, fetchImpl = global.fetch) {
  const data = await fetchJsonWithTimeout('http://127.0.0.1:1234/v1/models', timeoutMs, fetchImpl);
  if (!data || !Array.isArray(data.data)) return null;
  const models = data.data
    .map((m) => (m && m.id ? String(m.id).trim() : ''))
    .filter(Boolean);
  const firstModel = models[0] || 'local-model';
  return {
    id: 'auto-lmstudio',
    key: 'lmstudio',
    name: 'LM Studio 本地服务',
    nameEn: 'LM Studio Local Server',
    type: 'openai',
    sourceKind: 'service',
    location: 'http://127.0.0.1:1234',
    priority: 88,
    models,
    providerTemplate: {
      id: 'auto-lmstudio',
      type: 'openai',
      name: 'LM Studio 本地服务',
      nameEn: 'LM Studio Local Server',
      description: `自动检测到的本机 LM Studio 服务（${models.length} 个模型）。`,
      descriptionEn: `Auto-detected local LM Studio server (${models.length} model(s)).`,
      baseUrl: 'http://127.0.0.1:1234/v1',
      apiKey: 'lm-studio',
      model: firstModel,
      timeoutMs: 60000,
      autoDiscovered: true
    }
  };
}

/**
 * 跨电脑自动检测本机已安装的 AI CLI 工具与运行中的本地大模型服务。
 * @param {Object} [options]
 * @param {string[]} [options.searchDirs] 可选自定义搜索目录（便于测试）
 * @param {string} [options.platform] 可选平台覆盖（便于测试）
 * @param {number} [options.httpTimeoutMs] 单个本地 HTTP 探测超时（默认 600ms）
 * @param {boolean} [options.skipHttp] 是否跳过 HTTP 探测（便于纯 CLI 单元测试）
 * @param {Function} [options.fetchImpl] 可选自定义 fetch（便于测试）
 */
async function discoverLocalAIs(options = {}) {
  const startedAt = Date.now();
  const searchDirs = options.searchDirs || getDefaultSearchDirs();
  const platform = options.platform || process.platform;
  const httpTimeoutMs = Number(options.httpTimeoutMs) || 600;
  const fetchImpl = options.fetchImpl || global.fetch;

  const found = [];

  // A. 本机 CLI AI 工具探测（纯文件系统扫描，毫秒级）
  for (const spec of CLI_SPECS) {
    const resolved = resolveCliBinary(spec.key, searchDirs, platform);
    if (!resolved) continue;

    const combinedArgs = [resolved.extraArgs, spec.cliArgs].filter(Boolean).join(' ').trim();
    const providerTemplate =
      spec.type === 'agy'
        ? {
            id: spec.id,
            type: 'agy',
            name: 'Antigravity · Gemini 4 Neon',
            nameEn: 'Antigravity · Gemini 4 Neon',
            description: spec.description,
            descriptionEn: spec.descriptionEn,
            model: spec.model,
            timeoutMs: spec.timeoutMs,
            autoDiscovered: true
          }
        : {
            id: spec.id,
            type: 'cli',
            name: spec.name,
            nameEn: spec.nameEn,
            description: spec.description,
            descriptionEn: spec.descriptionEn,
            model: spec.model,
            cliCommand: resolved.command,
            cliArgs: combinedArgs,
            timeoutMs: spec.timeoutMs,
            autoDiscovered: true
          };

    found.push({
      id: spec.id,
      key: spec.key,
      name: spec.name,
      nameEn: spec.nameEn,
      type: spec.type,
      sourceKind: 'cli',
      location: resolved.resolvedPath,
      priority: spec.priority,
      models: spec.model ? [spec.model] : [],
      providerTemplate
    });
  }

  // B. 本机大模型 HTTP 服务并发探测（Ollama / LM Studio，单个超时 600ms）
  if (!options.skipHttp) {
    const [ollama, lmstudio] = await Promise.all([
      probeOllama(httpTimeoutMs, fetchImpl),
      probeLmStudio(httpTimeoutMs, fetchImpl)
    ]);
    if (ollama) found.push(ollama);
    if (lmstudio) found.push(lmstudio);
  }

  found.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  return {
    found,
    elapsedMs: Date.now() - startedAt
  };
}

module.exports = {
  discoverLocalAIs,
  resolveCliBinary,
  getDefaultSearchDirs,
  probeOllama,
  probeLmStudio,
  CLI_SPECS
};
