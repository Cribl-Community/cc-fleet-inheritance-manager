import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const tarEnv = { ...process.env, COPYFILE_DISABLE: '1' };

/** Build a real gzipped tar (.crbl) with the system tar, archiving "." like a pack directory. */
export function buildCrbl(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const workDir = mkdtempSync(join(tmpdir(), 'crbl-fixture-'));
  const sourceDir = join(workDir, 'pack');
  const archivePath = join(workDir, 'pack.crbl');

  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(sourceDir, path)), { recursive: true });
      writeFileSync(join(sourceDir, path), content);
    }

    execFileSync('tar', ['-czf', archivePath, '-C', sourceDir, '.'], { env: tarEnv });
    return new Uint8Array(readFileSync(archivePath));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Extract an archive with the system tar and return its regular files keyed by normalized path. */
export function extractCrbl(archive: Uint8Array): Record<string, string> {
  const workDir = mkdtempSync(join(tmpdir(), 'crbl-extract-'));
  const archivePath = join(workDir, 'pack.crbl');
  const outputDir = join(workDir, 'out');

  try {
    writeFileSync(archivePath, archive);
    mkdirSync(outputDir);
    execFileSync('tar', ['-xzf', archivePath, '-C', outputDir], { env: tarEnv });

    const listing = execFileSync('tar', ['-tzf', archivePath], { env: tarEnv }).toString().split('\n');
    const files: Record<string, string> = {};

    for (const entry of listing) {
      if (!entry || entry.endsWith('/')) {
        continue;
      }

      files[entry.replace(/^(\.\/)+/, '')] = readFileSync(join(outputDir, entry), 'utf8');
    }

    return files;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
