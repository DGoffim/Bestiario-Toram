# Lê nas páginas de item do coryn.club o que a API não traz: de qual NPC ou Smith o item sai, a receita
# (taxa, quantidade, nível, dificuldade, materiais) e a cor (dye) de cada drop. Grava data/receitas.json.
# Para pesar pouco no coryn.club: uma página por vez, com pausa, e nas semanas seguintes só os itens novos.
# Uso: python scripts/receitas.py [limite]   (limite = quantos itens novos ler nesta rodada; padrão: todos)
import html
import json
import os
import re
import sys
import time
import urllib.request

ARQ = 'data/receitas.json'
UA = {'User-Agent': 'BestiarioToram/1.0 (+https://dgoffim.github.io/Bestiario-Toram/)'}


def pagina(item_id, tentativas=4):
    for t in range(tentativas):
        try:
            req = urllib.request.Request(f'https://coryn.club/item.php?id={item_id}', headers=UA)
            return urllib.request.urlopen(req, timeout=40).read().decode('utf-8', 'replace')
        except Exception:
            time.sleep(3 + 4 * t)
    return None


def texto(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def ler_item(h):
    out = {}
    bloco = re.search(r'<!-- Obtained From Content -->(.*?)<!-- end of Obtained From content -->', h, re.S)
    if bloco:
        for linha in bloco.group(1).split('<div class="pagination-js-item">')[1:]:
            cel = re.findall(r'<div>(.*?)</div>', linha, re.S)[:3]
            if not cel:
                continue
            primeira = cel[0]
            mapa = re.search(r"map\.php\?id=(\d+)", linha)
            dye = texto(cel[1]) if len(cel) > 1 else ''
            mon = re.search(r"monster\.php\?id=(\d+)", primeira)
            if mon:
                if dye:
                    out.setdefault('y', {})[mon.group(1)] = dye
            elif '[NPC]' in primeira:
                out.setdefault('n', []).append([texto(primeira.replace('[NPC]', '')), int(mapa.group(1)) if mapa else 0])
            elif '[Player]' in primeira:
                out['s'] = 1
            else:
                t = texto(primeira)
                if t:
                    out.setdefault('o', []).append(t)
    rec = re.search(r'<div>Recipe</div>\s*</div>\s*<div class="item-prop mini">(.*?)</ul>', h, re.S)
    if rec:
        r = rec.group(1)
        campos = dict((texto(k), texto(v)) for k, v in re.findall(r'<p class="accent-bold">(.*?)</p>\s*<div>(.*?)</div>', r, re.S))
        num = lambda s: int(re.sub(r'[^\d]', '', s)) if re.search(r'\d', s or '') else None
        if num(campos.get('Fee')) is not None:
            out['f'] = num(campos['Fee'])
        if num(campos.get('Set')) is not None:
            out['q'] = num(campos['Set'])
        if num(campos.get('Level')) is not None:
            out['l'] = num(campos['Level'])
        if num(campos.get('Difficulty')) is not None:
            out['d'] = num(campos['Difficulty'])
        mats = [[int(q), int(i)] for q, i in re.findall(r'(\d+)x\s*<a href=\'item\.php\?id=(\d+)\'', r)]
        if mats:
            out['m'] = mats
    return out


if __name__ == '__main__':
    # "refazer" relê só os itens que já têm receita (ex.: depois de corrigir a leitura dos materiais)
    refazer = 'refazer' in sys.argv[1:]
    nums = [a for a in sys.argv[1:] if a.isdigit()]
    limite = int(nums[0]) if nums else 10 ** 9
    base = json.load(open(ARQ, encoding='utf-8')) if os.path.exists(ARQ) else {'lidos': [], 'itens': {}}
    lidos = set(base['lidos'])
    ids = [int(l.split('|')[1]) for l in json.load(open('data/itens.json', encoding='utf-8'))['items'].split('\n') if l.count('|') >= 2]
    if refazer:
        falta = sorted(int(k) for k, v in base['itens'].items() if 'm' in v)[:limite]
    else:
        falta = [i for i in sorted(set(ids)) if i not in lidos][:limite]
    print(f'receitas: {len(ids)} itens, {len(lidos)} já lidos, lendo {len(falta)} agora')
    n = 0
    for i in falta:
        h = pagina(i)
        if h is None:
            print('falhou', i)
            continue
        info = ler_item(h)
        if info:
            base['itens'][str(i)] = info
        else:
            base['itens'].pop(str(i), None)
        lidos.add(i)
        n += 1
        if n % 200 == 0:
            base['lidos'] = sorted(lidos)
            json.dump(base, open(ARQ, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
            print(n, 'lidos')
        time.sleep(0.6)
    base['lidos'] = sorted(lidos)
    json.dump(base, open(ARQ, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('pronto:', len(base['itens']), 'itens com receita, NPC, Smith ou dye')
