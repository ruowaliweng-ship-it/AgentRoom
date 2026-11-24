'use strict';

(function (global) {
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatInline(text, agentNames) {
    let html = escapeHtml(text);

    // 行内代码 `code`
    html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

    // 加粗 **text**
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

    // 斜体 *text*
    html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

    // @角色 高亮
    if (Array.isArray(agentNames) && agentNames.length > 0) {
      const sorted = [...agentNames].filter(Boolean).sort((a, b) => b.length - a.length);
      const pattern = sorted
        .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      if (pattern) {
        const mentionRegex = new RegExp(`@(${pattern})(?=$|[\\s,，。.:：;；!！?？)）\\]<])`, 'gi');
        html = html.replace(mentionRegex, '<span class="mention-pill">@$1</span>');
      }
    }

    // 协议信号徽章高亮
    html = html.replace(
      /(^|[\s>。！!：:])(DONE|NEED_USER|REVIEW_REJECT|REVIEW_PASS)(?=$|[\s<.,。！!])/g,
      (_m, pre, sig) => {
        const cls =
          sig === 'REVIEW_REJECT'
            ? 'sig-reject'
            : sig === 'REVIEW_PASS' || sig === 'DONE'
            ? 'sig-pass'
            : 'sig-warn';
        return `${pre}<span class="signal-badge ${cls}">${sig}</span>`;
      }
    );

    return html;
  }

  function renderMarkdown(markdownText, options = {}) {
    const agentNames = options.agentNames || [];
    const copyLabel = options.copyLabel || '复制代码';
    const raw = String(markdownText || '');

    // 先切分围栏代码块 ```lang\n...\n```（支持 ```file-edit:相对路径 变更审批协议）
    const parts = [];
    const fenceRegex = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    while ((match = fenceRegex.exec(raw)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', value: raw.slice(lastIndex, match.index) });
      }
      const header = (match[1] || '').trim();
      const body = match[2].replace(/\r?\n$/, '');
      if (header.startsWith('file-edit:')) {
        parts.push({
          type: 'file-edit',
          targetPath: header.slice('file-edit:'.length).trim(),
          value: body
        });
      } else {
        parts.push({
          type: 'code',
          lang: header || 'text',
          value: body
        });
      }
      lastIndex = fenceRegex.lastIndex;
    }
    if (lastIndex < raw.length) {
      parts.push({ type: 'text', value: raw.slice(lastIndex) });
    }

    const htmlChunks = [];
    for (const part of parts) {
      if (part.type === 'file-edit') {
        const encPath = encodeURIComponent(part.targetPath);
        const encContent = encodeURIComponent(part.value);
        htmlChunks.push(
          `<div class="diff-card-placeholder" data-file-edit-path="${encPath}" data-file-edit-content="${encContent}"></div>`
        );
        continue;
      }
      if (part.type === 'code') {
        const encodedCode = encodeURIComponent(part.value);
        htmlChunks.push(
          `<div class="code-block">` +
            `<div class="code-block-header">` +
            `<span class="code-lang">${escapeHtml(part.lang)}</span>` +
            `<button type="button" class="code-copy-btn" data-copy-code="${encodedCode}">${escapeHtml(copyLabel)}</button>` +
            `</div>` +
            `<pre><code>${escapeHtml(part.value)}</code></pre>` +
            `</div>`
        );
        continue;
      }

      const lines = part.value.split(/\r?\n/);
      let inUl = false;
      let inOl = false;

      const closeLists = () => {
        if (inUl) {
          htmlChunks.push('</ul>');
          inUl = false;
        }
        if (inOl) {
          htmlChunks.push('</ol>');
          inOl = false;
        }
      };

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          closeLists();
          continue;
        }

        const headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed);
        if (headingMatch) {
          closeLists();
          const level = headingMatch[1].length;
          htmlChunks.push(
            `<h${level + 2} class="md-h">${formatInline(headingMatch[2], agentNames)}</h${level + 2}>`
          );
          continue;
        }

        const quoteMatch = /^>\s?(.*)$/.exec(trimmed);
        if (quoteMatch) {
          closeLists();
          htmlChunks.push(`<blockquote class="md-quote">${formatInline(quoteMatch[1], agentNames)}</blockquote>`);
          continue;
        }

        const ulMatch = /^[-*]\s+(.*)$/.exec(trimmed);
        if (ulMatch) {
          if (inOl) {
            htmlChunks.push('</ol>');
            inOl = false;
          }
          if (!inUl) {
            htmlChunks.push('<ul class="md-list">');
            inUl = true;
          }
          htmlChunks.push(`<li>${formatInline(ulMatch[1], agentNames)}</li>`);
          continue;
        }

        const olMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
        if (olMatch) {
          if (inUl) {
            htmlChunks.push('</ul>');
            inUl = false;
          }
          if (!inOl) {
            htmlChunks.push('<ol class="md-list">');
            inOl = true;
          }
          htmlChunks.push(`<li>${formatInline(olMatch[1], agentNames)}</li>`);
          continue;
        }

        closeLists();
        htmlChunks.push(`<p class="md-p">${formatInline(line, agentNames)}</p>`);
      }

      closeLists();
    }

    return htmlChunks.join('');
  }

  global.AgentRoomMarkdown = {
    renderMarkdown,
    escapeHtml
  };
})(window);
