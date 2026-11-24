'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const DEFAULT_AGY_MODELS = [
  { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
  { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
  { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' }
];

function findAgyExecutable() {
  if (process.env.AGY_PATH && fs.existsSync(process.env.AGY_PATH)) {
    return process.env.AGY_PATH;
  }

  // 1. 优先检查 PATH 中的 agy
  const pathEnv = process.env.PATH || process.env.Path || '';
  const pathDirs = pathEnv.split(path.delimiter).filter(Boolean);
  const exeNames = process.platform === 'win32' ? ['agy.exe', 'agy.EXE', 'agy.cmd', 'agy'] : ['agy'];
  for (const dir of pathDirs) {
    for (const name of exeNames) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          return 'agy';
        }
      } catch (_) {
        // ignore
      }
    }
  }

  // 2. 自动探测 Windows 常见安装路径
  const localAppData = process.env.LOCALAPPDATA || '';
  if (localAppData) {
    const candidates = [
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'agy.exe'),
      path.join(localAppData, 'Programs', 'antigravity-cli', 'agy.exe')
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch (_) {
        // ignore
      }
    }
  }

  return null;
}

function parseAgyModelsOutput(stdout) {
  const models = [];
  const seen = new Set();
  const lines = String(stdout || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(fetching|error:|available|usage|please sign in)/i.test(line)) continue;
    let id = '';
    let label = '';
    if (line.includes('\t')) {
      const parts = line.split('\t').map((s) => s.trim()).filter(Boolean);
      id = parts[0] || '';
      label = parts.slice(1).join(' ') || id;
    } else {
      const parts = line.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 1 && /^[a-zA-Z0-9._-]+$/.test(parts[0])) {
        id = parts[0];
        label = parts.slice(1).join(' ') || id;
      }
    }
    if (id && !seen.has(id) && /^[a-zA-Z0-9._-]+$/.test(id)) {
      seen.add(id);
      models.push({ id, label });
    }
  }
  return models;
}

function listAgyModels(agyBinOverride = null) {
  return new Promise((resolve) => {
    const agyBin = agyBinOverride || findAgyExecutable();
    if (!agyBin) {
      return resolve({
        models: DEFAULT_AGY_MODELS.map((m) => ({ ...m })),
        source: 'fallback',
        warning: '未在本机检测到 agy.exe，已回退到内置常用模型列表'
      });
    }

    execFile(
      agyBin,
      ['models'],
      {
        timeout: 15000,
        windowsHide: true,
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8'
        }
      },
      (err, stdout, stderr) => {
        if (!err && stdout) {
          const parsed = parseAgyModelsOutput(stdout);
          if (parsed.length > 0) {
            return resolve({ models: parsed, source: 'cli', warning: '' });
          }
        }
        const detail = (stderr || stdout || (err && err.message) || '').trim().slice(0, 180);
        resolve({
          models: DEFAULT_AGY_MODELS.map((m) => ({ ...m })),
          source: 'fallback',
          warning: detail || '无法从 agy models 获取列表，已回退到常用模型'
        });
      }
    );
  });
}

function parseAgyStreamLine(rawLine) {
  const line = String(rawLine || '').trim();
  if (!line || !line.startsWith('{')) return null;
  let evt;
  try {
    evt = JSON.parse(line);
  } catch (_) {
    return null;
  }
  if (!evt || typeof evt !== 'object') return null;

  if (
    evt.event === 'step_update' &&
    evt.step_update &&
    typeof evt.step_update.text_delta === 'string' &&
    evt.step_update.text_delta.length > 0
  ) {
    return { type: 'delta', text: evt.step_update.text_delta };
  }

  if (evt.result && typeof evt.result.response === 'string') {
    return { type: 'result', text: evt.result.response };
  }

  if (evt.event === 'error' || evt.error) {
    const msg =
      typeof evt.error === 'string'
        ? evt.error
        : (evt.error && evt.error.message) || evt.message || 'agy 返回错误';
    return { type: 'error', error: msg };
  }

  return null;
}

