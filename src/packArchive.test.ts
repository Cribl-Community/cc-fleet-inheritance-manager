import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPackMetadataEdits,
  bumpPatchVersion,
  compareVersions,
  nextSharedVersion,
  readPackArchiveVersion,
  rewritePackArchive,
} from './packArchive.ts';
import { buildCrbl, extractCrbl } from './test/crblFixture.ts';

const longPath = `default/pipelines/${'nested-directory-name/'.repeat(5)}conf.yml`;

test('rewritePackArchive edits package.json, bumps the version, and leaves other files untouched', async () => {
  const pipelineConf = 'id: main\nfunctions:\n  - id: eval\n';
  const longDescription = 'Updated description. '.repeat(120); // forces package.json across several tar blocks
  const crbl = buildCrbl({
    'package.json': JSON.stringify({
      name: 'demo-pack',
      version: '1.2.7',
      displayName: 'Demo Pack',
      description: 'Old description',
      author: 'Original Author',
      tags: ['old'],
      exports: ['main'],
    }),
    'default/pipelines/main/conf.yml': pipelineConf,
    [longPath]: 'deep: true\n',
  });

  const result = await rewritePackArchive(crbl, { description: longDescription, tags: ['windows', 'splunk'] });
  const files = extractCrbl(result.archive);
  const packageJson = JSON.parse(files['package.json']);

  assert.equal(result.previousVersion, '1.2.7');
  assert.equal(result.newVersion, '1.2.8');
  assert.deepEqual(result.warnings, []);
  assert.equal(packageJson.version, '1.2.8');
  assert.equal(packageJson.description, longDescription);
  assert.deepEqual(packageJson.tags, ['windows', 'splunk']);
  assert.equal(packageJson.displayName, 'Demo Pack');
  assert.equal(packageJson.author, 'Original Author');
  assert.deepEqual(packageJson.exports, ['main']);
  assert.equal(files['default/pipelines/main/conf.yml'], pipelineConf);
  assert.equal(files[longPath], 'deep: true\n');
});

test('rewritePackArchive rejects archives without a pack package.json', async () => {
  const crbl = buildCrbl({ 'default/pipelines/main/conf.yml': 'id: main\n' });

  await assert.rejects(() => rewritePackArchive(crbl, { description: 'x' }), /Could not find the pack package\.json/);
});

test('applyPackMetadataEdits leaves category-style tags alone and reports it', () => {
  const categoryTags = { dataType: ['logs'], technology: ['windows'] };
  const { packageJson, warnings } = applyPackMetadataEdits({ version: '1.0.0', tags: categoryTags }, { tags: ['new'] });

  assert.deepEqual(packageJson.tags, categoryTags);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Tags were not changed/);
});

test('bumpPatchVersion increments the patch number and rejects non-semver versions', () => {
  assert.equal(bumpPatchVersion('1.2.7'), '1.2.8');
  assert.equal(bumpPatchVersion('2.0.0-beta.1'), '2.0.1');
  assert.throws(() => bumpPatchVersion('latest'), /not a semantic version/);
  assert.throws(() => bumpPatchVersion(undefined), /not a semantic version/);
});

test('nextSharedVersion bumps the latest version across fleets, compared numerically', () => {
  assert.equal(nextSharedVersion(['1.2.7', '1.2.11', undefined, 'latest', '1.2.10']), '1.2.12');
  assert.equal(nextSharedVersion(['1.10.0', '1.9.9']), '1.10.1');
  assert.throws(() => nextSharedVersion([undefined, 'latest']), /None of the fleets/);
  assert.ok(compareVersions('1.2.11', '1.2.7') > 0);
  assert.equal(compareVersions('1.2.7', '1.2.7'), 0);
});

test('rewritePackArchive applies an explicit shared version and refuses one that is not newer', async () => {
  const crbl = buildCrbl({ 'package.json': JSON.stringify({ name: 'demo-pack', version: '1.2.7' }) });

  assert.equal(await readPackArchiveVersion(crbl), '1.2.7');

  const result = await rewritePackArchive(crbl, { author: 'Me' }, { version: '1.2.12' });

  assert.equal(result.previousVersion, '1.2.7');
  assert.equal(result.newVersion, '1.2.12');
  assert.equal(JSON.parse(extractCrbl(result.archive)['package.json']).version, '1.2.12');
  await assert.rejects(() => rewritePackArchive(crbl, { author: 'Me' }, { version: '1.2.7' }), /not newer than the installed version 1\.2\.7/);
});
