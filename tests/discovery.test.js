'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { discoverLocalAIs, resolveCliBinary } = require('../core/discovery');
const { LocalStore } = require('../core/store');

test('resolveCliBinary: Windows 下 .exe/.cmd 严格优先于 .ps1，仅存 .ps1 时自动包装 powershell', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-disc-bin-'));
  try {
    // 1. 同时存在 .ps1 和 .cmd -> 必须优先选 .cmd
    fs.writeFileSync(path.join(tmpDir, 'claude.ps1'), '# ps1', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'claude.cmd'), '@echo off', 'utf8');
    const claudeRes = resolveCliBinary('claude', [tmpDir], 'win32');
    assert.ok(claudeRes);
    assert.equal(claudeRes.ext, '.cmd');
    assert.ok(claudeRes.command.endsWith('claude.cmd'));

    // 2. 同时存在 .cmd 和 .exe -> 必须优先选 .exe
    fs.writeFileSync(path.join(tmpDir, 'agy.cmd'), '@echo off', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'agy.exe'), 'MZ', 'utf8');
    const agyRes = resolveCliBinary('agy', [tmpDir], 'win32');
    assert.ok(agyRes);
    assert.equal(agyRes.ext, '.exe');
    assert.ok(agyRes.command.endsWith('agy.exe'));

    // 3. 仅有 .ps1 -> 自动包装为 powershell.exe
    fs.writeFileSync(path.join(tmpDir, 'dsh.ps1'), '# ps1 only', 'utf8');
    const dshRes = resolveCliBinary('dsh', [tmpDir], 'win32');
    assert.ok(dshRes);
    assert.equal(dshRes.ext, '.ps1');
    assert.equal(dshRes.command, 'powershell.exe');
    assert.ok(dshRes.extraArgs.includes('-File'));
    assert.ok(dshRes.extraArgs.includes('dsh.ps1'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discoverLocalAIs: 并发探测 CLI 与 Ollama/LM Studio 服务并按优先级排序', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-disc-all-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'agy.exe'), 'MZ', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'claude.cmd'), '@echo off', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'dsh.cmd'), '@echo off', 'utf8');

    const mockFetch = async (url) => {
      if (url.includes('11434/api/tags')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'llama3.1:8b' }] })
        };
      }
      if (url.includes('1234/v1/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'deepseek-r1-distill-qwen-7b' }] })
        };
      }
      throw new Error('unexpected url');
    };

    const { found, elapsedMs } = await discoverLocalAIs({
      searchDirs: [tmpDir],
      platform: 'win32',
      httpTimeoutMs: 500,
      fetchImpl: mockFetch
    });

    assert.ok(elapsedMs < 1500);
    const keys = found.map((x) => x.key);
    assert.deepEqual(keys, ['agy', 'ollama', 'lmstudio', 'claude', 'dsh']);

    const ollama = found.find((x) => x.key === 'ollama');
    assert.equal(ollama.providerTemplate.baseUrl, 'http://127.0.0.1:11434/v1');
    assert.equal(ollama.providerTemplate.model, 'qwen2.5-coder:7b');
    assert.equal(ollama.providerTemplate.apiKey, 'ollama');

    const dsh = found.find((x) => x.key === 'dsh');
    assert.equal(dsh.providerTemplate.cliArgs, '--profile headless');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('LocalStore.applyDiscoveredProviders: 去重、不覆盖手动修改、不复活已删卡片与默认引擎自动切换', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-disc-store-'));
  try {
    const store = new LocalStore(tmpDir);
    const initialAgyCount = store.listProvidersSanitized().filter((p) => p.type === 'agy').length;

    const fakeFound = [
      {
        id: 'agy-gemini-neon',
        key: 'agy',
        name: 'Antigravity CLI (agy)',
        type: 'agy',
        providerTemplate: { id: 'agy-gemini-neon', type: 'agy', model: 'gemini-4-neon-medium' }
      },
      {
        id: 'auto-claude',
        key: 'claude',
        name: 'Claude Code CLI',
        type: 'cli',
        providerTemplate: {
          id: 'auto-claude',
          type: 'cli',
          name: 'Claude Code CLI',
          cliCommand: 'C:\\tools\\claude.cmd',
          cliArgs: '-p'
        }
      },
      {
        id: 'auto-ollama',
        key: 'ollama',
        name: 'Ollama 本地大模型',
        type: 'openai',
        providerTemplate: {
          id: 'auto-ollama',
          type: 'openai',
          name: 'Ollama 本地服务',
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKey: 'ollama',
          model: 'qwen2.5:7b'
        }
      }
    ];

    // 1. 首次自动接入：agy 复用不重复创建；新增 auto-claude 与 auto-ollama；默认引擎从 mock-demo 切到 agy-gemini-neon
    const s1 = store.applyDiscoveredProviders(fakeFound, { autoSwitchDefault: true, restoreDeleted: false });
    assert.equal(s1.addedCount, 2);
    assert.equal(s1.switchedToProviderId, 'agy-gemini-neon');
    assert.equal(store.getSettings().activeProviderId, 'agy-gemini-neon');
    assert.equal(
      store.listProvidersSanitized().filter((p) => p.type === 'agy').length,
      initialAgyCount
    );

    // 2. 用户手动修改 auto-ollama 的模型名后，再次扫描绝不能被覆盖
    store.saveProvider({ id: 'auto-ollama', model: 'my-custom-model:14b' });
    const s2 = store.applyDiscoveredProviders(fakeFound, { autoSwitchDefault: true, restoreDeleted: false });
    assert.equal(s2.addedCount, 0);
    assert.equal(store.getProviderRaw('auto-ollama').model, 'my-custom-model:14b');

    // 3. 用户删除 auto-claude 后，静默自动扫描绝不复活；手动点击“一键自动连接全部”(restoreDeleted: true) 才重新接入
    store.deleteProvider('auto-claude');
    assert.equal(store.getProviderRaw('auto-claude'), null);

    store.applyDiscoveredProviders(fakeFound, { autoSwitchDefault: false, restoreDeleted: false });
    assert.equal(store.getProviderRaw('auto-claude'), null);

    const s4 = store.applyDiscoveredProviders(fakeFound, { autoSwitchDefault: false, restoreDeleted: true });
    assert.equal(s4.addedCount, 1);
    assert.ok(store.getProviderRaw('auto-claude'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
