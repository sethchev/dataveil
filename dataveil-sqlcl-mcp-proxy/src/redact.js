const REDACTION = '[REDACTED_PII]';

const TEXT_PATTERNS = [
  {
    name: 'oracle-connect-string',
    pattern: /\b[A-Za-z][\w.$#-]*\/(?!\*{3,})[^\s@'";]+@(?:\[[A-Fa-f0-9:]+\]|[\w.-]+)(?::\d+)?(?:\/[\w.$#-]+)?/g,
    replacement: '[REDACTED_ORACLE_CONNECT]'
  },
  {
    name: 'credential-assignment',
    pattern: /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*(?!\[REDACTED_)([^\s,;}'"]+|"[^"]*"|'[^']*')/gi,
    replacement: (_match, key) => `${key}=[REDACTED_SECRET]`
  },
  {
    name: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[REDACTED_EMAIL]'
  },
  {
    name: 'ssn',
    pattern: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g,
    replacement: '[REDACTED_SSN]'
  },
  {
    name: 'phone',
    pattern: /(?<!\d)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)/g,
    replacement: '[REDACTED_PHONE]'
  },
  {
    name: 'ipv4',
    pattern: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g,
    replacement: '[REDACTED_IP]'
  }
];

const DEFAULT_SENSITIVE_COLUMNS = [
  /^(?:E_?MAIL|EMAIL_?ADDRESS)$/i,
  /^(?:PHONE|PHONE_?NUMBER|MOBILE|CELL|FAX)$/i,
  /^(?:SSN|SOCIAL_?SECURITY(?:_?NUMBER)?|NATIONAL_?ID)$/i,
  /^(?:FIRST_?NAME|MIDDLE_?NAME|LAST_?NAME|FULL_?NAME|PERSON_?NAME|CUSTOMER_?NAME|PATIENT_?NAME|EMPLOYEE_?NAME|CONTACT_?NAME)$/i,
  /^(?:DOB|DATE_?OF_?BIRTH|BIRTH_?DATE)$/i,
  /^(?:ADDRESS|ADDRESS_?[12]|STREET|STREET_?ADDRESS|CITY|POSTAL_?CODE|ZIP(?:_?CODE)?)$/i,
  /^(?:PASSWORD|PASSWD|PASSWORD_?HASH|SECRET|TOKEN|API_?KEY|CREDIT_?CARD|CARD_?NUMBER|CVV)$/i,
  /^(?:IP_?ADDRESS|IPADDR|MAC_?ADDRESS)$/i
];

function redactTextPatterns(input) {
  let text = input;
  let matches = 0;
  const categories = new Set();

  for (const rule of TEXT_PATTERNS) {
    rule.pattern.lastIndex = 0;
    text = text.replace(rule.pattern, (...args) => {
      matches += 1;
      categories.add(rule.name);
      return typeof rule.replacement === 'function' ? rule.replacement(...args) : rule.replacement;
    });
  }

  return { value: text, matches, categories };
}

function parseCsvRecords(text) {
  const records = [];
  let record = [];
  let value = '';
  let quoted = false;
  let wasQuoted = false;

  const finishCell = () => {
    record.push({ value, quoted: wasQuoted });
    value = '';
    wasQuoted = false;
  };
  const finishRecord = () => {
    finishCell();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true;
      wasQuoted = true;
    } else if (character === ',') {
      finishCell();
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      finishRecord();
    } else {
      value += character;
    }
  }

  if (quoted) return null;
  if (value.length > 0 || wasQuoted || record.length > 0) finishRecord();
  return records;
}

function encodeCsvCell(cell) {
  const needsQuote = cell.quoted || /[",\r\n]/.test(cell.value);
  return needsQuote ? `"${cell.value.replaceAll('"', '""')}"` : cell.value;
}

function isEmptyRecord(record) {
  return record.length === 1 && record[0].value.length === 0;
}

function redactSensitiveCsv(text, sensitiveColumns = DEFAULT_SENSITIVE_COLUMNS) {
  const records = parseCsvRecords(text);
  if (!records || records.length < 2) return { value: text, matches: 0, categories: new Set() };

  let matches = 0;
  for (let index = 0; index < records.length; index += 1) {
    const header = records[index];
    if (isEmptyRecord(header)) continue;
    const sensitiveIndexes = header
      .map((cell, cellIndex) => sensitiveColumns.some((pattern) => pattern.test(cell.value.trim())) ? cellIndex : -1)
      .filter((cellIndex) => cellIndex >= 0);
    if (sensitiveIndexes.length === 0) continue;

    for (let rowIndex = index + 1; rowIndex < records.length; rowIndex += 1) {
      const row = records[rowIndex];
      if (isEmptyRecord(row) || row.length !== header.length) break;
      for (const cellIndex of sensitiveIndexes) {
        if (row[cellIndex].value && !row[cellIndex].value.startsWith('[REDACTED_')) {
          row[cellIndex].value = REDACTION;
          matches += 1;
        }
      }
      index = rowIndex;
    }
  }

  if (matches === 0) return { value: text, matches: 0, categories: new Set() };
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  return {
    value: records.map((record) => record.map(encodeCsvCell).join(',')).join(newline),
    matches,
    categories: new Set(['sensitive-column'])
  };
}

export function redactSensitiveText(input, options = {}) {
  if (typeof input !== 'string' || input.length === 0) {
    return { value: input, matches: 0, categories: [] };
  }

  const csv = redactSensitiveCsv(input, options.sensitiveColumns ?? DEFAULT_SENSITIVE_COLUMNS);
  const patterns = redactTextPatterns(csv.value);
  return {
    value: patterns.value,
    matches: csv.matches + patterns.matches,
    categories: [...new Set([...csv.categories, ...patterns.categories])]
  };
}

function isSensitiveKey(key, sensitiveColumns) {
  return sensitiveColumns.some((pattern) => pattern.test(key));
}

export function sanitizeValue(value, options = {}, key = '') {
  const sensitiveColumns = options.sensitiveColumns ?? DEFAULT_SENSITIVE_COLUMNS;

  if (key && isSensitiveKey(key, sensitiveColumns) && value !== null && value !== undefined) {
    if (!(typeof value === 'string' && value.startsWith('[REDACTED_'))) {
      return { value: REDACTION, matches: 1, categories: ['sensitive-field'] };
    }
  }

  if (typeof value === 'string') {
    if (/^(?:protocol_?)?version$/i.test(key) && /^\d+(?:\.\d+){1,5}(?:[-+][\w.-]+)?$/.test(value)) {
      return { value, matches: 0, categories: [] };
    }
    return redactSensitiveText(value, { sensitiveColumns });
  }

  if (Array.isArray(value)) {
    let matches = 0;
    const categories = new Set();
    const output = value.map((item) => {
      const result = sanitizeValue(item, options);
      matches += result.matches;
      result.categories.forEach((category) => categories.add(category));
      return result.value;
    });
    return { value: output, matches, categories: [...categories] };
  }

  if (value && typeof value === 'object') {
    let matches = 0;
    const categories = new Set();
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const result = sanitizeValue(childValue, options, childKey);
      matches += result.matches;
      result.categories.forEach((category) => categories.add(category));
      output[childKey] = result.value;
    }
    return { value: output, matches, categories: [...categories] };
  }

  return { value, matches: 0, categories: [] };
}

export const defaults = {
  redaction: REDACTION,
  sensitiveColumns: DEFAULT_SENSITIVE_COLUMNS
};
