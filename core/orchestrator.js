'use strict';

const path = require('path');

/**
 * 从文本中解析显式 @角色 提及，返回按出现顺序匹配到的角色列表。
 */
function parseMentions(text, members) {
  if (!text || !Array.isArray(members) || members.length === 0) return [];
  const matches = [];
  for (const agent of members) {
    const names = [agent.name, agent.nameEn].filter(Boolean);
    for (const nm of names) {
      const escaped = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`@${escaped}(?=$|[\\s,，。.:：;；!！?？)）\\]])`, 'i');
      const m = regex.exec(text);
      if (m) {
        matches.push({ agent, index: m.index });
        break;
      }
    }
  }
  matches.sort((a, b) => a.index - b.index);
  return matches.map((item) => item.agent);
}

function detectSignals(text) {
  const src = String(text || '');
  return {
    done: /(?:^|[\s。！!])DONE(?:$|[\s。！!.,])/m.test(src),
    needUser: /(?:^|[\s。！!])NEED_USER(?:$|[\s。！!.,])/m.test(src),
    reviewReject: /(?:^|[\s。！!])REVIEW_REJECT(?:$|[\s。！!.,])/m.test(src),
    reviewPass: /(?:^|[\s。！!])REVIEW_PASS(?:$|[\s。！!.,])/m.test(src)
  };
}

/**
 * 构建精炼的对话历史摘要 + 最近原文 + 真实沙箱文件内容（防幻觉上下文构建器）
 */
function buildAgentMessages({ agent, room, historyMessages, members, fileContexts, round, maxRounds }) {
  const memberList = members.map((m) => `@${m.name}(${m.title})`).join('、');
  const systemParts = [
    agent.systemPrompt || `你是 ${agent.name}（${agent.title}）。`,
    `当前协作房间：「${room.name}」（${room.type === 'group' ? '多 AI 群聊' : '一对一私聊'}）。`,
    room.type === 'group'
      ? `房间成员：${memberList}。当前是第 ${round}/${maxRounds} 轮自动流转。`
      : '当前是私聊模式，直接清晰回复用户即可。',
    '协作协议：如需指定下一位同事发言请使用 @姓名；若发现严重缺陷需要打回整改请输出 REVIEW_REJECT 并 @对应成员；若需要修改沙箱中的项目文件，请使用 ```file-edit:相对路径\\n完整新内容\\n``` 代码块提出变更供用户审批；若任务已完整交付请在末尾输出 DONE；若需要用户拍板请输出 NEED_USER。'
  ];

  if (fileContexts && fileContexts.length > 0) {
    const fileBlocks = fileContexts.map(
      (fc) =>
        `### 真实文件: ${fc.path}${fc.truncated ? ' (已截断)' : ''}\n\`\`\`\n${fc.content}\n\`\`\``
    );
    systemParts.push(
      '【防幻觉真实文件上下文（由本地安全沙箱实时读取，请严格基于以下真实内容分析，严禁臆造）】\n' +
        fileBlocks.join('\n\n')
    );
  }

  const messages = [{ role: 'system', content: systemParts.join('\n\n') }];

  const validHistory = (historyMessages || []).filter(
    (m) => m.senderType === 'user' || m.senderType === 'agent'
  );
  const RECENT_KEEP = 6;
  if (validHistory.length > RECENT_KEEP) {
    const older = validHistory.slice(0, validHistory.length - RECENT_KEEP);
    const summaryLines = older.map((m) => {
      const compact = String(m.content || '')
        .replace(/\s+/g, ' ')
        .slice(0, 100);
      return `- ${m.senderName}: ${compact}`;
    });
    messages.push({
      role: 'system',
      content: `【较早对话精炼摘要（共 ${older.length} 条）】\n${summaryLines.join('\n')}`
    });
  }

  const recent = validHistory.slice(-RECENT_KEEP);
  for (const m of recent) {
    const isSelf = m.senderType === 'agent' && m.senderId === agent.id;
    messages.push({
      role: isSelf ? 'assistant' : 'user',
      content: isSelf ? m.content : `[${m.senderName}]: ${m.content}`
    });
  }

  return messages;
}

