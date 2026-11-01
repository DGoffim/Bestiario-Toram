# Lê as notícias do site oficial do Toram Online (en.toram.jp) e salva em data/noticias.json.
# Roda no GitHub Actions a cada 3 horas (.github/workflows/noticias.yml). Só usa a biblioteca padrão do Python.
import html
import json
import re
import time
import urllib.request

BASE = 'https://en.toram.jp'
ARQ = 'data/noticias.json'
PAGINAS = 3          # 3 páginas da lista (cerca de 30 notícias)
COM_TEXTO = 25       # quantas das mais recentes trazem o texto completo


def baixar(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'BestiarioToram/1.0 (+https://dgoffim.github.io/Bestiario-Toram/)'})
    return urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')


def limpar(trecho):
    trecho = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>', '', trecho)
    trecho = re.sub(r'<(br|/p|/div|/li|/h\d|/tr|/table)[^>]*>', '\n', trecho)
    trecho = html.unescape(re.sub(r'<[^>]+>', ' ', trecho))
    linhas = [re.sub(r'\s+', ' ', l).strip() for l in trecho.split('\n')]
    return [l for l in linhas if l and l not in ('Tweet', 'Back to Top')]


itens = []
for pagina in range(1, PAGINAS + 1):
    h = baixar(f'{BASE}/information/?type_code=all&page={pagina}')
    for m in re.finditer(r'<li class="news_border">\s*<a href="/information/detail/\?information_id=(\d+)">([\s\S]*?)</a>', h):
        corpo = m.group(2)
        data = re.search(r'datetime="([\d-]+)"', corpo)
        icone = re.search(r'img/bg/icon_news_(\w+)\.', corpo)
        titulo = re.search(r'news_title[^>]*>([\s\S]*?)</p>', corpo)
        itens.append({
            'id': int(m.group(1)),
            'data': data.group(1) if data else '',
            'cat': icone.group(1) if icone else 'other',
            'titulo': html.unescape(re.sub(r'<[^>]+>', '', titulo.group(1))).strip() if titulo else '',
        })
    time.sleep(1)

# Reaproveita os textos já baixados, para não pedir de novo as mesmas páginas.
antigos = {}
try:
    with open(ARQ, encoding='utf-8') as f:
        antigos = {n['id']: n for n in json.load(f)['itens']}
except Exception:
    pass

for n in itens[:COM_TEXTO]:
    velho = antigos.get(n['id'])
    if velho and velho.get('texto'):
        n['texto'] = velho['texto']
        continue
    try:
        h = baixar(f"{BASE}/information/detail/?information_id={n['id']}")
        i = h.find('news_title')
        i = h.find('>', i) + 1 if i >= 0 else 0
        fim = h.find('<footer', i)
        linhas = limpar(h[i:fim if fim > 0 else i + 80000])
        linhas = [l for l in linhas if l not in (n['data'], n['titulo'])]
        n['texto'] = '\n'.join(linhas)[:8000]
        time.sleep(1)
    except Exception:
        n['texto'] = ''

if itens:
    with open(ARQ, 'w', encoding='utf-8') as f:
        json.dump({'lido': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'itens': itens}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(itens)} notícias salvas')
else:
    print('Nenhuma notícia encontrada; arquivo mantido como estava')
