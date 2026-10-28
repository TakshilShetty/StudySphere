// Loads demo data: users, subjects with units, PDF resources, reviews, bookmarks and reports.
//
//   npm run seed          -> refuses to run if the database already has users
//   npm run seed -- --force       -> WIPES all StudySphere collections, then seeds
//   npm run seed:admin    -> only creates the admin account from ADMIN_* in .env (safe on real data)
//
// The sample PDFs are tiny placeholder files generated here, so the demo works with no downloads.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const connectDB = require('./config/db');
const { UPLOAD } = require('./config/constants');
const User = require('./models/User');
const Subject = require('./models/Subject');
const Resource = require('./models/Resource');
const Review = require('./models/Review');
const Bookmark = require('./models/Bookmark');
const Report = require('./models/Report');
const { toKey, titleCase } = require('./utils/normalize');
const { recalculateResource } = require('./utils/ranking');
const { recalculateReputation } = require('./utils/reputation');

const args = new Set(process.argv.slice(2));
const STUDENT_PASSWORD = 'Student@123';

// ── tiny valid PDF generator (ASCII only) ────────────────────────────────────
function makePdf(title, lines) {
  const esc = (s) => String(s).replace(/[\\()]/g, '\\$&');
  const content = [
    `BT /F1 20 Tf 50 780 Td (${esc(title)}) Tj ET`,
    ...lines.map((l, i) => `BT /F1 12 Tf 50 ${745 - i * 20} Td (${esc(l)}) Tj ET`),
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ── demo content ─────────────────────────────────────────────────────────────
const UNI = 'VTU';
const COURSE = 'B.E. Computer Science and Engineering';

const SUBJECTS = [
  { key: 'dsa', university: UNI, course: COURSE, semester: 3, name: 'Data Structures and Algorithms', code: '21CS32', units: ['Introduction and Arrays', 'Stacks and Queues', 'Linked Lists', 'Trees and Graphs', 'Sorting, Searching and Hashing'] },
  { key: 'dm', university: UNI, course: COURSE, semester: 3, name: 'Discrete Mathematics', code: '21CS33', units: ['Logic and Proofs', 'Sets, Relations and Functions', 'Combinatorics', 'Graph Theory', 'Algebraic Structures'] },
  { key: 'dbms', university: UNI, course: COURSE, semester: 4, name: 'Database Management Systems', code: '21CS42', units: ['Introduction and ER Model', 'Relational Model and SQL', 'Normalization', 'Transactions and Concurrency', 'NoSQL and Recent Trends'] },
  { key: 'os', university: UNI, course: COURSE, semester: 4, name: 'Operating Systems', code: '21CS43', units: ['Introduction and Processes', 'CPU Scheduling and Synchronization', 'Deadlocks', 'Memory Management', 'File Systems and Storage'] },
  { key: 'cn', university: UNI, course: COURSE, semester: 5, name: 'Computer Networks', code: '21CS52', units: ['Network Fundamentals', 'Data Link Layer', 'Network Layer', 'Transport Layer', 'Application Layer'] },
  { key: 'anna_dsa', university: 'Anna University', course: 'B.Tech Information Technology', semester: 3, name: 'Data Structures', code: 'CS3301', units: ['Lists, Stacks and Queues', 'Trees', 'Graphs'] },
];

const STUDENTS = [
  { name: 'Ananya Rao', email: 'ananya@example.com', semester: 4 },
  { name: 'Rahul Verma', email: 'rahul@example.com', semester: 4 },
  { name: 'Meera Nair', email: 'meera@example.com', semester: 5 },
  { name: 'Karthik Shetty', email: 'karthik@example.com', semester: 3 },
  { name: 'Sneha Patil', email: 'sneha@example.com', semester: 4 },
];

// [subject key, unit number or null, category, title, uploader (student index), tags, description, days ago]
// Gaps are deliberate (e.g. DSA Unit 4 has no full notes, Operating Systems has no PYQs) so the coverage dashboard has something to show.
const RESOURCES = [
  ['dsa', 1, 'full_notes', 'DSA Unit 1 Complete Notes: Arrays and Complexity', 0, ['arrays', 'complexity', 'big o'], 'Handwritten-style notes covering arrays, time complexity and asymptotic notation with solved examples.', 70],
  ['dsa', 1, 'short_notes', 'DSA Unit 1 Quick Revision Sheet', 1, ['revision', 'arrays'], 'One-page formulas and key definitions for last-minute revision.', 40],
  ['dsa', 1, 'important_questions', 'DSA Unit 1 Important Questions', 2, ['important', 'exam'], 'Frequently asked questions from the last five years.', 30],
  ['dsa', 2, 'full_notes', 'Stacks and Queues Detailed Notes', 0, ['stack', 'queue', 'applications'], 'Stack and queue operations, infix to postfix, circular and priority queues.', 62],
  ['dsa', 2, 'short_notes', 'Stacks and Queues in 10 Minutes', 3, ['stack', 'queue'], 'Short notes with diagrams.', 20],
  ['dsa', 3, 'full_notes', 'Linked Lists Complete Guide', 1, ['linked list', 'singly', 'doubly'], 'Singly, doubly and circular linked lists with code in C.', 55],
  ['dsa', 3, 'important_questions', 'Linked List Important Questions', 4, ['linked list', 'important'], 'Most repeated linked list questions.', 25],
  ['dsa', 4, 'short_notes', 'Trees and Graphs Short Notes', 2, ['trees', 'graphs', 'bfs', 'dfs'], 'Traversals, BST operations, BFS and DFS summarised.', 18],
  ['dsa', 5, 'full_notes', 'Sorting and Searching Full Notes', 3, ['sorting', 'searching', 'hashing'], 'All sorting algorithms with complexity comparison and hashing collisions.', 45],
  ['dsa', null, 'pyq', 'DSA Previous Year Question Papers 2019-2023', 4, ['pyq', 'question paper'], 'Five years of semester-end papers.', 50],
  ['dsa', null, 'solved_paper', 'DSA Solved Paper December 2023', 1, ['solved', '2023'], 'Fully solved paper with marking-scheme answers.', 15],
  ['dm', 1, 'full_notes', 'Discrete Maths Unit 1: Logic and Proofs', 2, ['logic', 'proofs'], 'Propositional logic, quantifiers and proof techniques.', 58],
  ['dm', 4, 'full_notes', 'Graph Theory Notes for Discrete Mathematics', 0, ['graph theory'], 'Euler and Hamilton paths, planar graphs, colouring.', 35],
  ['dm', null, 'pyq', 'Discrete Mathematics PYQs 2020-2023', 3, ['pyq'], 'Collection of previous papers.', 33],
  ['dbms', 1, 'full_notes', 'DBMS Unit 1: ER Model Notes', 1, ['er model', 'dbms'], 'Entities, relationships, keys and ER to relational mapping.', 48],
  ['dbms', 2, 'full_notes', 'SQL and Relational Algebra Notes', 4, ['sql', 'relational algebra'], 'Complete SQL syntax with queries and relational algebra operators.', 42],
  ['dbms', 2, 'important_questions', 'SQL Queries Important Questions', 0, ['sql', 'important'], 'Frequently asked SQL query problems.', 28],
  ['dbms', 3, 'short_notes', 'Normalization Cheat Sheet', 2, ['normalization', '1nf', '2nf', '3nf', 'bcnf'], 'Normal forms with quick examples.', 22],
  ['dbms', null, 'pyq', 'DBMS Previous Year Question Papers', 3, ['pyq'], 'Semester-end papers 2018-2023.', 38],
  ['dbms', null, 'solved_paper', 'DBMS Solved Question Paper 2022', 1, ['solved', '2022'], 'Step-by-step solutions.', 12],
  ['os', 1, 'full_notes', 'Operating Systems Unit 1 Notes', 3, ['processes', 'threads'], 'Process states, PCB, system calls, threads.', 52],
  ['os', 2, 'full_notes', 'CPU Scheduling and Synchronization Notes', 4, ['scheduling', 'semaphores'], 'FCFS, SJF, RR, priority scheduling and classic sync problems.', 44],
  ['os', 3, 'short_notes', 'Deadlocks Short Notes', 0, ['deadlock', 'banker'], 'Conditions, prevention and the Banker\'s algorithm.', 16],
  ['os', 4, 'full_notes', 'Memory Management Complete Notes', 2, ['paging', 'segmentation', 'virtual memory'], 'Paging, segmentation and page replacement algorithms.', 36],
  ['cn', 1, 'full_notes', 'Computer Networks Unit 1 Notes', 1, ['osi', 'tcp/ip'], 'Layered models and network devices.', 30],
  ['cn', 3, 'short_notes', 'Network Layer Quick Notes', 4, ['ip', 'routing', 'subnetting'], 'IPv4 addressing, subnetting and routing algorithms.', 14],
  ['cn', null, 'pyq', 'Computer Networks PYQ Collection', 0, ['pyq'], 'Question papers from previous years.', 10],
  ['anna_dsa', 1, 'full_notes', 'Anna University Data Structures Unit 1 Notes', 2, ['lists', 'stacks'], 'ADT, linked lists, stacks and queues.', 27],
  ['anna_dsa', null, 'pyq', 'Anna University Data Structures Question Bank', 3, ['question bank'], 'Previous-year question bank.', 21],
];

// [resource index, reviewer student index, rating, comment]
const REVIEWS = [
  [0, 1, 5, 'Very clear explanations of Big-O. The solved examples are exactly what exams ask.'],
  [0, 2, 5, 'Best notes for this unit. Helped me finish revision in one evening.'],
  [0, 3, 4, 'Good coverage, would love a few more practice problems.'],
  [0, 4, 5, 'Neat diagrams and easy to follow.'],
  [1, 0, 4, 'Handy for the night before the exam.'],
  [1, 3, 4, ''],
  [2, 0, 5, 'Questions matched the actual paper closely.'],
  [2, 4, 4, 'Useful list, some answers could be longer.'],
  [3, 1, 5, 'Postfix conversion section is excellent.'],
  [3, 2, 4, 'Solid notes.'],
  [3, 4, 5, ''],
  [4, 0, 3, 'Too short for anything beyond revision.'],
  [5, 0, 5, 'Finally a linked list guide with working C code.'],
  [5, 3, 4, 'Doubly linked list part is great.'],
  [5, 2, 5, 'Clear and well organised.'],
  [6, 1, 4, 'Good question selection.'],
  [7, 0, 4, 'Nice summary of traversals.'],
  [8, 0, 5, 'The complexity comparison table is gold.'],
  [8, 1, 5, 'Covers hashing collisions properly.'],
  [8, 4, 4, ''],
  [9, 0, 5, 'Every paper in one file. Great!'],
  [9, 1, 5, 'Saved me hours of searching.'],
  [9, 2, 4, 'Missing the 2018 paper but still very useful.'],
  [10, 0, 5, 'Answers follow the marking scheme.'],
  [10, 3, 4, 'Helpful for checking my own answers.'],
  [11, 0, 4, 'Good intro to proofs.'],
  [11, 1, 3, 'Needs more worked examples.'],
  [12, 1, 4, 'Planar graphs explained well.'],
  [13, 0, 4, 'Useful papers.'],
  [14, 0, 5, 'Mapping ER to relational tables finally clicked.'],
  [14, 2, 5, 'Excellent notes.'],
  [14, 4, 4, ''],
  [15, 0, 4, 'Relational algebra section is clear.'],
  [15, 1, 5, 'Great SQL examples.'],
  [16, 2, 5, 'Practised every query here before the exam.'],
  [17, 0, 4, 'Quick and accurate.'],
  [17, 1, 3, ''],
  [18, 0, 5, 'Complete set of papers.'],
  [19, 0, 4, 'Easy to follow solutions.'],
  [20, 0, 4, 'Solid process notes.'],
  [20, 1, 4, ''],
  [21, 0, 5, 'Scheduling Gantt charts are perfect.'],
  [21, 2, 4, 'Good one.'],
  [22, 1, 4, 'Banker\'s algorithm example is nice.'],
  [23, 0, 4, 'Memory management finally makes sense.'],
  [24, 0, 4, ''],
  [25, 2, 3, 'Subnetting section is thin.'],
  [26, 1, 4, 'Handy collection.'],
  [27, 0, 4, 'Works for Anna University syllabus too.'],
];

// [review index, student who found it helpful]
const HELPFUL = [[0, 2], [0, 3], [0, 4], [1, 0], [1, 3], [2, 0], [8, 0], [8, 3], [9, 0], [12, 1], [12, 4], [14, 0], [17, 1], [20, 3], [28, 3], [33, 0], [34, 0]];

// [student index, resource index]
const BOOKMARKS = [[0, 5], [0, 8], [0, 9], [0, 14], [1, 0], [1, 9], [2, 3], [2, 15], [3, 0], [3, 16], [4, 0], [4, 12]];

// ── seed steps ───────────────────────────────────────────────────────────────
async function createAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@studysphere.test').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const name = process.env.ADMIN_NAME || 'StudySphere Admin';

  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      await existing.save();
      console.log(`Existing user ${email} promoted to admin.`);
    } else {
      console.log(`Admin ${email} already exists.`);
    }
    return existing;
  }
  const admin = await User.create({ name, email, passwordHash: await User.hashPassword(password), role: 'admin' });
  console.log(`Admin created: ${email}`);
  return admin;
}

