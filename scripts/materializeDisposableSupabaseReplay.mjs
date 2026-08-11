import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import canonicalFileReader from './readCanonicalRepositoryFile.cjs';

const { readCanonicalRepositoryFile } = canonicalFileReader;

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), '..');
const rulesRelativePath = join('tests', 'fixtures', 'canonicalReplaySyntaxEdits.json');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const requireTempChild = (candidate) => {
  const tempRoot = resolve(tmpdir());
  const resolved = resolve(candidate);
  if (resolved === tempRoot || !resolved.startsWith(`${tempRoot}${sep}`)) {
    throw new Error(`Output must be a child of the system temp directory: ${resolved}`);
  }
  return resolved;
};

const validateRules = (rules) => {
  if (rules?.version !== 1 || rules?.hashAlgorithm !== 'sha256' || !Array.isArray(rules.files)) {
    throw new Error('Unsupported or malformed materialization rules.');
  }
  const canonicalCount = rules.files.filter(({ phase }) => phase === 'canonical').length;
  const imageCount = rules.files.filter(({ phase }) => phase === 'image').length;
  if (canonicalCount !== rules.expectedCanonicalCount || imageCount !== rules.expectedImageCount) {
    throw new Error(`Unexpected migration inventory: canonical=${canonicalCount}, image=${imageCount}`);
  }
  const paths = new Set();
  for (const file of rules.files) {
    if (typeof file.path !== 'string' || isAbsolute(file.path)) {
      throw new Error('Materialization rule contains an invalid path.');
    }
    const normalized = file.path.replaceAll('\\', '/');
    if (!normalized.startsWith('supabase/migrations/') || normalized.includes('../')) {
      throw new Error(`Materialization path escapes the migration directory: ${file.path}`);
    }
    if (paths.has(normalized)) throw new Error(`Duplicate materialization path: ${file.path}`);
    paths.add(normalized);
    if (!/^[a-f0-9]{64}$/.test(file.sourceSha256)
        || !/^[a-f0-9]{64}$/.test(file.materializedSha256)
        || !Array.isArray(file.edits)) {
      throw new Error(`Malformed hash or edit list: ${file.path}`);
    }
  }
};

const materializeFile = (repoRoot, file) => {
  const sourcePath = resolve(repoRoot, file.path);
  const expectedRoot = `${resolve(repoRoot, 'supabase', 'migrations')}${sep}`;
  if (!sourcePath.startsWith(expectedRoot)) {
    throw new Error(`Resolved source path escapes migration directory: ${file.path}`);
  }
  let sourceBytes = readCanonicalRepositoryFile(repoRoot, sourcePath);
  let sourceHash = sha256(sourceBytes);
  if (sourceHash !== file.sourceSha256) {
    const sourceText = sourceBytes.toString('utf8');
    const withoutCrlf = sourceText.replaceAll('\r\n', '');
    if (!withoutCrlf.includes('\r')) {
      const lfBytes = Buffer.from(sourceText.replaceAll('\r\n', '\n'), 'utf8');
      const lfHash = sha256(lfBytes);
      if (lfHash === file.sourceSha256) {
        sourceBytes = lfBytes;
        sourceHash = lfHash;
      }
    }
  }
  if (sourceHash !== file.sourceSha256) {
    throw new Error(`Source hash mismatch for ${file.path}: expected ${file.sourceSha256}, got ${sourceHash}`);
  }

  const sourceText = sourceBytes.toString('utf8');
  const newline = sourceText.includes('\r\n') ? '\r\n' : '\n';
  const withoutCrlf = sourceText.replaceAll('\r\n', '');
  if (newline === '\r\n' && withoutCrlf.includes('\n')) {
    throw new Error(`Mixed line endings rejected for ${file.path}`);
  }
  const hasTrailingNewline = sourceText.endsWith(newline);
  const lines = sourceText.split(newline);
  if (hasTrailingNewline) lines.pop();
  const touched = new Set();

  for (const edit of file.edits) {
    if (!Number.isInteger(edit.line) || edit.line < 1 || edit.line > lines.length) {
      throw new Error(`Invalid exact edit line for ${file.path}: ${edit.line}`);
    }
    if (touched.has(edit.line)) throw new Error(`Duplicate exact edit line for ${file.path}: ${edit.line}`);
    touched.add(edit.line);
    if (typeof edit.before !== 'string' || typeof edit.after !== 'string'
        || edit.after !== `${edit.before};`) {
      throw new Error(`Non-terminator edit rejected for ${file.path}:${edit.line}`);
    }
    if (lines[edit.line - 1] !== edit.before) {
      throw new Error(`Exact before mismatch for ${file.path}:${edit.line}`);
    }
    lines[edit.line - 1] = edit.after;
  }

  const materializedBytes = Buffer.from(
    `${lines.join(newline)}${hasTrailingNewline ? newline : ''}`,
    'utf8',
  );
  const materializedHash = sha256(materializedBytes);
  if (materializedHash !== file.materializedSha256) {
    throw new Error(`Materialized hash mismatch for ${file.path}: expected ${file.materializedSha256}, got ${materializedHash}`);
  }
  return { sourceBytes, materializedBytes, sourceHash, materializedHash };
};

