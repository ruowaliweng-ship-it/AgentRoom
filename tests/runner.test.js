'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  AgentRunner,
  splitCommandArgs,
  parseAgyStreamLine,
  parseAgyModelsOutput
} = require('../core/runner');
const { LocalStore } = require('../core/store');

test('AgentRunner: Mock 引擎流式输出正常', async () => {
  const runner = new AgentRunner({ fastMock: true });
  let streamed = '';
  const res = await runner.run({
    agent: { id: 'agent_george', name: '乔治', title: '项目经理', roleType: 'pm' },
    provider: { id: 'mock-demo', type: 'mock' },
    messages: [],
    context: { round: 1, taskText: '设计登录页面', isGroup: true },
    onToken: (chunk) => {
      streamed += chunk;
    }
  });
  assert.equal(res.providerType, 'mock');
  assert.ok(res.text.includes('@林溪'));
  assert.equal(streamed, res.text);
});

test('AgentRunner: 通用本地 CLI 适配器 UTF-8 子进程调用正常', async () => {
  const runner = new AgentRunner();
  const provider = {
    id: 'local-cli',
    type: 'cli',
    cliCommand: process.execPath,
    cliArgs:
      '-e "let s=\'\';process.stdin.setEncoding(\'utf8\');process.stdin.on(\'data\',d=>s+=d);process.stdin.on(\'end\',()=>process.stdout.write(\'CLI回复:\'+s.trim().slice(-20)))"',
    timeoutMs: 10000
  };

  let streamed = '';
  const res = await runner.run({
    agent: { id: 'agent_chenmo', name: '陈默' },
    provider,
    messages: [{ role: 'user', content: '中文UTF8校验测试成功' }],
    onToken: (c) => {
      streamed += c;
    }
  });

  assert.equal(res.providerType, 'cli');
  assert.ok(res.text.includes('CLI回复:'));
  assert.ok(res.text.includes('中文UTF8校验测试成功'));
  assert.equal(streamed.trim(), res.text);
});

test('AgentRunner: 本地 CLI 超时保护与子进程树清理', async () => {
  const runner = new AgentRunner();
  const provider = {
    id: 'local-cli',
    type: 'cli',
    cliCommand: process.execPath,
    cliArgs: '-e "setTimeout(() => console.log(\'late\'), 15000)"',
    timeoutMs: 350
  };

  const startedAt = Date.now();
  await assert.rejects(
    () =>
      runner.run({
        agent: { id: 'agent_chenmo', name: '陈默' },
        provider,
        messages: [{ role: 'user', content: 'trigger timeout' }]
      }),
    (err) => err.code === 'CLI_TIMEOUT'
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 4000, `超时清理耗时过长: ${elapsed}ms`);
});

test('splitCommandArgs: 正确解析带引号与空格的 CLI 参数', () => {
  const parsed = splitCommandArgs('-m "hello world" --flag \'a b\' plain');
  assert.deepEqual(parsed, ['-m', 'hello world', '--flag', 'a b', 'plain']);
});

