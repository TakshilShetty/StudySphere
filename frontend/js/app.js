(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const CATS = [['full_notes', 'Full Notes'], ['short_notes', 'Short Notes'], ['pyq', 'Previous-Year Papers'], ['solved_paper', 'Solved Papers'], ['important_questions', 'Important Questions']];
const CL = Object.fromEntries(CATS), WHOLE = ['pyq', 'solved_paper'];
const REASONS = { inappropriate: 'Inappropriate', copyright: 'Copyright', wrong_content: 'Wrong content', spam: 'Spam', low_quality: 'Low quality', duplicate: 'Duplicate', other: 'Other' };
const st = { token: localStorage.getItem('ss_token'), user: null };
let blobUrl = null, sugTimer = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
const date = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fsize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB');
const stars = (n) => `<span class="stars" aria-label="${n} out of 5">${'★'.repeat(Math.round(n))}${'☆'.repeat(5 - Math.round(n))}</span>`;
const opts = (arr, sel, ph) => (ph ? `<option value="">${ph}</option>` : '') + arr.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`).join('');
const hashQ = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
const loading = (n = 6) => (view.innerHTML = `<div class="grid3">${'<div class="sk"></div>'.repeat(n)}</div>`);
const empty = (t, p, a = '') => `<div class="empty"><h3>${t}</h3><p>${p}</p>${a}</div>`;
const needLogin = () => { toast('Log in to do that', 1); location.hash = '#/login'; };

function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), 3800);
}

async function api(path, { method = 'GET', body, form } = {}) {
  const h = st.token ? { Authorization: 'Bearer ' + st.token } : {};
  if (body) h['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch('/api' + path, { method, headers: h, body: form || (body && JSON.stringify(body)) }); }
  catch { throw Object.assign(new Error('Can’t reach the server. Check your connection and try again.'), { status: 0 }); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && st.token) logout(true);
    throw Object.assign(new Error(j.message || 'Something went wrong'), { status: res.status, data: j });
  }
  return j;
}
async function fileBlob(url) {
  const res = await fetch(url, { headers: st.token ? { Authorization: 'Bearer ' + st.token } : {} });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'File unavailable');
  return res.blob();
}
function setAuth(d) { st.token = d.token; st.user = d.user; localStorage.setItem('ss_token', d.token); nav(); }
function logout(expired) {
  st.token = st.user = null; localStorage.removeItem('ss_token'); nav();
  if (expired) toast('Your session ended. Please log in again.', 1);
  location.hash = '#/login';
}

function nav() {
  const r = location.hash.split('?')[0], on = (p) => (r.startsWith(p) ? ' class="on"' : '');
  $('#nav').innerHTML = `<a class="brand" href="#/"><i></i>StudySphere</a>
  <a href="#/browse"${on('#/browse')}>Browse</a><a href="#/search"${on('#/search')}>Search</a><a href="#/coverage"${on('#/coverage')}>Coverage</a>
  ${st.user ? `${st.user.role === 'admin' ? `<a href="#/admin"${on('#/admin')}>Moderate</a>` : ''}<a href="#/dashboard"${on('#/dashboard')}>${esc(st.user.name.split(' ')[0])}</a><a class="cta" href="#/upload">Upload</a><a href="#" data-act="logout">Log out</a>`
    : `<a href="#/login"${on('#/login')}>Log in</a><a class="cta" href="#/register">Sign up</a>`}`;
}

/* ───────── shared pieces ───────── */
function card(r) {
  const u = r.unit ? `Unit ${r.unit.number}` : 'Whole subject';
  return `<article class="res" style="--cc:var(--c-${r.category})">
  <button class="bm${r.bookmarked || r.isBookmarked ? ' on' : ''}" data-act="bm" data-id="${r.id}" aria-label="Save resource" title="Save">${r.bookmarked || r.isBookmarked ? '★' : '☆'}</button>
  <div><span class="tag">${esc(r.categoryLabel)}</span>${r.status !== 'approved' ? ` <span class="tag st">${esc(r.status)}</span>` : ''}</div>
  <h3><a href="#/resource/${r.id}">${esc(r.title)}</a></h3>
  <div class="mute">${esc(r.subject?.name || '')} · ${u}</div>
  <div>${stars(r.avgRating)} <span class="mute">${r.avgRating ? r.avgRating.toFixed(1) : 'No ratings'} (${r.reviewCount})</span></div>
  <div class="meta"><span>by ${esc(r.uploader?.name || 'Unknown')}${r.uploader?.badge ? ' · ' + r.uploader.badge : ''}</span><span>⬇ ${r.downloadCount}</span><span>${date(r.createdAt)}</span></div></article>`;
}
const pager = (p) => (p.totalPages > 1 ? `<div class="pager">${p.page > 1 ? `<button class="btn ghost sm" data-act="page" data-p="${p.page - 1}">Previous</button>` : ''}<span class="mute" style="align-self:center">Page ${p.page} of ${p.totalPages}</span>${p.page < p.totalPages ? `<button class="btn ghost sm" data-act="page" data-p="${p.page + 1}">Next</button>` : ''}</div>` : '');
const fieldErr = (e, k) => (e && e[k] ? `<div class="err">${esc(e[k])}</div>` : '');
function showErrors(form, err) {
  form.querySelectorAll('.err.srv').forEach((e) => e.remove());
  for (const [k, m] of Object.entries(err.data?.errors || {})) {
    const el = form.elements[k]; if (el) el.closest('.field')?.insertAdjacentHTML('beforeend', `<div class="err srv">${esc(m)}</div>`);
  }
  toast(err.message, 1);
}
async function submitting(form, fn) {
  const b = form.querySelector('[type=submit]'), t = b.textContent;
  b.disabled = true; b.textContent = 'Working…';
  try { await fn(); } catch (e) { showErrors(form, e); } finally { b.disabled = false; b.textContent = t; }
}

/* ───────── pages ───────── */
const pages = {};

pages.home = async () => {
  view.innerHTML = `<section class="hero"><div><h1>Every unit. Every paper. One shelf.</h1>
  <p>Stop hopping between groups and drives. Search a subject, pick a unit, and get notes, question papers and important questions rated by students who used them.</p>
  <form class="sbox" data-form="search" role="search"><input name="q" autocomplete="off" placeholder="Try “DSA unit 1”" aria-label="Search notes"><button class="btn">Search</button><div class="sug" hidden></div></form>
  <div class="chips">${['DSA unit 1', 'Operating Systems', 'DBMS', 'Computer Networks'].map((x) => `<a class="chip" href="#/search?${qs({ q: x })}">${x}</a>`).join('')}</div></div>
  <div class="shelf" id="shelf"></div></section>
  <h2>Top-ranked right now</h2><div class="grid3" id="top"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
  <h2 style="margin-top:36px">Top contributors</h2><div class="grid2" id="lead"></div>`;
  const [s, t, l] = await Promise.all([api('/search/stats'), api('/search?limit=6'), api('/dashboard/leaderboard')]);
  $('#shelf').innerHTML = CATS.map(([v, n]) => `<a class="tab" style="--cc:var(--c-${v})" href="#/search?category=${v}">${n}<b>${s.data.categories[v]}</b></a>`).join('') +
    `<div class="mute" style="margin-top:12px">${s.data.resources} resources · ${s.data.subjects} subjects · ${s.data.downloads} downloads</div>`;
  $('#top').innerHTML = t.data.results.map(card).join('') || empty('Nothing here yet', 'Be the first to share notes.', '<a class="btn" href="#/upload">Upload a resource</a>');
  $('#lead').innerHTML = l.data.map((u) => `<div class="card"><b>${u.rank}. ${esc(u.name)}</b> <span class="tag">${u.badge}</span><div class="mute">${u.reputation} pts · ${u.uploads} uploads · ${u.downloads} downloads</div></div>`).join('') || '<p class="mute">Contributors appear after the first helpful uploads.</p>';
};

pages.browse = async () => {
  const q = hashQ(); loading(3);
  const meta = (await api('/subjects/meta?' + qs({ university: q.university, course: q.course }))).data;
  const subs = (await api('/subjects?' + qs({ ...q, limit: 100 }))).data;
  view.innerHTML = `<h1 style="font-size:2.4rem">Browse by subject</h1>
  <form class="row card" data-form="browse" style="margin-bottom:22px"><div class="sp"><label>University</label><select name="university">${opts(meta.universities.map((u) => [u.name, u.name]), q.university, 'All universities')}</select></div>
  <div class="sp"><label>Course</label><select name="course">${opts(meta.courses.map((u) => [u.name, u.name]), q.course, 'All courses')}</select></div>
  <div class="sp"><label>Semester</label><select name="semester">${opts([...Array(8)].map((_, i) => [i + 1, 'Semester ' + (i + 1)]), q.semester, 'All')}</select></div>
  <div class="sp"><label>Subject</label><input name="q" value="${esc(q.q || '')}" placeholder="Name or code"></div><button class="btn" style="align-self:end">Apply</button></form>
  <div class="grid3">${subs.map((s) => `<a class="card" style="text-decoration:none;color:inherit" href="#/subject/${s.id}"><span class="tag">Sem ${s.semester}</span><h3 style="margin-top:8px">${esc(s.name)}</h3><div class="mute">${esc(s.code || '')} ${esc(s.course)}<br>${esc(s.university)}</div><p><b>${s.resourceCount}</b> resources · <b>${s.unitCount}</b> units</p></a>`).join('')}</div>
  ${subs.length ? '' : empty('No subjects match', 'Try fewer filters, or add the subject while uploading.', '<a class="btn" href="#/upload">Add a subject</a>')}`;
};

pages.subject = async (id) => {
  loading(3);
  const s = (await api('/subjects/' + id)).data;
  const link = (u, c) => `#/search?${qs({ subjectId: s.id, unitId: u, category: c })}`;
  const row = (name, u, d) => `<div class="card" style="margin-bottom:10px"><div class="row"><b class="sp">${name}</b><span class="mute">${d.total} resources</span></div><div class="chips">${CATS.map(([v, n]) => `<a class="chip" style="${d.counts[v] ? '' : 'opacity:.5'}" href="${u === 'g' ? `#/search?${qs({ subjectId: s.id, category: v })}` : link(u, v)}"><span style="color:var(--c-${v})">●</span> ${n} <b>${d.counts[v]}</b></a>`).join('')}</div></div>`;
  view.innerHTML = `<p><a href="#/browse">← All subjects</a></p><h1 style="font-size:2.4rem">${esc(s.name)}</h1>
  <p class="mute">${esc(s.code || '')} ${esc(s.course)} · Semester ${s.semester} · ${esc(s.university)}</p>
  <div class="row" style="margin:14px 0 22px"><a class="btn" href="#/upload?subjectId=${s.id}">Upload to this subject</a><a class="btn ghost" href="#/coverage?subjectId=${s.id}">See coverage gaps</a></div>
  ${s.units.map((u) => row(`Unit ${u.number}: ${esc(u.name)}`, u.id, u)).join('') || empty('No units yet', 'Add the first unit below.')}
  ${row('Whole-subject papers', 'g', s.general)}
  <form class="card row" data-form="unit" data-id="${s.id}"><div class="sp"><label>Missing a unit?</label><input name="name" placeholder="e.g. Graphs and Traversals" minlength="1" required></div><button class="btn" style="align-self:end">Add unit</button></form>`;
};

