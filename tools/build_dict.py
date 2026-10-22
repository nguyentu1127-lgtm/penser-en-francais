#!/usr/bin/env python3
"""Build data/dict.json (offline pocket dictionary) from content/dict.txt + all lesson vocab.

content/dict.txt lines:
  mot | loại từ | nghĩa tiếng Việt
  @v infinitif | nghĩa | je,tu,il,nous,vous,ils | participe passé | radical imparfait | radical futur
  @er infinitif | nghĩa            (regular -er verb, all forms generated)
  @ir infinitif | nghĩa            (regular -ir verb like finir)
  @re infinitif | nghĩa            (regular -re verb like vendre)
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PERS = ['je', 'tu', 'il/elle', 'nous', 'vous', 'ils/elles']
IMP = ['ais', 'ais', 'ait', 'ions', 'iez', 'aient']
FUT = ['ai', 'as', 'a', 'ons', 'ez', 'ont']
COND = ['ais', 'ais', 'ait', 'ions', 'iez', 'aient']


def verb_forms(inf, vi, pres, pp, imp, fut):
    out = {inf: {'l': inf, 'p': 'verbe (nguyên thể)', 'v': vi}}
    for pre in ('se ', "s'"):
        if inf.startswith(pre):
            out[inf[len(pre):]] = out[inf]
    def add(form, label):
        form = form.lower()
        out.setdefault(form, {'l': inf, 'p': 'verbe', 'v': f'{vi} — {label}'})
    if len(pres) == 1:
        add(pres[0], 'hiện tại, il')
    else:
        for f, p in zip(pres, PERS):
            add(f, f'hiện tại, {p}')
    for x in (pp, pp + 'e', pp + 's', pp + 'es') if not pp.endswith('s') else (pp, pp + 'e', pp + 'es'):
        add(x, 'phân từ quá khứ')
    for e, p in zip(IMP, PERS):
        add(imp + e, f'imparfait, {p}')
    for e, p in zip(FUT, PERS):
        add(fut + e, f'tương lai đơn, {p}')
    for e, p in zip(COND, PERS):
        add(fut + e, f'điều kiện, {p}')
    return out


def regular(kind, inf):
    if kind == 'er':
        st = inf[:-2]
        nous = st + ('e' if st.endswith('g') else '') + 'ons'
        if st.endswith('c'):
            nous = st[:-1] + 'çons'
        pres = [st + 'e', st + 'es', st + 'e', nous, st + 'ez', st + 'ent']
        return pres, st + 'é', nous[:-3], inf
    if kind == 'ir':
        st = inf[:-2]
        pres = [st + 'is', st + 'is', st + 'it', st + 'issons', st + 'issez', st + 'issent']
        return pres, st + 'i', st + 'iss', inf
    st = inf[:-2]  # -re
    pres = [st + 's', st + 's', st, st + 'ons', st + 'ez', st + 'ent']
    return pres, st + 'u', st, inf[:-1]


def main():
    d, verbs = {}, []
    src = ROOT / 'content' / 'dict.txt'
    for raw in src.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('@'):
            kind, _, rest = line[1:].partition(' ')
            parts = [p.strip() for p in rest.split('|')]
            inf, vi = parts[0], parts[1]
            if kind == 'v':
                pres = [x.strip() for x in parts[2].split(',')]
                verbs.append([inf, vi, ','.join(pres), parts[3], parts[4], parts[5]])
            else:
                pres, pp, imp, fut = regular(kind, inf)
                verbs.append([inf, vi, ','.join(pres), pp, imp, fut])
            continue
        parts = [p.strip() for p in line.split('|')]
        if len(parts) != 3:
            raise SystemExit(f'dict.txt: dòng sai — {line}')
        w, pos, vi = parts
        key = w.lower()
        bare = key
        for art in ('le ', 'la ', 'les ', "l'", 'un ', 'une ', 'des '):
            if key.startswith(art):
                bare = key[len(art):]
        entry = {'l': w, 'p': pos, 'v': vi}
        d.setdefault(bare, entry)
        d.setdefault(key, entry)
    # all lesson vocab
    for f in sorted((ROOT / 'data' / 'weeks').glob('week-*.json')):
        w = json.loads(f.read_text(encoding='utf-8'))
        for day in w['days']:
            for v in day['vocab']:
                key = v['fr'].lower()
                bare = key
                for art in ('le ', 'la ', 'les ', "l'", 'un ', 'une ', 'des ', 'du ', 'se ', "s'"):
                    if key.startswith(art):
                        bare = key[len(art):]
                d.setdefault(bare, {'l': v['fr'], 'p': v['pos'], 'v': v['vi']})
    out = {'w': {k: [v['l'] if v['l'].lower() != k else '', v['p'], v['v']] for k, v in d.items()}, 'v': verbs}
    (ROOT / 'data' / 'dict.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'✓ dict.json: {len(d)} từ + {len(verbs)} động từ')


if __name__ == '__main__':
    main()
