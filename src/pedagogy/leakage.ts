// Copied from pit-study (../Bandit) lib/leakage.ts at tag freeze-v1 (commit e8d0f71); the live study is unchanged.
// Changes in this copy: English stopwords are added to pit-study's Romanian ones (MyApp's questions are in English).
// Spec 9.4: does the tutor text reveal too much of the reference answer?

const STOPWORDS = new Set(
  [
    'acea', 'aceea', 'acel', 'acela', 'acele', 'acest', 'acesta', 'aceasta', 'aceste', 'acestea', 'acestui',
    'acolo', 'acum', 'adica', 'altfel', 'apoi', 'asta', 'astfel', 'atunci', 'avea', 'aveti', 'cand', 'care',
    'catre', 'ceea', 'cele', 'celor', 'chiar', 'cine', 'cinci', 'daca', 'deci', 'deja', 'despre', 'dintr',
    'dintre', 'doar', 'dupa', 'este', 'esti', 'fara', 'fiecare', 'fost', 'foarte', 'inainte', 'intr',
    'intre', 'lucru', 'lucruri', 'mereu', 'mult', 'multe', 'multi', 'noastre', 'nostru', 'orice', 'pana',
    'pentru', 'poate', 'poti', 'prin', 'sunt', 'spre', 'tale', 'tine', 'toate', 'totul', 'tocmai', 'trebuie',
    'unde', 'unei', 'unor', 'unui', 'unul', 'vreo', 'exemplu', 'exemple', 'adica', 'altul', 'alta', 'alte',
    'dacă', 'face', 'faci', 'fiind', 'avem', 'aveai', 'acela', 'ceva', 'nimic', 'niste', 'nici', 'iar',
  ].map(normalize),
);

// English function words of four letters or more (contentWords ignores shorter words).
const STOPWORDS_EN = [
  'about', 'after', 'again', 'also', 'always', 'another', 'because', 'been', 'before', 'being', 'both', 'but',
  'cannot', 'could', 'does', 'doing', 'done', 'each', 'even', 'every', 'example', 'first', 'from', 'have',
  'having', 'here', 'into', 'just', 'like', 'make', 'many', 'more', 'most', 'much', 'must', 'next', 'only',
  'other', 'over', 'same', 'should', 'some', 'something', 'such', 'than', 'that', 'their', 'them', 'then',
  'there', 'these', 'they', 'thing', 'things', 'think', 'this', 'those', 'through', 'very', 'want', 'were',
  'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'yours',
];
for (const w of STOPWORDS_EN) STOPWORDS.add(w);

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function contentWords(text: string): Set<string> {
  const words = normalize(text).split(/[^a-z]+/);
  return new Set(words.filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
}

/** Share of the reference answer's content words that also appear in the tutor text. */
export function leakageRatio(referenceAnswer: string, tutorText: string): number {
  const ref = contentWords(referenceAnswer);
  if (ref.size === 0) return 0;
  const out = contentWords(tutorText);
  let hit = 0;
  for (const w of ref) if (out.has(w)) hit++;
  return hit / ref.size;
}

export const LEAK_THRESHOLD = 0.5;

export function isLeaky(referenceAnswer: string, tutorText: string): boolean {
  return leakageRatio(referenceAnswer, tutorText) > LEAK_THRESHOLD;
}