pages.search = async () => {
  const q = hashQ(); loading(6);
  const r = await api('/search?' + qs({ limit: 12, ...q }));
  const f = r.data.facets, m = r.data.query.matchedSubjects;
  view.innerHTML = `<form class="sbox" data-form="search" style="margin:0 0 22px"><input name="q" value="${esc(q.q || '')}" placeholder="Search subject, unit or topic" autocomplete="off" aria-label="Search"><button class="btn">Search</button><div class="sug" hidden></div></form>
  <div class="layout"><aside class="side card"><label>Category</label><div class="cats"><button class="${!q.category ? 'on' : ''}" data-act="filter" data-k="category" data-v="">All <span>${f.all}</span></button>
  ${CATS.map(([v, n]) => `<button style="--cc:var(--c-${v})" class="${q.category === v ? 'on' : ''}" data-act="filter" data-k="category" data-v="${v}">${n} <span>${f[v]}</span></button>`).join('')}</div>
  <div class="field" style="margin-top:16px"><label>Sort by</label><select data-act="sel" data-k="sort">${opts([['relevance', 'Best match'], ['rating', 'Top rated'], ['reviews', 'Most reviewed'], ['newest', 'Newest'], ['downloads', 'Most downloaded']], q.sort || 'relevance')}</select></div>
  <div class="field"><label>Minimum rating</label><select data-act="sel" data-k="minRating">${opts([[3, '3★ & up'], [4, '4★ & up']], q.minRating, 'Any')}</select></div>
  <div class="field"><label>Semester</label><select data-act="sel" data-k="semester">${opts([...Array(8)].map((_, i) => [i + 1, 'Semester ' + (i + 1)]), q.semester, 'Any')}</select></div>
  ${q.subjectId || q.unitId ? '<button class="btn ghost sm" data-act="filter" data-k="subjectId" data-v="">Clear subject filter</button>' : ''}</aside>
  <section>${m.length && q.q ? `<p class="mute">Matched subjects: ${m.map((s) => `<a href="#/subject/${s.id}">${esc(s.name)}</a>`).join(', ')}${r.data.query.unitNumber ? ` · showing Unit ${r.data.query.unitNumber}` : ''}</p>` : ''}
  <p class="mute">${r.pagination.total} results</p>
  <div class="grid3" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${r.data.results.map(card).join('')}</div>
  ${r.data.results.length ? pager(r.pagination) : empty('No matches', 'Try a broader keyword or remove a filter. Can’t find your subject? Upload notes and help the next student.', '<a class="btn" href="#/upload">Upload notes</a>')}</section></div>`;
};

