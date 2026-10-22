#!/usr/bin/env python3
"""Build data/weeks/week-XX.json and data/dict.json from the plain-text sources in content/.

Usage:  python3 tools/build.py            (build everything)
        python3 tools/build.py 2 3        (build only weeks 2 and 3)

Week file format (content/week-XX.txt) — one item per line, "||" separates French and Vietnamese:

  @week 2
  @title Qui es-tu ?
  @level A1
  ## 1 | Le verbe avoir                 ← start of day 1
  G.title: Le verbe avoir au présent
  G.rule: Règle en français. || Quy tắc bằng tiếng Việt.
  G.note: Giải thích thêm bằng tiếng Việt.
  G.table: Pronom | Avoir               ← table header
  G.row: j' | ai                        ← table row (repeat)
  G.ex: Phrase d'exemple. || Câu ví dụ.  (repeat)
  G.q: Question ? | choix | *bon choix | choix | choix     ← "*" marks the right option
  G.q: Question libre ? = réponse 1 / réponse 2             ← typed answer
  V: le mot | /ipa/ | nom m. | nghĩa | Exemple. || Dịch ví dụ.
  VQ: (same as G.q)
  D: Phrase de dictée.
  L: Personne | Réplique. || Dịch.
  LQ: (same as G.q)
  RA: Texte à lire à voix haute.
  SH: Phrase pour le shadowing.
  R.title: Titre du texte
  R: Une phrase du texte. || Dịch.       (one sentence per line)
  RQ: (same as G.q)
  W.prompt: Consigne. || Đề bài.
  W.min: 30
  W.must: avoir ; ans
  W.check: Điều cần tự kiểm tra (repeat)
  W.model: Phrase du texte modèle. || Dịch.  (repeat, one sentence per line)
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTENT, OUT = ROOT / 'content', ROOT / 'data' / 'weeks'
SPLIT = re.compile(r'[^.!?…]+(?:[.!?…]+|$)(?:\s*»)?')


def split_sentences(text):
    return [s.strip() for s in SPLIT.findall(text) if s.strip()]


class Err(Exception):
    pass


def pair(v, where, need_vi=True):
    if '||' in v:
        a, b = v.split('||', 1)
        return a.strip(), b.strip()
    if need_vi:
        raise Err(f'{where}: thiếu bản dịch "||"')
    return v.strip(), None


def question(v, where):
    if ' | ' not in v and ' = ' in v:
        q, a = v.split(' = ', 1)
        return {'q': q.strip(), 'answer': [x.strip() for x in a.split(' / ') if x.strip()]}
    parts = [p.strip() for p in v.split(' | ')]
    q, opts = parts[0], parts[1:]
    stars = [i for i, o in enumerate(opts) if o.startswith('*')]
    if len(opts) < 2 or len(stars) != 1:
        raise Err(f'{where}: câu hỏi cần ≥2 lựa chọn và đúng 1 dấu * — "{v}"')
    if ' = ' in q and q.rstrip().endswith('='):
        pass
    clean = [o.lstrip('*').strip() for o in opts]
    if len(set(clean)) != len(clean):
        raise Err(f'{where}: lựa chọn bị trùng — "{v}"')
    return {'q': q, 'options': clean, 'answer': stars[0]}


def new_day(n, title):
    return {
        'id': None, 'day': n, 'title': title,
        'grammar': {'title': '', 'rule': '', 'note_vi': '', 'table': None, 'examples': [], 'quiz': []},
        'vocab': [], 'vocabQuiz': [],
        'listening': {'dictee': [], 'dialogue': [], 'questions': []},
        'speaking': {'readAloud': [], 'shadowing': []},
        'reading': {'title': '', 'text': '', 'questions': []},
        'writing': {'prompt': '', 'minWords': 20, 'mustUse': [], 'checklist': [], 'model': ''},
    }


def build_week(path):
    week, tr, days, day = {}, {}, [], None
    rsent, msent = [], []

    def add_tr(fr, vi, where):
        if vi is None:
            return
        if fr in tr and tr[fr] != vi:
            pass  # same sentence translated twice: keep first
        tr.setdefault(fr, vi)

    def close_day():
        if day is None:
            return
        day['reading']['text'] = ' '.join(rsent)
        day['reading']['sentences'] = list(rsent)
        day['writing']['model'] = list(msent)
        days.append(day)

    for ln, raw in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        line = raw.strip()
        where = f'{path.name}:{ln}'
        if not line or line.startswith('#!') or line.startswith('//'):
            continue
        if line.startswith('@'):
            k, _, v = line[1:].partition(' ')
            week[k] = int(v) if k == 'week' else v.strip()
            continue
        if line.startswith('## '):
            close_day()
            n, _, title = line[3:].partition('|')
            day = new_day(int(n), title.strip())
            day['id'] = f"w{week['week']:02d}d{int(n)}"
            rsent, msent = [], []
            continue
        if ':' not in line:
            raise Err(f'{where}: dòng không hợp lệ — "{line}"')
        key, _, v = line.partition(':')
        key, v = key.strip(), v.strip()
        g, L, R, W = day['grammar'], day['listening'], day['reading'], day['writing']
        if key == 'G.title': g['title'] = v
        elif key == 'G.rule':
            fr, vi = pair(v, where); g['rule'] = fr; add_tr(fr, vi, where)
        elif key == 'G.note': g['note_vi'] = v
        elif key == 'G.table': g['table'] = {'head': [x.strip() for x in v.split('|')], 'rows': []}
        elif key == 'G.row': g['table']['rows'].append([x.strip() for x in v.split('|')])
        elif key == 'G.ex':
            fr, vi = pair(v, where); g['examples'].append(fr); add_tr(fr, vi, where)
        elif key == 'G.q': g['quiz'].append(question(v, where))
        elif key == 'V':
            parts = [x.strip() for x in v.split(' | ')]
            if len(parts) != 5:
                raise Err(f'{where}: từ vựng cần 5 phần (fr | ipa | loại | nghĩa | ví dụ || dịch)')
            ex, exvi = pair(parts[4], where)
            day['vocab'].append({'fr': parts[0], 'ipa': parts[1], 'pos': parts[2], 'vi': parts[3], 'ex': ex})
            add_tr(ex, exvi, where)
        elif key == 'VQ': day['vocabQuiz'].append(question(v, where))
        elif key == 'D': L['dictee'].append(v)
        elif key == 'L':
            s, _, rest = v.partition(' | ')
            fr, vi = pair(rest, where); L['dialogue'].append({'s': s.strip(), 't': fr}); add_tr(fr, vi, where)
        elif key == 'LQ': L['questions'].append(question(v, where))
        elif key == 'RA': day['speaking']['readAloud'].append(v)
        elif key == 'SH': day['speaking']['shadowing'].append(v)
        elif key == 'R.title': R['title'] = v
        elif key == 'R':
            fr, vi = pair(v, where); rsent.append(fr); add_tr(fr, vi, where)
        elif key == 'RQ': R['questions'].append(question(v, where))
        elif key == 'W.prompt':
            fr, vi = pair(v, where); W['prompt'] = fr; add_tr(fr, vi, where)
        elif key == 'W.min': W['minWords'] = int(v)
        elif key == 'W.must': W['mustUse'] = [x.strip() for x in v.split(';') if x.strip()]
        elif key == 'W.check': W['checklist'].append(v)
        elif key == 'W.model':
            fr, vi = pair(v, where); msent.append(fr); add_tr(fr, vi, where)
        else:
            raise Err(f'{where}: khoá không biết "{key}"')
    close_day()

    data = {'week': week['week'], 'level': week['level'], 'title': week['title'], 'days': days, 'tr': tr}
    check(data, path.name)
    return data


def check(w, name):
    problems = []
    if len(w['days']) != 5:
        problems.append(f'cần 5 ngày, có {len(w["days"])}')
    for d in w['days']:
        tag = f'{name} ngày {d["day"]}'
        g = d['grammar']
        need = {
            'G.rule': bool(g['rule']), 'G.title': bool(g['title']), 'G.ex ≥3': len(g['examples']) >= 3,
            'G.q ≥4': len(g['quiz']) >= 4, 'V ≥8': len(d['vocab']) >= 8, 'VQ ≥4': len(d['vocabQuiz']) >= 4,
            'D ≥3': len(d['listening']['dictee']) >= 3, 'L ≥4': len(d['listening']['dialogue']) >= 4,
            'LQ ≥2': len(d['listening']['questions']) >= 2, 'RA ≥2': len(d['speaking']['readAloud']) >= 2,
            'SH ≥2': len(d['speaking']['shadowing']) >= 2, 'R ≥3': len(d['reading']['sentences']) >= 3,
            'RQ ≥2': len(d['reading']['questions']) >= 2, 'W.prompt': bool(d['writing']['prompt']),
            'W.model': bool(d['writing']['model']),
        }
        problems += [f'{tag}: thiếu {k}' for k, ok in need.items() if not ok]
        # every sentence shown with a translate button must have a translation
        shown = [g['rule'], *g['examples'], *(x['t'] for x in d['listening']['dialogue']), d['writing']['prompt'],
                 *(v['ex'] for v in d['vocab']), *d['reading']['sentences'], *d['writing']['model']]
        for s in shown:
            if s and s not in w['tr']:
                problems.append(f'{tag}: câu chưa có bản dịch / bị tách khác — "{s}"')
    if problems:
        raise Err('\n'.join(problems))


def main(args):
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(CONTENT.glob('week-*.txt'))
    if args:
        files = [CONTENT / f'week-{int(a):02d}.txt' for a in args]
    bad = 0
    for f in files:
        try:
            data = build_week(f)
            (OUT / f'week-{data["week"]:02d}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
            print(f'✓ {f.name}: {len(data["days"])} ngày, {len(data["tr"])} câu dịch')
        except Err as e:
            bad += 1
            print(f'✗ {f.name}\n{e}')
    if (CONTENT / 'dict.txt').exists():
        import build_dict
        build_dict.main()
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    main(sys.argv[1:])
