'use strict';

const fs = require('fs');
const path = require('path');

class SandboxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SandboxError';
    this.code = code;
  }
}

function normalizeForCompare(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(targetPath, rootPath) {
  const normTarget = normalizeForCompare(targetPath);
  const normRoot = normalizeForCompare(rootPath);
  if (normTarget === normRoot) return true;
  const prefix = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep;
  return normTarget.startsWith(prefix);
}

/**
 * 解析一个可能尚不存在的目标路径的真实路径（解析已存在的最近祖先的 realpath，防止符号链接逃逸）。
 */
function resolveRealPathAllowingMissingLeaf(absPath) {
  const normalized = path.resolve(absPath);
  if (fs.existsSync(normalized)) {
    return fs.realpathSync(normalized);
  }
  const missingSegments = [];
  let cursor = normalized;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      // 到达根目录仍不存在（例如无效盘符）
      return normalized;
    }
    missingSegments.unshift(path.basename(cursor));
    cursor = parent;
  }
  const realParent = fs.realpathSync(cursor);
  return path.join(realParent, ...missingSegments);
}

class FolderSandbox {
  constructor(initialGrants = []) {
    /** @type {Map<string, { path: string, realPath: string, name: string, grantedAt: string }>} */
    this.grants = new Map();
    for (const item of initialGrants) {
      const dirPath = typeof item === 'string' ? item : item && item.path;
      if (dirPath) {
        try {
          this.grant(dirPath, typeof item === 'object' ? item.grantedAt : undefined);
        } catch (_) {
          // 忽略启动时已经不存在的历史授权目录
        }
      }
    }
  }

