#!/usr/bin/env node
// Pulls every character in characters.config.json from the Blizzard Profile API
// and writes data/characters.json (+ data/characters.js so index.html also
// works when opened straight from disk).
//
// Usage:
//   BLIZZARD_CLIENT_ID=xxx BLIZZARD_CLIENT_SECRET=yyy node scripts/fetch-characters.mjs
//
// Without credentials it still runs and builds the file from the "manual"
// sections of the config, so the site always has something to show.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = process.env.TRACKER_CONFIG || join(ROOT, 'characters.config.json');
const OUT_JSON = join(ROOT, 'data', 'characters.json');
const OUT_JS = join(ROOT, 'data', 'characters.js');

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
const region = (process.env.BLIZZARD_REGION || config.region || 'eu').toLowerCase();
const locale = config.locale || 'en_GB';
const namespace = (process.env.BLIZZARD_NAMESPACE || config.namespace || 'profile-classicforever-{region}')
  .replace('{region}', region);
const clientId = process.env.BLIZZARD_CLIENT_ID;
const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;

const previous = await readPrevious();

// ---------------------------------------------------------------- API helpers

async function getToken() {
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function api(token, path) {
  const url = `https://${region}.api.blizzard.com${path}` +
    `${path.includes('?') ? '&' : '?'}namespace=${encodeURIComponent(namespace)}&locale=${locale}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${path}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const slugify = (s) => s.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');

// ---------------------------------------------------------------- normalisers
// Blizzard's response shapes differ slightly between Retail and Classic
// flavours, so each normaliser reads defensively.

function normProfile(p) {
  return {
    name: p.name,
    level: p.level,
    race: p.race?.name,
    class: p.character_class?.name,
    gender: p.gender?.name,
    faction: p.faction?.name,
    realm: p.realm?.name,
    guild: p.guild?.name ?? null,
    itemLevel: p.equipped_item_level ?? p.average_item_level ?? null,
    lastLogin: p.last_login_timestamp ?? null,
  };
}

function normEquipment(e) {
  return (e.equipped_items || []).map((it) => ({
    slot: it.slot?.type,
    slotName: it.slot?.name,
    id: it.item?.id ?? null,
    name: it.name,
    quality: it.quality?.type?.toLowerCase() ?? 'common',
    itemLevel: it.level?.value ?? null,
    enchants: (it.enchantments || []).map((en) => en.display_string).filter(Boolean),
  }));
}

function normSpecs(s) {
  // Classic: specialization_groups[].specializations[] with spent_points
  const groups = s.specialization_groups || [];
  const group = groups.find((g) => g.is_active) || groups[0];
  if (group?.specializations) {
    const trees = group.specializations.map((t) => ({
      name: t.specialization_name,
      points: t.spent_points ?? 0,
      talents: (t.talents || []).map((tl) => ({
        name: tl.talent?.name ?? tl.spell_tooltip?.spell?.name,
        rank: tl.talent_rank ?? 1,
      })),
    }));
    const top = [...trees].sort((a, b) => b.points - a.points)[0];
    return { name: top?.points ? top.name : null, trees };
  }
  // Retail-style fallback
  if (s.active_specialization) {
    return { name: s.active_specialization.name, trees: [] };
  }
  return null;
}

function normProfessions(p) {
  const out = [];
  const read = (entry) => {
    const name = entry.profession?.name;
    if (!name) return;
    const tier = entry.tiers?.[entry.tiers.length - 1];
    out.push({
      name,
      skill: entry.skill_points ?? tier?.skill_points ?? 0,
      max: entry.max_skill_points ?? tier?.max_skill_points ?? null,
    });
  };
  (p.primaries || []).forEach(read);
  const secondaries = (p.secondaries || []).map((s) => {
    const tier = s.tiers?.[s.tiers.length - 1];
    return {
      name: s.profession?.name,
      skill: s.skill_points ?? tier?.skill_points ?? 0,
      max: s.max_skill_points ?? tier?.max_skill_points ?? null,
    };
  }).filter((s) => s.name);
  return { primaries: out, secondaries };
}

// ---------------------------------------------------------------- main

async function fetchCharacter(token, c) {
  const base = `/profile/wow/character/${slugify(c.realm)}/${encodeURIComponent(c.name.toLowerCase())}`;
  const result = { errors: [] };

  try {
    result.profile = normProfile(await api(token, base));
  } catch (err) {
    result.errors.push(`profile: ${err.message}`);
    return result; // No point asking for the rest if the character isn't there.
  }

  const optional = [
    ['equipment', '/equipment', normEquipment],
    ['talents', '/specializations', normSpecs],
    ['professions', '/professions', normProfessions],
  ];
  await Promise.all(optional.map(async ([key, suffix, norm]) => {
    try {
      result[key] = norm(await api(token, base + suffix));
    } catch (err) {
      result.errors.push(`${key}: ${err.message}`);
    }
  }));
  return result;
}

function buildCharacter(c, apiResult, prev) {
  const m = c.manual || {};
  const p = apiResult?.profile;
  const now = new Date().toISOString();

  // If this run failed (wholly or partly) but an earlier run succeeded, keep
  // the old API data rather than wiping the page back to manual values.
  const prevApi = prev?.source === 'api' ? prev : null;
  const last = p ? null : prevApi;

  const apiProfs = apiResult?.professions;
  const professions = apiProfs?.primaries?.length ? apiProfs.primaries : prevApi?.professions ?? m.professions ?? [];
  // The API has no weapon/defense skills, so these always come from the config,
  // topped up with any secondary professions the API does return.
  const skills = mergeByName(m.skills || [], apiProfs?.secondaries || []);

  return {
    key: slugify(c.name),
    name: p?.name ?? last?.name ?? c.name,
    displayName: c.displayName ?? c.name,
    tagline: c.tagline ?? '',
    realm: p?.realm ?? last?.realm ?? c.realm ?? '',
    race: p?.race ?? last?.race ?? m.race ?? '',
    class: p?.class ?? last?.class ?? m.class ?? '',
    level: p?.level ?? last?.level ?? m.level ?? 1,
    faction: p?.faction ?? last?.faction ?? null,
    guild: p?.guild ?? last?.guild ?? null,
    itemLevel: p?.itemLevel ?? last?.itemLevel ?? null,
    lastLogin: p?.lastLogin ?? last?.lastLogin ?? null,
    talents: apiResult?.talents ?? prevApi?.talents ?? m.talents ?? null,
    professions,
    skills,
    equipment: apiResult?.equipment ?? prevApi?.equipment ?? m.equipment ?? [],
    source: p ? 'api' : last ? 'api' : 'manual',
    updatedAt: p ? now : last?.updatedAt ?? null,
    errors: apiResult?.errors ?? [],
  };
}

function mergeByName(base, extra) {
  const map = new Map(base.map((s) => [s.name.toLowerCase(), { ...s }]));
  for (const s of extra) map.set(s.name.toLowerCase(), { ...map.get(s.name.toLowerCase()), ...s });
  return [...map.values()];
}

async function readPrevious() {
  try {
    const data = JSON.parse(await readFile(OUT_JSON, 'utf8'));
    return data.sample ? {} : Object.fromEntries((data.characters || []).map((c) => [c.key, c]));
  } catch {
    return {};
  }
}

let token = null;
let apiStatus = 'no-credentials';
if (clientId && clientSecret) {
  try {
    token = await getToken();
    apiStatus = 'ok';
  } catch (err) {
    console.error(err.message);
    apiStatus = 'token-failed';
  }
}

const characters = [];
for (const c of config.characters) {
  let apiResult = null;
  if (token && c.realm) {
    apiResult = await fetchCharacter(token, c);
    const tag = apiResult.profile ? 'ok' : 'FAILED';
    console.log(`${c.name}-${c.realm}: ${tag}${apiResult.errors.length ? ` (${apiResult.errors.join('; ')})` : ''}`);
  } else if (token) {
    console.log(`${c.name}: no realm set in config, using manual data`);
  }
  characters.push(buildCharacter(c, apiResult, previous[slugify(c.name)]));
}

const data = {
  generatedAt: new Date().toISOString(),
  region,
  namespace,
  apiStatus,
  wowheadDomain: config.wowheadDomain || 'classic',
  characters,
};

await mkdir(dirname(OUT_JSON), { recursive: true });
await writeFile(OUT_JSON, JSON.stringify(data, null, 2) + '\n');
await writeFile(OUT_JS, `window.TRACKER_DATA = ${JSON.stringify(data, null, 2)};\n`);
console.log(`Wrote ${characters.length} characters (API: ${apiStatus}, namespace: ${namespace})`);
