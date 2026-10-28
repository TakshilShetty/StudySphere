// Helpers that keep academic naming consistent so "DSA", "dsa " and
// "Data  Structures & Algorithms" never end up as three different folders.

const SMALL_WORDS = new Set(['and', 'of', 'the', 'in', 'to', 'for', 'on', 'a', 'an', 'with', 'at', 'by']);
const ACRONYM_SKIP = new Set([...SMALL_WORDS, 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii']);

const ROMAN = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20,
};

/** Trim and collapse whitespace. */
function collapse(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** Comparison key: lower-case, "&" -> "and", punctuation removed. */
function toKey(value) {
  return collapse(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Friendly display form: "data structures and algorithms" -> "Data Structures and Algorithms". */
function titleCase(value) {
  return collapse(value)
    .split(' ')
    .map((word, i) => {
      if (!word) return word;
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      // Long ALL-CAPS words are shouting, not acronyms.
      if (word.length > 5 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
        return word[0] + word.slice(1).toLowerCase();
      }
      // Keep acronyms / mixed case such as VTU, B.E., iOS, McGraw.
      if (/[A-Z]/.test(word.slice(1))) return word;
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** "Data Structures and Algorithms" -> "dsa". Returns '' when the name is a single word. */
function makeAcronym(name) {
  const words = toKey(name)
    .split(' ')
    .filter((w) => w && !ACRONYM_SKIP.has(w) && !/^\d+$/.test(w));
  if (words.length < 2) return '';
  return words.map((w) => w[0]).join('');
}

function toUnitNumber(token) {
  const t = String(token).toLowerCase();
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return n >= 1 && n <= 50 ? n : null;
  }
  return ROMAN[t] || null;
}

/**
 * Pull "unit 3" / "Unit-III" out of a search query.
 * "dsa unit 1" -> { unitNumber: 1, rest: "dsa" }
 */
function extractUnitFromQuery(query) {
  const q = collapse(query);
  const m = /\bunit[\s\-_:]*(\d{1,2}|[ivx]{1,5})\b/i.exec(q);
  if (!m) return { unitNumber: null, rest: q };
  const unitNumber = toUnitNumber(m[1]);
  if (!unitNumber) return { unitNumber: null, rest: q };
  return { unitNumber, rest: collapse(q.replace(m[0], ' ')) };
}

/** Accepts an array or a comma-separated string. Lower-case, unique, max 10 tags of 30 chars. */
function parseTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(',');
  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    const tag = collapse(raw).toLowerCase().replace(/[^\p{L}\p{N}\s\-+#.]/gu, '').slice(0, 30).trim();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
    if (tags.length === 10) break;
  }
  return tags;
}

function bigrams(s) {
  if (s.length < 2) return [s];
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice similarity of two strings, 0..1. */
function similarity(a, b) {
  const A = toKey(a);
  const B = toKey(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const ba = bigrams(A);
  const bb = bigrams(B);
  const counts = new Map();
  ba.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1));
  let overlap = 0;
  bb.forEach((x) => {
    const c = counts.get(x) || 0;
    if (c > 0) {
      overlap++;
      counts.set(x, c - 1);
    }
  });
  return (2 * overlap) / (ba.length + bb.length);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  collapse,
  toKey,
  titleCase,
  makeAcronym,
  toUnitNumber,
  extractUnitFromQuery,
  parseTags,
  similarity,
  escapeRegex,
};
