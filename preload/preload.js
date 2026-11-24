'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload);
  if (!res || res.ok !== true) {
    const message = (res && res.error && res.error.message) || `IPC 调用失败: ${channel}`;
    const err = new Error(message);
    err.code = (res && res.error && res.error.code) || 'IPC_ERROR';
    throw err;
  }
  return res.data;
}

contextBridge.exposeInMainWorld('agentRoom', {
  bootstrap: () => invoke('app:bootstrap'),
  updateSettings: (patch) => invoke('settings:update', patch),

  windowMinimize: () => invoke('window:minimize'),
  windowToggleMaximize: () => invoke('window:toggleMaximize'),
  windowClose: () => invoke('window:close'),
  windowIsMaximized: () => invoke('window:isMaximized'),

  upsertAgent: (agentInput) => invoke('agents:upsert', agentInput),
  deleteAgent: (agentId) => invoke('agents:delete', agentId),

  saveProvider: (providerInput) => invoke('providers:save', providerInput),
  createProvider: (providerInput) => invoke('providers:create', providerInput),
  deleteProvider: (providerId) => invoke('providers:delete', providerId),
  listAgyModels: () => invoke('providers:listAgyModels'),
  testProvider: (providerInput) => invoke('providers:test', providerInput),
  discoverProviders: () => invoke('providers:discover'),
  autoConnectProviders: () => invoke('providers:autoConnect'),

  createRoom: (payload) => invoke('rooms:create', payload),
  createRoomFromTemplate: (payload) => invoke('rooms:createFromTemplate', payload),
  getRoomMessages: (roomId) => invoke('rooms:messages', roomId),
  deleteMessage: (payload) => invoke('rooms:deleteMessage', payload),
  exportRoomMarkdown: (roomId) => invoke('rooms:exportMarkdown', roomId),
  clearRoomMessages: (roomId) => invoke('rooms:clear', roomId),
  getRoomState: (roomId) => invoke('rooms:state', roomId),

  sendMessage: (payload) => invoke('chat:send', payload),
  continueRoom: (payload) => invoke('chat:continue', payload),
  abortRoom: (roomId) => invoke('chat:abort', roomId),
  resolveBreaker: (payload) => invoke('chat:resolveBreaker', payload),

  selectAndGrantFolder: () => invoke('sandbox:selectAndGrant'),
  revokeFolder: (dirPath) => invoke('sandbox:revoke', dirPath),
  listGrants: () => invoke('sandbox:listGrants'),
  listDir: (dirPath) => invoke('sandbox:listDir', dirPath),
  getFolderTree: (dirPath) => invoke('sandbox:tree', dirPath),
  readFile: (targetPath) => invoke('sandbox:readFile', targetPath),
  writeFile: (payload) => invoke('sandbox:writeFile', payload),
  previewDiff: (payload) => invoke('sandbox:previewDiff', payload),
  validateDropFile: (filePath) => invoke('sandbox:validateDropFile', filePath),

  onEvent: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, data) => listener(data);
    ipcRenderer.on('agentroom:event', wrapped);
    return () => ipcRenderer.removeListener('agentroom:event', wrapped);
  }
});
