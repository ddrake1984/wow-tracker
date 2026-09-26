(() => {
  const CLASS_COLORS = {
    Warrior: '#C69B6D', Paladin: '#F48CBA', Hunter: '#AAD372', Rogue: '#FFF468', Priest: '#FFFFFF',
    Shaman: '#0070DD', Mage: '#3FC7EB', Warlock: '#8788EE', Druid: '#FF7C0A',
  };

  // Character-sheet layout: left column, right column, weapons.
  const GEAR_LEFT = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST'];
  const GEAR_RIGHT = ['HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2'];
  const GEAR_WEAPONS = ['MAIN_HAND', 'OFF_HAND', 'RANGED'];
  const SLOT_LABEL = {
    HEAD: 'Head', NECK: 'Neck', SHOULDER: 'Shoulder', BACK: 'Back', CHEST: 'Chest', SHIRT: 'Shirt',
    TABARD: 'Tabard', WRIST: 'Wrist', HANDS: 'Hands', WAIST: 'Waist', LEGS: 'Legs', FEET: 'Feet',
    FINGER_1: 'Ring 1', FINGER_2: 'Ring 2', TRINKET_1: 'Trinket 1', TRINKET_2: 'Trinket 2',
    MAIN_HAND: 'Main Hand', OFF_HAND: 'Off Hand', RANGED: 'Ranged',
  };

  const $roster = document.getElementById('roster');
  const $detail = document.getElementById('detail');
  const $status = document.getElementById('status');

  let data = null;
  let selected = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const color = (c) => CLASS_COLORS[c.class] || 'var(--gold)';
  const pct = (v, max) => (max ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
  }
  function load(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function timeAgo(iso) {
    if (!iso) return 'never';
    const t = typeof iso === 'number' ? iso : Date.parse(iso);
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs} h ago`;
    return `${Math.round(hrs / 24)} days ago`;
  }

  function bar(label, value, max, cls = '') {
    const zero = !value ? ' zero' : '';
    return `<div class="bar-row">
      <div class="lbl"><span>${esc(label)}</span><span>${value ?? 0}${max ? ` / ${max}` : ''}</span></div>
      <div class="bar ${cls}${zero}"><i style="width:${pct(value, max)}%"></i></div>
    </div>`;
  }

  // ------------------------------------------------------------ status line

  function renderStatus() {
    const msgs = {
      'ok': ['ok', 'Live from Blizzard API'],
      'no-credentials': ['warn', 'Manual data (no API credentials yet)'],
      'token-failed': ['warn', 'API login failed, showing last known data'],
      'sample': ['warn', 'Sample data'],
    };
    // Logged in fine, but no character was found yet (no realm set, or WoW Forever API not live)
    if (data.apiStatus === 'ok' && !data.characters.some((c) => c.source === 'api')) {
      msgs.ok = ['ok', 'API connected, waiting for characters'];
    }
    const [cls, text] = msgs[data.apiStatus] || ['warn', data.apiStatus];
    $status.innerHTML = `<span class="pill ${cls}">${esc(text)}</span> · last change ${esc(timeAgo(data.generatedAt))}`;
  }

  // ------------------------------------------------------------ roster

  function renderRoster() {
    $roster.innerHTML = data.characters.map((c) => `
      <button class="card" role="tab" aria-selected="${c.key === selected}" data-key="${esc(c.key)}" style="--class:${color(c)}">
        <span class="lvl">${esc(c.level)}</span>
        <div class="nm">${esc(c.displayName)}</div>
        <div class="meta">${esc(c.race)} ${esc(c.class)}${c.talents?.name ? ` · ${esc(c.talents.name)}` : ''}</div>
        <div class="profs">${c.professions.map((p) => `${esc(p.name)} ${p.skill ?? 0}`).join(' · ') || 'No professions'}</div>
        <div class="xpbar"><div class="bar cls"><i style="width:${pct(c.level, 60)}%"></i></div></div>
      </button>`).join('');
    $roster.setAttribute('role', 'tablist');
    $roster.querySelectorAll('.card').forEach((el) => el.addEventListener('click', () => select(el.dataset.key)));
  }

  // ------------------------------------------------------------ detail

  function gearSlot(slot, items, domain) {
    const it = items.find((i) => i.slot === slot);
    const label = SLOT_LABEL[slot] || slot;
    if (!it) return `<div class="slot empty"><span class="sl">${label}</span><span class="it">Empty</span></div>`;
    const q = `q-${esc(it.quality || 'common')}`;
    const name = it.id
      ? `<a class="${q}" href="https://www.wowhead.com/${esc(domain)}/item=${it.id}" data-wowhead="item=${it.id}&domain=${esc(domain)}" target="_blank" rel="noopener">${esc(it.name)}</a>`
      : `<span class="${q}">${esc(it.name)}</span>`;
    const ench = (it.enchants || []).map((e) => `<span class="ench">${esc(e)}</span>`).join('');
    return `<div class="slot"><span class="sl">${label}</span><span class="it">${name}${ench}</span>${it.itemLevel ? `<span class="ilvl">${it.itemLevel}</span>` : ''}</div>`;
  }

  function renderGear(c) {
    const items = c.equipment || [];
    const d = data.wowheadDomain || 'classic';
    const col = (slots) => `<div class="gear-col">${slots.map((s) => gearSlot(s, items, d)).join('')}</div>`;
    return `<div class="box"><h3>Equipped Gear${c.itemLevel ? ` <small class="badge">avg ilvl ${esc(c.itemLevel)}</small>` : ''}</h3>
      <div class="gear">${col(GEAR_LEFT)}${col(GEAR_RIGHT)}</div>
      <div class="gear weapons">${col(GEAR_WEAPONS)}</div>
    </div>`;
  }

  function renderTalents(c) {
    const t = c.talents;
    if (!t || !(t.trees?.length || t.name)) {
      return `<div class="box"><h3>Talents</h3><p class="empty-note">No talent points spent yet (talents start at level 10).</p></div>`;
    }
    const top = Math.max(...(t.trees || []).map((x) => x.points), 0);
    const trees = (t.trees || []).map((x) => `
      <div class="tree ${x.points && x.points === top ? 'top' : ''}"><div class="pts">${x.points}</div><div class="tn">${esc(x.name)}</div></div>`).join('');
    const split = (t.trees || []).map((x) => x.points).join(' / ');
    const talents = (t.trees || []).flatMap((x) => x.talents || []);
    return `<div class="box"><h3>Talents</h3>
      <p class="spec-name">${t.name ? `<strong style="color:${color(c)}">${esc(t.name)}</strong>` : ''} ${split ? `<span class="badge">${split}</span>` : ''}</p>
      ${trees ? `<div class="trees">${trees}</div>` : ''}
      ${talents.length ? `<ul class="talent-list">${talents.map((x) => `<li>${esc(x.name)} ${x.rank > 1 ? `(${x.rank})` : ''}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function renderSkills(title, list, emptyText) {
    const body = list?.length
      ? `<div class="bars">${list.map((s) => bar(s.name, s.skill, s.max)).join('')}</div>`
      : `<p class="empty-note">${emptyText}</p>`;
    return `<div class="box"><h3>${title}</h3>${body}</div>`;
  }

  function renderDetail() {
    const c = data.characters.find((x) => x.key === selected);
    if (!c) { $detail.innerHTML = ''; return; }
    const badges = [
      c.faction && `<span class="badge">${esc(c.faction)}</span>`,
      c.realm && `<span class="badge">${esc(c.realm)}</span>`,
      c.guild && `<span class="badge">&lt;${esc(c.guild)}&gt;</span>`,
      c.source === 'api'
        ? `<span class="badge api">API · ${esc(timeAgo(c.updatedAt))}</span>`
        : `<span class="badge manual">Manual data</span>`,
      c.lastLogin && `<span class="badge">Last online ${esc(timeAgo(c.lastLogin))}</span>`,
    ].filter(Boolean).join('');

    $detail.style.setProperty('--class', color(c));
    $detail.innerHTML = `
      <div class="detail-head">
        <h2>${esc(c.displayName)}</h2>
        <span class="ingame">in-game: ${esc(c.name)}</span>
        <div class="line">Level ${esc(c.level)} ${esc(c.race)} ${esc(c.class)}</div>
        ${c.tagline ? `<div class="tag">${esc(c.tagline)}</div>` : ''}
        <div class="badges">${badges}</div>
      </div>
      <div class="grid">
        <div>${renderGear(c)}${renderTalents(c)}</div>
        <div>
          ${renderSkills('Professions', c.professions, 'No professions learned yet.')}
          ${renderSkills('Skills', c.skills, 'No skills listed.')}
        </div>
      </div>
      ${c.errors?.length ? `<div class="errors">API issues on last refresh: ${c.errors.map(esc).join('; ')}</div>` : ''}`;

    if (window.$WowheadPower) window.$WowheadPower.refreshLinks();
  }

  function select(key) {
    selected = key;
    store('selected-character', key);
    renderRoster();
    renderDetail();
  }

  // ------------------------------------------------------------ boot

  async function init() {
    data = window.TRACKER_DATA || null;
    // When served over http(s), grab the freshest JSON (bypasses the cached .js).
    if (location.protocol.startsWith('http')) {
      try {
        const res = await fetch('data/characters.json', { cache: 'no-store' });
        if (res.ok) data = await res.json();
      } catch { /* fall back to the bundled script */ }
    }
    if (!data?.characters?.length) {
      $detail.innerHTML = '<p class="empty-note">No character data yet. Run <code>node scripts/fetch-characters.mjs</code>.</p>';
      return;
    }
    const saved = load('selected-character');
    selected = data.characters.some((c) => c.key === saved) ? saved : data.characters[0].key;
    renderStatus();
    renderRoster();
    renderDetail();
  }

  init();
})();
