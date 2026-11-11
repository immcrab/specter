#!/usr/bin/env node
/**
 * Bump the site version and keep the corner badge's no-JS fallback in sync.
 *
 * Usage:
 *   node scripts/bump-version.mjs            # patch (default): 1.0.0 -> 1.0.1
 *   node scripts/bump-version.mjs minor      # 1.0.1 -> 1.1.0
 *   node scripts/bump-version.mjs major      # 1.1.0 -> 2.0.0
 *   node scripts/bump-version.mjs 2.4.0      # exact version
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const versionPath = join(root, 'version.json');
const indexPath = join(root, 'index.html');
const arg = String(process.argv[2] || 'patch').toLowerCase();

let current = '0.0.0';
try {
    const stored = JSON.parse(readFileSync(versionPath, 'utf8'));
    if (stored && typeof stored.version === 'string') current = stored.version;
} catch (error) {
    console.error('Could not read version.json:', error.message);
    process.exit(1);
}

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!match) {
    console.error(`version.json has an invalid version: ${current}`);
    process.exit(1);
}

let major = Number(match[1]);
let minor = Number(match[2]);
let patch = Number(match[3]);

if (/^\d+\.\d+\.\d+$/.test(arg)) {
    [major, minor, patch] = arg.split('.').map(Number);
} else if (arg === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
} else if (arg === 'minor') {
    minor += 1;
    patch = 0;
} else if (arg === 'patch') {
    patch += 1;
} else {
    console.error('Usage: node scripts/bump-version.mjs [patch|minor|major|x.y.z]');
    process.exit(1);
}

const version = `${major}.${minor}.${patch}`;
const updated = new Date().toISOString().slice(0, 10);
writeFileSync(versionPath, `${JSON.stringify({ version, updated }, null, 2)}\n`);

const html = readFileSync(indexPath, 'utf8');
const badgePattern = /(<a\b[^>]*\bid="siteVersion"[^>]*>)([\s\S]*?)(<\/a>)/;
if (!badgePattern.test(html)) {
    console.error('Could not find the #siteVersion badge in index.html.');
    process.exit(1);
}
const nextHtml = html.replace(badgePattern, (_whole, open, _text, close) => `${open}v${version}${close}`);
writeFileSync(indexPath, nextHtml);

console.log(`Site version ${current} -> ${version} (${updated})`);
console.log('Updated version.json and the #siteVersion badge in index.html.');