test('LocalStore: 持久化恢复与 API Key 脱敏保护', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-store-'));
  try {
    const store1 = new LocalStore(tmpDir);
    store1.updateSettings({ theme: 'light', language: 'en-US', maxRounds: 5 });
    store1.saveProvider({
      id: 'deepseek-api',
      apiKey: 'sk-1234567890abcdef',
      setActive: true
    });
    const sanitized = store1.listProvidersSanitized().find((p) => p.id === 'deepseek-api');
    assert.equal(sanitized.apiKey, '');
    assert.equal(sanitized.hasApiKey, true);
    assert.equal(sanitized.apiKeyMasked, 'sk-1****cdef');

    // 重启后重新加载验证持久化
    const store2 = new LocalStore(tmpDir);
    assert.equal(store2.getSettings().theme, 'light');
    assert.equal(store2.getSettings().language, 'en-US');
    assert.equal(store2.getSettings().maxRounds, 5);
    assert.equal(store2.getSettings().activeProviderId, 'deepseek-api');
    assert.equal(store2.getProviderRaw('deepseek-api').apiKey, 'sk-1234567890abcdef');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AgentRunner: agy NDJSON 流式事件解析与 models 列表解析', () => {
  const deltaEvt = parseAgyStreamLine(
    JSON.stringify({ event: 'step_update', step_update: { text_delta: '你好' } })
  );
  assert.deepEqual(deltaEvt, { type: 'delta', text: '你好' });

  const resultEvt = parseAgyStreamLine(
    JSON.stringify({ event: 'done', result: { response: 'OK' } })
  );
  assert.deepEqual(resultEvt, { type: 'result', text: 'OK' });

  const errEvt = parseAgyStreamLine(JSON.stringify({ event: 'error', error: 'quota exceeded' }));
  assert.deepEqual(errEvt, { type: 'error', error: 'quota exceeded' });

  assert.equal(parseAgyStreamLine('non-json log line'), null);

  const models = parseAgyModelsOutput(
    'Fetching available models...\ngemini-4-neon-medium\tGemini 4 Neon Medium\nclaude-sonnet-5-5-high\tClaude Sonnet 5.5 High\n'
  );
  assert.equal(models.length, 2);
  assert.equal(models[0].id, 'gemini-4-neon-medium');
  assert.equal(models[1].id, 'claude-sonnet-5-5-high');
});

test('AgentRunner: testProvider Mock 测通返回 ok 与 latencyMs', async () => {
  const runner = new AgentRunner({ fastMock: true });
  const res = await runner.testProvider({ id: 'mock-demo', type: 'mock' });
  assert.equal(res.ok, true);
  assert.equal(typeof res.latencyMs, 'number');
  assert.ok(res.reply.length > 0);
  assert.equal(res.error, '');
});

test('LocalStore: deleteProvider 回退保护、agent 引用清理与旧配置无损补齐 agy 卡片', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-v2-'));
  try {
    // 1. 模拟老版本 store.json（没有 3 张 agy-* 卡片，但有已保存的 DeepSeek Key）
    const legacyFile = path.join(tmpDir, 'agentroom-store.json');
    fs.writeFileSync(
      legacyFile,
      JSON.stringify({
        version: 1,
        settings: { theme: 'dark', language: 'zh-CN', activeProviderId: 'deepseek-api', maxRounds: 3 },
        providers: [
          { id: 'mock-demo', type: 'mock', name: '内置演示引擎' },
          { id: 'deepseek-api', type: 'openai', name: 'DeepSeek 官方 API', apiKey: 'sk-legacy-keep-me' }
        ]
      }),
      'utf8'
    );

    const store = new LocalStore(tmpDir);
    const ids = store.listProvidersSanitized().map((p) => p.id);
    assert.ok(ids.includes('agy-gemini-neon'));
    assert.ok(ids.includes('agy-claude-sonnet'));
    assert.ok(ids.includes('agy-claude-opus'));
    // 原有 Key 毫发无损
    assert.equal(store.getProviderRaw('deepseek-api').apiKey, 'sk-legacy-keep-me');

    // 2. 新增自定义卡片 -> 设为默认 -> 绑定到乔治 -> 删除该卡片
    const created = store.createProvider({ type: 'agy', name: '我的自定义 Agy', setActive: true });
    assert.equal(store.getSettings().activeProviderId, created.id);
    store.upsertAgent({ id: 'agent_george', name: '乔治', providerId: created.id });
    assert.equal(store.getAgent('agent_george').providerId, created.id);

    // 内置 mock-demo 不可删除
    assert.throws(() => store.deleteProvider('mock-demo'), /不可删除/);

    const deleted = store.deleteProvider(created.id);
    assert.equal(deleted, true);
    assert.equal(store.getSettings().activeProviderId, 'mock-demo');
    assert.equal(store.getAgent('agent_george').providerId, '');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
