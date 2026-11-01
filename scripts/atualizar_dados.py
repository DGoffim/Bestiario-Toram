# Atualiza data/monstros.json e data/itens.json pela API pública do coryn.club.
# Roda no GitHub Actions uma vez por semana (.github/workflows/dados.yml). Só usa a biblioteca padrão do Python.
# Para pesar pouco no coryn.club, só pede os detalhes (status de itens, drops de monstros) do que for novo.
import json
import time
import urllib.request

API = 'https://coryn.club/api/v1/'
SEM_STATUS = {'[Material]', '[Usable]', '[Refinement Support]', '[Ore]', '[Ninjutsu Scroll]', ''}
ELEM = {'Fire': 0, 'Earth': 1, 'Water': 2, 'Dark': 3, 'Wind': 4, 'Unknown': 5, 'Neutral': 6, 'Light': 7}


def pedir(url, tentativas=4):
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'BestiarioToram/1.0 (+https://dgoffim.github.io/Bestiario-Toram/)'})
            return json.loads(urllib.request.urlopen(req, timeout=40).read().decode('utf-8'))
        except Exception:
            time.sleep(2 + 3 * t)
    raise RuntimeError('falhou: ' + url)


def lista(endpoint):
    todos, off = [], 0
    while True:
        r = pedir(f'{API}{endpoint}.php?limit=100&offset={off}')
        todos += r.get('data') or []
        if len(r.get('data') or []) < 100:
            return todos
        off += 100
        time.sleep(0.3)


def ler(arq):
    with open(arq, encoding='utf-8') as f:
        return json.load(f)


def gravar(arq, obj):
    with open(arq, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


def limpo(s):
    return (s or '').replace('\r\n', '\n').replace('\n', ' · ').replace('|', '/').replace('\\', '/').replace('`', "'").strip()


def num(n):
    n = float(n)
    return str(int(n)) if n == int(n) else repr(n)


# ---------------- itens ----------------
velho = ler('data/itens.json')
vstats, vtypes, vbadges = velho['stats'], velho['types'], velho['badges']
conhecidos = {}  # id -> lista de (nome do status, valor, applies_to) já baixada antes
for linha in velho['items'].split('\n'):
    p = linha.split('|')
    if len(p) < 9:
        continue
    st = []
    for s in filter(None, p[7].split(';')):
        q = s.split(',')
        st.append((vstats[int(q[0])], q[1], int(q[2]) if len(q) > 2 else 0))
    conhecidos[int(p[1])] = st

itens = lista('items')
novos = [i for i in itens if i['id'] not in conhecidos and (i.get('type_label') or '') not in SEM_STATUS]
print(f'itens: {len(itens)} na API, {len(novos)} novos com status para baixar')
for i in novos:
    d = pedir(f"{API}items.php?id={i['id']}").get('data') or {}
    conhecidos[i['id']] = [(s['effect_name'].strip(), num(s['amount']), int(s.get('applies_to') or 0)) for s in d.get('stats') or []]
    if d.get('meta'):
        i['meta'] = d['meta']
    time.sleep(0.2)

types, statn, badges = list(vtypes), list(vstats), list(vbadges) or ['']


def idx(arr, v):
    if v not in arr:
        arr.append(v)
    return arr.index(v)


linhas = []
for i in sorted(itens, key=lambda x: (x['name'].lower(), x['id'])):
    meta = i.get('meta') or {}
    t = idx(types, i.get('type_label') or '')
    b = idx(badges, limpo(meta.get('badge')))
    st = ';'.join(f"{idx(statn, n)},{v}" + (f',{a}' if a else '') for n, v, a in conhecidos.get(i['id'], []))
    proc = str(i['process']) if (i.get('process_amount') or 0) > 0 and (i.get('process') or 0) > 0 else ''
    pa = str(i['process_amount']) if proc else ''
    linhas.append('|'.join([limpo(i['name']), str(i['id']), str(t), proc, pa, str(i.get('sell') or 0), str(b) if b else '', st, limpo(meta.get('note'))]))

novo_itens = {'types': types, 'stats': statn, 'badges': badges, 'items': '\n'.join(linhas)}
if novo_itens != velho:
    gravar('data/itens.json', novo_itens)
    print('itens.json atualizado')

# ---------------- monstros e mapas ----------------
vm = ler('data/monstros.json')
drops = {r[0]: r[11] for r in vm['mons']}
mons = lista('monsters')
mapas = lista('maps')
novos_m = [m for m in mons if m.get('type_code') in ('B', 'M', 'N') and m['id'] not in drops]
print(f'monstros: {len(mons)} na API, {len(novos_m)} novos para baixar os drops')
for m in novos_m:
    d = pedir(f"{API}monsters.php?id={m['id']}").get('data') or {}
    drops[m['id']] = [int(x['id']) for x in d.get('drops') or []]
    time.sleep(0.2)

linhas_m = []
for m in mons:
    if m.get('type_code') not in ('B', 'M', 'N'):
        continue
    fl = (1 if m.get('tameable') else 0) + (2 if m.get('limited') else 0)
    linhas_m.append([int(m['id']), m['name'], m['type_code'], m.get('mode') or '', int(m.get('level') or 0), int(m.get('hp') or 0), int(m.get('exp') or 0),
                     int(m.get('map_id') or 0), ELEM.get(m.get('element_label'), -1), fl, (m.get('meta') or {}).get('badge') or '', drops.get(m['id'], [])])
mapas_l = [[int(p['id']), p['name'], int(p.get('monster_count') or 0)] for p in sorted(mapas, key=lambda p: int(p['id']))]
if linhas_m != vm['mons'] or mapas_l != vm['maps']:
    gravar('data/monstros.json', {'read': time.strftime('%Y-%m-%d'), 'maps': mapas_l, 'mons': linhas_m})
    print('monstros.json atualizado')
else:
    print('monstros e mapas sem mudanças')