pages.resource = async (id) => {
  loading(2);
  const r = (await api('/resources/' + id)).data, rv = await api(`/reviews/resource/${id}`).catch(() => ({ data: { summary: { count: 0, distribution: {} }, reviews: [] } }));
  const sum = rv.data.summary, mine = r.myReview, can = st.user && !r.isOwner;
  view.innerHTML = `<p><a href="#/subject/${r.subject.id}">← ${esc(r.subject.name)}</a></p>
  <div class="row" style="align-items:flex-start"><div class="sp"><span class="tag" style="--cc:var(--c-${r.category})">${esc(r.categoryLabel)}</span>${r.status !== 'approved' ? ` <span class="tag st">${r.status}</span>` : ''}<h1 style="font-size:2.1rem;margin-top:8px">${esc(r.title)}</h1>
  <p class="mute">${r.unit ? `Unit ${r.unit.number}: ${esc(r.unit.name)}` : 'Whole subject'} · ${esc(r.subject.university)} · Sem ${r.subject.semester}</p></div>
  <div class="row"><button class="btn" data-act="dl" data-id="${id}">⬇ Download</button><button class="btn ghost bm-t${r.isBookmarked ? ' on' : ''}" data-act="bm" data-id="${id}" data-t="1">${r.isBookmarked ? '★ Saved' : '☆ Save'}</button>${r.isOwner ? '' : `<button class="btn ghost" data-act="report" data-id="${id}">Report</button>`}${r.isOwner ? `<button class="btn danger" data-act="del" data-id="${id}">Delete</button>` : ''}</div></div>
  ${r.moderationNote ? `<div class="warn">${esc(r.moderationNote)}</div>` : ''}
  <div class="layout" style="grid-template-columns:1fr 320px;margin-top:18px"><section><div id="pv" class="sk" style="height:60vh"></div><p>${esc(r.description)}</p><div class="chips">${r.tags.map((t) => `<a class="chip" href="#/search?${qs({ q: t })}">#${esc(t)}</a>`).join('')}</div>
  <h2 style="margin-top:34px">Reviews</h2><div id="rvs">${rv.data.reviews.map((x) => `<div class="rev"><div class="row">${stars(x.rating)}<b>${esc(x.user?.name)}</b><span class="tag">${x.user?.badge || ''}</span><span class="mute sp">${date(x.createdAt)}${x.edited ? ' (edited)' : ''}</span>${x.isMine ? `<button class="btn ghost sm" data-act="delrev" data-id="${x.id}">Delete</button>` : ''}</div><p>${esc(x.comment)}</p>${x.isMine ? '' : `<button class="btn ghost sm${x.markedHelpfulByMe ? ' on' : ''}" data-act="helpful" data-id="${x.id}">👍 Helpful · ${x.helpfulCount}</button>`}</div>`).join('') || '<p class="mute">No reviews yet. Used this? Tell others how it went.</p>'}</div></section>
  <aside><div class="card"><div class="stat">${r.avgRating ? r.avgRating.toFixed(1) : '–'}</div>${stars(r.avgRating)} <span class="mute">${r.reviewCount} reviews</span>
  ${[5, 4, 3, 2, 1].map((n) => `<div class="row" style="gap:8px;font-size:.85rem"><span>${n}★</span><div class="bar sp"><i style="width:${sum.count ? ((sum.distribution[n] || 0) / sum.count) * 100 : 0}%"></i></div></div>`).join('')}
  <p class="mute" style="margin-bottom:0">${r.downloadCount} downloads · ${r.viewCount} views${r.file ? ' · ' + fsize(r.file.size) : ''}</p></div>
  <div class="card" style="margin-top:14px"><b>${esc(r.uploader.name)}</b> <span class="tag">${r.uploader.badge}</span><div class="mute">${r.uploader.reputation} reputation · member since ${date(r.uploader.memberSince)}</div></div>
  <form class="card" data-form="review" data-id="${id}" style="margin-top:14px">${!st.user ? '<p><a href="#/login">Log in</a> to rate this resource.</p>' : r.isOwner ? '<p class="mute">You can’t review your own upload.</p>' : `<h3>${mine ? 'Update your review' : 'Rate this resource'}</h3>
  <div class="starin" data-rating="${mine?.rating || 0}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-act="rate" data-v="${n}" class="${n <= (mine?.rating || 0) ? 'on' : ''}" aria-label="${n} stars">★</button>`).join('')}</div>
  <div class="field"><textarea name="comment" rows="3" maxlength="1500" placeholder="What was useful? What was missing?">${esc(mine?.comment || '')}</textarea></div><button class="btn" type="submit">${mine ? 'Update review' : 'Post review'}</button>`}</form>
  ${r.related.length ? `<h3 style="margin-top:20px">Also in this unit</h3><div style="display:grid;gap:12px">${r.related.map(card).join('')}</div>` : ''}</aside></div>`;
  fileBlob(r.previewUrl).then((b) => { blobUrl = URL.createObjectURL(b); const p = $('#pv'); if (p) p.outerHTML = `<iframe class="pdf" src="${blobUrl}" title="PDF preview"></iframe>`; })
    .catch((e) => { const p = $('#pv'); if (p) p.outerHTML = `<div class="warn">Preview unavailable: ${esc(e.message)}</div>`; });
};

