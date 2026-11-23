const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

test('global layout reset prevents mobile horizontal overflow', () => {
  assert.match(html, /html\s*,\s*body\s*,\s*#app\s*\{[^}]*margin:\s*0/)
  assert.match(html, /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{\s*box-sizing:\s*border-box/)
})