function splitCommandArgs(argString) {
  if (!argString || typeof argString !== 'string') return [];
  const args = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < argString.length; i += 1) {
    const ch = argString[i];
    if (quote) {
      if (ch === '\\' && i + 1 < argString.length && argString[i + 1] === quote) {
        current += quote;
        i += 1;
      } else if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    args.push(current);
  }
  return args;
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {
        resolve();
      });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (_) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (__) {
          // ignore
        }
      }
      resolve();
    }
  });
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      return reject(createAbortError());
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(createAbortError());
    }
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function createAbortError() {
  const err = new Error('任务已被用户中止');
  err.name = 'AbortError';
  err.code = 'ABORTED';
  return err;
}

class AgentRunner {
  constructor(options = {}) {
    this.fastMock = Boolean(options.fastMock);
  }

  /**
   * 统一执行入口
   * @param {Object} params
   * @param {Object} params.agent 当前发言角色
   * @param {Object} params.provider 模型提供商配置（含原始 apiKey）
   * @param {Array<{role: string, content: string}>} params.messages 上下文消息
   * @param {Object} [params.context] 额外调度上下文（round, reviewRejectCount, taskText, fileContexts, isGroup, language）
   * @param {AbortSignal} [params.signal]
   * @param {(chunk: string) => void} [params.onToken]
   * @returns {Promise<{ text: string, providerType: string }>}
   */
  async run({ agent, provider, messages, context = {}, signal, onToken }) {
    if (signal && signal.aborted) {
      throw createAbortError();
    }
    const activeProvider = provider || { type: 'mock', id: 'mock-demo' };
    switch (activeProvider.type) {
      case 'agy':
        return this.runAgy({ agent, provider: activeProvider, messages, context, signal, onToken });
      case 'openai':
        return this.runOpenAI({ agent, provider: activeProvider, messages, signal, onToken });
      case 'cli':
        return this.runCli({ agent, provider: activeProvider, messages, signal, onToken });
      case 'mock':
      default:
        return this.runMock({ agent, context, signal, onToken });
    }
  }

  async runMock({ agent, context = {}, signal, onToken }) {
    const text = this._buildMockReply(agent, context);
    if (this.fastMock) {
      if (onToken) onToken(text);
      return { text, providerType: 'mock' };
    }

    // 模拟自然流式输出（按短片段推送，支持随时中断）
    const chunkSize = 10;
    for (let i = 0; i < text.length; i += chunkSize) {
      if (signal && signal.aborted) {
        throw createAbortError();
      }
      const chunk = text.slice(i, i + chunkSize);
      if (onToken) onToken(chunk);
      await sleep(18, signal);
    }
    return { text, providerType: 'mock' };
  }