async function seedDemo() {
  const admin = await createAdmin();

  const passwordHash = await User.hashPassword(STUDENT_PASSWORD);
  const students = [];
  for (const s of STUDENTS) {
    students.push(await User.create({ ...s, passwordHash, university: UNI, course: titleCase(COURSE) }));
  }

  const subjects = {};
  for (const s of SUBJECTS) {
    subjects[s.key] = await Subject.create({
      university: s.university,
      course: s.course,
      semester: s.semester,
      name: s.name,
      code: s.code,
      units: s.units.map((name, i) => ({ number: i + 1, name, key: toKey(name) })),
      createdBy: admin._id,
    });
  }

  fs.mkdirSync(UPLOAD.DIR, { recursive: true });
  const resources = [];
  for (const [subjectKey, unitNumber, category, title, uploaderIdx, tags, description, daysAgo] of RESOURCES) {
    const subject = subjects[subjectKey];
    const unit = unitNumber ? subject.units.find((u) => u.number === unitNumber) : null;

    const pdf = makePdf(title, [
      'StudySphere sample file (demo data, not real study material).',
      `Subject: ${subject.name}`,
      unit ? `Unit ${unit.number}: ${unit.name}` : 'Covers: whole subject',
      `Uploaded by: ${students[uploaderIdx].name}`,
      `Sample id: ${crypto.randomBytes(6).toString('hex')}`,
    ]);
    const storedName = `${crypto.randomBytes(16).toString('hex')}.pdf`;
    fs.writeFileSync(path.join(UPLOAD.DIR, storedName), pdf);

    resources.push(
      await Resource.create({
        title,
        description,
        category,
        subject: subject._id,
        subjectName: subject.name,
        unit: unit ? unit._id : null,
        unitNumber: unit ? unit.number : null,
        unitName: unit ? unit.name : null,
        uploader: students[uploaderIdx]._id,
        file: { storedName, originalName: `${title.replace(/[^A-Za-z0-9 ]/g, '')}.pdf`, size: pdf.length, mimeType: 'application/pdf', hash: crypto.createHash('sha256').update(pdf).digest('hex') },
        tags,
        status: 'approved',
        downloadCount: 10 + Math.floor(Math.random() * 140),
        viewCount: 40 + Math.floor(Math.random() * 400),
        createdAt: new Date(Date.now() - daysAgo * 86400000),
      })
    );
  }

  const reviews = [];
  for (const [resIdx, studentIdx, rating, comment] of REVIEWS) {
    if (String(resources[resIdx].uploader) === String(students[studentIdx]._id)) throw new Error(`Seed error: student ${studentIdx} reviews own resource ${resIdx}`);
    reviews.push(await Review.create({ user: students[studentIdx]._id, resource: resources[resIdx]._id, rating, comment }));
  }
  for (const [reviewIdx, studentIdx] of HELPFUL) {
    await Review.updateOne({ _id: reviews[reviewIdx]._id }, { $addToSet: { helpfulBy: students[studentIdx]._id }, $inc: { helpfulCount: 1 } });
  }

  for (const [studentIdx, resIdx] of BOOKMARKS) {
    await Bookmark.create({ user: students[studentIdx]._id, resource: resources[resIdx]._id });
  }

  // One open report and one already-dismissed report so the moderation page has data.
  await Report.create({ resource: resources[4]._id, reporter: students[1]._id, reason: 'low_quality', details: 'Very short, mostly a copy of the textbook headings.' });
  await Report.create({ resource: resources[13]._id, reporter: students[4]._id, reason: 'duplicate', details: 'Looks like the same papers as another upload.', status: 'dismissed', resolvedBy: admin._id, resolvedAt: new Date(), resolutionNote: 'Checked: different papers.' });
  await Resource.updateOne({ _id: resources[4]._id }, { $inc: { reportCount: 1 } });
  await Resource.updateOne({ _id: resources[13]._id }, { $inc: { reportCount: 1 } });

  // Compute ratings, trust scores and reputations exactly as the live app does.
  for (const r of resources) await recalculateResource(r._id);
  for (const s of students) await recalculateReputation(s._id);

  console.log(`\nSeeded: ${students.length + 1} users, ${SUBJECTS.length} subjects, ${resources.length} resources, ${reviews.length} reviews, ${BOOKMARKS.length} bookmarks, 2 reports.`);
}

