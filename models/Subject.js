const mongoose = require('mongoose');
const { toKey, makeAcronym } = require('../utils/normalize');

// A unit lives inside its subject. `key` is the normalised name used to reject duplicates.
const unitSchema = new mongoose.Schema({
  number: { type: Number, required: true, min: 1, max: 50 },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  key: { type: String, required: true },
});

const subjectSchema = new mongoose.Schema(
  {
    university: { type: String, required: true, trim: true, maxlength: 120 },
    course: { type: String, required: true, trim: true, maxlength: 120 },
    semester: { type: Number, required: true, min: 1, max: 12 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    code: { type: String, trim: true, uppercase: true, maxlength: 20 },

    // Normalised keys: these (not the display text) enforce "no duplicate folders".
    universityKey: { type: String, required: true },
    courseKey: { type: String, required: true },
    nameKey: { type: String, required: true },
    acronym: { type: String, default: '' }, // "dsa" for Data Structures and Algorithms (search helper)

    units: [unitSchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

subjectSchema.pre('validate', function setKeys(next) {
  this.universityKey = toKey(this.university);
  this.courseKey = toKey(this.course);
  this.nameKey = toKey(this.name);
  this.acronym = makeAcronym(this.name);
  next();
});

// One subject per university + course + semester + name.
subjectSchema.index({ universityKey: 1, courseKey: 1, semester: 1, nameKey: 1 }, { unique: true });
subjectSchema.index({ nameKey: 1 });
subjectSchema.index({ acronym: 1 });
subjectSchema.index({ code: 1 });

module.exports = mongoose.model('Subject', subjectSchema);
