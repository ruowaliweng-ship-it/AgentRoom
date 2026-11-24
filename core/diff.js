'use strict';

/**
 * 从 AI 回复 Markdown 中提取所有 ```file-edit:相对路径 ... ``` 变更块。
 * @param {string} text
 * @returns {Array<{ targetPath: string, newContent: string, index: number }>}
 */
function extractFileEdits(text) {
  const src = String(text || '');
  const edits = [];
  const regex = /```file-edit:([^\r\n`]+)\r?\n([\s\S]*?)```/g;
  let match;
  let idx = 0;
  while ((match = regex.exec(src)) !== null) {
    const targetPath = match[1].trim();
    const newContent = match[2].replace(/\r?\n$/, '');
    if (targetPath) {
      edits.push({
        targetPath,
        newContent,
        index: idx
      });
      idx += 1;
    }
  }
  return edits;
}

/**
 * 计算简洁高效的行级 Diff（基于 LCS 动态规划，超长文件自动保护降级以保持毫秒级响应）。
 * @param {string} oldText
 * @param {string} newText
 * @param {boolean} [isNewFile=false]
 */
function computeLineDiff(oldText, newText, isNewFile = false) {
  const newLines = String(newText || '').replace(/\r\n/g, '\n').split('\n');
  if (isNewFile) {
    const lines = newLines.map((text, idx) => ({
      type: 'add',
      oldLine: null,
      newLine: idx + 1,
      text
    }));
    return {
      isNewFile: true,
      added: lines.length,
      removed: 0,
      lines
    };
  }

  const oldLines = String(oldText || '').replace(/\r\n/g, '\n').split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // 若行数过大（避免 O(m*n) 内存膨胀），使用首尾公共前后缀缩减
  let prefix = 0;
  while (prefix < m && prefix < n && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < m - prefix &&
    suffix < n - prefix &&
    oldLines[m - 1 - suffix] === newLines[n - 1 - suffix]
  ) {
    suffix += 1;
  }

  const midOld = oldLines.slice(prefix, m - suffix);
  const midNew = newLines.slice(prefix, n - suffix);

  const lines = [];
  for (let i = 0; i < prefix; i += 1) {
    lines.push({ type: 'context', oldLine: i + 1, newLine: i + 1, text: oldLines[i] });
  }

  let added = 0;
  let removed = 0;

  if (midOld.length * midNew.length <= 200000) {
    const aLen = midOld.length;
    const bLen = midNew.length;
    const dp = Array.from({ length: aLen + 1 }, () => new Uint32Array(bLen + 1));

    for (let i = aLen - 1; i >= 0; i -= 1) {
      for (let j = bLen - 1; j >= 0; j -= 1) {
        if (midOld[i] === midNew[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < aLen && j < bLen) {
      if (midOld[i] === midNew[j]) {
        lines.push({
          type: 'context',
          oldLine: prefix + i + 1,
          newLine: prefix + j + 1,
          text: midOld[i]
        });
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        lines.push({
          type: 'del',
          oldLine: prefix + i + 1,
          newLine: null,
          text: midOld[i]
        });
        removed += 1;
        i += 1;
      } else {
        lines.push({
          type: 'add',
          oldLine: null,
          newLine: prefix + j + 1,
          text: midNew[j]
        });
        added += 1;
        j += 1;
      }
    }
    while (i < aLen) {
      lines.push({ type: 'del', oldLine: prefix + i + 1, newLine: null, text: midOld[i] });
      removed += 1;
      i += 1;
    }
    while (j < bLen) {
      lines.push({ type: 'add', oldLine: null, newLine: prefix + j + 1, text: midNew[j] });
      added += 1;
      j += 1;
    }
  } else {
    // 超大文件降级：中间变更段直接展示删旧增新
    for (let i = 0; i < midOld.length; i += 1) {
      lines.push({ type: 'del', oldLine: prefix + i + 1, newLine: null, text: midOld[i] });
      removed += 1;
    }
    for (let j = 0; j < midNew.length; j += 1) {
      lines.push({ type: 'add', oldLine: null, newLine: prefix + j + 1, text: midNew[j] });
      added += 1;
    }
  }

  for (let k = 0; k < suffix; k += 1) {
    lines.push({
      type: 'context',
      oldLine: m - suffix + k + 1,
      newLine: n - suffix + k + 1,
      text: oldLines[m - suffix + k]
    });
  }

  return {
    isNewFile: false,
    added,
    removed,
    lines
  };
}

module.exports = {
  extractFileEdits,
  computeLineDiff
};