pages.upload = async () => {
  if (!st.user) return needLogin();
  const q = hashQ(); let pre = {};
  if (q.subjectId) { const s = (await api('/subjects/' + q.subjectId).catch(() => ({}))).data; if (s) pre = s; }
  const meta = (await api('/subjects/meta')).data, u = st.user, cat = q.category || 'full_notes';
  view.innerHTML = `<h1 style="font-size:2.4rem">Share your notes</h1><form class="card" id="upf" data-form="upload" novalidate>
  <div class="grid2"><div class="field"><label>University</label><input name="university" list="dl-u" value="${esc(pre.university || u.university || '')}" required><datalist id="dl-u">${meta.universities.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist></div>
  <div class="field"><label>Course / branch</label><input name="course" value="${esc(pre.course || u.course || '')}" required></div>
  <div class="field"><label>Semester</label><select name="semester">${opts([...Array(8)].map((_, i) => [i + 1, 'Semester ' + (i + 1)]), pre.semester || u.semester || 1)}</select></div></div>
  <div class="field"><label>Subject</label><select name="subjectId" required></select><div class="hint">Not listed? <a href="#" data-act="newsub">Create it</a>. We’ll reuse an existing one if it already exists.</div></div>
  <div class="field" id="newsub" hidden><div class="warn"><label>New subject name</label><input name="newName" placeholder="e.g. Data Structures"><label style="margin-top:8px">Units (one per line)</label><textarea name="newUnits" rows="4" placeholder="Arrays and Linked Lists&#10;Stacks and Queues"></textarea><button type="button" class="btn sm" style="margin-top:8px" data-act="mksub">Create subject</button></div></div>
  <div class="field"><label>Category</label><select name="category">${opts(CATS, cat)}</select></div>
  <div class="field"><label>Unit</label><select name="unitId"></select><div class="hint" id="uh"></div></div>
  <div class="field"><label>Title</label><input name="title" maxlength="150" placeholder="e.g. Unit 1 Complete Handwritten Notes" required></div>
  <div class="field"><label>Description <span class="mute">(optional)</span></label><textarea name="description" rows="3" maxlength="1000"></textarea></div>
  <div class="field"><label>Tags <span class="mute">(comma separated)</span></label><input name="tags" placeholder="arrays, linked list, stack"></div>
  <div class="field"><label>PDF file (max 20 MB)</label><label class="drop" id="drop" style="font-weight:400"><input name="file" type="file" accept="application/pdf" hidden><span id="fn">Drop a PDF here or click to choose</span></label></div>
  <div id="dup"></div><button class="btn" type="submit">Upload resource</button></form>`;
  const f = $('#upf'), file = f.elements.file;
  async function loadSubjects(sel) {
    const { university, course, semester } = f.elements;
    const list = (await api('/subjects?' + qs({ university: university.value, course: course.value, semester: semester.value, limit: 100 }))).data;
    f.elements.subjectId.innerHTML = opts(list.map((s) => [s.id, `${s.name}${s.code ? ' (' + s.code + ')' : ''}`]), sel || pre.id, list.length ? 'Choose a subject' : 'No subjects yet. Create one below');
    if (!list.length) $('#newsub').hidden = false;
    await loadUnits();
  }
  async function loadUnits() {
    const id = f.elements.subjectId.value, whole = WHOLE.includes(f.elements.category.value);
    if (!id) { f.elements.unitId.innerHTML = '<option value="">Choose a subject first</option>'; return; }
    const s = (await api('/subjects/' + id)).data;
    f.elements.unitId.innerHTML = opts(s.units.map((x) => [x.id, `Unit ${x.number}: ${x.name}`]), q.unitId, whole ? 'Whole subject (no unit)' : 'Choose a unit');
    $('#uh').textContent = whole ? 'Question papers usually cover the whole subject, so a unit is optional.' : s.units.length ? '' : 'This subject has no units yet. Add one from its page.';
  }
  f.dataset.load = '1'; f._loadSubjects = loadSubjects; f._loadUnits = loadUnits;
  file.onchange = () => { $('#fn').textContent = file.files[0] ? `${file.files[0].name} (${fsize(file.files[0].size)})` : 'Drop a PDF here or click to choose'; };
  const d = $('#drop'); ['dragover', 'dragenter'].forEach((e) => d.addEventListener(e, (x) => { x.preventDefault(); d.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((e) => d.addEventListener(e, (x) => { x.preventDefault(); d.classList.remove('over'); }));
  d.addEventListener('drop', (x) => { if (x.dataTransfer.files[0]) { file.files = x.dataTransfer.files; file.onchange(); } });
  await loadSubjects();
};

pages.dashboard = async () => {
  if (!st.user) return needLogin();
  loading(3);
  const tab = hashQ().tab || 'uploads', d = (await api('/dashboard')).data, s = d.stats, rep = d.reputation;
  const list = tab === 'saved' ? (await api('/bookmarks?limit=24')).data : (await api('/dashboard/contributions?limit=24')).data;
  view.innerHTML = `<h1 style="font-size:2.4rem">Hi, ${esc(st.user.name.split(' ')[0])}</h1>
  <div class="grid2" style="margin-bottom:22px"><div class="card"><div class="stat">${rep.points}</div>reputation · <b>${rep.badge}</b>${rep.nextBadge ? `<div class="bar" style="margin:10px 0 4px"><i style="width:${Math.min(100, (rep.points / (rep.points + rep.pointsToNext)) * 100)}%"></i></div><span class="hint">${rep.pointsToNext} points to ${rep.nextBadge}</span>` : ''}</div>
  <div class="card"><div class="stat">${s.totalUploads}</div>uploads · ${s.uploads.pending} pending</div><div class="card"><div class="stat">${s.totalDownloads}</div>downloads of your notes</div><div class="card"><div class="stat">${s.averageRating || '–'}</div>average rating · ${s.helpfulVotesReceived} helpful votes on your reviews</div></div>
  <div class="tabs"><button class="${tab === 'uploads' ? 'on' : ''}" data-act="tab" data-v="uploads">My uploads</button><button class="${tab === 'saved' ? 'on' : ''}" data-act="tab" data-v="saved">Saved (${s.bookmarks})</button></div>
  <div class="grid3">${list.map(card).join('')}</div>${list.length ? '' : tab === 'saved' ? empty('Nothing saved yet', 'Tap ☆ on any resource to keep it here.', '<a class="btn" href="#/search">Find resources</a>') : empty('No uploads yet', 'Share your first set of notes and start earning reputation.', '<a class="btn" href="#/upload">Upload now</a>')}`;
};

pages.coverage = async () => {
  loading(2);
  const q = hashQ(), subs = (await api('/subjects?limit=100')).data;
  view.innerHTML = `<h1 style="font-size:2.4rem">Syllabus coverage</h1><p class="mute">Green means at least one resource exists. Red cells are gaps. Click one to fill it.</p>
  <div class="card row" style="margin-bottom:20px"><div class="sp"><label>Subject</label><select data-act="covsub">${opts(subs.map((s) => [s.id, `${s.name} · Sem ${s.semester}`]), q.subjectId, 'Choose a subject')}</select></div></div><div id="cov">${q.subjectId ? '<div class="sk"></div>' : empty('Pick a subject', 'We’ll show which units are missing notes or papers.')}</div>`;
  if (!q.subjectId) return;
  const c = (await api('/coverage?subjectId=' + q.subjectId)).data, a = c.subjects[0];
  $('#cov').innerHTML = `<div class="card"><div class="row"><h2 class="sp" style="margin:0">${esc(a.subject.name)}</h2><div class="stat">${a.coveragePercent}%</div></div><div class="bar"><i style="width:${a.coveragePercent}%"></i></div>${a.note ? `<p class="hint">${esc(a.note)}</p>` : ''}
  <div style="overflow-x:auto"><table class="heat"><tr><th>Unit</th>${CATS.map(([, n]) => `<th>${n}</th>`).join('')}</tr>
  ${a.units.map((u) => `<tr><th>${u.number}. ${esc(u.name)}</th>${CATS.map(([v]) => `<td class="${u.missing.includes(v) ? 'no' : 'ok'}">${u.missing.includes(v) ? `<a href="#/upload?${qs({ subjectId: a.subject.id, unitId: u.id, category: v })}" title="Upload this">+</a>` : u.counts[v] || '✓'}</td>`).join('')}</tr>`).join('')}</table></div></div>
  <h3 style="margin-top:22px">Most needed (${a.gaps.length} gaps)</h3>${a.gaps.slice(0, 12).map((g) => `<div class="card row" style="margin-bottom:8px;padding:12px 16px"><span class="tag st">${g.severity}</span><span class="sp">${esc(g.message)}</span><a class="btn sm" href="#/upload?${qs({ subjectId: g.subjectId, unitId: g.unitId, category: g.category })}">Upload</a></div>`).join('') || '<p>No gaps. This subject is fully covered. 🎉</p>'}`;
};

pages.admin = async (_, tabOverride) => {
  if (!st.user || st.user.role !== 'admin') { view.innerHTML = empty('Admins only', 'You don’t have access to this page.'); return; }
  loading(2);
  const tab = hashQ().tab || 'reports', s = (await api('/admin/stats')).data;
  const data = tab === 'reports' ? (await api('/admin/reports?status=open')).data : (await api('/admin/resources?status=' + tab)).data;
  view.innerHTML = `<h1 style="font-size:2.4rem">Moderation</h1><div class="grid2" style="margin-bottom:18px"><div class="card"><div class="stat">${s.openReports}</div>open reports</div><div class="card"><div class="stat">${s.resources.pending}</div>pending</div><div class="card"><div class="stat">${s.resources.approved}</div>approved</div><div class="card"><div class="stat">${s.users}</div>users</div></div>
  <div class="tabs">${[['reports', 'Open reports'], ['pending', 'Pending'], ['removed', 'Removed']].map(([v, n]) => `<button class="${tab === v ? 'on' : ''}" data-act="tab" data-v="${v}">${n}</button>`).join('')}</div>
  ${data.length ? data.map((x) => tab === 'reports' ? `<div class="card" style="margin-bottom:12px"><div class="row"><span class="tag st">${REASONS[x.reason]}</span><b class="sp">${x.resource ? `<a href="#/resource/${x.resource.id}">${esc(x.resource.title)}</a>` : 'Resource deleted'}</b><span class="mute">${date(x.createdAt)}</span></div><p>${esc(x.details || 'No details given.')}</p><p class="hint">Reported by ${esc(x.reporter?.name)} · uploader ${esc(x.resource?.uploader?.name)} · ${x.resource?.reportCount} reports total</p><div class="row"><button class="btn ghost sm" data-act="rep" data-id="${x.id}" data-a="dismiss">Dismiss</button><button class="btn danger sm" data-act="rep" data-id="${x.id}" data-a="remove_resource">Remove resource</button></div></div>`
    : `<div class="card row" style="margin-bottom:10px"><b class="sp"><a href="#/resource/${x.id}">${esc(x.title)}</a><div class="hint">${esc(x.uploader?.name)} · ${esc(x.subject?.name)}</div></b><button class="btn sm" data-act="setst" data-id="${x.id}" data-s="approved">Approve</button>${tab === 'pending' ? `<button class="btn danger sm" data-act="setst" data-id="${x.id}" data-s="removed">Remove</button>` : ''}</div>`).join('') : empty('All clear', 'Nothing needs your attention here.')}`;
};

function authPage(kind) {
  const reg = kind === 'register';
  view.innerHTML = `<div class="card" style="max-width:440px;margin:30px auto"><h1 style="font-size:2rem">${reg ? 'Join StudySphere' : 'Welcome back'}</h1><form data-form="${kind}" novalidate>
  ${reg ? '<div class="field"><label>Name</label><input name="name" autocomplete="name"></div>' : ''}<div class="field"><label>Email</label><input name="email" type="email" autocomplete="email"></div>
  <div class="field"><label>Password</label><input name="password" type="password" autocomplete="${reg ? 'new' : 'current'}-password">${reg ? '<div class="hint">8+ characters with a letter and a number</div>' : ''}</div>
  ${reg ? '<div class="grid2"><div class="field"><label>University</label><input name="university"></div><div class="field"><label>Course</label><input name="course"></div></div>' : ''}
  <button class="btn" type="submit" style="width:100%;justify-content:center">${reg ? 'Create account' : 'Log in'}</button></form><p class="hint">${reg ? 'Have an account? <a href="#/login">Log in</a>' : 'New here? <a href="#/register">Create an account</a>'}</p></div>`;
}
pages.login = () => authPage('login');
pages.register = () => authPage('register');

/* ───────── router ───────── */
async function route() {
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  const [path] = location.hash.slice(2).split('?'), [name, id] = path.split('/');
  nav(); window.scrollTo(0, 0);
  try { await (pages[name || 'home'] || pages.home)(id); }
  catch (e) { view.innerHTML = empty(e.status === 404 ? 'Not found' : 'Something went wrong', esc(e.message), '<a class="btn" href="#/">Back home</a>'); }
  view.focus({ preventScroll: true });
}
const setQ = (patch) => { const q = { ...hashQ(), ...patch, page: patch.page || '' }; location.hash = `${location.hash.split('?')[0]}?${qs(q)}`; };

/* ───────── actions ───────── */
const act = {
  logout: () => { logout(); },
  page: (t) => setQ({ page: t.dataset.p }),
  filter: (t) => setQ({ [t.dataset.k]: t.dataset.v, ...(t.dataset.k === 'subjectId' ? { unitId: '' } : {}) }),
  tab: (t) => { location.hash = `${location.hash.split('?')[0]}?tab=${t.dataset.v}`; },
  covsub: null,
  newsub: (t, e) => { e.preventDefault(); $('#newsub').hidden = false; },
  rate: (t) => { const w = t.parentElement; w.dataset.rating = t.dataset.v; [...w.children].forEach((b, i) => b.classList.toggle('on', i < +t.dataset.v)); },
  async bm(t) {
    if (!st.user) return needLogin();
    const r = await api('/bookmarks/' + t.dataset.id, { method: 'POST' }), on = r.data.bookmarked;
    t.classList.toggle('on', on); if (t.dataset.t) t.textContent = on ? '★ Saved' : '☆ Save'; else t.textContent = on ? '★' : '☆';
    toast(r.message);
  },
  async dl(t) {
    t.disabled = true;
    try { const b = await fileBlob(`/api/resources/${t.dataset.id}/download`), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = ($('h1').textContent || 'notes') + '.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    catch (e) { toast(e.message, 1); } t.disabled = false;
  },
  async helpful(t) { if (!st.user) return needLogin(); await api(`/reviews/${t.dataset.id}/helpful`, { method: 'POST' }); route(); },
  async delrev(t) { if (confirm('Delete your review?')) { await api('/reviews/' + t.dataset.id, { method: 'DELETE' }); toast('Review deleted'); route(); } },
  async del(t) { if (confirm('Delete this resource permanently?')) { await api('/resources/' + t.dataset.id, { method: 'DELETE' }); toast('Resource deleted'); location.hash = '#/dashboard'; } },
  report(t) {
    if (!st.user) return needLogin();
    const d = document.createElement('dialog');
    d.innerHTML = `<form method="dialog" data-form="report" data-id="${t.dataset.id}"><h3>Report this resource</h3><div class="field"><label>Reason</label><select name="reason">${opts(Object.entries(REASONS), 'wrong_content')}</select></div><div class="field"><label>Details</label><textarea name="details" rows="3" maxlength="1000"></textarea></div><div class="row"><button class="btn danger" type="submit">Send report</button><button class="btn ghost" type="button" data-act="close">Cancel</button></div></form>`;
    document.body.append(d); d.showModal(); d.addEventListener('close', () => d.remove());
  },
  close: (t) => t.closest('dialog').close(),
  async rep(t) { const r = await api('/admin/reports/' + t.dataset.id, { method: 'PATCH', body: { action: t.dataset.a } }); toast(r.message); route(); },
  async setst(t) { const r = await api(`/admin/resources/${t.dataset.id}/status`, { method: 'PATCH', body: { status: t.dataset.s } }); toast(r.message); route(); },
  async mksub(t) {
    const f = $('#upf').elements, units = f.newUnits.value.split('\n').map((x) => x.trim()).filter(Boolean);
    try {
      const r = await api('/subjects', { method: 'POST', body: { university: f.university.value, course: f.course.value, semester: +f.semester.value, name: f.newName.value, units } });
      toast(r.message); $('#newsub').hidden = true; await $('#upf')._loadSubjects(r.data.subject.id);
    } catch (e) { toast(e.message, 1); }
  },
};
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t || t.tagName === 'SELECT') return;
  const fn = act[t.dataset.act]; if (fn) Promise.resolve(fn(t, e)).catch((x) => toast(x.message, 1));
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.act === 'sel') setQ({ [t.dataset.k]: t.value });
  else if (t.dataset.act === 'covsub') location.hash = '#/coverage?subjectId=' + t.value;
  const f = t.closest('#upf');
  if (f && ['university', 'course', 'semester'].includes(t.name)) f._loadSubjects().catch(() => {});
  if (f && ['subjectId', 'category'].includes(t.name)) f._loadUnits().catch(() => {});
});