  grant(dirPath, grantedAt) {
    if (!dirPath || typeof dirPath !== 'string') {
      throw new SandboxError('SANDBOX_INVALID_PATH', '授权目录路径无效');
    }
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) {
      throw new SandboxError('SANDBOX_NOT_FOUND', `目录不存在: ${resolved}`);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new SandboxError('SANDBOX_NOT_DIR', `目标不是文件夹: ${resolved}`);
    }
    const realPath = fs.realpathSync(resolved);
    const key = normalizeForCompare(realPath);
    const entry = {
      path: resolved,
      realPath,
      name: path.basename(resolved) || resolved,
      grantedAt: grantedAt || new Date().toISOString()
    };
    this.grants.set(key, entry);
    return { ...entry };
  }

  revoke(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') return false;
    const resolved = path.resolve(dirPath);
    const keyDirect = normalizeForCompare(resolved);
    let removed = false;
    for (const [key, entry] of this.grants.entries()) {
      if (key === keyDirect || normalizeForCompare(entry.path) === keyDirect) {
        this.grants.delete(key);
        removed = true;
      }
    }
    if (!removed && fs.existsSync(resolved)) {
      try {
        const realKey = normalizeForCompare(fs.realpathSync(resolved));
        if (this.grants.has(realKey)) {
          this.grants.delete(realKey);
          removed = true;
        }
      } catch (_) {
        // ignore
      }
    }
    return removed;
  }

  clearGrants() {
    this.grants.clear();
  }

  listGrants() {
    return Array.from(this.grants.values()).map((g) => ({ ...g }));
  }

  hasGrants() {
    return this.grants.size > 0;
  }

  getPrimaryGrant() {
    const first = this.grants.values().next();
    return first.done ? null : { ...first.value };
  }

  /**
   * 校验并返回安全真实路径。
   * 同时校验逻辑路径与 realpath，拦截 `../` 越界与指向授权目录之外的符号链接逃逸。
   */
  resolveSafePath(targetPath, baseDir = null) {
    if (!this.hasGrants()) {
      throw new SandboxError('SANDBOX_NO_GRANT', '尚未授权任何项目文件夹，请先授权目录');
    }
    if (!targetPath || typeof targetPath !== 'string') {
      throw new SandboxError('SANDBOX_INVALID_PATH', '文件路径不能为空');
    }

    let candidate;
    if (path.isAbsolute(targetPath)) {
      candidate = path.resolve(targetPath);
    } else {
      const root = baseDir ? path.resolve(baseDir) : this.getPrimaryGrant().path;
      candidate = path.resolve(root, targetPath);
    }

    // 1. 逻辑路径必须落在某个已授权目录之内
    const matchedGrant = this._findGrantForLogicalPath(candidate);
    if (!matchedGrant) {
      throw new SandboxError(
        'SANDBOX_OUT_OF_BOUNDS',
        `路径越界，不在已授权的项目目录内: ${targetPath}`
      );
    }

    // 2. 真实路径（解析符号链接）必须落在已授权目录的真实路径之内
    const realCandidate = resolveRealPathAllowingMissingLeaf(candidate);
    const insideReal = Array.from(this.grants.values()).some((g) =>
      isPathInside(realCandidate, g.realPath)
    );
    if (!insideReal) {
      throw new SandboxError(
        'SANDBOX_SYMLINK_ESCAPE',
        `检测到符号链接逃逸到授权目录之外，已拦截: ${targetPath}`
      );
    }

    return {
      logicalPath: candidate,
      realPath: realCandidate,
      grant: matchedGrant
    };
  }

  _findGrantForLogicalPath(absPath) {
    for (const g of this.grants.values()) {
      if (isPathInside(absPath, g.path) || isPathInside(absPath, g.realPath)) {
        return g;
      }
    }
    return null;
  }

  readFile(targetPath, options = {}) {
    const { baseDir = null, maxBytes = 512 * 1024 } = options;
    const { realPath, logicalPath } = this.resolveSafePath(targetPath, baseDir);
    if (!fs.existsSync(realPath)) {
      throw new SandboxError('SANDBOX_FILE_NOT_FOUND', `文件不存在: ${logicalPath}`);
    }
    const stat = fs.statSync(realPath);
    if (!stat.isFile()) {
      throw new SandboxError('SANDBOX_NOT_FILE', `目标不是普通文件: ${logicalPath}`);
    }
    if (stat.size > maxBytes) {
      const fd = fs.openSync(realPath, 'r');
      try {
        const buf = Buffer.alloc(maxBytes);
        const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
        return {
          path: logicalPath,
          realPath,
          content: buf.subarray(0, bytesRead).toString('utf8'),
          size: stat.size,
          truncated: true
        };
      } finally {
        fs.closeSync(fd);
      }
    }
    return {
      path: logicalPath,
      realPath,
      content: fs.readFileSync(realPath, 'utf8'),
      size: stat.size,
      truncated: false
    };
  }

  writeFile(targetPath, content, options = {}) {
    const { baseDir = null } = options;
    if (typeof content !== 'string') {
      throw new SandboxError('SANDBOX_INVALID_CONTENT', '写入内容必须为字符串');
    }
    const { realPath, logicalPath } = this.resolveSafePath(targetPath, baseDir);
    const parentDir = path.dirname(realPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    // 再次确认写入目标（避免目录创建后产生竞态符号链接）
    this.resolveSafePath(logicalPath, baseDir);
    fs.writeFileSync(realPath, content, 'utf8');
    const stat = fs.statSync(realPath);
    return {
      path: logicalPath,
      realPath,
      size: stat.size
    };
  }

  listDir(dirPath = null, options = {}) {
    const { baseDir = null, ignoreHidden = false } = options;
    const target = dirPath || (this.getPrimaryGrant() && this.getPrimaryGrant().path);
    const { realPath, logicalPath } = this.resolveSafePath(target, baseDir);
    if (!fs.existsSync(realPath)) {
      throw new SandboxError('SANDBOX_NOT_FOUND', `目录不存在: ${logicalPath}`);
    }
    const stat = fs.statSync(realPath);
    if (!stat.isDirectory()) {
      throw new SandboxError('SANDBOX_NOT_DIR', `目标不是文件夹: ${logicalPath}`);
    }

    const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'out']);
    const entries = fs.readdirSync(realPath, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (ignoreHidden && entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
      const childLogical = path.join(logicalPath, entry.name);
      let safe = true;
      try {
        this.resolveSafePath(childLogical, baseDir);
      } catch (_) {
        safe = false;
      }
      if (!safe) continue; // 自动过滤指向外部的危险符号链接
      let isDir = entry.isDirectory();
      let size = 0;
      try {
        const st = fs.statSync(path.join(realPath, entry.name));
        isDir = st.isDirectory();
        size = isDir ? 0 : st.size;
      } catch (_) {
        continue;
      }
      result.push({
        name: entry.name,
        path: childLogical,
        type: isDir ? 'directory' : 'file',
        size
      });
    }
    result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    return {
      path: logicalPath,
      entries: result
    };
  }

  buildTree(dirPath = null, maxDepth = 3, maxEntries = 200) {
    const target = dirPath || (this.getPrimaryGrant() && this.getPrimaryGrant().path);
    const { logicalPath } = this.resolveSafePath(target);
    let count = 0;

    const walk = (currentPath, depth) => {
      const node = {
        name: path.basename(currentPath) || currentPath,
        path: currentPath,
        type: 'directory',
        children: []
      };
      if (depth >= maxDepth || count >= maxEntries) return node;
      let listing;
      try {
        listing = this.listDir(currentPath);
      } catch (_) {
        return node;
      }
      for (const item of listing.entries) {
        if (count >= maxEntries) break;
        count += 1;
        if (item.type === 'directory') {
          node.children.push(walk(item.path, depth + 1));
        } else {
          node.children.push({
            name: item.name,
            path: item.path,
            type: 'file',
            size: item.size
          });
        }
      }
      return node;
    };

    return walk(logicalPath, 0);
  }
}

module.exports = {
  FolderSandbox,
  SandboxError,
  isPathInside
};