export const materializeDisposableReplay = ({
  repoRoot = defaultRepoRoot,
  outputRoot,
} = {}) => {
  if (!outputRoot) throw new Error('An explicit temp outputRoot is required.');
  const resolvedRepoRoot = resolve(repoRoot);
  const resolvedOutputRoot = requireTempChild(outputRoot);
  if (existsSync(resolvedOutputRoot)) throw new Error(`Output already exists: ${resolvedOutputRoot}`);

  const rulesPath = resolve(resolvedRepoRoot, rulesRelativePath);
  const rules = JSON.parse(readFileSync(rulesPath, 'utf8'));
  validateRules(rules);

  // Complete every hash and exact-line check before creating output.
  const prepared = rules.files.map((file) => ({
    rule: file,
    result: materializeFile(resolvedRepoRoot, file),
  }));

  const runtimeManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceRepoRoot: resolvedRepoRoot,
    outputRoot: resolvedOutputRoot,
    expectedHistory: {
      canonical: rules.expectedCanonicalCount,
      image: rules.expectedImageCount,
      total: rules.expectedCanonicalCount + rules.expectedImageCount,
    },
    files: prepared.map(({ rule, result }) => ({
      path: rule.path,
      phase: rule.phase,
      sourceSha256: result.sourceHash,
      materializedSha256: result.materializedHash,
      exactEditsApplied: rule.edits.length,
      syntaxOnly: rule.edits.every(({ before, after }) => after === `${before};`),
    })),
  };

  try {
    for (const { rule, result } of prepared) {
      const destination = resolve(resolvedOutputRoot, rule.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, result.materializedBytes, { flag: 'wx' });
    }
    writeFileSync(
      join(resolvedOutputRoot, 'materialization-manifest.json'),
      `${JSON.stringify(runtimeManifest, null, 2)}\n`,
      { flag: 'wx' },
    );
  } catch (error) {
    rmSync(resolvedOutputRoot, { recursive: true, force: true });
    throw error;
  }

  return runtimeManifest;
};

const parseOutputArgument = (argv) => {
  const index = argv.indexOf('--output');
  if (index === -1 || !argv[index + 1] || argv.length !== 2) {
    throw new Error('Usage: node scripts/materializeDisposableSupabaseReplay.mjs --output <temp-directory>');
  }
  return argv[index + 1];
};

if (resolve(process.argv[1] ?? '') === resolve(scriptPath)) {
  try {
    const runtimeManifest = materializeDisposableReplay({ outputRoot: parseOutputArgument(process.argv.slice(2)) });
    process.stdout.write(`${JSON.stringify({
      outputRoot: runtimeManifest.outputRoot,
      manifest: join(runtimeManifest.outputRoot, 'materialization-manifest.json'),
      history: runtimeManifest.expectedHistory,
    })}\n`);
  } catch (error) {
    process.stderr.write(`[disposable-materializer] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
