'use strict';

const { readFileSync } = require('node:fs');
const { isAbsolute, relative, resolve, sep } = require('node:path');
const { spawnSync } = require('node:child_process');

const comparablePath = (value) => {
  const resolved = resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const runGit = (repoRoot, args) => spawnSync('git', ['-C', repoRoot, ...args], {
  encoding: null,
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
});

const normalizeWorkingText = (bytes, relativePath) => {
  const text = bytes.toString('utf8');
  const withoutCrlf = text.replaceAll('\r\n', '');
  if (withoutCrlf.includes('\r')) {
    throw new Error(`Bare carriage return rejected for ${relativePath}`);
  }
  return Buffer.from(text.replaceAll('\r\n', '\n'), 'utf8');
};

const readCanonicalRepositoryFile = (repoRoot, requestedPath) => {
  const resolvedRoot = resolve(repoRoot);
  const resolvedPath = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(resolvedRoot, requestedPath);
  const relativePath = relative(resolvedRoot, resolvedPath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Canonical file path escapes repository root: ${requestedPath}`);
  }

  const workingBytes = readFileSync(resolvedPath);
  const topLevel = runGit(resolvedRoot, ['rev-parse', '--show-toplevel']);
  if (topLevel.status !== 0) return workingBytes;

  const reportedRoot = topLevel.stdout.toString('utf8').trim();
  if (comparablePath(reportedRoot) !== comparablePath(resolvedRoot)) {
    throw new Error(`Repository root mismatch: expected ${resolvedRoot}, got ${reportedRoot}`);
  }

  const gitPath = relativePath.split(sep).join('/');
  const eolAttribute = runGit(resolvedRoot, ['check-attr', 'eol', '--', gitPath]);
  if (eolAttribute.status !== 0) {
    throw new Error(`Unable to resolve EOL policy for ${gitPath}`);
  }
  if (!eolAttribute.stdout.toString('utf8').trim().endsWith(': eol: lf')) {
    return workingBytes;
  }

  const blob = runGit(resolvedRoot, ['cat-file', 'blob', `HEAD:${gitPath}`]);
  if (blob.status !== 0) {
    const indexBlob = runGit(resolvedRoot, ['cat-file', 'blob', `:${gitPath}`]);
    if (indexBlob.status === 0) {
      const normalizedWorkingBytes = normalizeWorkingText(workingBytes, gitPath);
      if (!normalizedWorkingBytes.equals(indexBlob.stdout)) {
        throw new Error(`Working tree content differs from canonical Git index blob for ${gitPath}`);
      }
      return indexBlob.stdout;
    }
    const tracked = runGit(resolvedRoot, ['ls-files', '--error-unmatch', '--', gitPath]);
    if (tracked.status !== 0) return normalizeWorkingText(workingBytes, gitPath);
    throw new Error(`Canonical Git blob is unavailable for ${gitPath}`);
  }

  const canonicalBytes = blob.stdout;
  const normalizedWorkingBytes = normalizeWorkingText(workingBytes, gitPath);
  if (!normalizedWorkingBytes.equals(canonicalBytes)) {
    throw new Error(`Working tree content differs from canonical Git blob for ${gitPath}`);
  }
  return canonicalBytes;
};

module.exports = { readCanonicalRepositoryFile };
