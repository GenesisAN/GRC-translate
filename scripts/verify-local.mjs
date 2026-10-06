import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkPlaceholders } from '../src/lib/compositeFormat.ts';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const evidence = '.wrangler/local-verification';
mkdirSync(evidence, { recursive: true });
const migrate = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1',
  'migrations', 'apply', 'TRANSLATE_DB', '--local'], { encoding: 'utf8' });
assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);
writeFileSync(`${evidence}/migrations.log`, migrate.stdout + migrate.stderr);
const child = spawn(process.execPath, ['node_modules/astro/bin/astro.mjs', 'dev',
  '--host', '127.0.0.1', '--port', '8789'], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', data => { log += data; });
child.stderr.on('data', data => { log += data; });
const origin = 'http://127.0.0.1:8789';
async function request(path, body) {
  return fetch(origin + path, body === undefined ? { signal: AbortSignal.timeout(5000) } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
}
let summary = { status: 'failed' };
try {
  let response;
  for (let attempt = 0; attempt < 45; attempt++) {
    assert.equal(child.exitCode, null, log);
    try { response = await request('/api/session'); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(response?.ok, log);
  const languages = await (await request('/api/languages')).json();
  assert.ok(languages.languages.some(language => language.code === 'zh-CN'));
  response = await request('/api/catalog?lang=zh-CN');
  assert.ok(response.ok, await response.clone().text());
  const data = await response.json();
  const source = JSON.parse(readFileSync('src/locales/en/translation.json', 'utf8'));
  assert.equal(data.rows.length, Object.keys(source).length);
  const row = data.rows.find(row => row.placeholders.length);
  assert.ok(row, 'Need a live numbered-format entry');
  const bad = row.source.replace(/\{[0-9]+(?:,-?[0-9]+)?(?::[^{}]+)?\}/g, '');
  assert.ok(checkPlaceholders(row.source, bad).missing.length);
  response = await request('/api/translations', { languageCode: 'zh-CN', key: row.key, value: bad });
  assert.equal(response.status, 400);
  response = await request('/api/translations', { languageCode: 'zh-CN', key: row.key, value: row.source });
  assert.ok(response.ok, await response.clone().text());
  response = await request('/api/export?lang=zh-CN');
  assert.ok(response.ok);
  assert.equal((await response.json())[row.key], row.source);
  response = await request('/api/translations', { languageCode: 'zh-CN', key: row.key, value: '' });
  assert.ok(response.ok);
  summary = { status: 'passed', entries: data.rows.length, rejectedInvalidPlaceholder: true,
    savedValidTranslation: true, exportedTranslation: true, deletedVerificationDraft: true };
  console.log('WORKBENCH_LOCAL_VERIFICATION_OK', JSON.stringify(summary));
} catch (error) {
  summary.error = String(error);
  throw error;
} finally {
  child.kill();
  writeFileSync(`${evidence}/server.log`, log);
  writeFileSync(`${evidence}/summary.json`, JSON.stringify(summary, null, 2) + '\n');
}