class RoomOrchestrator {
  /**
   * @param {Object} deps
   * @param {import('./store').LocalStore} deps.store
   * @param {import('./runner').AgentRunner} deps.runner
   * @param {import('./sandbox').FolderSandbox} deps.sandbox
   * @param {(event: Object) => void} [deps.onEvent]
   */
  constructor({ store, runner, sandbox, onEvent }) {
    this.store = store;
    this.runner = runner;
    this.sandbox = sandbox;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};

    /** @type {Map<string, { controller: AbortController, state: Object }>} */
    this.activeRuns = new Map();
    /** @type {Map<string, Object>} 保存每个房间最近一次挂起/熔断的调度态，便于“继续流转” */
    this.roomStates = new Map();
  }

  _emit(type, payload) {
    try {
      this.onEvent({ type, ...payload });
    } catch (_) {
      // 防止前端事件回调异常影响主状态机
    }
  }

  getRoomState(roomId) {
    const active = this.activeRuns.get(roomId);
    if (active) {
      return { ...active.state, running: true };
    }
    const saved = this.roomStates.get(roomId);
    if (saved) {
      return { ...saved, running: false };
    }
    const settings = this.store.getSettings();
    return {
      roomId,
      status: 'IDLE',
      running: false,
      round: 0,
      maxRounds: settings.maxRounds || 3,
      reviewRejectCount: 0,
      maxReviewRejects: settings.maxReviewRejects || 2,
      currentAgentId: null,
      currentAgentName: ''
    };
  }

  abort(roomId) {
    const active = this.activeRuns.get(roomId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  /**
   * 人工裁决：由用户直接结束当前熔断/暂停状态，或注入裁决指令后重新流转
   */
  resolveBreaker(roomId, { action = 'finish', instruction = '' } = {}) {
    const saved = this.roomStates.get(roomId);
    if (action === 'finish') {
      const nextState = {
        ...(saved || this.getRoomState(roomId)),
        status: 'RESOLVED_BY_USER',
        running: false,
        reviewRejectCount: 0
      };
      this.roomStates.set(roomId, nextState);
      const sysMsg = this.store.appendMessage(roomId, {
        senderType: 'system',
        senderId: 'system',
        senderName: '系统',
        content: instruction
          ? `用户已人工裁决并结束本轮协作：${instruction}`
          : '用户已人工裁决并结束本轮协作。',
        meta: { kind: 'resolved' }
      });
      this._emit('message:created', { roomId, message: sysMsg });
      this._emit('state:changed', { roomId, state: nextState });
      return { status: 'RESOLVED_BY_USER', state: nextState };
    }
    return null;
  }

  /**
   * 发送用户消息并启动确定性多 AI 调度
   */
  async handleUserMessage(roomId, text, options = {}) {
    const room = this.store.getRoom(roomId);
    if (!room) {
      throw new Error(`未找到会话房间: ${roomId}`);
    }
    if (this.activeRuns.has(roomId)) {
      throw new Error('当前会话正在流转中，请等待完成或先点击中止');
    }

    const trimmed = String(text || '').trim();
    if (!trimmed) {
      throw new Error('消息内容不能为空');
    }

    const attachedFiles = Array.isArray(options.attachedFiles) ? options.attachedFiles : [];
    const userMsg = this.store.appendMessage(roomId, {
      senderType: 'user',
      senderId: 'user',
      senderName: '我',
      content: trimmed,
      meta: { attachedFiles }
    });
    this._emit('message:created', { roomId, message: userMsg });

    const settings = this.store.getSettings();
    const maxRounds =
      options.maxRounds !== undefined
        ? Math.min(10, Math.max(1, Number(options.maxRounds)))
        : settings.maxRounds || 3;
    const maxReviewRejects =
      options.maxReviewRejects !== undefined
        ? Math.min(5, Math.max(1, Number(options.maxReviewRejects)))
        : settings.maxReviewRejects || 2;

    return this._runLoop({
      room,
      taskText: trimmed,
      attachedFiles,
      maxRounds,
      maxReviewRejects,
      initialReviewRejectCount: 0,
      initialNextAgentId: null,
      isContinuation: false
    });
  }

  /**
   * 从暂停/熔断状态继续流转（保留评审打回累计计数，防止绕过熔断；若用户显式选择 resetRejects 则清零）
   */
  async continueRoom(roomId, options = {}) {
    const room = this.store.getRoom(roomId);
    if (!room) {
      throw new Error(`未找到会话房间: ${roomId}`);
    }
    if (this.activeRuns.has(roomId)) {
      throw new Error('当前会话正在流转中');
    }
    const prev = this.roomStates.get(roomId);
    const settings = this.store.getSettings();
    const maxRounds =
      options.maxRounds !== undefined
        ? Math.min(10, Math.max(1, Number(options.maxRounds)))
        : settings.maxRounds || 3;
    const maxReviewRejects = settings.maxReviewRejects || 2;

    if (options.instruction && String(options.instruction).trim()) {
      const userMsg = this.store.appendMessage(roomId, {
        senderType: 'user',
        senderId: 'user',
        senderName: '我',
        content: String(options.instruction).trim(),
        meta: { kind: 'continuation_instruction' }
      });
      this._emit('message:created', { roomId, message: userMsg });
    }

    return this._runLoop({
      room,
      taskText: (options.instruction && String(options.instruction).trim()) || (prev && prev.taskText) || '继续推进当前任务',
      attachedFiles: (prev && prev.attachedFiles) || [],
      maxRounds,
      maxReviewRejects,
      initialReviewRejectCount: options.resetRejects ? 0 : (prev && prev.reviewRejectCount) || 0,
      initialNextAgentId: (prev && prev.nextAgentId) || null,
      isContinuation: true
    });
  }

  _collectRealFileContexts(taskText, attachedFiles = []) {
    if (!this.sandbox || !this.sandbox.hasGrants()) return [];
    const candidates = new Set();
    for (const f of attachedFiles) {
      if (typeof f === 'string' && f.trim()) candidates.add(f.trim());
    }

    // 自动探测消息中用反引号包裹或显式提到的相对文件路径（例如 `README.md`、`src/app.js`）
    const filePattern = /`([^`\r\n]{1,120}\.[a-zA-Z0-9]{1,10})`/g;
    let m;
    while ((m = filePattern.exec(String(taskText || ''))) !== null) {
      candidates.add(m[1].trim());
    }

    const contexts = [];
    for (const target of candidates) {
      if (contexts.length >= 4) break;
      try {
        const res = this.sandbox.readFile(target, { maxBytes: 12 * 1024 });
        contexts.push({
          name: path.basename(res.path),
          path: res.path,
          content: res.content,
          truncated: res.truncated
        });
      } catch (_) {
        // 忽略不存在或越界路径（越界绝对不泄漏内容）
      }
    }
    return contexts;
  }

  _resolveMembers(room) {
    const allAgents = this.store.listAgents();
    const map = new Map(allAgents.map((a) => [a.id, a]));
    return (room.memberIds || []).map((id) => map.get(id)).filter(Boolean);
  }

  _selectInitialAgent(members, taskText, initialNextAgentId) {
    if (initialNextAgentId) {
      const found = members.find((m) => m.id === initialNextAgentId);
      if (found) return found;
    }
    const mentioned = parseMentions(taskText, members);
    if (mentioned.length > 0) return mentioned[0];
    const pm = members.find((m) => m.roleType === 'pm');
    return pm || members[0];
  }

  _selectNextAgent(members, currentAgent, replyText) {
    const mentioned = parseMentions(replyText, members);
    const otherMentioned = mentioned.find((m) => m.id !== currentAgent.id);
    if (otherMentioned) return otherMentioned;
    if (members.length <= 1) return null;
    const idx = members.findIndex((m) => m.id === currentAgent.id);
    return members[(idx + 1) % members.length];
  }

  _resolveProviderForAgent(agent) {
    const settings = this.store.getSettings();
    const chosenId = agent.providerId || settings.activeProviderId || 'mock-demo';
    return (
      this.store.getProviderRaw(chosenId) ||
      this.store.getProviderRaw(settings.activeProviderId) ||
      this.store.getProviderRaw('mock-demo')
    );
  }

  async _runLoop({
    room,
    taskText,
    attachedFiles,
    maxRounds,
    maxReviewRejects,
    initialReviewRejectCount,
    initialNextAgentId
  }) {
    const roomId = room.id;
    const members = this._resolveMembers(room);
    if (members.length === 0) {
      throw new Error('该会话没有可用的 AI 成员');
    }

    const isGroup = room.type === 'group' && members.length > 1;
    const effectiveMaxRounds = isGroup ? maxRounds : 1;
    const controller = new AbortController();

    const state = {
      roomId,
      status: 'RUNNING',
      running: true,
      round: 0,
      maxRounds: effectiveMaxRounds,
      reviewRejectCount: initialReviewRejectCount,
      maxReviewRejects,
      currentAgentId: null,
      currentAgentName: '',
      nextAgentId: null,
      taskText,
      attachedFiles,
      transcript: []
    };

    this.activeRuns.set(roomId, { controller, state });
    this._emit('state:changed', { roomId, state: { ...state } });

    let currentAgent = this._selectInitialAgent(members, taskText, initialNextAgentId);
    const fileContexts = this._collectRealFileContexts(taskText, attachedFiles);

    try {
      for (let round = 1; round <= effectiveMaxRounds; round += 1) {
        if (controller.signal.aborted) {
          throw Object.assign(new Error('任务已被用户中止'), { name: 'AbortError', code: 'ABORTED' });
        }

        state.round = round;
        state.currentAgentId = currentAgent.id;
        state.currentAgentName = currentAgent.name;
        this._emit('state:changed', { roomId, state: { ...state } });

        const historyMessages = this.store.getMessages(roomId);
        const promptMessages = buildAgentMessages({
          agent: currentAgent,
          room,
          historyMessages,
          members,
          fileContexts,
          round,
          maxRounds: effectiveMaxRounds
        });

        const provider = this._resolveProviderForAgent(currentAgent);
        const streamMsgId = `stream_${Date.now().toString(36)}_${round}`;

        this._emit('stream:start', {
          roomId,
          messageId: streamMsgId,
          agent: {
            id: currentAgent.id,
            name: currentAgent.name,
            title: currentAgent.title,
            color: currentAgent.color,
            avatarText: currentAgent.avatarText
          },
          round,
          maxRounds: effectiveMaxRounds
        });

        const primaryGrant = this.sandbox && this.sandbox.getPrimaryGrant ? this.sandbox.getPrimaryGrant() : null;
        let streamedText = '';
        const runResult = await this.runner.run({
          agent: currentAgent,
          provider,
          messages: promptMessages,
          context: {
            round,
            maxRounds: effectiveMaxRounds,
            reviewRejectCount: state.reviewRejectCount,
            taskText,
            fileContexts,
            isGroup,
            safeCwd: primaryGrant ? primaryGrant.realPath : undefined
          },
          signal: controller.signal,
          onToken: (chunk) => {
            streamedText += chunk;
            this._emit('stream:chunk', {
              roomId,
              messageId: streamMsgId,
              chunk,
              fullText: streamedText
            });
          }
        });

        const finalText = (runResult && runResult.text) || streamedText || '(无内容输出)';
        const savedMsg = this.store.appendMessage(roomId, {
          id: streamMsgId,
          senderType: 'agent',
          senderId: currentAgent.id,
          senderName: currentAgent.name,
          senderTitle: currentAgent.title,
          senderColor: currentAgent.color,
          avatarText: currentAgent.avatarText,
          content: finalText,
          meta: {
            round,
            maxRounds: effectiveMaxRounds,
            providerId: provider ? provider.id : 'mock-demo',
            providerType: runResult ? runResult.providerType : 'mock',
            fileContextCount: fileContexts.length
          }
        });
        state.transcript.push(savedMsg);
        this._emit('stream:end', { roomId, message: savedMsg });

        const signals = detectSignals(finalText);

        // 1. 评审打回熔断红线：最多打回 maxReviewRejects (默认2) 次，第 3 次强制熔断
        if (signals.reviewReject) {
          state.reviewRejectCount += 1;
          if (state.reviewRejectCount > maxReviewRejects) {
            state.status = 'CIRCUIT_OPEN_REVIEW';
            state.running = false;
            const nextAgent = this._selectNextAgent(members, currentAgent, finalText);
            state.nextAgentId = nextAgent ? nextAgent.id : null;

            const breakerMsg = this.store.appendMessage(roomId, {
              senderType: 'system',
              senderId: 'system',
              senderName: '系统熔断保护',
              content:
                `⚠️ **触发评审打回熔断机制**：评审已连续打回 **${state.reviewRejectCount} 次**（超过上限 ${maxReviewRejects} 次）。\n\n` +
                `为防止多 AI 陷入无休止修改死循环，系统已强制暂停自动流转。请您审阅上方分歧后进行**人工裁决**或补充指示后继续。`,
              meta: {
                kind: 'breaker',
                reason: 'REVIEW_REJECT_LIMIT',
                reviewRejectCount: state.reviewRejectCount,
                maxReviewRejects
              }
            });
            this._emit('message:created', { roomId, message: breakerMsg });
            this.roomStates.set(roomId, { ...state });
            this._emit('state:changed', { roomId, state: { ...state } });
            return { ...state, breakerMessage: breakerMsg };
          }
        }

        // 2. 任务明确结束信号 DONE
        if (signals.done || !isGroup) {
          state.status = 'COMPLETED';
          state.running = false;
          state.nextAgentId = null;
          this.roomStates.set(roomId, { ...state });
          this._emit('state:changed', { roomId, state: { ...state } });
          return { ...state };
        }

        // 3. 主动请求用户决策 NEED_USER
        if (signals.needUser) {
          state.status = 'NEED_USER';
          state.running = false;
          const nextAgent = this._selectNextAgent(members, currentAgent, finalText);
          state.nextAgentId = nextAgent ? nextAgent.id : null;
          const needMsg = this.store.appendMessage(roomId, {
            senderType: 'system',
            senderId: 'system',
            senderName: '系统提示',
            content: 'AI 协作者发出了 `NEED_USER` 信号，需要您确认关键决策后再继续流转。',
            meta: {
              kind: 'breaker',
              reason: 'NEED_USER'
            }
          });
          this._emit('message:created', { roomId, message: needMsg });
          this.roomStates.set(roomId, { ...state });
          this._emit('state:changed', { roomId, state: { ...state } });
          return { ...state, breakerMessage: needMsg };
        }

        // 选择下一轮发言者
        const nextAgent = this._selectNextAgent(members, currentAgent, finalText);
        state.nextAgentId = nextAgent ? nextAgent.id : null;

        // 4. 达到本轮自动流转上限，强制暂停交用户拍板
        if (round >= effectiveMaxRounds) {
          state.status = 'PAUSED_MAX_ROUNDS';
          state.running = false;
          const summaryMsg = this.store.appendMessage(roomId, {
            senderType: 'system',
            senderId: 'system',
            senderName: '系统轮次控制',
            content:
              `⏸️ **已达到单次自动流转上限（${effectiveMaxRounds} 轮）**，系统已自动暂停以防死循环与 Token 浪费。\n\n` +
              `- 下一顺位发言者：${nextAgent ? `@${nextAgent.name}` : '无'}\n` +
              `- 累计评审打回：${state.reviewRejectCount} / ${maxReviewRejects} 次\n\n` +
              `您可以点击下方按钮选择「继续流转」或「人工裁决结束」。`,
            meta: {
              kind: 'breaker',
              reason: 'MAX_ROUNDS',
              round: effectiveMaxRounds,
              maxRounds: effectiveMaxRounds
            }
          });
          this._emit('message:created', { roomId, message: summaryMsg });
          this.roomStates.set(roomId, { ...state });
          this._emit('state:changed', { roomId, state: { ...state } });
          return { ...state, breakerMessage: summaryMsg };
        }

        if (!nextAgent) {
          state.status = 'COMPLETED';
          state.running = false;
          this.roomStates.set(roomId, { ...state });
          this._emit('state:changed', { roomId, state: { ...state } });
          return { ...state };
        }

        currentAgent = nextAgent;
      }
    } catch (err) {
      const isAborted = err && (err.name === 'AbortError' || err.code === 'ABORTED');
      state.status = isAborted ? 'ABORTED' : 'ERROR';
      state.running = false;
      state.error = err ? err.message : '未知错误';

      const sysMsg = this.store.appendMessage(roomId, {
        senderType: 'system',
        senderId: 'system',
        senderName: isAborted ? '系统' : '执行异常',
        content: isAborted
          ? '⏹️ 当前多 AI 协作流转已被用户中止。'
          : `❌ 调用 AI 引擎失败：${state.error}`,
        meta: {
          kind: isAborted ? 'aborted' : 'error'
        }
      });
      this._emit('message:created', { roomId, message: sysMsg });
      this.roomStates.set(roomId, { ...state });
      this._emit('state:changed', { roomId, state: { ...state } });
      return { ...state };
    } finally {
      this.activeRuns.delete(roomId);
    }
    return { ...state };
  }
}

module.exports = {
  RoomOrchestrator,
  parseMentions,
  detectSignals,
  buildAgentMessages
};
