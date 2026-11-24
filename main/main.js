'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');

const { FolderSandbox } = require('../core/sandbox');
const { LocalStore } = require('../core/store');
const { AgentRunner, listAgyModels } = require('../core/runner');
const { RoomOrchestrator } = require('../core/orchestrator');
const { discoverLocalAIs } = require('../core/discovery');
const { computeLineDiff } = require('../core/diff');

let mainWindow = null;
let store = null;
let sandbox = null;
let runner = null;
let orchestrator = null;

function broadcastEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agentroom:event', payload);
  }
}

function wrapIpc(handler) {
  return async (event, ...args) => {
    try {
      const data = await handler(event, ...args);
      return { ok: true, data };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: (err && err.code) || 'INTERNAL_ERROR',
          message: (err && err.message) || String(err)
        }
      };
    }
  };
}

function initServices() {
  const userDataDir = path.join(app.getPath('userData'), 'agentroom-data');
  store = new LocalStore(userDataDir);
  sandbox = new FolderSandbox(store.getGrants());
  // 同步剔除已失效的历史授权目录
  store.setGrants(sandbox.listGrants());
  runner = new AgentRunner();
  orchestrator = new RoomOrchestrator({
    store,
    runner,
    sandbox,
    onEvent: broadcastEvent
  });

  // 首次在新电脑启动时静默自动发现并接入本机已安装的 AI 工具与服务（不阻塞窗口秒开）
  if (!store.getSettings().hasAutoDiscovered) {
    discoverLocalAIs()
      .then(({ found }) => {
        store.applyDiscoveredProviders(found, {
          autoSwitchDefault: true,
          restoreDeleted: false
        });
        store.updateSettings({ hasAutoDiscovered: true });
        broadcastEvent({
          type: 'providers:updated',
          providers: store.listProvidersSanitized(),
          settings: store.getSettings()
        });
      })
      .catch(() => {
        // 自动发现失败不影响正常启动
      });
  }
}

