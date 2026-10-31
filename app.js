'use strict';
// Bestiário de Toram — app de página única com rotas por hash (#/monstros, #/item/123...).
// Os bancos ficam em data/*.json e são lidos uma vez na abertura.

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => Number(n).toLocaleString('pt-BR');
const nk = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const view = $('#view');
const store = {
  get(k, d) { try { const v = localStorage.getItem('bt:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bt:' + k, JSON.stringify(v)); } catch (e) {} }
};
function short(n) {
  if (n == null || n < 0) return '—';
  if (n >= 1e9) return (n / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' bi';
  if (n >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  return fmt(n);
}

// ---------- tabelas fixas ----------
const EL = [['Fogo', '--e-fire'], ['Terra', '--e-earth'], ['Água', '--e-water'], ['Trevas', '--e-dark'], ['Vento', '--e-wind'], ['Desconhecido', '--e-unknown'], ['Neutro', '--e-neutral'], ['Luz', '--e-light']];
const TYPES = [['B', 'Bosses', 'Boss'], ['M', 'Mini Bosses', 'Mini boss'], ['N', 'Normais', 'Normal']];
const TLAB = Object.fromEntries(TYPES.map(t => [t[0], t[2]]));
const MODES = [['Easy', 'E', 'Fácil'], ['Normal', 'N', 'Normal'], ['Hard', 'H', 'Difícil'], ['Very Hard', 'V', 'Muito difícil'], ['Nightmare', 'M', 'Pesadelo'], ['Ultimate', 'U', 'Ultimate']];
const MODE = Object.fromEntries(MODES.map(m => [m[0], m]));
const modeOrder = m => { const i = MODES.findIndex(x => x[0] === m); return i < 0 ? 9 : i; };
// Evento de Halloween 2026: cada doce cai de monstros de um elemento (anúncio oficial).
const CANDY_END = new Date('2026-11-12T23:59:59');
const CANDIES = [['Pumpkin Cookie', 0], ['Ginger Cake', 2], ['Jack Pudding', 4], ['Barmbrack', 1], ['Pumpkin Candy', 7], ['Zombie Cake', 3], ['Pumpkin Soup', 6]];
const candyOn = () => new Date() <= CANDY_END;
const candyFor = el => (CANDIES.find(c => c[1] === el) || [])[0];

const elHtml = els => els.map(e => '<span class="el"><span class="dot" style="background:var(' + EL[e][1] + ')"></span>' + EL[e][0] + '</span>').join('');

// ---------- dados ----------
let DB = null;
function load(name) { return fetch('data/' + name + '.json').then(r => { if (!r.ok) throw new Error('data/' + name + '.json: ' + r.status); return r.json(); }); }

function build(mo, it, fi, loc) {
  // mapas
  const MAPS = new Map(mo.maps.filter(m => m[1] && m[1] !== '-').map(([id, name, n]) => [id, { id, name, n, mons: [] }]));
  // monstros agrupados por tipo + nome (um boss com várias dificuldades vira um só)
  const groups = new Map(), GBYID = new Map();
  for (const r of mo.mons) {
    const [id, name, t, mode, lv, hp, exp, mapId, el, fl, badge, drops] = r;
    const key = t + '|' + name;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, name, t, entries: [], els: new Set(), maps: new Map(), drops: new Set(), tame: false, event: false, badge: '' });
    const map = MAPS.get(mapId) || null;
    g.entries.push({ id, mode, lv, hp, exp, map });
    GBYID.set(id, g);
    if (el >= 0) g.els.add(el);
    if (fl & 1) g.tame = true;
    if (fl & 2) g.event = true;
    if (badge) { g.badge = badge; if (!/^Update/i.test(badge)) g.event = true; }
    if (map) g.maps.set(map.id, map);
    (drops || []).forEach(d => g.drops.add(d));
  }
  const MONS = [...groups.values()];
  for (const g of MONS) {
    g.entries.sort((a, b) => modeOrder(a.mode) - modeOrder(b.mode) || a.lv - b.lv);
    g.lo = Math.min(...g.entries.map(e => e.lv)); g.hi = Math.max(...g.entries.map(e => e.lv));
    g.id = Math.min(...g.entries.map(e => e.id));
    g.maxId = Math.max(...g.entries.map(e => e.id));
    g.hp = Math.max(...g.entries.map(e => e.hp)); g.exp = Math.max(...g.entries.map(e => e.exp));
    g.els = [...g.els];
    g.mapList = [...g.maps.values()];
    g.mapList.forEach(m => m.mons.push(g));
    g.modes = [...new Set(g.entries.map(e => e.mode).filter(Boolean))];
    g.text = (g.name + '\n' + g.mapList.map(m => m.name).join('\n')).toLowerCase();
  }
  // itens
  const ITYPES = it.types, STATN = it.stats, BADGES = it.badges;
  const ITEMS = it.items.split('\n').map(l => {
    const [name, id, t, proc, pa, sell, b, st, note] = l.split('|');
    return { name, id: +id, tl: (ITYPES[+t] || '').replace(/^\[|\]$/g, ''), proc: +proc || 0, pa: +pa || 0, sell: +sell || 0, badge: BADGES[+b || 0] || '', note: note || '', by: [], up: [],
      stats: st ? st.split(';').map(s => { const p = s.split(','); return [+p[0], +p[1], +(p[2] || 0)]; }) : [] };
  });
  const ITBYID = new Map(ITEMS.map(i => [i.id, i]));
  const ITBYNAME = new Map();
  ITEMS.forEach(i => { const k = i.name.toLowerCase(); if (!ITBYNAME.has(k)) ITBYNAME.set(k, i); });
  for (const g of MONS) {
    g.items = [...g.drops].map(id => ITBYID.get(id)).filter(Boolean);
    g.items.forEach(i => i.by.push(g));
    g.dropText = g.items.map(i => i.name).join('\n').toLowerCase();
  }
  const S_UPG = STATN.indexOf('Upgrade for');
  ITEMS.forEach(i => { const u = i.stats.find(s => s[0] === S_UPG); if (u) { const f = ITBYID.get(u[1]); if (f) { i.from = f; f.up.push(i); } } });
  const EVRX = /\b(anniv\w*|event|valentine|halloween|christmas|xmas|new ?year|white day|summer|easter|hanami|bride|tanabata|otsukimi|santa|zodiac|limited)\b/i;
  ITEMS.forEach(i => {
    i.event = EVRX.test(i.name) || (!!i.badge && !/^Update/i.test(i.badge)) || (i.by.length > 0 && i.by.every(g => g.event));
    i.text = (i.name + '\n' + i.note + '\n' + i.by.map(g => g.name).join('\n')).toLowerCase();
  });
  // fichas RAID
  const FMAP = new Map(fi.map(f => [nk(f.n), f]));
  return { MAPS, MAPLIST: [...MAPS.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt', { ignorePunctuation: true })), MONS, GBYID, ITEMS, ITBYID, ITBYNAME, ITYPES, STATN, S_UPG, FMAP, LOC: loc, mread: mo.read || '' };
}
const fichaFor = g => g.t === 'N' ? null : DB.FMAP.get(nk(g.name)) || null;
const monUrl = g => '#/monstro/' + g.id;
const itemUrl = i => '#/item/' + i.id;
const mapUrl = m => '#/mapa/' + m.id;

// ---------- rotas ----------
const ROUTES = [
  [/^#\/?$/, 'inicio', () => viewHome()],
  [/^#\/monstros(?:\/([BMN]))?$/, 'monstros', t => viewMonsters(t)],
  [/^#\/monstro\/(\d+)$/, 'monstros', id => viewMonster(+id)],
  [/^#\/itens$/, 'itens', () => viewItems()],
  [/^#\/item\/(\d+)$/, 'itens', id => viewItem(+id)],
  [/^#\/mapas$/, 'mapas', () => viewMaps()],
  [/^#\/mapa\/(\d+)$/, 'mapas', id => viewMap(+id)],
  [/^#\/ferramentas$/, 'ferramentas', () => viewTools()],
  [/^#\/upar$/, 'ferramentas', () => viewLeveling()],
  [/^#\/exp$/, 'ferramentas', () => viewExp()]
];
const scrollMem = new Map();
let curHash = location.hash || '#/';
window.addEventListener('hashchange', () => { scrollMem.set(curHash, window.scrollY); curHash = location.hash || '#/'; route(); });
function route() {
  if (!DB) return;
  const h = location.hash || '#/';
  let sec = 'inicio', done = false;
  for (const [re, s, fn] of ROUTES) { const m = h.match(re); if (m) { sec = s; fn(...m.slice(1)); done = true; break; } }
  if (!done) viewHome();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.sec === sec));
  closeGlobal();
  const y = scrollMem.get(h);
  window.scrollTo(0, y || 0);
}
const backBtn = (fallback) => '<a class="back" href="' + fallback + '" data-back>← Voltar</a>';
// "Voltar" volta no histórico quando a pessoa veio de dentro do site; aberto direto por link, vai para a lista.
let navCount = 0;
window.addEventListener('hashchange', () => { navCount++; });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-back]');
  if (b && navCount > 0) { e.preventDefault(); history.back(); }
});
function setTitle(t) { document.title = t ? t + ' · Bestiário de Toram' : 'Bestiário de Toram'; }

// ---------- início ----------
function viewHome() {
  setTitle('');
  const cnt = t => DB.MONS.filter(g => g.t === t).length;
  const newest = DB.MONS.filter(g => g.t !== 'N').sort((a, b) => b.maxId - a.maxId).slice(0, 8);
  const newItems = DB.ITEMS.slice().sort((a, b) => b.id - a.id).filter(i => i.stats.length).slice(0, 8);
  const candies = candyOn() ? '<section class="card"><h2>Doces do evento de Halloween <small>até 12/11/2026</small></h2><div class="candies">'
    + CANDIES.map(([n, el]) => '<a class="cd" style="--c:var(' + EL[el][1] + ')" href="#/monstros" data-el="' + el + '"><b>' + n + '</b><span><span class="dot" style="background:var(' + EL[el][1] + ')"></span>monstros de ' + EL[el][0] + '</span></a>').join('')
    + '</div><p class="note">Cada doce cai como drop extra dos monstros do elemento e dá ASPD e CSPD +100 e +5% de dano contra esse elemento por 10 minutos. Toque num doce para ver os monstros desse elemento.</p></section>' : '';
  view.innerHTML = '<div class="hero"><img src="img/logo.webp" alt="Bestiário de Toram" width="840" height="768"><div class="tagline">Monstros · Drops · Itens · Mapas</div>'
    + '<p>Tudo de Toram Online num lugar só, em português: ' + fmt(DB.MONS.length) + ' monstros, ' + fmt(DB.ITEMS.length) + ' itens e ' + fmt(DB.MAPLIST.length) + ' mapas, com drops, status, mapas e ferramentas.</p></div>'
    + '<div class="tiles">'
    + '<a class="tile" href="#/monstros/B"><b>Bosses</b><span>' + fmt(cnt('B')) + ' bosses</span></a>'
    + '<a class="tile" href="#/monstros/M"><b>Mini Bosses</b><span>' + fmt(cnt('M')) + ' mini bosses</span></a>'
    + '<a class="tile" href="#/monstros/N"><b>Monstros</b><span>' + fmt(cnt('N')) + ' normais</span></a>'
    + '<a class="tile" href="#/itens"><b>Itens</b><span>' + fmt(DB.ITEMS.length) + ' itens com status</span></a>'
    + '<a class="tile" href="#/mapas"><b>Mapas</b><span>' + fmt(DB.MAPLIST.length) + ' mapas</span></a>'
    + '<a class="tile" href="#/upar"><b>Onde upar</b><span>Melhores monstros pro seu nível</span></a>'
    + '<a class="tile" href="#/exp"><b>Calculadora de EXP</b><span>Quanto falta pro nível</span></a>'
    + '<a class="tile" href="#/ferramentas"><b>Ferramentas</b><span>Todas as calculadoras</span></a>'
    + '</div>' + candies
    + '<div class="grid2"><section class="card"><h2>Bosses mais novos no banco</h2><div class="newl">' + newest.map(g => '<a class="lk" href="' + monUrl(g) + '">' + esc(g.name) + ' <small>' + TLAB[g.t] + ' · Lv ' + lvTxt(g) + '</small></a>').join('') + '</div></section>'
    + '<section class="card"><h2>Itens mais novos</h2><div class="newl">' + newItems.map(i => '<a class="lk" href="' + itemUrl(i) + '">' + esc(i.name) + ' <small>' + esc(i.tl) + '</small></a>').join('') + '</div></section></div>';
  view.querySelectorAll('.cd[data-el]').forEach(a => a.addEventListener('click', () => { MS.els = new Set([+a.dataset.el]); MS.t = 'B'; }));
}
const lvTxt = g => g.lo === g.hi ? String(g.lo) : g.lo + '–' + g.hi;

// ---------- lista de monstros ----------
const MS = { t: 'B', q: '', lmin: '', lmax: '', mode: '', els: new Set(), noevent: false, tame: false, map: 0, sort: 'lv', limit: 60, open: false };
function monFiltered() {
  const q = MS.q.trim().toLowerCase();
  const lmin = MS.lmin === '' ? null : +MS.lmin, lmax = MS.lmax === '' ? null : +MS.lmax;
  let rows = DB.MONS.filter(g => {
    if (g.t !== MS.t) return false;
    if (q && !g.text.includes(q) && !g.dropText.includes(q)) return false;
    if (lmin !== null && g.hi < lmin) return false;
    if (lmax !== null && g.lo > lmax) return false;
    if (MS.mode && !g.modes.includes(MS.mode)) return false;
    if (MS.noevent && g.event) return false;
    if (MS.tame && !g.tame) return false;
    if (MS.map && !g.maps.has(MS.map)) return false;
    if (MS.els.size && !g.els.some(e => MS.els.has(e))) return false;
    return true;
  });
  const by = { lv: (a, b) => a.lo - b.lo || a.hi - b.hi, lvd: (a, b) => b.hi - a.hi || b.lo - a.lo, name: (a, b) => 0, hp: (a, b) => b.hp - a.hp, exp: (a, b) => b.exp - a.exp }[MS.sort] || (() => 0);
  return rows.sort((a, b) => by(a, b) || a.name.localeCompare(b.name, 'pt', { ignorePunctuation: true }));
}
function monActiveCount() { return (MS.lmin !== '') + (MS.lmax !== '') + !!MS.mode + MS.els.size + MS.noevent + MS.tame; }
function viewMonsters(t) {
  if (t && t !== MS.t) { MS.t = t; MS.q = ''; MS.limit = 60; }
  setTitle('Monstros');
  const cnt = k => DB.MONS.filter(g => g.t === k).length;
  view.innerHTML = '<div class="ph"><div><h1>Monstros</h1><p>Toque num monstro para ver dificuldades, HP, EXP, drops, onde fica e o guia RAID.</p></div></div>'
    + '<nav class="seg" aria-label="Tipo">' + TYPES.map(([k, l]) => '<a href="#/monstros/' + k + '" class="' + (MS.t === k ? 'on' : '') + '">' + l + '<span class="n">' + fmt(cnt(k)) + '</span></a>').join('') + '</nav>'
    + '<div class="tools"><input id="mq" type="search" placeholder="Nome, mapa ou item que dropa" value="' + esc(MS.q) + '" aria-label="Buscar monstro">'
    + '<button class="fbtn" id="mfb" type="button" aria-expanded="' + MS.open + '">Filtros<b id="mfn"></b></button></div>'
    + '<section class="card" id="mfp"' + (MS.open ? '' : ' hidden') + '><div class="fpanel">'
    + '<div class="field"><span class="lbl">Nível</span><div class="range"><input id="lmin" type="number" inputmode="numeric" placeholder="mín" value="' + esc(MS.lmin) + '" aria-label="Nível mínimo"><span>a</span><input id="lmax" type="number" inputmode="numeric" placeholder="máx" value="' + esc(MS.lmax) + '" aria-label="Nível máximo"></div></div>'
    + '<div class="field"' + (MS.t === 'N' ? ' hidden' : '') + '><label class="lbl" for="mmode">Dificuldade</label><select id="mmode"><option value="">Todas</option>' + MODES.map(m => '<option value="' + m[0] + '"' + (MS.mode === m[0] ? ' selected' : '') + '>' + m[2] + '</option>').join('') + '</select></div>'
    + '<div class="field"><label class="lbl" for="msort">Ordenar por</label><select id="msort">' + [['lv', 'Nível (menor)'], ['lvd', 'Nível (maior)'], ['name', 'Nome (A–Z)'], ['hp', 'Maior HP'], ['exp', 'Maior EXP']].map(([v, l]) => '<option value="' + v + '"' + (MS.sort === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>'
    + '<div class="field"><span class="lbl">Mostrar</span><label class="check"><input id="mnoev" type="checkbox"' + (MS.noevent ? ' checked' : '') + '> Ocultar eventos</label><label class="check"><input id="mtame" type="checkbox"' + (MS.tame ? ' checked' : '') + '> Só capturáveis (pets)</label></div>'
    + '<div class="field full"><span class="lbl">Elemento</span><div class="chips" id="mels">' + EL.map((e, i) => '<button type="button" class="chip" data-el="' + i + '" aria-pressed="' + MS.els.has(i) + '"><span class="dot" style="background:var(' + e[1] + ')"></span>' + e[0] + '</button>').join('') + '</div></div>'
    + '</div></section>'
    + '<div class="active" id="mact"></div><div class="status"><span id="mcount" aria-live="polite"></span><button class="link" id="mreset" type="button">Limpar filtros</button></div>'
    + '<div class="list" id="mlist"></div><button class="more" id="mmore" type="button" hidden></button>';
  const rer = () => { MS.limit = 60; monList(); };
  $('#mq').addEventListener('input', e => { MS.q = e.target.value; rer(); });
  $('#mfb').addEventListener('click', () => { MS.open = !MS.open; $('#mfp').hidden = !MS.open; $('#mfb').setAttribute('aria-expanded', MS.open); });
  $('#lmin').addEventListener('input', e => { MS.lmin = e.target.value; rer(); });
  $('#lmax').addEventListener('input', e => { MS.lmax = e.target.value; rer(); });
  $('#mmode').addEventListener('change', e => { MS.mode = e.target.value; rer(); });
  $('#msort').addEventListener('change', e => { MS.sort = e.target.value; rer(); });
  $('#mnoev').addEventListener('change', e => { MS.noevent = e.target.checked; rer(); });
  $('#mtame').addEventListener('change', e => { MS.tame = e.target.checked; rer(); });
  $('#mels').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; const i = +b.dataset.el; MS.els.has(i) ? MS.els.delete(i) : MS.els.add(i); b.setAttribute('aria-pressed', MS.els.has(i)); rer(); });
  $('#mact').addEventListener('click', e => { if (e.target.closest('[data-x="map"]')) { MS.map = 0; rer(); } });
  $('#mreset').addEventListener('click', () => { Object.assign(MS, { q: '', lmin: '', lmax: '', mode: '', noevent: false, tame: false, map: 0, limit: 60 }); MS.els.clear(); viewMonsters(); });
  $('#mmore').addEventListener('click', () => { MS.limit += 60; monList(); });
  monList();
}
function monList() {
  const rows = monFiltered(), total = DB.MONS.filter(g => g.t === MS.t).length, q = MS.q.trim().toLowerCase();
  const n = monActiveCount();
  $('#mfn').textContent = n || ''; $('#mfn').hidden = !n;
  $('#mact').innerHTML = MS.map ? '<button class="chip" data-x="map" type="button">Mapa: ' + esc(DB.MAPS.get(MS.map).name) + ' <span class="x">×</span></button>' : '';
  $('#mcount').textContent = (rows.length === total ? fmt(total) : fmt(rows.length) + ' de ' + fmt(total)) + (MS.t === 'B' ? ' bosses' : MS.t === 'M' ? ' mini bosses' : ' monstros');
  const list = $('#mlist'), more = $('#mmore');
  if (!rows.length) { list.innerHTML = '<p class="empty">Nenhum monstro com esses filtros.</p>'; more.hidden = true; return; }
  list.innerHTML = '<div class="lh lm"><span>Nome</span><span>Nível</span><span>Elemento</span><span>Mapa</span><span>HP · EXP</span></div>' + rows.slice(0, MS.limit).map(g => {
    let via = '';
    if (q && !g.text.includes(q)) { const hits = g.items.filter(i => i.name.toLowerCase().includes(q)).map(i => i.name); via = ' <small>· dropa ' + esc(hits.slice(0, 2).join(', ')) + (hits.length > 2 ? ' +' + (hits.length - 2) : '') + '</small>'; }
    const e = MS.mode ? g.entries.find(x => x.mode === MS.mode) || null : null;
    const hp = e ? e.hp : g.hp, ex = e ? e.exp : g.exp;
    return '<a class="row mrow" href="' + monUrl(g) + '"><span class="rn">' + esc(g.name) + monTags(g) + via + '</span>'
      + '<span class="rlv">Lv ' + (e ? e.lv : lvTxt(g)) + '</span><span class="els">' + elHtml(g.els) + '</span>'
      + '<span class="rmap">' + (g.mapList.length ? esc(g.mapList[0].name) + (g.mapList.length > 1 ? ' +' + (g.mapList.length - 1) : '') : 'sem mapa') + '</span>'
      + '<span class="rstat">' + (hp > 0 ? 'HP ' + short(hp) : '') + (hp > 0 && ex > 0 ? ' · ' : '') + (ex > 0 ? 'EXP ' + short(ex) : '') + '</span></a>';
  }).join('');
  const left = rows.length - MS.limit;
  more.hidden = left <= 0; more.textContent = 'Mostrar mais ' + Math.min(60, left) + ' (faltam ' + fmt(left) + ')';
}
const monTags = g => '<span class="tags">' + (g.event ? '<span class="tag">' + (g.badge && !/^Update/i.test(g.badge) ? esc(g.badge) : 'Evento') + '</span>' : '') + (g.tame ? '<span class="tag ok">Capturável</span>' : '') + (fichaFor(g) ? '<span class="tag info">RAID</span>' : '') + '</span>';

// ---------- onde fica (mapa-múndi) ----------
const WORLDS = [
  { nome: 'Iruna', w: 5367, h: 3096, view: [1120, 240, 4580, 2790], ov: 'https://static.wikia.nocookie.net/toram-online/images/2/24/Iruna-World.png/revision/latest/scale-to-width-down/2200?cb=20260324061415', url: 'https://static.wikia.nocookie.net/toram-online/images/2/24/Iruna-World.png/revision/latest/scale-to-width-down/3600?cb=20260324061415' },
  { nome: 'Toram', w: 5438, h: 3137, view: [820, 680, 5000, 2800], ov: 'https://static.wikia.nocookie.net/toram-online/images/c/c1/Toram-World1.png/revision/latest/scale-to-width-down/2200?cb=20260413070455', url: 'https://static.wikia.nocookie.net/toram-online/images/c/c1/Toram-World1.png/revision/latest/scale-to-width-down/3600?cb=20260413070455' }
];
const TOWNS = [[['Nov Saterica', 2510, 880], ['Dikkit Sector', 3500, 620], ['Einkiang', 2910, 1400], ['Hora Diomedea', 1940, 1530], ['El Scaro', 3120, 2050], ['Sofya City', 2510, 2310]], [['Erva Trone', 1900, 1210], ['Draco Town', 1510, 1740], ['Aquacity', 2650, 2280], ['Vicus Mutans', 3510, 1760], ['Wind Ark', 2460, 1740]]];
function worldMap(wi, blues) {
  const W = WORLDS[wi], [x0, y0, x1, y1] = W.view, vw = x1 - x0, vh = y1 - y0;
  const px = x => ((x - x0) / vw * 100).toFixed(2) + '%', py = y => ((y - y0) / vh * 100).toFixed(2) + '%';
  const box = (cls, x, y, label) => '<b class="bx ' + cls + ((x - x0) / vw < 0.2 ? ' l' : (x - x0) / vw > 0.8 ? ' r' : '') + '" style="left:' + px(x) + ';top:' + py(y) + ';width:' + (190 / vw * 100).toFixed(2) + '%;height:' + (160 / vh * 100).toFixed(2) + '%"><em>' + esc(label) + '</em></b>';
  return '<div class="wmap" style="aspect-ratio:' + vw + '/' + vh + '"><img loading="lazy" alt="Mapa-múndi de ' + W.nome + '" src="' + W.ov + '" style="width:' + (W.w / vw * 100).toFixed(2) + '%;left:-' + (x0 / vw * 100).toFixed(2) + '%;top:-' + (y0 / vh * 100).toFixed(2) + '%">'
    + TOWNS[wi].map(t => box('red', t[1], t[2], t[0])).join('') + blues.map(b => box('blue', b.x, b.y, b.names[0])).join('') + '</div>';
}
function zoomBlock(b) {
  const W = WORLDS[b.w], k = 3600 / W.w;
  return '<p class="locn">' + esc(b.names.slice(0, 3).join(' · ')) + (b.names.length > 3 ? ' <span>+' + (b.names.length - 3) + '</span>' : '') + ' <span>— mundo ' + W.nome + '</span></p>'
    + '<div class="locv" role="img" aria-label="Posição no mapa de ' + W.nome + '"><div class="locimg" style="width:' + Math.round(W.w * k) + 'px;height:' + Math.round(W.h * k) + 'px;margin:' + (-Math.round(b.y * k)) + 'px 0 0 ' + (-Math.round(b.x * k)) + 'px;background-image:url(' + W.url + ')"></div><span class="pin"></span></div>';
}
function locHtml(mapNames) {
  const by = new Map();
  mapNames.forEach(m => { const l = DB.LOC[m]; if (!l) return; const key = l.join(','); if (!by.has(key)) by.set(key, { w: l[0], x: l[1], y: l[2], names: [] }); by.get(key).names.push(m); });
  const bl = [...by.values()];
  if (!bl.length) return '';
  const worlds = [...new Set(bl.map(b => b.w))];
  return '<section class="card"><h2>Onde fica</h2>' + bl.slice(0, 3).map(zoomBlock).join('')
    + '<p class="wleg"><i class="bx red"></i> cidades principais <i class="bx blue"></i> aqui</p>'
    + worlds.map(w => '<p class="locn">Mundo ' + WORLDS[w].nome + '</p>' + worldMap(w, bl.filter(b => b.w === w))).join('')
    + '<p class="note">Posição aproximada, lida do mapa-múndi do jogo. Dá para dar zoom na página com os dedos.</p></section>';
}

// ---------- página do monstro ----------
function viewMonster(id) {
  const g = DB.GBYID.get(id);
  if (!g) { view.innerHTML = backBtn('#/monstros') + '<p class="empty">Monstro não encontrado.</p>'; return; }
  setTitle(g.name);
  const f = fichaFor(g);
  const candy = candyOn() ? g.els.map(candyFor).filter(Boolean) : [];
  const head = '<div class="dhead"><h1>' + esc(g.name) + '</h1><div class="dmeta"><span class="pill">' + TLAB[g.t] + '</span><span class="els">' + elHtml(g.els) + '</span>' + monTags(g)
    + candy.map(c => '<span class="candy">🎃 Dropa ' + esc(c) + ' (Halloween)</span>').join('') + '</div></div>';
  const hasMode = g.t !== 'N' && g.entries.some(e => e.mode);
  // Mapa numa coluna só quando muda entre as dificuldades; se é sempre o mesmo, aparece uma vez acima da tabela.
  const oneMap = g.mapList.length <= 1;
  const mapLine = oneMap && g.mapList[0] ? '<p style="margin:0 0 8px;font-size:14px"><span class="muted">Mapa:</span> <a class="tl" href="' + mapUrl(g.mapList[0]) + '">' + esc(g.mapList[0].name) + '</a></p>' : '';
  const diff = '<section class="card"><h2>' + (hasMode ? 'Dificuldades' : 'Dados') + '</h2>' + mapLine + '<div class="tblw"><table class="tbl"><thead><tr>' + (hasMode ? '<th>Dificuldade</th>' : '') + '<th class="n">Nível</th><th class="n">HP</th><th class="n">EXP</th>' + (oneMap ? '' : '<th>Mapa</th>') + '</tr></thead><tbody>'
    + g.entries.map(e => '<tr>' + (hasMode ? '<td style="white-space:nowrap">' + (MODE[e.mode] ? '<span class="m ' + MODE[e.mode][1] + '">' + MODE[e.mode][1] + '</span> ' + MODE[e.mode][2] : esc(e.mode || '—')) + '</td>' : '') + '<td class="n">' + e.lv + '</td><td class="n">' + (e.hp > 0 ? fmt(e.hp) : '—') + '</td><td class="n">' + (e.exp > 0 ? fmt(e.exp) : '—') + '</td>' + (oneMap ? '' : '<td>' + (e.map ? '<a class="tl" href="' + mapUrl(e.map) + '">' + esc(e.map.name) + '</a>' : '—') + '</td>') + '</tr>').join('')
    + '</tbody></table></div>' + (g.entries.some(e => e.exp > 0) && g.t === 'B' ? '<p class="note">EXP base, sem quebrar partes. Bosses dão mais EXP quando as partes quebráveis são quebradas.</p>' : '') + '</section>';
  const drops = dropsHtml(g);
  const loc = locHtml(g.mapList.map(m => m.name));
  const raid = f ? '<details class="card" open><summary><h2>Guia RAID <small>Toram Yo</small></h2></summary>' + fichaHtml(f) + '</details>' : '';
  view.innerHTML = backBtn('#/monstros/' + g.t) + head + '<div class="grid2"><div>' + diff + drops + '</div><div>' + raid + loc + '</div></div>';
}
function dropsHtml(g) {
  if (!g.items.length) return '<section class="card"><h2>Drops</h2><p class="muted">O coryn.club não tem drops cadastrados para este monstro.</p></section>';
  const groups = new Map();
  g.items.forEach(i => { if (!groups.has(i.tl)) groups.set(i.tl, []); groups.get(i.tl).push(i); });
  const prio = t => t === 'Material' ? 0 : t === 'Usable' ? 1 : 2;
  return '<section class="card"><h2>Drops <small>' + g.items.length + (g.items.length === 1 ? ' item' : ' itens') + '</small></h2>'
    + [...groups.keys()].sort((a, b) => prio(a) - prio(b) || a.localeCompare(b)).map(t => '<div class="dgroup"><span class="lbl">' + esc(t || 'Outros') + ' (' + groups.get(t).length + ')</span><div class="links">'
      + groups.get(t).sort((a, b) => a.name.localeCompare(b.name, 'pt', { ignorePunctuation: true })).map(i => '<a class="lk" href="' + itemUrl(i) + '">' + esc(i.name) + '</a>').join('') + '</div></div>').join('')
    + '<p class="note">Sem taxa de drop: o jogo não mostra e nenhum banco publica. Em monstros com várias dificuldades, os drops de todas estão somados.</p></section>';
}
const fnum = s => String(s).replace(/-?\d+(?:\.\d+)?/g, m => Number(m).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
function fichaHtml(f) {
  const row = (a, num) => '<tr>' + a.map((c, i) => '<' + (i ? 'td' : 'th scope="row"') + '>' + esc(i && num ? fnum(c) : (c === '' ? '—' : String(c))) + '</' + (i ? 'td' : 'th') + '>').join('') + '</tr>';
  const head = c => '<thead><tr>' + c.map(x => '<th scope="col">' + x + '</th>').join('') + '</tr></thead>';
  const sec = (t, h) => '<div><h4>' + t + '</h4>' + h + '</div>';
  const tbl = (h, rows, num) => '<div class="ftab"><table>' + head(h) + '<tbody>' + rows.map(r => row(r.map(x => x === '' ? '—' : x), num)).join('') + '</tbody></table></div>';
  let h = f.lo ? '<div class="fmeta"><span><b>Local:</b> ' + esc(f.lo) + '</span></div>' : '';
  h += sec('Nível, HP e EXP' + (f.m ? '' : ' por dificuldade'), tbl(['', 'Nível', 'HP', 'EXP'], f.d.map(r => [r[0], r[1], r[2] === '-' ? '—' : r[2], r[3]]), true));
  if (f.df.length) h += sec('Defesas', f.m ? tbl(['', 'Valor'], f.df, true) : tbl(['', 'Easy', 'Normal', 'Hard', 'Nightmare', 'Ultimate'], f.df, true));
  if (f.it.length || f.in.length) h += sec('Interrupt', (f.it.length ? tbl(['', 'Cooldown', 'Duração'], f.it, false) : '') + (f.in.length ? '<ul class="flist" style="margin-top:8px">' + f.in.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>' : ''));
  if (f.tk.length) h += sec('Dicas e mecânicas', '<ul class="flist">' + f.tk.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>');
  if (f.pt) h += sec('Partes quebráveis', '<p style="margin:0;font-size:14px">' + esc(f.pt) + '</p>');
  if (f.im.length) h += sec('Itens do guia', '<div class="fitems">' + f.im.map(x => {
    const it = DB.ITBYNAME.get(String(x[0]).trim().toLowerCase()), inner = '<b>' + esc(x[0]) + '</b>' + (x[1] ? '<span>' + esc(x[1]) + '</span>' : '');
    return it ? '<a class="fitem" href="' + itemUrl(it) + '">' + inner + '</a>' : '<div class="fitem">' + inner + '</div>';
  }).join('') + '</div>');
  if (!f.it.length && !f.in.length && !f.tk.length) h += '<p class="fsrc">Este guia não traz dicas de luta nem dados de interrupção.</p>';
  h += '<p class="fsrc">Fonte: guia da comunidade Toram Yo (' + f.y + '). Os dados podem ter mudado com os patches e podem ter erros de leitura.</p>';
  return '<div class="fbody">' + h + '</div>';
}

// ---------- itens ----------
const PROC = ['', 'Beast', 'Wood', 'Metal', 'Cloth', 'Medicine', 'Mana'];
const WBITS = [[1, 'Shield'], [2, 'Knuckle'], [4, 'Magic Device'], [8, 'Staff'], [16, 'Bowgun'], [32, 'Bow'], [64, '2-Handed Sword'], [128, '1-Handed Sword'], [256, 'Armor'], [512, 'Special'], [1024, 'Additional'], [2048, 'Halberd'], [4096, 'Event'], [8192, 'Katana'], [16384, 'Heavy Armor'], [32768, 'Light Armor'], [65536, 'Dagger'], [131072, 'Dual Swords'], [262144, 'Arrow'], [524288, 'Ninjutsu Scroll']];
const MAINW = 2 | 4 | 8 | 16 | 32 | 64 | 128 | 2048 | 8192 | 131072;
const appText = a => WBITS.filter(w => a & w[0]).map(w => w[1]).join(', ') || '?';
const WEAP_T = ['1 Handed Sword', '2 Handed Sword', 'Bow', 'Bowgun', 'Knuckles', 'Magic Device', 'Staff', 'Halberd', 'Katana', 'Dagger', 'Arrow', 'Ninjutsu Scroll'];
const EQUIP_T = ['Armor', 'Additional', 'Special', 'Shield'];
const XTAL_T = ['Normal Crysta', 'Weapon Crysta', 'Armor Crysta', 'Additional Crysta', 'Special Crysta', 'Enhancer Crysta (Red)', 'Enhancer Crysta (Blue)', 'Enhancer Crysta (Green)', 'Enhancer Crysta (Yellow)', 'Enhancer Crysta (Purple)'];
const OTHER_T = ['Registlet', 'Gem', 'Piercer', 'Material', 'Ore', 'Usable', 'Refinement Support'];
const CATS = { W: WEAP_T, X: XTAL_T };
const catOk = (i, c) => !c || (CATS[c] ? CATS[c].includes(i.tl) : i.tl === c);
const IWEAP = [[0, 'Qualquer'], [32, 'Bow'], [16, 'Bowgun'], [128, '1-Handed Sword'], [64, '2-Handed Sword'], [131072, 'Dual Swords'], [2, 'Knuckle'], [4, 'Magic Device'], [8, 'Staff'], [2048, 'Halberd'], [8192, 'Katana']];
const PRINC_DEF = [['ATK', ['ATK %', 'ATK']], ['MATK', ['MATK %', 'MATK']], ['DEF', ['DEF %', 'DEF']], ['MDEF', ['MDEF %', 'MDEF']], ['STR', ['STR %', 'STR']], ['INT', ['INT %', 'INT']], ['VIT', ['VIT %', 'VIT']], ['AGI', ['AGI %', 'AGI']], ['DEX', ['DEX %', 'DEX']],
  ['MaxHP', ['MaxHP', 'MaxHP %']], ['MaxMP', ['MaxMP']], ['Crítico', ['Critical Rate', 'Critical Rate %']], ['Dano crítico', ['Critical Damage %', 'Critical Damage']], ['ASPD', ['ASPD', 'ASPD %']], ['CSPD', ['CSPD', 'CSPD %']],
  ['Pierce físico', ['Physical Pierce %']], ['Pierce mágico', ['Magic Pierce %']], ['Curta distância', ['Short Range Damage %']], ['Longa distância', ['Long Range Damage %']], ['Precisão', ['Accuracy', 'Accuracy %']], ['Esquiva', ['Dodge', 'Dodge %']],
  ['Estabilidade', ['Stability %']], ['Motion Speed', ['Motion Speed %']], ['Res. física', ['Physical Resistance %']], ['Res. mágica', ['Magic Resistance %']], ['Aggro +', ['Aggro %']], ['Aggro −', ['Aggro %'], -1]];
let PRINC = null;
const IS = { q: '', cat: '', weap: store.get('weap', 0), sort: 'name', chips: new Set(), fl: [], drop: false, noevent: false, limit: 60, open: false };
const SI = n => DB.STATN.indexOf(n);
function isBase(s) { const n = DB.STATN[s[0]]; return n === 'Base ATK' || n === 'Base DEF' || n === 'Base Stability %' || s[0] === DB.S_UPG; }
function sval(i, si) { const w = IS.weap; let v = 0; for (const [s, a, ap] of i.stats) if (s === si && (!ap || !w || !(ap & MAINW) || (ap & w))) v += a; return v; }
function sparts(s) {
  let n = DB.STATN[s[0]], pct = false;
  const a = s[1];
  if (n.startsWith('% ')) { n = n.slice(2); pct = true; } else if (n.endsWith(' %')) { n = n.slice(0, -2); pct = true; }
  n = n.charAt(0).toUpperCase() + n.slice(1);
  const flag = a === 1 && /Element$|Unavailable$/.test(n);
  const v = flag ? '✓' : (a > 0 && !n.startsWith('Base ') ? '+' : a < 0 ? '−' : '') + Math.abs(a).toLocaleString('pt-BR') + (pct ? '%' : '');
  return [n, v, s[2] ? 'só com ' + appText(s[2]) : ''];
}
function baseText(i) {
  const g = n => i.stats.find(s => DB.STATN[s[0]] === n);
  const atk = g('Base ATK'), def = g('Base DEF'), stab = g('Base Stability %');
  if (atk) return 'ATK ' + fmt(atk[1]) + (stab ? '<small>estab. ' + stab[1] + '%</small>' : '');
  if (def) return 'DEF ' + fmt(def[1]);
  return '';
}
function itemsFiltered() {
  const q = IS.q.trim().toLowerCase(), chipsOn = [...IS.chips].map(c => PRINC[c]);
  let rows = DB.ITEMS.filter(i => {
    if (q && !i.text.includes(q)) return false;
    if (!catOk(i, IS.cat)) return false;
    if (IS.drop && !i.by.length) return false;
    if (IS.noevent && i.event) return false;
    for (const c of chipsOn) if (!c.idx.some(si => c.sign * sval(i, si) > 0)) return false;
    for (const f of IS.fl) { const v = sval(i, f.s); if (f.op > 0 ? !(v !== 0 && v >= f.v) : !(v !== 0 && v <= f.v)) return false; }
    return true;
  });
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt', { ignorePunctuation: true });
  if (IS.sort === 'base') {
    const bv = i => { const s = i.stats.find(x => DB.STATN[x[0]] === 'Base ATK' || DB.STATN[x[0]] === 'Base DEF'); return s ? s[1] : -Infinity; };
    rows.sort((a, b) => bv(b) - bv(a) || byName(a, b));
  } else if (IS.sort === 'new') rows.sort((a, b) => b.id - a.id);
  else if (IS.sort.startsWith('s:')) {
    const si = +IS.sort.slice(2), m = new Map(rows.map(i => [i, sval(i, si)]));
    rows = rows.filter(i => m.get(i) !== 0).sort((a, b) => m.get(b) - m.get(a) || byName(a, b));
  } else rows.sort(byName);
  return rows;
}
function itemActiveCount() { return !!IS.cat + !!IS.weap + IS.chips.size + IS.fl.length + IS.drop + IS.noevent + (IS.sort !== 'name'); }
function viewItems() {
  setTitle('Itens');
  if (!PRINC) PRINC = PRINC_DEF.map(([lab, names, sign]) => ({ lab, idx: names.map(SI).filter(x => x >= 0), sign: sign || 1 }));
  const tally = {};
  DB.ITEMS.forEach(i => { tally[i.tl] = (tally[i.tl] || 0) + 1; });
  const statOpts = DB.STATN.map((n, i) => [n, i]).filter(x => x[0].trim() && !isBase([x[1]])).sort((a, b) => a[0].localeCompare(b[0]));
  const opt = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>';
  view.innerHTML = '<div class="ph"><div><h1>Itens</h1><p>Armas, armaduras, crystas e materiais com status, quem dropa e de onde evoluem.</p></div></div>'
    + '<div class="tools"><input id="iq" type="search" placeholder="Item, nota ou monstro (ex: Mithril)" value="' + esc(IS.q) + '" aria-label="Buscar item">'
    + '<button class="fbtn" id="ifb" type="button" aria-expanded="' + IS.open + '">Filtros<b id="ifn"></b></button></div>'
    + '<section class="card" id="ifp"' + (IS.open ? '' : ' hidden') + '><div class="fpanel">'
    + '<div class="field"><label class="lbl" for="icat">Categoria</label><select id="icat">' + opt('', 'Todas', !IS.cat)
    + [['Armas', 'W', 'Todas as armas', WEAP_T], ['Equipamentos', '', '', EQUIP_T], ['Crystas', 'X', 'Todas as crystas', XTAL_T], ['Outros', '', '', OTHER_T]].map(([g, all, allLab, list]) => '<optgroup label="' + g + '">' + (all ? opt(all, allLab, IS.cat === all) : '') + list.filter(t => tally[t]).map(t => opt(t, t + ' (' + tally[t] + ')', IS.cat === t)).join('') + '</optgroup>').join('') + '</select></div>'
    + '<div class="field"><label class="lbl" for="iweap">Sua arma</label><select id="iweap">' + IWEAP.map(([v, l]) => opt(v, l, IS.weap === v)).join('') + '</select></div>'
    + '<div class="field"><label class="lbl" for="isort">Ordenar por</label><select id="isort">' + opt('name', 'Nome (A–Z)', IS.sort === 'name') + opt('new', 'Mais novos', IS.sort === 'new') + opt('base', 'Base ATK/DEF', IS.sort === 'base') + '<optgroup label="Maior valor de">' + statOpts.map(([n, i]) => opt('s:' + i, n, IS.sort === 's:' + i)).join('') + '</optgroup></select></div>'
    + '<div class="field"><span class="lbl">Mostrar</span><label class="check"><input id="idrop" type="checkbox"' + (IS.drop ? ' checked' : '') + '> Só os que monstros dropam</label><label class="check"><input id="inoev" type="checkbox"' + (IS.noevent ? ' checked' : '') + '> Ocultar eventos</label></div>'
    + '<div class="field full"><span class="lbl">Status principais</span><div class="chips" id="ichips">' + PRINC.map((p, n) => '<button type="button" class="chip" data-c="' + n + '" aria-pressed="' + IS.chips.has(n) + '">' + p.lab + '</button>').join('') + '</div></div>'
    + '<div class="field full"><span class="lbl">Status específico</span><div class="range"><select id="istat" aria-label="Status">' + statOpts.map(([n, i]) => opt(i, n)).join('') + '</select><select id="iop" style="width:64px;flex:none" aria-label="Comparação"><option value="1">≥</option><option value="-1">≤</option></select><input id="imin" type="number" step="any" placeholder="valor" style="width:90px;flex:none" aria-label="Valor"><button id="iadd" class="btn" type="button">+</button></div></div>'
    + '</div></section>'
    + '<div class="active" id="iact"></div><div class="status"><span id="icount" aria-live="polite"></span><button class="link" id="ireset" type="button">Limpar filtros</button></div>'
    + '<div class="list" id="ilist"></div><button class="more" id="imore" type="button" hidden></button>';
  const rer = () => { IS.limit = 60; itemList(); };
  $('#iq').addEventListener('input', e => { IS.q = e.target.value; rer(); });
  $('#ifb').addEventListener('click', () => { IS.open = !IS.open; $('#ifp').hidden = !IS.open; $('#ifb').setAttribute('aria-expanded', IS.open); });
  $('#icat').addEventListener('change', e => { IS.cat = e.target.value; rer(); });
  $('#iweap').addEventListener('change', e => { IS.weap = +e.target.value; store.set('weap', IS.weap); rer(); });
  $('#isort').addEventListener('change', e => { IS.sort = e.target.value; rer(); });
  $('#idrop').addEventListener('change', e => { IS.drop = e.target.checked; rer(); });
  $('#inoev').addEventListener('change', e => { IS.noevent = e.target.checked; rer(); });
  $('#ichips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; const c = +b.dataset.c; IS.chips.has(c) ? IS.chips.delete(c) : IS.chips.add(c); b.setAttribute('aria-pressed', IS.chips.has(c)); rer(); });
  const add = () => { const s = +$('#istat').value, raw = $('#imin').value, op = +$('#iop').value; IS.fl = IS.fl.filter(f => f.s !== s).concat({ s, v: raw === '' ? 0 : +raw, op }); IS.sort = 's:' + s; $('#isort').value = IS.sort; $('#imin').value = ''; rer(); };
  $('#iadd').addEventListener('click', add);
  $('#imin').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  $('#iact').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (b.dataset.fl) IS.fl.splice(+b.dataset.fl, 1); else if (b.dataset.c) { IS.chips.delete(+b.dataset.c); const cb = view.querySelector('#ichips [data-c="' + b.dataset.c + '"]'); if (cb) cb.setAttribute('aria-pressed', 'false'); }
    rer();
  });
  $('#ireset').addEventListener('click', () => { Object.assign(IS, { q: '', cat: '', sort: 'name', fl: [], drop: false, noevent: false, limit: 60 }); IS.chips.clear(); viewItems(); });
  $('#imore').addEventListener('click', () => { IS.limit += 60; itemList(); });
  itemList();
}
function itemList() {
  const rows = itemsFiltered(), n = itemActiveCount();
  $('#ifn').textContent = n || ''; $('#ifn').hidden = !n;
  $('#iact').innerHTML = [...IS.chips].map(c => '<button class="chip" type="button" data-c="' + c + '">' + PRINC[c].lab + ' <span class="x">×</span></button>').join('')
    + IS.fl.map((f, k) => '<button class="chip" type="button" data-fl="' + k + '">' + esc(DB.STATN[f.s]) + ' ' + (f.op > 0 ? '≥' : '≤') + ' ' + fmt(f.v) + ' <span class="x">×</span></button>').join('');
  $('#icount').textContent = (rows.length === DB.ITEMS.length ? fmt(DB.ITEMS.length) : fmt(rows.length) + ' de ' + fmt(DB.ITEMS.length)) + ' itens';
  const hl = new Set(IS.fl.map(f => f.s));
  IS.chips.forEach(c => PRINC[c].idx.forEach(x => hl.add(x)));
  if (IS.sort.startsWith('s:')) hl.add(+IS.sort.slice(2));
  const list = $('#ilist'), more = $('#imore');
  if (!rows.length) { list.innerHTML = '<p class="empty">Nenhum item com esses filtros.</p>'; more.hidden = true; return; }
  list.innerHTML = '<div class="lh li"><span>Item</span><span>Tipo</span><span>Base</span><span>Status</span></div>' + rows.slice(0, IS.limit).map(i => {
    const shown = i.stats.filter(s => !isBase(s)).sort((a, b) => hl.has(b[0]) - hl.has(a[0]));
    const pills = shown.slice(0, 6).map(s => { const [n, v, c] = sparts(s); return '<span class="sp' + (hl.has(s[0]) ? ' hit' : '') + (s[1] < 0 ? ' neg' : '') + '">' + esc(n) + ' ' + v + (c ? ' <i>(' + esc(c) + ')</i>' : '') + '</span>'; }).join('') + (shown.length > 6 ? '<span class="sp">+' + (shown.length - 6) + '</span>' : '');
    return '<a class="row irow" href="' + itemUrl(i) + '"><span class="rn">' + esc(i.name) + itemTags(i) + '</span><span class="ity">' + esc(i.tl || 'Outros') + '</span><span class="ibase">' + baseText(i) + '</span>' + (pills ? '<span class="st">' + pills + '</span>' : '<span></span>') + '</a>';
  }).join('');
  const left = rows.length - IS.limit;
  more.hidden = left <= 0; more.textContent = 'Mostrar mais ' + Math.min(60, left) + ' (faltam ' + fmt(left) + ')';
}
const itemTags = i => '<span class="tags">' + (i.badge ? '<span class="tag">' + esc(i.badge) + '</span>' : i.event ? '<span class="tag">Evento</span>' : '') + (i.by.length ? '<span class="tag ok">Drop de ' + i.by.length + '</span>' : '') + '</span>';
function viewItem(id) {
  const i = DB.ITBYID.get(id);
  if (!i) { view.innerHTML = backBtn('#/itens') + '<p class="empty">Item não encontrado.</p>'; return; }
  setTitle(i.name);
  const st = i.stats.filter(s => s[0] !== DB.S_UPG);
  const list = st.length ? '<section class="card"><h2>Status</h2><div class="slist">' + st.map(s => { const [n, v, c] = sparts(s); return '<div class="' + (s[1] < 0 ? 'neg' : '') + '"><span>' + esc(n) + (c ? '<small>' + esc(c) + '</small>' : '') + '</span><b>' + v + '</b></div>'; }).join('') + '</div></section>' : '';
  const meta = [['Tipo', esc(i.tl || 'Outros')], i.proc ? ['Processar', i.pa + ' ' + PROC[i.proc]] : null, i.sell ? ['Venda', fmt(i.sell) + ' Spina'] : null, i.badge ? ['Origem', esc(i.badge)] : null].filter(Boolean);
  const tree = (i.from || i.up.length) ? '<section class="card"><h2>Evolução</h2>' + (i.from ? '<div class="dgroup"><span class="lbl">Evolui de</span><div class="links"><a class="lk" href="' + itemUrl(i.from) + '">' + esc(i.from.name) + '</a></div></div>' : '')
    + (i.up.length ? '<div class="dgroup"><span class="lbl">Evolui para</span><div class="links">' + i.up.map(u => '<a class="lk" href="' + itemUrl(u) + '">' + esc(u.name) + '</a>').join('') + '</div></div>' : '') + '</section>' : '';
  const by = i.by.slice().sort((a, b) => 'BMN'.indexOf(a.t) - 'BMN'.indexOf(b.t) || a.lo - b.lo);
  const drops = '<section class="card"><h2>Dropado por' + (by.length ? ' <small>' + by.length + (by.length === 1 ? ' monstro' : ' monstros') + '</small>' : '') + '</h2>'
    + (by.length ? '<div class="links">' + by.map(g => '<a class="lk" href="' + monUrl(g) + '">' + esc(g.name) + ' <small>' + TLAB[g.t] + ' · Lv ' + lvTxt(g) + (g.mapList[0] ? ' · ' + esc(g.mapList[0].name) : '') + '</small></a>').join('') + '</div>'
      : '<p class="muted" style="margin:0">Nenhum monstro do bestiário dropa este item. Ele pode vir de craft, NPC, missão, evento ou baú.</p>') + '</section>';
  view.innerHTML = backBtn('#/itens') + '<div class="dhead"><h1>' + esc(i.name) + '</h1><div class="dmeta">' + meta.map(([k, v]) => '<span><span class="muted">' + k + '</span> ' + v + '</span>').join('') + itemTags(i) + '</div>'
    + (i.note ? '<p class="inote">' + esc(i.note) + '</p>' : '') + '</div><div class="grid2"><div>' + list + tree + '</div><div>' + drops + '</div></div>';
}

// ---------- mapas ----------
const PS = { q: '', only: true, limit: 80 };
function viewMaps() {
  setTitle('Mapas');
  view.innerHTML = '<div class="ph"><div><h1>Mapas</h1><p>Todos os mapas do jogo com os monstros de cada um.</p></div></div>'
    + '<div class="tools"><input id="pq" type="search" placeholder="Nome do mapa (ex: Ancient)" value="' + esc(PS.q) + '" aria-label="Buscar mapa"></div>'
    + '<div class="status"><span id="pcount" aria-live="polite"></span><label class="check" style="min-height:0;color:inherit"><input id="ponly" type="checkbox"' + (PS.only ? ' checked' : '') + '> Só mapas com monstros</label></div>'
    + '<div class="list" id="plist"></div><button class="more" id="pmore" type="button" hidden></button>';
  $('#pq').addEventListener('input', e => { PS.q = e.target.value; PS.limit = 80; mapList(); });
  $('#ponly').addEventListener('change', e => { PS.only = e.target.checked; PS.limit = 80; mapList(); });
  $('#pmore').addEventListener('click', () => { PS.limit += 80; mapList(); });
  mapList();
}
function mapList() {
  const q = PS.q.trim().toLowerCase();
  const rows = DB.MAPLIST.filter(m => (!PS.only || m.mons.length) && (!q || m.name.toLowerCase().includes(q)));
  $('#pcount').textContent = fmt(rows.length) + ' mapas';
  if (!rows.length) { $('#plist').innerHTML = '<p class="empty">Nenhum mapa encontrado.</p>'; $('#pmore').hidden = true; return; }
  $('#plist').innerHTML = '<div class="lh lp"><span>Mapa</span><span>Mundo</span><span>Monstros</span></div>' + rows.slice(0, PS.limit).map(m => {
    const l = DB.LOC[m.name], c = t => m.mons.filter(g => g.t === t).length;
    const parts = [['B', 'boss'], ['M', 'mini'], ['N', 'normais']].map(([t, l2]) => c(t) ? c(t) + ' ' + l2 : '').filter(Boolean).join(' · ');
    return '<a class="row prow" href="' + mapUrl(m) + '"><span class="rn">' + esc(m.name) + '</span><span class="rsub">' + (l ? WORLDS[l[0]].nome : '') + '</span><span class="rsub">' + (parts || 'sem monstros') + '</span></a>';
  }).join('');
  const left = rows.length - PS.limit;
  $('#pmore').hidden = left <= 0; $('#pmore').textContent = 'Mostrar mais ' + Math.min(80, left) + ' (faltam ' + fmt(left) + ')';
}
function viewMap(id) {
  const m = DB.MAPS.get(id);
  if (!m) { view.innerHTML = backBtn('#/mapas') + '<p class="empty">Mapa não encontrado.</p>'; return; }
  setTitle(m.name);
  const l = DB.LOC[m.name];
  const sec = TYPES.map(([t, lab]) => {
    const gs = m.mons.filter(g => g.t === t).sort((a, b) => a.lo - b.lo);
    return gs.length ? '<div class="dgroup"><span class="lbl">' + lab + ' (' + gs.length + ')</span><div class="links">' + gs.map(g => '<a class="lk" href="' + monUrl(g) + '">' + esc(g.name) + ' <small>Lv ' + lvTxt(g) + '</small></a>').join('') + '</div></div>' : '';
  }).join('');
  view.innerHTML = backBtn('#/mapas') + '<div class="dhead"><h1>' + esc(m.name) + '</h1><div class="dmeta">' + (l ? '<span class="pill">Mundo ' + WORLDS[l[0]].nome + '</span>' : '') + '<span class="muted">' + m.mons.length + (m.mons.length === 1 ? ' monstro' : ' monstros') + '</span></div></div>'
    + '<div class="grid2"><div><section class="card"><h2>Monstros deste mapa</h2>' + (sec || '<p class="muted" style="margin:0">O coryn.club não lista monstros neste mapa.</p>') + '</section></div><div>' + locHtml([m.name]) + '</div></div>';
}

// ---------- ferramentas ----------
// EXP para passar do nível L para L+1 (fórmula difundida pela comunidade).
const expNext = L => Math.floor(0.025 * L ** 4 + 2 * L);
function viewTools() {
  setTitle('Ferramentas');
  const t = (href, b, s) => '<a class="tile" href="' + href + '"><b>' + b + '</b><span>' + s + '</span></a>';
  view.innerHTML = '<div class="ph"><div><h1>Ferramentas</h1><p>Calculadoras e guias para o dia a dia.</p></div></div><div class="tiles">'
    + t('#/upar', 'Onde upar', 'Melhores monstros por EXP para o seu nível, com bônus de emblema e ticket')
    + t('#/exp', 'Calculadora de EXP', 'EXP que falta até o nível desejado e quantos abates')
    + t('#/monstros/N', 'Capturáveis (pets)', 'Use o filtro "Só capturáveis" na lista de monstros')
    + t('#/itens', 'Busca avançada de itens', 'Filtre por qualquer status, arma e categoria')
    + '</div>';
}
const LV = { lv: store.get('lv', 100), range: store.get('range', 5), bonus: store.get('bonus', 0), types: new Set(store.get('types', ['B', 'M', 'N'])), modes: new Set(store.get('modes', MODES.map(m => m[0]))), ev: store.get('ev', false) };
function viewLeveling() {
  setTitle('Onde upar');
  const BON = [['10', 'Emblema: jogar 30 min'], ['10', 'Emblema: jogar 60 min'], ['10', 'Emblema: 30 abates'], ['10', 'Emblema: 60 abates'], ['10', 'Emblema: 90 abates'], ['50', 'Ticket 30 dias padrão'], ['100', 'Ticket de upar']];
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Onde upar</h1><p>Os monstros que dão mais EXP perto do seu nível. Seu nível e escolhas ficam salvos neste aparelho.</p></div></div>'
    + '<section class="card"><div class="calc">'
    + '<div class="field"><label class="lbl" for="ulv">Seu nível</label><input id="ulv" type="number" inputmode="numeric" min="1" max="400" value="' + LV.lv + '"></div>'
    + '<div class="field"><label class="lbl" for="urg">Faixa (± níveis)</label><input id="urg" type="number" inputmode="numeric" min="0" max="50" value="' + LV.range + '"></div>'
    + '<div class="field"><label class="lbl" for="ubn">Bônus de EXP (%)</label><input id="ubn" type="number" inputmode="numeric" min="0" max="1000" value="' + LV.bonus + '"></div>'
    + '<div class="field"><span class="lbl">Incluir</span><label class="check"><input id="uev" type="checkbox"' + (LV.ev ? ' checked' : '') + '> Eventos e limitados</label></div>'
    + '<div class="field full"><span class="lbl">Somar bônus</span><div class="chips" id="ubon">' + BON.map(([v, l]) => '<button type="button" class="chip" data-v="' + v + '">+' + v + '% ' + l + '</button>').join('') + '<button type="button" class="chip" data-v="0">Zerar</button></div></div>'
    + '<div class="field full"><span class="lbl">Tipos</span><div class="chips" id="utyp">' + TYPES.map(([k, l]) => '<button type="button" class="chip" data-t="' + k + '" aria-pressed="' + LV.types.has(k) + '">' + l + '</button>').join('') + '</div></div>'
    + '<div class="field full"><span class="lbl">Dificuldades dos bosses</span><div class="chips" id="umod">' + MODES.map(m => '<button type="button" class="chip" data-m="' + m[0] + '" aria-pressed="' + LV.modes.has(m[0]) + '">' + m[2] + '</button>').join('') + '</div></div>'
    + '</div></section><div class="status"><span id="ucount"></span><span id="unext"></span></div><div class="list" id="ulist"></div>'
    + '<p class="note" style="color:var(--ink-2)">EXP base do coryn.club, sem quebrar partes de boss. O jogo dá menos EXP para monstros muito acima ou abaixo do seu nível, por isso a faixa. "Abates" é quantos você precisa para subir um nível inteiro, pela fórmula de EXP da comunidade (aproximada).</p>';
  const save = () => { store.set('lv', LV.lv); store.set('range', LV.range); store.set('bonus', LV.bonus); store.set('types', [...LV.types]); store.set('modes', [...LV.modes]); store.set('ev', LV.ev); upList(); };
  $('#ulv').addEventListener('input', e => { LV.lv = +e.target.value || 1; save(); });
  $('#urg').addEventListener('input', e => { LV.range = Math.max(0, +e.target.value || 0); save(); });
  $('#ubn').addEventListener('input', e => { LV.bonus = Math.max(0, +e.target.value || 0); save(); });
  $('#uev').addEventListener('change', e => { LV.ev = e.target.checked; save(); });
  $('#ubon').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; LV.bonus = +b.dataset.v ? LV.bonus + +b.dataset.v : 0; $('#ubn').value = LV.bonus; save(); });
  $('#utyp').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; const k = b.dataset.t; LV.types.has(k) ? LV.types.delete(k) : LV.types.add(k); b.setAttribute('aria-pressed', LV.types.has(k)); save(); });
  $('#umod').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; const k = b.dataset.m; LV.modes.has(k) ? LV.modes.delete(k) : LV.modes.add(k); b.setAttribute('aria-pressed', LV.modes.has(k)); save(); });
  upList();
}
function upList() {
  const lo = LV.lv - LV.range, hi = LV.lv + LV.range, mult = 1 + LV.bonus / 100, need = expNext(LV.lv);
  const rows = [];
  for (const g of DB.MONS) {
    if (!LV.types.has(g.t) || (!LV.ev && g.event)) continue;
    for (const e of g.entries) {
      if (e.exp <= 0 || e.lv < lo || e.lv > hi) continue;
      if (g.t !== 'N' && e.mode && !LV.modes.has(e.mode)) continue;
      rows.push({ g, e, x: Math.floor(e.exp * mult) });
    }
  }
  rows.sort((a, b) => b.x - a.x);
  $('#ucount').textContent = fmt(rows.length) + ' opções entre Lv ' + Math.max(1, lo) + ' e ' + hi;
  $('#unext').textContent = 'Lv ' + LV.lv + ' → ' + (LV.lv + 1) + ': ' + fmt(need) + ' EXP';
  $('#ulist').innerHTML = rows.length ? '<div class="lh lm"><span>Monstro</span><span>Nível</span><span>Dificuldade</span><span>Mapa</span><span>EXP · abates</span></div>' + rows.slice(0, 60).map(({ g, e, x }) =>
    '<a class="row mrow" href="' + monUrl(g) + '"><span class="rn">' + esc(g.name) + ' <small>' + TLAB[g.t] + '</small></span><span class="rlv">Lv ' + e.lv + '</span><span class="els">' + (e.mode && MODE[e.mode] ? '<span class="m ' + MODE[e.mode][1] + '">' + MODE[e.mode][1] + '</span> ' + MODE[e.mode][2] : elHtml(g.els)) + '</span>'
    + '<span class="rmap">' + (e.map ? esc(e.map.name) : '') + '</span><span class="rstat">' + fmt(x) + ' EXP · ' + fmt(Math.ceil(need / x)) + ' abates</span></a>').join('')
    : '<p class="empty">Nenhum monstro com EXP nessa faixa. Aumente a faixa ou inclua mais tipos.</p>';
}
const XS = { lv: store.get('lv', 100), pct: 0, target: store.get('xtarget', 200), per: '' };
function viewExp() {
  setTitle('Calculadora de EXP');
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Calculadora de EXP</h1><p>Quanto falta do seu nível até o nível desejado.</p></div></div>'
    + '<section class="card"><div class="calc">'
    + '<div class="field"><label class="lbl" for="xlv">Nível atual</label><input id="xlv" type="number" inputmode="numeric" min="1" value="' + XS.lv + '"></div>'
    + '<div class="field"><label class="lbl" for="xpct">% do nível atual</label><input id="xpct" type="number" inputmode="decimal" min="0" max="100" step="any" value="' + XS.pct + '"></div>'
    + '<div class="field"><label class="lbl" for="xtg">Nível desejado</label><input id="xtg" type="number" inputmode="numeric" min="2" value="' + XS.target + '"></div>'
    + '<div class="field"><label class="lbl" for="xper">EXP por abate (opcional)</label><input id="xper" type="number" inputmode="numeric" min="0" placeholder="ex: 50000" value="' + XS.per + '"></div>'
    + '</div></section><section class="card"><div class="res" id="xres"></div><p class="note">Fórmula da comunidade para a EXP de cada nível: 0,025 × Nível⁴ + 2 × Nível. O resultado é aproximado. Para ver quanto um monstro dá, abra a página dele ou use "Onde upar".</p></section>';
  const calc = () => {
    const lv = Math.max(1, Math.floor(+$('#xlv').value || 1)), pct = Math.min(100, Math.max(0, +$('#xpct').value || 0)), tg = Math.floor(+$('#xtg').value || 0), per = +$('#xper').value || 0;
    XS.lv = lv; XS.pct = pct; XS.target = tg; XS.per = $('#xper').value; store.set('lv', lv); store.set('xtarget', tg);
    if (tg <= lv) { $('#xres').innerHTML = '<div><span class="lbl">Resultado</span><div>O nível desejado precisa ser maior que o atual.</div></div>'; return; }
    let total = Math.ceil(expNext(lv) * (1 - pct / 100));
    for (let L = lv + 1; L < tg; L++) total += expNext(L);
    $('#xres').innerHTML = '<div><span class="lbl">EXP que falta</span><div class="big">' + fmt(total) + '</div></div>'
      + '<div><span class="lbl">Só o nível ' + lv + ' → ' + (lv + 1) + '</span><div class="big">' + fmt(Math.ceil(expNext(lv) * (1 - pct / 100))) + '</div></div>'
      + (per > 0 ? '<div><span class="lbl">Abates necessários</span><div class="big">' + fmt(Math.ceil(total / per)) + '</div></div>' : '');
  };
  view.querySelectorAll('input').forEach(i => i.addEventListener('input', calc));
  calc();
}

// ---------- busca única ----------
const gq = $('#gq'), gres = $('#gres');
let gsel = -1;
function closeGlobal() { gres.hidden = true; gsel = -1; }
function gsearch() {
  const q = gq.value.trim().toLowerCase();
  if (!q || !DB) { closeGlobal(); return; }
  const score = n => { const s = n.toLowerCase(); return s === q ? 0 : s.startsWith(q) ? 1 : s.includes(' ' + q) ? 2 : 3; };
  const pick = (arr, name, lim) => arr.filter(x => name(x).toLowerCase().includes(q)).sort((a, b) => score(name(a)) - score(name(b)) || name(a).length - name(b).length).slice(0, lim);
  const ms = pick(DB.MONS, g => g.name, 6), is = pick(DB.ITEMS, i => i.name, 6), ps = pick(DB.MAPLIST, m => m.name, 4);
  const sec = (t, arr, fn) => arr.length ? '<h4>' + t + '</h4>' + arr.map(fn).join('') : '';
  gres.innerHTML = (ms.length + is.length + ps.length) ? sec('Monstros', ms, g => '<a href="' + monUrl(g) + '"><span>' + esc(g.name) + '</span><small>' + TLAB[g.t] + ' · Lv ' + lvTxt(g) + '</small></a>')
    + sec('Itens', is, i => '<a href="' + itemUrl(i) + '"><span>' + esc(i.name) + '</span><small>' + esc(i.tl) + '</small></a>')
    + sec('Mapas', ps, m => '<a href="' + mapUrl(m) + '"><span>' + esc(m.name) + '</span><small>' + m.mons.length + ' monstros</small></a>')
    : '<p class="none">Nada encontrado para "' + esc(gq.value) + '".</p>';
  gres.hidden = false; gsel = -1;
}
gq.addEventListener('input', gsearch);
gq.addEventListener('focus', () => { if (gq.value.trim()) gsearch(); });
gq.addEventListener('keydown', e => {
  const links = [...gres.querySelectorAll('a')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!links.length) return; gsel = (gsel + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length; links.forEach((a, k) => a.classList.toggle('sel', k === gsel)); }
  else if (e.key === 'Enter') { const a = links[gsel >= 0 ? gsel : 0]; if (a) { location.hash = a.getAttribute('href'); gq.value = ''; gq.blur(); } }
  else if (e.key === 'Escape') { closeGlobal(); gq.blur(); }
});
gres.addEventListener('click', e => { if (e.target.closest('a')) { gq.value = ''; closeGlobal(); gq.blur(); } });
document.addEventListener('click', e => { if (!e.target.closest('.gsearch')) closeGlobal(); });

// ---------- abertura ----------
Promise.all(['monstros', 'itens', 'fichas', 'loc'].map(load)).then(([mo, it, fi, loc]) => {
  DB = build(mo, it, fi, loc);
  route();
}).catch(err => {
  view.innerHTML = '<p class="nojs">Não deu para carregar os dados (' + esc(err.message) + '). Verifique a internet e recarregue a página.</p>';
});
