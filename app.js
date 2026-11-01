'use strict';
// Bestiário de Toram — app de página única com rotas por hash (#/monstros, #/item/123...).
// Os bancos ficam em data/*.json e são lidos uma vez na abertura.

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => Number(n).toLocaleString('pt-BR');
const nk = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const mainView = $('#view');
let view = mainView; // dentro do Personagem, aponta para a aba aberta
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
  [/^#\/crystas$/, 'itens', () => viewCrystas()],
  [/^#\/registlets$/, 'itens', () => viewRegistlets()],
  [/^#\/traits$/, 'itens', () => viewTraits()],
  [/^#\/glossario$/, 'ferramentas', () => viewGlossary()],
  [/^#\/item\/(\d+)$/, 'itens', id => viewItem(+id)],
  [/^#\/mapas$/, 'inicio', () => viewMaps()],
  [/^#\/mapa\/(\d+)$/, 'inicio', id => viewMap(+id)],
  [/^#\/ferramentas$/, 'ferramentas', () => viewTools()],
  [/^#\/upar$/, 'ferramentas', () => viewLeveling()],
  [/^#\/exp$/, 'ferramentas', () => viewExp()],
  [/^#\/pontos$/, 'ferramentas', () => viewPoints()],
  [/^#\/blacksmith$/, 'ferramentas', () => viewBlacksmith()],
  [/^#\/ninjutsu$/, 'ferramentas', () => viewScroll()],
  [/^#\/smithing$/, 'ferramentas', () => viewSmithing()],
  [/^#\/comida$/, 'ferramentas', () => viewFood()],
  [/^#\/eventos$/, 'inicio', () => viewEvents()],
  [/^#\/evento\/([a-z-]+)$/, 'inicio', k => viewEvent(k)],
  [/^#\/build(?:\/([A-Za-z0-9_-]+))?$/, 'personagem', code => viewChar('equipamento', code)],
  [/^#\/personagem(?:\/([a-z]+))?$/, 'personagem', tab => viewChar(tab)],
  [/^#\/p\/([A-Za-z0-9_-]+)$/, 'personagem', code => importChar(code)],
  [/^#\/dano$/, 'ferramentas', () => viewDamage()],
  [/^#\/skills(?:\/([A-Za-z0-9_-]+))?$/, 'personagem', code => viewChar('skills', code)],
  [/^#\/statting(?:\/([A-Za-z0-9_-]+))?$/, 'ferramentas', code => viewStatting(code)],
  [/^#\/noticias$/, 'inicio', () => viewNews()],
  [/^#\/farmar(?:\/(\d+))?$/, 'ferramentas', id => viewFarm(id ? +id : 0)],
  [/^#\/favoritos$/, 'inicio', () => viewFavs()],
  [/^#\/comparar(?:\/([\d,]+))?$/, 'itens', l => viewCompare(l)],
  [/^#\/noticia\/(\d+)$/, 'inicio', id => viewNewsItem(+id)]
];
const scrollMem = new Map();
let curHash = location.hash || '#/';
window.addEventListener('hashchange', () => { scrollMem.set(curHash, window.scrollY); curHash = location.hash || '#/'; route(); });
function route() {
  if (!DB) return;
  view = mainView;
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
    + '</div>'
    + '<div class="tiles hometiles">'
    + '<a class="tile" href="#/monstros/B"><b>Bosses</b><span>' + fmt(cnt('B')) + ' bosses</span></a>'
    + '<a class="tile" href="#/monstros/M"><b>Mini Bosses</b><span>' + fmt(cnt('M')) + ' mini bosses</span></a>'
    + '<a class="tile" href="#/monstros/N"><b>Monstros</b><span>' + fmt(cnt('N')) + ' normais</span></a>'
    + '<a class="tile" href="#/itens"><b>Itens</b><span>' + fmt(DB.ITEMS.length) + ' itens</span></a>'
    + '<a class="tile" href="#/upar"><b>Onde upar</b><span>Pelo seu nível</span></a>'
    + '<a class="tile" href="#/farmar"><b>Onde farmar</b><span>Material perto do seu nível</span></a>'
    + '<a class="tile" href="#/eventos"><b>Eventos</b><span>Do ano inteiro</span></a>'
    + '<a class="tile" href="#/exp"><b>Calculadora de EXP</b><span>Quanto falta</span></a>'
    + '<a class="tile" href="#/mapas"><b>Mapas</b><span>' + fmt(DB.MAPLIST.length) + ' mapas</span></a>'
    + '</div><div id="homeme"></div><section class="card" id="homenews"><h2>Notícias do jogo</h2><p class="muted" style="margin:0">Carregando…</p></section>' + candies
    + '<div class="grid2"><section class="card"><h2>Bosses mais novos</h2><div class="newl">' + newest.map(g => '<a class="lk" href="' + monUrl(g) + '">' + esc(g.name) + '</a>').join('') + '</div></section>'
    + '<section class="card"><h2>Itens mais novos</h2><div class="newl">' + newItems.map(i => '<a class="lk" href="' + itemUrl(i) + '">' + esc(i.name) + '</a>').join('') + '</div></section></div>';
  view.querySelectorAll('.cd[data-el]').forEach(a => a.addEventListener('click', () => { MS.els = new Set([+a.dataset.el]); MS.t = 'B'; }));
  const fav = FAV.map(refOf).filter(Boolean), rec = RECENT.map(refOf).filter(Boolean).slice(0, 8);
  const row = (h, arr, more) => '<section class="card"><h2>' + h + (more ? ' <a class="tl" href="' + more + '" style="margin-left:auto;font-size:13px;font-family:var(--font-body)">ver todos</a>' : '') + '</h2><div class="hscroll">' + arr.map(([u, n, s]) => '<a class="lk" href="' + u + '">' + esc(n) + ' <small>' + esc(s) + '</small></a>').join('') + '</div></section>';
  $('#homeme').innerHTML = (fav.length ? row('★ Seus favoritos', fav.slice(0, 12), '#/favoritos') : '') + (rec.length ? row('Vistos recentemente', rec) : '');
  homeNews();
}

// ---------- onde farmar: monstros que dropam um item, do mais perto ao mais longe do seu nível ----------
const FS = { id: 0, q: '', lv: store.get('lv', 100), ev: false };
function viewFarm(id) {
  setTitle('Onde farmar');
  if (id) FS.id = id;
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Onde farmar</h1><p>Escolha o material ou item e veja quem dropa, começando pelos monstros mais perto do seu nível.</p></div></div>'
    + '<section class="card"><div class="calc"><div class="field full"><label class="lbl" for="fq">Item ou material</label><input id="fq" type="search" placeholder="ex: Mithril Ore, Beast Blood, Kuzto" value="' + esc(FS.q) + '"></div>'
    + '<div class="field"><label class="lbl" for="flv">Seu nível</label><input id="flv" type="number" inputmode="numeric" min="1" value="' + FS.lv + '"></div>'
    + '<div class="field"><span class="lbl">Incluir</span><label class="check"><input id="fev" type="checkbox"' + (FS.ev ? ' checked' : '') + '> Eventos e limitados</label></div>'
    + '</div><div class="links" id="fsug" style="margin-top:10px"></div></section><div id="fres"></div>';
  const sug = () => {
    const q = FS.q.trim().toLowerCase();
    const it = q ? DB.ITEMS.filter(i => i.by.length && i.name.toLowerCase().includes(q)).sort((a, b) => (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1) || b.by.length - a.by.length).slice(0, 16) : [];
    $('#fsug').innerHTML = it.map(i => '<button type="button" class="lk' + (i.id === FS.id ? ' hit' : '') + '" data-fi="' + i.id + '">' + esc(i.name) + ' <small>' + i.by.length + ' monstros</small></button>').join('') || (q ? '<p class="muted" style="margin:0">Nenhum item com drop com esse nome.</p>' : '');
  };
  const res = () => {
    const it = DB.ITBYID.get(FS.id);
    if (!it) { $('#fres').innerHTML = ''; return; }
    const rows = it.by.filter(g => FS.ev || !g.event).map(g => { const e = g.entries.slice().sort((a, b) => Math.abs(a.lv - FS.lv) - Math.abs(b.lv - FS.lv))[0]; return { g, e, d: Math.abs(e.lv - FS.lv) }; }).sort((a, b) => a.d - b.d || a.e.lv - b.e.lv);
    $('#fres').innerHTML = '<div class="status"><span>' + esc(it.name) + ' · ' + rows.length + (rows.length === 1 ? ' monstro' : ' monstros') + (it.by.length > rows.length ? ' (+' + (it.by.length - rows.length) + ' de evento)' : '') + '</span><a class="tl" href="' + itemUrl(it) + '" style="color:#9fe3e6">ver o item</a></div>'
      + (rows.length ? '<div class="list"><div class="lh lm"><span>Monstro</span><span>Nível</span><span>Dificuldade</span><span>Mapa</span><span>Distância</span></div>' + rows.map(({ g, e, d }) => '<a class="row mrow" href="' + monUrl(g) + '"><span class="rn">' + esc(g.name) + ' <small>' + TLAB[g.t] + '</small></span><span class="rlv">Lv ' + e.lv + '</span><span class="els">' + (g.t !== 'N' && MODE[e.mode] ? '<span class="m ' + MODE[e.mode][1] + '">' + MODE[e.mode][1] + '</span> ' + MODE[e.mode][2] : elHtml(g.els)) + '</span><span class="rmap">' + (e.map ? esc(e.map.name) : '') + '</span><span class="rstat">' + (d <= 5 ? '<span class="tag ok">no seu nível</span>' : (e.lv > FS.lv ? '+' : '−') + d + ' níveis') + '</span></a>').join('') + '</div>'
        : '<p class="empty" style="color:var(--ink-2)">Só monstros de evento dropam este item. Marque “Eventos e limitados”.</p>')
      + '<p class="note" style="color:var(--ink-2)">Sem taxa de drop: o jogo não mostra. Em bosses, aparece a dificuldade mais perto do seu nível.</p>';
  };
  $('#fq').addEventListener('input', e => { FS.q = e.target.value; sug(); });
  $('#flv').addEventListener('input', e => { FS.lv = Math.max(1, +e.target.value || 1); store.set('lv', FS.lv); res(); });
  $('#fev').addEventListener('change', e => { FS.ev = e.target.checked; res(); });
  $('#fsug').addEventListener('click', e => { const b = e.target.closest('[data-fi]'); if (!b) return; FS.id = +b.dataset.fi; sug(); res(); });
  const cur = DB.ITBYID.get(FS.id); if (cur && !FS.q) { FS.q = cur.name; $('#fq').value = cur.name; }
  sug(); res();
}

// ---------- buscas separadas (como no Cy's Grimoire): Itens · Crystas · Registlets · Traits ----------
const ISUB = [['#/itens', 'Itens'], ['#/crystas', 'Crystas'], ['#/registlets', 'Registlets'], ['#/traits', 'Traits']];
const isubNav = cur => '<nav class="seg isub" aria-label="Buscas">' + ISUB.map(([h, l]) => '<a href="' + h + '" class="' + (h === cur ? 'on' : '') + '">' + l + '</a>').join('') + '</nav>';

// Crystas com a cadeia de evolução (quem evolui de quem), montada pelo status "Upgrade for" dos itens.
const XS2 = { q: '', t: '', limit: 40 };
function viewCrystas() {
  setTitle('Crystas');
  const all = DB.ITEMS.filter(i => XTAL_T.includes(i.tl));
  const rootOf = i => { let r = i, n = 0; while (r.from && XTAL_T.includes(r.from.tl) && n++ < 20) r = r.from; return r; };
  const chains = new Map();
  all.forEach(i => { const r = rootOf(i); if (!chains.has(r)) chains.set(r, []); });
  const walk = (i, d, out) => { out.push([i, d]); i.up.filter(u => XTAL_T.includes(u.tl)).sort((a, b) => a.id - b.id).forEach(u => walk(u, d + 1, out)); return out; };
  const groups = [...chains.keys()].map(r => ({ root: r, list: walk(r, 0, []) })).sort((a, b) => b.list.length - a.list.length || b.root.id - a.root.id);
  const tally = {}; all.forEach(i => { tally[i.tl] = (tally[i.tl] || 0) + 1; });
  view.innerHTML = isubNav('#/crystas') + '<div class="ph"><div><h1>Crystas</h1><p>Todas as crystas com a cadeia de evolução: de qual crysta cada uma sai e para qual evolui.</p></div></div>'
    + '<div class="tools"><input id="xq" type="search" placeholder="Nome ou status (ex: Kuzto, Critical)" value="' + esc(XS2.q) + '" aria-label="Buscar crysta"></div>'
    + '<div class="chips" id="xt" style="margin:0 0 10px">' + [['', 'Todas']].concat(XTAL_T.filter(t => tally[t]).map(t => [t, t.replace(' Crysta', '').replace('Enhancer', 'Enhancer') + ' (' + tally[t] + ')'])).map(([v, l]) => '<button type="button" class="chip" data-t="' + esc(v) + '" aria-pressed="' + (XS2.t === v) + '">' + esc(l) + '</button>').join('') + '</div>'
    + '<div class="status"><span id="xcount"></span></div><div id="xlist"></div><button class="more" id="xmore" type="button" hidden></button>';
  const statTxt = i => i.stats.filter(s => !isBase(s)).map(s => { const [n, v] = sparts(s); return n + ' ' + v; }).join(' ').toLowerCase();
  const draw = () => {
    const q = XS2.q.trim().toLowerCase();
    const rows = groups.filter(g => g.list.some(([i]) => (!XS2.t || i.tl === XS2.t) && (!q || i.name.toLowerCase().includes(q) || statTxt(i).includes(q))));
    $('#xcount').textContent = rows.length + (rows.length === 1 ? ' cadeia' : ' cadeias') + ' · ' + rows.reduce((a, g) => a + g.list.length, 0) + ' crystas';
    $('#xlist').innerHTML = rows.slice(0, XS2.limit).map(g => '<section class="card xchain">' + g.list.map(([i, d]) => {
      const pills = i.stats.filter(s => !isBase(s)).slice(0, 6).map(s => { const [n, v, c] = sparts(s); return '<span class="sp' + (s[1] < 0 ? ' neg' : '') + '">' + esc(n) + ' ' + v + (c ? ' <i>(' + esc(c) + ')</i>' : '') + '</span>'; }).join('');
      return '<div class="xstep" style="--d:' + d + '">' + (d ? '<span class="xarrow" aria-hidden="true">↳</span>' : '') + '<div><a class="tl" href="' + itemUrl(i) + '"><b>' + esc(i.name) + '</b></a> <small class="muted">' + esc(i.tl) + (i.by.length ? ' · drop de ' + i.by.length : '') + '</small><div class="st" style="margin-top:4px">' + pills + '</div></div></div>';
    }).join('') + '</section>').join('') || '<p class="empty" style="color:var(--ink-2)">Nenhuma crysta com esse filtro.</p>';
    const left = rows.length - XS2.limit; $('#xmore').hidden = left <= 0; $('#xmore').textContent = 'Mostrar mais (faltam ' + left + ')';
  };
  $('#xq').addEventListener('input', e => { XS2.q = e.target.value; XS2.limit = 40; draw(); });
  $('#xt').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; XS2.t = b.dataset.t; XS2.limit = 40; view.querySelectorAll('#xt .chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.t === XS2.t)); draw(); });
  $('#xmore').addEventListener('click', () => { XS2.limit += 40; draw(); });
  draw();
}

// Registlets: efeitos do coryn.club (em inglês); onde dropa vem do nosso banco de monstros.
let REGS = null; const RS = { q: '', f: '' };
function viewRegistlets() {
  setTitle('Registlets');
  if (!REGS) { view.innerHTML = isubNav('#/registlets') + '<p class="loading">Carregando registlets…</p>'; load('registlets').then(d => { REGS = d.regs; if (location.hash.startsWith('#/registlets')) viewRegistlets(); }); return; }
  view.innerHTML = isubNav('#/registlets') + '<div class="ph"><div><h1>Registlets</h1><p>O que cada registlet faz, até que nível vai e qual skill ele muda.</p></div></div>'
    + '<div class="tools"><input id="rq" type="search" placeholder="Nome, skill ou efeito (ex: Arrow Rain, Accuracy)" value="' + esc(RS.q) + '" aria-label="Buscar registlet"></div>'
    + '<div class="chips" id="rf" style="margin:0 0 10px">' + [['', 'Todos'], ['skill', 'Mudam uma skill'], ['status', 'Status e outros']].concat(REGS.some(r => { const it = DB.ITBYNAME.get(r[0].toLowerCase()); return it && it.by.length; }) ? [['drop', 'Dropam de monstro']] : []).map(([v, l]) => '<button type="button" class="chip" data-f="' + v + '" aria-pressed="' + (RS.f === v) + '">' + l + '</button>').join('') + '</div>'
    + '<div class="status"><span id="rcount"></span></div><div class="regs" id="rlist"></div>'
    + '<p class="note" style="color:var(--ink-2)">Efeitos do coryn.club, em inglês como no jogo. “Dropa de” cruza o nome do registlet com os drops do bestiário.</p>';
  const item = n => DB.ITBYNAME.get(n.toLowerCase());
  const draw = () => {
    const q = RS.q.trim().toLowerCase();
    const rows = REGS.filter(r => { const it = item(r[0]); if (RS.f === 'skill' && !r[2]) return false; if (RS.f === 'status' && r[2]) return false; if (RS.f === 'drop' && !(it && it.by.length)) return false; return !q || (r[0] + ' ' + r[2] + ' ' + r[3]).toLowerCase().includes(q); });
    $('#rcount').textContent = rows.length + ' registlets';
    $('#rlist').innerHTML = rows.map(r => { const it = item(r[0]); return '<section class="card reg"><h2>' + esc(r[0]) + '</h2><div class="chips" style="margin:-4px 0 8px"><span class="tag info">Nível máx. ' + (r[1] || '?') + '</span>' + (r[2] ? '<span class="tag ok">Muda: ' + esc(r[2]) + '</span>' : '') + '</div><p class="reff">' + esc(r[3]) + '</p>'
      + (it && it.by.length ? '<div class="dgroup"><span class="lbl">Dropa de</span><div class="links">' + it.by.slice(0, 6).map(g => '<a class="lk" href="' + monUrl(g) + '">' + esc(g.name) + ' <small>' + TLAB[g.t] + '</small></a>').join('') + (it.by.length > 6 ? '<a class="lk" href="' + itemUrl(it) + '">+' + (it.by.length - 6) + '</a>' : '') + '</div></div>' : '') + '</section>'; }).join('') || '<p class="empty" style="color:var(--ink-2)">Nenhum registlet com esse filtro.</p>';
  };
  $('#rq').addEventListener('input', e => { RS.q = e.target.value; draw(); });
  $('#rf').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; RS.f = b.dataset.f; view.querySelectorAll('#rf .chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.f === RS.f)); draw(); });
  draw();
}

// Traits: regras de transferência (texto nosso), calculadora de custo (fórmula do coryn.club) e lista de traits.
let TRT = null; const TS = { q: '', c: '' };
const TRAIT_CAT = { 'Common Effects': 'Efeitos comuns', 'Damage Triggered': 'Ao causar dano', 'Counter / Defense': 'Contra-ataque / defesa', 'Miss / Graze': 'Ao errar / graze', 'Unavailable': 'Indisponíveis' };
function viewTraits() {
  setTitle('Traits');
  if (!TRT) { view.innerHTML = isubNav('#/traits') + '<p class="loading">Carregando traits…</p>'; load('traits').then(d => { TRT = d; if (location.hash.startsWith('#/traits')) viewTraits(); }); return; }
  const cats = [...new Set(TRT.traits.map(t => t[1]))];
  view.innerHTML = isubNav('#/traits') + '<div class="ph"><div><h1>Traits</h1><p>Habilidades especiais que aparecem em armas e armaduras: como transferir, quanto custa e o que cada uma faz.</p></div></div>'
    + '<div class="grid2"><div><section class="card prose"><h2>Como funciona a transferência</h2>'
    + '<p>A transferência é feita no <b>Ferreiro da cidade</b>, em <i>Customize Equipment</i>. O equipamento nunca quebra: só os traits mudam.</p>'
    + '<p><b>Só entre o mesmo tipo:</b> espada de uma mão para espada de uma mão funciona; de uma mão para duas mãos, não.</p>'
    + '<p><b>Chance de sucesso:</b> usando o mesmo item, 100%. Com outro item do mesmo tipo, começa em 10%, antes do Radiant Chance e dos martelos.</p>'
    + '<p><b>O trait do alvo sempre é trocado:</b> se der certo, ele recebe o trait da origem; se falhar, ganha <b>Radiant Chance</b>.</p>'
    + '<p><b>Radiant Chance:</b> cada nível soma +10% de chance nas próximas tentativas, até o nível 9. Se os dois equipamentos tiverem, as chances somam; se falhar, o maior nível sobe 1.</p>'
    + '<p><b>Magic Hammer:</b> baixa a chance de propósito (até 0%) para acumular Radiant Chance mais rápido.</p></section></div>'
    + '<div><section class="card"><h2>Custo da transferência</h2><div class="calc"><div class="field"><label class="lbl" for="tfe">Equipamento</label><select id="tfe">' + TRT.fees.map(([n, v]) => '<option value="' + v + '">' + esc(n) + '</option>').join('') + '</select></div>'
    + '<div class="field"><label class="lbl" for="tft">Nível do trait (tier)</label><select id="tft">' + [1, 2, 3, 4, 5].map(x => '<option>' + x + '</option>').join('') + '</select></div>'
    + '<div class="field"><label class="lbl" for="tfs">ATK/DEF da origem</label><input id="tfs" type="number" inputmode="numeric" min="0" value="0"></div>'
    + '<div class="field"><label class="lbl" for="tfa">ATK/DEF do alvo</label><input id="tfa" type="number" inputmode="numeric" min="0" value="0"></div></div>'
    + '<div class="res" style="margin-top:12px"><div><span class="lbl">Custo por tentativa</span><div class="big" id="tfr">—</div><small class="muted">spina</small></div></div><p class="note">Fórmula do coryn.club.</p></section></div></div>'
    + '<h2 class="sect">Lista de traits <small style="font-family:var(--font-body);font-weight:400">' + TRT.traits.length + '</small></h2>'
    + '<div class="tools"><input id="tq" type="search" placeholder="Nome, status ou gatilho (ex: ASPD, HP, Evasion)" value="' + esc(TS.q) + '" aria-label="Buscar trait"></div>'
    + '<div class="chips" id="tc" style="margin:0 0 10px">' + [['', 'Todos']].concat(cats.map(c => [c, TRAIT_CAT[c] || c])).map(([v, l]) => '<button type="button" class="chip" data-c="' + esc(v) + '" aria-pressed="' + (TS.c === v) + '">' + esc(l) + '</button>').join('') + '</div>'
    + '<div class="regs" id="tlist"></div><p class="note" style="color:var(--ink-2)">Efeitos do coryn.club, em inglês como no jogo. “Tier” é o nível do trait (1 a 5).</p>';
  const fee = () => {
    const eqf = +$('#tfe').value || 0, src = Math.max(0, +$('#tfs').value || 0), tgt = Math.max(0, +$('#tfa').value || 0), tier = Math.max(1, +$('#tft').value || 1);
    const delta = Math.max(0, Math.floor(tgt * eqf / 10000) - Math.floor(src * eqf / 10000));
    $('#tfr').textContent = fmt(Math.round((Math.floor(delta * delta / 100) + 100) * 100 * (tier * (25 * tier - 25) + 100) * 0.01));
  };
  ['tfe', 'tft', 'tfs', 'tfa'].forEach(id => $('#' + id).addEventListener('input', fee)); fee();
  const draw = () => {
    const q = TS.q.trim().toLowerCase();
    const rows = TRT.traits.filter(t => (!TS.c || t[1] === TS.c) && (!q || (t[0] + ' ' + t[2] + ' ' + (t[3] || []).join(' ')).toLowerCase().includes(q)));
    $('#tlist').innerHTML = rows.map(t => '<section class="card reg"><h2>' + esc(t[0]) + '</h2><div class="chips" style="margin:-4px 0 8px"><span class="tag info">' + esc(TRAIT_CAT[t[1]] || t[1]) + '</span></div><p class="reff">' + esc(t[2]) + '</p>' + ((t[3] || []).length ? '<ul class="flist" style="font-size:13px">' + t[3].map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') + '</section>').join('') || '<p class="empty" style="color:var(--ink-2)">Nenhum trait com esse filtro.</p>';
  };
  $('#tq').addEventListener('input', e => { TS.q = e.target.value; draw(); });
  $('#tc').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; TS.c = b.dataset.c; view.querySelectorAll('#tc .chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.c === TS.c)); draw(); });
  draw();
}

// ---------- glossário (traduzido do Cy's Grimoire) ----------
let GLOS = null; const GS = { q: '', c: '' };
const glTxt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
function viewGlossary() {
  setTitle('Glossário');
  if (!GLOS) { view.innerHTML = '<p class="loading">Carregando o glossário…</p>'; load('glossario').then(d => { GLOS = d; if (location.hash.startsWith('#/glossario')) viewGlossary(); }); return; }
  const cats = [...new Set(GLOS.itens.map(x => x[1]))];
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Glossário</h1><p>Como o jogo funciona por dentro: fórmulas de dano, acerto e crítico, status negativos, combos e regras das armas.</p></div></div>'
    + '<div class="tools"><input id="gq2" type="search" placeholder="Buscar (ex: Flinch, crítico, estabilidade, aggro)" value="' + esc(GS.q) + '" aria-label="Buscar no glossário"></div>'
    + '<div class="chips" id="gc" style="margin:0 0 10px">' + [['', 'Todos'], ['*', '★ Importantes']].concat(cats.map(c => [c, c])).map(([v, l]) => '<button type="button" class="chip" data-c="' + esc(v) + '" aria-pressed="' + (GS.c === v) + '">' + esc(l) + '</button>').join('') + '</div>'
    + '<div class="status"><span id="gcount"></span><button class="link" id="gall" type="button">Abrir todos</button></div><div id="glist"></div>'
    + '<p class="note" style="color:var(--ink-2)">' + esc(GLOS.fonte) + '</p>';
  let openAll = false;
  const draw = () => {
    const q = GS.q.trim().toLowerCase();
    const rows = GLOS.itens.filter(x => (!GS.c || (GS.c === '*' ? x[2] : x[1] === GS.c)) && (!q || (x[0] + ' ' + x[3] + ' ' + x[4].join(' ')).toLowerCase().includes(q)));
    $('#gcount').textContent = rows.length + (rows.length === 1 ? ' verbete' : ' verbetes');
    $('#glist').innerHTML = rows.map(x => '<details class="card gl"' + (q || openAll || rows.length <= 3 ? ' open' : '') + '><summary><h2>' + esc(x[0]) + (x[2] ? ' <span class="tag ok">importante</span>' : '') + ' <small>' + esc(x[1]) + '</small></h2></summary><p>' + glTxt(x[3]) + '</p>' + (x[4].length ? '<ul class="flist">' + x[4].map(l => '<li>' + glTxt(l) + '</li>').join('') + '</ul>' : '') + '</details>').join('') || '<p class="empty" style="color:var(--ink-2)">Nada encontrado.</p>';
  };
  $('#gq2').addEventListener('input', e => { GS.q = e.target.value; draw(); });
  $('#gc').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; GS.c = b.dataset.c; view.querySelectorAll('#gc .chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.c === GS.c)); draw(); });
  $('#gall').addEventListener('click', () => { openAll = !openAll; $('#gall').textContent = openAll ? 'Fechar todos' : 'Abrir todos'; draw(); });
  draw();
}

// ---------- comparar itens lado a lado ----------
let CMP = store.get('cmp', []);
const inCmp = id => CMP.includes(id);
function toggleCmp(id) { CMP = inCmp(id) ? CMP.filter(x => x !== id) : CMP.concat(id).slice(-4); store.set('cmp', CMP); }
function viewCompare(list) {
  setTitle('Comparar itens');
  if (list) { CMP = list.split(',').map(Number).filter(id => DB.ITBYID.get(id)).slice(0, 4); store.set('cmp', CMP); history.replaceState(null, '', '#/comparar'); }
  const its = CMP.map(id => DB.ITBYID.get(id)).filter(Boolean);
  if (!its.length) { view.innerHTML = backBtn('#/itens') + '<div class="ph"><div><h1>Comparar itens</h1><p>Abra um item e toque em “Comparar” para colocar aqui. Dá para comparar até 4.</p></div></div><p class="empty" style="color:var(--ink-2)">Nenhum item na comparação.</p>'; return; }
  const base = it => { const g = n => (it.stats.find(s => DB.STATN[s[0]] === n) || [0, null])[1]; return { atk: g('Base ATK'), def: g('Base DEF'), stab: g('Base Stability %') }; };
  const sum = new Map();
  its.forEach((it, k) => it.stats.forEach(s => { if (isBase(s)) return; const key = s[0] + ':' + s[2]; if (!sum.has(key)) sum.set(key, { s, v: Array(its.length).fill(null) }); const e = sum.get(key); e.v[k] = (e.v[k] || 0) + s[1]; }));
  const rows = [...sum.values()].sort((a, b) => b.v.filter(x => x !== null).length - a.v.filter(x => x !== null).length || DB.STATN[a.s[0]].localeCompare(DB.STATN[b.s[0]]));
  const best = v => { const n = v.filter(x => x !== null); return n.length > 1 ? Math.max(...n) : null; };
  const cell = (val, b, lab) => '<td class="n' + (val !== null && b !== null && val === b ? ' best' : '') + (val !== null && val < 0 ? ' neg' : '') + '">' + (val === null ? '—' : lab(val)) + '</td>';
  const baseRows = [['ATK base', 'atk', v => fmt(v)], ['DEF base', 'def', v => fmt(v)], ['Estabilidade', 'stab', v => v + '%']].map(([lab, k, f]) => { const v = its.map(it => base(it)[k]); return v.some(x => x !== null) ? '<tr><th scope="row">' + lab + '</th>' + v.map(x => cell(x, best(v), f)).join('') + '</tr>' : ''; }).join('');
  const statRows = rows.map(({ s, v }) => { const [n, , c] = sparts([s[0], 1, s[2]]); const pct = DB.STATN[s[0]].includes('%'); return '<tr><th scope="row">' + esc(n) + (c ? '<small>' + esc(c) + '</small>' : '') + '</th>' + v.map(x => cell(x, best(v), y => (y > 0 ? '+' : y < 0 ? '−' : '') + fmt(Math.abs(y)) + (pct ? '%' : ''))).join('') + '</tr>'; }).join('');
  view.innerHTML = backBtn('#/itens') + '<div class="ph"><div><h1>Comparar itens</h1><p>Em dourado, o melhor valor de cada linha. Toque no × para tirar um item.</p></div></div>'
    + '<section class="card"><div class="tblw"><table class="tbl cmp"><thead><tr><th></th>' + its.map(it => '<th scope="col"><a class="tl" href="' + itemUrl(it) + '">' + esc(it.name) + '</a><small>' + esc(it.tl) + '</small><button type="button" class="slotx" data-rm="' + it.id + '" aria-label="Tirar da comparação">×</button></th>').join('') + '</tr></thead><tbody>' + baseRows + statRows + '</tbody></table></div>'
    + '<div class="chips" style="margin-top:12px"><button class="btn" id="cmpshare" type="button">Copiar link da comparação</button><button class="btn ghost" id="cmpclear" type="button">Limpar</button></div><p class="note" id="cmpmsg">A comparação fica salva neste aparelho.</p></section>';
  view.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { toggleCmp(+b.dataset.rm); viewCompare(); }));
  $('#cmpclear').addEventListener('click', () => { CMP = []; store.set('cmp', CMP); viewCompare(); });
  $('#cmpshare').addEventListener('click', () => { const url = location.href.split('#')[0] + '#/comparar/' + CMP.join(','); const done = () => { $('#cmpmsg').textContent = 'Link copiado!'; }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => { fallbackCopy(url); done(); }); else { fallbackCopy(url); done(); } });
}

// ---------- favoritos e vistos recentemente (ficam salvos no aparelho) ----------
let FAV = store.get('fav', []);       // chaves 'm:id' (monstro), 'i:id' (item), 'p:id' (mapa)
let RECENT = store.get('recent', []);
function refOf(k) {
  const [t, s] = k.split(':'), n = +s;
  if (t === 'm') { const g = DB.GBYID.get(n); return g ? [monUrl(g), g.name, TLAB[g.t]] : null; }
  if (t === 'i') { const i = DB.ITBYID.get(n); return i ? [itemUrl(i), i.name, i.tl] : null; }
  if (t === 'p') { const m = DB.MAPS.get(n); return m ? [mapUrl(m), m.name, 'Mapa'] : null; }
  return null;
}
function addRecent(k) { RECENT = [k].concat(RECENT.filter(x => x !== k)).slice(0, 12); store.set('recent', RECENT); }
const isFav = k => FAV.includes(k);
const favBtn = k => ' <button type="button" class="fav" data-fav="' + k + '" aria-pressed="' + isFav(k) + '" aria-label="Favoritar" title="Favoritar">' + (isFav(k) ? '★' : '☆') + '</button>';
document.addEventListener('click', e => {
  const b = e.target.closest('[data-fav]'); if (!b) return;
  const k = b.dataset.fav;
  FAV = isFav(k) ? FAV.filter(x => x !== k) : [k].concat(FAV);
  store.set('fav', FAV);
  b.setAttribute('aria-pressed', isFav(k)); b.textContent = isFav(k) ? '★' : '☆';
});
function viewFavs() {
  setTitle('Favoritos');
  const groups = [['m', 'Monstros'], ['i', 'Itens'], ['p', 'Mapas']].map(([t, lab]) => [lab, FAV.filter(k => k.startsWith(t + ':')).map(k => [k, refOf(k)]).filter(x => x[1])]).filter(g => g[1].length);
  view.innerHTML = backBtn('#/') + '<div class="ph"><div><h1>Favoritos</h1><p>Toque na estrela ☆ na página de um monstro, item ou mapa para guardar aqui. Fica salvo neste aparelho.</p></div></div>'
    + (groups.length ? groups.map(([lab, arr]) => '<section class="card"><h2>' + lab + ' <small>' + arr.length + '</small></h2><div class="links">' + arr.map(([k, [u, n, s]]) => '<span class="favrow"><a class="lk" href="' + u + '">' + esc(n) + ' <small>' + esc(s) + '</small></a><button type="button" class="slotx" data-unfav="' + k + '" aria-label="Tirar dos favoritos">×</button></span>').join('') + '</div></section>').join('')
      : '<p class="empty" style="color:var(--ink-2)">Nenhum favorito ainda.</p>');
  view.querySelectorAll('[data-unfav]').forEach(b => b.addEventListener('click', () => { FAV = FAV.filter(x => x !== b.dataset.unfav); store.set('fav', FAV); viewFavs(); }));
}
const lvTxt = g => g.lo === g.hi ? String(g.lo) : g.lo + '–' + g.hi;

// ---------- lista de monstros ----------
const MS = { t: 'B', q: '', lmin: '', lmax: '', mode: '', els: new Set(), noevent: false, tame: false, map: 0, sort: 'lv', dir: 1, limit: 60, open: false };
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
  const nm = (a, b) => a.name.localeCompare(b.name, 'pt', { ignorePunctuation: true });
  const ent = g => (MS.mode && g.entries.find(x => x.mode === MS.mode)) || g;
  const elN = g => g.els.length ? EL[g.els[0]][0] : '~';
  const mapN = g => g.mapList.length ? g.mapList[0].name : '';
  const by = {
    name: nm, lv: (a, b) => (ent(a).lv || a.lo) - (ent(b).lv || b.lo) || a.hi - b.hi,
    el: (a, b) => elN(a).localeCompare(elN(b), 'pt'),
    // Sem mapa fica sempre no fim, nas duas direções.
    map: (a, b) => (!mapN(a) - !mapN(b)) * MS.dir || mapN(a).localeCompare(mapN(b), 'pt'),
    hp: (a, b) => ent(a).hp - ent(b).hp, exp: (a, b) => ent(a).exp - ent(b).exp
  }[MS.sort] || (() => 0);
  return rows.sort((a, b) => by(a, b) * MS.dir || nm(a, b));
}
// Colunas que ordenam a lista; o 3º valor é a direção do 1º toque (1 = crescente, -1 = decrescente).
const MSORTS = [['name', 'Nome', 1], ['lv', 'Nível', 1], ['el', 'Elemento', 1], ['map', 'Mapa', 1], ['hp', 'HP', -1], ['exp', 'EXP', -1]];
const msortBtn = ([k, l]) => '<button type="button" class="sortb' + (MS.sort === k ? ' on' : '') + '" data-sort="' + k + '" aria-pressed="' + (MS.sort === k) + '">' + l + (MS.sort === k ? '<i aria-label="' + (MS.dir > 0 ? 'crescente' : 'decrescente') + '">' + (MS.dir > 0 ? '↑' : '↓') + '</i>' : '') + '</button>';
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
  // Ordenar: tocar numa coluna ordena por ela; tocar de novo inverte.
  $('#mlist').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]'); if (!b) return;
    const s = MSORTS.find(x => x[0] === b.dataset.sort);
    if (MS.sort === s[0]) MS.dir = -MS.dir; else { MS.sort = s[0]; MS.dir = s[2]; }
    rer();
  });
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
  const sb = k => msortBtn(MSORTS.find(x => x[0] === k));
  list.innerHTML = '<div class="msortbar" role="group" aria-label="Ordenar por"><span class="lbl">Ordenar</span>' + MSORTS.map(msortBtn).join('') + '</div>'
    + '<div class="lh lm"><span>' + sb('name') + '</span><span>' + sb('lv') + '</span><span>' + sb('el') + '</span><span>' + sb('map') + '</span><span>' + sb('hp') + ' · ' + sb('exp') + '</span></div>' + rows.slice(0, MS.limit).map(g => {
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
  { nome: 'Iruna', w: 5367, h: 3096, view: [1120, 240, 4580, 2790], ov: 'mapas/iruna-geral.jpg', url: 'mapas/iruna-zoom.jpg' },
  { nome: 'Toram', w: 5438, h: 3137, view: [820, 680, 5000, 2800], ov: 'mapas/toram-geral.jpg', url: 'mapas/toram-zoom.jpg' }
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
  setTitle(g.name); addRecent('m:' + g.id);
  const f = fichaFor(g);
  const candy = candyOn() ? g.els.map(candyFor).filter(Boolean) : [];
  const head = '<div class="dhead"><h1>' + esc(g.name) + favBtn('m:' + g.id) + '</h1><div class="dmeta"><span class="pill">' + TLAB[g.t] + '</span><span class="els">' + elHtml(g.els) + '</span>' + monTags(g)
    + candy.map(c => '<span class="candy">🎃 Dropa ' + esc(c) + ' (Halloween)</span>').join('')
    + eventData().filter(ev => ev.key !== 'outros' && ev.mons.includes(g)).map(ev => '<a class="tl" href="#/evento/' + ev.key + '">Evento: ' + esc(ev.name) + '</a>').join('') + '</div>'
    + (g.entries.some(e => e.hp > 0) ? '<p style="margin:10px 0 0"><button type="button" class="btn" id="todmg">Calcular meu dano neste monstro</button></p>' : '') + '</div>';
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
  const td = $('#todmg');
  if (td) td.addEventListener('click', () => { setTarget(g, (g.entries.find(x => x.mode === 'Ultimate') || g.entries[g.entries.length - 1]).mode); store.set('dano', DM); location.hash = '#/dano'; });
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
// Nomes das linhas das fichas RAID em português (os guias vêm em inglês).
const FICHA_PT = [['Physical Defense', 'DEF'], ['Magical Defense', 'MDEF'], ['Physical Resistance', 'Resistência física'], ['Magical Resistance', 'Resistência mágica'], ['Neutral Prorate', 'Proration neutra'], ['Physical Prorate', 'Proration física'], ['Magical Prorate', 'Proration mágica'], ['Critical Resistance', 'Resistência crítica'], ['Flee', 'Esquiva (Flee)'], ['Guard', 'Guarda'], ['Evasion', 'Evasão'], ['Flinch', 'Flinch (recuo)'], ['Tumble', 'Tumble (derrubar)'], ['Stun', 'Stun (atordoar)'], ['Nightmare', 'Pesadelo'], ['Ultimate', 'Ultimate'], ['Easy', 'Fácil'], ['Hard', 'Difícil'], ['Normal', 'Normal']];
const trFicha = s => { for (const [en, pt] of FICHA_PT) if (s.startsWith(en)) return pt + s.slice(en.length); return s; };
function fichaHtml(f) {  const row = (a, num) => '<tr>' + a.map((c, i) => '<' + (i ? 'td' : 'th scope="row"') + '>' + esc(i ? (num ? fnum(c) : (c === '' ? '—' : String(c))) : trFicha(String(c))) + '</' + (i ? 'td' : 'th') + '>').join('') + '</tr>';
  const head = c => '<thead><tr>' + c.map(x => '<th scope="col">' + esc(trFicha(x)) + '</th>').join('') + '</tr></thead>';
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
const IS = { q: '', cat: '', obt: '', weap: store.get('weap', 0), sort: 'name', chips: new Set(), fl: [], drop: false, noevent: false, limit: 60, open: false };
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
    if (IS.obt === 'none' ? i.by.length : IS.obt && !i.by.some(g => g.t === IS.obt)) return false;
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
function itemActiveCount() { return !!IS.obt + !!IS.cat + !!IS.weap + IS.chips.size + IS.fl.length + IS.drop + IS.noevent + (IS.sort !== 'name'); }
function viewItems() {
  setTitle('Itens');
  if (!PRINC) PRINC = PRINC_DEF.map(([lab, names, sign]) => ({ lab, idx: names.map(SI).filter(x => x >= 0), sign: sign || 1 }));
  const tally = {};
  DB.ITEMS.forEach(i => { tally[i.tl] = (tally[i.tl] || 0) + 1; });
  const statOpts = DB.STATN.map((n, i) => [n, i]).filter(x => x[0].trim() && !isBase([x[1]])).sort((a, b) => a[0].localeCompare(b[0]));
  const opt = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>';
  view.innerHTML = isubNav('#/itens') + '<div class="ph"><div><h1>Itens</h1><p>Armas, armaduras, crystas e materiais com status, quem dropa e de onde evoluem.</p></div></div>'
    + '<div class="tools"><input id="iq" type="search" placeholder="Item, nota ou monstro (ex: Mithril)" value="' + esc(IS.q) + '" aria-label="Buscar item">'
    + '<button class="fbtn" id="ifb" type="button" aria-expanded="' + IS.open + '">Filtros<b id="ifn"></b></button></div>'
    + '<section class="card" id="ifp"' + (IS.open ? '' : ' hidden') + '><div class="fpanel">'
    + '<div class="field"><label class="lbl" for="icat">Categoria</label><select id="icat">' + opt('', 'Todas', !IS.cat)
    + [['Armas', 'W', 'Todas as armas', WEAP_T], ['Equipamentos', '', '', EQUIP_T], ['Crystas', 'X', 'Todas as crystas', XTAL_T], ['Outros', '', '', OTHER_T]].map(([g, all, allLab, list]) => '<optgroup label="' + g + '">' + (all ? opt(all, allLab, IS.cat === all) : '') + list.filter(t => tally[t]).map(t => opt(t, t + ' (' + tally[t] + ')', IS.cat === t)).join('') + '</optgroup>').join('') + '</select></div>'
    + '<div class="field"><label class="lbl" for="iweap">Sua arma</label><select id="iweap">' + IWEAP.map(([v, l]) => opt(v, l, IS.weap === v)).join('') + '</select></div>'
    + '<div class="field"><label class="lbl" for="isort">Ordenar por</label><select id="isort">' + opt('name', 'Nome (A–Z)', IS.sort === 'name') + opt('new', 'Mais novos', IS.sort === 'new') + opt('base', 'Base ATK/DEF', IS.sort === 'base') + '<optgroup label="Maior valor de">' + statOpts.map(([n, i]) => opt('s:' + i, n, IS.sort === 's:' + i)).join('') + '</optgroup></select></div>'
    + '<div class="field"><label class="lbl" for="iobt">Forma de obter</label><select id="iobt">' + [['', 'Todas'], ['B', 'Drop de boss'], ['M', 'Drop de mini boss'], ['N', 'Drop de monstro normal'], ['none', 'Não dropa (craft, NPC, missão, troca)']].map(([v, l]) => opt(v, l, IS.obt === v)).join('') + '</select></div>'
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
  $('#iobt').addEventListener('change', e => { IS.obt = e.target.value; rer(); });
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
  $('#ireset').addEventListener('click', () => { Object.assign(IS, { q: '', cat: '', obt: '', sort: 'name', fl: [], drop: false, noevent: false, limit: 60 }); IS.chips.clear(); viewItems(); });
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
  setTitle(i.name); addRecent('i:' + i.id);
  const st = i.stats.filter(s => s[0] !== DB.S_UPG);
  const list = st.length ? '<section class="card"><h2>Status</h2><div class="slist">' + st.map(s => { const [n, v, c] = sparts(s); return '<div class="' + (s[1] < 0 ? 'neg' : '') + '"><span>' + esc(n) + (c ? '<small>' + esc(c) + '</small>' : '') + '</span><b>' + v + '</b></div>'; }).join('') + '</div></section>' : '';
  const meta = [['Tipo', esc(i.tl || 'Outros')], i.proc ? ['Processar', i.pa + ' ' + PROC[i.proc]] : null, i.sell ? ['Venda', fmt(i.sell) + ' Spina'] : null, i.badge ? ['Origem', esc(i.badge)] : null].filter(Boolean);
  const tree = (i.from || i.up.length) ? '<section class="card"><h2>Evolução</h2>' + (i.from ? '<div class="dgroup"><span class="lbl">Evolui de</span><div class="links"><a class="lk" href="' + itemUrl(i.from) + '">' + esc(i.from.name) + '</a></div></div>' : '')
    + (i.up.length ? '<div class="dgroup"><span class="lbl">Evolui para</span><div class="links">' + i.up.map(u => '<a class="lk" href="' + itemUrl(u) + '">' + esc(u.name) + '</a>').join('') + '</div></div>' : '') + '</section>' : '';
  const by = i.by.slice().sort((a, b) => 'BMN'.indexOf(a.t) - 'BMN'.indexOf(b.t) || a.lo - b.lo);
  const drops = '<section class="card"><h2>Dropado por' + (by.length ? ' <small>' + by.length + (by.length === 1 ? ' monstro' : ' monstros') + '</small>' : '') + '</h2>'
    + (by.length ? '<div class="links">' + by.map(g => '<a class="lk" href="' + monUrl(g) + '">' + esc(g.name) + ' <small>' + TLAB[g.t] + ' · Lv ' + lvTxt(g) + (g.mapList[0] ? ' · ' + esc(g.mapList[0].name) : '') + '</small></a>').join('') + '</div>'
      : '<p class="muted" style="margin:0">Nenhum monstro do bestiário dropa este item. Ele pode vir de craft, NPC, missão, evento ou baú.</p>') + '</section>';
  // Em que espaço da calculadora de status o item entra (arma, sub, armadura... ou crysta).
  const slotFor = SLOTS.find(s => s[2].includes(i.tl)) || SLOTS.find(s => s[3].includes(i.tl));
  const equip = (slotFor || i.by.length || i.stats.length) ? '<p class="chips" style="margin:10px 0 0">' + (slotFor ? '<button type="button" class="btn" id="equip">Equipar na calculadora de status</button>' : '') + (i.by.length ? '<a class="btn ghost" href="#/farmar/' + i.id + '">Onde farmar perto do meu nível</a>' : '') + (i.stats.length ? '<button type="button" class="btn ghost" id="cmpbtn">' + (inCmp(i.id) ? '✓ Na comparação' : 'Comparar') + '</button>' + (CMP.length ? '<a class="tl" href="#/comparar" style="align-self:center">ver comparação (' + CMP.length + ')</a>' : '') : '') + '</p>' : '';
  view.innerHTML = backBtn('#/itens') + '<div class="dhead"><h1>' + esc(i.name) + favBtn('i:' + i.id) + '</h1><div class="dmeta">' + meta.map(([k, v]) => '<span><span class="muted">' + k + '</span> ' + v + '</span>').join('') + itemTags(i) + '</div>'
    + (i.note ? '<p class="inote">' + esc(i.note) + '</p>' : '') + equip + '</div><div class="grid2"><div>' + list + tree + '</div><div>' + drops + '</div></div>';
  const cb = $('#cmpbtn'); if (cb) cb.addEventListener('click', () => { toggleCmp(i.id); viewItem(i.id); });
  if (slotFor) $('#equip').addEventListener('click', () => {
    const s = BD.sl[slotFor[0]];
    if (slotFor[2].includes(i.tl)) s.id = i.id;
    else { s.x = s.x || [0, 0]; const free = s.x.indexOf(0); s.x[free < 0 ? 0 : free] = i.id; }
    saveBuild(); location.hash = '#/build';
  });
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
  setTitle(m.name); addRecent('p:' + m.id);
  const l = DB.LOC[m.name];
  const sec = TYPES.map(([t, lab]) => {
    const gs = m.mons.filter(g => g.t === t).sort((a, b) => a.lo - b.lo);
    return gs.length ? '<div class="dgroup"><span class="lbl">' + lab + ' (' + gs.length + ')</span><div class="links">' + gs.map(g => '<a class="lk" href="' + monUrl(g) + '">' + esc(g.name) + ' <small>Lv ' + lvTxt(g) + '</small></a>').join('') + '</div></div>' : '';
  }).join('');
  view.innerHTML = backBtn('#/mapas') + '<div class="dhead"><h1>' + esc(m.name) + favBtn('p:' + m.id) + '</h1><div class="dmeta">' + (l ? '<span class="pill">Mundo ' + WORLDS[l[0]].nome + '</span>' : '') + '<span class="muted">' + m.mons.length + (m.mons.length === 1 ? ' monstro' : ' monstros') + '</span></div></div>'
    + '<div class="grid2"><div><section class="card"><h2>Monstros deste mapa</h2>' + (sec || '<p class="muted" style="margin:0">O coryn.club não lista monstros neste mapa.</p>') + '</section></div><div>' + locHtml([m.name]) + '</div></div>';
}

// ---------- ferramentas ----------
// EXP para passar do nível L para L+1 (fórmula difundida pela comunidade).
const expNext = L => Math.floor(0.025 * L ** 4 + 2 * L);
function viewTools() {
  setTitle('Ferramentas');
  const t = (href, b, s) => '<a class="tile" href="' + href + '"><b>' + b + '</b><span>' + s + '</span></a>';
  view.innerHTML = '<div class="ph"><div><h1>Ferramentas</h1><p>Calculadoras e guias para o dia a dia.</p></div></div>'
    + '<h2 class="sect">Upar</h2><div class="tiles">'
    + t('#/upar', 'Onde upar', 'Melhores monstros por EXP para o seu nível, com bônus de emblema e ticket')
    + t('#/farmar', 'Onde farmar', 'Escolha um material e veja quem dropa perto do seu nível')
    + t('#/favoritos', 'Favoritos', 'Monstros, itens e mapas que você marcou com estrela')
    + t('#/exp', 'Calculadora de EXP', 'EXP até o nível desejado, missões principais e Diário do Aventureiro')
    + t('#/pontos', 'Pontos de status e skill', 'Quantos pontos você tem pelo nível e pelos emblemas')
    + t('#/comida', 'Códigos de comida', 'Casas com comida de buff: STR, DEX, crítico, ATK, aggro e mais')
    + '</div><h2 class="sect">Smith e equipamentos</h2><div class="tiles">'
    + t('#/personagem/equipamento', 'Status do personagem', 'Monte arma, armadura, adicional, anel e crystas e veja os status somados')
    + t('#/dano', 'Calculadora de dano', 'Quanto a sua build bate num boss e quantos golpes para derrubar')
    + t('#/personagem/skills', 'Simulador de skills', 'As 33 árvores de skill, com pré-requisitos e contagem de pontos')
    + t('#/glossario', 'Glossário', 'Fórmulas de dano, acerto e crítico, status negativos e combos, em português')
    + t('#/smithing', 'Guia de smithing', 'Criação, status (statting), refino e materiais, em português')
    + t('#/statting', 'Simulador de statting', 'Monte a fórmula passo a passo: potencial, sucesso e materiais')
    + t('#/blacksmith', 'Calculadora de blacksmith', 'Dificuldade, taxa de sucesso e potencial da criação')
    + t('#/ninjutsu', 'Ninjutsu Scroll', 'Que armas usar para cada pergaminho, e o que cada combinação dá')
    + t('#/itens', 'Busca avançada de itens', 'Filtre por qualquer status, arma, categoria e forma de obter')
    + t('#/crystas', 'Crystas', 'Todas as crystas com a cadeia de evolução')
    + t('#/registlets', 'Registlets', 'O que cada registlet faz e qual skill ele muda')
    + t('#/traits', 'Traits', 'Efeitos, regras de transferência e custo no ferreiro')
    + '</div><h2 class="sect">Monstros</h2><div class="tiles">'
    + t('#/eventos', 'Eventos', 'Monstros, mapas e itens de cada evento do ano')
    + t('#/monstros/N', 'Capturáveis (pets)', 'Use o filtro "Só capturáveis" na lista de monstros')
    + t('#/mapas', 'Mapas', 'Todos os mapas com os monstros de cada um')
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
// ---------- calculadora de EXP (níveis, repetíveis, missões principais) ----------
// EXP das missões principais (capítulos 1 a 16) e das repetíveis: dados do Toram Tools (Insane23), catálogo de XPPlayer1337.
const MQ = [
  [1, 'First Time Visit', 30], [1, 'Straye Brother and Sister', 80], [1, 'A Golem on a Rampage', 730], [1, 'The Goddess of Wisdom', 2050], [1, "The Dragon's Den", 4700], [1, 'The Ruined Temple', 9330], [1, 'The First Magic Stone', 16700], [1, 'Purification Incense', 27900], [1, 'The Dragon and Black Crystal', 43000],
  [2, 'The Merchant Girl', 64000], [2, 'Where Are the Gems?', 92000], [2, 'Who is the Black Knight?!', 118200], [2, 'Trials in the Palace', 149000], [2, 'The Moon Wizard', 172000], [2, 'The Follower and Hater', 227000], [2, "The Wizard's Cave", 240000], [2, 'The Star Wizard', 255000],
  [3, 'The Invincible... Enemy??', 270000], [3, 'The Ancient Empress', 284000], [3, 'The Culprit', 319000], [3, 'Fate of the Fortress', 335000], [3, 'Memory in the Lost Town', 398000], [3, 'The Stolen Sorcery Gem', 417000], [3, 'Living with a Dragon', 462300], [3, 'Monsters from Outerworld', 540000],
  [4, 'The Mage Diels', 562000], [4, 'Journey for Reconstruction', 585000], [4, 'The Sacred Gem in Akaku', 710000], [4, 'The King of Darkan', 740000], [4, 'The Lurking Evil', 803000], [4, 'Find the False Black Knight!', 913000], [4, "Technista's Movement", 1000000], [4, 'The Falling Feather of Death', 1100000],
  [5, 'In The Unknown Darkness', 1150000], [5, 'The Charm', 1310000], [5, 'Parching Dark Mirror', 1370000], [5, 'Fierce Battle in the Garden', 1550000], [5, 'A Light in the Darkness', 1750000], [5, 'The Ones Nesting in the Manor', 1970000], [5, 'The Dark Castle', 2210000], [5, 'To The Living World', 2220000],
  [6, 'Demi Machina', 2600000], [6, 'The Town of Pax Faction', 2700000], [6, 'Mechanical Heart', 2800000], [6, 'Black Knights of Lyark', 2820000], [6, 'The Mysterious Artifact', 3030000], [6, 'Truth of the Artifact', 3099000], [6, 'The Price of Treachery', 3320000], [6, 'The Blasphemous Factory', 3640000], [6, 'Mystery of the Black Knights', 4020000],
  [7, "Monster's Forest", 4730000], [7, 'The Underground Town', 4820000], [7, 'The Elves in Lyark', 5070000], [7, 'The Mad Laboratory', 5500000], [7, 'Tragedy in the Jail', 6000000], [7, 'Calamity in Droma Square', 6400000], [7, 'Head for Ultimea Palace', 6900000], [7, 'The Chaotic Truth', 7400000],
  [8, 'The Mine Where Monsters Lurk', 8400000], [8, 'The Mysterious Shadow', 8500000], [8, 'The New Diel Country', 8600000], [8, 'The Ruins of the Gods', 8800000], [8, 'The Former God of Justice', 9100000], [8, 'The Remaining Thrones in the Shrine', 9700000], [8, "Gods' Whereabouts", 10400000], [8, "The Wait at Specia's Shrine", 11100000], [8, 'The Warden of Ice & Snow', 11800000], [8, "At Mountains' End", 12500000],
  [9, 'Deadly Road to Eldenbaum', 15800000], [9, 'Unforeseen Traps', 17100000], [9, 'Traces of Technological Progress', 18200000], [9, 'An Unexpected Acquaintance', 19200000], [9, 'Front Line Base Operation', 20300000], [9, 'Strategy to Redeem the Treetop Harbor', 21500000], [9, 'The Teleporter Left Behind', 22700000], [9, 'The Man Who Seeks Death', 23900000], [9, 'The Battle to Recapture Eldenbaum', 25000000, 1], [9, 'A New Beginning', 13000000],
  [10, 'Off to the Fateful Land', 26000000], [10, 'The Inhabitants Under the Cliff', 27400000], [10, 'The Nightmare Returns', 28800000], [10, 'The Whereabouts of the Missing Monks', 30200000], [10, 'The Goddess of Justice and the Squatters', 31600000], [10, 'Navigator of the Ark', 33100000], [10, 'Witch in the Woods', 34600000], [10, 'The Duel in Nov Diela', 36200000],
  [11, 'Flying the Ark', 37800000], [11, 'Land of the Unknown', 49000000], [11, 'The Strolling Forest', 51000000], [11, 'Eumanos the Forest Dwellers', 53400000], [11, 'A Sproutling is Born', 55700000], [11, 'The Blessing-Bearer', 58100000], [11, "Intense Battle in Coenubia's Stronghold", 60500000], [11, 'The Shadow of a Smoky Mountain', 63000000], [11, 'The Weredragons & the Underground World', 65500000],
  [12, 'The Sky with a Ceiling', 73400000], [12, 'Rivalry Between Dragons and Weredragons', 76300000], [12, 'Weredragon Couple and a Baby', 79300000], [12, "Weredragons' Vital Point", 82300000], [12, 'Intense Battle in Propulsion System', 85300000], [12, 'Discovering a New Technology', 44200000], [12, 'Ark Repair', 92700000], [12, 'Weredragon Dispute', 96000000], [12, 'Cocoon in the Ice Wall', 99300000],
  [13, 'Underwater Inhabitants', 112600000], [13, 'Water Dome', 116500000], [13, 'Underwater City', 60200000], [13, 'The Thing in the Abandoned District', 125800000], [13, 'Shadow from the Abyss', 129900000], [13, 'The Ruthless Council', 67000000], [13, 'Mysterious Entity in the Little Shrine', 139900000], [13, 'The Great Battle Underwater', 144200000],
  [14, 'Crisis in the Sky', 159100000], [14, 'The Surviving Siblings', 164000000], [14, 'Chaotic Situation', 168900000], [14, 'The Bitter Truth', 173800000], [14, 'The Uncouth Rana Prince', 178800000], [14, 'Mutant Coenubia Village', 183900000], [14, 'Fierce Battle with Mutant Lixis', 189000000],
  [15, 'Ark Crisis', 210500000], [15, 'Coastal Clash', 216300000], [15, "Unda's Rescue Operation", 222200000], [15, "Unda's Return", 228100000], [15, 'The Young Man and The Old Tree', 234000000], [15, 'The Village of Lixis', 240000000], [15, 'Visions of a Distant Past', 246000000], [15, 'As the Roots Come to Light', 252100000],
  [16, "Freedos's Thoughts", 141700000], [16, 'Chaos in the Valley', 293700000]
];
const VENENA_XP = 12500000; // luta com Venena Metacoenubia no fim do capítulo 9, se não pular
const REPEAT_Q = [['Nightmare Crystal (pilha)', 297000], ["Lapin's Soul (peça)", 344000], ['Parasited Crystal (pilha)', 380000], ['Free from Infesters! (2k abates)', 15000000], ['Defeat Metal Stinger (x100)', 3240000], ['Minotaur Skin (pilha)', 999900], ['Cracked Platinum Armguard (pilha)', 677000], ['The Secret of the Mask (pilha)', 1200000]];
function expTotal(lv, pct, target) { let x = Math.floor((1 - pct / 100) * expNext(lv)); for (let L = lv + 1; L < target; L++) x += expNext(L); return x; }
// Soma EXP a partir de (nível, %) e devolve [nível, %] final.
function expAdd(lv, pct, xp) {
  let need = (1 - pct / 100) * expNext(lv);
  if (xp < need) return [lv, Math.floor(100 * (pct / 100 * expNext(lv) + xp) / expNext(lv))];
  xp -= need; lv++;
  while (expNext(lv) <= xp) { xp -= expNext(lv); lv++; }
  return [lv, Math.floor(100 * xp / expNext(lv))];
}
const mqXp = (a, b, skip) => { let x = 0; for (let i = a; i <= b; i++) x += MQ[i][2] + (MQ[i][3] && !skip ? VENENA_XP : 0); return x; };
const mqName = i => 'Cap. ' + MQ[i][0] + ' — ' + MQ[i][1];
const XS = { lv: store.get('lv', 100), pct: 0, target: store.get('xtarget', 200), per: '', times: '', from: 0, until: MQ.length - 1, skip: false, diary: false };
function viewExp() {
  setTitle('Calculadora de EXP');
  const mqOpts = sel => MQ.map((q, i) => '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + esc(mqName(i)) + '</option>').join('');
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Calculadora de EXP</h1><p>Quanto falta até o nível desejado, quantas vezes repetir uma missão e até onde a missão principal leva você.</p></div></div>'
    + '<section class="card"><h2>Seu nível</h2><div class="calc">'
    + '<div class="field"><label class="lbl" for="xlv">Nível atual</label><input id="xlv" type="number" inputmode="numeric" min="1" value="' + XS.lv + '"></div>'
    + '<div class="field"><label class="lbl" for="xpct">% do nível atual</label><input id="xpct" type="number" inputmode="decimal" min="0" max="100" step="any" value="' + XS.pct + '"></div>'
    + '<div class="field"><label class="lbl" for="xtg">Nível desejado</label><input id="xtg" type="number" inputmode="numeric" min="2" value="' + XS.target + '"></div>'
    + '</div><div class="res" id="xres" style="margin-top:12px"></div></section>'
    + '<section class="card"><h2>Missão repetível, monstro ou EXP avulsa</h2><div class="calc">'
    + '<div class="field full"><label class="lbl" for="xq">Missão pronta</label><select id="xq"><option value="">Digitar a EXP</option>' + REPEAT_Q.map(([n, x]) => '<option value="' + x + '">' + esc(n) + ' — ' + fmt(x) + ' EXP</option>').join('') + '</select></div>'
    + '<div class="field"><label class="lbl" for="xper">EXP por vez</label><input id="xper" type="number" inputmode="numeric" min="0" placeholder="ex: 50000" value="' + XS.per + '"></div>'
    + '<div class="field"><label class="lbl" for="xtimes">Vezes que vai fazer</label><input id="xtimes" type="number" inputmode="numeric" min="0" placeholder="ex: 10" value="' + XS.times + '"></div>'
    + '</div><div class="res" id="xrep" style="margin-top:12px"></div></section>'
    + '<section class="card"><h2>Missão principal (MQ)</h2><div class="calc">'
    + '<div class="field full"><label class="lbl" for="xfrom">Da missão</label><select id="xfrom">' + mqOpts(XS.from) + '</select></div>'
    + '<div class="field full"><label class="lbl" for="xuntil">Até a missão</label><select id="xuntil">' + mqOpts(XS.until) + '</select></div>'
    + '<div class="field full"><label class="check"><input id="xskip" type="checkbox"' + (XS.skip ? ' checked' : '') + '> Pular a luta com Venena Metacoenubia (cap. 9, vale +' + fmt(VENENA_XP) + ' EXP se lutar)</label>'
    + '<label class="check"><input id="xdiary" type="checkbox"' + (XS.diary ? ' checked' : '') + '> Repetir esse trecho com o Diário do Aventureiro até chegar no nível desejado</label></div>'
    + '</div><div id="xmq" style="margin-top:12px"></div></section>'
    + '<p class="note" style="color:var(--ink-2)">EXP por nível pela fórmula da comunidade: 0,025 × Nível⁴ + 2 × Nível (aproximada). EXP das missões: Toram Tools (Insane23) e catálogo de missões de XPPlayer1337. Os valores podem mudar com os patches.</p>';
  const num = (id, d) => { const v = $(id).value; return v === '' ? d : +v; };
  const calc = () => {
    const lv = Math.max(1, Math.floor(num('#xlv', 1))), pct = Math.min(99.99, Math.max(0, num('#xpct', 0))), tg = Math.floor(num('#xtg', 0));
    const per = num('#xper', 0), times = Math.floor(num('#xtimes', 0)), from = +$('#xfrom').value, until = +$('#xuntil').value, skip = $('#xskip').checked, diary = $('#xdiary').checked;
    Object.assign(XS, { lv, pct, target: tg, per: $('#xper').value, times: $('#xtimes').value, from, until, skip, diary });
    store.set('lv', lv); store.set('xtarget', tg);
    const total = tg > lv ? expTotal(lv, pct, tg) : 0;
    $('#xres').innerHTML = tg > lv
      ? '<div><span class="lbl">EXP até o Lv ' + tg + '</span><div class="big">' + fmt(total) + '</div></div><div><span class="lbl">Só o nível ' + lv + ' → ' + (lv + 1) + '</span><div class="big">' + fmt(Math.ceil(expNext(lv) * (1 - pct / 100))) + '</div></div>'
      : '<div><span class="lbl">Resultado</span><div>O nível desejado precisa ser maior que o atual.</div></div>';
    let rep = '';
    if (per > 0 && total > 0) rep += '<div><span class="lbl">Vezes para chegar ao Lv ' + tg + '</span><div class="big">' + fmt(Math.ceil(total / per)) + '</div></div>';
    if (per > 0 && times > 0) { const [l2, p2] = expAdd(lv, pct, per * times); rep += '<div><span class="lbl">Fazendo ' + fmt(times) + ' vezes</span><div class="big">Lv ' + l2 + ' (' + p2 + '%)</div></div>'; }
    $('#xrep').innerHTML = rep || '<div><span class="muted">Escolha uma missão pronta ou digite a EXP por vez.</span></div>';
    if (from > until) { $('#xmq').innerHTML = '<p class="muted" style="margin:0">A missão inicial precisa vir antes da final.</p>'; return; }
    const xp = mqXp(from, until, skip), [ml, mp] = expAdd(lv, pct, xp);
    let h = '<div class="res"><div><span class="lbl">EXP do trecho</span><div class="big">' + fmt(xp) + '</div></div><div><span class="lbl">Fazendo o trecho uma vez</span><div class="big">Lv ' + ml + ' (' + mp + '%)</div></div></div>';
    if (tg > lv && !diary) {
      let acc = 0, stop = -1, acc2 = 0, start = -1;
      for (let i = from; i <= until; i++) { acc += mqXp(i, i, skip); if (stop < 0 && acc >= total) stop = i; }
      for (let i = until; i >= from; i--) { acc2 += mqXp(i, i, skip); if (start < 0 && acc2 >= total) start = i; }
      h += stop >= 0 ? '<p style="margin:10px 0 0">Para chegar ao Lv ' + tg + ', você pode <b>parar depois de</b> “' + esc(mqName(stop)) + '”' + (start >= 0 ? ', ou <b>começar a partir de</b> “' + esc(mqName(start)) + '”' : '') + '.</p>' : '<p style="margin:10px 0 0">Só esse trecho não basta para o Lv ' + tg + '. Marque a opção do Diário do Aventureiro para ver quantas repetições precisa.</p>';
    }
    if (tg > lv && diary) {
      const runs = Math.ceil(total / xp);
      if (runs > 100) h += '<p style="margin:10px 0 0">Seriam ' + fmt(runs) + ' repetições. Escolha um trecho maior.</p>';
      else {
        let l = lv, p = pct, rows = '';
        for (let r = 1; r <= runs; r++) { [l, p] = expAdd(l, p, xp); rows += '<tr><td class="n">' + r + '</td><td class="n">Lv ' + l + ' (' + p + '%)</td></tr>'; }
        h += '<div class="tblw" style="margin-top:10px"><table class="tbl"><thead><tr><th class="n">Repetição</th><th class="n">Nível depois</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
    }
    $('#xmq').innerHTML = h;
  };
  $('#xq').addEventListener('change', e => { if (e.target.value) $('#xper').value = e.target.value; calc(); });
  view.querySelectorAll('input, select').forEach(i => i.addEventListener('input', calc));
  calc();
}

// ---------- pontos de status e skill ----------
// Fórmulas do Toram Tools (Insane23): 2 pontos de status por nível, bônus do emblema de nível e dos emblemas de função.
const statPts = L => L * 2;
const lvEmblemPts = L => L >= 5 ? 5 * (Math.floor((L - 5) / 10) + 1) : 0;
const skillPts = L => L + Math.floor(L / 5);
const PS2 = store.get('pontos', { lv: 100, hi: 100, ranks: [0, 0, 0, 0], ch: 0, fa: 0, ko: 0, bk: false, cg: false, ms: 0, mt: 0, ct: 0 });
function viewPoints() {
  setTitle('Pontos de status e skill');
  const RANK = [[0, 'Nenhum'], [1, '10'], [1.5, '100'], [2, '1.000'], [3, '10.000'], [4, '100.000']];
  const sel = (id, opts, v) => '<select id="' + id + '">' + opts.map(([val, l]) => '<option value="' + val + '"' + (+val === +v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
  const f = (id, lab, inner) => '<div class="field"><label class="lbl" for="' + id + '">' + lab + '</label>' + inner + '</div>';
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Pontos de status e skill</h1><p>Quantos pontos você tem pelo nível e pelos emblemas. As escolhas ficam salvas neste aparelho.</p></div></div>'
    + '<section class="card"><div class="res" id="pres"></div></section>'
    + '<section class="card"><h2>Nível</h2><div class="calc">'
    + f('plv', 'Nível atual', '<input id="plv" type="number" inputmode="numeric" min="1" value="' + PS2.lv + '">')
    + f('phi', 'Maior nível já alcançado (emblema)', '<input id="phi" type="number" inputmode="numeric" min="1" value="' + PS2.hi + '">')
    + '</div></section>'
    + '<section class="card"><h2>Emblemas de resultados <small>quantidade alcançada</small></h2><div class="calc">'
    + ['Atacante', 'Tanque', 'Suporte', 'Assistente'].map((n, k) => f('pr' + k, n, sel('pr' + k, RANK, PS2.ranks[k]))).join('')
    + '</div></section>'
    + '<section class="card"><h2>Outros emblemas</h2><div class="calc">'
    + f('pms', 'Skills dominadas', sel('pms', Array.from({ length: 11 }, (_, i) => [i, String(i)]), PS2.ms))
    + f('pmt', 'Árvores dominadas', sel('pmt', Array.from({ length: 4 }, (_, i) => [i, String(i)]), PS2.mt))
    + f('pct', 'Tempo jogando seguido', sel('pct', ['0', '15 min', '30 min', '1 h', '2 h', '3 h', '4 h', '5 h', '6 h'].map((l, i) => [i, l]), PS2.ct))
    + f('pch', 'Maior capítulo da MQ concluído', sel('pch', Array.from({ length: 12 }, (_, i) => [i, i ? 'Capítulo ' + i : 'Nenhum']), PS2.ch))
    + f('pfa', 'Primeiros socorros', sel('pfa', ['0', '100', '400', '700', '1.000'].map((l, i) => [i, l]), PS2.fa))
    + f('pko', 'Nocauteado', sel('pko', ['0', '100', '400', '700', '1.000'].map((l, i) => [i, l]), PS2.ko))
    + '<div class="field full"><label class="check"><input id="pbk" type="checkbox"' + (PS2.bk ? ' checked' : '') + '> 20 mil pontos no minigame do Black Knight (casa)</label><label class="check"><input id="pcg" type="checkbox"' + (PS2.cg ? ' checked' : '') + '> Venceu 10 vezes no jogo de cartas (casa)</label></div>'
    + '</div></section><p class="note" style="color:var(--ink-2)">Fórmulas do Toram Tools (Insane23). Status: 2 pontos por nível, mais o emblema de maior nível (5 pontos no Lv 5 e mais 5 a cada 10 níveis) e 5 pontos por emblema de função a partir de 100. Skill: 1 ponto por nível e 1 a cada 5 níveis, mais os emblemas.</p>';
  const calc = () => {
    const lv = Math.max(1, +$('#plv').value || 1), hi = Math.max(lv, +$('#phi').value || 0);
    const ranks = [0, 1, 2, 3].map(k => +$('#pr' + k).value);
    Object.assign(PS2, { lv, hi: +$('#phi').value || lv, ranks, ms: +$('#pms').value, mt: +$('#pmt').value, ct: +$('#pct').value, ch: +$('#pch').value, fa: +$('#pfa').value, ko: +$('#pko').value, bk: $('#pbk').checked, cg: $('#pcg').checked });
    store.set('pontos', PS2);
    const rankStat = ranks.filter(r => r > 1).length * 5, emb = lvEmblemPts(hi);
    const extraSkill = ranks.reduce((s, r) => s + Math.floor(r), 0) + PS2.ch + PS2.fa + PS2.ko + PS2.bk + PS2.cg + PS2.ms + PS2.mt + PS2.ct;
    $('#pres').innerHTML = '<div><span class="lbl">Pontos de status</span><div class="big">' + fmt(statPts(lv) + emb + rankStat) + '</div><small class="muted">' + statPts(lv) + ' do nível + ' + emb + ' do emblema de nível + ' + rankStat + ' de função</small></div>'
      + '<div><span class="lbl">Pontos de skill</span><div class="big">' + fmt(skillPts(lv) + extraSkill) + '</div><small class="muted">' + skillPts(lv) + ' do nível + ' + extraSkill + ' dos emblemas</small></div>';
  };
  view.querySelectorAll('input, select').forEach(i => i.addEventListener('input', calc));
  calc();
}

// ---------- calculadora de blacksmith ----------
// Fórmulas do Toram Tools (Insane23), baseadas nos testes de DOPR e JosuaK62.
const BS_TYPES = [['Armor', 'Armadura', 'VIT', 'TEC', 1], ['1H Sword', '1-Handed Sword', 'DEX', 'STR'], ['2H Sword', '2-Handed Sword', 'STR', 'DEX'], ['Bow', 'Bow', 'DEX', 'STR'], ['Bowgun', 'Bowgun', 'DEX', 'STR'], ['Staff', 'Staff', 'INT', 'TEC'], ['Magic Device', 'Magic Device', 'INT', 'AGI'], ['Knuckle', 'Knuckle', 'AGI', 'DEX'], ['Halberd', 'Halberd', 'STR', 'AGI'], ['Katana', 'Katana', 'DEX', 'AGI']];
const BS_POT = { 'Armor': s => s.VIT / 10, '1H Sword': s => (s.DEX + s.STR) / 20, '2H Sword': s => s.STR / 10, 'Bow': s => (s.DEX + s.STR) / 20, 'Bowgun': s => s.DEX / 10, 'Staff': s => s.INT / 10, 'Magic Device': s => (s.INT + s.AGI) / 20, 'Knuckle': s => s.AGI / 10, 'Halberd': s => (s.STR + s.AGI) / 20, 'Katana': s => (s.DEX + s.AGI) / 20 };
const BS = store.get('bs', { type: 'Bow', STR: 327, DEX: 510, INT: 1, VIT: 1, AGI: 1, TEC: 1, eSTR: 0, eSTRp: 0, eDEX: 0, eDEXp: 0, prof: 305, create: 10, careful: 10, expert: 10, diff: 300, pot: 55 });
function viewBlacksmith() {
  setTitle('Calculadora de blacksmith');
  const n = (id, lab, v, extra) => '<div class="field"><label class="lbl" for="b' + id + '">' + lab + '</label><input id="b' + id + '" type="number" inputmode="numeric" min="0" value="' + v + '"' + (extra || '') + '></div>';
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Calculadora de blacksmith</h1><p>Sua dificuldade de criação, a taxa de sucesso e o potencial que o equipamento vai sair. Os valores ficam salvos neste aparelho.</p></div></div>'
    + '<section class="card"><div class="res" id="bres"></div><p class="note" id="bwarn" hidden style="color:var(--event);font-weight:600">A dificuldade do equipamento é maior que a sua: você ainda não consegue criar esse item.</p></section>'
    + '<section class="card"><h2>O que vai criar</h2><div class="calc">'
    + '<div class="field full"><label class="lbl" for="btype">Tipo</label><select id="btype">' + BS_TYPES.map(t => '<option value="' + t[0] + '"' + (BS.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>').join('') + '</select></div>'
    + n('diff', 'Dificuldade do equipamento', BS.diff) + n('pot', 'Potencial base da receita', BS.pot)
    + '</div><p class="note">A dificuldade e o potencial base aparecem na receita do NPC ou do item. Os valores iniciais são os das receitas mais altas.</p></section>'
    + '<section class="card"><h2>Seus status <small>sem equipamento</small></h2><div class="calc">' + ['STR', 'DEX', 'INT', 'VIT', 'AGI', 'TEC'].map(s => n(s, s, BS[s])).join('') + '</div></section>'
    + '<section class="card"><h2>Bônus de equipamento</h2><div class="calc">' + n('eSTR', 'STR +', BS.eSTR) + n('eSTRp', 'STR %', BS.eSTRp) + n('eDEX', 'DEX +', BS.eDEX) + n('eDEXp', 'DEX %', BS.eDEXp) + '</div></section>'
    + '<section class="card"><h2>Skills de smith</h2><div class="calc">' + n('prof', 'Proficiência de smith', BS.prof) + n('create', 'Create Equipment (nível)', BS.create, ' max="10"') + n('careful', 'Careful Creation (nível)', BS.careful, ' max="10"') + n('expert', "Expert's Creation (nível)", BS.expert, ' max="10"') + '</div></section>'
    + '<p class="note" style="color:var(--ink-2)">Fórmulas do Toram Tools (Insane23), a partir dos testes de DOPR e JosuaK62. Dificuldade = proficiência + TEC/2 + DEX/6. Sucesso = (50 + 5 × Create Equipment)% × (10 + sua dificuldade − dificuldade do item + STR/10). Potencial = base × (1 + 1% por nível de Careful + 2% por nível de Expert) + bônus do status da arma.</p>';
  const calc = () => {
    const g = id => Math.max(0, +$('#b' + id).value || 0);
    BS.type = $('#btype').value;
    ['STR', 'DEX', 'INT', 'VIT', 'AGI', 'TEC', 'eSTR', 'eSTRp', 'eDEX', 'eDEXp', 'prof', 'create', 'careful', 'expert', 'diff', 'pot'].forEach(k => { BS[k] = g(k); });
    store.set('bs', BS);
    const DEXe = Math.floor(BS.DEX * (100 + BS.eDEXp) / 100 + BS.eDEX), STRe = Math.floor(BS.STR * (100 + BS.eSTRp) / 100 + BS.eSTR);
    const dif = BS.prof + Math.floor(BS.TEC / 2) + Math.floor(DEXe / 6);
    const sr = Math.min(100, Math.max(0, Math.floor((50 + 5 * Math.min(10, BS.create)) / 100 * (10 + dif - BS.diff + Math.floor(STRe / 10)))));
    const pot = Math.floor(BS.pot * (1 + Math.min(10, BS.careful) * 0.01 + Math.min(10, BS.expert) * 0.02)) + Math.floor(BS_POT[BS.type](BS));
    $('#bres').innerHTML = '<div><span class="lbl">Sua dificuldade</span><div class="big">' + fmt(dif) + '</div><small class="muted">item: ' + fmt(BS.diff) + '</small></div>'
      + '<div><span class="lbl">Taxa de sucesso</span><div class="big">' + sr + '%</div></div>'
      + '<div><span class="lbl">Potencial do equipamento</span><div class="big">' + fmt(pot) + '</div></div>';
    $('#bwarn').hidden = dif >= BS.diff;
  };
  $('#btype').addEventListener('change', () => {
    const t = BS_TYPES.find(x => x[0] === $('#btype').value);
    ['STR', 'DEX', 'INT', 'VIT', 'AGI', 'TEC'].forEach(s => { $('#b' + s).value = s === t[2] ? 510 : s === t[3] ? 327 : 1; });
    $('#bdiff').value = t[4] ? 265 : 300; $('#bpot').value = t[4] ? 54 : 55;
    calc();
  });
  view.querySelectorAll('input').forEach(i => i.addEventListener('input', calc));
  calc();
}

// ---------- Ninjutsu Scroll ----------
// Combinações da planilha pública de Tamyo02, no formato do Toram Tools: arma1 arma2 arma3 tipo skill1 skill2 skill3.
const SCROLLS = '1234320 1247318 1257351 1267346 1277374 1287347 1297370 1323453 1342416 1355480 1361413 1377453 1382435 1394428 1422540 1431518 1453537 1465578 1473540 1483504 1496516 1527263 1537230 1543250 1564270 1577263 1583235 1592240 1624321 1635374 1642345 1657371 1671321 1684312 1693350 1725783 1736764 1745780 1753753 1765752 1785738 1791731 1827138 1835185 1842134 1853135 1862140 1871138 1893157 1921817 1931815 1945873 1954842 1965853 1971817 1985871 2137304 2146365 2151341 2165308 2171301 2184352 2195380 2311541 2343510 2353580 2361514 2373507 2383534 2393527 2412470 2431410 2452430 2462470 2472400 2482450 2492413 2515681 2537632 2546651 2565674 2576607 2587634 2595647 2614213 2634275 2644240 2653275 2675208 2687213 2694257 2715831 2735867 2742804 2753857 2765853 2787831 2795835 2814362 2831381 2847307 2857304 2862345 2871301 2897354 2911125 2931104 2941170 2952143 2961152 2971103 2985178 3122431 3146467 3152400 3167435 3177431 3182457 3195480 3217513 3243514 3253500 3263541 3275578 3283543 3295570 3413375 3427340 3457300 3467372 3477340 3483358 3497310 3512804 3526865 3541851 3565871 3573865 3587830 3592842 3611713 3624725 3647743 3655700 3673725 3685714 3693750 3717531 3723587 3741581 3753500 3762504 3787534 3795537 3817367 3827304 3844302 3857300 3865347 3872304 3897351 3915428 3922413 3943475 3952400 3963457 3971413 3982475 4123532 4133537 4152547 4163530 4173532 4183501 4193580 4212415 4232420 4252453 4264402 4277473 4282408 4295471 4312347 4323354 4357380 4365317 4377354 4383305 4397321 4517387 4526364 4531301 4565370 4577364 4587305 4597341 4611108 4621123 4637173 4655174 4671123 4681105 4693154 4714302 4725381 4736361 4753354 4763350 4785307 4797304 4811861 4825837 4834802 4857835 4862840 4877837 4893857 4914723 4925718 4931715 4952745 4963751 4971718 4987703 5127231 5134231 5145267 5164235 5171231 5184257 5192284 5211613 5234620 5245618 5263645 5276678 5282643 5295673 5315840 5323856 5345815 5365817 5373856 5387830 5395824 5416376 5427340 5437318 5462374 5472340 5487358 5497315 5611310 5624325 5637378 5647340 5677325 5687314 5693356 5711130 5725187 5734162 5745180 5762154 5781134 5795137 5816760 5827734 5835781 5844732 5865740 5872734 5895751 5915820 5921813 5931813 5945876 5965853 5977813 5983875 6127304 6137300 6146368 6151341 6172304 6183357 6195380 6211210 6234200 6244210 6254250 6275270 6282240 6294270 6312741 6324752 6345714 6355780 6373752 6385731 6395725 6415172 6421140 6431100 6451134 6472140 6481157 6492104 6517381 6527362 6535307 6543354 6576362 6581301 6592345 6717634 6726687 6736605 6747683 6754652 6781631 6795638 6815867 6821831 6835804 6845835 6857831 6877831 6895853 6915127 6921104 6931100 6944172 6957143 6972104 6981175 7127734 7135731 7145762 7157743 7165730 7185750 7191781 7215813 7234820 7241813 7255857 7262840 7285840 7295876 7313543 7325508 7345518 7353580 7363510 7383530 7397523 7417378 7427340 7437310 7452304 7465370 7483350 7495318 7511183 7525168 7533135 7542154 7561170 7581130 7595147 7616614 7625627 7636675 7647643 7656672 7686610 7696658 7813265 7827230 7832284 7847237 7857230 7864240 7893251 7917325 7921314 7937310 7945378 7957341 7963356 7985370 8121137 8137132 8146160 8153145 8167134 8175137 8195187 8211318 8237320 8246316 8257354 8262340 8277370 8297378 8317346 8323350 8347310 8355380 8362314 8377350 8393325 8415873 8422840 8431816 8455835 8463875 8475840 8497813 8515785 8525763 8537734 8545750 8564702 8575763 8591741 8611815 8622824 8637873 8645840 8655871 8675824 8693853 8715237 8725284 8731261 8745280 8757253 8764257 8791231 8917623 8923615 8935618 8947673 8952647 8963658 8976615 9127837 9135835 9145863 9152842 9165830 9177837 9181851 9215107 9234120 9244102 9253153 9265147 9272174 9283145 9312402 9323451 9345417 9355480 9361415 9373451 9387437 9411701 9422740 9431712 9455735 9465704 9475740 9482754 9515802 9525861 9537831 9543857 9565875 9576861 9587837 9613105 9621123 9635174 9645147 9657173 9677123 9681108 9715307 9721381 9732364 9747385 9753351 9765358 9787302 9816601 9826632 9836687 9842634 9857637 9866643 9874632'.split(' ');
const SC_SKILL = { 0: 'Aleatória (?)', 1: 'Fire Release', 2: 'Thunder Release', 3: 'Wind Release', 4: 'Water Release', 5: 'Earth Release', 6: 'Cloning', 7: 'Demon Wind Shuriken', 8: 'Kunai Throw' };
const SC_WEAP = { 1: '1H Sword', 2: '2H Sword', 3: 'Bow', 4: 'Bowgun', 5: 'Katana', 6: 'Halberd', 7: 'Staff', 8: 'Magic Device', 9: 'Knuckles' };
const SC_TYPE = { 1: 'Fire', 2: 'Lightning', 3: 'Wind', 4: 'Water', 5: 'Earth', 6: 'Dark', 7: 'Metal', 8: 'Metal' };
const SC_STATS = { Fire: 'MATK +1%; com Staff: Magic Pierce +5%', Lightning: 'Stability +5%; com Katana: Accuracy +10%', Wind: 'ASPD +250; com Katana: Critical Rate +5', Water: 'Ailment Resistance +5%; com Magic Device: Aggro −10%', Earth: 'MaxHP +10%; com 1H Sword: Fractional Barrier +10%', Dark: 'Aggro −10%', Metal: 'Critical Rate +5' };
const scTypes = sc => { const sk = sc.slice(4); if (sk.split('0').length - 1 >= 2) return ['Qualquer']; const t = []; sk.split('').forEach(v => { if (+v > 0 && !t.includes(SC_TYPE[v])) t.push(SC_TYPE[v]); }); return t; };
const NS = { w: ['', '', ''], s: ['', '', ''] };
function viewScroll() {
  setTitle('Ninjutsu Scroll');
  const wsel = k => '<select id="nw' + k + '" aria-label="Arma ' + (k + 1) + '"><option value="">Arma ' + (k + 1) + '</option>' + Object.entries(SC_WEAP).map(([v, l]) => '<option value="' + v + '"' + (NS.w[k] === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
  const ssel = k => '<select id="ns' + k + '" aria-label="Habilidade ' + (k + 1) + '"><option value="">Qualquer</option>' + Object.entries(SC_SKILL).map(([v, l]) => '<option value="' + v + '"' + (NS.s[k] === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Ninjutsu Scroll</h1><p>O pergaminho sai de três armas diferentes. Monte pelas armas ou procure pelas habilidades que você quer.</p></div></div>'
    + '<div class="grid2"><section class="card"><h2>Montar pelas armas</h2><div class="calc"><div class="field full">' + wsel(0) + '</div><div class="field full">' + wsel(1) + '</div><div class="field full">' + wsel(2) + '</div></div><div id="nres" style="margin-top:12px"></div></section>'
    + '<section class="card"><h2>Procurar pelas habilidades</h2><div class="calc"><div class="field full">' + ssel(0) + '</div><div class="field full">' + ssel(1) + '</div><div class="field full">' + ssel(2) + '</div></div><div id="nfind" style="margin-top:12px"></div></section></div>'
    + '<section class="card"><h2>O que cada tipo de pergaminho dá</h2><div class="slist">' + Object.entries(SC_STATS).map(([t, s]) => '<div><span>' + t + '</span><small style="text-align:right">' + s + '</small></div>').join('') + '</div></section>'
    + '<p class="note" style="color:var(--ink-2)">Combinações da planilha pública de Tamyo02, organizadas pelo Toram Tools (Insane23). "Aleatória (?)" é a habilidade com interrogação. O tipo do pergaminho depende das habilidades.</p>';
  const craft = () => {
    NS.w = [0, 1, 2].map(k => $('#nw' + k).value);
    const w = NS.w.filter(Boolean);
    if (w.length < 3) { $('#nres').innerHTML = '<p class="muted" style="margin:0">Escolha as três armas.</p>'; return; }
    if (new Set(w).size < 3) { $('#nres').innerHTML = '<p class="muted" style="margin:0">As três armas precisam ser diferentes.</p>'; return; }
    const sc = SCROLLS.find(x => x.startsWith(w.join('')));
    $('#nres').innerHTML = sc ? '<div class="res"><div><span class="lbl">Tipo</span><div style="font-weight:600">' + scTypes(sc).join(', ') + '</div></div><div><span class="lbl">Habilidades</span><div>' + sc.slice(4).split('').map(v => esc(SC_SKILL[v])).join('<br>') + '</div></div></div>' : '<p class="muted" style="margin:0">Combinação não encontrada.</p>';
  };
  const find = () => {
    NS.s = [0, 1, 2].map(k => $('#ns' + k).value);
    const want = NS.s.filter(v => v !== '').join('');
    if (!want) { $('#nfind').innerHTML = '<p class="muted" style="margin:0">Escolha pelo menos uma habilidade.</p>'; return; }
    const hits = SCROLLS.filter(sc => { const sk = sc.slice(4); let c = 0; for (const ch of want) if (sk.includes(ch)) c++; return c === want.length && (sk.split('0').length - 1) >= (want.split('0').length - 1); });
    $('#nfind').innerHTML = hits.length ? '<p class="lbl" style="margin:0 0 6px">' + hits.length + ' combinações · toque para montar</p><div class="links">' + hits.map(sc => '<button type="button" class="lk" data-sc="' + sc.slice(0, 3) + '">' + sc.slice(0, 3).split('').map(v => SC_WEAP[v]).join(' + ') + ' <small>' + scTypes(sc).join(', ') + '</small></button>').join('') + '</div>'
      : '<p class="muted" style="margin:0">Nenhuma combinação com essas habilidades. Deixe uma como "Qualquer" ou "Aleatória".</p>';
  };
  [0, 1, 2].forEach(k => { $('#nw' + k).addEventListener('change', craft); $('#ns' + k).addEventListener('change', find); });
  $('#nfind').addEventListener('click', e => { const b = e.target.closest('[data-sc]'); if (!b) return; b.dataset.sc.split('').forEach((v, k) => { $('#nw' + k).value = v; }); craft(); $('#nres').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  craft(); find();
}

// ---------- eventos ----------
// Agrupados por pistas no nome do monstro/item, na origem do coryn.club e no nome do mapa.
const EVENTS = [
  ['ano-novo', 'Ano Novo', 'janeiro', /new ?year|kadomatsu|oshogatsu|omochi|osechi/i],
  ['zodiaco', 'Zodíaco (Ano Lunar)', 'janeiro e fevereiro', /zodiac/i],
  ['valentine', 'Valentine', 'fevereiro', /valentine|chocolate|creme cliff|sweet hades|douce hamlet/i],
  ['white-day', 'White Day', 'março', /white day/i],
  ['hanami', 'Hanami (Sakura)', 'abril', /hanami|sakura/i],
  ['pascoa', 'Páscoa', 'abril', /easter/i],
  ['june-bride', 'June Bride (Casamento)', 'junho', /june bride|\bbride\b|\bgroom\b/i],
  ['chuva', 'Estação das Chuvas', 'junho', /rainy/i],
  ['tanabata', 'Tanabata', 'julho', /tanabata/i],
  ['verao', 'Verão', 'julho e agosto', /summer|saltau|ocean pantry|beach house/i],
  ['aniversario', 'Aniversário do Toram', 'julho e agosto', /anniv/i],
  ['otsukimi', 'Otsukimi (Lua)', 'setembro', /otsukimi|moon crab|usami|usakichi/i],
  ['outono', 'Outono', 'outubro', /autumn/i],
  ['halloween', 'Halloween', 'outubro e novembro', /halloween|pumpkin|phasma|\[trick\]|\[treat\]/i, new Date('2026-10-08T00:00:00'), CANDY_END],
  ['natal', 'Natal', 'dezembro', /christmas|xmas|santa|navida|noeliel/i],
  ['colab', 'Colaborações', 'variável', /collab|eagle talon|grieving souls/i],
  ['alta-dif', 'Boss de alta dificuldade', 'variável', /high difficulty/i]
];
const pl = (n, s, p) => fmt(n) + ' ' + (n === 1 ? s : p);
let EVDATA = null;
function eventData() {
  if (EVDATA) return EVDATA;
  const mon = new Map(EVENTS.map(e => [e[0], new Set()])), used = new Set();
  for (const g of DB.MONS) {
    const txt = g.name + '\n' + g.badge + '\n' + g.mapList.map(m => m.name).join('\n');
    for (const e of EVENTS) if (e[3].test(txt)) { mon.get(e[0]).add(g); used.add(g); }
  }
  mon.set('outros', new Set(DB.MONS.filter(g => g.event && !used.has(g))));
  const items = new Map([...mon.keys()].map(k => [k, new Set()]));
  for (const i of DB.ITEMS) {
    const txt = i.name + '\n' + i.note + '\n' + i.badge;
    for (const e of EVENTS) if (e[3].test(txt) || (i.event && i.by.some(g => mon.get(e[0]).has(g)))) items.get(e[0]).add(i);
    if (i.event && i.by.some(g => mon.get('outros').has(g))) items.get('outros').add(i);
  }
  const list = EVENTS.map(e => ({ key: e[0], name: e[1], when: e[2], start: e[4], end: e[5] })).concat({ key: 'outros', name: 'Outros eventos e limitados', when: 'variável' });
  list.forEach(ev => { ev.mons = [...mon.get(ev.key)]; ev.items = [...items.get(ev.key)]; const ms = new Map(); ev.mons.forEach(g => g.mapList.forEach(m => ms.set(m.id, m))); ev.maps = [...ms.values()].filter(m => m.name !== 'Event'); ev.now = ev.start && new Date() >= ev.start && new Date() <= ev.end; });
  return (EVDATA = list);
}
function viewEvents() {
  setTitle('Eventos');
  const evs = eventData();
  const card = ev => '<a class="tile' + (ev.now ? ' now' : '') + '" href="#/evento/' + ev.key + '"><b>' + esc(ev.name) + (ev.now ? ' <span class="tag ok">acontecendo agora</span>' : '') + '</b><span>' + esc(ev.when) + ' · ' + pl(ev.mons.length, 'monstro', 'monstros') + ' · ' + pl(ev.items.length, 'item', 'itens') + '</span></a>';
  view.innerHTML = '<div class="ph"><div><h1>Eventos</h1><p>Monstros, mapas e itens de cada evento do ano. Os meses são os de costume; as datas exatas saem nos avisos oficiais do jogo.</p></div></div>'
    + '<div class="tiles evtiles">' + evs.filter(e => e.now).map(card).join('') + evs.filter(e => !e.now && (e.mons.length || e.items.length)).map(card).join('') + '</div>'
    + '<p class="note" style="color:var(--ink-2)">Os grupos são montados pelos nomes dos monstros, itens e mapas, então alguns podem ficar no evento errado ou em "Outros".</p>';
}
function viewEvent(key) {
  const ev = eventData().find(e => e.key === key);
  if (!ev) { view.innerHTML = backBtn('#/eventos') + '<p class="empty">Evento não encontrado.</p>'; return; }
  setTitle(ev.name);
  const mons = TYPES.map(([t, lab]) => { const gs = ev.mons.filter(g => g.t === t).sort((a, b) => a.lo - b.lo || a.name.localeCompare(b.name)); return gs.length ? '<div class="dgroup"><span class="lbl">' + lab + ' (' + gs.length + ')</span><div class="links">' + gs.map(g => '<a class="lk" href="' + monUrl(g) + '">' + esc(g.name) + ' <small>Lv ' + lvTxt(g) + '</small></a>').join('') + '</div></div>' : ''; }).join('');
  const groups = new Map();
  ev.items.forEach(i => { if (!groups.has(i.tl)) groups.set(i.tl, []); groups.get(i.tl).push(i); });
  const items = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length).map(t => '<details class="dgroup"' + (groups.size <= 4 ? ' open' : '') + '><summary class="lbl" style="cursor:pointer">' + esc(t || 'Outros') + ' (' + groups.get(t).length + ')</summary><div class="links" style="margin-top:6px">' + groups.get(t).sort((a, b) => a.name.localeCompare(b.name)).map(i => '<a class="lk" href="' + itemUrl(i) + '">' + esc(i.name) + '</a>').join('') + '</div></details>').join('');
  const candies = ev.key === 'halloween' && candyOn() ? '<section class="card"><h2>Doces do evento <small>até 12/11/2026</small></h2><div class="candies">' + CANDIES.map(([n, el]) => '<div class="cd" style="--c:var(' + EL[el][1] + ')"><b>' + n + '</b><span><span class="dot" style="background:var(' + EL[el][1] + ')"></span>monstros de ' + EL[el][0] + '</span></div>').join('') + '</div><p class="note">Cada doce cai dos monstros do elemento e dá ASPD e CSPD +100 e +5% de dano contra esse elemento por 10 minutos.</p></section>' : '';
  view.innerHTML = backBtn('#/eventos') + '<div class="dhead"><h1>' + esc(ev.name) + '</h1><div class="dmeta"><span class="pill">' + esc(ev.when) + '</span>' + (ev.now ? '<span class="tag ok">acontecendo agora</span>' : '') + '<span class="muted">' + ev.mons.length + ' monstros · ' + ev.items.length + ' itens · ' + ev.maps.length + ' mapas</span></div></div>'
    + candies + '<div class="grid2"><div><section class="card"><h2>Monstros</h2>' + (mons || '<p class="muted" style="margin:0">Nenhum monstro encontrado para este evento.</p>') + '</section>'
    + (ev.maps.length ? '<section class="card"><h2>Mapas</h2><div class="links">' + ev.maps.sort((a, b) => a.name.localeCompare(b.name)).map(m => '<a class="lk" href="' + mapUrl(m) + '">' + esc(m.name) + '</a>').join('') + '</div></section>' : '') + '</div>'
    + '<div><section class="card"><h2>Itens</h2>' + (items || '<p class="muted" style="margin:0">Nenhum item encontrado para este evento.</p>') + '</section></div></div>';
}

// ---------- códigos de comida (food buff) ----------
// Lista da comunidade (post "Food Buff Codes 2025" no r/ToramOnline, tradução enviada pelo Daniel). Sem nota = nível 10.
const FOOD = [
  ['STR', 'Bolinho de Arroz Okaka', '4016699 1110033 2020303 2017890 1010055'],
  ['INT', 'Bolinho de Arroz Umeboshi', '6010701 6061294 5190001 1010498 1032222'],
  ['VIT', 'Bolinho de Arroz com Atum e Maionese', '4032850 5130123 2020909'],
  ['AGI', 'Bolinho de Arroz Mentaiko', '7162029 1110033 1220777 4262222 2020037'],
  ['DEX', 'Bolinho de Arroz com Salmão', '2020222 1010261 1160000 1112220 1107777'],
  ['ATK de Arma', 'Pizza Margherita', '3160777 1067777 2010136 6010024 1011122'],
  ['ATK', 'Pizza Diavola', '7170717 1119876'],
  ['Recuperação de MP por ataque', 'Yakisoba', '4040404 4261111 5010031 1016969 4233333'],
  ['MaxHP', 'Refogado Dourado', '1250015 4262222 3040005 1180755 1010455'],
  ['MaxMP', 'Arroz Frito Ankake', '1032222 2010079 1091111 1240000 1027777'],
  ['Taxa crítica', 'Takoyaki', '7010086 1181140 1100000 5119105 2022020 53190003'],
  ['Precisão', 'Shoyu Ramen', '2010308 4261111 1181220 701007:9'],
  ['Aggro −', 'Ensopado Branco', '1010147 3190038 1011174 2020808 3010018'],
  ['Aggro +', 'Ensopado de Carne', '1010207 1140008 1011340 2020606 1130832 53010043'],
  ['Dano contra Neutro', 'Peperoncino', '1250040 5010098'],
  ['Dano contra Vento', 'Napolitana', '3030303 2020909:9 1180020:8'],
  ['Dano contra Água', 'Vongole', '1110111 7150030 7011001:9'],
  ['Dano contra Fogo', 'Bolognese', '3210106:9 7088807:9'],
  ['Dano contra Terra', 'Genovese', '2020202 4233333:9 7100666:9'],
  ['Dano contra Trevas', 'Massa com Tinta de Lula', '6116116 5010092 1190020 2130776'],
  ['Dano contra Luz', 'Carbonara', '1240000:9 1020345:9 1019696:?'],
  ['Resistência física', 'Hambúrguer de Carne', '1100000 7010014 4010051 2200117 6010701'],
  ['Resistência mágica', 'Hambúrguer de Peixe', '6190007 2020505 6234567 7010016 1111757'],
  ['Barreira fracionada', 'Panqueca', '4010024 6150029 1010013 1012222']
];
let FQ = '';
function viewFood() {
  setTitle('Códigos de comida');
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Códigos de comida</h1><p>Casas de jogadores com comida de buff. Toque num código para copiar e use no jogo para visitar a casa e comprar a comida.</p></div></div>'
    + '<div class="tools"><input id="fq" type="search" placeholder="Status ou comida (ex: DEX, crítico, pizza)" value="' + esc(FQ) + '" aria-label="Buscar buff"></div>'
    + '<div id="flist"></div><p class="note" style="color:var(--ink-2)">Sem anotação, o código é de comida nível 10. Lista da comunidade (post “Food Buff Codes 2025” do r/ToramOnline). Os códigos mudam quando os donos das casas trocam os pratos; se um não funcionar, tente o próximo.</p>'
    + '<div class="toast" id="toast" hidden>Copiado!</div>';
  const list = () => {
    const q = FQ.trim().toLowerCase();
    const rows = FOOD.filter(([s, f]) => !q || (s + ' ' + f).toLowerCase().includes(q));
    $('#flist').innerHTML = rows.length ? '<div class="foods">' + rows.map(([s, f, codes]) => '<section class="card food"><h2>' + esc(s) + ' <small>' + esc(f) + '</small></h2><div class="codes">'
      + codes.split(' ').map(c => { const [code, lv] = c.split(':'); return '<button type="button" class="code" data-code="' + code + '">' + code + (lv ? '<small>' + (lv === '?' ? 'nível ?' : 'nível ' + lv) + '</small>' : '') + '</button>'; }).join('') + '</div></section>').join('') + '</div>'
      : '<p class="empty" style="color:var(--ink-2)">Nenhum buff com esse nome.</p>';
  };
  $('#fq').addEventListener('input', e => { FQ = e.target.value; list(); });
  $('#flist').addEventListener('click', e => {
    const b = e.target.closest('[data-code]'); if (!b) return;
    const done = () => { const t = $('#toast'); t.textContent = 'Código ' + b.dataset.code + ' copiado!'; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(b.dataset.code).then(done, () => { fallbackCopy(b.dataset.code); done(); });
    else { fallbackCopy(b.dataset.code); done(); }
  });
  list();
}
function fallbackCopy(txt) { const ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }

// ---------- guia de smithing ----------
function viewSmithing() {
  setTitle('Guia de smithing');
  const ores = DB.ITEMS.filter(i => i.tl === 'Ore').sort((a, b) => a.name.localeCompare(b.name));
  const sup = DB.ITEMS.filter(i => i.tl === 'Refinement Support').sort((a, b) => a.name.localeCompare(b.name));
  const lk = arr => '<div class="links">' + arr.map(i => '<a class="lk" href="' + itemUrl(i) + '">' + esc(i.name) + (i.by.length ? ' <small>drop de ' + i.by.length + '</small>' : '') + '</a>').join('') + '</div>';
  const potRows = BS_TYPES.map(t => '<tr><td>' + t[1] + '</td><td>' + { 'Armor': 'VIT ÷ 10', '1H Sword': '(DEX + STR) ÷ 20', '2H Sword': 'STR ÷ 10', 'Bow': '(DEX + STR) ÷ 20', 'Bowgun': 'DEX ÷ 10', 'Staff': 'INT ÷ 10', 'Magic Device': '(INT + AGI) ÷ 20', 'Knuckle': 'AGI ÷ 10', 'Halberd': '(STR + AGI) ÷ 20', 'Katana': '(DEX + AGI) ÷ 20' }[t[0]] + '</td></tr>').join('');
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Guia de smithing</h1><p>Como criar, colocar status e refinar equipamentos. Texto em português da comunidade BR, com as fórmulas que a comunidade de Toram mediu.</p></div></div>'
    + '<nav class="seg" id="gsnav" aria-label="Seções do guia"><button type="button" data-to="gs-a">Visão geral</button><button type="button" data-to="gs-b">Criação</button><button type="button" data-to="gs-c">Status</button><button type="button" data-to="gs-d">Refino</button></nav>'
    + '<section class="card" id="gs-a"><h2>A. Visão geral</h2><div class="prose">'
    + '<p>Smith é o caminho para ter armas e armaduras com os status do seu jeito. São três etapas: <b>criar</b> o equipamento (ele sai com um <b>potencial</b>), <b>colocar status</b> gastando esse potencial e <b>refinar</b> para aumentar o ATK ou a DEF.</p>'
    + '<p>Tudo gasta <b>materiais</b>: Metal, Cloth, Beast, Wood, Medicine e Mana. Você ganha materiais processando itens. Na página de cada item aparece quanto ele rende, por exemplo “Processar: 13 Metal”.</p>'
    + '<p>Os status que mais importam para quem faz smith: <b>DEX e TEC</b> aumentam a sua dificuldade de criação, <b>STR</b> aumenta a taxa de sucesso e o status principal de cada arma aumenta o potencial (tabela abaixo). A <b>proficiência</b> de smith sobe criando equipamentos.</p></div></section>'
    + '<section class="card" id="gs-b"><h2>B. Criação</h2><div class="prose">'
    + '<p>Toda receita tem uma <b>dificuldade</b>. Você só consegue criar se a sua dificuldade for igual ou maior:</p><p class="formula">Sua dificuldade = proficiência + TEC ÷ 2 + DEX ÷ 6</p>'
    + '<p>A <b>taxa de sucesso</b> depende da diferença entre a sua dificuldade e a do item, do seu STR e da skill Create Equipment:</p><p class="formula">Sucesso = (50% + 5% × nível de Create Equipment) × (10 + sua dificuldade − dificuldade do item + STR ÷ 10)</p>'
    + '<p>O <b>potencial</b> com que o item sai é o potencial base da receita, aumentado pelas skills <b>Careful Creation</b> (+1% por nível) e <b>Expert\'s Creation</b> (+2% por nível), mais um bônus do status ligado à arma:</p>'
    + '<div class="tblw"><table class="tbl"><thead><tr><th>Equipamento</th><th>Bônus de potencial</th></tr></thead><tbody>' + potRows + '</tbody></table></div>'
    + '<p><a class="btn" href="#/blacksmith">Abrir a calculadora de blacksmith</a></p></div></section>'
    + '<section class="card" id="gs-c"><h2>C. Status (statting)</h2><div class="prose">'
    + '<p>Colocar status é “gastar” o potencial do equipamento. Cada status positivo consome potencial, e os status em porcentagem costumam custar mais. Status <b>negativos</b> devolvem potencial, por isso as fórmulas de statting usam negativos em status que não interessam (por exemplo MATK % negativo numa arma física) para sobrar potencial para os bons.</p>'
    + '<p>Um equipamento aceita até <b>8 status</b>. Cada passo gasta materiais do tipo ligado ao status. Quanto mais potencial sobra no fim, maior a chance de sucesso. Por isso, um item que sai da criação com potencial alto vale muito mais.</p>'
    + '<p>Na prática, quem faz statting segue uma <b>fórmula</b>: uma sequência de passos testada para chegar nos status desejados com boa chance. Monte a sua com calma, sempre comparando o potencial restante antes de confirmar.</p>'
    + '<p class="muted">Um simulador de statting está nos planos do site.</p></div></section>'
    + '<section class="card" id="gs-d"><h2>D. Refino</h2><div class="prose">'
    + '<p>Refinar aumenta o ATK da arma ou a DEF da armadura. Os níveis vão de +1 a +9 e depois E, D, C, B, A e S (o máximo, equivalente a +15). Quanto mais alto, menor a chance de sucesso, e uma falha pode fazer o refino <b>cair</b>.</p>'
    + '<p>O refino usa <b>minérios</b> e pode usar <b>itens de suporte</b>, que ajudam no sucesso ou protegem contra a queda. A comunidade costuma calcular o bônus de ATK da arma como cerca de <b>ATK base × refino² ÷ 100 + refino</b>.</p>'
    + '<div class="dgroup"><span class="lbl">Minérios (' + ores.length + ')</span>' + lk(ores) + '</div>'
    + '<div class="dgroup"><span class="lbl">Itens de suporte de refino (' + sup.length + ')</span>' + lk(sup) + '</div></div></section>'
    + '<p class="note" style="color:var(--ink-2)">Fórmulas de criação: Toram Tools (Insane23), com base nos testes de DOPR e JosuaK62. Texto do guia escrito para o Bestiário de Toram.</p>';
  $('#gsnav').addEventListener('click', e => { const b = e.target.closest('[data-to]'); if (b) document.getElementById(b.dataset.to).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}

// ---------- calculadora de status do personagem (build) ----------
// Soma exata dos status dos itens (dados do coryn.club). ATK, MATK, HP etc. são estimativas pelas fórmulas da comunidade.
const MAIN_W = [['1 Handed Sword', 128], ['2 Handed Sword', 64], ['Bow', 32], ['Bowgun', 16], ['Knuckles', 2], ['Magic Device', 4], ['Staff', 8], ['Halberd', 2048], ['Katana', 8192]];
const SUB_W = [['Shield', 1], ['Dagger', 65536], ['Arrow', 262144], ['Ninjutsu Scroll', 524288], ['Magic Device', 0], ['Knuckles', 0], ['1 Handed Sword', 131072]];
const SLOTS = [
  ['arma', 'Arma principal', MAIN_W.map(w => w[0]), ['Weapon Crysta', 'Normal Crysta', 'Enhancer Crysta (Red)', 'Enhancer Crysta (Purple)'], true],
  ['sub', 'Sub-arma', SUB_W.map(w => w[0]), [], true],
  ['armadura', 'Armadura', ['Armor'], ['Armor Crysta', 'Normal Crysta', 'Enhancer Crysta (Blue)', 'Enhancer Crysta (Purple)'], true],
  ['adicional', 'Adicional', ['Additional'], ['Additional Crysta', 'Normal Crysta', 'Enhancer Crysta (Green)', 'Enhancer Crysta (Purple)'], true],
  ['especial', 'Anel especial', ['Special'], ['Special Crysta', 'Normal Crysta', 'Enhancer Crysta (Yellow)', 'Enhancer Crysta (Purple)'], false]
];
const REFS = ['0', '+1', '+2', '+3', '+4', '+5', '+6', '+7', '+8', '+9', 'E', 'D', 'C', 'B', 'A', 'S'];
const ARMOR_KIND = [['normal', 'Normal', 0], ['leve', 'Leve (Light)', 32768], ['pesada', 'Pesada (Heavy)', 16384]];
// ATK e MATK por arma: [STR, INT, DEX, AGI] para ATK; MATK usa INT×3 + DEX (Staff, MD e Knuckle somam o ATK da arma).
const ATKF = { '1 Handed Sword': [2, 0, 2, 0], '2 Handed Sword': [3, 0, 1, 0], 'Bow': [1, 0, 3, 0], 'Bowgun': [0, 0, 4, 0], 'Knuckles': [0, 0, 0.5, 2], 'Magic Device': [0, 2, 0, 2], 'Staff': [3, 1, 0, 0], 'Halberd': [2.5, 0, 0, 1.5], 'Katana': [1.5, 0, 2.5, 0], '': [1, 0, 0, 0] };
// Registlets que dão status direto (efeito do coryn.club): status e quanto por nível.
const REG_STAT = { 'Physical Attack Boost': ['ATK', 1], 'Magic Attack Boost': ['MATK', 1], 'Physical Defense Boost': ['DEF', 1], 'Magic Defense Boost': ['MDEF', 1], 'Accuracy Boost': ['Accuracy', 1], 'Dodge Boost': ['Dodge', 1], 'Attack Speed Boost': ['ASPD', 1], 'Magic Speed Boost': ['CSPD', 1], 'Max HP Boost': ['MaxHP', 10], 'Max MP Boost': ['MaxMP', 1] };
const REG_MAX_SLOTS = 10;
const newBuild = () => ({ rg: [], lv: 300, st: { STR: 1, INT: 1, VIT: 1, AGI: 1, DEX: 1 }, ps: 'CRT', pv: 0, sl: { arma: { id: 0, r: 0, x: [0, 0] }, sub: { id: 0, r: 0, x: [] }, armadura: { id: 0, r: 0, x: [0, 0], k: 'normal' }, adicional: { id: 0, r: 0, x: [0, 0] }, especial: { id: 0, r: 0, x: [0, 0] } }, ex: [] });
let BD = store.get('build', null) || newBuild();
const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
function buildEquipped() {
  const out = [];
  for (const [k] of SLOTS) { const s = BD.sl[k]; const it = DB.ITBYID.get(s.id); if (it) out.push([k, it, 'item']); (s.x || []).forEach(id => { const c = DB.ITBYID.get(id); if (c) out.push([k, c, 'crysta']); }); }
  return out;
}
function buildBits() {
  const main = DB.ITBYID.get(BD.sl.arma.id), sub = DB.ITBYID.get(BD.sl.sub.id);
  let bits = 0;
  if (main) bits |= (MAIN_W.find(w => w[0] === main.tl) || [0, 0])[1];
  if (sub) { bits |= (SUB_W.find(w => w[0] === sub.tl) || [0, 0])[1]; if (main && main.tl === '1 Handed Sword' && sub.tl === '1 Handed Sword') bits = (bits & ~128) | 131072; }
  bits |= (ARMOR_KIND.find(a => a[0] === BD.sl.armadura.k) || [0, 0, 0])[2];
  return bits;
}
function buildTotals() {
  const bits = buildBits(), tot = new Map(), off = [];
  const add = (si, v) => tot.set(si, (tot.get(si) || 0) + v);
  for (const [slot, it] of buildEquipped()) for (const s of it.stats) {
    if (isBase(s)) continue;
    if (s[2] && !(s[2] & bits)) { off.push([it, s]); continue; }
    add(s[0], s[1]);
  }
  BD.ex.forEach(([si, v]) => add(si, +v || 0));
  (BD.rg || []).forEach(([n, lv]) => { const m = REG_STAT[n]; if (m) { const i = SI(m[0]); if (i >= 0) add(i, m[1] * lv); } });
  return { tot, off, bits };
}
function buildDerived(tot) {
  const g = n => { const i = SI(n); return i < 0 ? 0 : tot.get(i) || 0; };
  const L = BD.lv, f = k => Math.floor(BD.st[k] * (1 + g(k + ' %') / 100)) + g(k);
  const STR = f('STR'), INT = f('INT'), VIT = f('VIT'), AGI = f('AGI'), DEX = f('DEX');
  const main = DB.ITBYID.get(BD.sl.arma.id), wt = main ? main.tl : '';
  const baseAtk = main ? ((main.stats.find(s => DB.STATN[s[0]] === 'Base ATK') || [0, 0])[1]) : 0, r = BD.sl.arma.r;
  const watk = Math.floor(baseAtk * (1 + g('Weapon ATK %') / 100)) + g('Weapon ATK') + Math.floor(baseAtk * r * r / 100) + r;
  const k = ATKF[wt] || ATKF[''];
  const atkRaw = L + STR * k[0] + INT * k[1] + DEX * k[2] + AGI * k[3] + (wt === 'Knuckles' ? watk * 0.5 : watk);
  const matkRaw = L + INT * (wt === 'Staff' || wt === 'Magic Device' ? 4 : 3) + DEX + (wt === 'Staff' || wt === 'Magic Device' ? watk : wt === 'Knuckles' ? watk * 0.5 : 0);
  const pct = (raw, n) => Math.floor(raw * (1 + g(n + ' %') / 100)) + g(n);
  const crt = BD.ps === 'CRT' ? BD.pv : 0, tec = BD.ps === 'TEC' ? BD.pv : 0;
  return { STR, INT, VIT, AGI, DEX, watk,
    ATK: pct(atkRaw, 'ATK'), MATK: pct(matkRaw, 'MATK'),
    MaxHP: pct(93 + (VIT + 22.41) * L / 3, 'MaxHP'), MaxMP: pct(99 + L + INT / 10 + tec, 'MaxMP'),
    CRIT: pct(25 + crt / 3.4, 'Critical Rate'), CSPD: pct(L + AGI * 1.16 + DEX * 2.94, 'CSPD'),
    HIT: pct(L + DEX, 'Accuracy'), FLEE: pct(L + AGI, 'Dodge') };
}
function saveBuild() { store.set('build', BD); syncChar(); }
function viewBuild(code) {
  setTitle('Status do personagem');
  if (code) { try { const b = JSON.parse(b64d(code)); if (b && b.sl) { BD = Object.assign(newBuild(), b); saveBuild(); } } catch (e) {} history.replaceState(null, '', '#/personagem/equipamento'); }
  const n = (id, lab, v, extra) => '<div class="field"><label class="lbl" for="' + id + '">' + lab + '</label><input id="' + id + '" type="number" inputmode="numeric" min="0" value="' + v + '"' + (extra || '') + '></div>';
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Status do personagem</h1><p>Monte seu equipamento e veja os status somados. A build fica salva neste aparelho e dá para compartilhar por link. No modo <b>ⓘ Info</b>, toque numa skill para ver o que ela faz, em português.</p></div></div>'
    + '<button type="button" class="bdsum" id="bdsum" aria-label="Ver resultado completo"></button>'
    + '<div class="grid2"><div>'
    + '<section class="card"><h2>Personagem</h2><div class="calc">' + n('bdlv', 'Nível', BD.lv) + ['STR', 'INT', 'VIT', 'AGI', 'DEX'].map(s => n('bd' + s, s, BD.st[s])).join('')
    + '<div class="field"><label class="lbl" for="bdps">Status pessoal</label><select id="bdps">' + ['CRT', 'LUK', 'MTL', 'TEC'].map(p => '<option' + (BD.ps === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></div>' + n('bdpv', 'Valor', BD.pv)
    + '</div><p class="note" id="bdpts"></p></section>'
    + '<div id="bdslots"></div>'
    + '<section class="card"><h2>Bônus extras <small>comida, skills, avatar…</small></h2><div id="bdex"></div><div class="range" style="margin-top:8px"><select id="bdexs" aria-label="Status"></select><input id="bdexv" type="number" step="any" placeholder="valor" style="width:90px;flex:none" aria-label="Valor"><button id="bdexa" class="btn" type="button">+</button></div></section>'
    + '</div><div>'
    + '<section class="card" id="bdres"></section>'
    + '<section class="card"><h2>Salvar e compartilhar</h2><div class="chips"><button class="btn" id="bdshare" type="button">Copiar link da build</button><button class="btn ghost" id="bdclear" type="button">Começar do zero</button></div><p class="note" id="bdmsg">A build é salva automaticamente neste aparelho.</p></section>'
    + '</div></div>'
    + '<div class="picker" id="pick" hidden><div class="pbox"><div class="phead"><input id="pq" type="search" placeholder="Buscar item" aria-label="Buscar item"><button class="btn ghost" id="pclose" type="button">Fechar</button></div><div id="plist2" class="plist"></div></div></div>'
    + '<div class="toast" id="toast" hidden></div>';
  const statOpts = DB.STATN.map((s, i) => [s, i]).filter(x => x[0].trim() && !isBase([x[1]])).sort((a, b) => a[0].localeCompare(b[0]));
  $('#bdexs').innerHTML = statOpts.map(([s, i]) => '<option value="' + i + '">' + esc(s) + '</option>').join('');
  renderSlots(); renderBuild();
  const upd = () => {
    BD.lv = Math.max(1, +$('#bdlv').value || 1);
    ['STR', 'INT', 'VIT', 'AGI', 'DEX'].forEach(s => { BD.st[s] = Math.max(1, +$('#bd' + s).value || 1); });
    BD.ps = $('#bdps').value; BD.pv = Math.max(0, +$('#bdpv').value || 0);
    saveBuild(); renderBuild();
  };
  ['bdlv', 'bdSTR', 'bdINT', 'bdVIT', 'bdAGI', 'bdDEX', 'bdps', 'bdpv'].forEach(id => $('#' + id).addEventListener('input', upd));
  $('#bdexa').addEventListener('click', () => { const v = +$('#bdexv').value; if (!v) return; BD.ex.push([+$('#bdexs').value, v]); $('#bdexv').value = ''; saveBuild(); renderBuild(); });
  $('#bdex').addEventListener('click', e => { const b = e.target.closest('[data-ex]'); if (!b) return; BD.ex.splice(+b.dataset.ex, 1); saveBuild(); renderBuild(); });
  $('#bdshare').addEventListener('click', () => {
    const url = location.href.split('#')[0] + '#/build/' + b64e(JSON.stringify(BD));
    const done = () => { $('#bdmsg').textContent = 'Link copiado! Cole no grupo para mostrar a build.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => { fallbackCopy(url); done(); }); else { fallbackCopy(url); done(); }
  });
  $('#bdclear').addEventListener('click', () => { if (!confirm('Apagar a build atual e começar do zero?')) return; BD = newBuild(); saveBuild(); viewChar('equipamento'); });
  $('#bdslots').addEventListener('click', e => {
    const p = e.target.closest('[data-pick]'); if (p) { openPicker(p.dataset.pick, +p.dataset.x); return; }
    const c = e.target.closest('[data-clr]'); if (c) { const [k, x] = c.dataset.clr.split(':'); if (x === undefined || x === '') BD.sl[k].id = 0; else BD.sl[k].x[+x] = 0; saveBuild(); renderSlots(); renderBuild(); }
  });
  $('#bdslots').addEventListener('change', e => {
    const r = e.target.closest('[data-ref]'); if (r) { BD.sl[r.dataset.ref].r = +r.value; saveBuild(); renderBuild(); }
    const kk = e.target.closest('#bdkind'); if (kk) { BD.sl.armadura.k = kk.value; saveBuild(); renderBuild(); }
  });
  $('#bdsum').addEventListener('click', () => $('#bdres').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#pclose').addEventListener('click', () => { $('#pick').hidden = true; });
  $('#pick').addEventListener('click', e => { if (e.target.id === 'pick') $('#pick').hidden = true; });
}
let PK = null;
function openPicker(slot, x) {
  const def = SLOTS.find(s => s[0] === slot), types = x >= 0 ? def[3] : def[2];
  PK = { slot, x, types };
  $('#pq').value = ''; $('#pick').hidden = false; pickList(); $('#pq').focus();
  $('#pq').oninput = pickList;
  $('#plist2').onclick = e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const id = +b.dataset.id;
    if (PK.x >= 0) BD.sl[PK.slot].x[PK.x] = id; else BD.sl[PK.slot].id = id;
    saveBuild(); $('#pick').hidden = true; renderSlots(); renderBuild();
  };
}
function pickList() {
  const q = $('#pq').value.trim().toLowerCase();
  const rows = DB.ITEMS.filter(i => PK.types.includes(i.tl) && (!q || i.text.includes(q))).sort((a, b) => b.id - a.id).slice(0, 80);
  $('#plist2').innerHTML = rows.length ? rows.map(i => { const st = i.stats.filter(s => !isBase(s)).slice(0, 4).map(s => { const [nm, v] = sparts(s); return nm + ' ' + v; }).join(' · '); return '<button type="button" class="prow2" data-id="' + i.id + '"><b>' + esc(i.name) + '</b> <small>' + esc(i.tl) + (baseText(i) ? ' · ' + baseText(i).replace(/<[^>]+>/g, ' ') : '') + '</small><span>' + esc(st) + '</span></button>'; }).join('')
    : '<p class="empty">Nenhum item encontrado.</p>';
}
function renderSlots() {
  $('#bdslots').innerHTML = SLOTS.map(([k, lab, , xt, ref]) => {
    const s = BD.sl[k], it = DB.ITBYID.get(s.id);
    const one = (txt, data, clr) => '<div class="slotrow"><button type="button" class="slotbtn" data-pick="' + data[0] + '" data-x="' + data[1] + '">' + txt + '</button>' + (clr ? '<button type="button" class="slotx" data-clr="' + clr + '" aria-label="Tirar">×</button>' : '') + '</div>';
    let h = one(it ? '<b>' + esc(it.name) + '</b><small>' + esc(it.tl) + (baseText(it) ? ' · ' + baseText(it).replace(/<[^>]+>/g, ' ') : '') + '</small>' : '<span class="muted">Escolher ' + lab.toLowerCase() + '</span>', [k, -1], it ? k + ':' : '');
    if (ref) h += '<div class="range" style="margin-top:6px"><label class="lbl" style="flex:none">Refino</label><select data-ref="' + k + '">' + REFS.map((r2, i) => '<option value="' + i + '"' + (s.r === i ? ' selected' : '') + '>' + r2 + '</option>').join('') + '</select>'
      + (k === 'armadura' ? '<select id="bdkind" aria-label="Tipo de armadura">' + ARMOR_KIND.map(a => '<option value="' + a[0] + '"' + (s.k === a[0] ? ' selected' : '') + '>' + a[1] + '</option>').join('') + '</select>' : '') + '</div>';
    if (xt.length) h += [0, 1].map(xi => { const c = DB.ITBYID.get((s.x || [])[xi]); return one(c ? '<b>' + esc(c.name) + '</b><small>' + esc(c.tl) + '</small>' : '<span class="muted">Crysta ' + (xi + 1) + '</span>', [k, xi], c ? k + ':' + xi : ''); }).join('');
    return '<section class="card slot"><h2>' + lab + '</h2>' + h + '</section>';
  }).join('');
}
function renderBuild() {
  const { tot, off } = buildTotals(), d = buildDerived(tot);
  const used = ['STR', 'INT', 'VIT', 'AGI', 'DEX'].reduce((a, s) => a + BD.st[s] - 1, 0) + BD.pv, have = statPts(BD.lv) + lvEmblemPts(BD.lv);
  $('#bdpts').textContent = 'Pontos usados: ' + fmt(used) + ' de ' + fmt(have) + ' (2 por nível + emblema de nível; sem os emblemas de função).';
  $('#bdex').innerHTML = BD.ex.length ? '<div class="chips">' + BD.ex.map(([si, v], i) => '<button type="button" class="chip" data-ex="' + i + '">' + esc(DB.STATN[si]) + ' ' + (v > 0 ? '+' : '') + fmt(v) + ' <span class="x">×</span></button>').join('') + '</div>' : '<p class="muted" style="margin:0;font-size:13.5px">Nenhum bônus extra.</p>';
  const box = (l, v) => '<div><span class="lbl">' + l + '</span><div class="big">' + fmt(Math.floor(v)) + '</div></div>';
  $('#bdsum').innerHTML = [['ATK', d.ATK], ['MATK', d.MATK], ['Crít.', d.CRIT], ['HP', d.MaxHP]].map(([l, v]) => '<span><small>' + l + '</small>' + fmt(Math.floor(v)) + '</span>').join('') + '<em>ver tudo ↓</em>';
  const rows = [...tot.entries()].filter(([, v]) => v).sort((a, b) => DB.STATN[a[0]].localeCompare(DB.STATN[b[0]]));
  $('#bdres').innerHTML = '<h2>Resultado</h2><div class="res">' + ['STR', 'INT', 'VIT', 'AGI', 'DEX'].map(s => box(s, d[s])).join('') + '</div>'
    + '<h4 class="sub4">Estimativas</h4><div class="res">' + [['ATK', d.ATK], ['MATK', d.MATK], ['ATK da arma', d.watk], ['MaxHP', d.MaxHP], ['MaxMP', d.MaxMP], ['Taxa crítica', d.CRIT], ['CSPD', d.CSPD], ['Precisão', d.HIT], ['Esquiva', d.FLEE]].map(([l, v]) => box(l, v)).join('') + '</div>'
    + '<h4 class="sub4">Soma dos equipamentos e bônus <small>exata</small></h4>' + (rows.length ? '<div class="slist">' + rows.map(([si, v]) => { const [nm, vv] = sparts([si, v, 0]); return '<div class="' + (v < 0 ? 'neg' : '') + '"><span>' + esc(nm) + '</span><b>' + vv + '</b></div>'; }).join('') + '</div>' : '<p class="muted" style="margin:0">Escolha equipamentos para ver a soma.</p>')
    + (off.length ? '<p class="note">Não contam com a arma e armadura atuais: ' + off.map(([it, s]) => { const [nm, vv, c] = sparts(s); return esc(nm + ' ' + vv + ' (' + c + ', ' + it.name + ')'); }).join('; ') + '.</p>' : '')
    + '<p class="note">As estimativas usam fórmulas da comunidade (ATK por tipo de arma, refino ≈ ATK base × refino² ÷ 100 + refino) e não incluem skills passivas. Use para comparar builds, não como valor exato do jogo.</p>';
}

// ---------- notícias do site oficial ----------
// O GitHub Actions (scripts/noticias.py) lê en.toram.jp a cada 3 horas e salva data/noticias.json no repositório.
// Lemos direto do repositório para pegar a versão mais nova; se falhar, usamos a cópia publicada junto com o site.
const NEWS_RAW = 'https://raw.githubusercontent.com/DGoffim/Bestiario-Toram/main/data/noticias.json';
const NEWS_CAT = { event: 'Evento', update: 'Atualização', important: 'Importante', maintenance: 'Manutenção', defect: 'Problemas', other: 'Outros' };
let NEWS = null, NEWSP = null, NEWSF = '';
function loadNews() {
  if (NEWSP) return NEWSP;
  NEWSP = fetch(NEWS_RAW + '?t=' + Math.floor(Date.now() / 300000)).then(r => { if (!r.ok) throw 0; return r.json(); })
    .catch(() => load('noticias')).then(d => (NEWS = d)).catch(() => (NEWS = { itens: [] }));
  return NEWSP;
}
const newsCat = c => NEWS_CAT[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Outros');
const newsDate = d => d ? d.split('-').reverse().join('/') : '';
const newsRow = n => '<a class="row nrow" href="#/noticia/' + n.id + '"><span class="rn">' + esc(n.titulo) + '</span><span class="rsub"><span class="ncat c-' + esc(n.cat) + '">' + esc(newsCat(n.cat)) + '</span> ' + newsDate(n.data) + '</span></a>';
function homeNews() {
  loadNews().then(() => {
    const box = $('#homenews'); if (!box) return;
    const it = NEWS.itens.slice(0, 5);
    box.innerHTML = '<h2>Notícias do jogo <small>site oficial</small></h2>' + (it.length ? '<div class="list">' + it.map(newsRow).join('') + '</div><p style="margin:10px 0 0"><a class="tl" href="#/noticias">Ver todas as notícias</a></p>' : '<p class="muted" style="margin:0">As notícias aparecem aqui assim que a busca automática rodar.</p>');
  });
}
function viewNews() {
  setTitle('Notícias');
  view.innerHTML = backBtn('#/') + '<div class="ph"><div><h1>Notícias do jogo</h1><p>Manutenções, eventos e atualizações do site oficial do Toram Online, atualizadas sozinhas a cada 3 horas.</p></div></div><div id="nwbox"><p class="loading">Carregando notícias…</p></div>';
  loadNews().then(() => {
    const cats = [...new Set(NEWS.itens.map(n => n.cat))];
    const draw = () => {
      const rows = NEWS.itens.filter(n => !NEWSF || n.cat === NEWSF);
      $('#nwbox').innerHTML = '<div class="chips" id="nwcat" style="margin:0 0 10px">' + [''].concat(cats).map(c => '<button type="button" class="chip" data-c="' + c + '" aria-pressed="' + (NEWSF === c) + '">' + (c ? esc(newsCat(c)) : 'Todas') + '</button>').join('') + '</div>'
        + (rows.length ? '<div class="list">' + rows.map(newsRow).join('') + '</div>' : '<p class="empty" style="color:var(--ink-2)">Nenhuma notícia ainda. A busca automática roda a cada 3 horas.</p>')
        + (NEWS.lido ? '<p class="note" style="color:var(--ink-2)">Última busca: ' + new Date(NEWS.lido).toLocaleString('pt-BR') + '. Fonte: site oficial do Toram Online (en.toram.jp); os textos ficam em inglês, como lá.</p>' : '');
      $('#nwcat').onclick = e => { const b = e.target.closest('[data-c]'); if (b) { NEWSF = b.dataset.c; draw(); } };
    };
    draw();
  });
}
function viewNewsItem(id) {
  view.innerHTML = backBtn('#/noticias') + '<p class="loading">Carregando…</p>';
  loadNews().then(() => {
    const n = NEWS.itens.find(x => x.id === id);
    if (!n) { view.innerHTML = backBtn('#/noticias') + '<p class="empty">Notícia não encontrada.</p>'; return; }
    setTitle(n.titulo);
    const paras = (n.texto || '').split('\n').filter(Boolean);
    view.innerHTML = backBtn('#/noticias') + '<div class="dhead"><h1>' + esc(n.titulo) + '</h1><div class="dmeta"><span class="ncat c-' + esc(n.cat) + '">' + esc(newsCat(n.cat)) + '</span><span class="muted">' + newsDate(n.data) + '</span></div></div>'
      + '<section class="card prose newsbody">' + (paras.length ? paras.map(p => '<p>' + esc(p) + '</p>').join('') : '<p class="muted">O texto completo só é guardado para as notícias mais recentes.</p>') + '</section>'
      + '<p class="note" style="color:var(--ink-2)">Texto do site oficial do Toram Online (en.toram.jp), em inglês.</p>';
  });
}

// ---------- personagem (no esquema do Cy's Grimoire): abas Visão geral, Equipamento, Skills, Comida e Salvar ----------
// Cada personagem guarda a build (equipamento e status) e as skills. Fica tudo salvo neste aparelho.
const PG_TABS = [['geral', 'Geral'], ['equipamento', 'Equipamento'], ['skills', 'Skills'], ['registlets', 'Registlets'], ['comida', 'Comida'], ['comparar', 'Comparar'], ['salvar', 'Salvar']];
let CHARS = store.get('chars', null) || { cur: 0, list: [{ name: 'Build 1', bd: store.get('build', null), sk: store.get('skills', {}) }] };
const clone = o => JSON.parse(JSON.stringify(o));
function syncChar() { const c = CHARS.list[CHARS.cur]; if (!c) return; c.bd = clone(BD); c.sk = clone(SKS.lv); c.sg = clone(SKS.gem); store.set('chars', CHARS); }
function useChar(i) {
  CHARS.cur = i; const c = CHARS.list[i];
  BD = Object.assign(newBuild(), clone(c.bd || newBuild())); SKS.lv = clone(c.sk || {}); SKS.gem = clone(c.sg || {});
  store.set('build', BD); store.set('skills', SKS.lv); store.set('stargems', SKS.gem); store.set('chars', CHARS);
}
function addChar(name, bd, sk, sg) { CHARS.list.push({ name, bd: bd || newBuild(), sk: sk || {}, sg: sg || {} }); useChar(CHARS.list.length - 1); }
const charCode = c => b64e(JSON.stringify({ n: c.name, b: c.bd, s: c.sk, g: c.sg || {} }));
function importChar(code) {
  try { const o = JSON.parse(b64d(code)); addChar((o.n || 'Build') + ' (importada)', o.b, o.s, o.g); } catch (e) { alert('Esse link ou código de personagem não é válido.'); }
  location.replace('#/personagem/geral');
}
function viewChar(tab, code) {
  tab = PG_TABS.some(x => x[0] === tab) ? tab : 'geral';
  // links antigos: #/build/<código> e #/skills/<código> viram um personagem novo, sem apagar o atual
  if (code) {
    try {
      if (tab === 'equipamento') addChar('Build compartilhada', Object.assign(newBuild(), JSON.parse(b64d(code))), {});
      else if (tab === 'skills') addChar('Skills compartilhadas', newBuild(), skDecode(code));
    } catch (e) {}
    history.replaceState(null, '', '#/personagem/' + tab);
  }
  setTitle('Personagem');
  const c = CHARS.list[CHARS.cur];
  mainView.innerHTML = '<div class="ph"><div><h1>' + esc(c.name) + '</h1><p>Monte sua build como no jogo: equipamento, skills e comida. Tudo fica salvo sozinho neste aparelho; é só voltar depois.</p></div>'
    + (CHARS.list.length > 1 ? '<select id="pgchar" aria-label="Trocar de build" style="width:auto;max-width:100%">' + CHARS.list.map((x, i) => '<option value="' + i + '"' + (i === CHARS.cur ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select>' : '') + '</div>'
    + '<nav class="seg pgtabs" aria-label="Abas do personagem">' + PG_TABS.map(([k, l]) => '<a href="#/personagem/' + k + '" class="' + (k === tab ? 'on' : '') + '">' + l + '</a>').join('') + '</nav><div id="pgbody" class="pgbody"></div>';
  const sel = $('#pgchar'); if (sel) sel.addEventListener('change', e => { useChar(+e.target.value); viewChar(tab); });
  const on = mainView.querySelector('.pgtabs .on'); if (on) on.parentNode.scrollLeft = on.offsetLeft - 12; // aba aberta sempre visível no celular
  view = $('#pgbody');
  try {
    if (tab === 'equipamento') viewBuild();
    else if (tab === 'skills') viewSkills();
    else if (tab === 'comida') viewFood();
    else if (tab === 'salvar') viewCharSave();
    else if (tab === 'comparar') viewCharCompare();
    else if (tab === 'registlets') viewCharRegs();
    else viewCharOverview();
  } finally { view = mainView; }
  setTitle(c.name + ' · ' + PG_TABS.find(x => x[0] === tab)[1]);
}
function viewCharOverview() {
  if (!SKT) { load('skills').then(d => { SKT = d.trees; if (location.hash === '#/personagem' || location.hash.startsWith('#/personagem/geral')) viewChar('geral'); }).catch(() => {}); }
  const { tot } = buildTotals(), d = buildDerived(tot);
  const box = (l, v) => '<div><span class="lbl">' + l + '</span><div class="big">' + fmt(Math.floor(v)) + '</div></div>';
  const eq = SLOTS.map(([k, lab]) => { const s = BD.sl[k], it = DB.ITBYID.get(s.id); return it ? '<div><span>' + lab + '</span><b><a class="tl" href="' + itemUrl(it) + '">' + esc(it.name) + '</a>' + (s.r ? ' ' + REFS[s.r] : '') + '</b></div>' : ''; }).join('');
  const trees = SKT ? SKT.map(t => [skTreeName(t), skTreeSP(t)]).filter(x => x[1]) : Object.entries(SKS.lv).map(([k, o]) => [k, Object.values(o).reduce((a, b) => a + b, 0)]);
  const sp = trees.reduce((a, x) => a + x[1], 0), gemPts = SKT ? SKT.reduce((a, t) => a + skTreeGem(t), 0) : 0;
  view.innerHTML = '<div class="grid2"><div>'
    + '<section class="card"><h2>Status <small>Lv ' + BD.lv + '</small></h2><div class="res">' + ['STR', 'INT', 'VIT', 'AGI', 'DEX'].map(s => box(s, d[s])).join('') + '</div>'
    + '<h4 class="sub4">Estimativas</h4><div class="res">' + [['ATK', d.ATK], ['MATK', d.MATK], ['MaxHP', d.MaxHP], ['MaxMP', d.MaxMP], ['Taxa crítica', d.CRIT], ['CSPD', d.CSPD], ['Precisão', d.HIT], ['Esquiva', d.FLEE]].map(([l, v]) => box(l, v)).join('') + '</div>'
    + '<p class="note">Fórmulas da comunidade, sem skills passivas. Para mudar, use a aba Equipamento.</p></section></div><div>'
    + '<section class="card"><h2>Equipamento</h2>' + (eq ? '<div class="slist">' + eq + '</div>' : '<p class="muted" style="margin:0">Nada equipado ainda. <a class="tl" href="#/personagem/equipamento">Escolher equipamento</a></p>') + '</section>'
    + '<section class="card"><h2>Skills <small>' + sp + ' pontos · sobram ' + Math.max(0, skillPts(BD.lv) - sp) + ' no Lv ' + BD.lv + (gemPts ? ' · ★ ' + gemPts + ' Star Gem' : '') + '</small></h2>' + (trees.length ? '<div class="slist">' + trees.map(([n, v]) => '<div><span>' + esc(n) + '</span><b>' + v + ' SP</b></div>').join('') + '</div>' : '<p class="muted" style="margin:0">Nenhuma skill ainda. <a class="tl" href="#/personagem/skills">Distribuir pontos</a></p>') + '</section>'
    + '<section class="card"><h2>Registlets <small>' + (BD.rg || []).length + ' de ' + REG_MAX_SLOTS + '</small></h2>' + ((BD.rg || []).length ? '<div class="links">' + BD.rg.map(([n, lv]) => '<span class="lk">' + esc(n) + ' <small>Lv ' + lv + '</small></span>').join('') + '</div>' : '<p class="muted" style="margin:0">Nenhum registlet. <a class="tl" href="#/personagem/registlets">Equipar registlets</a></p>') + '</section>'
    + '<section class="card"><h2>Usar este personagem</h2><div class="chips"><a class="btn" href="#/dano">Calcular dano num boss</a><a class="btn ghost" href="#/statting">Simular statting</a><a class="btn ghost" href="#/personagem/salvar">Compartilhar</a></div></section>'
    + '</div></div>';
}
function viewCharSave() {
  const list = CHARS.list.map((c, i) => { const w = DB.ITBYID.get(((c.bd || {}).sl || {}).arma ? c.bd.sl.arma.id : 0); return '<div class="charrow' + (i === CHARS.cur ? ' on' : '') + '"><div><b>' + esc(c.name) + '</b><small>Lv ' + ((c.bd || {}).lv || '—') + (w ? ' · ' + esc(w.name) : '') + (i === CHARS.cur ? ' · em uso' : '') + '</small></div><div class="chips">'
    + (i !== CHARS.cur ? '<button type="button" class="btn" data-use="' + i + '">Usar</button>' : '') + '<button type="button" class="btn ghost" data-ren="' + i + '">Renomear</button><button type="button" class="btn ghost" data-dup="' + i + '">Duplicar</button><button type="button" class="btn ghost" data-link="' + i + '">Copiar link</button>' + (CHARS.list.length > 1 ? '<button type="button" class="btn ghost" data-del="' + i + '">Excluir</button>' : '') + '</div></div>'; }).join('');
  view.innerHTML = '<section class="card"><h2>Suas builds <small>' + CHARS.list.length + '</small></h2><div class="charlist">' + list + '</div><div class="chips" style="margin-top:12px"><button type="button" class="btn" id="pgnew">+ Nova build</button>' + (CHARS.list.length > 1 ? '<a class="btn ghost" href="#/personagem/comparar">Comparar builds</a>' : '') + '</div><p class="note" id="pgmsg">Cada mudança é salva na hora neste aparelho. Para mandar uma build a alguém, use “Copiar link”.</p></section>'
    + '<section class="card"><h2>Backup</h2><p class="muted" style="margin:0 0 10px;font-size:14px">Guarde um arquivo com todas as suas builds. Se o navegador for limpo ou você trocar de celular, é só restaurar.</p><div class="chips"><button type="button" class="btn" id="pgbak">Baixar backup</button><label class="btn ghost" for="pgrest" style="cursor:pointer">Restaurar backup</label><input id="pgrest" type="file" accept=".json,application/json" hidden></div></section>'
    + '<section class="card"><h2>Importar</h2><div class="range"><input id="pgimp" type="search" placeholder="Cole aqui o link ou o código de uma build"><button type="button" class="btn" id="pgimpb">Importar</button></div></section>';
  const msg = s => { $('#pgmsg').textContent = s; };
  view.querySelector('.charlist').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +(b.dataset.use || b.dataset.ren || b.dataset.dup || b.dataset.link || b.dataset.del);
    if (b.dataset.use) { useChar(i); viewChar('salvar'); }
    else if (b.dataset.ren) { const n = prompt('Nome da build:', CHARS.list[i].name); if (n && n.trim()) { CHARS.list[i].name = n.trim().slice(0, 40); store.set('chars', CHARS); viewChar('salvar'); } }
    else if (b.dataset.dup) { syncChar(); addChar(CHARS.list[i].name + ' (cópia)', clone(CHARS.list[i].bd), clone(CHARS.list[i].sk), clone(CHARS.list[i].sg || {})); viewChar('salvar'); }
    else if (b.dataset.link) { syncChar(); const url = location.href.split('#')[0] + '#/p/' + charCode(CHARS.list[i]); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => msg('Link copiado! Quem abrir recebe uma cópia desse personagem.'), () => { fallbackCopy(url); msg('Link copiado!'); }); else { fallbackCopy(url); msg('Link copiado!'); } }
    else if (b.dataset.del) { if (!confirm('Excluir “' + CHARS.list[i].name + '”?')) return; CHARS.list.splice(i, 1); useChar(Math.min(CHARS.cur > i ? CHARS.cur - 1 : CHARS.cur, CHARS.list.length - 1)); viewChar('salvar'); }
  });
  $('#pgnew').addEventListener('click', () => { syncChar(); addChar('Build ' + (CHARS.list.length + 1)); viewChar('equipamento'); location.hash = '#/personagem/equipamento'; });
  $('#pgimpb').addEventListener('click', () => { const v = $('#pgimp').value.trim(); const m = v.match(/#\/p\/([A-Za-z0-9_-]+)/); const code = m ? m[1] : v; if (code) importChar(code); });
  $('#pgbak').addEventListener('click', () => {
    syncChar();
    const blob = new Blob([JSON.stringify({ app: 'bestiario-toram', versao: 1, data: new Date().toISOString(), builds: CHARS.list })], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'builds-bestiario-toram-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    msg('Backup baixado. Guarde o arquivo num lugar seguro.');
  });
  $('#pgrest').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    file.text().then(txt => {
      const arr = (JSON.parse(txt) || {}).builds;
      if (!Array.isArray(arr) || !arr.length) throw new Error('vazio');
      syncChar();
      arr.forEach(c => CHARS.list.push({ name: String(c.name || 'Build').slice(0, 40), bd: c.bd || newBuild(), sk: c.sk || {}, sg: c.sg || {} }));
      store.set('chars', CHARS); viewChar('salvar');
      $('#pgmsg').textContent = arr.length + (arr.length === 1 ? ' build restaurada' : ' builds restauradas') + ' do backup.';
    }).catch(() => alert('Esse arquivo não é um backup do Bestiário de Toram.'));
  });
}
// Aba Registlets: até 10 equipados, cada um com nível; os de status entram na soma da build.
function viewCharRegs() {
  if (!REGS) { view.innerHTML = '<p class="loading">Carregando registlets…</p>'; load('registlets').then(d => { REGS = d.regs; if (location.hash.startsWith('#/personagem/registlets')) viewChar('registlets'); }); return; }
  BD.rg = BD.rg || [];
  const reg = n => REGS.find(r => r[0] === n) || [n, 1, '', ''];
  const bonus = BD.rg.map(([n, lv]) => REG_STAT[n] ? [REG_STAT[n][0], REG_STAT[n][1] * lv] : null).filter(Boolean);
  const cards = BD.rg.map(([n, lv], i) => { const r = reg(n), m = REG_STAT[n]; return '<section class="card reg"><h2>' + esc(n) + ' <button type="button" class="slotx" data-rmreg="' + i + '" aria-label="Tirar registlet" style="margin-left:auto;height:30px;width:30px;font-size:16px">×</button></h2>'
    + '<div class="range" style="margin:-2px 0 8px"><label class="lbl" for="rgl' + i + '" style="flex:none">Nível</label><select id="rgl' + i + '" data-rglv="' + i + '" style="width:auto">' + Array.from({ length: Math.max(1, r[1]) }, (_, k) => '<option' + (k + 1 === lv ? ' selected' : '') + '>' + (k + 1) + '</option>').join('') + '</select><span class="muted" style="font-size:12.5px">de ' + (r[1] || 1) + '</span>' + (m ? '<span class="tag ok">' + esc(m[0]) + ' +' + fmt(m[1] * lv) + '</span>' : '') + (r[2] ? '<span class="tag info">Muda: ' + esc(r[2]) + '</span>' : '') + '</div><p class="reff">' + esc(r[3]) + '</p></section>'; }).join('');
  view.innerHTML = '<section class="card"><h2>Registlets equipados <small>' + BD.rg.length + ' de ' + REG_MAX_SLOTS + '</small></h2>'
    + (bonus.length ? '<p style="margin:0 0 8px;font-size:14px"><span class="muted">Somam na build:</span> ' + bonus.map(([s, v]) => '<b>' + esc(s) + ' +' + fmt(v) + '</b>').join(' · ') + '</p>' : '')
    + '<div class="chips"><button type="button" class="btn" id="rgadd"' + (BD.rg.length >= REG_MAX_SLOTS ? ' disabled' : '') + '>+ Adicionar registlet</button></div>'
    + '<p class="note">Os registlets de status (ATK, MATK, DEF, MDEF, Precisão, Esquiva, ASPD, CSPD, HP e MP) entram na soma da build e nas calculadoras. Os que mudam skills ficam anotados aqui. Efeitos do coryn.club, em inglês como no jogo.</p></section>'
    + (cards ? '<div class="regs">' + cards + '</div>' : '')
    + '<div class="picker" id="pick" hidden><div class="pbox"><div class="phead"><input id="pq" type="search" placeholder="Buscar registlet (nome, skill ou efeito)" aria-label="Buscar registlet"><button class="btn ghost" id="pclose" type="button">Fechar</button></div><div id="plist2" class="plist"></div></div></div>';
  const rerender = () => { saveBuild(); viewChar('registlets'); };
  view.querySelectorAll('[data-rglv]').forEach(s => s.addEventListener('change', () => { BD.rg[+s.dataset.rglv][1] = +s.value; rerender(); }));
  view.querySelectorAll('[data-rmreg]').forEach(b => b.addEventListener('click', () => { BD.rg.splice(+b.dataset.rmreg, 1); rerender(); }));
  const list = () => { const q = $('#pq').value.trim().toLowerCase(); const have = new Set(BD.rg.map(x => x[0]));
    $('#plist2').innerHTML = REGS.filter(r => !have.has(r[0]) && (!q || (r[0] + ' ' + r[2] + ' ' + r[3]).toLowerCase().includes(q))).sort((a, b) => (REG_STAT[b[0]] ? 1 : 0) - (REG_STAT[a[0]] ? 1 : 0) || a[0].localeCompare(b[0])).slice(0, 80)
      .map(r => '<button type="button" class="prow2" data-reg="' + esc(r[0]) + '"><b>' + esc(r[0]) + '</b> <small>nível máx. ' + r[1] + (r[2] ? ' · muda ' + esc(r[2]) : '') + (REG_STAT[r[0]] ? ' · soma ' + esc(REG_STAT[r[0]][0]) : '') + '</small><span>' + esc(r[3]) + '</span></button>').join('') || '<p class="empty">Nenhum registlet.</p>'; };
  $('#rgadd').addEventListener('click', () => { $('#pq').value = ''; $('#pick').hidden = false; list(); $('#pq').focus(); });
  $('#pq').addEventListener('input', list);
  $('#plist2').addEventListener('click', e => { const b = e.target.closest('[data-reg]'); if (!b) return; const r = reg(b.dataset.reg); BD.rg.push([r[0], Math.max(1, r[1])]); rerender(); });
  $('#pclose').addEventListener('click', () => { $('#pick').hidden = true; });
  $('#pick').addEventListener('click', e => { if (e.target.id === 'pick') $('#pick').hidden = true; });
}
// Calcula os status de uma build salva sem mexer na build em uso.
function charCalc(c) {
  const keep = BD; BD = Object.assign(newBuild(), clone(c.bd || newBuild()));
  try { const r = buildTotals(); return { bd: BD, tot: r.tot, d: buildDerived(r.tot) }; } finally { BD = keep; }
}
const CMPB = { a: 0, b: 1 };
function viewCharCompare() {
  syncChar();
  const n = CHARS.list.length;
  if (n < 2) { view.innerHTML = '<section class="card"><h2>Comparar builds</h2><p class="muted" style="margin:0 0 12px">Você tem só uma build. Crie outra (ou duplique esta e mude o que quiser) para comparar.</p><a class="btn" href="#/personagem/salvar">Ir para Salvar</a></section>'; return; }
  if (!SKT) { load('skills').then(d => { SKT = d.trees; if (location.hash.startsWith('#/personagem/comparar')) viewChar('comparar'); }).catch(() => {}); }
  if (CMPB.a >= n) CMPB.a = 0;
  if (CMPB.b >= n || CMPB.b === CMPB.a) CMPB.b = CMPB.a === 0 ? 1 : 0;
  const A = CHARS.list[CMPB.a], B = CHARS.list[CMPB.b], ca = charCalc(A), cb = charCalc(B);
  const sel = (id, v) => '<select id="' + id + '">' + CHARS.list.map((c, i) => '<option value="' + i + '"' + (i === v ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select>';
  const dif = (a, b, fmtf) => { if (a == null || b == null || a === b) return '<td class="n dz">—</td>'; const d = b - a; return '<td class="n ' + (d > 0 ? 'up' : 'dn') + '">' + (d > 0 ? '+' : '−') + fmtf(Math.abs(d)) + '</td>'; };
  const numRow = (lab, a, b, fmtf = v => fmt(Math.floor(v))) => '<tr><th scope="row">' + lab + '</th><td class="n">' + (a == null ? '—' : fmtf(a)) + '</td><td class="n">' + (b == null ? '—' : fmtf(b)) + '</td>' + dif(a, b, fmtf) + '</tr>';
  const head = '<thead><tr><th></th><th scope="col" class="n">' + esc(A.name) + '</th><th scope="col" class="n">' + esc(B.name) + '</th><th scope="col" class="n">Diferença</th></tr></thead>';
  const status = numRow('Nível', ca.bd.lv, cb.bd.lv) + ['STR', 'INT', 'VIT', 'AGI', 'DEX'].map(s => numRow(s, ca.d[s], cb.d[s])).join('');
  const est = [['ATK', 'ATK'], ['MATK', 'MATK'], ['ATK da arma', 'watk'], ['MaxHP', 'MaxHP'], ['MaxMP', 'MaxMP'], ['Taxa crítica', 'CRIT'], ['CSPD', 'CSPD'], ['Precisão', 'HIT'], ['Esquiva', 'FLEE']].map(([l, k]) => numRow(l, ca.d[k], cb.d[k])).join('');
  const itemTxt = (s, withX) => { const it = DB.ITBYID.get(s.id); if (!it) return '<span class="muted">—</span>'; const xs = withX ? (s.x || []).map(id => DB.ITBYID.get(id)).filter(Boolean) : []; return '<a class="tl" href="' + itemUrl(it) + '">' + esc(it.name) + '</a>' + (s.r ? ' <b>' + REFS[s.r] + '</b>' : '') + (xs.length ? '<small>' + xs.map(x => esc(x.name)).join(' · ') + '</small>' : ''); };
  const equip = SLOTS.map(([k, lab]) => { const sa = ca.bd.sl[k], sb = cb.bd.sl[k], same = sa.id === sb.id && sa.r === sb.r && JSON.stringify(sa.x || []) === JSON.stringify(sb.x || []); return '<tr' + (same ? '' : ' class="chg"') + '><th scope="row">' + lab + '</th><td>' + itemTxt(sa, true) + '</td><td>' + itemTxt(sb, true) + '</td><td class="n ' + (same ? 'dz">igual' : 'up">diferente') + '</td></tr>'; }).join('');
  const regTxt = bd => (bd.rg || []).length ? (bd.rg || []).map(([n, lv]) => esc(n) + ' ' + lv).join('<br>') : '<span class="muted">—</span>';
  const regSame = JSON.stringify(ca.bd.rg || []) === JSON.stringify(cb.bd.rg || []);
  const regRow = '<tr' + (regSame ? '' : ' class="chg"') + '><th scope="row">Registlets</th><td>' + regTxt(ca.bd) + '</td><td>' + regTxt(cb.bd) + '</td><td class="n ' + (regSame ? 'dz">igual' : 'up">diferente') + '</td></tr>';
  const gemDiff = SKT ? SKT.flatMap(t => t.s.map(s => [t, s, ((A.sg || {})[t.k] || {})[s[0]] || 0, ((B.sg || {})[t.k] || {})[s[0]] || 0])).filter(x => x[2] !== x[3]) : [];
  const sp = c => SKT ? SKT.map(t => [t, t.s.reduce((a, s) => a + ((c.sk[t.k] || {})[s[0]] || 0), 0)]) : [];
  const spA = sp(A), spB = sp(B);
  const skillRows = SKT ? SKT.map((t, i) => [t, spA[i][1], spB[i][1]]).filter(x => x[1] || x[2]).map(([t, a, b]) => numRow(esc(skTreeName(t)), a, b, v => v + ' SP')).join('') : '<tr><td colspan="4" class="muted">Carregando as árvores…</td></tr>';
  const lvDiff = SKT ? SKT.flatMap(t => t.s.map(s => [t, s, (A.sk[t.k] || {})[s[0]] || 0, (B.sk[t.k] || {})[s[0]] || 0])).filter(x => x[2] !== x[3]) : [];
  const keys = new Set([...ca.tot.keys(), ...cb.tot.keys()].filter(k => (ca.tot.get(k) || 0) || (cb.tot.get(k) || 0)));
  const statRows = [...keys].sort((x, y) => DB.STATN[x].localeCompare(DB.STATN[y])).map(k => { const [nm] = sparts([k, 1, 0]); const pct = DB.STATN[k].includes('%'); const f = v => fmt(v) + (pct ? '%' : ''); return numRow(esc(nm), ca.tot.get(k) || 0, cb.tot.get(k) || 0, f); }).join('');
  view.innerHTML = '<section class="card"><h2>Comparar builds</h2><div class="calc"><div class="field"><label class="lbl" for="cmpa">Build A</label>' + sel('cmpa', CMPB.a) + '</div><div class="field"><label class="lbl" for="cmpb">Build B</label>' + sel('cmpb', CMPB.b) + '</div></div><p class="note">A coluna “Diferença” mostra quanto a Build B tem a mais (verde) ou a menos (vermelho) que a Build A.</p></section>'
    + '<div class="grid2"><div>'
    + '<section class="card"><h2>Status</h2><div class="tblw"><table class="tbl bcmp">' + head + '<tbody>' + status + '</tbody></table></div><h4 class="sub4">Estimativas</h4><div class="tblw"><table class="tbl bcmp">' + head + '<tbody>' + est + '</tbody></table></div></section>'
    + '<section class="card"><h2>Equipamento</h2><div class="tblw"><table class="tbl bcmp">' + head + '<tbody>' + equip + regRow + '</tbody></table></div></section>'
    + '</div><div>'
    + '<section class="card"><h2>Skills</h2><div class="tblw"><table class="tbl bcmp">' + head + '<tbody>' + (skillRows || '<tr><td colspan="4" class="muted">Nenhuma skill nas duas builds.</td></tr>') + '</tbody></table></div>'
    + (gemDiff.length ? '<h4 class="sub4">Star Gems diferentes</h4><div class="tblw"><table class="tbl bcmp">' + head + '<tbody>' + gemDiff.map(([t, s, a, b]) => numRow('★ ' + esc(s[1]) + '<small>' + esc(skTreeName(t)) + '</small>', a, b)).join('') + '</tbody></table></div>' : '')
    + (lvDiff.length ? '<h4 class="sub4">Skills com nível diferente</h4><div class="tblw"><table class="tbl bcmp">' + head + '<tbody>' + lvDiff.map(([t, s, a, b]) => numRow(esc(s[1]) + '<small>' + esc(skTreeName(t)) + '</small>', a, b)).join('') + '</tbody></table></div>' : '') + '</section>'
    + '<section class="card"><h2>Soma dos status dos equipamentos</h2>' + (statRows ? '<div class="tblw"><table class="tbl bcmp">' + head + '<tbody>' + statRows + '</tbody></table></div>' : '<p class="muted" style="margin:0">As duas builds estão sem equipamento.</p>') + '</section>'
    + '</div></div>';
  $('#cmpa').addEventListener('change', e => { CMPB.a = +e.target.value; if (CMPB.b === CMPB.a) CMPB.b = CMPB.a === 0 ? 1 : 0; viewChar('comparar'); });
  $('#cmpb').addEventListener('change', e => { CMPB.b = +e.target.value; if (CMPB.b === CMPB.a) CMPB.a = CMPB.b === 0 ? 1 : 0; viewChar('comparar'); });
}

// ---------- simulador de skills ----------
// Árvores, posições e pré-requisitos do simulador do coryn.club. Regra do jogo: cada skill vai até 10;
// para pôr ponto numa skill, a anterior precisa estar no 5; baixar uma skill para menos de 5 zera as que dependem dela.
let SKT = null;
const SKCAT = { Weapon: 'Arma', Buff: 'Buff', Assist: 'Assistência', Other: 'Outros' };
const SKS = { lv: store.get('skills', {}), gem: store.get('stargems', {}), edit: 'pt', open: new Set(), mode: 1, step: 1, plv: store.get('lv', 100) };
const skTreeName = t => t.n.replace(/^\w+:\s*/, '').replace(/\s*Skill$/, '');
const skCat = t => SKCAT[(t.n.match(/^(\w+):/) || [])[1]] || 'Outros';
const skLv = (k, id) => (SKS.lv[k] && SKS.lv[k][id]) || 0;
function skSet(k, id, v) { if (!SKS.lv[k]) SKS.lv[k] = {}; if (v > 0) SKS.lv[k][id] = v; else delete SKS.lv[k][id]; if (!Object.keys(SKS.lv[k]).length) delete SKS.lv[k]; }
function skAdd(t, id, num) {
  const s = t.s.find(x => x[0] === id); if (!s) return;
  skSet(t.k, id, Math.min(10, skLv(t.k, id) + num));
  if (s[2] >= 0 && skLv(t.k, s[2]) < 5) skAdd(t, s[2], 5 - skLv(t.k, s[2]));
}
function skRemove(t, id, num) {
  const v = Math.max(0, skLv(t.k, id) - num);
  skSet(t.k, id, v);
  if (v < 5) t.s.filter(c => c[2] === id && skLv(t.k, c[0]) > 0).forEach(c => skRemove(t, c[0], 10));
}
const skTreeSP = t => t.s.reduce((a, s) => a + skLv(t.k, s[0]), 0);
// Star Gem (como no Cy's Grimoire): nível 0 a 10 por skill, sem pré-requisito; o nível que vale é o maior entre o normal e o da Star Gem.
const skGem = (k, id) => (SKS.gem[k] && SKS.gem[k][id]) || 0;
function skSetGem(k, id, v) { v = Math.max(0, Math.min(10, v)); if (!SKS.gem[k]) SKS.gem[k] = {}; if (v > 0) SKS.gem[k][id] = v; else delete SKS.gem[k][id]; if (!Object.keys(SKS.gem[k]).length) delete SKS.gem[k]; }
const skTreeGem = t => t.s.reduce((a, s) => a + Math.max(0, skGem(t.k, s[0]) - skLv(t.k, s[0])), 0);
const skCode = () => b64e(Object.entries(SKS.lv).map(([k, o]) => k + ':' + Object.entries(o).map(([i, v]) => i + '.' + v).join(',')).join(';'));
function skDecode(code) { const o = {}; b64d(code).split(';').filter(Boolean).forEach(p => { const [k, rest] = p.split(':'); o[k] = {}; (rest || '').split(',').filter(Boolean).forEach(x => { const [i, v] = x.split('.'); if (+v > 0) o[k][+i] = Math.min(10, +v); }); }); return o; }
function viewSkills(code) {
  setTitle('Simulador de skills');
  if (!SKT) { view.innerHTML = '<p class="loading">Carregando as árvores de skill…</p>'; load('skills').then(d => { SKT = d.trees; viewChar('skills', code); }).catch(() => { view.innerHTML = '<p class="nojs">Não deu para carregar as skills. Recarregue a página.</p>'; }); return; }
  if (code) { try { SKS.lv = skDecode(code); store.set('skills', SKS.lv); } catch (e) {} history.replaceState(null, '', '#/personagem/skills'); }
  const cats = ['Arma', 'Buff', 'Assistência', 'Outros'];
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Simulador de skills</h1><p>Distribua os pontos nas árvores. A skill anterior sobe sozinha para o nível 5 quando precisa. A build fica salva neste aparelho e dá para compartilhar por link. No modo <b>ⓘ Info</b>, toque numa skill para ver o que ela faz, em português.</p></div></div>'
    + '<div class="sktool" id="sktool"></div>'
    + '<div class="grid2 skgrid"><div>' + cats.map(c => '<h2 class="sect">' + c + '</h2>' + SKT.filter(t => skCat(t) === c).map(t => '<section class="card sktree" data-k="' + t.k + '"><button type="button" class="skhead" data-open="' + t.k + '"><b>' + esc(skTreeName(t)) + '</b><span class="sksp" id="sp-' + t.k + '"></span><span class="skarrow">▸</span></button><div class="skbody" id="skb-' + t.k + '" hidden></div></section>').join('')).join('') + '</div>'
    + '<div><section class="card skpanel"><h2>Skills escolhidas</h2><div id="sksel"></div><div class="chips" style="margin-top:12px"><button class="btn" id="skshare" type="button">Copiar link da build</button><button class="btn ghost" id="skclear" type="button">Zerar tudo</button></div><p class="note" id="skmsg">Salvo automaticamente neste aparelho.</p></section></div></div>'
    + '<p class="note" style="color:var(--ink-2)">Árvores e pré-requisitos do simulador do coryn.club. Os nomes das skills ficam em inglês, como no jogo.</p>';
  SKS.open.forEach(k => openTree(k, true));
  skRefresh();
  view.addEventListener('click', skClick);
}
function skToolbar() {
  const used = SKT.reduce((a, t) => a + skTreeSP(t), 0), have = skillPts(SKS.plv), gems = SKT.reduce((a, t) => a + skTreeGem(t), 0);
  $('#sktool').innerHTML = '<div class="skstat"><span><small>Pontos usados</small><b>' + fmt(used) + '</b></span><span><small>Do nível</small><input id="skplv" type="number" inputmode="numeric" min="1" value="' + SKS.plv + '" aria-label="Seu nível"></span><span><small>' + (used > have ? 'Passou' : 'Sobram') + '</small><b class="' + (used > have ? 'neg' : '') + '">' + fmt(Math.abs(have - used)) + '</b></span><span><small>Star Gem</small><b>' + fmt(gems) + '</b></span></div>'
    + '<div class="skmode"><div class="seg2" role="group" aria-label="O que o toque muda"><button type="button" data-edit="pt" aria-pressed="' + (SKS.edit === 'pt') + '">Pontos</button><button type="button" data-edit="sg" aria-pressed="' + (SKS.edit === 'sg') + '">★ Star Gem</button><button type="button" data-edit="info" aria-pressed="' + (SKS.edit === 'info') + '">ⓘ Info</button></div><div class="seg2" role="group" aria-label="Tocar para"><button type="button" data-mode="1" aria-pressed="' + (SKS.mode > 0) + '">+ Somar</button><button type="button" data-mode="-1" aria-pressed="' + (SKS.mode < 0) + '">− Tirar</button></div>'
    + '<div class="seg2" role="group" aria-label="Quanto por toque"><button type="button" data-step="1" aria-pressed="' + (SKS.step === 1) + '">1</button><button type="button" data-step="5" aria-pressed="' + (SKS.step === 5) + '">5</button><button type="button" data-step="10" aria-pressed="' + (SKS.step === 10) + '">Máx</button></div></div>';
  $('#skplv').addEventListener('change', e => { SKS.plv = Math.max(1, +e.target.value || 1); store.set('lv', SKS.plv); skToolbar(); });
}
const SK_CW = 86, SK_CH = 40, SK_PAD = 46;
// Ícones das skills (do coryn.club, guardados no site). Fora do GitHub Pages (ex.: no artifact), vêm do site publicado.
const SKIMG = /github\.io$|localhost$/.test(location.hostname) ? 'img/skills/' : 'https://dgoffim.github.io/Bestiario-Toram/img/skills/';
function treeHtml(t) {
  const X = Math.max(...t.s.map(s => s[3])), Y = Math.max(...t.s.map(s => s[4]));
  const w = X * SK_CW + SK_PAD * 2, h = Y * SK_CH + SK_PAD * 2 + 10;
  const P = (x, y) => (x * SK_CW + SK_PAD) + ',' + (y * SK_CH + SK_PAD);
  const lines = t.s.filter(s => s[2] >= 0).map(s => {
    const p = t.s.find(x => x[0] === s[2]); if (!p) return '';
    const on = Math.max(skLv(t.k, s[0]), skGem(t.k, s[0])) > 0;
    const pts = s[5] === -1 ? [P(s[3], s[4]), P((s[3] + p[3]) / 2, s[4]), P((s[3] + p[3]) / 2, p[4]), P(p[3], p[4])] : [P(s[3], s[4]), P(s[5], s[6]), P(p[3], p[4])];
    return '<polyline points="' + pts.join(' ') + '" class="' + (on ? 'on' : '') + '"/>';
  }).join('');
  const nodes = t.s.map(s => { const v = skLv(t.k, s[0]), gm = skGem(t.k, s[0]), ef = Math.max(v, gm); return '<button type="button" class="sknode' + (ef ? ' on' : '') + (ef === 10 ? ' max' : '') + (gm ? ' gem' : '') + '" data-t="' + t.k + '" data-id="' + s[0] + '" style="left:' + (s[3] * SK_CW + SK_PAD) + 'px;top:' + (s[4] * SK_CH + SK_PAD) + 'px" aria-label="' + esc(s[1]) + ', nível ' + v + '"><i' + (s[7] ? ' class="ic" style="background-image:url(' + SKIMG + s[7] + ')"' : '') + '>' + (s[7] ? '<b>' + v + '</b>' : v) + (gm ? '<u title="Star Gem">★' + gm + '</u>' : '') + '</i><span>' + esc(s[1]) + '</span></button>'; }).join('');
  return '<div class="skbar"><span class="muted">' + skTreeSP(t) + ' pontos nesta árvore<span class="skhint"> · arraste para o lado</span></span><button type="button" class="link" data-reset="' + t.k + '">Zerar árvore</button></div><div class="skscroll"><div class="skcanvas" style="width:' + w + 'px;height:' + h + 'px"><svg width="' + w + '" height="' + h + '" aria-hidden="true">' + lines + '</svg>' + nodes + '</div></div>';
}
function openTree(k, on) {
  const b = $('#skb-' + k); if (!b) return;
  const t = SKT.find(x => x.k === k);
  b.hidden = !on; b.closest('.sktree').classList.toggle('open', on);
  if (on) { SKS.open.add(k); b.innerHTML = treeHtml(t); } else SKS.open.delete(k);
}
function skRefresh(onlyTree) {
  store.set('skills', SKS.lv); store.set('stargems', SKS.gem); syncChar();
  skToolbar();
  SKT.forEach(t => { const sp = skTreeSP(t); const el = $('#sp-' + t.k); if (el) el.textContent = sp ? sp + ' SP' : ''; });
  if (onlyTree) { const b = $('#skb-' + onlyTree); if (b && !b.hidden) b.innerHTML = treeHtml(SKT.find(x => x.k === onlyTree)); }
  const sel = SKT.filter(t => skTreeSP(t) > 0 || t.s.some(s => skGem(t.k, s[0])));
  $('#sksel').innerHTML = sel.length ? sel.map(t => '<div class="dgroup"><span class="lbl">' + esc(skTreeName(t)) + ' · ' + skTreeSP(t) + ' SP' + (skTreeGem(t) ? ' · ★ ' + skTreeGem(t) : '') + '</span><div class="links">' + t.s.filter(s => skLv(t.k, s[0]) > 0 || skGem(t.k, s[0]) > 0).map(s => '<span class="lk">' + esc(s[1]) + ' <small>' + skLv(t.k, s[0]) + (skGem(t.k, s[0]) ? ' · ★' + skGem(t.k, s[0]) : '') + '</small></span>').join('') + '</div></div>').join('')
    : '<p class="muted" style="margin:0">Nenhuma skill ainda. Abra uma árvore e toque nas skills.</p>';
}
function skClick(e) {
  if (!document.getElementById('sktool')) return;
  const o = e.target.closest('[data-open]'); if (o) { const k = o.dataset.open; openTree(k, !SKS.open.has(k)); return; }
  const n = e.target.closest('.sknode');
  if (n) { const t = SKT.find(x => x.k === n.dataset.t), id = +n.dataset.id; if (SKS.edit === 'info') { skInfo(t, t.s.find(x => x[0] === id)); return; } if (SKS.edit === 'sg') skSetGem(t.k, id, skGem(t.k, id) + SKS.mode * SKS.step); else SKS.mode > 0 ? skAdd(t, id, SKS.step) : skRemove(t, id, SKS.step); skRefresh(t.k); return; }
  const ed = e.target.closest('[data-edit]'); if (ed) { SKS.edit = ed.dataset.edit; skToolbar(); return; }
  const r = e.target.closest('[data-reset]'); if (r) { delete SKS.lv[r.dataset.reset]; delete SKS.gem[r.dataset.reset]; skRefresh(r.dataset.reset); return; }
  const m = e.target.closest('[data-mode]'); if (m) { SKS.mode = +m.dataset.mode; skToolbar(); return; }
  const s = e.target.closest('[data-step]'); if (s) { SKS.step = +s.dataset.step; skToolbar(); return; }
  if (e.target.closest('#skshare')) {
    const url = location.href.split('#')[0] + '#/skills/' + skCode();
    const done = () => { $('#skmsg').textContent = 'Link copiado! Cole no grupo para mostrar a build.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => { fallbackCopy(url); done(); }); else { fallbackCopy(url); done(); }
    return;
  }
  if (e.target.closest('#skclear')) { if (confirm('Zerar todas as árvores?')) { SKS.lv = {}; SKS.open.forEach(k => openTree(k, true)); skRefresh(); } }
}

// ---------- informações das skills ----------
// Dados da planilha do Cy's Grimoire (fórmulas por nível da skill), com os textos traduzidos do chinês.
let SKI = null;
const SKI_TYPE = { instant: 'Instantânea', casting: 'Com conjuração', charging: 'Com carga', passive: 'Passiva', extra: 'Especial' };
const SKI_ACT = { very_fast: 'Muito rápida', fast: 'Rápida', little_fast: 'Um pouco rápida', normal: 'Normal', little_slow: 'Um pouco lenta', slow: 'Lenta', very_slow: 'Muito lenta' };
const SKI_EL = { neutral: 'Neutro', fire: 'Fogo', water: 'Água', earth: 'Terra', wind: 'Vento', light: 'Luz', dark: 'Trevas', against: 'Elemento fraco do alvo' };
const SKI_PRO = { physical: 'Física', magic: 'Mágica', normal_attack: 'De ataque normal', none: 'Nenhuma' };
const SKI_GRP = { effect: 'Efeito', passive: 'Passiva', next: 'Próxima skill', extra: 'Extra', heal: 'Cura' };
const SKI_ST = { critical_rate: 'Crítico', critical_damage: 'Dano crítico', critical_damage_skill: 'Dano crítico da skill', physical_pierce: 'Penetração física', magic_pierce: 'Penetração mágica', attack_mp_recovery: 'MP por ataque', atk: 'ATK', matk: 'MATK', def: 'DEF', mdef: 'MDEF', accuracy: 'Precisão', dodge: 'Esquiva', aspd: 'ASPD', cspd: 'CSPD', weapon_atk: 'ATK da arma', weapon_base_atk: 'ATK base da arma', max_hp: 'HP máximo', max_mp: 'MP máximo', agi: 'AGI', motion_speed: 'Velocidade de ação', movement_speed: 'Velocidade de movimento', stability: 'Estabilidade', stability_magic: 'Estabilidade mágica', stability_main: 'Estabilidade', physical_resistance: 'Resistência física', magic_resistance: 'Resistência mágica', dark_resistance: 'Resistência a Trevas', light_resistance: 'Resistência a Luz', aggro: 'Aggro', short_range_damage: 'Bônus de curta distância', long_range_damage: 'Bônus de longa distância', unsheathe_attack_multiplier: 'Dano de desembainhar', normal_attack_multiplier: 'Multiplicador do ataque normal', normal_attack_constant: 'Constante do ataque normal', skill_constant_extra: 'Constante extra', skill_multiplier_extra: 'Multiplicador extra', total_skill_multiplier: 'Multiplicador total', total_damage_A: 'Dano total', total_damage_B: 'Dano total', guard_regenerate: 'Recuperação de guarda', base_guard_regenerate: 'Recuperação de guarda base', guard_power: 'Força de guarda', base_guard_power: 'Força de guarda base', evasion_regenerate: 'Recuperação de esquiva', base_evasion_regenerate: 'Recuperação de esquiva base', evasion_count: 'Esquivas', natural_hp_regen_s: 'Regeneração de HP', natural_hp_regen_b: 'Regeneração de HP', natural_mp_regen_s: 'Regeneração de MP', natural_mp_regen_b: 'Regeneração de MP', natural_mp_regen: 'Regeneração de MP', exp_rate: 'EXP', drop_rate: 'Drop', physical_barrier: 'Barreira física', magical_barrier: 'Barreira mágica', graze_penalty_mitigation: 'Atenuação de Graze', ailment_resistance: 'Resistência a status', ailment_avoid: 'Esquiva de status', ailment_chance: 'Chance de status', additional_magic: 'Ataque extra mágico', additional_meele: 'Ataque extra físico', absolute_accuracy: 'Acerto absoluto', revive_time: 'Tempo para reviver', def_ignore: 'Ignora DEF', magic_critical_rate_conversion_rate: 'Conversão de crítico mágico', magic_critical_damage_conversion_rate: 'Conversão de dano crítico mágico', stronger_against_neutral: 'Dano contra Neutro', stronger_against_fire: 'Dano contra Fogo', stronger_against_water: 'Dano contra Água', stronger_against_earth: 'Dano contra Terra', stronger_against_wind: 'Dano contra Vento', stronger_against_light: 'Dano contra Luz', stronger_against_dark: 'Dano contra Trevas', stronger_against_weaker_element: 'Dano contra elemento fraco', magic_stronger_against_element: 'Dano mágico contra elementos', constant: 'Valor constante', extra_value: 'Multiplicador', radius: 'Raio (m)', cycle: 'Intervalo (s)', frequency: 'Vezes', mp_cost: 'MP', multiplier: 'Multiplicador', critical: 'Crítico' };
// Contexto das fórmulas: nível da skill, cargas e status da build em uso.
function skiCtx(slv, stacks) {
  const c = { SLv: slv, stack: stacks, base: Object.assign({ STR: 1, INT: 1, VIT: 1, AGI: 1, DEX: 1 }, BD.st), tot: {}, lv: BD.lv || 1 };
  try { const d = buildDerived(buildTotals().tot); ['STR', 'INT', 'VIT', 'AGI', 'DEX'].forEach(k => { c.tot[k] = d[k]; }); } catch (e) { Object.assign(c.tot, c.base); }
  c.pers = BD.ps ? { [BD.ps]: BD.pv || 0 } : {};
  c.shield = (BD.sl && BD.sl.sub && BD.sl.sub.r) || 0;
  return c;
}
const SKI_FN = new Map();
// Avalia uma fórmula do Cy. Só aceita números, operadores, Math.* e as variáveis conhecidas; o resto volta como texto.
function skiEval(f, c) {
  if (f == null || f === '') return null;
  f = String(f).trim();
  if (/^-?\d+(\.\d+)?$/.test(f)) return +f;
  const src = f.replace(/\$(B?)(STR|INT|VIT|AGI|DEX)\b/g, (m, b, s) => (b ? c.base[s] : c.tot[s]) || 0)
    .replace(/\$shield_refining\b/g, c.shield).replace(/\bCLv\b/g, c.lv)
    .replace(/\$?\b(LUK|TEC|CRT|MEN)\b/g, (m, s) => c.pers[s] || 0);
  if (src.replace(/Math\.(floor|ceil|min|max|round|abs|pow|sqrt)|SLv|stack/g, '').replace(/[\d\s+\-*/%().,<>=?:[\]]/g, '') !== '') return null;
  let fn = SKI_FN.get(src);
  if (!fn) { try { fn = new Function('SLv', 'stack', 'return (' + src + ');'); } catch (e) { fn = () => null; } SKI_FN.set(src, fn); }
  const st = Object.assign(new Number(c.stack[0] || 0), c.stack);
  try { const v = fn(c.SLv, st); return typeof v === 'number' && isFinite(v) ? v : null; } catch (e) { return null; }
}
const skiNum = v => fmt(Math.round(v * 100) / 100);
const skiPretty = f => esc(String(f).replace(/Math\.floor/g, 'arred.').replace(/Math\.(min|max)/g, (m, x) => x === 'min' ? 'mín' : 'máx').replace(/\*/g, '×').replace(/\bSLv\b/g, 'Lv').replace(/\$B(STR|INT|VIT|AGI|DEX)/g, '$1 base').replace(/\$(STR|INT|VIT|AGI|DEX)/g, '$1').replace(/stack/g, 'cargas'));
const skiVal = (f, c, unit = '') => { const v = skiEval(f, c); return v == null ? '<code>' + skiPretty(f) + '</code>' : skiNum(v) + unit; };
// Texto do Cy: ${fórmula}, ((fórmula em destaque)), ![termo], !B[buff], !S[skill], #[glossário], <br> e " / " como quebra de linha.
function skiTxt(s, c) {
  if (!s) return '';
  const parts = String(s).split(/\$\{([^{}]*)\}/);
  return parts.map((p, i) => {
    if (i % 2) return '<b>' + skiVal(p, c) + '</b>';
    return esc(p).replace(/&lt;br&gt;/g, '<br>').replace(/ \/ /g, '<br>')
      .replace(/\(\((.+?)\)\)/g, (m, x) => '<code>' + x.replace(/\*/g, '×') + '</code>')
      .replace(/!S\[([^\]]+)\]/g, '<b class="skref">$1</b>').replace(/[!#]B?\[([^\]]+)\]/g, '<b>$1</b>');
  }).join('');
}
function skiRows(rows) { return rows.filter(r => r && r[1] !== '' && r[1] != null).map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join(''); }
function skiBody(t, s, info, c) {
  const range = r => { r = String(r).trim(); return r === 'main' ? 'Alcance da arma' : r === 'no_limit' || +r >= 100 ? 'Sem limite' : skiVal(r, c, ' m'); };
  const combo = { '1': 'Sim', '0': 'Não', not_lead: 'Sim, mas não abre combo' };
  let h = '<dl class="skidl">' + skiRows([
    ['MP', info.mp_cost != null ? skiVal(info.mp_cost, c) : ''], ['Alcance', info.range ? range(info.range) : ''],
    ['Tipo', SKI_TYPE[info.skill_type] || ''], ['Animação', SKI_ACT[info.action_time] || ''],
    ['Conjuração', info.casting_time ? skiVal(info.casting_time, c, ' s') : ''], ['Em combo', info.in_combo != null ? combo[info.in_combo] || '' : '']]) + '</dl>';
  (info.tx || []).forEach(x => { h += '<p>' + skiTxt(x, c) + '</p>'; });
  (info.d || []).forEach(d => {
    const kind = d.damage_type || (d.k === 'physical' || d.k === 'magic' ? d.k : '');
    h += '<div class="skiblk"><h4>' + (d.n ? esc(d.n) : 'Dano') + '</h4><dl class="skidl">' + skiRows([
      ['Tipo', kind ? (kind === 'magic' ? 'Mágico' : 'Físico') : ''], ['Inércia', SKI_PRO[d.k] || ''],
      ['Constante', d.constant != null ? skiVal(d.constant, c) : ''], ['Multiplicador', d.multiplier != null ? skiVal(d.multiplier, c, '%') : ''],
      ['Hits', d.frequency ? skiVal(d.frequency, c) + (d.title === 'each' ? ' (valores por hit)' : '') : ''],
      ['Elemento', SKI_EL[d.element] || ''], ['Status', d.ail ? esc(d.ail) + (d.ailment_chance ? ' · ' + skiVal(d.ailment_chance, c, '%') : '') : ''],
      ['Área', d.type === 'AOE' ? 'Sim' + (d.radius ? ', raio ' + skiVal(d.radius, c, ' m') : '') : ''],
      ['Duração', d.duration ? skiVal(d.duration, c, ' s') : ''], ['Desembainhar', d.unsheathe_damage === '1' ? 'Recebe o bônus' : '']]) + '</dl></div>';
  });
  (info.e || []).forEach(e => {
    const st = (e.st || []).filter(x => SKI_ST[x[0]] && !/\./.test(x[0]));
    let body = '';
    if (e.g === 'heal') {
      const g = k => (e.st || []).find(x => x[0] === k);
      const cn = g('constant'), ev = g('extra_value');
      body += skiRows([['Cura', (cn ? skiVal(cn[1], c) : '') + (ev ? (cn ? ' + ' : '') + skiVal(ev[1], c) + ' × ' + esc(e.extra_text || '') : '')],
        ['Vezes', g('frequency') ? skiVal(g('frequency')[1], c) : ''], ['A cada', g('cycle') ? skiVal(g('cycle')[1], c, ' s') : '']]);
    } else {
      body += skiRows(st.map(([k, v, u]) => { const n = skiEval(v, c); return [SKI_ST[k], n == null ? '<code>' + skiPretty(v) + '</code>' : (n > 0 && k !== 'radius' && k !== 'cycle' ? '+' : '') + skiNum(n) + (u === '%' ? '%' : '')]; }));
    }
    body += skiRows([['Quando', e.condition ? skiTxt(e.condition, c) : ''], ['Até', e.end_condition ? skiTxt(e.end_condition, c) : ''], ['Duração', e.duration ? skiVal(e.duration, c, ' s') : '']]);
    if (!body && !e.caption) return;
    h += '<div class="skiblk"><h4>' + (e.name ? esc(e.name) : SKI_GRP[e.g] || 'Efeito') + '</h4>' + (e.caption ? '<p>' + skiTxt(e.caption, c) + '</p>' : '') + (body ? '<dl class="skidl">' + body + '</dl>' : '') + '</div>';
  });
  (info.v || []).forEach(v => {
    const [wm, ws] = v.w.split('|');
    const w = wm && ws && wm !== ws ? wm + ' + ' + ws + ' na secundária' : wm || (ws ? ws + ' na secundária' : '');
    if (!w) return;
    const rows = v.ch.filter(x => SKI_ST[x[1]]).map(([b, k, val]) => [SKI_ST[k], skiVal(val, c, k === 'multiplier' || k === 'ailment_chance' ? '%' : '')]);
    if (rows.length) h += '<div class="skiblk"><h4>Com ' + esc(w) + '</h4><dl class="skidl">' + skiRows(rows) + '</dl></div>';
  });
  if ((info.nt || []).length) h += '<div class="skiblk"><h4>Observações</h4><ul class="skinotes">' + info.nt.map(x => '<li>' + skiTxt(x, c) + '</li>').join('') + '</ul></div>';
  return h;
}
function skInfo(t, s) {
  if (!SKI) { load('skillinfo').then(d => { SKI = d; skInfo(t, s); }).catch(() => alert('Não deu para carregar as informações das skills.')); return; }
  let box = $('#skinfo');
  if (!box) { view.insertAdjacentHTML('beforeend', '<div class="picker" id="skinfo" hidden><div class="pbox"><div class="phead skihead"></div><div class="plist skibody"></div></div></div>'); box = $('#skinfo'); box.addEventListener('click', e => { if (e.target.id === 'skinfo' || e.target.closest('#skiclose')) box.hidden = true; }); }
  const info = SKI[t.k + '/' + s[0]];
  const st = { lv: Math.max(skLv(t.k, s[0]), skGem(t.k, s[0])) || 10, sk: info && info.sk ? info.sk.map(x => +(x[1] != null ? x[1] : x[2]) || 0) : [] };
  const draw = () => {
    const c = skiCtx(st.lv, st.sk);
    box.querySelector('.skihead').innerHTML = (s[7] ? '<i class="skiic" style="background-image:url(' + SKIMG + s[7] + ')"></i>' : '') + '<div class="skititle"><b>' + esc(s[1]) + '</b><small>' + esc(skTreeName(t)) + '</small></div>'
      + '<label class="skilv">Lv <select id="skilv">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => '<option' + (n === st.lv ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label><button class="btn ghost" id="skiclose" type="button">Fechar</button>';
    box.querySelector('.skibody').innerHTML = info
      ? (info.sk ? '<div class="skistk">' + info.sk.map((x, i) => { const mx = skiEval(x[3], c); return '<label>' + esc(x[0]) + (x[4] ? ' (' + esc(x[4]) + ')' : '') + '<input type="number" inputmode="numeric" data-sk="' + i + '" value="' + st.sk[i] + '" min="' + (+x[2] || 0) + '"' + (mx != null ? ' max="' + mx + '"' : '') + '></label>'; }).join('') + '</div>' : '')
        + skiBody(t, s, info, c) + '<p class="note">Valores no Lv ' + st.lv + ' da skill, com os status da build em uso. Dados do Cy\'s Grimoire, traduzidos.</p>'
      : '<p class="muted">Ainda não temos as informações desta skill.</p>';
  };
  box.onchange = e => {
    if (e.target.id === 'skilv') { st.lv = +e.target.value; draw(); }
    else if (e.target.dataset.sk != null) { st.sk[+e.target.dataset.sk] = +e.target.value || 0; const y = box.querySelector('.skibody').scrollTop; draw(); box.querySelector('.skibody').scrollTop = y; }
  };
  draw(); box.hidden = false; box.querySelector('.skibody').scrollTop = 0;
}

// ---------- simulador de statting ----------
// Fórmulas e tabelas do simulador de statting do coryn.club (statting_simulator_v4_1.js):
// custo de potencial por status, penalidade por categoria repetida, materiais e taxa de sucesso = 160 + 230 × pot. restante ÷ pot.
const SMAX = 8, SCTR_LIMIT = 20, SMATS = ['', 'Beast', 'Wood', 'Metal', 'Cloth', 'Medicine', 'Mana'];
let SDATA = null, SSTAT = null, SF = null;
const SSET = store.get('statset', { type: '8', eq: '', pot: 0, ori: 0, me: '0', prof: 0, lv: store.get('lv', 300) });
const sStat = id => SSTAT.get(+id);
// stat: [id, nome, material, pot, mat_base, cheap_limit, mult, mult2, categoria, tipo, aceita negativo]
function sCtr(val, sid) {
  if (!val || !sid) return 0;
  const s = sStat(sid); let minus = 1; if (val < 0) { val = -val; minus = -1; }
  if (val <= s[5]) return val / s[6] * minus;
  let r = s[5] / s[6]; val -= s[5]; if (s[7]) r += val / s[7];
  return r * minus;
}
function sMats(oldC, newC, sid) {
  const base = sStat(sid)[4], red = Math.min(1, Math.max(0, (Math.floor(SSET.prof / 10) + Math.floor(SSET.prof / 50)) / 100)), mod = 1 - red;
  let tot = 0;
  if (oldC < newC) for (let i = oldC; i < newC; i++) { const m = Math.max(Math.abs(i), Math.abs(i + 1)); tot += Math.trunc(base * m * m * mod); }
  else if (oldC > newC) for (let i = oldC; i > newC; i--) { const m = Math.max(Math.abs(i), Math.abs(i - 1)); tot += Math.trunc(base * m * m * mod); }
  return tot;
}
function sLimit(sid, dir) {
  const MAXONLY = ['MaxMP', 'Critical Rate', 'Critical Rate %', 'Aggro %', 'Guard Power %', 'Guard Recharge %', 'Evasion Recharge %'];
  const HALF = ['Natural MP Regen', 'ATK %', 'MaxMP', 'MATK %', 'Aggro %'];
  const THIRD = ['MaxHP %', 'DEF %', 'MDEF %', 'Physical Resistance %', 'Magic Resistance %', 'Critical Damage', '% stronger against Fire', '% stronger against Wind', '% stronger against Water', '% stronger against Earth', '% stronger against Light', '% stronger against Dark'];
  const HALF_THIRD = ['Accuracy', 'Dodge', 'Fire resistance %', 'Earth resistance %', 'Water resistance %', 'Wind resistance %', 'Light resistance %', 'Dark resistance %'];
  const TWENTY5 = ['Physical Pierce %', 'Magic Pierce %'];
  const SIXTY = ['Stability %', 'Accuracy %', 'Dodge %', 'ASPD %', 'CSPD %', 'Critical Damage %', 'Ailment Resistance %', 'Guard Power %', 'Guard Recharge %', 'Evasion Recharge %'];
  let lvMax = Math.floor(SSET.lv / 10); if (lvMax < 0) lvMax = 1;
  let bonus = Math.max(0, lvMax - 20);
  const s = sStat(sid), n = s[1];
  let baseMax = s[5] / s[6];
  if (!s[7]) bonus = 0;
  if (HALF.includes(n)) bonus = Math.floor(bonus / 2);
  if (THIRD.includes(n)) bonus = Math.floor(bonus / 3);
  if (SIXTY.includes(n)) bonus = Math.floor(bonus / 6);
  if (HALF_THIRD.includes(n)) bonus = Math.floor(bonus * 2 / 3);
  if (TWENTY5.includes(n)) bonus = Math.floor(bonus * 2 / 5);
  if (n.startsWith('Reduce Dmg (')) baseMax = 0;
  if (MAXONLY.includes(n) && dir < 0) bonus = 0;
  let total = baseMax + bonus; if (lvMax < total) total = lvMax;
  return dir * total;
}
class SFormula {
  constructor(type, pot, ori, me) {
    Object.assign(this, { type, potential: pot, original: ori, starting: pot, me, penalty: 100, steps: [], log: [], highest: 0, rate: 100, useOri: 0, done: false, lastDelta: [], lastRepeat: 0 });
    this.stat = Array(SMAX).fill(0); this.val = Array(SMAX).fill(0); this.ctr = Array(SMAX).fill(0); this.mat = [0, 0, 0, 0, 0, 0, 0];
  }
  successRate(d) {
    if (this.potential >= this.original) return Math.trunc(160 + 230 * (this.potential + Math.trunc(d)) / this.potential);
    this.useOri = 1; return Math.trunc(160 + 230 * (this.potential + Math.trunc(d)) / this.original);
  }
  penaltyOf(arr) { let p = 100, prev = '', c = 1; arr.sort().forEach(x => { if (x !== prev) { prev = x; if (c > 1) p += 5 * c * c; c = 1; } else c++; }); if (c > 1) p += 5 * c * c; return p; }
  potCost(sid, start, end, pen) {
    start = sCtr(start, sid); end = sCtr(end, sid);
    const s = sStat(sid), soft = [SCTR_LIMIT, 100 / s[3], s[5] / s[6]].sort((a, b) => a - b)[0];
    let out = 0, diff; const [mn, mx] = [start, end].sort((a, b) => a - b);
    diff = mx - mn;
    if (Math.abs(mn) > soft) { const c = Math.abs(mn) - soft; out += c; diff -= c; }
    if (Math.abs(mx) > soft) { const c = Math.abs(mx) - soft; out += c; diff -= c; }
    if (diff < 0) { out += diff; diff = 0; }
    let mult = 1;
    if ((s[9] === 'A' && this.type === 'W') || (s[9] === 'W' && this.type === 'A')) mult *= 2;
    if (s[9] === 'E' && this.me === '1') mult /= 10;
    let base, nega = 1;
    if (start > end) base = (30500 * diff + 2 * 7625 * out) * s[3];
    else { base = (100000 * diff + 200000 * out) * s[3]; nega = -1; }
    return Math.floor(base * mult / 100000) * nega * pen;
  }
  preview(nStat, nVal) {
    const nCtr = nVal.map((v, i) => sCtr(v, nStat[i]));
    const pen = this.penaltyOf(nStat.filter(Boolean).map(id => sStat(id)[8]));
    let d = 0; const info = [];
    for (let i = 0; i < SMAX; i++) {
      if (!nStat[i]) { info.push(null); continue; }
      d += this.potCost(nStat[i], this.val[i], nVal[i], pen);
      info.push({ delta: nVal[i] - this.val[i], mats: sMats(this.ctr[i], nCtr[i], nStat[i]), mat: SMATS[sStat(nStat[i])[2]] });
    }
    d /= 100;
    return { pot: this.potential + Math.trunc(d), rate: Math.max(0, Math.min(100, this.successRate(d))), info };
  }
  add(nStat, nVal) {
    if (this.done) return false;
    const nCtr = nVal.map((v, i) => sCtr(v, nStat[i]));
    const delta = nCtr.map((c, i) => c - this.ctr[i]);
    if (!delta.some(x => x)) return false;
    for (let i = 0; i < SMAX; i++) if (this.stat[i] !== nStat[i]) this.stat[i] = nStat[i];
    this.penalty = this.penaltyOf(this.stat.filter(Boolean).map(id => sStat(id)[8]));
    const dm = [0, 0, 0, 0, 0, 0, 0], parts = [];
    let d = 0;
    for (let i = 0; i < SMAX; i++) {
      if (!nStat[i]) continue;
      const m = sMats(this.ctr[i], nCtr[i], nStat[i]), ds = nVal[i] - this.val[i];
      d += this.potCost(nStat[i], this.val[i], nVal[i], this.penalty);
      if (ds) parts.push([sStat(nStat[i])[1], ds]);
      this.val[i] = nVal[i]; this.ctr[i] = nCtr[i];
      dm[sStat(nStat[i])[2]] += m;
    }
    d /= 100;
    for (let i = 1; i <= 6; i++) { if (dm[i] > this.highest) this.highest = dm[i]; this.mat[i] += dm[i]; }
    this.rate = Math.max(0, Math.min(100, this.successRate(d)));
    this.potential += Math.trunc(d);
    if (parts.length) {
      this.steps.push([nStat.slice(), nVal.slice()]);
      if (JSON.stringify(delta) === JSON.stringify(this.lastDelta)) { this.lastRepeat++; this.log[this.log.length - 1].n = this.lastRepeat; }
      else { this.lastDelta = delta; this.lastRepeat = 1; this.log.push({ parts, n: 1 }); }
    }
    if (this.potential <= 0 || this.stat.filter(Boolean).length === SMAX) this.done = true;
    return true;
  }
}
function sReplay(steps) { const f = new SFormula(SF.type, SF.starting, SF.original, SF.me); steps.forEach(([s, v]) => f.add(s, v)); return f; }
let SCUR = null; // valores em edição (ainda não confirmados)
function sStart() { SF = new SFormula(SSET.type === '8' ? 'A' : 'W', +SSET.pot, +SSET.ori, SSET.type === '8' ? '0' : SSET.me); SCUR = { stat: Array(SMAX).fill(0), val: Array(SMAX).fill(0) }; sSave(); }
function sSave() { store.set('statset', SSET); store.set('statsteps', SF ? { t: SF.type, p: SF.starting, o: SF.original, m: SF.me, s: SF.steps } : null); }
function sStep(i, dir) {
  const sid = SCUR.stat[i]; if (!sid) return false;
  const s = sStat(sid), cur = SCUR.val[i], c = sCtr(cur, sid), lim = s[5] / s[6];
  if (dir > 0) {
    if (c + 1 > sLimit(sid, 1)) return false;
    SCUR.val[i] = cur + (c < lim && c >= -lim ? s[6] : s[7]); return true;
  }
  if (c - 1 < sLimit(sid, -1)) return false;
  if (cur === 0 && !s[10]) return false;
  SCUR.val[i] = cur - (c <= lim && c > -lim ? s[6] : s[7]); return true;
}
function viewStatting(code) {
  setTitle('Simulador de statting');
  if (!SDATA) { view.innerHTML = '<p class="loading">Carregando o simulador…</p>'; load('statting').then(d => { SDATA = d; SSTAT = new Map(d.stats.map(s => [s[0], s])); viewStatting(code); }).catch(() => { view.innerHTML = '<p class="nojs">Não deu para carregar o simulador. Recarregue a página.</p>'; }); return; }
  if (code) { try { const o = JSON.parse(b64d(code)); Object.assign(SSET, o.set); SF = new SFormula(o.f.t, o.f.p, o.f.o, o.f.m); o.f.s.forEach(([s, v]) => SF.add(s, v)); SCUR = { stat: SF.stat.slice(), val: SF.val.slice() }; sSave(); } catch (e) {} history.replaceState(null, '', '#/statting'); }
  if (!SF) { const sv = store.get('statsteps', null); if (sv) { try { SF = new SFormula(sv.t, sv.p, sv.o, sv.m); sv.s.forEach(([s, v]) => SF.add(s, v)); SCUR = { stat: SF.stat.slice(), val: SF.val.slice() }; } catch (e) { SF = null; } } }
  const tlist = SDATA.types;
  if (!tlist.some(t => t[0] === SSET.type)) SSET.type = tlist[0][0];
  const eqs = () => (tlist.find(t => t[0] === SSET.type) || tlist[0])[2];
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Simulador de statting</h1><p>Monte a fórmula passo a passo e veja o potencial, a taxa de sucesso e os materiais antes de gastar no jogo.</p></div></div>'
    + '<div class="grid2"><div>'
    + '<section class="card"><h2>Equipamento</h2><div class="calc">'
    + '<div class="field"><label class="lbl" for="sttype">Tipo</label><select id="sttype">' + tlist.map(t => '<option value="' + t[0] + '"' + (t[0] === SSET.type ? ' selected' : '') + '>' + esc(t[1]) + '</option>').join('') + '</select></div>'
    + '<div class="field"><label class="lbl" for="steq">Equipamento</label><select id="steq"></select></div>'
    + '<div class="field"><label class="lbl" for="stpot">Potencial atual</label><input id="stpot" type="number" inputmode="numeric" value="' + SSET.pot + '"></div>'
    + '<div class="field"><label class="lbl" for="stori">Potencial original</label><input id="stori" type="number" inputmode="numeric" value="' + SSET.ori + '"></div>'
    + '<div class="field"><label class="lbl" for="stme">Elemento igual ao da arma</label><select id="stme"><option value="0"' + (SSET.me === '0' ? ' selected' : '') + '>Não</option><option value="1"' + (SSET.me === '1' ? ' selected' : '') + '>Sim</option></select></div>'
    + '<div class="field"><label class="lbl" for="stprof">Proficiência de smith</label><input id="stprof" type="number" inputmode="numeric" min="0" value="' + SSET.prof + '"></div>'
    + '<div class="field"><label class="lbl" for="stlv">Nível do personagem</label><input id="stlv" type="number" inputmode="numeric" min="10" value="' + SSET.lv + '"></div>'
    + '<div class="field"><span class="lbl">&nbsp;</span><button class="btn" id="ststart" type="button">' + (SF ? 'Recomeçar' : 'Começar') + '</button></div>'
    + '</div><p class="note">O potencial original é o da receita; o atual é o que o item tem agora (com Careful e Expert\'s Creation). A proficiência reduz os materiais e o nível define até onde cada status pode ir.</p></section>'
    + '<section class="card" id="stsim"></section></div>'
    + '<div><section class="card" id="ststeps"></section></div></div>'
    + '<p class="note" style="color:var(--ink-2)">Fórmulas e tabelas do simulador de statting do coryn.club. Os nomes dos status ficam em inglês, como no jogo.</p>';
  const fillEq = () => { $('#steq').innerHTML = '<option value="">Escolher (ou digite o potencial)</option>' + eqs().map(e => '<option value="' + e[0] + '"' + (String(e[0]) === String(SSET.eq) ? ' selected' : '') + '>' + esc(e[1]) + ' · pot. ' + e[2] + '</option>').join(''); $('#stme').disabled = SSET.type === '8'; };
  fillEq();
  $('#sttype').addEventListener('change', e => { SSET.type = e.target.value; SSET.eq = ''; fillEq(); sSave(); });
  $('#steq').addEventListener('change', e => { SSET.eq = e.target.value; const it = eqs().find(x => String(x[0]) === e.target.value); if (it) { SSET.pot = SSET.ori = it[2]; $('#stpot').value = $('#stori').value = it[2]; } sSave(); });
  [['stpot', 'pot'], ['stori', 'ori'], ['stprof', 'prof'], ['stlv', 'lv']].forEach(([id, k]) => $('#' + id).addEventListener('input', e => { SSET[k] = +e.target.value || 0; sSave(); if (SF && (k === 'prof' || k === 'lv')) sRender(); }));
  $('#stme').addEventListener('change', e => { SSET.me = e.target.value; sSave(); });
  $('#ststart').addEventListener('click', () => {
    if (SSET.lv < 10) { alert('Com nível abaixo de 10 não dá para colocar status.'); return; }
    if (!(SSET.pot > 0)) { alert('Escolha um equipamento ou digite o potencial.'); return; }
    if (SF && SF.steps.length && !confirm('Apagar a fórmula atual e começar de novo?')) return;
    sStart(); $('#ststart').textContent = 'Recomeçar'; sRender();
  });
  sRender();
}
function sRender() {
  if (!SF) { $('#stsim').innerHTML = '<h2>Status</h2><p class="muted" style="margin:0">Escolha o equipamento e toque em “Começar”.</p>'; $('#ststeps').innerHTML = '<h2>Passos</h2><p class="muted" style="margin:0">Nenhum passo ainda.</p>'; return; }
  const pv = SF.preview(SCUR.stat, SCUR.val);
  const typeA = SF.type === 'A';
  const opts = cur => { let h = '<option value="0">— escolher status —</option>', prev = ''; SDATA.stats.forEach(s => { if (s[9] === 'E' && typeA) return; if (SSET.lv < 210 && s[1].startsWith('Reduce Dmg (')) return; if (s[8] !== prev) { if (prev) h += '</optgroup>'; h += '<optgroup label="' + esc(s[8]) + '">'; prev = s[8]; } h += '<option value="' + s[0] + '"' + (s[0] === cur ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }); return h + '</optgroup>'; };
  $('#stsim').innerHTML = '<div class="stbar"><span><small>Potencial</small><b>' + SF.potential + ' → <span class="' + (pv.pot < 0 ? 'neg' : '') + '">' + pv.pot + '</span></b></span><span><small>Sucesso</small><b>' + pv.rate + '%</b></span><span><small>Passos</small><b>' + SF.log.reduce((a, l) => a + l.n, 0) + '</b></span></div>'
    + (SF.done ? '<p class="inote" style="margin:10px 0">Fórmula concluída. Taxa de sucesso final: <b>' + SF.rate + '%</b>.</p>' : '')
    + '<div class="stslots">' + Array.from({ length: SMAX }, (_, i) => {
      const fixed = SF.stat[i], sid = SCUR.stat[i], inf = pv.info[i];
      const head = fixed ? '<b class="stname">' + esc(sStat(fixed)[1]) + '</b>' : '<select data-slot="' + i + '" aria-label="Status do espaço ' + (i + 1) + '"' + (SF.done ? ' disabled' : '') + '>' + opts(sid) + '</select>';
      const val = SCUR.val[i];
      return '<div class="stslot"><span class="stn">' + (i + 1) + '</span><div class="sthead">' + head + (inf && (inf.delta || inf.mats) ? '<small>' + (inf.delta ? (inf.delta > 0 ? '+' : '') + inf.delta : '') + (inf.mats ? ' · ' + fmt(inf.mats) + ' ' + inf.mat : '') + '</small>' : '') + '</div>'
        + (sid ? '<div class="stctl"><button type="button" data-mm="' + i + ':-1" aria-label="Mínimo">«</button><button type="button" data-pm="' + i + ':-1" aria-label="Menos">−</button><b class="' + (val < 0 ? 'neg' : '') + '">' + (val > 0 ? '+' : '') + val + '</b><button type="button" data-pm="' + i + ':1" aria-label="Mais">+</button><button type="button" data-mm="' + i + ':1" aria-label="Máximo">»</button></div>' : '<div class="stctl"></div>') + '</div>';
    }).join('') + '</div>'
    + '<div class="chips" style="margin-top:12px"><button class="btn" id="stok" type="button"' + (SF.done ? ' disabled' : '') + '>Confirmar passo</button><button class="btn ghost" id="strep" type="button"' + (SF.done || !SF.steps.length ? ' disabled' : '') + '>Repetir último</button><button class="btn ghost" id="stundo" type="button"' + (!SF.steps.length ? ' disabled' : '') + '>Desfazer</button></div>';
  const mats = SF.mat.slice(1).map((v, i) => [SMATS[i + 1], v]).filter(x => x[1]);
  $('#ststeps').innerHTML = '<h2>Passos <small>potencial inicial ' + SF.starting + '</small></h2>'
    + (SF.log.length ? '<ol class="stlog">' + SF.log.map(l => '<li>' + l.parts.map(([n, d]) => '<span class="' + (d < 0 ? 'neg' : '') + '">' + esc(n) + ' ' + (d > 0 ? '+' : '') + d + '</span>').join(', ') + (l.n > 1 ? ' <b>×' + l.n + '</b>' : '') + '</li>').join('') + '</ol>' : '<p class="muted" style="margin:0">Nenhum passo ainda. Escolha os status, ajuste os valores e toque em “Confirmar passo”.</p>')
    + '<h4 class="sub4">Materiais</h4>' + (mats.length ? '<div class="slist">' + mats.map(([m, v]) => '<div><span>' + m + '</span><b>' + fmt(v) + ' pts</b></div>').join('') + '<div><span>Maior passo</span><b>' + fmt(SF.highest) + ' pts</b></div></div>' : '<p class="muted" style="margin:0">—</p>')
    + '<div class="chips" style="margin-top:12px"><button class="btn" id="stshare" type="button"' + (!SF.steps.length ? ' disabled' : '') + '>Copiar link da fórmula</button></div><p class="note" id="stmsg">A fórmula fica salva neste aparelho.</p>';
  $('#stsim').onchange = e => { const s = e.target.closest('[data-slot]'); if (!s) return; const i = +s.dataset.slot; SCUR.stat[i] = +s.value; SCUR.val[i] = 0; sRender(); };
  $('#stsim').onclick = e => {
    const p = e.target.closest('[data-pm]'), m = e.target.closest('[data-mm]');
    if (p || m) { const [i, d] = (p || m).dataset[p ? 'pm' : 'mm'].split(':').map(Number); if (p) sStep(i, d); else while (sStep(i, d)); sRender(); return; }
    if (e.target.closest('#stok')) { if (SCUR.stat.some((s, i) => s && !SCUR.val[i] && !SF.stat[i])) { alert('Tem status escolhido com valor zero.'); return; } SF.add(SCUR.stat.slice(), SCUR.val.slice()); SCUR = { stat: SF.stat.slice(), val: SF.val.slice() }; sSave(); sRender(); return; }
    if (e.target.closest('#strep')) { const ld = SF.lastDelta; if (!ld.length) return; const nv = SF.val.slice(); for (let i = 0; i < SMAX; i++) { if (!ld[i]) continue; SCUR.val[i] = SF.val[i]; for (let k = 0; k < Math.abs(ld[i]); k++) if (!sStep(i, Math.sign(ld[i]))) { SCUR.val = nv; return; } } SF.add(SCUR.stat.slice(), SCUR.val.slice()); SCUR = { stat: SF.stat.slice(), val: SF.val.slice() }; sSave(); sRender(); return; }
    if (e.target.closest('#stundo')) { const st = SF.steps.slice(0, -1); SF = sReplay(st); SCUR = { stat: SF.stat.slice(), val: SF.val.slice() }; sSave(); sRender(); }
  };
  $('#ststeps').onclick = e => {
    if (!e.target.closest('#stshare')) return;
    const url = location.href.split('#')[0] + '#/statting/' + b64e(JSON.stringify({ set: SSET, f: { t: SF.type, p: SF.starting, o: SF.original, m: SF.me, s: SF.steps } }));
    const done = () => { $('#stmsg').textContent = 'Link copiado! Cole no grupo para mostrar a fórmula.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => { fallbackCopy(url); done(); }); else { fallbackCopy(url); done(); }
  };
}

// ---------- calculadora de dano (completa, no esquema do Cy's Grimoire) ----------
// Fórmula do glossário: [(ATK efetivo + constante da skill + constante extra) × multiplicadores] + dano fixo.
// Multiplicadores: crítico × elemento × skill × desembainhar × estabilidade × proration × (combo × distância × dano total × dano final).
// Acerto: chance = (Precisão − Esquiva do alvo) ÷ 3 + MP da skill ÷ 10; MISS pode virar Graze pelo crítico ou pelo acerto mínimo da arma.
const EL_EN = ['Fire', 'Earth', 'Water', 'Dark', 'Wind', '', 'Neutral', 'Light'];
const EL_BEATS = { Water: 'Fire', Fire: 'Earth', Earth: 'Wind', Wind: 'Water', Light: 'Dark', Dark: 'Light' };
const MIN_HIT = { '': 50, 'Staff': 30, 'Katana': 30, '1 Handed Sword': 25, 'Halberd': 20, '2 Handed Sword': 15, 'Magic Device': 10, 'Knuckles': 10, 'Bow': 10, 'Bowgun': 5 };
const DM = Object.assign({ gid: 0, mode: '', type: 'f', range: 'curta', cst: 0, mult: 100, pror: 100, buff: 0, uns: false, lv: 1, def: 0, mdef: 0, pres: 0, mres: 0, cres: 0, flee: 0, hp: 0, critd: '', combo: 100, other: 100, cst2: 0, mp: 0, mcr: 0, mcd: 50, autoEl: true }, store.get('dano', {}));
function fichaVals(f, mode) {
  if (!f || !f.df.length) return null;
  const col = f.m ? 1 : Math.max(1, f.d.findIndex(r => r[0] === mode) + 1);
  const num = v => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? 0 : x; };
  const row = p => { const r = f.df.find(x => String(x[0]).startsWith(p)); return r ? num(r[col]) : 0; };
  return { def: row('Physical Defense'), mdef: row('Magical Defense'), pres: row('Physical Resistance'), mres: row('Magical Resistance'), cres: row('Critical Resistance'), flee: row('Flee') };
}
function setTarget(g, mode) {
  const e = g.entries.find(x => x.mode === mode) || g.entries[g.entries.length - 1];
  DM.gid = g.id; DM.mode = e.mode; DM.lv = e.lv; DM.hp = e.hp > 0 ? e.hp : 0;
  const v = fichaVals(fichaFor(g), e.mode);
  Object.assign(DM, v || { def: 0, mdef: 0, pres: 0, mres: 0, cres: 0, flee: 0 });
  DM.auto = !!v;
}
function viewDamage() {
  setTitle('Calculadora de dano');
  const n = (id, lab, v, extra) => '<div class="field"><label class="lbl" for="' + id + '">' + lab + '</label><input id="' + id + '" type="number" inputmode="decimal" step="any" value="' + v + '"' + (extra || '') + '></div>';
  view.innerHTML = backBtn('#/ferramentas') + '<div class="ph"><div><h1>Calculadora de dano</h1><p>Quanto a build que está em uso bate num monstro do bestiário, com acerto, crítico, Graze e elemento. Para mudar a build, use o <a class="tl" href="#/personagem/equipamento" style="color:#9fe3e6">Personagem</a>.</p></div></div>'
    + '<button type="button" class="bdsum" id="dmsum" aria-label="Ver resultado completo"></button>'
    + '<div class="grid2"><div>'
    + '<section class="card"><h2>Alvo</h2><div class="slotrow"><button type="button" class="slotbtn" id="dmpick"></button></div>'
    + '<div class="calc" style="margin-top:10px"><div class="field"><label class="lbl" for="dmmode">Dificuldade</label><select id="dmmode"></select></div>'
    + n('dmlv', 'Nível do monstro', DM.lv) + n('dmhp', 'HP', DM.hp) + n('dmdef', 'DEF', DM.def) + n('dmmdef', 'MDEF', DM.mdef) + n('dmpres', 'Resistência física %', DM.pres) + n('dmmres', 'Resistência mágica %', DM.mres) + n('dmcres', 'Resistência crítica', DM.cres) + n('dmflee', 'Esquiva (Flee)', DM.flee)
    + '</div><p class="note" id="dmsrc"></p></section>'
    + '<section class="card"><h2>Ataque</h2><div class="calc">'
    + '<div class="field"><label class="lbl" for="dmtype">Tipo</label><select id="dmtype"><option value="f"' + (DM.type === 'f' ? ' selected' : '') + '>Físico</option><option value="m"' + (DM.type === 'm' ? ' selected' : '') + '>Mágico</option></select></div>'
    + '<div class="field"><label class="lbl" for="dmrange">Distância</label><select id="dmrange"><option value="curta"' + (DM.range === 'curta' ? ' selected' : '') + '>Curta (até 7 m)</option><option value="longa"' + (DM.range === 'longa' ? ' selected' : '') + '>Longa (8 m ou mais)</option><option value="nenhuma"' + (DM.range === 'nenhuma' ? ' selected' : '') + '>Nenhuma</option></select></div>'
    + n('dmcst', 'Constante da skill', DM.cst) + n('dmmult', 'Multiplicador da skill %', DM.mult) + n('dmmp', 'MP da skill (para o acerto)', DM.mp) + n('dmpror', 'Proration %', DM.pror)
    + n('dmcombo', 'Multiplicador de combo %', DM.combo) + n('dmbuff', 'Buffs extras %', DM.buff) + n('dmother', 'Outros multiplicadores %', DM.other) + n('dmcst2', 'Outra constante', DM.cst2)
    + n('dmcritd', 'Dano crítico % (vazio = estimar)', DM.critd, ' placeholder="estimar"') + n('dmmcr', 'Conversão de crítico mágico %', DM.mcr) + n('dmmcd', 'Conversão de dano crítico mágico %', DM.mcd)
    + '<div class="field"><span class="lbl">Opções</span><label class="check"><input id="dmuns" type="checkbox"' + (DM.uns ? ' checked' : '') + '> Golpe de desembainhar</label><label class="check"><input id="dmauto" type="checkbox"' + (DM.autoEl ? ' checked' : '') + '> Vantagem de elemento automática</label></div>'
    + '</div><p class="note">Ataque normal: constante 0, multiplicador 100% e MP 0. Os valores de cada skill aparecem na descrição dela no jogo. No combo, a 2ª skill costuma ter 90%, a 3ª 80% (veja o glossário).</p></section>'
    + '</div><div><section class="card" id="dmres"></section></div></div>'
    + '<div class="picker" id="pick" hidden><div class="pbox"><div class="phead"><input id="pq" type="search" placeholder="Buscar monstro" aria-label="Buscar monstro"><button class="btn ghost" id="pclose" type="button">Fechar</button></div><div id="plist2" class="plist"></div></div></div>';
  const fillTarget = () => {
    const g = DB.GBYID.get(DM.gid);
    $('#dmpick').innerHTML = g ? '<b>' + esc(g.name) + '</b><small>' + TLAB[g.t] + ' · ' + g.els.map(e => EL[e][0]).join(', ') + (fichaFor(g) ? ' · com guia RAID' : '') + '</small>' : '<span class="muted">Escolher monstro (ou digite os valores abaixo)</span>';
    $('#dmmode').innerHTML = g ? g.entries.map(e => '<option value="' + esc(e.mode) + '"' + (e.mode === DM.mode ? ' selected' : '') + '>' + esc(MODE[e.mode] ? MODE[e.mode][2] : e.mode || '—') + ' · Lv ' + e.lv + '</option>').join('') : '<option value="">—</option>';
    [['dmlv', 'lv'], ['dmhp', 'hp'], ['dmdef', 'def'], ['dmmdef', 'mdef'], ['dmpres', 'pres'], ['dmmres', 'mres'], ['dmcres', 'cres'], ['dmflee', 'flee']].forEach(([id, k]) => { $('#' + id).value = DM[k]; });
    $('#dmsrc').textContent = !g ? 'Digite os dados do alvo.' : DM.auto ? 'DEF, MDEF, resistências e esquiva do guia RAID do Toram Yo (podem estar desatualizados). Ajuste se precisar.' : 'Este monstro não tem dados de defesa no bestiário. Preencha DEF, resistências e esquiva se souber; com zero, o dano sai mais alto que o real.';
  };
  fillTarget(); damageCalc();
  const read = () => {
    const v = id => +$('#' + id).value || 0;
    Object.assign(DM, { lv: v('dmlv'), hp: v('dmhp'), def: v('dmdef'), mdef: v('dmmdef'), pres: v('dmpres'), mres: v('dmmres'), cres: v('dmcres'), flee: v('dmflee'), type: $('#dmtype').value, range: $('#dmrange').value, cst: v('dmcst'), mult: v('dmmult'), mp: v('dmmp'), pror: v('dmpror'), combo: v('dmcombo'), buff: v('dmbuff'), other: v('dmother'), cst2: v('dmcst2'), critd: $('#dmcritd').value, mcr: v('dmmcr'), mcd: v('dmmcd'), uns: $('#dmuns').checked, autoEl: $('#dmauto').checked });
    store.set('dano', DM); damageCalc();
  };
  view.querySelectorAll('.calc input, #dmtype, #dmrange').forEach(i => i.addEventListener('input', read));
  $('#dmmode').addEventListener('change', e => { const g = DB.GBYID.get(DM.gid); if (g) { setTarget(g, e.target.value); store.set('dano', DM); fillTarget(); damageCalc(); } });
  $('#dmpick').addEventListener('click', () => {
    $('#pq').value = ''; $('#pick').hidden = false; $('#pq').focus();
    const list = () => { const q = $('#pq').value.trim().toLowerCase(); const rows = DB.MONS.filter(g => g.entries.some(e => e.hp > 0) && (!q || g.name.toLowerCase().includes(q))).sort((a, b) => (fichaFor(b) ? 1 : 0) - (fichaFor(a) ? 1 : 0) || 'BMN'.indexOf(a.t) - 'BMN'.indexOf(b.t) || b.hi - a.hi).slice(0, 80);
      $('#plist2').innerHTML = rows.map(g => '<button type="button" class="prow2" data-g="' + g.id + '"><b>' + esc(g.name) + '</b> <small>' + TLAB[g.t] + ' · Lv ' + lvTxt(g) + (fichaFor(g) ? ' · guia RAID' : '') + '</small></button>').join('') || '<p class="empty">Nenhum monstro.</p>'; };
    $('#pq').oninput = list; list();
    $('#plist2').onclick = e => { const b = e.target.closest('[data-g]'); if (!b) return; const g = DB.GBYID.get(+b.dataset.g); setTarget(g, (g.entries.find(x => x.mode === 'Ultimate') || g.entries[g.entries.length - 1]).mode); store.set('dano', DM); $('#pick').hidden = true; fillTarget(); damageCalc(); };
  });
  $('#dmsum').addEventListener('click', () => $('#dmres').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#pclose').addEventListener('click', () => { $('#pick').hidden = true; });
  $('#pick').addEventListener('click', e => { if (e.target.id === 'pick') $('#pick').hidden = true; });
}
function damageCalc() {
  const { tot } = buildTotals(), d = buildDerived(tot);
  const g = n => { const i = SI(n); return i < 0 ? 0 : tot.get(i) || 0; };
  const mon = DB.GBYID.get(DM.gid), magic = DM.type === 'm';
  const main = DB.ITBYID.get(BD.sl.arma.id), wt = main ? main.tl : '';
  const stabBase = main ? ((main.stats.find(s => DB.STATN[s[0]] === 'Base Stability %') || [0, 0])[1]) : 50;
  const physStab = Math.min(100, Math.max(0, stabBase + g('Stability %')));
  // estabilidade mágica: 50 + base ÷ 2; acima de 90% o piso trava em 90 e o teto sobe (até 110)
  const magStab = 50 + physStab / 2;
  const [stLo, stHi] = magic ? (magStab <= 90 ? [magStab, 100] : [90, Math.min(110, 100 + (magStab - 90))]) : [physStab, 100];
  const atk = magic ? d.MATK : d.ATK, pierce = Math.min(100, g(magic ? 'Magic Pierce %' : 'Physical Pierce %'));
  const def = magic ? DM.mdef : DM.def, res = magic ? DM.mres : DM.pres;
  const effAtk = (atk + (BD.lv - DM.lv)) * (1 - res / 100) - def * (1 - pierce / 100);
  const base = Math.max(0, effAtk + DM.cst + DM.cst2);
  // elemento: o da arma principal; vantagem dá +25%; dano mágico com elemento ganha INT base ÷ 10 % (com staff/MD vale contra qualquer elemento)
  const wEl = main ? (main.stats.map(s => DB.STATN[s[0]]).find(n => /^(Fire|Water|Wind|Earth|Light|Dark) Element$/.test(n)) || '').replace(' Element', '') : '';
  const mEl = mon ? mon.els.map(e => EL_EN[e]).filter(Boolean)[0] : '';
  const adv = DM.autoEl && wEl && mEl && EL_BEATS[wEl] === mEl;
  const intBonus = magic && wEl && (adv || wt === 'Staff' || wt === 'Magic Device') ? Math.floor(BD.st.INT / 10) : 0;
  const dte = mEl ? g('% stronger against ' + mEl) : 0;
  const elemMult = (1 + (adv ? 25 : 0) / 100 + (dte + intBonus) / 100);
  const rng = DM.range === 'curta' ? g('Short Range Damage %') : DM.range === 'longa' ? g('Long Range Damage %') : 0;
  const uns = DM.uns ? g('Unsheathe Attack %') : 0;
  const mods = elemMult * (DM.mult / 100) * (1 + uns / 100) * (DM.pror / 100) * (DM.combo / 100) * (1 + rng / 100) * (1 + DM.buff / 100) * (DM.other / 100);
  const hi = Math.floor(base * mods * stHi / 100), lo = Math.floor(base * mods * stLo / 100), avg = (hi + lo) / 2;
  // crítico (mágico usa a conversão)
  const physCD = DM.critd !== '' ? +DM.critd : 150 + Math.floor(d.STR / 5) + g('Critical Damage %') + g('Critical Damage');
  const critD = magic ? 100 + (physCD - 100) * Math.min(100, DM.mcd) / 100 : physCD;
  const critRaw = magic ? d.CRIT * Math.min(100, DM.mcr + (wt === 'Staff' && !wEl ? 25 : 0)) / 100 : d.CRIT;
  const cr = Math.max(0, Math.min(100, critRaw - DM.cres)) / 100;
  const critAvg = avg * critD / 100;
  // acerto (dano mágico sempre acerta)
  const H = magic ? 1 : Math.max(0, Math.min(100, (d.HIT - DM.flee) / 3 + DM.mp / 10)) / 100;
  const minHit = (MIN_HIT[wt] != null ? MIN_HIT[wt] : 10) / 100;
  const missWhite = magic ? 0 : (1 - H) * (1 - cr) * (H < 1 ? Math.max(0, minHit - H) / (1 - H) : 0);
  const grazeAvg = base * mods * ((stLo / 2 + stHi) / 2) / 100; // Graze: estabilidade final ÷ 2
  const exp = H * ((1 - cr) * avg + cr * critAvg) + (1 - H) * cr * grazeAvg * critD / 100 + missWhite * grazeAvg;
  const pMiss = magic ? 0 : (1 - H) * (1 - cr) - missWhite;
  const hits = DM.hp > 0 && exp > 0 ? Math.ceil(DM.hp / exp) : 0;
  const pct = x => Math.round(x * 1000) / 10 + '%';
  const box = (l, v, s) => '<div><span class="lbl">' + l + '</span><div class="big">' + v + '</div>' + (s ? '<small class="muted">' + s + '</small>' : '') + '</div>';
  $('#dmsum').innerHTML = '<span><small>Por golpe</small>' + fmt(Math.floor(exp)) + '</span><span><small>Acerto</small>' + pct(H) + '</span><span><small>Crítico</small>' + pct(cr) + '</span>' + (hits ? '<span><small>Golpes</small>' + fmt(hits) + '</span>' : '') + '<em>ver tudo ↓</em>';
  $('#dmres').innerHTML = '<h2>Resultado <small>' + (mon ? esc(mon.name) : 'alvo manual') + '</small></h2>'
    + (!main ? '<p class="inote" style="margin:0 0 10px">A build em uso não tem arma. Escolha uma no <a class="tl" href="#/personagem/equipamento">Personagem</a>; por enquanto o cálculo usa só o nível e os status.</p>' : '')
    + (hi <= 0 ? '<p class="inote" style="margin:0 0 10px">A ' + (magic ? 'MDEF' : 'DEF') + ' do alvo é maior que o seu ' + (magic ? 'MATK' : 'ATK') + ' efetivo, então o golpe quase não passa. Aumente o pierce, use uma skill com constante alta ou escolha uma dificuldade menor.</p>' : '')
    + '<div class="res">' + box('Sem crítico', fmt(lo) + ' – ' + fmt(hi), 'média ' + fmt(Math.floor(avg))) + box('Crítico (média)', fmt(Math.floor(critAvg)), 'dano crítico ' + Math.floor(critD) + '%')
    + box('Dano esperado por golpe', fmt(Math.floor(exp)), 'já contando acerto, crítico e Graze') + (hits ? box('Golpes para derrubar', fmt(hits), 'HP ' + fmt(DM.hp)) : '') + '</div>'
    + '<h4 class="sub4">Chances por golpe</h4><div class="res">' + box('Acerto (HIT)', pct(H), magic ? 'dano mágico sempre acerta' : 'precisão ' + fmt(d.HIT) + ' × esquiva ' + fmt(DM.flee)) + box('Crítico', pct(cr), 'taxa ' + Math.floor(critRaw) + ' − resistência ' + DM.cres) + (magic ? '' : box('Graze', pct(missWhite + (1 - H) * cr), 'acerto mínimo da arma ' + Math.round(minHit * 100) + '%') + box('MISS', pct(Math.max(0, pMiss)), 'não causa dano')) + '</div>'
    + '<h4 class="sub4">O que entrou na conta</h4><div class="slist">'
    + [[magic ? 'MATK' : 'ATK', fmt(atk)], ['ATK efetivo', fmt(Math.floor(effAtk))], ['Diferença de nível', fmt(BD.lv - DM.lv)], [magic ? 'MDEF do alvo' : 'DEF do alvo', fmt(def)], ['Pierce', pierce + '%'], ['Resistência do alvo', res + '%'], ['Estabilidade', magic ? 'mágica ' + Math.floor(magStab) + '% (' + Math.floor(stLo) + '–' + Math.floor(stHi) + '%)' : physStab + '%'],
      ['Elemento', (wEl ? EL[EL_EN.indexOf(wEl)][0] : 'neutro') + ' contra ' + (mEl ? EL[EL_EN.indexOf(mEl)][0] : '?') + (adv ? ' (+25%)' : '')], ['Dano contra o elemento', '+' + (dte + intBonus) + '%' + (intBonus ? ' (com INT)' : '')], ['Distância', '+' + rng + '%'], ['Desembainhar', '+' + uns + '%'], ['Skill × proration × combo', DM.mult + '% × ' + DM.pror + '% × ' + DM.combo + '%'], ['Buffs × outros', '+' + DM.buff + '% × ' + DM.other + '%']].map(([k, v]) => '<div><span>' + k + '</span><b>' + v + '</b></div>').join('') + '</div>'
    + '<p class="note">Fórmulas do glossário (Cy\'s Grimoire e testes da comunidade). Não inclui skills passivas nem guarda/esquiva especial do boss; a parte de Graze é uma estimativa. Bom para comparar builds e skills.</p>';
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