function registerIpcHandlers() {
  ipcMain.handle(
    'app:bootstrap',
    wrapIpc(() => ({
      version: app.getVersion(),
      settings: store.getSettings(),
      agents: store.listAgents(),
      providers: store.listProvidersSanitized(),
      rooms: store.listRooms(),
      grants: sandbox.listGrants(),
      templates: store.listRoomTemplates()
    }))
  );

  ipcMain.handle(
    'settings:update',
    wrapIpc((_e, patch) => {
      const updated = store.updateSettings(patch);
      if (mainWindow && !mainWindow.isDestroyed() && patch && patch.theme) {
        mainWindow.setBackgroundColor(patch.theme === 'light' ? '#ffffff' : '#0b0c0f');
      }
      return updated;
    })
  );

  // 无边框窗口控制
  ipcMain.handle(
    'window:minimize',
    wrapIpc(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
      return true;
    })
  );

  ipcMain.handle(
    'window:toggleMaximize',
    wrapIpc(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      return mainWindow.isMaximized();
    })
  );

  ipcMain.handle(
    'window:close',
    wrapIpc(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      return true;
    })
  );

  ipcMain.handle(
    'window:isMaximized',
    wrapIpc(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false))
  );

  // 角色管理
  ipcMain.handle(
    'agents:upsert',
    wrapIpc((_e, agentInput) => {
      const agent = store.upsertAgent(agentInput);
      return {
        agent,
        agents: store.listAgents(),
        rooms: store.listRooms()
      };
    })
  );

  ipcMain.handle(
    'agents:delete',
    wrapIpc((_e, agentId) => {
      store.deleteAgent(agentId);
      return {
        agents: store.listAgents(),
        rooms: store.listRooms()
      };
    })
  );

  // 模型卡片配置
  ipcMain.handle(
    'providers:save',
    wrapIpc((_e, providerInput) => {
      const saved = store.saveProvider(providerInput);
      return {
        provider: saved,
        providers: store.listProvidersSanitized(),
        settings: store.getSettings()
      };
    })
  );

  ipcMain.handle(
    'providers:create',
    wrapIpc((_e, providerInput) => {
      const created = store.createProvider(providerInput);
      return {
        provider: created,
        providers: store.listProvidersSanitized(),
        settings: store.getSettings()
      };
    })
  );

  ipcMain.handle(
    'providers:delete',
    wrapIpc((_e, providerId) => {
      const deleted = store.deleteProvider(providerId);
      return {
        deleted,
        providers: store.listProvidersSanitized(),
        settings: store.getSettings(),
        agents: store.listAgents()
      };
    })
  );

  ipcMain.handle(
    'providers:listAgyModels',
    wrapIpc(async () => listAgyModels())
  );

  ipcMain.handle(
    'providers:test',
    wrapIpc(async (_e, providerInput) => {
      const savedRaw = providerInput && providerInput.id ? store.getProviderRaw(providerInput.id) : null;
      const merged = { ...(savedRaw || {}), ...(providerInput || {}) };
      if (!merged.apiKey || String(merged.apiKey).includes('****')) {
        merged.apiKey = (savedRaw && savedRaw.apiKey) || '';
      }
      const primaryGrant = sandbox.getPrimaryGrant();
      return runner.testProvider(merged, {
        safeCwd: primaryGrant ? primaryGrant.realPath : undefined
      });
    })
  );

  ipcMain.handle(
    'providers:discover',
    wrapIpc(async () => {
      const { found, elapsedMs } = await discoverLocalAIs();
      const existing = store.listProvidersSanitized();
      const annotated = found.map((item) => {
        const connected =
          item.type === 'agy'
            ? existing.some((p) => p.type === 'agy')
            : existing.some((p) => p.id === item.id);
        return { ...item, connected };
      });
      return { found: annotated, elapsedMs };
    })
  );

  ipcMain.handle(
    'providers:autoConnect',
    wrapIpc(async () => {
      const { found, elapsedMs } = await discoverLocalAIs();
      const summary = store.applyDiscoveredProviders(found, {
        autoSwitchDefault: true,
        restoreDeleted: true
      });
      store.updateSettings({ hasAutoDiscovered: true });
      const providers = store.listProvidersSanitized();
      const settings = store.getSettings();
      const annotated = found.map((item) => {
        const connected =
          item.type === 'agy'
            ? providers.some((p) => p.type === 'agy')
            : providers.some((p) => p.id === item.id);
        return { ...item, connected };
      });
      return {
        found: annotated,
        elapsedMs,
        summary,
        providers,
        settings
      };
    })
  );

  // 会话与消息
  ipcMain.handle(
    'rooms:create',
    wrapIpc((_e, payload) => {
      const room = store.createRoom(payload);
      return {
        room,
        rooms: store.listRooms()
      };
    })
  );

  ipcMain.handle(
    'rooms:createFromTemplate',
    wrapIpc((_e, payload) => {
      const { room, template } = store.createRoomFromTemplate(payload);
      return {
        room,
        template,
        agents: store.listAgents(),
        rooms: store.listRooms()
      };
    })
  );

  ipcMain.handle(
    'rooms:deleteMessage',
    wrapIpc((_e, { roomId, messageId }) => {
      const deleted = store.deleteMessage(roomId, messageId);
      return {
        deleted,
        messages: store.getMessages(roomId),
        rooms: store.listRooms()
      };
    })
  );

  ipcMain.handle(
    'rooms:exportMarkdown',
    wrapIpc(async (_e, roomId) => {
      const room = store.getRoom(roomId);
      if (!room) throw new Error(`未找到会话房间: ${roomId}`);
      const markdown = store.formatRoomMarkdownExport(roomId);
      const safeName = (room.name || 'agentroom-minutes').replace(/[\\/:*?"<>|]/g, '_');
      const res = await dialog.showSaveDialog(mainWindow, {
        title: '导出 Markdown 协作决策纪要',
        defaultPath: `${safeName}-纪要.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (res.canceled || !res.filePath) {
        return { canceled: true, filePath: '' };
      }
      fs.writeFileSync(res.filePath, markdown, 'utf8');
      return { canceled: false, filePath: res.filePath };
    })
  );

  ipcMain.handle(
    'rooms:messages',
    wrapIpc((_e, roomId) => ({
      messages: store.getMessages(roomId),
      state: orchestrator.getRoomState(roomId)
    }))
  );

  ipcMain.handle(
    'rooms:clear',
    wrapIpc((_e, roomId) => {
      orchestrator.abort(roomId);
      store.clearRoomMessages(roomId);
      return {
        messages: store.getMessages(roomId),
        rooms: store.listRooms()
      };
    })
  );

  ipcMain.handle(
    'rooms:state',
    wrapIpc((_e, roomId) => orchestrator.getRoomState(roomId))
  );

  // 多 AI 调度
  ipcMain.handle(
    'chat:send',
    wrapIpc(async (_e, { roomId, text, attachedFiles, maxRounds }) => {
      const result = await orchestrator.handleUserMessage(roomId, text, {
        attachedFiles,
        maxRounds
      });
      return {
        result,
        rooms: store.listRooms()
      };
    })
  );

  ipcMain.handle(
    'chat:continue',
    wrapIpc(async (_e, { roomId, instruction, maxRounds, resetRejects }) => {
      const result = await orchestrator.continueRoom(roomId, {
        instruction,
        maxRounds,
        resetRejects
      });
      return {
        result,
        rooms: store.listRooms()
      };
    })
  );

  ipcMain.handle(
    'chat:abort',
    wrapIpc((_e, roomId) => ({
      aborted: orchestrator.abort(roomId)
    }))
  );

  ipcMain.handle(
    'chat:resolveBreaker',
    wrapIpc((_e, { roomId, action, instruction }) => {
      const result = orchestrator.resolveBreaker(roomId, { action, instruction });
      return {
        result,
        rooms: store.listRooms()
      };
    })
  );

  // 实用平衡安全沙箱：严格仅通过系统原生目录选择器授权
  ipcMain.handle(
    'sandbox:selectAndGrant',
    wrapIpc(async () => {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: '选择要授权给 AgentRoom 的项目文件夹',
        properties: ['openDirectory']
      });
      if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
        return { canceled: true, grants: sandbox.listGrants() };
      }
      const granted = sandbox.grant(res.filePaths[0]);
      const grants = sandbox.listGrants();
      store.setGrants(grants);
      return { canceled: false, granted, grants };
    })
  );

  ipcMain.handle(
    'sandbox:revoke',
    wrapIpc((_e, dirPath) => {
      const removed = sandbox.revoke(dirPath);
      const grants = sandbox.listGrants();
      store.setGrants(grants);
      return { removed, grants };
    })
  );

  ipcMain.handle(
    'sandbox:listGrants',
    wrapIpc(() => sandbox.listGrants())
  );

  ipcMain.handle(
    'sandbox:listDir',
    wrapIpc((_e, dirPath) => sandbox.listDir(dirPath))
  );

  ipcMain.handle(
    'sandbox:tree',
    wrapIpc((_e, dirPath) => sandbox.buildTree(dirPath, 3, 240))
  );

  ipcMain.handle(
    'sandbox:readFile',
    wrapIpc((_e, targetPath) => sandbox.readFile(targetPath))
  );

  ipcMain.handle(
    'sandbox:writeFile',
    wrapIpc((_e, { targetPath, content }) => sandbox.writeFile(targetPath, content))
  );

  ipcMain.handle(
    'sandbox:previewDiff',
    wrapIpc((_e, { targetPath, newContent }) => {
      if (!sandbox.hasGrants()) {
        const diff = computeLineDiff('', newContent, true);
        return {
          noGrant: true,
          exists: false,
          targetPath,
          resolvedPath: targetPath,
          oldContent: '',
          diff
        };
      }
      const { logicalPath, realPath } = sandbox.resolveSafePath(targetPath);
      const exists = fs.existsSync(realPath) && fs.statSync(realPath).isFile();
      const oldContent = exists ? fs.readFileSync(realPath, 'utf8') : '';
      const diff = computeLineDiff(oldContent, newContent, !exists);
      return {
        noGrant: false,
        exists,
        targetPath,
        resolvedPath: logicalPath,
        oldContent,
        diff
      };
    })
  );

  ipcMain.handle(
    'sandbox:validateDropFile',
    wrapIpc((_e, filePath) => {
      const { logicalPath, realPath } = sandbox.resolveSafePath(filePath);
      if (!fs.existsSync(realPath) || !fs.statSync(realPath).isFile()) {
        throw new Error('仅支持引用文件（不支持直接拖拽文件夹）');
      }
      return { path: logicalPath, name: path.basename(logicalPath) };
    })
  );
}

function createMainWindow() {
  const settings = store.getSettings();
  const isLight = settings.theme === 'light';
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = path.join(__dirname, '..', 'assets', iconFile);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: isLight ? '#ffffff' : '#0b0c0f',
    title: 'AgentRoom',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);

  const isSmoke = process.env.AGENTROOM_SMOKE_TEST === '1';
  let rendererErrors = [];

  mainWindow.webContents.on('console-message', (_e, level, message) => {
    // level 3 = error
    if (level >= 3) {
      rendererErrors.push(message);
      console.error('[Renderer Error]', message);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    rendererErrors.push(`render-process-gone: ${details.reason}`);
    console.error('[Render Process Gone]', details);
  });

  mainWindow.once('ready-to-show', () => {
    if (!isSmoke) {
      mainWindow.show();
    } else {
      mainWindow.showInactive();
      setTimeout(async () => {
        try {
          if (rendererErrors.length > 0) {
            console.error('[SMOKE_TEST_FAIL]', rendererErrors.join(' | '));
            app.exit(1);
            return;
          }
          // 1. 拍摄深色模式 1280x820 真机截图（等待 bootstrap 完全结束）
          await mainWindow.webContents.executeJavaScript(
            `document.documentElement.setAttribute('data-theme', 'dark');`
          );
          await new Promise((r) => setTimeout(r, 480));
          const darkImg = await mainWindow.webContents.capturePage();
          const darkPath = path.join(__dirname, '..', 'preview_ui.png');
          fs.writeFileSync(darkPath, darkImg.toPNG());

          // 2. 切换浅色模式并拍摄 1280x820 真机截图
          await mainWindow.webContents.executeJavaScript(
            `document.documentElement.setAttribute('data-theme', 'light');`
          );
          await new Promise((r) => setTimeout(r, 480));
          const lightImg = await mainWindow.webContents.capturePage();
          const lightPath = path.join(__dirname, '..', 'preview_ui_light.png');
          fs.writeFileSync(lightPath, lightImg.toPNG());

          console.log(
            `[SMOKE_TEST_PASS] Window ready-to-show with 0 console errors. Saved: ${darkPath} & ${lightPath}`
          );
          app.exit(0);
        } catch (err) {
          console.error('[SMOKE_TEST_FAIL]', err && err.message ? err.message : err);
          app.exit(1);
        }
      }, 1700);
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  initServices();
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
