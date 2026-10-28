// Small schema-based validator. Every route declares exactly which fields it accepts:
//   - unknown fields are dropped (no mass-assignment)
//   - values are type-checked and coerced (so {"$gt": ""} can never reach a query)
//   - errors come back as { field: message } for the frontend to show next to inputs

const fs = require('fs');
const { AppError } = require('./errorHandler');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Removes Mongo operator keys ("$where") and dotted keys from user input, in place. */
function stripOperators(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return obj;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete obj[key];
      continue;
    }
    stripOperators(obj[key], depth + 1);
  }
  return obj;
}

function sanitizeInput(req, res, next) {
  stripOperators(req.body);
  stripOperators(req.query);
  stripOperators(req.params);
  next();
}

const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function checkField(name, rule, raw) {
  const label = rule.label || name;
  if (isEmpty(raw)) {
    if (rule.required) return { error: rule.message || `${label} is required` };
    return { value: rule.default };
  }

  let value = raw;
  switch (rule.type || 'string') {
    case 'string':
    case 'email':
    case 'password': {
      if (typeof value !== 'string') return { error: `${label} must be text` };
      if (rule.type !== 'password') value = value.trim();
      if (rule.type === 'email') {
        value = value.toLowerCase();
        if (value.length > 254 || !EMAIL.test(value)) return { error: 'Please enter a valid email address' };
      }
      if (rule.lowercase) value = value.toLowerCase();
      if (rule.min !== undefined && value.length < rule.min) return { error: `${label} must be at least ${rule.min} characters` };
      if (rule.max !== undefined && value.length > rule.max) return { error: `${label} must be at most ${rule.max} characters` };
      if (rule.enum && !rule.enum.includes(value)) return { error: `${label} must be one of: ${rule.enum.join(', ')}` };
      if (rule.pattern && !rule.pattern.test(value)) return { error: rule.patternMessage || `${label} is not in a valid format` };
      return { value };
    }
    case 'int':
    case 'number': {
      if (typeof value === 'string' && value.trim() !== '') value = Number(value);
      if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `${label} must be a number` };
      if (rule.type === 'int' && !Number.isInteger(value)) return { error: `${label} must be a whole number` };
      if (rule.min !== undefined && value < rule.min) return { error: `${label} must be at least ${rule.min}` };
      if (rule.max !== undefined && value > rule.max) return { error: `${label} must be at most ${rule.max}` };
      return { value };
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { value };
      const s = String(value).toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(s)) return { value: true };
      if (['false', '0', 'no', 'off'].includes(s)) return { value: false };
      return { error: `${label} must be true or false` };
    }
    case 'objectId': {
      if (typeof value !== 'string' || !OBJECT_ID.test(value)) return { error: `${label} is not a valid id` };
      return { value };
    }
    case 'array': {
      if (typeof value === 'string' && rule.csv) value = value.split(',');
      if (!Array.isArray(value)) return { error: `${label} must be a list` };
      if (rule.maxItems !== undefined && value.length > rule.maxItems) return { error: `${label} can have at most ${rule.maxItems} items` };
      const items = [];
      for (const item of value) {
        if (typeof item !== 'string') return { error: `${label} must only contain text` };
        const t = item.trim();
        if (!t) continue;
        if (rule.itemMax !== undefined && t.length > rule.itemMax) return { error: `Each item in ${label} must be at most ${rule.itemMax} characters` };
        items.push(t);
      }
      return { value: items };
    }
    default:
      return { value };
  }
}

/**
 * validate({ body: {...}, query: {...}, params: {...} })
 * Rule options: type (string|email|password|int|number|boolean|objectId|array), required, min, max,
 * enum, pattern, patternMessage, default, label, lowercase, csv/maxItems/itemMax (arrays).
 */
function validate(schema) {
  return (req, res, next) => {
    const errors = {};

    for (const part of ['params', 'query', 'body']) {
      const rules = schema[part];
      if (!rules) continue;
      const source = stripOperators(req[part] && typeof req[part] === 'object' ? req[part] : {});
      const cleaned = {};
      for (const [field, rule] of Object.entries(rules)) {
        const { value, error } = checkField(field, rule, source[field]);
        if (error) errors[field] = error;
        else if (value !== undefined) cleaned[field] = value;
      }
      req[part] = cleaned;
    }

    if (Object.keys(errors).length) {
      if (req.file && req.file.path) fs.unlink(req.file.path, () => {}); // don't keep the upload of a rejected form
      return next(new AppError('Validation failed', 400, { errors }));
    }
    next();
  };
}

const idParam = (name = 'id') => ({ [name]: { type: 'objectId', required: true, label: 'id' } });
const pageQuery = {
  page: { type: 'int', min: 1, default: 1 },
  limit: { type: 'int', min: 1, max: 50, default: 12 },
};

module.exports = { validate, sanitizeInput, idParam, pageQuery, OBJECT_ID };
