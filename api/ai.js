import { askGemini } from './_gemini.js';

// One endpoint, several tasks: grade | lookup | translate | roleplay | lesson
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Optional protection so strangers can't spend your Gemini quota.
  const code = process.env.APP_ACCESS_CODE;
  if (code && req.headers['x-app-code'] !== code) {
    return res.status(401).json({ error: 'Sai mã truy cập AI (Cài đặt → Mã truy cập).' });
  }

  const { task, ...p } = req.body || {};
  try {
    const out = await TASKS[task]?.(p);
    if (!out) return res.status(400).json({ error: 'Unknown task' });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}

const clip = (s, n) => String(s || '').slice(0, n);

const TASKS = {
  async grade({ text, prompt, level = 'A1' }) {
    return askGemini({
      system:
        'Tu es un professeur de FLE bienveillant et exigeant pour des apprenants vietnamiens. ' +
        'Réponds UNIQUEMENT en JSON. Les explications des erreurs sont en vietnamien, courtes et claires.',
      prompt: `Niveau de l'apprenant : ${level}
Consigne : ${clip(prompt, 500) || 'Écriture libre'}
Texte de l'apprenant :
"""${clip(text, 3000)}"""

Corrige ce texte. Format JSON exact :
{
 "score": nombre sur 10 (une décimale),
 "criteria": {"grammaire": 0-10, "vocabulaire": 0-10, "orthographe": 0-10, "tache": 0-10},
 "corrected": "texte entièrement corrigé, naturel",
 "errors": [{"type": "grammaire|orthographe|ponctuation|vocabulaire", "original": "...", "correction": "...", "explanation": "giải thích tiếng Việt"}],
 "feedback": "1-2 câu nhận xét tổng quát bằng tiếng Việt, khích lệ"
}`
    });
  },

  async lookup({ word, sentence }) {
    return askGemini({
      system: 'Tu es un dictionnaire français-vietnamien précis. Réponds UNIQUEMENT en JSON.',
      prompt: `Mot : "${clip(word, 60)}"
Phrase de contexte : "${clip(sentence, 400)}"
Donne : {"lemma": forme de base (infinitif pour les verbes), "pos": "nom m./nom f./verbe/adjectif/adverbe/...", "vi": "nghĩa tiếng Việt đúng theo ngữ cảnh câu", "ex": "une phrase d'exemple simple niveau A1-A2"}`,
      temperature: 0.1
    });
  },

  async translate({ text }) {
    return askGemini({
      system: 'Traduis du français vers le vietnamien, naturellement. Réponds en JSON {"vi": "..."}.',
      prompt: clip(text, 1500),
      temperature: 0.1
    });
  },

  async roleplay({ scenario, aiRole, goal, level = 'A1', history = [], message }) {
    return askGemini({
      system:
        `Tu joues ${clip(aiRole, 120)} dans ce scénario : ${clip(scenario, 400)}. Objectif de l'apprenant : ${clip(goal, 200)}. ` +
        `Niveau ${level} : phrases courtes, vocabulaire simple, une seule question à la fois. Reste dans ton rôle, en français uniquement. ` +
        'Si l\'apprenant fait une erreur importante, ajoute une correction très brève dans "tip" (en vietnamien), sinon "tip" est vide. ' +
        'Réponds en JSON : {"reply": "ta réplique en français", "tip": "", "done": true si l\'objectif est atteint}',
      history: history.slice(-16).map(h => ({ role: h.role, text: clip(h.text, 600) })),
      prompt: clip(message, 600),
      temperature: 0.7
    });
  },

  async lesson({ week, day, level, weekTitle, dayTitle }) {
    return askGemini({
      system:
        'Tu es concepteur pédagogique FLE pour des Vietnamiens. Tu crées une leçon complète, correcte et naturelle. ' +
        'Tout le contenu est en français sauf "note_vi" et les champs "vi" (vietnamien). Réponds UNIQUEMENT en JSON.',
      prompt: `Crée la leçon : semaine ${week}, jour ${day}, niveau ${level}.
Thème de la semaine : "${clip(weekTitle, 120)}". Thème du jour : "${clip(dayTitle, 120)}".
Schéma JSON exact (respecte les clés) :
{
 "id": "w${String(week).padStart(2, '0')}d${day}", "day": ${day}, "title": "${clip(dayTitle, 120)}",
 "grammar": {"title": "", "rule": "règle simple en français", "note_vi": "giải thích ngắn tiếng Việt",
   "table": {"head": ["", ""], "rows": [["", ""]]}, "examples": ["4 phrases"],
   "quiz": [5 questions : {"q": "", "options": ["4 choix"], "answer": index} ou {"q": "", "answer": ["réponses acceptées"]} pour la dernière]},
 "vocab": [10 mots : {"fr": "avec article", "ipa": "/.../", "pos": "", "vi": "", "ex": ""}],
 "vocabQuiz": [5 questions même format],
 "listening": {"dictee": ["4 phrases"], "dialogue": [{"s": "nom", "t": "réplique"}] (6 répliques), "questions": [3 QCM]},
 "speaking": {"readAloud": ["3"], "shadowing": ["3"], "roleplay": {"scenario": "", "aiRole": "", "starter": "", "goal": ""}},
 "reading": {"title": "", "text": "80-120 mots", "questions": [3 QCM]},
 "writing": {"prompt": "", "minWords": 30}
}`,
      temperature: 0.6
    });
  }
};
