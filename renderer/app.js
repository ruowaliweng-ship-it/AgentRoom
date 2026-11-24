'use strict';

(function () {
  const api = window.agentRoom;
  const i18n = window.AgentRoomI18n;
  const md = window.AgentRoomMarkdown;

  const state = {
    settings: {
      theme: 'dark',
      language: 'zh-CN',
      activeProviderId: 'mock-demo',
      maxRounds: 3,
      maxReviewRejects: 2
    },
    agents: [],
    providers: [],
    rooms: [],
    grants: [],
    templates: [],
    diffSnapshots: new Map(), // key -> { targetPath, oldContent, existed }
    cmdItems: [],
    cmdSelectedIdx: 0,
    currentRoomId: 'room_project_default',
    messages: [],
    roomRunState: {
      status: 'IDLE',
      running: false,
      round: 0,
      maxRounds: 3,
      reviewRejectCount: 0,
      maxReviewRejects: 2
    },
    streamingMessage: null, // { id, agent, text, round, maxRounds }
    attachedFiles: [],
    searchQuery: '',
    previewFilePath: null,
    agyModels: [
      { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
      { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
      { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
      { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
      { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
      { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' }
    ],
    agyModelsLoaded: false
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(text, isError = false) {
    const div = document.createElement('div');
    div.className = `toast${isError ? ' error' : ''}`;
    div.textContent = text;
    els.toastContainer.appendChild(div);
    setTimeout(() => {
      div.remove();
    }, 3200);
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch (_) {
      return '';
    }
  }

  function getAgentNamesForHighlight() {
    const names = [];
    for (const a of state.agents) {
      if (a.name) names.push(a.name);
      if (a.nameEn) names.push(a.nameEn);
    }
    return names;
  }

  function getCurrentRoom() {
    return state.rooms.find((r) => r.id === state.currentRoomId) || state.rooms[0] || null;
  }

  function getDisplayName(item) {
    if (!item) return '';
    return state.settings.language === 'en-US' && item.nameEn ? item.nameEn : item.name;
  }

  function getDisplayTitle(agent) {
    if (!agent) return '';
    return state.settings.language === 'en-US' && agent.titleEn ? agent.titleEn : agent.title;
  }

  function applyThemeAndI18n() {
    const theme = state.settings.theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('lang', state.settings.language);
    i18n.setLanguage(state.settings.language);

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = i18n.t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.setAttribute('placeholder', i18n.t(key));
    });

    if (theme === 'dark') {
      els.themeIconSun.classList.remove('hidden');
      els.themeIconMoon.classList.add('hidden');
    } else {
      els.themeIconSun.classList.add('hidden');
      els.themeIconMoon.classList.remove('hidden');
    }
    els.langToggleLabel.textContent = i18n.t('btnLang');
    Array.from(els.maxRoundsSelect.options).forEach((opt) => {
      opt.textContent = i18n.t('roundOption', { n: opt.value });
    });
    els.maxRoundsSelect.value = String(state.settings.maxRounds || 3);

    renderSidebar();
    renderHeader();
    renderSandboxCapsule();
    renderIndicator();
    renderMessages();
    renderMentionPopup();
  }

  function renderSidebar() {
    const q = state.searchQuery.trim().toLowerCase();
    const groups = state.rooms.filter((r) => r.type === 'group');
    const dms = state.rooms.filter((r) => r.type === 'dm');
    const agentMap = new Map(state.agents.map((a) => [a.id, a]));

    els.groupList.innerHTML = '';
    for (const room of groups) {
      const label = getDisplayName(room);
      if (q && !label.toLowerCase().includes(q)) continue;
      const item = document.createElement('div');
      item.className = `nav-item${room.id === state.currentRoomId ? ' active' : ''}`;
      item.innerHTML = `
        <div class="nav-avatar group-avatar">#</div>
        <div class="nav-meta">
          <div class="nav-title">${md.escapeHtml(label)}</div>
          <div class="nav-subtitle">${room.memberIds.length} AI · ${md.escapeHtml((room.lastMessage && room.lastMessage.content) || '')}</div>
        </div>
      `;
      item.addEventListener('click', () => selectRoom(room.id));
      els.groupList.appendChild(item);
    }

    els.dmList.innerHTML = '';
    for (const room of dms) {
      const agent = agentMap.get(room.memberIds[0]);
      if (!agent) continue;
      const label = getDisplayName(agent);
      const roleTitle = getDisplayTitle(agent);
      if (q && !label.toLowerCase().includes(q) && !roleTitle.toLowerCase().includes(q)) continue;
      const item = document.createElement('div');
      item.className = `nav-item${room.id === state.currentRoomId ? ' active' : ''}`;
      item.innerHTML = `
        <div class="nav-avatar" style="background:${md.escapeHtml(agent.color || '#6366f1')}">${md.escapeHtml(agent.avatarText || label.slice(0, 1))}</div>
        <div class="nav-meta">
          <div class="nav-title-row">
            <span class="nav-title">${md.escapeHtml(label)}</span>
          </div>
          <div class="nav-subtitle">${md.escapeHtml(roleTitle)}</div>
        </div>
        <button type="button" class="nav-edit-btn" title="Edit">
          <svg class="icon-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>
          </svg>
        </button>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.nav-edit-btn')) return;
        selectRoom(room.id);
      });
      item.querySelector('.nav-edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openAgentModal(agent);
      });
      els.dmList.appendChild(item);
    }
  }

  function renderHeader() {
    const room = getCurrentRoom();
    if (!room) return;
    const agentMap = new Map(state.agents.map((a) => [a.id, a]));
    const members = (room.memberIds || []).map((id) => agentMap.get(id)).filter(Boolean);

    els.currentRoomTitle.textContent = getDisplayName(room);
    els.roomAvatarsStack.innerHTML = '';
    for (const m of members.slice(0, 5)) {
      const av = document.createElement('span');
      av.className = 'mini-avatar';
      av.style.background = m.color || '#38bdf8';
      av.title = `${getDisplayName(m)} · ${getDisplayTitle(m)}`;
      av.textContent = m.avatarText || getDisplayName(m).slice(0, 1);
      els.roomAvatarsStack.appendChild(av);
    }

    if (room.type === 'group') {
      els.roomMembersMeta.textContent = members.map((m) => `@${getDisplayName(m)}`).join(' · ');
      els.chatInput.placeholder = i18n.t('inputPlaceholderGroup');
    } else {
      const agent = members[0];
      els.roomMembersMeta.textContent = agent ? getDisplayTitle(agent) : '';
      els.chatInput.placeholder = i18n.t('inputPlaceholderDm');
    }
  }

  function renderSandboxCapsule() {
    const count = state.grants.length;
    if (count > 0) {
      els.btnSandboxCapsule.classList.add('has-grants');
      els.sandboxCapsuleText.textContent =
        count === 1 ? state.grants[0].name : i18n.t('grantCount', { count });
    } else {
      els.btnSandboxCapsule.classList.remove('has-grants');
      els.sandboxCapsuleText.textContent = i18n.t('grantNone');
    }
  }

  function renderIndicator() {
    const rs = state.roomRunState || {};
    const status = rs.status || 'IDLE';
    els.orchestratorIndicator.className = 'status-pill indicator-pill';

    let labelKey = 'statusIdle';
    if (rs.running || status === 'RUNNING') {
      els.orchestratorIndicator.classList.add('running');
      labelKey = 'statusRunning';
    } else if (status === 'PAUSED_MAX_ROUNDS') {
      els.orchestratorIndicator.classList.add('paused');
      labelKey = 'statusPaused';
    } else if (status === 'CIRCUIT_OPEN_REVIEW') {
      els.orchestratorIndicator.classList.add('breaker');
      labelKey = 'statusBreaker';
    } else if (status === 'NEED_USER') {
      els.orchestratorIndicator.classList.add('paused');
      labelKey = 'statusNeedUser';
    } else if (status === 'COMPLETED' || status === 'RESOLVED_BY_USER') {
      els.orchestratorIndicator.classList.add('completed');
      labelKey = 'statusCompleted';
    } else if (status === 'ABORTED') {
      labelKey = 'statusAborted';
    } else if (status === 'ERROR') {
      els.orchestratorIndicator.classList.add('error');
      labelKey = 'statusError';
    }

    const round = rs.round || 0;
    const maxRounds = rs.maxRounds || state.settings.maxRounds || 3;
    const rejects = rs.reviewRejectCount || 0;
    const maxRejects = rs.maxReviewRejects || state.settings.maxReviewRejects || 2;

    els.indicatorStatusText.textContent =
      rs.running && rs.currentAgentName
        ? `${rs.currentAgentName} · ${i18n.t(labelKey)}`
        : i18n.t(labelKey);
    els.indicatorRoundText.textContent = i18n.t('roundBadge', { round, max: maxRounds });
    els.indicatorRejectText.textContent = i18n.t('rejectBadge', { count: rejects, max: maxRejects });

    // 发送 / 中止按钮切换
    if (rs.running) {
      els.btnSend.classList.add('hidden');
      els.btnAbort.classList.remove('hidden');
    } else {
      els.btnSend.classList.remove('hidden');
      els.btnAbort.classList.add('hidden');
    }
  }

  function renderAttachedFiles() {
    els.attachedFilesBar.innerHTML = '';
    if (state.attachedFiles.length === 0) {
      els.attachedFilesBar.classList.add('hidden');
      return;
    }
    els.attachedFilesBar.classList.remove('hidden');
    for (const filePath of state.attachedFiles) {
      const name = filePath.split(/[\\/]/).pop() || filePath;
      const chip = document.createElement('span');
      chip.className = 'attached-chip';
      chip.innerHTML = `<span>${md.escapeHtml(name)}</span><button type="button" title="Remove">&times;</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        state.attachedFiles = state.attachedFiles.filter((f) => f !== filePath);
        renderAttachedFiles();
      });
      els.attachedFilesBar.appendChild(chip);
    }
  }

  function createMessageElement(msg, isLatestBreaker) {
    const agentNames = getAgentNamesForHighlight();
    const copyLabel = i18n.t('copyCode');

    if (msg.senderType === 'system') {
      const row = document.createElement('div');
      row.className = 'msg-row system';
      const isBreaker = msg.meta && msg.meta.kind === 'breaker';
      const card = document.createElement('div');
      card.className = `system-card${isBreaker ? ' breaker-card' : ''}`;
      card.innerHTML = `
        <div class="system-card-title">${md.escapeHtml(msg.senderName || '系统')} · ${formatTime(msg.createdAt)}</div>
        <div class="md-content">${md.renderMarkdown(msg.content, { agentNames, copyLabel })}</div>
      `;

      if (isBreaker && isLatestBreaker && !state.roomRunState.running) {
        const actions = document.createElement('div');
        actions.className = 'breaker-actions';

        const btnContinue = document.createElement('button');
        btnContinue.type = 'button';
        btnContinue.className = 'btn-primary btn-sm';
        btnContinue.textContent = i18n.t('breakerContinue');
        btnContinue.addEventListener('click', () => handleContinueRoom(false));

        const btnReset = document.createElement('button');
        btnReset.type = 'button';
        btnReset.className = 'btn-subtle btn-sm';
        btnReset.textContent = i18n.t('breakerResetContinue');
        btnReset.addEventListener('click', () => handleContinueRoom(true));

        const btnResolve = document.createElement('button');
        btnResolve.type = 'button';
        btnResolve.className = 'btn-subtle btn-sm';
        btnResolve.textContent = i18n.t('breakerResolve');
        btnResolve.addEventListener('click', handleResolveBreaker);

        if (msg.meta.reason !== 'REVIEW_REJECT_LIMIT') {
          actions.appendChild(btnContinue);
        } else {
          actions.appendChild(btnReset);
        }
        actions.appendChild(btnResolve);
        card.appendChild(actions);
      }

      row.appendChild(card);
      return row;
    }

    const row = document.createElement('div');
    row.className = `msg-row ${msg.senderType === 'user' ? 'user' : 'agent'}`;

    const avatar = document.createElement('div');
    avatar.className = `msg-avatar${msg.isStreaming ? ' pulsing' : ''}`;
    if (msg.senderType === 'user') {
      avatar.style.background = '#3b82f6';
      avatar.textContent = state.settings.language === 'en-US' ? 'Me' : '我';
    } else {
      avatar.style.background = msg.senderColor || '#6366f1';
      avatar.textContent = msg.avatarText || (msg.senderName || 'AI').slice(0, 1);
    }

    const wrap = document.createElement('div');
    wrap.className = 'msg-body-wrap';

    const header = document.createElement('div');
    header.className = 'msg-header';
    const roundBadge =
      msg.meta && msg.meta.round
        ? `<span class="msg-role-tag">R${msg.meta.round}/${msg.meta.maxRounds || state.settings.maxRounds}</span>`
        : '';
    const titleBadge = msg.senderTitle ? `<span class="msg-role-tag">${md.escapeHtml(msg.senderTitle)}</span>` : '';
    const streamStatus = msg.isStreaming
      ? `<span class="stream-status-pill">${md.escapeHtml(
          msg.content && msg.content !== '...' ? i18n.t('streamStreaming') : i18n.t('streamThinking')
        )}</span>`
      : '';
    header.innerHTML = `
      <span class="msg-sender">${md.escapeHtml(msg.senderName || '')}</span>
      ${titleBadge}
      ${roundBadge}
      ${streamStatus}
      <span class="msg-time">${formatTime(msg.createdAt)}</span>
    `;

    const bubbleWrap = document.createElement('div');
    bubbleWrap.className = 'msg-bubble-wrap';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = md.renderMarkdown(msg.content, { agentNames, copyLabel });
    if (msg.isStreaming) {
      const cursor = document.createElement('span');
      cursor.className = 'typing-cursor';
      bubble.appendChild(cursor);
    }
    bubbleWrap.appendChild(bubble);

    // 消息右上角毛玻璃悬浮微操作条（复制全文 / 引用追问 / 删除消息）
    if (!msg.isStreaming && msg.id) {
      const hoverBar = document.createElement('div');
      hoverBar.className = 'msg-hover-actions';
      hoverBar.innerHTML = `
        <button type="button" class="msg-action-btn" data-act="copy">${md.escapeHtml(i18n.t('actionCopy'))}</button>
        <button type="button" class="msg-action-btn" data-act="quote">${md.escapeHtml(i18n.t('actionQuote'))}</button>
        <button type="button" class="msg-action-btn danger" data-act="delete">${md.escapeHtml(i18n.t('actionDelete'))}</button>
      `;
      hoverBar.querySelector('[data-act="copy"]').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(msg.content || '');
          showToast(i18n.t('copied'));
        } catch (_) {
          showToast('Clipboard unavailable', true);
        }
      });
      hoverBar.querySelector('[data-act="quote"]').addEventListener('click', () => {
        const snippet = String(msg.content || '').replace(/\s+/g, ' ').slice(0, 120);
        const prefix = msg.senderType === 'agent' ? `@${msg.senderName} ` : '';
        els.chatInput.value = `> ${msg.senderName}: ${snippet}\n${prefix}`;
        els.chatInput.focus();
      });
      hoverBar.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        try {
          const res = await api.deleteMessage({ roomId: state.currentRoomId, messageId: msg.id });
          state.messages = res.messages || [];
          state.rooms = res.rooms || state.rooms;
          renderMessages();
          renderSidebar();
          showToast(i18n.t('msgDeletedToast'));
        } catch (err) {
          showToast(err.message, true);
        }
      });
      bubbleWrap.appendChild(hoverBar);
    }

    wrap.appendChild(header);
    wrap.appendChild(bubbleWrap);
    row.appendChild(avatar);
    row.appendChild(wrap);
    return row;
  }

  function renderWelcomeHero() {
    const hero = document.createElement('div');
    hero.className = 'welcome-hero';
    hero.innerHTML = `
      <img src="../assets/icon.png" alt="AgentRoom" class="welcome-logo" />
      <h2 class="welcome-title">${md.escapeHtml(i18n.t('welcomeHeading'))}</h2>
      <p class="welcome-sub">${md.escapeHtml(i18n.t('welcomeSub'))}</p>
      <div class="welcome-cards">
        <button type="button" class="welcome-card" data-quick="arch">
          <span class="welcome-card-icon">
            <svg class="icon-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
          </span>
          <span class="welcome-card-title">${md.escapeHtml(i18n.t('cardArchTitle'))}</span>
          <span class="welcome-card-desc">${md.escapeHtml(i18n.t('cardArchDesc'))}</span>
        </button>

        <button type="button" class="welcome-card" data-quick="breaker">
          <span class="welcome-card-icon">
            <svg class="icon-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"></path>
              <path d="M12 8v4"></path>
              <path d="M12 16h.01"></path>
            </svg>
          </span>
          <span class="welcome-card-title">${md.escapeHtml(i18n.t('cardBreakerTitle'))}</span>
          <span class="welcome-card-desc">${md.escapeHtml(i18n.t('cardBreakerDesc'))}</span>
        </button>

        <button type="button" class="welcome-card" data-quick="sandbox">
          <span class="welcome-card-icon">
            <svg class="icon-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path>
              <path d="M12 10v6"></path>
              <path d="m9 13 3-3 3 3"></path>
            </svg>
          </span>
          <span class="welcome-card-title">${md.escapeHtml(i18n.t('cardSandboxTitle'))}</span>
          <span class="welcome-card-desc">${md.escapeHtml(i18n.t('cardSandboxDesc'))}</span>
        </button>
      </div>
    `;

    hero.querySelector('[data-quick="arch"]').addEventListener('click', () => {
      els.chatInput.value = i18n.t('cardArchPrompt');
      handleSendMessage();
    });
    hero.querySelector('[data-quick="breaker"]').addEventListener('click', () => {
      els.maxRoundsSelect.value = '8';
      els.chatInput.value = i18n.t('cardBreakerPrompt');
      handleSendMessage();
    });
    hero.querySelector('[data-quick="sandbox"]').addEventListener('click', () => {
      openSandboxDrawer();
    });
    return hero;
  }

  function renderMessages() {
    els.messageStreamInner.innerHTML = '';
    const all = [...state.messages];
    if (state.streamingMessage) {
      all.push({
        id: state.streamingMessage.id,
        senderType: 'agent',
        senderId: state.streamingMessage.agent.id,
        senderName: state.streamingMessage.agent.name,
        senderTitle: state.streamingMessage.agent.title,
        senderColor: state.streamingMessage.agent.color,
        avatarText: state.streamingMessage.agent.avatarText,
        content: state.streamingMessage.text || '...',
        createdAt: new Date().toISOString(),
        isStreaming: true,
        meta: {
          round: state.streamingMessage.round,
          maxRounds: state.streamingMessage.maxRounds
        }
      });
    }

    const onlyWelcomeOrEmpty =
      all.length === 0 ||
      (all.length === 1 &&
        all[0].senderType === 'system' &&
        all[0].meta &&
        (all[0].meta.kind === 'welcome' || all[0].meta.kind === 'info'));

    if (onlyWelcomeOrEmpty) {
      els.messageStreamInner.appendChild(renderWelcomeHero());
      return;
    }

    // 只有最后一条处于挂起/熔断状态的 breaker 卡片显示操作按钮
    const canShowBreakerActions = ['PAUSED_MAX_ROUNDS', 'CIRCUIT_OPEN_REVIEW', 'NEED_USER'].includes(
      state.roomRunState.status
    );
    let lastBreakerIdx = -1;
    if (canShowBreakerActions) {
      for (let i = all.length - 1; i >= 0; i -= 1) {
        if (all[i].senderType === 'system' && all[i].meta && all[i].meta.kind === 'breaker') {
          lastBreakerIdx = i;
          break;
        }
      }
    }

    const frag = document.createDocumentFragment();
    all.forEach((msg, idx) => {
      frag.appendChild(createMessageElement(msg, idx === lastBreakerIdx));
    });
    els.messageStreamInner.appendChild(frag);
    hydrateDiffCards();
    els.messageList.scrollTop = els.messageList.scrollHeight;
  }

  async function hydrateDiffCards() {
    const placeholders = els.messageStreamInner.querySelectorAll('.diff-card-placeholder');
    for (const el of placeholders) {
      const targetPath = decodeURIComponent(el.getAttribute('data-file-edit-path') || '');
      const newContent = decodeURIComponent(el.getAttribute('data-file-edit-content') || '');
      if (!targetPath) continue;

      const card = document.createElement('div');
      card.className = 'diff-card';
      el.replaceWith(card);

      try {
        const preview = await api.previewDiff({ targetPath, newContent });
        const diff = preview.diff || { added: 0, removed: 0, lines: [], isNewFile: true };
        const badgeText = preview.exists ? i18n.t('diffModified') : i18n.t('diffNewFile');
        const snapKey = `${state.currentRoomId}::${targetPath}`;
        const hasSnapshot = state.diffSnapshots.has(snapKey);

        const linesHtml = (diff.lines || [])
          .slice(0, 120)
          .map((ln) => {
            const sign = ln.type === 'add' ? '+' : ln.type === 'del' ? '-' : ' ';
            return `<div class="diff-line ${ln.type}"><span class="diff-ln">${ln.oldLine || ''}</span><span class="diff-ln">${ln.newLine || ''}</span><span class="diff-sign">${sign}</span><span>${md.escapeHtml(ln.text)}</span></div>`;
          })
          .join('');

        card.innerHTML = `
          <div class="diff-card-header">
            <div class="diff-card-path">
              <span>${md.escapeHtml(targetPath)}</span>
              <span class="msg-role-tag">${md.escapeHtml(badgeText)}</span>
            </div>
            <div class="diff-stats">
              <span class="diff-stat-add">+${diff.added}</span>
              <span class="diff-stat-del">-${diff.removed}</span>
            </div>
          </div>
          <div class="diff-body">${linesHtml}</div>
          <div class="diff-card-footer">
            <span class="diff-status-note${preview.noGrant ? ' warn' : hasSnapshot ? ' applied' : ''}">
              ${md.escapeHtml(
                preview.noGrant
                  ? i18n.t('diffNeedGrant')
                  : hasSnapshot
                  ? i18n.t('diffAppliedTag')
                  : i18n.t('streamAwaiting')
              )}
            </span>
            <div class="diff-card-actions">
              <button type="button" class="btn-subtle btn-xs btn-diff-rollback${hasSnapshot ? '' : ' hidden'}">${md.escapeHtml(i18n.t('diffRollbackBtn'))}</button>
              <button type="button" class="btn-primary btn-xs btn-diff-apply"${preview.noGrant ? ' disabled' : ''}>${md.escapeHtml(i18n.t('diffApplyBtn'))}</button>
            </div>
          </div>
        `;

        const statusNote = card.querySelector('.diff-status-note');
        const applyBtn = card.querySelector('.btn-diff-apply');
        const rollbackBtn = card.querySelector('.btn-diff-rollback');

        applyBtn.addEventListener('click', async () => {
          try {
            if (!state.diffSnapshots.has(snapKey)) {
              state.diffSnapshots.set(snapKey, {
                targetPath,
                oldContent: preview.oldContent || '',
                existed: Boolean(preview.exists)
              });
            }
            await api.writeFile({ targetPath, content: newContent });
            statusNote.textContent = i18n.t('diffAppliedTag');
            statusNote.className = 'diff-status-note applied';
            rollbackBtn.classList.remove('hidden');
            showToast(i18n.t('diffAppliedToast', { path: targetPath }));
          } catch (err) {
            showToast(err.message, true);
          }
        });

        rollbackBtn.addEventListener('click', async () => {
          const snap = state.diffSnapshots.get(snapKey);
          if (!snap) return;
          try {
            await api.writeFile({ targetPath: snap.targetPath, content: snap.oldContent });
            state.diffSnapshots.delete(snapKey);
            statusNote.textContent = i18n.t('diffRolledBackTag');
            statusNote.className = 'diff-status-note';
            rollbackBtn.classList.add('hidden');
            showToast(i18n.t('diffRollbackToast', { path: targetPath }));
          } catch (err) {
            showToast(err.message, true);
          }
        });
      } catch (err) {
        card.innerHTML = `<div class="diff-card-footer"><span class="diff-status-note warn">${md.escapeHtml(err.message)}</span></div>`;
      }
    }
  }

  function renderMentionPopup() {
    const room = getCurrentRoom();
    const memberIds = room ? room.memberIds : [];
    const members = state.agents.filter((a) => memberIds.includes(a.id));
    els.mentionPopup.innerHTML = '';
    for (const agent of members) {
      const opt = document.createElement('div');
      opt.className = 'mention-option';
      opt.innerHTML = `
        <span class="mention-dot" style="background:${md.escapeHtml(agent.color || '#6366f1')}"></span>
        <strong>@${md.escapeHtml(agent.name)}</strong>
        <span class="muted-text">${md.escapeHtml(getDisplayTitle(agent))}</span>
      `;
      opt.addEventListener('click', () => {
        insertMention(agent.name);
        els.mentionPopup.classList.add('hidden');
      });
      els.mentionPopup.appendChild(opt);
    }
  }

  function insertMention(name) {
    const input = els.chatInput;
    const val = input.value;
    const start = input.selectionStart != null ? input.selectionStart : val.length;
    const end = input.selectionEnd != null ? input.selectionEnd : val.length;
    const prefix = val.slice(0, start);
    const suffix = val.slice(end);
    const inserted = prefix.endsWith('@') ? `${name} ` : `@${name} `;
    input.value = `${prefix}${inserted}${suffix}`;
    const cursor = prefix.length + inserted.length;
    input.setSelectionRange(cursor, cursor);
    input.focus();
  }

  async function selectRoom(roomId) {
    state.currentRoomId = roomId;
    state.streamingMessage = null;
    try {
      const data = await api.getRoomMessages(roomId);
      state.messages = data.messages || [];
      state.roomRunState = data.state || state.roomRunState;
      renderSidebar();
      renderHeader();
      renderIndicator();
      renderMessages();
      renderMentionPopup();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function handleSendMessage() {
    const text = els.chatInput.value.trim();
    if (!text) return;
    if (state.roomRunState.running) return;

    const roomId = state.currentRoomId;
    const attachedFiles = [...state.attachedFiles];
    const maxRounds = Number(els.maxRoundsSelect.value) || state.settings.maxRounds || 3;

    els.chatInput.value = '';
    state.attachedFiles = [];
    renderAttachedFiles();

    try {
      const res = await api.sendMessage({ roomId, text, attachedFiles, maxRounds });
      if (res && res.rooms) {
        state.rooms = res.rooms;
        renderSidebar();
      }
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function handleContinueRoom(resetRejects) {
    try {
      const maxRounds = Number(els.maxRoundsSelect.value) || state.settings.maxRounds || 3;
      const res = await api.continueRoom({
        roomId: state.currentRoomId,
        maxRounds,
        resetRejects
      });
      if (res && res.rooms) {
        state.rooms = res.rooms;
        renderSidebar();
      }
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function handleResolveBreaker() {
    try {
      const res = await api.resolveBreaker({
        roomId: state.currentRoomId,
        action: 'finish'
      });
      if (res && res.rooms) {
        state.rooms = res.rooms;
        renderSidebar();
      }
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function handleAbortRoom() {
    try {
      await api.abortRoom(state.currentRoomId);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // 安全沙箱抽屉（丝滑过渡）
  function openSandboxDrawer() {
    els.sandboxDrawerBackdrop.classList.add('open');
    els.sandboxDrawer.classList.add('open');
    renderSandboxDrawer();
  }

  function closeSandboxDrawer() {
    els.sandboxDrawerBackdrop.classList.remove('open');
    els.sandboxDrawer.classList.remove('open');
  }

  async function renderSandboxDrawer() {
    els.grantListContainer.innerHTML = '';
    els.fileTreeContainer.innerHTML = '';
    if (state.grants.length === 0) {
      els.fileTreeContainer.innerHTML = `<div class="muted-text" style="padding:12px;">${md.escapeHtml(i18n.t('sandboxEmpty'))}</div>`;
      els.filePreviewBox.classList.add('hidden');
      return;
    }

    for (const grant of state.grants) {
      const div = document.createElement('div');
      div.className = 'grant-item';
      div.innerHTML = `
        <div class="grant-info">
          <div class="grant-name">📁 ${md.escapeHtml(grant.name)}</div>
          <div class="grant-path" title="${md.escapeHtml(grant.path)}">${md.escapeHtml(grant.path)}</div>
        </div>
        <button type="button" class="btn-subtle btn-xs">${md.escapeHtml(i18n.t('btnRevoke'))}</button>
      `;
      div.querySelector('button').addEventListener('click', async () => {
        try {
          const res = await api.revokeFolder(grant.path);
          state.grants = res.grants || [];
          state.previewFilePath = null;
          els.filePreviewBox.classList.add('hidden');
          renderSandboxCapsule();
          renderSandboxDrawer();
          showToast(i18n.t('grantRevokedToast'));
        } catch (err) {
          showToast(err.message, true);
        }
      });
      els.grantListContainer.appendChild(div);
    }

    // 渲染所有授权目录的文件树
    for (const grant of state.grants) {
      try {
        const tree = await api.getFolderTree(grant.path);
        renderTreeNode(tree, els.fileTreeContainer, 0);
      } catch (err) {
        const errDiv = document.createElement('div');
        errDiv.className = 'muted-text';
        errDiv.textContent = err.message;
        els.fileTreeContainer.appendChild(errDiv);
      }
    }
  }

  function renderTreeNode(node, container, depth) {
    const row = document.createElement('div');
    row.className = `tree-node${state.previewFilePath === node.path ? ' active' : ''}`;
    row.style.paddingLeft = `${8 + depth * 16}px`;
    const icon = node.type === 'directory' ? '📂' : '📄';
    row.innerHTML = `<span>${icon}</span><span>${md.escapeHtml(node.name)}</span>`;
    if (node.type === 'file') {
      row.addEventListener('click', () => openFilePreview(node.path));
    }
    container.appendChild(row);

    if (node.type === 'directory' && Array.isArray(node.children)) {
      for (const child of node.children) {
        renderTreeNode(child, container, depth + 1);
      }
    }
  }

  async function openFilePreview(filePath) {
    try {
      const res = await api.readFile(filePath);
      state.previewFilePath = res.path;
      els.previewFileName.textContent = res.path;
      els.previewFileContent.value = res.content;
      els.filePreviewBox.classList.remove('hidden');
      renderSandboxDrawer();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // 卡片式模型设置弹窗
  async function refreshAgyModels(showNotice = false) {
    try {
      const res = await api.listAgyModels();
      if (res && Array.isArray(res.models) && res.models.length > 0) {
        state.agyModels = res.models;
      }
      state.agyModelsLoaded = true;
      renderProvidersGrid();
      if (showNotice) {
        if (res && res.source === 'cli') {
          showToast(`已刷新本机 agy 模型（共 ${state.agyModels.length} 个）`);
        } else {
          showToast((res && res.warning) || '已加载常用 agy 模型列表');
        }
      }
    } catch (err) {
      if (showNotice) showToast(err.message, true);
    }
  }

  function openProvidersModal() {
    renderProvidersGrid();
    els.providersModal.classList.add('open');
    if (!state.agyModelsLoaded) {
      refreshAgyModels(false);
    }
  }

  function renderDiscoveryBanner(found, elapsedMs) {
    els.discoveryBanner.classList.remove('hidden');
    els.discoveryList.innerHTML = '';

    if (!Array.isArray(found) || found.length === 0) {
      els.discoverySummaryText.textContent = i18n.t('providerScanEmpty');
      els.btnAutoConnectAll.classList.add('hidden');
      return;
    }

    els.discoverySummaryText.textContent = i18n.t('providerScanFoundTitle', {
      count: found.length,
      ms: elapsedMs || 0
    });
    els.btnAutoConnectAll.classList.remove('hidden');

    const isEn = state.settings.language === 'en-US';
    for (const item of found) {
      const row = document.createElement('div');
      row.className = 'discovery-item';
      const label = isEn && item.nameEn ? item.nameEn : item.name;
      const statusText = item.connected ? i18n.t('providerConnected') : i18n.t('providerNotConnected');
      const statusCls = item.connected ? 'connected' : 'pending';
      row.innerHTML = `
        <div class="discovery-item-main">
          <div class="discovery-item-title">
            <span>${md.escapeHtml(label)}</span>
            <span class="msg-role-tag">${md.escapeHtml(String(item.type || '').toUpperCase())}</span>
          </div>
          <div class="discovery-item-loc" title="${md.escapeHtml(item.location || '')}">${md.escapeHtml(item.location || '')}</div>
        </div>
        <span class="discovery-status-tag ${statusCls}">${md.escapeHtml(statusText)}</span>
      `;
      els.discoveryList.appendChild(row);
    }
  }

  function closeProvidersModal() {
    els.providersModal.classList.remove('open');
  }

  function renderProvidersGrid() {
    els.providersGrid.innerHTML = '';
    const isEn = state.settings.language === 'en-US';

    for (const p of state.providers) {
      const isActive = state.settings.activeProviderId === p.id;
      const card = document.createElement('div');
      card.className = `provider-card${isActive ? ' active-card' : ''}`;

      const name = isEn && p.nameEn ? p.nameEn : p.name;
      const desc = isEn && p.descriptionEn ? p.descriptionEn : p.description;

      let fieldsHtml = '';
      if (p.type === 'agy') {
        const modelList = [...state.agyModels];
        if (p.model && !modelList.some((m) => m.id === p.model)) {
          modelList.unshift({ id: p.model, label: p.model });
        }
        const optionsHtml = modelList
          .map(
            (m) =>
              `<option value="${md.escapeHtml(m.id)}"${m.id === p.model ? ' selected' : ''}>${md.escapeHtml(
                m.label && m.label !== m.id ? `${m.id} — ${m.label}` : m.id
              )}</option>`
          )
          .join('');
        fieldsHtml = `
          <div class="form-group">
            <label>${md.escapeHtml(i18n.t('providerCardName'))}</label>
            <input type="text" data-field="name" value="${md.escapeHtml(p.name || '')}" />
          </div>
          <div class="form-group">
            <label>${md.escapeHtml(i18n.t('providerModel'))}</label>
            <div class="model-select-row">
              <select data-field="model">${optionsHtml}</select>
              <button type="button" class="btn-subtle btn-xs btn-refresh-agy">${md.escapeHtml(i18n.t('providerRefreshModels'))}</button>
            </div>
          </div>
          <div class="form-group">
            <label>${md.escapeHtml(i18n.t('providerTimeout'))}</label>
            <input type="number" data-field="timeoutMs" min="5000" max="300000" value="${md.escapeHtml(p.timeoutMs || 90000)}" />
          </div>
        `;
      } else if (p.type === 'openai') {
        const keyHint = p.hasApiKey
          ? i18n.t('providerApiKeySaved', { masked: p.apiKeyMasked })
          : i18n.t('providerApiKey');
        fieldsHtml = `
          <div class="form-group">
            <label>${md.escapeHtml(i18n.t('providerCardName'))}</label>
            <input type="text" data-field="name" value="${md.escapeHtml(p.name || '')}" />
          </div>
          <div class="form-group">
            <label>${md.escapeHtml(i18n.t('providerBaseUrl'))}</label>
            <input type="text" data-field="baseUrl" value="${md.escapeHtml(p.baseUrl || '')}" />
          </div>
          <div class="form-group">
            <label>${md.escapeHtml(i18n.t('providerModel'))}</label>
            <input type="text" data-field="model" value="${md.escapeHtml(p.model || '')}" />
          </div>
          <div class="form-group">
            <label>${md.escapeHtml(keyHint)}</label>
            <input type="password" data-field="apiKey" placeholder="${md.escapeHtml(p.hasApiKey ? p.apiKeyMasked : 'sk-...')}" autocomplete="off" />
          </div>
        `;
      } else if (p.type === 'cli') {
        fieldsHtml = `
          <div class="form-group">
            <label>${md.escapeHtml(i18n.t('providerCardName'))}</label>
            <input type="text" data-field="name" value="${md.escapeHtml(p.name || '')}" />
          </div>
          <div class="form-group">
            <label>${md.escapeHtml(i18n.t('providerCliCmd'))}</label>
            <input type="text" data-field="cliCommand" value="${md.escapeHtml(p.cliCommand || '')}" />
          </div>
          <div class="form-group">
            <label>${md.escapeHtml(i18n.t('providerCliArgs'))}</label>
            <input type="text" data-field="cliArgs" value="${md.escapeHtml(p.cliArgs || '')}" />
          </div>
          <div class="form-group">
            <label>${md.escapeHtml(i18n.t('providerTimeout'))}</label>
            <input type="number" data-field="timeoutMs" min="3000" max="300000" value="${md.escapeHtml(p.timeoutMs || 30000)}" />
          </div>
        `;
      }

      const canDelete = p.id !== 'mock-demo';
      const footerHtml =
        p.type !== 'mock'
          ? `
            <div class="provider-test-status hidden"></div>
            <div class="provider-card-footer">
              <div class="provider-card-footer-left">
                <button type="button" class="btn-subtle btn-xs btn-test-card">${md.escapeHtml(i18n.t('providerTestBtn'))}</button>
                ${canDelete ? `<button type="button" class="btn-ghost-danger btn-delete-card">${md.escapeHtml(i18n.t('providerDeleteBtn'))}</button>` : ''}
              </div>
              <div class="provider-card-footer-right">
                <button type="button" class="btn-primary btn-xs btn-save-card">${md.escapeHtml(i18n.t('providerSave'))}</button>
              </div>
            </div>
          `
          : '';

      card.innerHTML = `
        <div class="provider-card-top">
          <div class="provider-card-title">${md.escapeHtml(name)}</div>
          ${
            isActive
              ? `<span class="provider-badge">${md.escapeHtml(i18n.t('providerActive'))}</span>`
              : `<button type="button" class="btn-subtle btn-xs btn-set-active">${md.escapeHtml(i18n.t('providerSetActive'))}</button>`
          }
        </div>
        <p class="muted-text">${md.escapeHtml(desc)}</p>
        ${fieldsHtml}
        ${footerHtml}
      `;

      const refreshBtn = card.querySelector('.btn-refresh-agy');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => refreshAgyModels(true));
      }

      const setActiveBtn = card.querySelector('.btn-set-active');
      if (setActiveBtn) {
        setActiveBtn.addEventListener('click', async () => {
          try {
            const payload = collectProviderPayload(p.id, card, true);
            const res = await api.saveProvider(payload);
            state.providers = res.providers;
            state.settings = res.settings;
            renderProvidersGrid();
            showToast(i18n.t('providerSavedToast'));
          } catch (err) {
            showToast(err.message, true);
          }
        });
      }

      const saveBtn = card.querySelector('.btn-save-card');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          try {
            const payload = collectProviderPayload(p.id, card, false);
            const res = await api.saveProvider(payload);
            state.providers = res.providers;
            state.settings = res.settings;
            renderProvidersGrid();
            showToast(i18n.t('providerSavedToast'));
          } catch (err) {
            showToast(err.message, true);
          }
        });
      }

      const testBtn = card.querySelector('.btn-test-card');
      const statusBox = card.querySelector('.provider-test-status');
      if (testBtn && statusBox) {
        testBtn.addEventListener('click', async () => {
          const origLabel = testBtn.textContent;
          testBtn.disabled = true;
          testBtn.textContent = i18n.t('providerTesting');
          statusBox.classList.add('hidden');
          try {
            const payload = collectProviderPayload(p.id, card, false);
            payload.type = p.type;
            const res = await api.testProvider(payload);
            statusBox.classList.remove('hidden', 'ok', 'fail');
            if (res && res.ok) {
              statusBox.classList.add('ok');
              statusBox.textContent = i18n.t('providerTestOk', {
                ms: res.latencyMs,
                reply: res.reply || 'OK'
              });
            } else {
              statusBox.classList.add('fail');
              statusBox.textContent = i18n.t('providerTestFail', {
                ms: (res && res.latencyMs) || 0,
                error: (res && res.error) || 'Unknown error'
              });
            }
          } catch (err) {
            statusBox.classList.remove('hidden', 'ok');
            statusBox.classList.add('fail');
            statusBox.textContent = err.message;
          } finally {
            testBtn.disabled = false;
            testBtn.textContent = origLabel;
          }
        });
      }

      const deleteBtn = card.querySelector('.btn-delete-card');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          try {
            const res = await api.deleteProvider(p.id);
            state.providers = res.providers;
            state.settings = res.settings;
            if (res.agents) state.agents = res.agents;
            renderProvidersGrid();
            showToast(i18n.t('providerDeletedToast'));
          } catch (err) {
            showToast(err.message, true);
          }
        });
      }

      els.providersGrid.appendChild(card);
    }
  }

  function collectProviderPayload(id, cardEl, setActive) {
    const payload = { id, setActive };
    cardEl.querySelectorAll('[data-field]').forEach((input) => {
      const key = input.getAttribute('data-field');
      payload[key] = input.value;
    });
    return payload;
  }

  // 角色编辑弹窗
  function openAgentModal(agent = null) {
    els.agentIdInput.value = agent ? agent.id : '';
    els.agentNameInput.value = agent ? agent.name : '';
    els.agentTitleInput.value = agent ? agent.title : '';
    els.agentColorInput.value = (agent && agent.color) || '#6366f1';
    els.agentPromptInput.value = (agent && agent.systemPrompt) || '';
    els.agentModalTitle.textContent = agent
      ? i18n.t('modalAgentTitleEdit')
      : i18n.t('modalAgentTitleNew');

    els.agentProviderSelect.innerHTML = `<option value="">${md.escapeHtml(i18n.t('agentProviderDefault'))}</option>`;
    for (const p of state.providers) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = state.settings.language === 'en-US' && p.nameEn ? p.nameEn : p.name;
      if (agent && agent.providerId === p.id) opt.selected = true;
      els.agentProviderSelect.appendChild(opt);
    }

    if (agent && !agent.builtin) {
      els.btnDeleteAgent.classList.remove('hidden');
    } else {
      els.btnDeleteAgent.classList.add('hidden');
    }

    els.agentModal.classList.add('open');
  }

  function closeAgentModal() {
    els.agentModal.classList.remove('open');
  }

  // 新建群聊弹窗（含 4 套场景协作模板）
  function renderRoomTemplates() {
    els.roomTemplatesGrid.innerHTML = '';
    const isEn = state.settings.language === 'en-US';
    for (const tpl of state.templates) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'template-card';
      const title = isEn && tpl.nameEn ? tpl.nameEn : tpl.name;
      const badge = isEn && tpl.badgeEn ? tpl.badgeEn : tpl.badge;
      const desc = isEn && tpl.descriptionEn ? tpl.descriptionEn : tpl.description;
      const rolesText = (tpl.roles || [])
        .map((r) => `${isEn && r.nameEn ? r.nameEn : r.name}·${isEn && r.titleEn ? r.titleEn : r.title}`)
        .join(' / ');
      card.innerHTML = `
        <div class="template-card-top">
          <span class="template-card-title">${md.escapeHtml(title)}</span>
          <span class="template-card-badge">${md.escapeHtml(badge)}</span>
        </div>
        <div class="template-card-desc">${md.escapeHtml(desc)}</div>
        <div class="template-card-roles">${md.escapeHtml(rolesText)}</div>
      `;
      card.addEventListener('click', async () => {
        try {
          const res = await api.createRoomFromTemplate({ templateId: tpl.id });
          state.agents = res.agents;
          state.rooms = res.rooms;
          closeGroupModal();
          await selectRoom(res.room.id);
          showToast(i18n.t('templateCreatedToast', { name: title }));
        } catch (err) {
          showToast(err.message, true);
        }
      });
      els.roomTemplatesGrid.appendChild(card);
    }
  }

  function openGroupModal() {
    renderRoomTemplates();
    els.groupNameInput.value = '';
    els.groupMembersCheckboxes.innerHTML = '';
    for (const a of state.agents) {
      const label = document.createElement('label');
      label.className = 'checkbox-item';
      label.innerHTML = `
        <input type="checkbox" value="${md.escapeHtml(a.id)}" checked />
        <span><strong>${md.escapeHtml(getDisplayName(a))}</strong> · ${md.escapeHtml(getDisplayTitle(a))}</span>
      `;
      els.groupMembersCheckboxes.appendChild(label);
    }
    els.groupModal.classList.add('open');
  }

  function closeGroupModal() {
    els.groupModal.classList.remove('open');
  }

  // 全局命令面板 (Ctrl+K, Raycast 风格)
  function buildCommandItems(query) {
    const q = String(query || '').trim().toLowerCase();
    const isEn = state.settings.language === 'en-US';
    const items = [];

    // 1. 快速操作命令
    const actions = [
      {
        title: isEn ? 'Scan Local AIs' : '自动扫描本机 AI 工具与服务',
        sub: isEn ? 'Action' : '快捷操作',
        run: () => {
          openProvidersModal();
          els.btnScanLocalAI.click();
        }
      },
      {
        title: isEn ? 'Open Folder Security Sandbox' : '打开文件夹安全沙箱抽屉',
        sub: isEn ? 'Action' : '快捷操作',
        run: () => openSandboxDrawer()
      },
      {
        title: isEn ? 'Export Markdown Decision Minutes' : '导出当前会话 Markdown 决策纪要',
        sub: isEn ? 'Action' : '快捷操作',
        run: () => handleExportMarkdown()
      },
      {
        title: isEn ? 'Toggle Dark / Light Theme' : '切换深色 / 浅色模式',
        sub: isEn ? 'Theme' : '外观',
        run: () => els.btnThemeToggle.click()
      },
      {
        title: isEn ? 'Switch Language (中文 / EN)' : '切换界面语言（中文 / English）',
        sub: isEn ? 'Language' : '语言',
        run: () => els.btnLangToggle.click()
      },
      {
        title: isEn ? 'Create Room from Templates' : '使用 4 套场景模板新建群聊',
        sub: isEn ? 'Template' : '模板建群',
        run: () => openGroupModal()
      }
    ];
    for (const a of actions) items.push(a);

    // 2. 4 套场景模板直达
    for (const tpl of state.templates) {
      const title = isEn && tpl.nameEn ? tpl.nameEn : tpl.name;
      items.push({
        title: `${isEn ? 'New Template Room: ' : '一键建群：'}${title}`,
        sub: isEn ? tpl.badgeEn : tpl.badge,
        run: async () => {
          const res = await api.createRoomFromTemplate({ templateId: tpl.id });
          state.agents = res.agents;
          state.rooms = res.rooms;
          await selectRoom(res.room.id);
          showToast(i18n.t('templateCreatedToast', { name: title }));
        }
      });
    }

    // 3. 切换任意群聊或私聊
    for (const r of state.rooms) {
      const label = getDisplayName(r);
      items.push({
        title: label,
        sub: r.type === 'group' ? (isEn ? 'Room' : '项目群聊') : (isEn ? 'DM' : 'AI 私聊'),
        run: () => selectRoom(r.id)
      });
    }

    if (!q) return items;
    return items.filter(
      (it) => it.title.toLowerCase().includes(q) || String(it.sub || '').toLowerCase().includes(q)
    );
  }

  function renderCommandPaletteList() {
    state.cmdItems = buildCommandItems(els.commandPaletteInput.value);
    if (state.cmdSelectedIdx >= state.cmdItems.length) {
      state.cmdSelectedIdx = 0;
    }
    els.commandPaletteList.innerHTML = '';
    if (state.cmdItems.length === 0) {
      els.commandPaletteList.innerHTML = `<div class="muted-text" style="padding:16px;text-align:center;">${md.escapeHtml(i18n.t('cmdEmpty'))}</div>`;
      return;
    }
    state.cmdItems.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = `cmd-item${idx === state.cmdSelectedIdx ? ' selected' : ''}`;
      row.innerHTML = `
        <span>${md.escapeHtml(item.title)}</span>
        <span class="cmd-item-sub">${md.escapeHtml(item.sub || '')}</span>
      `;
      row.addEventListener('click', () => executeCommandItem(idx));
      els.commandPaletteList.appendChild(row);
    });
  }

  function executeCommandItem(idx) {
    const item = state.cmdItems[idx];
    if (!item) return;
    closeCommandPalette();
    Promise.resolve(item.run()).catch((err) => showToast(err.message, true));
  }

  function openCommandPalette() {
    els.commandPaletteInput.value = '';
    state.cmdSelectedIdx = 0;
    renderCommandPaletteList();
    els.commandPaletteModal.classList.add('open');
    setTimeout(() => els.commandPaletteInput.focus(), 30);
  }

  function closeCommandPalette() {
    els.commandPaletteModal.classList.remove('open');
  }

  async function handleExportMarkdown() {
    try {
      const res = await api.exportRoomMarkdown(state.currentRoomId);
      if (res && !res.canceled && res.filePath) {
        showToast(i18n.t('exportSuccessToast', { path: res.filePath }));
      }
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function bindSidebarResizer() {
    let dragging = false;
    let currentWidth = state.settings.sidebarWidth || 268;
    const applyWidth = (w) => {
      const clamped = Math.min(380, Math.max(230, Math.round(w)));
      currentWidth = clamped;
      els.sidebar.style.width = `${clamped}px`;
    };

    els.sidebarResizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      els.sidebarResizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      applyWidth(e.clientX);
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      els.sidebarResizer.classList.remove('dragging');
      document.body.style.cursor = '';
      api.updateSettings({ sidebarWidth: currentWidth }).catch(() => {});
    });
  }

  // 监听主进程实时事件流
  function bindOrchestratorEvents() {
    api.onEvent((evt) => {
      if (!evt) return;

      if (evt.type === 'providers:updated') {
        if (Array.isArray(evt.providers)) state.providers = evt.providers;
        if (evt.settings) state.settings = evt.settings;
        if (els.providersModal.classList.contains('open')) {
          renderProvidersGrid();
        }
        return;
      }

      if (evt.roomId !== state.currentRoomId) return;

      if (evt.type === 'state:changed') {
        state.roomRunState = evt.state;
        renderIndicator();
        if (!evt.state.running) {
          renderMessages();
        }
      } else if (evt.type === 'message:created') {
        if (!state.messages.some((m) => m.id === evt.message.id)) {
          state.messages.push(evt.message);
        }
        renderMessages();
      } else if (evt.type === 'stream:start') {
        state.streamingMessage = {
          id: evt.messageId,
          agent: evt.agent,
          text: '',
          round: evt.round,
          maxRounds: evt.maxRounds
        };
        renderMessages();
      } else if (evt.type === 'stream:chunk') {
        if (state.streamingMessage && state.streamingMessage.id === evt.messageId) {
          state.streamingMessage.text = evt.fullText;
          renderMessages();
        }
      } else if (evt.type === 'stream:end') {
        state.streamingMessage = null;
        if (!state.messages.some((m) => m.id === evt.message.id)) {
          state.messages.push(evt.message);
        }
        renderMessages();
      }
    });
  }

  function bindDomEvents() {
    // 无边框窗口控制三键
    els.btnWinMin.addEventListener('click', () => api.windowMinimize());
    els.btnWinMax.addEventListener('click', () => api.windowToggleMaximize());
    els.btnWinClose.addEventListener('click', () => api.windowClose());

    // 导出 Markdown 决策纪要 & 全局命令面板 (Ctrl+K)
    els.btnExportMarkdown.addEventListener('click', handleExportMarkdown);
    els.btnCommandPalette.addEventListener('click', openCommandPalette);
    els.commandPaletteModal.addEventListener('click', (e) => {
      if (e.target === els.commandPaletteModal) closeCommandPalette();
    });
    els.commandPaletteInput.addEventListener('input', () => {
      state.cmdSelectedIdx = 0;
      renderCommandPaletteList();
    });
    els.commandPaletteInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (state.cmdItems.length > 0) {
          state.cmdSelectedIdx = (state.cmdSelectedIdx + 1) % state.cmdItems.length;
          renderCommandPaletteList();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (state.cmdItems.length > 0) {
          state.cmdSelectedIdx = (state.cmdSelectedIdx - 1 + state.cmdItems.length) % state.cmdItems.length;
          renderCommandPaletteList();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeCommandItem(state.cmdSelectedIdx);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPalette();
      }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (els.commandPaletteModal.classList.contains('open')) {
          closeCommandPalette();
        } else {
          openCommandPalette();
        }
      } else if (e.key === 'Escape' && els.commandPaletteModal.classList.contains('open')) {
        closeCommandPalette();
      }
    });

    // 支持从 Windows 资源管理器直接拖拽本地文件到输入框挂载沙箱引用
    const composerCard = document.querySelector('.composer-card');
    if (composerCard) {
      composerCard.addEventListener('dragover', (e) => {
        e.preventDefault();
        composerCard.classList.add('drag-over');
      });
      composerCard.addEventListener('dragleave', () => {
        composerCard.classList.remove('drag-over');
      });
      composerCard.addEventListener('drop', async (e) => {
        e.preventDefault();
        composerCard.classList.remove('drag-over');
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        for (const f of files) {
          if (!f || !f.path) continue;
          try {
            const valid = await api.validateDropFile(f.path);
            if (!state.attachedFiles.includes(valid.path)) {
              state.attachedFiles.push(valid.path);
              renderAttachedFiles();
            }
            showToast(i18n.t('dropFileAdded', { name: valid.name }));
          } catch (_) {
            showToast(i18n.t('dropFileOutside'), true);
          }
        }
      });
    }

    bindSidebarResizer();

    els.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderSidebar();
    });

    els.btnSend.addEventListener('click', handleSendMessage);
    els.btnAbort.addEventListener('click', handleAbortRoom);

    els.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    els.chatInput.addEventListener('input', () => {
      const val = els.chatInput.value;
      if (val.endsWith('@')) {
        els.mentionPopup.classList.remove('hidden');
      } else {
        els.mentionPopup.classList.add('hidden');
      }
    });

    els.btnMentionMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      els.mentionPopup.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.mention-wrapper')) {
        els.mentionPopup.classList.add('hidden');
      }
    });

    // 代码块复制按钮事件委托
    els.messageList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.code-copy-btn');
      if (!btn) return;
      const raw = decodeURIComponent(btn.getAttribute('data-copy-code') || '');
      try {
        await navigator.clipboard.writeText(raw);
        const orig = btn.textContent;
        btn.textContent = i18n.t('copied');
        setTimeout(() => {
          btn.textContent = orig;
        }, 1500);
      } catch (_) {
        showToast('Clipboard unavailable', true);
      }
    });

    els.maxRoundsSelect.addEventListener('change', async () => {
      try {
        state.settings = await api.updateSettings({ maxRounds: Number(els.maxRoundsSelect.value) });
        renderIndicator();
      } catch (err) {
        showToast(err.message, true);
      }
    });

    els.btnClearChat.addEventListener('click', async () => {
      try {
        const res = await api.clearRoomMessages(state.currentRoomId);
        state.messages = res.messages || [];
        state.rooms = res.rooms || state.rooms;
        state.streamingMessage = null;
        renderMessages();
        renderSidebar();
      } catch (err) {
        showToast(err.message, true);
      }
    });

    // 深浅色切换
    els.btnThemeToggle.addEventListener('click', async () => {
      const nextTheme = state.settings.theme === 'dark' ? 'light' : 'dark';
      try {
        state.settings = await api.updateSettings({ theme: nextTheme });
        applyThemeAndI18n();
      } catch (err) {
        showToast(err.message, true);
      }
    });

    // 中英双语切换
    els.btnLangToggle.addEventListener('click', async () => {
      const nextLang = state.settings.language === 'zh-CN' ? 'en-US' : 'zh-CN';
      try {
        state.settings = await api.updateSettings({ language: nextLang });
        applyThemeAndI18n();
      } catch (err) {
        showToast(err.message, true);
      }
    });

    // 沙箱抽屉
    els.btnSandboxCapsule.addEventListener('click', openSandboxDrawer);
    els.btnAttachFromSandbox.addEventListener('click', openSandboxDrawer);
    els.btnCloseSandbox.addEventListener('click', closeSandboxDrawer);
    els.sandboxDrawerBackdrop.addEventListener('click', closeSandboxDrawer);
    els.btnRefreshTree.addEventListener('click', renderSandboxDrawer);

    els.btnAddGrant.addEventListener('click', async () => {
      try {
        const res = await api.selectAndGrantFolder();
        if (!res.canceled) {
          state.grants = res.grants || [];
          renderSandboxCapsule();
          renderSandboxDrawer();
          showToast(i18n.t('grantAddedToast', { name: res.granted.name }));
        }
      } catch (err) {
        showToast(err.message, true);
      }
    });

    els.btnAttachPreviewFile.addEventListener('click', () => {
      if (!state.previewFilePath) return;
      if (!state.attachedFiles.includes(state.previewFilePath)) {
        state.attachedFiles.push(state.previewFilePath);
        renderAttachedFiles();
      }
      showToast(i18n.t('fileAttachedToast'));
      closeSandboxDrawer();
    });

    els.btnSavePreviewFile.addEventListener('click', async () => {
      if (!state.previewFilePath) return;
      try {
        await api.writeFile({
          targetPath: state.previewFilePath,
          content: els.previewFileContent.value
        });
        showToast(i18n.t('fileSavedToast'));
      } catch (err) {
        showToast(err.message, true);
      }
    });

    // 模型卡片弹窗
    els.btnProviders.addEventListener('click', openProvidersModal);
    els.btnCloseProviders.addEventListener('click', closeProvidersModal);
    els.providersModal.addEventListener('click', (e) => {
      if (e.target === els.providersModal) closeProvidersModal();
    });
    els.btnAddProviderCard.addEventListener('click', async () => {
      const type = els.newProviderTypeSelect.value || 'agy';
      try {
        const res = await api.createProvider({ type });
        state.providers = res.providers;
        state.settings = res.settings;
        renderProvidersGrid();
        els.providersGrid.scrollTop = els.providersGrid.scrollHeight;
        showToast(i18n.t('providerCreatedToast'));
      } catch (err) {
        showToast(err.message, true);
      }
    });

    els.btnScanLocalAI.addEventListener('click', async () => {
      const labelSpan = els.btnScanLocalAI.querySelector('span');
      const origText = labelSpan ? labelSpan.textContent : '';
      els.btnScanLocalAI.disabled = true;
      if (labelSpan) labelSpan.textContent = i18n.t('providerScanning');
      try {
        const res = await api.discoverProviders();
        renderDiscoveryBanner(res.found, res.elapsedMs);
      } catch (err) {
        showToast(err.message, true);
      } finally {
        els.btnScanLocalAI.disabled = false;
        if (labelSpan) labelSpan.textContent = origText;
      }
    });

    els.btnAutoConnectAll.addEventListener('click', async () => {
      els.btnAutoConnectAll.disabled = true;
      try {
        const res = await api.autoConnectProviders();
        state.providers = res.providers;
        state.settings = res.settings;
        renderProvidersGrid();
        renderDiscoveryBanner(res.found, res.elapsedMs);
        showToast(
          i18n.t('providerAutoConnectedToast', {
            added: (res.summary && res.summary.addedCount) || 0,
            updated: (res.summary && res.summary.updatedCount) || 0
          })
        );
      } catch (err) {
        showToast(err.message, true);
      } finally {
        els.btnAutoConnectAll.disabled = false;
      }
    });

    // 角色编辑弹窗
    els.btnNewAgent.addEventListener('click', () => openAgentModal(null));
    els.btnCloseAgentModal.addEventListener('click', closeAgentModal);
    els.btnCancelAgent.addEventListener('click', closeAgentModal);
    els.agentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api.upsertAgent({
          id: els.agentIdInput.value || undefined,
          name: els.agentNameInput.value,
          title: els.agentTitleInput.value,
          color: els.agentColorInput.value,
          providerId: els.agentProviderSelect.value,
          systemPrompt: els.agentPromptInput.value
        });
        state.agents = res.agents;
        state.rooms = res.rooms;
        closeAgentModal();
        renderSidebar();
        renderHeader();
        renderMentionPopup();
      } catch (err) {
        showToast(err.message, true);
      }
    });
    els.btnDeleteAgent.addEventListener('click', async () => {
      const id = els.agentIdInput.value;
      if (!id) return;
      try {
        const res = await api.deleteAgent(id);
        state.agents = res.agents;
        state.rooms = res.rooms;
        if (state.currentRoomId === `dm_${id}`) {
          state.currentRoomId = state.rooms[0].id;
        }
        closeAgentModal();
        await selectRoom(state.currentRoomId);
      } catch (err) {
        showToast(err.message, true);
      }
    });

    // 新建群聊弹窗
    els.btnNewGroup.addEventListener('click', openGroupModal);
    els.btnCloseGroupModal.addEventListener('click', closeGroupModal);
    els.btnCancelGroup.addEventListener('click', closeGroupModal);
    els.groupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const memberIds = Array.from(
        els.groupMembersCheckboxes.querySelectorAll('input[type="checkbox"]:checked')
      ).map((cb) => cb.value);
      try {
        const res = await api.createRoom({
          name: els.groupNameInput.value,
          memberIds
        });
        state.rooms = res.rooms;
        closeGroupModal();
        await selectRoom(res.room.id);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }

  async function init() {
    const ids = [
      'sidebar', 'sidebarResizer',
      'searchInput', 'btnNewGroup', 'btnNewAgent', 'groupList', 'dmList',
      'currentRoomTitle', 'roomAvatarsStack', 'roomMembersMeta',
      'btnCommandPalette', 'btnExportMarkdown',
      'btnSandboxCapsule', 'sandboxCapsuleText',
      'orchestratorIndicator', 'indicatorStatusDot', 'indicatorStatusText',
      'indicatorRoundText', 'indicatorRejectText', 'btnProviders', 'btnThemeToggle',
      'themeIconSun', 'themeIconMoon', 'btnLangToggle', 'langToggleLabel',
      'btnWinMin', 'btnWinMax', 'btnWinClose',
      'messageList', 'messageStreamInner', 'btnMentionMenu', 'mentionPopup',
      'btnAttachFromSandbox', 'attachedFilesBar', 'maxRoundsSelect', 'btnClearChat',
      'chatInput', 'btnSend', 'btnAbort', 'sandboxDrawerBackdrop', 'sandboxDrawer',
      'btnCloseSandbox', 'btnAddGrant', 'btnRefreshTree', 'grantListContainer',
      'fileTreeContainer', 'filePreviewBox', 'previewFileName', 'previewFileContent',
      'btnAttachPreviewFile', 'btnSavePreviewFile', 'providersModal', 'btnCloseProviders',
      'btnScanLocalAI', 'newProviderTypeSelect', 'btnAddProviderCard',
      'discoveryBanner', 'discoverySummaryText', 'btnAutoConnectAll', 'discoveryList',
      'providersGrid', 'agentModal', 'agentModalTitle', 'btnCloseAgentModal', 'agentForm',
      'agentIdInput', 'agentNameInput', 'agentTitleInput', 'agentColorInput',
      'agentProviderSelect', 'agentPromptInput', 'btnDeleteAgent', 'btnCancelAgent',
      'groupModal', 'btnCloseGroupModal', 'roomTemplatesGrid', 'groupForm', 'groupNameInput',
      'groupMembersCheckboxes', 'btnCancelGroup',
      'commandPaletteModal', 'commandPaletteInput', 'commandPaletteList',
      'toastContainer'
    ];
    for (const id of ids) {
      els[id] = $(id);
    }

    bindDomEvents();
    bindOrchestratorEvents();

    try {
      const boot = await api.bootstrap();
      state.settings = boot.settings;
      state.agents = boot.agents;
      state.providers = boot.providers;
      state.rooms = boot.rooms;
      state.grants = boot.grants;
      state.templates = boot.templates || [];
      state.currentRoomId = (state.rooms[0] && state.rooms[0].id) || 'room_project_default';

      if (state.settings.sidebarWidth) {
        els.sidebar.style.width = `${Math.min(380, Math.max(230, state.settings.sidebarWidth))}px`;
      }

      applyThemeAndI18n();
      await selectRoom(state.currentRoomId);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
