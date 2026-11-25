import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_LINES = 400;
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.kt']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.gradle']);
const TS_FORBIDDEN = [
  { name: 'explicit any type annotation', regex: /:\s*any\b/ },
  { name: 'any type cast', regex: /\bas\s+any\b/ },
  { name: '@ts-ignore comment', regex: /@ts-ignore/ },
  { name: '@ts-nocheck comment', regex: /@ts-nocheck/ },
];

async function collectFiles(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, out);
    } else if (SOURCE_EXTS.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }
  return out;
}

async function main() {
  const files = [
    ...(await collectFiles(path.join(ROOT_DIR, 'apps'))),
    ...(await collectFiles(path.join(ROOT_DIR, 'packages'))),
  ].sort();

  const violations = [];
  let maxLines = 0;
  let maxFile = '';

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split('\n').length;
    const rel = path.relative(ROOT_DIR, filePath);

    if (lines > maxLines) {
      maxLines = lines;
      maxFile = rel;
    }

    if (lines >= MAX_LINES) {
      violations.push(`${rel}: ${lines} lines (must be < ${MAX_LINES})`);
    }

    const ext = path.extname(filePath);
    if (ext === '.ts' || ext === '.tsx') {
      const splitLines = raw.split('\n');
      splitLines.forEach((line, idx) => {
        for (const rule of TS_FORBIDDEN) {
          if (rule.regex.test(line)) {
            violations.push(`${rel}:${idx + 1}: forbidden ${rule.name}`);
          }
        }
      });
    }
  }

  if (violations.length > 0) {
    console.error('Code rules check FAILED:');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  console.log(
    `[check:rules] OK — ${files.length} source files checked, max=${maxLines} lines (${maxFile}), 0 violations.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