const forms = {
  search(f, e) { location.hash = '#/search?' + qs({ q: f.elements.q.value.trim() }); },
  browse(f) { location.hash = '#/browse?' + qs(Object.fromEntries(new FormData(f))); },
  login: (f) => submitting(f, async () => { const r = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); setAuth(r.data); toast('Welcome back, ' + r.data.user.name.split(' ')[0]); location.hash = '#/dashboard'; }),
  register: (f) => submitting(f, async () => { const b = Object.fromEntries(new FormData(f)); Object.keys(b).forEach((k) => b[k] === '' && delete b[k]); const r = await api('/auth/register', { method: 'POST', body: b }); setAuth(r.data); toast('Account created. Welcome!'); location.hash = '#/dashboard'; }),
  unit: (f) => submitting(f, async () => { if (!st.user) return needLogin(); const r = await api(`/subjects/${f.dataset.id}/units`, { method: 'POST', body: { name: f.elements.name.value } }); toast(r.message); route(); }),
  review: (f) => submitting(f, async () => { const rating = +f.querySelector('.starin').dataset.rating; if (!rating) return toast('Choose a star rating first', 1); const r = await api('/reviews/resource/' + f.dataset.id, { method: 'POST', body: { rating, comment: f.elements.comment.value } }); toast(r.message); route(); }),
  report: (f) => submitting(f, async () => { const r = await api('/reports', { method: 'POST', body: { resourceId: f.dataset.id, reason: f.elements.reason.value, details: f.elements.details.value } }); toast(r.message); f.closest('dialog').close(); }),
  async upload(f, e, force) {
    const fd = new FormData(f); ['newName', 'newUnits'].forEach((k) => fd.delete(k));
    if (!fd.get('unitId')) fd.delete('unitId'); if (!f.elements.file.files[0]) return toast('Choose a PDF file first', 1);
    ['university', 'course', 'semester'].forEach((k) => fd.delete(k)); if (force) fd.append('force', 'true');
    $('#dup').innerHTML = '';
    await submitting(f, async () => {
      try { const r = await api('/resources', { method: 'POST', form: fd }); toast(r.message); location.hash = '#/resource/' + r.data.id; }
      catch (err) {
        const d = err.data || {};
        if (d.errorCode === 'SIMILAR_RESOURCE') {
          $('#dup').innerHTML = `<div class="warn"><b>Similar resources already exist here.</b><ul>${d.details.similar.map((s) => `<li><a target="_blank" href="#/resource/${s.id || s._id}">${esc(s.title)}</a></li>`).join('')}</ul><button type="button" class="btn sm" data-act="force">Mine is different. Upload anyway</button></div>`; return;
        }
        if (d.errorCode === 'DUPLICATE_FILE') { $('#dup').innerHTML = `<div class="warn">This exact file is already on StudySphere: <a href="#/resource/${d.details.existing.id}">${esc(d.details.existing.title)}</a></div>`; return; }
        throw err;
      }
    });
  },
};
act.force = () => forms.upload($('#upf'), null, true);
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  if (f.method !== 'dialog') e.preventDefault(); else e.preventDefault();
  Promise.resolve(forms[f.dataset.form](f, e)).catch((x) => toast(x.message, 1));
});

document.addEventListener('input', (e) => {
  const i = e.target; if (i.name !== 'q' || !i.closest('.sbox')) return;
  const box = i.closest('.sbox').querySelector('.sug'); clearTimeout(sugTimer);
  if (i.value.trim().length < 2) { box.hidden = true; return; }
  sugTimer = setTimeout(async () => {
    const r = (await api('/search/suggest?' + qs({ q: i.value.trim() })).catch(() => ({ data: [] }))).data;
    box.innerHTML = r.map((x) => `<a href="${x.type === 'subject' ? '#/subject/' : '#/resource/'}${x.id}">${esc(x.label)}<small>${esc(x.sublabel)}</small></a>`).join('');
    box.hidden = !r.length;
  }, 220);
});
document.addEventListener('click', (e) => { if (!e.target.closest('.sbox')) document.querySelectorAll('.sug').forEach((s) => (s.hidden = true)); });

window.addEventListener('hashchange', route);
(async () => {
  if (st.token) { try { st.user = (await api('/auth/me')).data.user; } catch { st.token = null; } }
  route();
})();
})();
