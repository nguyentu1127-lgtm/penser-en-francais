// Penser en Français — PWA, 100% offline, không dùng AI.
// Nội dung bài học nằm trong /data/weeks/*.json (sinh từ /content/*.txt bằng tools/build.py).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const MIN = 60e3, HOUR = 60 * MIN;
const SRS = { red: 5 * MIN, yellow: 24 * HOUR, green: 72 * HOUR };
const STEP_NAMES = ['Grammaire', 'Vocabulaire', 'Écoute', 'Parler', 'Lecture', 'Écriture'];

/* ---------------- State (localStorage) ---------------- */
const KEY = 'pef:v1';
const blank = () => ({
  progress: {},          // lessonId -> { steps: [bool x6], scores: {} }
  tests: {},             // week -> best score (0..1)
  cards: [],             // { id, fr, back, status: new|red|yellow|green, due, src }
  mistakes: [],          // { q, your, correct, src, at }
  writings: [],          // { at, prompt, text, score, hints }
  customWeeks: {},       // week -> week JSON (imported for preview)
  settings: { rate: 1 },
  streak: { last: '', count: 0 }
});
let S = load();
function load() {
  try {
    const s = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY)) || {});
    delete s.aiCache;
    return s;
  } catch { return blank(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch { toast('Bộ nhớ đầy — hãy xuất bản sao lưu và xoá bớt bài viết cũ.'); }
  updateBadge();
}
function touchStreak() {
  const today = new Date().toLocaleDateString('en-CA');
  if (S.streak.last === today) return;
  const y = new Date(Date.now() - 864e5).toLocaleDateString('en-CA');
  S.streak.count = S.streak.last === y ? S.streak.count + 1 : 1;
  S.streak.last = today;
}

/* ---------------- Data loading ---------------- */
let CURR, DICT = {};
const VOCAB_INDEX = {}, TR = {};
const weekCache = {};
const pad = n => String(n).padStart(2, '0');
const trKey = s => String(s).trim().replace(/[’]/g, "'").replace(/\s+/g, ' ');

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function loadWeek(n) {
  if (weekCache[n]) return weekCache[n];
  let w = S.customWeeks[n] || null;
  if (!w) { try { w = await getJSON(`/data/weeks/week-${pad(n)}.json`); } catch { w = null; } }
  if (w) { weekCache[n] = w; indexWeek(w); }
  return w;
}
function indexWeek(w) {
  for (const [fr, vi] of Object.entries(w.tr || {})) TR[trKey(fr)] = vi;
  for (const d of w.days || []) for (const v of d.vocab || []) {
    const entry = { l: v.fr, p: v.pos, v: v.vi, ex: v.ex, ipa: v.ipa };
    const low = v.fr.toLowerCase().replace(/’/g, "'");
    const bare = low.replace(/^(le|la|les|un|une|des|du|l')\s*/, '').trim();
    VOCAB_INDEX[low] = entry;
    if (!VOCAB_INDEX[bare]) VOCAB_INDEX[bare] = entry;
  }
}
const weekInfo = n => CURR.weeks.find(w => w.week === n);

/* ---------------- Speech (strict fr-FR, built into the phone) ---------------- */
let frVoice = null;
function pickVoice() {
  const vs = speechSynthesis?.getVoices?.() || [];
  const fr = vs.filter(v => v.lang.replace('_', '-').toLowerCase().startsWith('fr'));
  frVoice = fr.find(v => /fr-fr/i.test(v.lang.replace('_', '-')) && /google|amélie|thomas|audrey|marie|premium|enhanced/i.test(v.name))
    || fr.find(v => /fr-fr/i.test(v.lang.replace('_', '-'))) || fr[0] || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text, rate = S.settings.rate) {
  if (!('speechSynthesis' in window)) return toast('Trình duyệt không hỗ trợ đọc.');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR'; u.rate = rate;
  if (frVoice) u.voice = frVoice;
  speechSynthesis.speak(u);
  return new Promise(res => { u.onend = res; u.onerror = res; });
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen() {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error('Trình duyệt chưa hỗ trợ nhận giọng nói. Hãy dùng Chrome (Android) hoặc Safari (iPhone).'));
    const r = new SR(); r.lang = 'fr-FR'; r.interimResults = false; r.maxAlternatives = 3;
    r.onresult = e => resolve([...e.results[0]].map(a => a.transcript));
    r.onerror = e => reject(new Error(e.error === 'not-allowed' ? 'Hãy cho phép dùng micro.' : e.error === 'network' ? 'Nhận giọng nói cần mạng.' : 'Không nghe rõ, thử lại nhé.'));
    r.onend = () => resolve([]);
    r.start();
  });
}

/* ---------------- Text utils ---------------- */
const norm = s => String(s).toLowerCase().replace(/[’]/g, "'").replace(/[.,!?;:«»"()…]/g, ' ').replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(' ').filter(Boolean);
const TOKEN = /aujourd['’]hui|[a-zàâäçéèêëîïôöùûüÿœæ]+(?:-[a-zàâäçéèêëîïôöùûüÿœæ]+)*['’]?|\d+/gi;

function fr(text) {
  let out = '', last = 0;
  for (const m of String(text).matchAll(TOKEN)) {
    out += esc(text.slice(last, m.index)) + `<span class="w" data-w="${esc(m[0])}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(String(text).slice(last));
}
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  slow: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M10 2h4"/></svg>',
  tr: '<svg viewBox="0 0 24 24"><path d="M4 5h8M8 3v2m2.5 0c-1 4-3.5 7-6.5 8.5M6 9c1 2 3 4 5 5"/><path d="m13 21 4-9 4 9m-6.5-3h5"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'
};
function sentence(text) {
  return `<div class="sent" data-sent="${esc(text)}">
    <div class="fr">${fr(text)}<div class="vi tr-out" hidden></div></div>
    <div class="tools">
      <button class="icon-btn" data-say="${esc(text)}" title="Nghe">${ICON.play}</button>
      <button class="icon-btn" data-tr title="Dịch câu">${ICON.tr}</button>
    </div></div>`;
}

/* ---------------- Global click handling ---------------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-say],[data-slow],[data-tr],.w,[data-close]');
  if (!t) return;
  if (t.matches('[data-close]')) return closeSheet();
  if (t.dataset.say !== undefined) return speak(t.dataset.say);
  if (t.dataset.slow !== undefined) return speak(t.dataset.slow, 0.75);
  if (t.matches('.w')) return lookupWord(t);
  if (t.dataset.tr !== undefined) return translateSentence(t);
});

function translateSentence(btn) {
  const box = btn.closest('.sent'), out = $('.tr-out', box);
  if (!out.hidden) { out.hidden = true; return; }
  out.textContent = TR[trKey(box.dataset.sent)] || 'Chưa có bản dịch cho câu này — hãy chạm vào từng từ để tra.';
  out.hidden = false;
}

/* ---------------- Offline dictionary with simple lemmatizer ---------------- */
const SUFFIX = [
  // verbs -er
  ['ons', 'er'], ['ez', 'er'], ['ent', 'er'], ['es', 'er'], ['e', 'er'], ['é', 'er'], ['ée', 'er'], ['és', 'er'], ['ées', 'er'],
  ['ais', 'er'], ['ait', 'er'], ['aient', 'er'], ['ions', 'er'], ['iez', 'er'], ['ant', 'er'],
  ['erai', 'er'], ['eras', 'er'], ['era', 'er'], ['erons', 'er'], ['erez', 'er'], ['eront', 'er'],
  ['erais', 'er'], ['erait', 'er'], ['eraient', 'er'], ['ger', 'ger'], ['geons', 'ger'], ['çons', 'cer'],
  ['ète', 'eter'], ['ètes', 'eter'], ['ètent', 'eter'], ['ève', 'ever'], ['èvent', 'ever'], ['èle', 'eler'], ['elle', 'eler'], ['ellent', 'eler'],
  ['oie', 'oyer'], ['oies', 'oyer'], ['oient', 'oyer'], ['aie', 'ayer'], ['uie', 'uyer'],
  // verbs -ir (finir)
  ['is', 'ir'], ['it', 'ir'], ['issons', 'ir'], ['issez', 'ir'], ['issent', 'ir'], ['i', 'ir'], ['ie', 'ir'], ['issait', 'ir'], ['issais', 'ir'], ['irai', 'ir'], ['ira', 'ir'],
  // verbs -re / -dre
  ['ds', 'dre'], ['d', 'dre'], ['dons', 'dre'], ['dez', 'dre'], ['dent', 'dre'], ['du', 'dre'], ['due', 'dre'], ['drai', 'dre'],
  // nouns / adjectives
  ['s', ''], ['x', ''], ['e', ''], ['es', ''], ['nne', 'n'], ['nnes', 'n'], ['ne', 'n'], ['euse', 'eur'], ['euses', 'eur'],
  ['trice', 'teur'], ['euses', 'eux'], ['ales', 'al'], ['ale', 'al'], ['ve', 'f'], ['ves', 'f'], ['aux', 'al'], ['elle', 'el'], ['elles', 'el'], ['ère', 'er'], ['ères', 'er'],
  ['ière', 'ier'], ['ières', 'ier'], ['ette', 'et'], ['ienne', 'ien'], ['iennes', 'ien'], ['eaux', 'eau'], ['euse', 'eux'], ['ce', 'x'], ['sse', 's']
];
function dictGet(w) { return VOCAB_INDEX[w] || DICT[w] || null; }
function lookupEntry(raw) {
  let w = raw.toLowerCase().replace(/’/g, "'");
  let hit = dictGet(w);
  if (hit) return hit;
  const forms = [w, w.replace(/'$/, ''), w.replace(/^-/, '')];
  if (w.includes('-')) forms.push(...w.split('-'));
  for (const f of forms) {
    if (dictGet(f)) return dictGet(f);
    for (const [suf, rep] of SUFFIX) {
      if (f.length > suf.length + 1 && f.endsWith(suf)) {
        const cand = f.slice(0, -suf.length) + rep;
        const h = dictGet(cand);
        if (h) return { ...h, l: h.l || cand };
      }
    }
  }
  return null;
}
function lookupWord(span) {
  $$('.w.hl').forEach(x => x.classList.remove('hl'));
  span.classList.add('hl');
  const raw = span.dataset.w;
  let h = lookupEntry(raw);
  if (!h && /^\d+$/.test(raw)) h = { l: raw, p: 'nombre', v: 'con số ' + raw };
  else if (!h && raw.length === 1) h = { l: raw.toUpperCase(), p: 'lettre', v: 'chữ cái ' + raw.toUpperCase() };
  else if (!h && /^[A-ZÀ-Ý]/.test(raw)) h = { l: raw, p: 'nom propre', v: 'tên riêng (tên người, địa danh…)' };
  openSheet(wordCard(raw, h));
}
function wordCard(raw, h) {
  const lemma = h?.l || raw;
  return `<div class="spread"><div><div class="lemma">${esc(lemma)}</div>
      ${h?.l && h.l.toLowerCase() !== raw.toLowerCase() ? `<div class="muted small">dạng gặp: <b>${esc(raw)}</b></div>` : ''}
      ${h?.ipa ? `<div class="ipa">${esc(h.ipa)}</div>` : ''}</div>
      <div class="row"><button class="icon-btn" data-say="${esc(raw)}">${ICON.play}</button>
      <button class="icon-btn" data-slow="${esc(raw)}">${ICON.slow}</button></div></div>
    ${h ? `
      <p><span class="pos">${esc(h.p || '')}</span></p>
      <p style="font-size:1.1rem;font-weight:600">${esc(h.v || '')}</p>
      ${h.ex ? `<div class="sent" data-sent="${esc(h.ex)}"><div class="fr">${esc(h.ex)}</div><div class="tools"><button class="icon-btn" data-say="${esc(h.ex)}">${ICON.play}</button></div></div>` : ''}
      <button class="btn alt block" id="addCardBtn" data-fr="${esc(lemma)}" data-back="${esc(h.v || '')}">${ICON.plus} Thêm vào Flashcard</button>`
      : `<p class="muted">Từ này chưa có trong từ điển bỏ túi. Hãy bấm nút dịch câu (文A) để xem nghĩa cả câu, hoặc tự thêm vào Flashcard.</p>
      <button class="btn alt block" id="addCardBtn" data-fr="${esc(raw)}" data-back="">${ICON.plus} Thêm vào Flashcard (tự ghi nghĩa sau)</button>`}`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('#addCardBtn');
  if (!b) return;
  addCard(b.dataset.fr, b.dataset.back, 'tra từ') ? toast('Đã thêm vào Flashcard') : toast('Thẻ này đã có rồi');
  closeSheet();
});

function openSheet(html) { $('#sheet .sheet-body').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $$('.w.hl').forEach(x => x.classList.remove('hl')); }
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

/* ---------------- SRS cards ---------------- */
function addCard(frText, back, src, status = 'new') {
  const id = norm(frText);
  if (!id || S.cards.some(c => c.id === id)) return false;
  S.cards.push({ id, fr: frText, back, status, due: Date.now(), src });
  save(); return true;
}
const isDue = c => c.due <= Date.now();
function rateCard(id, level) {
  const c = S.cards.find(x => x.id === id); if (!c) return;
  c.status = level; c.due = Date.now() + SRS[level]; touchStreak(); save();
}
function fmtLeft(ms) {
  if (ms <= 0) return 'Đến hạn';
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h >= 1) return `Còn ${h} giờ ${m ? m + ' phút' : ''}`.trim();
  return `Còn ${m} phút ${s % 60}s`;
}
function updateBadge() {
  const n = S.cards.filter(isDue).length, b = $('#dueBadge');
  if (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }
}
setInterval(updateBadge, 15e3);

/* ---------------- Progress helpers ---------------- */
const prog = id => (S.progress[id] ||= { steps: [false, false, false, false, false, false], scores: {} });
const dayDone = id => !!S.progress[id]?.steps?.length && S.progress[id].steps.every(Boolean);
const dayPart = id => (S.progress[id]?.steps || []).some(Boolean);
const testPassed = n => (S.tests[n] || 0) >= CURR.passScore;
const unlocked = n => n === 1 || testPassed(n - 1);
const currentWeek = () => { let n = 1; while (n < 32 && testPassed(n)) n++; return n; };
function completeStep(lessonId, i, score) {
  const p = prog(lessonId); p.steps[i] = true;
  if (score != null) p.scores[i] = score;
  touchStreak(); save();
}

/* ---------------- Quiz component ---------------- */
function quiz(el, items, { src = '', onDone } = {}) {
  const sel = {};
  el.innerHTML = items.map((it, i) => `<div class="q" data-i="${i}">
      <div class="fr"><b>${i + 1}.</b> ${fr(it.q)}</div>
      ${it.options ? `<div class="opts">${it.options.map((o, j) => `<button class="opt" data-j="${j}">${fr(o)}</button>`).join('')}</div>`
      : `<input class="field" style="margin-top:8px" placeholder="Nhập câu trả lời…" autocapitalize="off" autocomplete="off" lang="fr">`}
      <div class="fb small" style="margin-top:6px"></div></div>`).join('')
    + `<button class="btn block" style="margin-top:12px" data-check>Kiểm tra</button><div class="result"></div>`;
  el.addEventListener('click', e => {
    const o = e.target.closest('.opt');
    if (o && !el.dataset.checked && !e.target.closest('.w')) {
      const q = o.closest('.q'); $$('.opt', q).forEach(x => x.classList.remove('sel'));
      o.classList.add('sel'); sel[q.dataset.i] = +o.dataset.j;
    }
    if (e.target.closest('[data-check]') && !el.dataset.checked) {
      el.dataset.checked = 1; let ok = 0;
      items.forEach((it, i) => {
        const q = $(`.q[data-i="${i}"]`, el), fb = $('.fb', q);
        let right, yours, correct;
        if (it.options) {
          right = sel[i] === it.answer; yours = it.options[sel[i]] ?? '—'; correct = it.options[it.answer];
          $$('.opt', q).forEach((x, j) => { if (j === it.answer) x.classList.add('ok'); else if (j === sel[i]) x.classList.add('ko'); });
        } else {
          const inp = $('input', q); yours = inp.value; inp.disabled = true;
          const acc = [].concat(it.answer); correct = acc[0];
          right = acc.some(a => norm(a) === norm(yours));
        }
        if (right) { ok++; fb.innerHTML = '<span class="ok-t">✓ Chính xác</span>'; }
        else {
          fb.innerHTML = `<span class="ko-t">✗</span> Đáp án: <b>${esc(correct)}</b>`;
          S.mistakes.unshift({ q: it.q, your: yours, correct, src, at: Date.now() });
          S.mistakes = S.mistakes.slice(0, 200);
        }
      });
      const score = ok / items.length; save();
      $('[data-check]', el).remove();
      $('.result', el).innerHTML = `<div class="card" style="margin-top:12px;text-align:center"><div class="score">${ok}/${items.length}</div><div class="muted">${score >= .8 ? 'Excellent ! 🎉' : score >= .5 ? 'Pas mal, continue !' : 'Courage, on révise !'}</div></div>`;
      onDone?.(score);
    }
  });
}

/* ---------------- Router ---------------- */
const routes = [
  [/^#?\/?$/, home],
  [/^#\/week\/(\d+)$/, m => weekView(+m[1])],
  [/^#\/lesson\/(\d+)\/(\d+)(?:\/(\d))?$/, m => lessonView(+m[1], +m[2], +(m[3] || 0))],
  [/^#\/test\/(\d+)$/, m => testView(+m[1])],
  [/^#\/light\/(\d+)$/, m => lightView(+m[1])],
  [/^#\/cards$/, cardsView],
  [/^#\/write$/, writeView],
  [/^#\/settings$/, settingsView]
];
let cleanup = null;
async function route() {
  cleanup?.(); cleanup = null; closeSheet(); speechSynthesis?.cancel?.();
  const h = location.hash || '#/';
  const tab = h.startsWith('#/cards') ? 'cards' : h.startsWith('#/write') ? 'write' : h.startsWith('#/settings') ? 'settings' : 'home';
  $$('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  for (const [re, fn] of routes) { const m = h.match(re); if (m) { await fn(m); window.scrollTo(0, 0); return; } }
  home();
}
window.addEventListener('hashchange', route);

/* ---------------- Views ---------------- */
function home() {
  const cw = currentWeek(), info = weekInfo(cw);
  const done = Object.keys(S.progress).filter(dayDone).length;
  const due = S.cards.filter(isDue).length;
  const passed = Object.keys(S.tests).filter(k => testPassed(+k)).length;
  const weekRow = w => {
    const st = testPassed(w.week) ? 'done' : w.week === cw ? 'current' : unlocked(w.week) ? '' : 'locked';
    return `<a class="card week ${st}" href="#/week/${w.week}">
      <div class="num">${testPassed(w.week) ? '✓' : w.week}</div>
      <div class="meta"><b>${esc(w.title)}</b><span class="muted small">${w.level} · ${st === 'locked' ? '🔒 Đạt ≥80% bài test tuần trước để mở' : esc(w.days.slice(0, 2).join(' · ')) + '…'}</span></div></a>`;
  };
  view.innerHTML = `
    <section class="hero">
      <div class="small" style="opacity:.8">Semaine ${cw} · ${info.level}</div>
      <h1>${esc(info.title)}</h1>
      <div class="stats">
        <div class="stat"><b>${S.streak.count}</b><span>ngày liên tiếp</span></div>
        <div class="stat"><b>${done}</b><span>buổi đã học</span></div>
        <div class="stat"><b>${due}</b><span>thẻ đến hạn</span></div>
      </div>
      <div class="row"><a class="btn" href="#/week/${cw}">Tiếp tục học →</a>${due ? `<a class="btn alt" style="color:#f6f1e7;border-color:rgba(255,255,255,.3)" href="#/cards">Ôn ${due} thẻ</a>` : ''}</div>
    </section>
    <div class="spread"><h2 style="margin:0">Lộ trình 32 tuần</h2><span class="muted small">${passed}/32 tuần</span></div>
    <div class="progress" style="margin:10px 0"><i style="width:${passed / 32 * 100}%"></i></div>
    <div class="phase">Giai đoạn 1 · A1 — Nền tảng sống còn (tuần 1–12)</div>
    ${CURR.weeks.filter(w => w.week <= 12).map(weekRow).join('')}
    <div class="phase">Giai đoạn 2 · A2 — Bứt phá phản xạ (tuần 13–32)</div>
    ${CURR.weeks.filter(w => w.week > 12).map(weekRow).join('')}`;
}

async function weekView(n) {
  const info = weekInfo(n);
  if (!info) return home();
  if (!unlocked(n)) {
    view.innerHTML = `<a class="back-link" href="#/">← Lộ trình</a><div class="card"><h2>🔒 Tuần ${n} đang khoá</h2><p>Hoàn thành bài kiểm tra tuần ${n - 1} với điểm ≥ 80% để mở khoá.</p><a class="btn" href="#/week/${n - 1}">Về tuần ${n - 1}</a></div>`;
    return;
  }
  view.innerHTML = '<p><span class="spinner"></span></p>';
  const w = await loadWeek(n);
  const days = info.days.map((title, i) => {
    const d = w?.days?.find(x => x.day === i + 1), id = `w${pad(n)}d${i + 1}`;
    const cls = dayDone(id) ? 'done' : dayPart(id) ? 'part' : '';
    return d
      ? `<a class="card day" href="#/lesson/${n}/${i + 1}"><span class="dot ${cls}"></span><div style="flex:1"><div class="muted small">Jour ${i + 1}</div><b>${esc(d.title || title)}</b></div><span class="muted">›</span></a>`
      : `<div class="card day" style="opacity:.6"><span class="dot"></span><div style="flex:1"><div class="muted small">Jour ${i + 1} · sắp có bài</div><b>${esc(title)}</b></div></div>`;
  }).join('');
  const best = S.tests[n];
  view.innerHTML = `<a class="back-link" href="#/">← Lộ trình</a>
    <div class="muted small">Semaine ${n} · ${info.level}</div><h1>${esc(info.title)}</h1>
    ${days}
    <a class="card day" href="#/test/${n}"><span class="dot ${testPassed(n) ? 'done' : best ? 'part' : ''}"></span><div style="flex:1"><div class="muted small">Jour 6 · Samedi</div><b>Test de la semaine</b><div class="muted small">${best != null ? `Điểm cao nhất: ${Math.round(best * 100)}%` : 'Đạt ≥ 80% để mở tuần tiếp theo'}</div></div><span class="muted">›</span></a>
    <a class="card day" href="#/light/${n}"><span class="dot"></span><div style="flex:1"><div class="muted small">Jour 7 · Dimanche</div><b>Journée légère — ôn nhẹ</b><div class="muted small">Thẻ đến hạn + lỗi sai đã mắc</div></div><span class="muted">›</span></a>`;
}

async function lessonView(n, dayN, step) {
  const w = await loadWeek(n), d = w?.days?.find(x => x.day === dayN);
  if (!d) return weekView(n);
  const p = prog(d.id);
  view.innerHTML = `<a class="back-link" href="#/week/${n}">← Semaine ${n}</a>
    <div class="muted small">Jour ${dayN}</div><h1>${esc(d.title)}</h1>
    <div class="steps">${STEP_NAMES.map((s, i) => `<button data-step="${i}" class="${i === step ? 'on' : ''} ${p.steps[i] ? 'done' : ''}"><b>${p.steps[i] ? '✓' : i + 1}</b>${s.slice(0, 7)}</button>`).join('')}</div>
    <div id="stepBody"></div>`;
  $$('[data-step]').forEach(b => b.onclick = () => location.replace(`#/lesson/${n}/${dayN}/${b.dataset.step}`));
  const body = $('#stepBody');
  const next = () => {
    const nx = p.steps.findIndex((x, i) => !x && i !== step);
    return `<div style="margin-top:14px">${step < 5 ? `<a class="btn block" href="#/lesson/${n}/${dayN}/${step + 1}">Bước tiếp: ${STEP_NAMES[step + 1]} →</a>`
      : dayDone(d.id) ? `<a class="btn block rouge" href="#/week/${n}">🎉 Hoàn thành buổi học!</a>` : nx >= 0 ? `<a class="btn block" href="#/lesson/${n}/${dayN}/${nx}">Còn bước ${nx + 1}: ${STEP_NAMES[nx]}</a>` : ''}</div>`;
  };
  const done = score => { completeStep(d.id, step, score); $$('[data-step]')[step].classList.add('done'); $$('[data-step]')[step].querySelector('b').textContent = '✓'; body.insertAdjacentHTML('beforeend', next()); };
  [stepGrammar, stepVocab, stepListening, stepSpeaking, stepReading, stepWriting][step](body, d, done, w);
}

function stepGrammar(el, d, done) {
  const g = d.grammar;
  el.innerHTML = `<div class="card"><h2>${esc(g.title)}</h2>${sentence(g.rule)}
      <details class="note"><summary>Giải thích bằng tiếng Việt</summary><p>${esc(g.note_vi || '')}</p></details>
      ${g.table ? `<table class="conj"><thead><tr>${g.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${g.table.rows.map(r => `<tr>${r.map(c => `<td>${fr(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}
      <h3>Exemples</h3>${g.examples.map(x => sentence(x)).join('')}</div>
    <div class="card"><h3>Pratique — ${g.quiz.length} questions</h3><div id="qz"></div></div>`;
  quiz($('#qz', el), g.quiz, { src: d.title, onDone: done });
}

function stepVocab(el, d, done) {
  el.innerHTML = `<div class="card"><div class="spread"><h2>Vocabulaire</h2><button class="chip" id="allCards">${ICON.plus} Thêm tất cả</button></div>
      ${d.vocab.map(v => `<div class="vocab"><div class="main"><div class="fr"><b>${fr(v.fr)}</b> <span class="pos">${esc(v.pos)}</span></div><div class="ipa">${esc(v.ipa)}</div>
        <details class="note" style="margin:6px 0 0;padding:6px 10px"><summary class="small">Nghĩa</summary>${esc(v.vi)}</details>
        ${v.ex ? sentence(v.ex) : ''}</div>
        <div class="tools" style="flex-direction:column"><button class="icon-btn" data-say="${esc(v.fr)}">${ICON.play}</button><button class="icon-btn" data-slow="${esc(v.fr)}" title="Nghe chậm">${ICON.slow}</button></div></div>`).join('')}</div>
    <div class="card"><h3>Consolidation</h3><div id="qz"></div></div>`;
  $('#allCards', el).onclick = () => { let k = 0; d.vocab.forEach(v => addCard(v.fr, `${v.vi} — ${v.ex}`, d.title) && k++); toast(k ? `Đã thêm ${k} thẻ` : 'Các thẻ đã có sẵn'); };
  quiz($('#qz', el), d.vocabQuiz, { src: d.title, onDone: s => { d.vocab.forEach(v => addCard(v.fr, `${v.vi} — ${v.ex}`, d.title)); done(s); } });
}

function diffHTML(target, said) {
  const tw = words(target), sw = new Set(words(said));
  let hit = 0;
  const html = target.split(/\s+/).map(tok => { const k = norm(tok); if (!k) return esc(tok); const ok = sw.has(k); ok && hit++; return `<span class="${ok ? 'ok' : 'ko'}">${esc(tok)}</span>`; }).join(' ');
  return { html, score: tw.length ? hit / tw.length : 0 };
}

function stepListening(el, d, done) {
  const L = d.listening;
  el.innerHTML = `<div class="card"><h2>Dictée</h2><p class="muted small">Nghe và chép lại chính xác (cả dấu). Bấm ⏱ để nghe chậm.</p>
      ${L.dictee.map((s, i) => `<div class="q" data-i="${i}"><div class="row"><button class="icon-btn" data-say="${esc(s)}">${ICON.play}</button><button class="icon-btn" data-slow="${esc(s)}">${ICON.slow}</button><input class="field" style="flex:1" autocapitalize="off" autocomplete="off" spellcheck="false" lang="fr"></div><div class="fb small diff" style="margin-top:6px"></div></div>`).join('')}
      <button class="btn block" id="chkD" style="margin-top:10px">Kiểm tra chính tả</button></div>
    <div class="card"><div class="spread"><h2>Dialogue</h2><button class="btn alt" id="playAll">${ICON.play} Nghe cả bài</button></div>
      <details class="note"><summary>Hiện lời thoại (nên nghe trước 2 lần)</summary>${L.dialogue.map(x => `<div class="small muted" style="margin-top:6px">${esc(x.s)}</div>${sentence(x.t)}`).join('')}</details>
      <div id="qz"></div></div>`;
  let dScore = 0;
  $('#chkD', el).onclick = () => {
    let sum = 0;
    L.dictee.forEach((s, i) => { const q = $(`.q[data-i="${i}"]`, el), v = $('input', q).value; const exact = norm(v) === norm(s);
      const r = diffHTML(s, v); sum += exact ? 1 : r.score; $('.fb', q).innerHTML = exact ? '<span class="ok-t">✓ Parfait</span>' : r.html; });
    dScore = sum / L.dictee.length; toast(`Dictée: ${Math.round(dScore * 100)}%`);
  };
  let playing = false;
  $('#playAll', el).onclick = async () => { if (playing) { playing = false; speechSynthesis.cancel(); return; } playing = true; for (const x of L.dialogue) { if (!playing) break; await speak(x.t); await new Promise(r => setTimeout(r, 350)); } playing = false; };
  cleanup = () => { playing = false; };
  quiz($('#qz', el), L.questions, { src: d.title, onDone: s => done((s + dScore) / 2) });
}

function stepSpeaking(el, d, done) {
  const P = d.speaking;
  const lines = [...P.readAloud.map(t => ['Đọc to', t]), ...P.shadowing.map(t => ['Shadowing', t])];
  el.innerHTML = `<div class="card"><h2>Lire à voix haute & Shadowing</h2>
      <p class="muted small">1) Bấm 🔊 nghe mẫu. 2) Bấm 🎤 rồi đọc theo. Từ xanh = máy nghe đúng, từ đỏ = cần đọc lại.</p>
      ${lines.map(([k, t], i) => `<div class="q" data-i="${i}"><div class="tag">${k}</div><div class="spread"><div class="fr diff" style="flex:1">${esc(t)}</div><div class="tools"><button class="icon-btn" data-say="${esc(t)}">${ICON.play}</button><button class="icon-btn" data-slow="${esc(t)}">${ICON.slow}</button><button class="icon-btn mic" data-mic="${i}">${ICON.mic}</button></div></div><div class="fb small muted"></div></div>`).join('')}
      <button class="btn block" id="spDone" style="margin-top:12px">Hoàn thành bước Nói</button>
      <p class="muted small" style="margin-top:8px">Không có micro? Cứ nghe và nhại theo thành tiếng rồi bấm hoàn thành.</p></div>`;
  const scores = {};
  $$('[data-mic]', el).forEach(b => b.onclick = async () => {
    const i = +b.dataset.mic, q = b.closest('.q'), target = lines[i][1];
    b.classList.add('rec');
    try {
      const alts = await listen(); b.classList.remove('rec');
      if (!alts.length) return;
      const best = alts.map(a => diffHTML(target, a)).sort((x, y) => y.score - x.score)[0];
      scores[i] = Math.max(scores[i] || 0, best.score); $('.fr', q).innerHTML = best.html;
      $('.fb', q).innerHTML = `Máy nghe: « ${esc(alts[0])} » — <b>${Math.round(best.score * 100)}%</b>`;
    } catch (err) { b.classList.remove('rec'); toast(err.message); }
  });
  $('#spDone', el).onclick = e => { e.target.remove(); const v = Object.values(scores); done(v.length ? v.reduce((a, b) => a + b, 0) / v.length : null); };
}

const splitSentences = text => (String(text).match(/[^.!?…]+(?:[.!?…]+|$)(?:\s*»)?/g) || [text]).map(s => s.trim()).filter(Boolean);

function stepReading(el, d, done) {
  const R = d.reading;
  el.innerHTML = `<div class="card"><div class="spread"><h2>${esc(R.title)}</h2><button class="icon-btn" data-say="${esc(R.text)}">${ICON.play}</button></div>
      <p class="muted small">Chạm vào từ để tra nghĩa. Chỉ dịch cả câu khi thật cần.</p>${(R.sentences || splitSentences(R.text)).map(s => sentence(s)).join('')}</div>
    <div class="card"><h3>Compréhension</h3><div id="qz"></div></div>`;
  quiz($('#qz', el), R.questions, { src: d.title, onDone: done });
}

/* ---------------- Writing: self-check, no AI ---------------- */
const ACCENTS = {
  etudiant: 'étudiant', etudiante: 'étudiante', etudiants: 'étudiants', ecole: 'école', francais: 'français', francaise: 'française',
  tres: 'très', frere: 'frère', freres: 'frères', mere: 'mère', pere: 'père', cafe: 'café', ete: 'été', etre: 'être', etes: 'êtes',
  deja: 'déjà', voila: 'voilà', prenom: 'prénom', telephone: 'téléphone', numero: 'numéro', eleve: 'élève', apres: 'après',
  bientot: 'bientôt', enchante: 'enchanté', enchantee: 'enchantée', fete: 'fête', hotel: 'hôtel', noel: 'Noël', soeur: 'sœur',
  age: 'âge', theatre: 'théâtre', methode: 'méthode', premiere: 'première', derniere: 'dernière', the: 'thé', diner: 'dîner',
  dejeuner: 'déjeuner', reveil: 'réveil', aeroport: 'aéroport', etranger: 'étranger', ecrire: 'écrire', ecoute: 'écoute',
  ecouter: 'écouter', preferer: 'préférer', prefere: 'préfère', general: 'général', medecin: 'médecin', telephoner: 'téléphoner',
  pharmacie: null, fenetre: 'fenêtre', foret: 'forêt', meme: 'même', genial: 'génial', different: 'différent', interessant: 'intéressant'
};
const ELISION_WORDS = /^(?:[aeiouyàâéèêëîïôœ]|h(?:abite|abiter|eure|ier|istoire|omme|ôtel|ôpital|iver|abitude))/i;
const NUMS = 'un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix-sept|dix-huit|dix-neuf|vingt|trente|quarante|cinquante|soixante';
const RULES = [
  [/\bje es\b/i, '« je es » → « je suis » (être: je suis, tu es, il est).'],
  [/\btu est\b/i, '« tu est » → « tu es ».'],
  [/\b(il|elle|on) es\b/i, '« il/elle es » → « il/elle est ».'],
  [/\bnous (est|sont|êtes|etes)\b/i, 'Với nous: « nous sommes ».'],
  [/\bvous (est|sont|sommes)\b/i, 'Với vous: « vous êtes ».'],
  [/\b(ils|elles) (est|es|sommes)\b/i, 'Với ils/elles: « ils sont ».'],
  [/\bje a\b/i, '« je a » → « j\'ai ».'],
  [/\btu a\b/i, '« tu a » → « tu as ».'],
  [/\b(ils|elles) a\b/i, 'Với ils/elles: « ils ont ».'],
  [/\bnous a\b/i, 'Với nous: « nous avons ».'],
  [new RegExp(`\\b(je suis|tu es|il est|elle est)\\s+(\\d+|${NUMS})(?:\\S*)\\s+ans\\b`, 'i'), 'Nói tuổi dùng avoir: « j\'ai 20 ans », không dùng être.'],
  [/\bje\s+([a-zàâéèêëîïôœ]+)/i, null], // elision check handled specially
  [/\b(de|à) le\b/i, '« de le » → « du », « à le » → « au ».'],
  [/\b(de|à) les\b/i, '« de les » → « des », « à les » → « aux ».'],
  [/\b(le|la)\s+(?=[aeiouyéèêâ])/i, 'Trước nguyên âm: « le/la » → « l\' » (l\'école, l\'ami).'],
  [/\bde\s+(?=[aeiouyéèê])/i, 'Trước nguyên âm: « de » → « d\' » (d\'accord, d\'abord).'],
  [/\bque\s+(?=[aeiouyéèê])/i, 'Trước nguyên âm: « que » → « qu\' ».'],
  [/\bne\s+(?=[aeiouyéèê])/i, 'Trước nguyên âm: « ne » → « n\' » (je n\'aime pas).'],
  [/\bsi il\b/i, '« si il » → « s\'il ».'],
  [/\bca va\b/i, '« ca va » → « ça va » (có dấu cédille).'],
  [/\bou est\b/i, 'Hỏi ở đâu: « où est » (có dấu huyền).']
];
function writingHints(text) {
  const hints = [];
  for (const [re, msg] of RULES) {
    if (!msg) {
      for (const m of text.matchAll(/\bje\s+([a-zàâéèêëîïôœ]+)/gi)) if (ELISION_WORDS.test(m[1]) && !/^(es|est|a|as|et|en|ou|à|au|aux)$/i.test(m[1])) { hints.push(`« je ${m[1]} » → « j'${m[1]} » (je + nguyên âm hoặc h câm → j').`); break; }
      continue;
    }
    if (re.test(text)) hints.push(msg);
  }
  const accentHits = [...new Set((text.toLowerCase().match(/[a-z]+/g) || []).filter(w => ACCENTS[w]))];
  if (accentHits.length) hints.push('Thiếu dấu: ' + accentHits.map(w => `${w} → ${ACCENTS[w]}`).join(', ') + '.');
  if (/\bne\b|\bn'/i.test(text) && !/\b(pas|plus|jamais|rien|personne|que|qu')\b/i.test(text)) hints.push('Câu phủ định cần đủ 2 phần: ne … pas.');
  const sents = splitSentences(text);
  if (sents.some(s => /^[a-zàâéèêç]/.test(s))) hints.push('Viết hoa chữ cái đầu câu.');
  if (text.trim() && !/[.!?…»]$/.test(text.trim())) hints.push('Kết thúc câu bằng dấu chấm (.), chấm hỏi (?) hoặc chấm than (!).');
  return hints;
}
const countWords = t => (t.trim().match(/[\wÀ-ÿœ'’-]+/g) || []).length;

function writingForm(el, { W = {}, onDone }) {
  const draftKey = 'draft:' + (W.prompt || 'lab');
  el.innerHTML = `${W.prompt ? sentence(W.prompt) : ''}
    <textarea class="field" id="wTxt" placeholder="Écris en français…" spellcheck="true" lang="fr" autocapitalize="sentences" style="margin-top:10px"></textarea>
    <div class="spread small muted" style="margin:6px 0 10px"><span id="wc">0 mot</span><span>${W.minWords ? `Tối thiểu ${W.minWords} từ` : ''}</span></div>
    ${W.mustUse?.length ? `<p class="small">Cần dùng: ${W.mustUse.map(m => `<span class="pos">${esc(m)}</span>`).join(' ')}</p>` : ''}
    <button class="btn block rouge" id="wGo">Kiểm tra bài viết</button><div id="wRes"></div>`;
  const ta = $('#wTxt', el), wc = $('#wc', el);
  try { ta.value = localStorage.getItem(draftKey) || ''; } catch {}
  const upd = () => { const n = countWords(ta.value); wc.textContent = `${n} mot${n > 1 ? 's' : ''}`; try { localStorage.setItem(draftKey, ta.value); } catch {} };
  ta.oninput = upd; upd();
  $('#wGo', el).onclick = () => {
    const text = ta.value.trim();
    if (countWords(text) < 3) return toast('Viết thêm một chút nhé!');
    const n = countWords(text), low = norm(text);
    const auto = [];
    if (W.minWords) auto.push([n >= W.minWords, `Độ dài: ${n}/${W.minWords} từ`]);
    for (const m of W.mustUse || []) auto.push([low.includes(norm(m)), `Có dùng « ${m} »`]);
    const hints = writingHints(text);
    auto.push([hints.length === 0, hints.length ? `${hints.length} gợi ý cần xem lại` : 'Không phát hiện lỗi thường gặp']);
    const checklist = W.checklist || ['Mỗi câu có chủ ngữ và động từ', 'Động từ chia đúng theo chủ ngữ', 'Giống đực/giống cái của danh từ, tính từ khớp nhau', 'Đã đọc to bài viết một lần'];
    $('#wRes', el).innerHTML = `<div class="card" style="margin-top:14px">
      <h3>Kiểm tra tự động</h3>${auto.map(([ok, t]) => `<div class="small">${ok ? '<span class="ok-t">✓</span>' : '<span class="ko-t">✗</span>'} ${esc(t)}</div>`).join('')}
      ${hints.length ? `<h3 style="margin-top:12px">Gợi ý sửa</h3>${hints.map(h => `<div class="err-item small">${esc(h)}</div>`).join('')}<p class="muted small">Gợi ý dựa trên quy tắc, đôi khi có thể báo nhầm.</p>` : ''}
      ${W.model?.length ? `<h3 style="margin-top:12px">Bài mẫu để so sánh</h3>${[].concat(W.model).map(s => sentence(s)).join('')}` : ''}
      <h3 style="margin-top:12px">Tự kiểm tra</h3>
      ${checklist.map((c, i) => `<label class="row small" style="padding:4px 0;flex-wrap:nowrap"><input type="checkbox" data-ck="${i}" style="width:20px;height:20px;flex:none"> <span>${esc(c)}</span></label>`).join('')}
      <button class="btn block" id="wSave" style="margin-top:10px">Lưu bài & hoàn thành</button></div>`;
    $('#wSave', el).onclick = e => {
      const ticked = $$('[data-ck]', el).filter(x => x.checked).length;
      const score = (auto.filter(a => a[0]).length + ticked) / (auto.length + checklist.length);
      S.writings.unshift({ at: Date.now(), prompt: W.prompt || '', text, score: Math.round(score * 100) / 10, hints });
      S.writings = S.writings.slice(0, 50);
      hints.forEach(h => S.mistakes.unshift({ q: '✍️ ' + text.slice(0, 80), your: '', correct: h, src: 'Écriture', at: Date.now() }));
      S.mistakes = S.mistakes.slice(0, 200);
      save(); try { localStorage.removeItem(draftKey); } catch {}
      e.target.remove(); toast(`Đã lưu bài — ${Math.round(score * 100)}%`);
      onDone?.(score);
    };
  };
}
function stepWriting(el, d, done) {
  el.innerHTML = '<div class="card"><h2>Écriture</h2><div id="wf"></div></div>';
  writingForm($('#wf', el), { W: d.writing, onDone: done });
}

async function testView(n) {
  const w = await loadWeek(n);
  if (!w?.days?.length) { view.innerHTML = `<a class="back-link" href="#/week/${n}">← Semaine ${n}</a><div class="card">Chưa có bài học nào cho tuần này.</div>`; return; }
  const pool = w.days.flatMap(d => [...d.grammar.quiz, ...d.vocabQuiz, ...d.listening.questions, ...d.reading.questions]);
  const items = pool.sort(() => Math.random() - .5).slice(0, 20);
  view.innerHTML = `<a class="back-link" href="#/week/${n}">← Semaine ${n}</a><h1>Test — Semaine ${n}</h1>
    <p class="muted">${items.length} câu tổng hợp cả tuần. Đạt ≥ ${CURR.passScore * 100}% để mở khoá tuần ${n + 1}. Mỗi lần làm, câu hỏi được xáo trộn.</p>
    <div class="card"><div id="qz"></div></div><div id="after"></div>`;
  quiz($('#qz'), items, { src: `Test S${n}`, onDone: s => {
    S.tests[n] = Math.max(S.tests[n] || 0, s); touchStreak(); save();
    $('#after').innerHTML = s >= CURR.passScore
      ? `<div class="card" style="text-align:center"><h2>🎉 Tuần ${n + 1} đã mở khoá!</h2><a class="btn rouge" href="#/week/${n + 1}">Bắt đầu tuần ${n + 1}</a></div>`
      : `<div class="card" style="text-align:center"><p>Chưa đạt 80%. Ôn lại lỗi sai rồi làm lại nhé.</p><div class="row" style="justify-content:center"><a class="btn alt" href="#/light/${n}">Ôn lỗi sai</a><button class="btn" onclick="location.reload()">Làm lại</button></div></div>`;
  } });
}

async function lightView(n) {
  const due = S.cards.filter(isDue).length;
  const ms = S.mistakes.slice(0, 30);
  view.innerHTML = `<a class="back-link" href="#/week/${n}">← Semaine ${n}</a><h1>Journée légère</h1>
    <p class="muted">Chủ Nhật thư giãn: ôn thẻ đến hạn và xem lại lỗi từng mắc.</p>
    <a class="card day" href="#/cards"><span class="dot ${due ? 'part' : 'done'}"></span><div style="flex:1"><b>${due} thẻ đến hạn ôn</b><div class="muted small">Flashcard SRS</div></div><span>›</span></a>
    <div class="card"><div class="spread"><h2>Lỗi sai gần đây</h2>${ms.length ? '<button class="chip" id="clrM">Xoá danh sách</button>' : ''}</div>
      ${ms.length ? ms.map(m => `<div class="err-item"><div class="small muted">${esc(m.src)}</div><div class="fr">${fr(m.q)}</div><div class="small">${m.your ? `Bạn: <s>${esc(m.your)}</s> → ` : ''}<b class="ok-t">${esc(m.correct)}</b></div></div>`).join('') : '<p class="muted">Chưa có lỗi nào được ghi lại. Bravo !</p>'}</div>`;
  $('#clrM')?.addEventListener('click', () => { if (confirm('Xoá danh sách lỗi sai?')) { S.mistakes = []; save(); lightView(n); } });
}

function cardsView() {
  let filter = S.cards.some(isDue) ? 'due' : 'all', flipped = false;
  const F = { due: 'Đến hạn ôn', red: 'Chưa nhớ', yellow: 'Mới học', green: 'Đã thuộc', all: 'Tất cả' };
  const list = () => S.cards.filter(c => filter === 'all' ? true : filter === 'due' ? isDue(c) : c.status === filter).sort((a, b) => a.due - b.due);
  const render = () => {
    const L = list(), cur = filter === 'due' ? L[0] : null;
    view.innerHTML = `<div class="spread"><h1>Flashcard</h1><button class="btn alt" id="addC">${ICON.plus} Thêm từ</button></div>
      <div class="filters">${Object.entries(F).map(([k, v]) => `<button class="chip ${k === filter ? 'on' : ''}" data-f="${k}">${v} · ${k === 'all' ? S.cards.length : k === 'due' ? S.cards.filter(isDue).length : S.cards.filter(c => c.status === k).length}</button>`).join('')}</div>
      ${cur ? `<div class="card flash" id="flash"><div>${flipped
          ? `<div class="face" style="font-size:1.3rem">${esc(cur.fr)}</div><div class="back" style="margin-top:12px">${esc(cur.back || '(chưa ghi nghĩa — bấm Sửa ở danh sách bên dưới)')}</div>`
          : `<div class="face">${esc(cur.fr)}</div><div class="muted small" style="margin-top:12px">Chạm để lật thẻ</div>`}</div></div>
        <div class="row" style="justify-content:center;margin-bottom:12px"><button class="icon-btn" data-say="${esc(cur.fr)}">${ICON.play}</button><button class="icon-btn" data-slow="${esc(cur.fr)}">${ICON.slow}</button></div>
        ${flipped ? `<div class="rate"><button class="r-red" data-r="red">Chưa nhớ<small>ôn sau 5 phút</small></button><button class="r-yellow" data-r="yellow">Mới học<small>ôn sau 24 giờ</small></button><button class="r-green" data-r="green">Đã thuộc<small>ôn sau 3 ngày</small></button></div>` : ''}`
      : filter === 'due' ? `<div class="card" style="text-align:center"><h2>✨ Hết thẻ đến hạn</h2><p class="muted">${S.cards.length ? 'Quay lại khi đồng hồ đếm ngược về 0.' : 'Học phần Vocabulaire hoặc chạm một từ → "Thêm vào Flashcard".'}</p></div>` : ''}
      <div class="card clist">${L.length ? L.map(c => `<div class="item"><div><span class="st ${c.status}"></span><b>${esc(c.fr)}</b><div class="small muted">${esc((c.back || '').slice(0, 70))}</div></div><div class="small muted" style="text-align:right;flex:none"><span data-cd="${c.due}">${fmtLeft(c.due - Date.now())}</span><br><button class="chip" data-edit="${esc(c.id)}" style="margin-top:4px">Sửa</button> <button class="chip" data-reset="${esc(c.id)}" style="margin-top:4px">Reset</button></div></div>`).join('') : '<p class="muted">Không có thẻ nào ở mục này.</p>'}</div>`;
    $$('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; flipped = false; render(); });
    $('#flash')?.addEventListener('click', () => { flipped = !flipped; render(); });
    $$('[data-r]').forEach(b => b.onclick = () => { rateCard(cur.id, b.dataset.r); flipped = false; render(); });
    $$('[data-reset]').forEach(b => b.onclick = () => { const c = S.cards.find(x => x.id === b.dataset.reset); c.status = 'new'; c.due = Date.now(); save(); render(); });
    const editor = c => {
      openSheet(`<h2>${c ? 'Sửa thẻ' : 'Thêm từ của bạn'}</h2><div class="stack"><input class="field" id="nf" placeholder="Mặt trước: từ tiếng Pháp" lang="fr" value="${esc(c?.fr || '')}"><textarea class="field" id="nb" style="min-height:90px" placeholder="Mặt sau: giải thích nghĩa, ví dụ…">${esc(c?.back || '')}</textarea><button class="btn block" id="ns">Lưu thẻ</button>${c ? '<button class="btn alt block" id="nd" style="color:var(--red)">Xoá thẻ</button>' : ''}</div>`);
      $('#ns').onclick = () => {
        const f = $('#nf').value.trim(), b = $('#nb').value.trim(); if (!f) return;
        if (c) { c.fr = f; c.back = b; save(); toast('Đã lưu'); } else addCard(f, b, 'tự thêm') ? toast('Đã thêm thẻ') : toast('Thẻ đã tồn tại');
        closeSheet(); render();
      };
      $('#nd')?.addEventListener('click', () => { S.cards = S.cards.filter(x => x !== c); save(); closeSheet(); render(); });
    };
    $$('[data-edit]').forEach(b => b.onclick = () => editor(S.cards.find(x => x.id === b.dataset.edit)));
    $('#addC').onclick = () => editor(null);
  };
  render();
  const t = setInterval(() => {
    $$('[data-cd]').forEach(s => s.textContent = fmtLeft(+s.dataset.cd - Date.now()));
    if (filter === 'due' && !flipped && !$('#flash') && S.cards.some(isDue)) render();
  }, 1000);
  cleanup = () => clearInterval(t);
}

function writeView() {
  view.innerHTML = `<h1>Writing Lab</h1><p class="muted">Viết tự do bằng tiếng Pháp. App kiểm tra các lỗi thường gặp (chia être/avoir, lược âm, dấu, viết hoa…). Bàn phím điện thoại sẽ gạch chân từ sai chính tả nếu bạn bật thêm tiếng Pháp.</p>
    <div class="card"><div id="wf"></div></div>
    <h2>Lịch sử bài viết</h2>${S.writings.length ? S.writings.slice(0, 15).map(x => `<details class="card"><summary><b>${x.score ?? x.result?.score ?? '–'}/10</b> · <span class="muted small">${new Date(x.at).toLocaleString('vi-VN')}</span><div class="small" style="margin-top:4px">${esc(x.text.slice(0, 90))}…</div></summary><p class="fr">${esc(x.text)}</p>${(x.hints || []).map(h => `<div class="err-item small">${esc(h)}</div>`).join('')}</details>`).join('') : '<p class="muted">Chưa có bài viết nào.</p>'}`;
  writingForm($('#wf'), { W: {}, onDone: () => {} });
}

function settingsView() {
  const vs = (speechSynthesis?.getVoices?.() || []).filter(v => v.lang.toLowerCase().replace('_', '-').startsWith('fr'));
  view.innerHTML = `<h1>Cài đặt</h1>
    <div class="card stack"><h2>Phát âm (fr-FR)</h2>
      <p class="small">${frVoice ? `Đang dùng giọng: <b>${esc(frVoice.name)}</b> (${esc(frVoice.lang)})` : '<span class="ko-t">Máy chưa có giọng tiếng Pháp.</span> iPhone: Cài đặt → Trợ năng → Nội dung được đọc → Giọng nói → Tiếng Pháp. Android: Cài đặt → Hệ thống → Ngôn ngữ → Chuyển văn bản thành lời nói → tải gói Tiếng Pháp.'}</p>
      ${vs.length > 1 ? `<select class="field" id="voiceSel">${vs.map(v => `<option ${v === frVoice ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>` : ''}
      <div class="row"><button class="chip ${S.settings.rate === .75 ? 'on' : ''}" data-rate=".75">Chậm 0.75×</button><button class="chip ${S.settings.rate === 1 ? 'on' : ''}" data-rate="1">Tự nhiên 1.0×</button><button class="btn alt" data-say="Bonjour ! Je m'appelle Claire. Ça va bien ?">Nghe thử</button></div></div>
    <div class="card stack"><h2>Lưu trữ & sao lưu</h2>
      <p class="small muted">Tiến độ lưu ngay trên máy (offline được). Xuất file sao lưu để chuyển sang điện thoại khác.</p>
      <div class="grid2"><button class="btn alt" id="exp">Xuất sao lưu</button><label class="btn alt">Nhập sao lưu<input type="file" id="imp" accept=".json" hidden></label></div>
      <button class="btn alt" id="offline">Tải mọi bài học để học offline</button></div>
    <div class="card stack"><h2>Cải tiến bài học</h2>
      <p class="small muted">Nhập file week-XX.json để xem trước bài đã sửa trên máy này. Khi ưng ý, đưa file lên GitHub thư mục <code>data/weeks/</code> — Vercel tự cập nhật cho mọi máy.</p>
      <label class="btn alt">Nhập JSON tuần<input type="file" id="impW" accept=".json" hidden></label>
      ${Object.keys(S.customWeeks).length ? `<p class="small">Đang ghi đè cục bộ: tuần ${Object.keys(S.customWeeks).join(', ')}</p><button class="btn alt" id="clrW">Bỏ ghi đè, dùng bản GitHub</button>` : ''}</div>
    <div class="card stack"><h2>Vùng nguy hiểm</h2><button class="btn alt" id="reset" style="color:var(--red)">Xoá toàn bộ tiến độ</button></div>
    <p class="muted small" style="text-align:center">Penser en Français · 100% offline, không dùng AI</p>`;
  $('#voiceSel')?.addEventListener('change', e => { frVoice = vs.find(v => v.name === e.target.value); });
  $$('[data-rate]').forEach(b => b.onclick = () => { S.settings.rate = +b.dataset.rate; save(); setSpeed(); settingsView(); });
  $('#exp').onclick = () => download(`francais-backup-${new Date().toLocaleDateString('en-CA')}.json`, S);
  $('#imp').onchange = async e => { try { const d = JSON.parse(await e.target.files[0].text()); if (!d.progress) throw 0; S = Object.assign(blank(), d); save(); toast('Đã khôi phục sao lưu'); route(); } catch { toast('File không hợp lệ'); } };
  $('#impW').onchange = async e => { try { const d = JSON.parse(await e.target.files[0].text()); if (!d.week || !Array.isArray(d.days)) throw 0; S.customWeeks[d.week] = d; delete weekCache[d.week]; save(); toast(`Đã nạp tuần ${d.week}`); settingsView(); } catch { toast('JSON tuần không hợp lệ (cần "week" và "days")'); } };
  $('#clrW')?.addEventListener('click', () => { S.customWeeks = {}; Object.keys(weekCache).forEach(k => delete weekCache[k]); save(); settingsView(); });
  $('#offline').onclick = async e => { e.target.disabled = true; let k = 0; for (let i = 1; i <= 32; i++) { try { await loadWeek(i) && k++; } catch {} } toast(`Đã lưu ${k} tuần bài học để dùng offline`); e.target.disabled = false; };
  $('#reset').onclick = () => { if (confirm('Xoá toàn bộ tiến độ, thẻ và bài viết? Không thể hoàn tác.')) { localStorage.removeItem(KEY); S = blank(); save(); route(); } };
}

function download(name, obj) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function setSpeed() { $('#speedBtn').textContent = (S.settings.rate === 1 ? '1.0' : S.settings.rate) + '×'; }
$('#speedBtn').onclick = () => { S.settings.rate = S.settings.rate === 1 ? .75 : 1; save(); setSpeed(); toast(`Tốc độ đọc ${S.settings.rate}×`); };

/* Expand the compact dictionary: words + verb table → DICT[form] = {l, p, v} */
function expandDict(raw) {
  if (!raw || !raw.w) return raw || {};
  const D = {};
  const PERS = ['je', 'tu', 'il/elle', 'nous', 'vous', 'ils/elles'];
  const IMP = ['ais', 'ais', 'ait', 'ions', 'iez', 'aient'], FUT = ['ai', 'as', 'a', 'ons', 'ez', 'ont'];
  for (const [inf, vi, pres, pp, imp, fut] of raw.v) {
    const add = (f, label) => { if (!f || f === '-') return; f = f.toLowerCase(); if (!D[f]) D[f] = { l: inf, p: 'verbe', v: `${vi} — ${label}` }; };
    D[inf] = { l: inf, p: 'verbe (nguyên thể)', v: vi };
    for (const pre of ['se ', "s'"]) if (inf.startsWith(pre)) D[inf.slice(pre.length)] = D[inf];
    const ps = pres.split(',');
    ps.length === 1 ? add(ps[0], 'hiện tại, il') : ps.forEach((f, i) => add(f, `hiện tại, ${PERS[i]}`));
    for (const x of pp.endsWith('s') ? [pp, pp + 'e', pp + 'es'] : [pp, pp + 'e', pp + 's', pp + 'es']) add(x, 'phân từ quá khứ');
    IMP.forEach((e, i) => add(imp + e, `imparfait, ${PERS[i]}`));
    FUT.forEach((e, i) => add(fut + e, `tương lai đơn, ${PERS[i]}`));
    IMP.forEach((e, i) => add(fut + e, `điều kiện, ${PERS[i]}`));
  }
  for (const [k, [l, p, v]] of Object.entries(raw.w)) {
    if (!D[k]) D[k] = { l: l || k, p, v };
    else if (D[k].p === 'verbe' && !p.startsWith('verbe')) D[k] = { ...D[k], v: `${D[k].v} • ${l || k} (${p}): ${v}` };
  }
  return D;
}

/* ---------------- Boot ---------------- */
(async function boot() {
  try {
    let raw;
    [CURR, raw] = await Promise.all([getJSON('/data/curriculum.json'), getJSON('/data/dict.json').catch(() => ({}))]);
    DICT = expandDict(raw);
  } catch {
    view.innerHTML = '<div class="card">Không tải được lộ trình. Kiểm tra kết nối mạng rồi mở lại.</div>'; return;
  }
  window.__pef = { lookupEntry, TR };
  setSpeed(); updateBadge();
  await loadWeek(currentWeek());
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
