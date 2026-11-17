// ---------- idiomas ----------
// O site é escrito em português. Nos outros idiomas, este arquivo troca os textos da tela pelo dicionário
// data/i18n/<idioma>.json ({"texto em português": "tradução"}). Os números viram # na chave e voltam no lugar.
// Nomes do jogo (monstros, itens, mapas, skills) ficam em inglês, como no próprio jogo.
(function () {
  const LANGS = { pt: 'Português', en: 'English', es: 'Español', id: 'Bahasa Indonesia' };
  const HTML_LANG = { pt: 'pt-BR', en: 'en', es: 'es', id: 'id' };
  const AVISO = {
    en: 'Translation in progress: some guides are still in Portuguese.',
    es: 'Traducción en curso: algunas guías siguen en portugués.',
    id: 'Terjemahan sedang berjalan: beberapa panduan masih dalam bahasa Portugis.'
  };
  const get = () => { try { return localStorage.getItem('bt:lang'); } catch (e) { return null; } };
  const set = v => { try { localStorage.setItem('bt:lang', v); } catch (e) { } };
  const detect = () => {
    for (const l of navigator.languages || [navigator.language || '']) {
      const p = (l || '').slice(0, 2).toLowerCase();
      if (LANGS[p]) return p;
      if (p === 'ms' || p === 'tl' || p === 'fil') return p === 'ms' ? 'id' : 'en';
    }
    return 'en';
  };
  const V = (document.currentScript && document.currentScript.src.split('v=')[1]) || '';
  const q = (location.search.match(/[?&]lang=([a-z]{2})/) || [])[1];
  if (q && LANGS[q]) set(q);
  let lang = get() || detect();
  if (!LANGS[lang]) lang = 'pt';
  window.btLang = lang;

  function seletor() {
    const foot = document.querySelector('.foot');
    if (!foot || document.getElementById('langsel')) return;
    const p = document.createElement('p');
    p.className = 'langp';
    p.setAttribute('translate', 'no');
    p.innerHTML = '<label for="langsel"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg><span class="sr">Idioma / Language</span></label><select id="langsel">'
      + Object.entries(LANGS).map(([k, n]) => '<option value="' + k + '"' + (k === lang ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>';
    foot.prepend(p);
    p.querySelector('select').addEventListener('change', e => { set(e.target.value); location.reload(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', seletor); else seletor();
  if (lang === 'pt') return;

  document.documentElement.lang = HTML_LANG[lang];
  document.documentElement.classList.add('tr-wait');
  let D = null;
  const cache = new Map();
  const SEPS = [' · ', ' — ', ' → ', ': ', ' | ', ' / ', ', '];

  function core(k) {
    if (D[k] != null) return D[k];
    const nums = [];
    const t = k.replace(/\d[\d.,]*/g, m => { nums.push(m); return '#'; });
    if (nums.length && D[t] != null) { let i = 0; return D[t].replace(/#/g, () => (i < nums.length ? nums[i++] : '#')); }
    return null;
  }
  function tr(k) {
    if (cache.has(k)) return cache.get(k);
    let r = core(k);
    if (r == null) {
      // tira pontuação das pontas e tenta de novo
      const m = k.match(/^([\s:;,.()\-–—+×]*)(.*?)([\s:;,.()!?…]*)$/);
      if (m && m[2] && m[2] !== k) { const c = core(m[2]); if (c != null) r = m[1] + c + m[3]; }
    }
    if (r == null) {
      // texto composto (ex.: "Item · drop de 3"): traduz cada parte
      for (const s of SEPS) {
        if (!k.includes(s)) continue;
        const parts = k.split(s);
        const out = parts.map(p => (p.trim() ? tr(p) : p));
        if (out.some((o, i) => o !== parts[i])) { r = out.join(s); break; }
      }
    }
    if (r == null) r = k;
    cache.set(k, r);
    return r;
  }
  const done = new WeakMap();
  function texto(n) {
    const v = n.nodeValue;
    if (done.get(n) === v) return;
    const k = v.replace(/\s+/g, ' ').trim();
    if (!k || !/[A-Za-zÀ-ú]{2}/.test(k)) return;
    const r = tr(k);
    if (r !== k) { const a = v.match(/^\s*/)[0], b = v.match(/\s*$/)[0]; n.nodeValue = a + r + b; }
    done.set(n, n.nodeValue);
  }
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function attrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v || el['_tr' + a] === v) continue;
      const r = tr(v.trim());
      if (r !== v.trim()) el.setAttribute(a, r);
      el['_tr' + a] = el.getAttribute(a);
    }
  }
  const SKIP = 'script,style,textarea,[translate="no"]';
  function walk(root) {
    if (root.nodeType === 3) { if (!root.parentElement || !root.parentElement.closest(SKIP)) texto(root); return; }
    if (root.nodeType !== 1 || root.closest(SKIP)) return;
    attrs(root);
    root.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(e => { if (!e.closest(SKIP)) attrs(e); });
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest(SKIP) ? 2 : 1) });
    let n; while ((n = w.nextNode())) texto(n);
  }
  function aviso() {
    if (document.getElementById('travis')) return;
    const d = document.createElement('div');
    d.id = 'travis'; d.className = 'travis'; d.setAttribute('translate', 'no');
    d.innerHTML = '<span>' + AVISO[lang] + '</span> <button type="button" class="linkbtn">Português</button><button type="button" class="linkbtn" aria-label="OK">×</button>';
    d.querySelectorAll('button')[0].onclick = () => { set('pt'); location.reload(); };
    d.querySelectorAll('button')[1].onclick = () => { d.remove(); try { sessionStorage.setItem('bt:travis', 1); } catch (e) { } };
    let visto = 0; try { visto = sessionStorage.getItem('bt:travis'); } catch (e) { }
    if (!visto) document.body.appendChild(d);
  }

  fetch('data/i18n/' + lang + '.json?v=' + V)
    .then(r => r.json())
    .then(dic => {
      D = dic;
      walk(document.body);
      document.title = tr(document.title);
      new MutationObserver(ms => {
        for (const m of ms) {
          if (m.type === 'characterData') { if (!m.target.parentElement || !m.target.parentElement.closest(SKIP)) texto(m.target); }
          else if (m.type === 'attributes') { if (!m.target.closest(SKIP)) attrs(m.target); }
          else m.addedNodes.forEach(walk);
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
      new MutationObserver(() => { const t = tr(document.title); if (t !== document.title) document.title = t; })
        .observe(document.querySelector('title'), { childList: true, characterData: true, subtree: true });
      aviso();
    })
    .catch(() => { })
    .finally(() => document.documentElement.classList.remove('tr-wait'));
})();