async function wipe() {
  for (const Model of [Report, Bookmark, Review, Resource, Subject, User]) await Model.deleteMany({});
  // Only delete PDFs inside the configured uploads folder.
  if (fs.existsSync(UPLOAD.DIR)) {
    for (const f of fs.readdirSync(UPLOAD.DIR)) if (f.endsWith('.pdf')) fs.unlinkSync(path.join(UPLOAD.DIR, f));
  }
}

async function main() {
  await connectDB();
  await Promise.all([User, Subject, Resource, Review, Bookmark, Report].map((m) => m.init())); // make sure indexes exist

  if (args.has('--admin-only')) {
    await createAdmin();
    return;
  }

  if ((await User.countDocuments()) > 0) {
    if (!args.has('--force')) {
      console.error('\nThe database already contains data. Seeding was cancelled so nothing is overwritten.');
      console.error('To erase everything and load the demo data, run:  npm run seed -- --force\n');
      process.exitCode = 1;
      return;
    }
    console.log('--force given: wiping existing StudySphere data...');
    await wipe();
  }

  await seedDemo();

  console.log('\nDemo logins:');
  console.log(`  Admin   ${process.env.ADMIN_EMAIL || 'admin@studysphere.test'} / ${process.env.ADMIN_PASSWORD || 'Admin@12345'}`);
  console.log(`  Student ${STUDENTS[0].email} / ${STUDENT_PASSWORD}   (also rahul@, meera@, karthik@, sneha@example.com)`);
  console.log('\nChange or delete these accounts before deploying anywhere public.\n');
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
