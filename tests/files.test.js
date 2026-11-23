const test = require('node:test')
const assert = require('node:assert/strict')

const {
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_SIZE,
  sanitizeOriginalName,
  validateDocumentFile,
  createStorageKey,
  assertSafeStorageKey
} = require('../dist-backend/utils/files.js')

test('original names are sanitized without path traversal', () => {
  assert.equal(sanitizeOriginalName('..\\..\\lease agreement.pdf'), 'lease agreement.pdf')
  assert.equal(sanitizeOriginalName(''), 'document')
})

test('document validation enforces size, type, and extension agreement', () => {
  assert.doesNotThrow(() => validateDocumentFile({ originalname: 'contract.pdf', mimetype: 'application/pdf', size: 100 }))
  assert.throws(() => validateDocumentFile({ originalname: 'contract.exe', mimetype: 'application/pdf', size: 100 }), /extension/)
  assert.throws(() => validateDocumentFile({ originalname: 'contract.pdf', mimetype: 'application/zip', size: 100 }), /Unsupported/)
  assert.throws(() => validateDocumentFile({ originalname: 'contract.pdf', mimetype: 'application/pdf', size: MAX_DOCUMENT_SIZE + 1 }), /limit/)
  assert.equal(Object.keys(ALLOWED_DOCUMENT_TYPES).length, 7)
})

test('storage keys are generated and validated safely', () => {
  const key = createStorageKey('../../invoice.pdf')
  assert.match(key, /^[a-f0-9-]{36}\.pdf$/i)
  assert.doesNotThrow(() => assertSafeStorageKey(key))
  assert.throws(() => assertSafeStorageKey('../../etc/passwd'), /Invalid document storage key/)
})
