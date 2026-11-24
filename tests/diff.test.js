'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extractFileEdits, computeLineDiff } = require('../core/diff');
const { LocalStore } = require('../core/store');

test('extractFileEdits: 准确提取回复中的 file-edit 变更代码块', () => {
  const sample = [
    '我整理了以下两处修改：',
    '```file-edit:src/app.js',
    'const port = 3000;',
    'console.log(port);',
    '```',
    '另外普通代码块不应被误提取：',
    '```js',
    'const x = 1;',
    '```',
    '```file-edit:README.md',
    '# Hello',
    '```'
  ].join('\n');

  const edits = extractFileEdits(sample);
  assert.equal(edits.length, 2);
  assert.equal(edits[0].targetPath, 'src/app.js');
  assert.equal(edits[0].newContent, 'const port = 3000;\nconsole.log(port);');
  assert.equal(edits[1].targetPath, 'README.md');
  assert.equal(edits[1].newContent, '# Hello');
});

test('computeLineDiff: 正确计算新建文件与已有文件的红绿行级 Diff', () => {
  const newDiff = computeLineDiff('', 'line1\nline2', true);
  assert.equal(newDiff.isNewFile, true);
  assert.equal(newDiff.added, 2);
  assert.equal(newDiff.removed, 0);
  assert.ok(newDiff.lines.every((l) => l.type === 'add'));

  const modDiff = computeLineDiff('a\nb\nc\nd', 'a\nb_mod\nc\nd\ne', false);
  assert.equal(modDiff.isNewFile, false);
  assert.equal(modDiff.added, 2); // b_mod + e
  assert.equal(modDiff.removed, 1); // b
  assert.ok(modDiff.lines.some((l) => l.type === 'del' && l.text === 'b'));
  assert.ok(modDiff.lines.some((l) => l.type === 'add' && l.text === 'b_mod'));
  assert.ok(modDiff.lines.some((l) => l.type === 'add' && l.text === 'e'));
});

test('LocalStore: 4 套场景模板建群、自动补齐专属角色、删除消息与导出 Markdown 纪要', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-tpl-'));
  try {
    const store = new LocalStore(tmpDir);
    const templates = store.listRoomTemplates();
    assert.equal(templates.length, 4);

    // 1. 使用“代码安全审计组”模板建群，自动创建 3 位专属安全角色
    const created = store.createRoomFromTemplate({ templateId: 'security' });
    assert.equal(created.room.name, '代码安全审计组');
    assert.equal(created.room.memberIds.length, 3);
    const agentNames = store.listAgents().map((a) => a.name);
    assert.ok(agentNames.includes('盾安'));
    assert.ok(agentNames.includes('影测'));
    assert.ok(agentNames.includes('修岩'));

    // 2. 再次按同模板建群不重复创建已有角色
    const countBefore = store.listAgents().length;
    store.createRoomFromTemplate({ templateId: 'security', name: '安全复审二期' });
    assert.equal(store.listAgents().length, countBefore);

    // 3. 追加并测试删除单条消息 + 导出 Markdown 决策纪要
    const m1 = store.appendMessage(created.room.id, {
      senderType: 'user',
      senderName: '我',
      content: '请审计沙箱边界实现'
    });
    const m2 = store.appendMessage(created.room.id, {
      senderType: 'agent',
      senderName: '盾安',
      senderTitle: '安全架构师',
      content: '边界校验严谨，未发现越界漏洞。DONE'
    });

    const md = store.formatRoomMarkdownExport(created.room.id);
    assert.ok(md.includes('# AgentRoom 协作决策纪要：代码安全审计组'));
    assert.ok(md.includes('盾安'));
    assert.ok(md.includes('边界校验严谨'));

    const deleted = store.deleteMessage(created.room.id, m1.id);
    assert.equal(deleted, true);
    const left = store.getMessages(created.room.id);
    assert.ok(!left.some((m) => m.id === m1.id));
    assert.ok(left.some((m) => m.id === m2.id));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
