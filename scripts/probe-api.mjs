#!/usr/bin/env node
// Asks the Blizzard API which WoW Forever namespaces and realm slugs exist,
// then tries each character in characters.config.json against what it finds.
// Prints HTTP status per request; writes nothing.
//
// Usage:
//   BLIZZARD_CLIENT_ID=xxx BLIZZARD_CLIENT_SECRET=yyy node scripts/probe-api.mjs

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(join(ROOT, 'characters.config.json'), 'utf8'));
const region = (process.env.BLIZZARD_REGION || config.region || 'us').toLowerCase();
const locale = config.locale || 'en_US';
const clientId = process.env.BLIZZARD_CLIENT_ID;
const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET are required.');
  process.exit(1);
}

// Candidate flavour names after the namespace prefix. classic1x is Classic Era
// and is here as a control: if it fails too, the probe itself is broken.
const FLAVOURS = ['forever', 'classicforever', 'classic-forever', 'wowforever', 'classic1x'];
const GUESSED_SLUGS = ['pve', 'pve-us', 'forever-pve', 'normal'];

const res = await fetch('https://oauth.battle.net/token', {
  method: 'POST',
  headers: {
    Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'grant_type=client_credentials',
});
if (!res.ok) {
  console.error(`Token request failed: HTTP ${res.status}`);
  process.exit(1);
}
const token = (await res.json()).access_token;

async function get(path, namespace) {
  const url = `https://${region}.api.blizzard.com${path}?namespace=${namespace}&locale=${locale}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.text();
  let json = null;
  try { json = JSON.parse(body); } catch {}
  console.log(`${r.status}  ${namespace.padEnd(28)} ${path}` +
    (r.ok ? '' : `  ${body.replace(/\s+/g, ' ').slice(0, 120)}`));
  return r.ok ? json : null;
}

const slugify = (s) => s.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');

for (const flavour of FLAVOURS) {
  console.log(`\n== ${flavour} ==`);
  await get('/data/wow/playable-class/index', `static-${flavour}-${region}`);
  const realms = await get('/data/wow/realm/index', `dynamic-${flavour}-${region}`);
  const found = (realms?.realms || []).map((r) => r.slug);
  if (realms) {
    console.log(`   realms: ${(realms.realms || []).map((r) => `${r.slug} (${r.name})`).join(', ') || 'none'}`);
  }
  // A control flavour only proves the probe works; don't look characters up in it.
  if (flavour === 'classic1x') continue;

  const configured = config.characters.map((c) => slugify(c.realm || '')).filter(Boolean);
  const slugs = [...new Set([...configured, ...found, ...GUESSED_SLUGS])];
  for (const c of config.characters) {
    for (const slug of slugs) {
      await get(`/profile/wow/character/${slug}/${encodeURIComponent(c.name.toLowerCase())}`,
        `profile-${flavour}-${region}`);
    }
  }
}
