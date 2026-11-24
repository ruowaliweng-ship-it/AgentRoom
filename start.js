'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = __dirname;

function resolveElectronBinary() {
  const candidates = [];

  if (process.env.ELECTRON_PATH) {
    candidates.push(process.env.ELECTRON_PATH);
  }

  // 1. 优先使用本项目 node_modules 内的 Electron
  candidates.push(
    path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(projectRoot, 'node_modules', '.bin', 'electron.cmd')
  );

  // 2. 尝试通过 require('electron') 解析
  try {
    const resolved = require('electron');
    if (typeof resolved === 'string' && fs.existsSync(resolved)) {
      candidates.push(resolved);
    }
  } catch (_) {
    // 未在本地 node_modules 安装，提示用户安装或配置 ELECTRON_PATH
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const electronExe = resolveElectronBinary();
if (!electronExe) {
  console.error('[AgentRoom] 未找到 Electron 可执行文件。');
  console.error('请执行以下命令安装依赖（推荐使用国内镜像）：');
  console.error('  npm install --registry=https://registry.npmmirror.com');
  process.exit(1);
}

const args = [projectRoot, ...process.argv.slice(2)];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

console.log(`[AgentRoom] 启动 Electron: ${electronExe}`);
const child = spawn(electronExe, args, {
  stdio: 'inherit',
  env,
  windowsHide: false
});

child.on('error', (err) => {
  console.error('[AgentRoom] 启动 Electron 失败:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code == null ? 0 : code);
});
