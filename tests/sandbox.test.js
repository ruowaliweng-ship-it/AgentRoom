'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { FolderSandbox } = require('../core/sandbox');

function makeTempWorkspace() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-sb-'));
  const allowedDir = path.join(base, 'project');
  const siblingPrefixDir = path.join(base, 'project-evil');
  const outsideDir = path.join(base, 'outside');
  fs.mkdirSync(allowedDir, { recursive: true });
  fs.mkdirSync(siblingPrefixDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'TOP_SECRET', 'utf8');
  fs.writeFileSync(path.join(siblingPrefixDir, 'trap.txt'), 'PREFIX_TRAP', 'utf8');
  return { base, allowedDir, siblingPrefixDir, outsideDir };
}

test('FolderSandbox: 正常授权、读写文件与列目录', () => {
  const { base, allowedDir } = makeTempWorkspace();
  try {
    const sb = new FolderSandbox();
    const granted = sb.grant(allowedDir);
    assert.equal(granted.name, 'project');
    assert.equal(sb.listGrants().length, 1);

    const written = sb.writeFile('src/hello.txt', '你好 AgentRoom');
    assert.ok(written.size > 0);

    const read = sb.readFile('src/hello.txt');
    assert.equal(read.content, '你好 AgentRoom');
    assert.equal(read.truncated, false);

    const listing = sb.listDir();
    assert.ok(listing.entries.some((e) => e.name === 'src' && e.type === 'directory'));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('FolderSandbox: 拦截 ../ 越界、绝对路径越界与同前缀目录绕过', () => {
  const { base, allowedDir, siblingPrefixDir, outsideDir } = makeTempWorkspace();
  try {
    const sb = new FolderSandbox([allowedDir]);

    assert.throws(
      () => sb.readFile('../outside/secret.txt'),
      (err) => err.code === 'SANDBOX_OUT_OF_BOUNDS'
    );

    assert.throws(
      () => sb.writeFile('../outside/pwn.txt', 'bad'),
      (err) => err.code === 'SANDBOX_OUT_OF_BOUNDS'
    );

    assert.throws(
      () => sb.readFile(path.join(outsideDir, 'secret.txt')),
      (err) => err.code === 'SANDBOX_OUT_OF_BOUNDS'
    );

    // 经典前缀绕过：project vs project-evil
    assert.throws(
      () => sb.readFile(path.join(siblingPrefixDir, 'trap.txt')),
      (err) => err.code === 'SANDBOX_OUT_OF_BOUNDS'
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('FolderSandbox: 拦截指向授权目录之外的符号链接/目录联接逃逸', () => {
  const { base, allowedDir, outsideDir } = makeTempWorkspace();
  const linkPath = path.join(allowedDir, 'escape-link');
  try {
    // Windows 下使用 junction 无需管理员权限即可真实构造目录符号链接逃逸场景
    fs.symlinkSync(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');

    const sb = new FolderSandbox([allowedDir]);
    assert.throws(
      () => sb.readFile(path.join('escape-link', 'secret.txt')),
      (err) => err.code === 'SANDBOX_SYMLINK_ESCAPE'
    );

    assert.throws(
      () => sb.writeFile(path.join('escape-link', 'new-file.txt'), 'escape'),
      (err) => err.code === 'SANDBOX_SYMLINK_ESCAPE'
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('FolderSandbox: 撤销授权后立即拦截一切读写操作', () => {
  const { base, allowedDir } = makeTempWorkspace();
  try {
    const sb = new FolderSandbox([allowedDir]);
    sb.writeFile('notes.md', 'hello');
    assert.equal(sb.readFile('notes.md').content, 'hello');

    const removed = sb.revoke(allowedDir);
    assert.equal(removed, true);
    assert.equal(sb.listGrants().length, 0);

    assert.throws(
      () => sb.readFile(path.join(allowedDir, 'notes.md')),
      (err) => err.code === 'SANDBOX_NO_GRANT'
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
