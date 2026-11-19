// Token launch radar for make.fun's token-radar-01 (Node 22, standard library only, no network).
//
// Reads the sealed DefiLlama snapshot, values every pre-token protocol by comparables (lib/model.ts),
// writes the ranked board, the dashboard's data, the dashboard and its screenshots, then the dossier the
// judge reads. Both runs must write the same bytes, so nothing here reads the clock or the environment
// beyond the output directory.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`radar: ${message}\n`);
  process.exit(code);
}

const input = flag('input') ?? '/input';
const snapshotPath = input.endsWith('.json') ? input : join(input, 'snapshot.json');
if (!existsSync(snapshotPath)) fail(`no snapshot at ${snapshotPath}`, 2);
const out = flag('output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the board would fail the gate: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: radar.model, as_of: radar.as_of, rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's plain files (no dot-files, no subdirectories) and return their names, sorted. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}

// The gate refuses any http(s) address in the page's files, and the judge reads at most 64 KB of source.
let sourceBytes = 0;
for (const n of readdirSync(join(root, 'dashboard'))) {
  const text = readFileSync(join(root, 'dashboard', n), 'utf8');
  sourceBytes += Buffer.byteLength(text);
  if (/https?:\/\//i.test(text)) fail(`dashboard/${n} names a network address`);
}
if (sourceBytes > 60_000) fail(`dashboard source is ${sourceBytes} bytes; keep it under 60 KB so the dossier shows it whole`);

const pages = copyDir(join(root, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(root, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images; the gate wants 3 or 4`);

// Last: the scorer rebuilds the dossier from this directory and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const wl = board.filter((r) => r.watchlist).length;
process.stdout.write(
  `radar ${radar.model}: ${board.length} rows (${wl}/${radar.counts.watchlist} watchlist), ${radar.counts.live} live comps, ` +
    `${radar.counts.set_aside} wrapper records set aside; top: ${board[0]!.name} ${board[0]!.implied_value_usd}\n` +
    `radar: wrote board.json, data.js, dashboard/ (${pages.length} files), screenshots/ (${shots.length}), dossier.json to ${out}\n`,
);