  _buildMockReply(agent, context) {
    const taskText = String(context.taskText || '').trim();
    const round = context.round || 1;
    const isGroup = context.isGroup !== false;
    const reviewRejectCount = context.reviewRejectCount || 0;
    const fileContexts = Array.isArray(context.fileContexts) ? context.fileContexts : [];
    const roleType = agent.roleType || 'custom';
    const isReviewDrill = /评审测试|熔断|打回|reject|breaker/i.test(taskText);
    const isFileEditDemo = /改代码|diff|演示文件修改|修改文件|file-edit/i.test(taskText);

    const fileNote =
      fileContexts.length > 0
        ? `\n\n> 已读取真实沙箱文件上下文：${fileContexts.map((f) => `\`${f.name}\``).join('、')}`
        : '';

    if (isFileEditDemo && (roleType === 'frontend' || roleType === 'backend' || !isGroup)) {
      const targetFile =
        fileContexts.length > 0 ? fileContexts[0].name : 'agentroom-demo.md';
      return (
        `我已整理好文件变更补丁，请在下方红绿 Diff 审批卡中确认后一键应用到安全沙箱（支持随时一键撤销回滚）：\n\n` +
        `\`\`\`file-edit:${targetFile}\n` +
        `# AgentRoom 协作变更演示\n\n` +
        `- 生成角色：${agent.name}（${agent.title}）\n` +
        `- 变更摘要：补齐输入边界校验与安全落盘说明\n` +
        `- 状态：已通过沙箱安全检查\n` +
        `\`\`\`\n\n` +
        `变更提案已就绪，请审阅并点击「一键应用到沙箱」。DONE` +
        fileNote
      );
    }

    if (!isGroup) {
      return (
        `收到！我是 **${agent.name}**（${agent.title}）。针对你的需求「${taskText.slice(0, 60)}」，我整理了以下建议：\n\n` +
        `1. **核心目标确认**：优先跑通最小可用闭环，保持代码清晰可验证。\n` +
        `2. **执行建议**：可直接授权本地项目文件夹，我会结合真实文件内容协助落地。` +
        fileNote +
        `\n\nDONE`
      );
    }

    // 群聊模式：如果用户要求“评审测试 / 熔断”演示，触发 2 次打回 → 第 3 次强制熔断
    if (isReviewDrill) {
      if (roleType === 'backend') {
        const nextReject = reviewRejectCount + 1;
        return (
          `[质量评审第 ${nextReject} 次]\n` +
          `我对当前方案进行了边界与安全审查，发现仍有关键项未满足验收标准（第 ${nextReject} 次打回）：\n` +
          `- 缺少异常回滚与输入边界校验；\n` +
          `- 请 @林溪 补充防御性校验后重新提交评审。` +
          fileNote +
          `\n\nREVIEW_REJECT`
        );
      }
      if (roleType === 'frontend') {
        return (
          `收到反馈，我已根据评审意见更新了第 ${round} 版交互与校验逻辑：\n\n` +
          `\`\`\`js\nfunction validatePayload(input) {\n  if (!input || !input.trim()) throw new Error('Invalid input');\n  return input.trim();\n}\n\`\`\`\n\n` +
          `请 @陈默 再次复审此版本。` +
          fileNote
        );
      }
      return (
        `我已收到任务「${taskText.slice(0, 50)}」，启动严格评审演练流程：\n` +
        `1. @林溪 产出初版实现方案；\n` +
        `2. @陈默 进行严格代码评审（触发防死循环打回熔断保护）。\n\n` +
        `请 @陈默 先进行首轮评审检查。` +
        fileNote
      );
    }

    // 常规多角色协作闭环：乔治(PM) -> 林溪(前端) -> 陈默(后端评审通过 DONE)
    if (roleType === 'pm') {
      if (round === 1) {
        return (
          `收到任务！我已将「${taskText.slice(0, 60)}」拆解为三个清晰步骤：\n\n` +
          `1. **交互与界面**：由 @林溪 设计结构与视觉方案；\n` +
          `2. **工程与安全评审**：由 @陈默 审查边界条件、数据结构与可靠性；\n` +
          `3. **汇总验收**：我来整合交付清单。\n\n` +
          `请 @林溪 先给出设计与前端实现方案。` +
          fileNote
        );
      }
      return (
        `各位的方案与评审均已到位！我汇总最终交付结论：\n` +
        `- 前端交互方案与视觉结构已定稿；\n` +
        `- 后端安全边界与验收项已全部通过。\n\n` +
        `本轮协作已完成。DONE`
      );
    }

    if (roleType === 'frontend') {
      return (
        `收到 @乔治 的拆解，我已完成交互与 UI 结构设计：\n\n` +
        `- 采用**高对比度双栏工作区**，支持深/浅色 CSS 变量无缝切换；\n` +
        `- 关键操作增加即时状态反馈与键盘快捷键支持。\n\n` +
        `\`\`\`css\n.action-card {\n  border-radius: 12px;\n  border: 1px solid var(--border);\n  background: var(--surface-elevated);\n}\n\`\`\`\n\n` +
        `请 @陈默 评审接口契约与安全边界。` +
        fileNote
      );
    }

    if (roleType === 'backend') {
      return (
        `我已复核 @林溪 的实现方案与工程边界：\n\n` +
        `- **安全校验**：所有路径均经过沙箱边界校验，无越界风险；\n` +
        `- **稳定性**：异常分支与超时保护均已覆盖。\n\n` +
        `REVIEW_PASS — 质量评审通过，方案可直接落地！DONE` +
        fileNote
      );
    }

    return (
      `我是 **${agent.name}**（${agent.title}），已围绕「${taskText.slice(0, 50)}」补充了专业建议。` +
      fileNote +
      `\n\n请 @乔治 统筹下一步安排。`
    );
  }

  async runOpenAI({ provider, messages, signal, onToken }) {
    const baseUrl = (provider.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) {
      throw new Error('OpenAI 兼容 API 的 BaseURL 不能为空');
    }
    if (!provider.apiKey || !provider.apiKey.trim()) {
      throw new Error(`模型卡片「${provider.name}」尚未配置 API Key，请在模型设置中填写`);
    }
    const model = provider.model || 'deepseek-chat';
    const endpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`;

    const timeoutMs = Number(provider.timeoutMs) || 60000;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

    const combinedController = new AbortController();
    const onExternalAbort = () => combinedController.abort();
    const onTimeoutAbort = () => combinedController.abort();

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        throw createAbortError();
      }
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    timeoutController.signal.addEventListener('abort', onTimeoutAbort, { once: true });

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey.trim()}`
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          temperature: 0.7
        }),
        signal: combinedController.signal
      });

      if (!response.ok) {
        let errDetail = '';
        try {
          errDetail = await response.text();
        } catch (_) {
          // ignore
        }
        throw new Error(`API 请求失败 (${response.status}): ${errDetail.slice(0, 260)}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream') || !response.body) {
        const json = await response.json();
        const text =
          (json &&
            json.choices &&
            json.choices[0] &&
            json.choices[0].message &&
            json.choices[0].message.content) ||
          '';
        if (onToken && text) onToken(text);
        return { text, providerType: 'openai' };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || !line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const delta =
              parsed &&
              parsed.choices &&
              parsed.choices[0] &&
              parsed.choices[0].delta &&
              parsed.choices[0].delta.content;
            if (typeof delta === 'string' && delta.length > 0) {
              fullText += delta;
              if (onToken) onToken(delta);
            }
          } catch (_) {
            // 忽略非标准心跳分片
          }
        }
      }

      return { text: fullText, providerType: 'openai' };
    } catch (err) {
      if (signal && signal.aborted) {
        throw createAbortError();
      }
      if (timeoutController.signal.aborted) {
        throw new Error(`API 请求超时 (${timeoutMs}ms)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
      timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
    }
  }

  async runCli({ provider, messages, signal, onToken }) {
    const command = (provider.cliCommand || '').trim();
    if (!command) {
      throw new Error('本地 CLI 适配器尚未配置命令（cliCommand）');
    }
    const args = splitCommandArgs(provider.cliArgs || '');
    const timeoutMs = Number(provider.timeoutMs) || 30000;

    // 将上下文消息组装为清晰 UTF-8 提示词通过 stdin 传入
    const promptText = messages
      .map((m) => `[${m.role.toUpperCase()}]\n${m.content}`)
      .join('\n\n---\n\n');

    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        return reject(createAbortError());
      }

      let settled = false;
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: needsShell,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8'
        }
      });

      const finish = (err, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(result);
      };

      const onAbort = async () => {
        await killProcessTree(child.pid);
        finish(createAbortError());
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const timer = setTimeout(async () => {
        timedOut = true;
        await killProcessTree(child.pid);
        const err = new Error(`本地 CLI 执行超时 (${timeoutMs}ms)，已清理子进程树`);
        err.code = 'CLI_TIMEOUT';
        finish(err);
      }, timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (onToken) onToken(chunk);
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      child.on('error', (err) => {
        finish(new Error(`启动本地 CLI 失败 (${command}): ${err.message}`));
      });

      child.on('close', (code) => {
        if (settled || timedOut) return;
        if (code !== 0) {
          finish(
            new Error(
              `本地 CLI 异常退出 (code=${code})${stderr ? `: ${stderr.trim().slice(0, 260)}` : ''}`
            )
          );
          return;
        }
        finish(null, { text: stdout.trim(), providerType: 'cli' });
      });

      try {
        child.stdin.write(promptText, 'utf8');
        child.stdin.end();
      } catch (_) {
        // 某些 CLI 可能不读取 stdin 并提前关闭，忽略 EPIPE
      }
    });
  }

  async runAgy({ provider, messages, context = {}, signal, onToken }) {
    const agyBin = (provider && provider.agyBin) || findAgyExecutable();
    if (!agyBin) {
      throw new Error(
        '未在本机检测到 agy.exe，请先安装并登录 Antigravity CLI（agy）'
      );
    }

    const model = (provider && provider.model && provider.model.trim()) || 'gemini-4-neon-medium';
    const timeoutMs = Number(provider && provider.timeoutMs) || 90000;
    const safeCwd =
      context && context.safeCwd && fs.existsSync(context.safeCwd)
        ? context.safeCwd
        : os.tmpdir();

    const promptText = (messages || [])
      .map((m) => (m.role === 'user' ? m.content : `[${String(m.role || 'system').toUpperCase()}]\n${m.content}`))
      .join('\n\n---\n\n');

    // 不传 --dangerously-skip-permissions，不加载任何特定人设，保持普通工具身份
    const args = ['--model', model, '-p', promptText, '--output-format', 'stream-json'];

    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        return reject(createAbortError());
      }

      let settled = false;
      let buffer = '';
      let deltaText = '';
      let fallbackResponse = '';
      let streamError = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(agyBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        cwd: safeCwd,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8'
        }
      });

      const finish = (err, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(result);
      };

      const onAbort = async () => {
        await killProcessTree(child.pid);
        finish(createAbortError());
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const timer = setTimeout(async () => {
        timedOut = true;
        await killProcessTree(child.pid);
        const err = new Error(`agy 执行超时 (${timeoutMs}ms)，已清理子进程树`);
        err.code = 'AGY_TIMEOUT';
        finish(err);
      }, timeoutMs);

      const handleLine = (line) => {
        const parsed = parseAgyStreamLine(line);
        if (!parsed) return;
        if (parsed.type === 'delta') {
          deltaText += parsed.text;
          if (onToken) onToken(parsed.text);
        } else if (parsed.type === 'result') {
          fallbackResponse = parsed.text;
        } else if (parsed.type === 'error') {
          streamError = parsed.error;
        }
      };

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          handleLine(line);
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      child.on('error', (err) => {
        finish(new Error(`启动 agy.exe 失败 (${agyBin}): ${err.message}`));
      });

      child.on('close', (code) => {
        if (settled || timedOut) return;
        if (buffer.trim()) {
          handleLine(buffer);
        }
        if (code !== 0) {
          const reason = (streamError || stderr || buffer || '').trim().slice(0, 260);
          finish(new Error(`agy 执行失败 (code=${code})${reason ? `: ${reason}` : ''}`));
          return;
        }
        if (streamError && !deltaText && !fallbackResponse) {
          finish(new Error(`agy 返回错误: ${streamError}`));
          return;
        }
        let finalText = deltaText;
        if (!finalText && fallbackResponse) {
          finalText = fallbackResponse;
          if (onToken) onToken(finalText);
        }
        finish(null, { text: finalText.trim(), providerType: 'agy' });
      });
    });
  }

  async testProvider(provider, options = {}) {
    const startedAt = Date.now();
    try {
      const defaultTimeout = provider && provider.type === 'agy' ? 90000 : 30000;
      const target = {
        ...(provider || { type: 'mock' }),
        timeoutMs: Number(provider && provider.timeoutMs) || defaultTimeout
      };
      const res = await this.run({
        agent: { id: 'probe', name: 'Probe', title: 'Probe', roleType: 'custom' },
        provider: target,
        messages: [{ role: 'user', content: '请只回复 OK' }],
        context: {
          taskText: '请只回复 OK',
          isGroup: false,
          safeCwd: options.safeCwd || os.tmpdir()
        },
        signal: options.signal
      });
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        reply: String((res && res.text) || '').trim().slice(0, 120),
        error: ''
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        reply: '',
        error: (err && err.message) || String(err)
      };
    }
  }
}

module.exports = {
  AgentRunner,
  splitCommandArgs,
  killProcessTree,
  findAgyExecutable,
  listAgyModels,
  parseAgyModelsOutput,
  parseAgyStreamLine,
  DEFAULT_AGY_MODELS
};
