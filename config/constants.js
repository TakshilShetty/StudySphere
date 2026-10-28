require('dotenv').config({ quiet: true });
const path = require('path');

// ── Resource categories ──────────────────────────────────────────────────────
// "wholeSubject" categories (question papers) may be uploaded without choosing
// a unit, because a paper usually covers the entire subject.
const CATEGORIES = [
  { value: 'full_notes', label: 'Full Notes', wholeSubject: false },
  { value: 'short_notes', label: 'Short Notes', wholeSubject: false },
  { value: 'pyq', label: 'Previous-Year Question Papers', wholeSubject: true },
  { value: 'solved_paper', label: 'Solved Question Papers', wholeSubject: true },
  { value: 'important_questions', label: 'Important Questions', wholeSubject: false },
];
const CATEGORY_VALUES = CATEGORIES.map((c) => c.value);
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const WHOLE_SUBJECT_CATEGORIES = CATEGORIES.filter((c) => c.wholeSubject).map((c) => c.value);

// Severity used by the syllabus-coverage dashboard when a category is missing.
const GAP_SEVERITY = {
  full_notes: 'high',
  pyq: 'high',
  short_notes: 'medium',
  important_questions: 'medium',
  solved_paper: 'low',
};

// ── Enums ────────────────────────────────────────────────────────────────────
const ROLES = ['student', 'admin'];
const RESOURCE_STATUS = ['approved', 'pending', 'removed'];
const REPORT_REASONS = ['inappropriate', 'copyright', 'wrong_content', 'spam', 'low_quality', 'duplicate', 'other'];
const REPORT_STATUS = ['open', 'resolved', 'dismissed'];
const SORT_OPTIONS = ['relevance', 'rating', 'reviews', 'newest', 'downloads'];

// ── Contributor badges (by reputation points) ────────────────────────────────
const BADGES = [
  { min: 0, name: 'Newcomer' },
  { min: 25, name: 'Contributor' },
  { min: 100, name: 'Trusted' },
  { min: 250, name: 'Expert' },
];
function badgeFor(reputation = 0) {
  let badge = BADGES[0].name;
  for (const b of BADGES) if (reputation >= b.min) badge = b.name;
  return badge;
}

// ── Environment-driven settings ──────────────────────────────────────────────
const bool = (v, d = false) =>
  v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const posInt = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const priorMean = Number(process.env.RANKING_PRIOR_MEAN);

const RANKING = {
  PRIOR_MEAN: Number.isFinite(priorMean) && priorMean >= 1 && priorMean <= 5 ? priorMean : 3.5,
  PRIOR_WEIGHT: 5, // how many "virtual" reviews at the prior mean every resource starts with
};

const UPLOAD = {
  DIR: path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')),
  MAX_MB: posInt(process.env.MAX_FILE_SIZE_MB, 20),
  get MAX_BYTES() {
    return this.MAX_MB * 1024 * 1024;
  },
};

const SETTINGS = {
  REQUIRE_APPROVAL: bool(process.env.REQUIRE_APPROVAL, false),
  REQUIRE_LOGIN_FOR_DOWNLOAD: bool(process.env.REQUIRE_LOGIN_FOR_DOWNLOAD, false),
  REPORT_AUTO_HIDE_THRESHOLD: posInt(process.env.REPORT_AUTO_HIDE_THRESHOLD, 5),
};

const PAGINATION = { DEFAULT_LIMIT: 12, MAX_LIMIT: 50 };

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith('CHANGE_ME')) {
    throw new Error(
      'JWT_SECRET is missing or too weak. Set a random string of at least 32 characters in your .env file ' +
        '(see .env.example for a one-line command to generate one).'
    );
  }
  return secret;
}

module.exports = {
  CATEGORIES,
  CATEGORY_VALUES,
  CATEGORY_LABELS,
  WHOLE_SUBJECT_CATEGORIES,
  GAP_SEVERITY,
  ROLES,
  RESOURCE_STATUS,
  REPORT_REASONS,
  REPORT_STATUS,
  SORT_OPTIONS,
  BADGES,
  badgeFor,
  RANKING,
  UPLOAD,
  SETTINGS,
  PAGINATION,
  JWT_EXPIRES_IN,
  getJwtSecret,
};
