import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const db = config.d1_databases?.find(value => value.binding === 'TRANSLATE_DB');
const session = config.kv_namespaces?.find(value => value.binding === 'SESSION');
if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(db?.database_id ?? '') ||
    !/^[a-f0-9]{32}$/i.test(session?.id ?? '')) {
  throw Error('Create the GRC D1 database and SESSION KV namespace and set their IDs before deploying.');
}
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const cli = 'node_modules/wrangler/bin/wrangler.js';
run('node_modules/astro/bin/astro.mjs', ['check']);
run('node_modules/astro/bin/astro.mjs', ['build']);
run(cli, ['d1', 'migrations', 'apply', 'TRANSLATE_DB', '--remote']);
// Production middleware requires Access JWTs even when reached through workers.dev.
run(cli, ['deploy']);
