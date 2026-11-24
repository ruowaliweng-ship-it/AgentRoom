'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { LocalStore } = require('../core/store');
const { FolderSandbox } = require('../core/sandbox');
const { AgentRunner } = require('../core/runner');
const { RoomOrchestrator, parseMentions, buildAgentMessages } = require('../core/orchestrator');

function setupTestEnv(customRunner) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-orch-'));
  const dataDir = path.join(tmpDir, 'data');
  const projectDir = path.join(tmpDir, 'proj');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'app.config.json'), '{"port":8080,"mode":"prod"}', 'utf8');

  const store = new LocalStore(dataDir);
  const sandbox = new FolderSandbox([projectDir]);
  const runner = customRunner || new AgentRunner({ fastMock: true });
  const events = [];
  const orchestrator = new RoomOrchestrator({
    store,
    runner,
    sandbox,
    onEvent: (evt) => events.push(evt)
  });

  return { tmpDir, projectDir, store, sandbox, runner, orchestrator, events };
}

test('RoomOrchestrator: 默认 3 轮上限到达后强制暂停交用户拍板', async () => {
  // 构造一个永不输出 DONE 的测试 runner，验证严格在第 3 轮强制暂停
  const endlessRunner = {
    async run({ agent }) {
      return { text: `我是 ${agent.name}，继续讨论下一环节。`, providerType: 'mock' };
    }
  };
  const env = setupTestEnv(endlessRunner);
  try {
    const res = await env.orchestrator.handleUserMessage('room_project_default', '开启无限讨论测试');
    assert.equal(res.status, 'PAUSED_MAX_ROUNDS');
    assert.equal(res.round, 3);
    assert.equal(res.transcript.length, 3);
    assert.ok(res.breakerMessage);
    assert.equal(res.breakerMessage.meta.reason, 'MAX_ROUNDS');
  } finally {
    fs.rmSync(env.tmpDir, { recursive: true, force: true });
  }
});

test('RoomOrchestrator: 评审打回最多 2 次，第 3 次强制熔断交用户裁决', async () => {
  const env = setupTestEnv();
  try {
    // 将 maxRounds 调为 8，触发内置演示引擎的评审测试：
    // 轮1 乔治 -> 轮2 陈默(打回1) -> 轮3 林溪 -> 轮4 陈默(打回2) -> 轮5 林溪 -> 轮6 陈默(打回3 -> 强制熔断!)
    const res = await env.orchestrator.handleUserMessage(
      'room_project_default',
      '请执行评审测试，检查边界校验',
      { maxRounds: 8 }
    );
    assert.equal(res.status, 'CIRCUIT_OPEN_REVIEW');
    assert.equal(res.reviewRejectCount, 3);
    assert.ok(res.breakerMessage);
    assert.equal(res.breakerMessage.meta.reason, 'REVIEW_REJECT_LIMIT');

    // 验证人工裁决可以干净结束熔断态
    const resolved = env.orchestrator.resolveBreaker('room_project_default', {
      action: 'finish',
      instruction: '采用当前第 2 版方案上线'
    });
    assert.equal(resolved.status, 'RESOLVED_BY_USER');
    assert.equal(env.orchestrator.getRoomState('room_project_default').reviewRejectCount, 0);
  } finally {
    fs.rmSync(env.tmpDir, { recursive: true, force: true });
  }
});

test('RoomOrchestrator: 显式 @角色 路由与 DONE 提前结束', async () => {
  const env = setupTestEnv();
  try {
    // 显式 @陈默，首轮直接路由到陈默，陈默在常规模式下输出 REVIEW_PASS + DONE 提前结束
    const res = await env.orchestrator.handleUserMessage(
      'room_project_default',
      '@陈默 请直接做安全边界终审'
    );
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.round, 1);
    assert.equal(res.transcript.length, 1);
    assert.equal(res.transcript[0].senderId, 'agent_chenmo');

    // 验证 parseMentions 中英文均可匹配
    const agents = env.store.listAgents();
    const m1 = parseMentions('请 @Linxi 协助美化界面', agents);
    assert.equal(m1[0].id, 'agent_linxi');
  } finally {
    fs.rmSync(env.tmpDir, { recursive: true, force: true });
  }
});

test('RoomOrchestrator: AbortController 随时中止正在流转的任务', async () => {
  const slowRunner = {
    async run({ signal }) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 5000);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true }
        );
      });
      return { text: 'should not reach', providerType: 'mock' };
    }
  };
  const env = setupTestEnv(slowRunner);
  try {
    const runPromise = env.orchestrator.handleUserMessage('room_project_default', '慢速任务');
    await new Promise((r) => setTimeout(r, 40));
    const aborted = env.orchestrator.abort('room_project_default');
    assert.equal(aborted, true);

    const res = await runPromise;
    assert.equal(res.status, 'ABORTED');
  } finally {
    fs.rmSync(env.tmpDir, { recursive: true, force: true });
  }
});

test('RoomOrchestrator: 防幻觉上下文构建器注入真实沙箱文件内容并压缩较早历史', async () => {
  let capturedMessages = null;
  const spyRunner = {
    async run({ messages }) {
      capturedMessages = messages;
      return { text: '已核对真实配置端口 8080。DONE', providerType: 'mock' };
    }
  };
  const env = setupTestEnv(spyRunner);
  try {
    // 预填充 8 条历史消息以触发历史摘要压缩
    for (let i = 1; i <= 8; i += 1) {
      env.store.appendMessage('room_project_default', {
        senderType: 'user',
        senderName: '我',
        content: `历史消息第 ${i} 条`
      });
    }

    const res = await env.orchestrator.handleUserMessage(
      'room_project_default',
      '请检查 `app.config.json` 中的端口配置'
    );
    assert.equal(res.status, 'COMPLETED');
    assert.ok(Array.isArray(capturedMessages));
    assert.ok(capturedMessages[0].content.includes('"port":8080'));
    assert.ok(
      capturedMessages.some(
        (m) => m.role === 'system' && m.content.includes('较早对话精炼摘要')
      )
    );

    // 直接测试 buildAgentMessages
    const built = buildAgentMessages({
      agent: env.store.listAgents()[0],
      room: env.store.getRoom('room_project_default'),
      historyMessages: [],
      members: env.store.listAgents(),
      fileContexts: [{ path: 'a.txt', content: 'REAL_CONTENT', truncated: false }],
      round: 1,
      maxRounds: 3
    });
    assert.ok(built[0].content.includes('REAL_CONTENT'));
  } finally {
    fs.rmSync(env.tmpDir, { recursive: true, force: true });
  }
});
