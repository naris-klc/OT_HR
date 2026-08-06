import test from 'node:test';
import assert from 'node:assert/strict';

import { normaliseDescription, DESCRIPTION_MAX_CHARS } from '../src/config/policy.js';

test('รายละเอียดงานที่ทำ is required', () => {
  assert.equal(normaliseDescription('').error, 'กรุณาระบุรายละเอียดงานที่ทำ');
  assert.equal(normaliseDescription('   ').error, 'กรุณาระบุรายละเอียดงานที่ทำ');
  assert.equal(normaliseDescription(undefined).error, 'กรุณาระบุรายละเอียดงานที่ทำ');
});

test('it is trimmed, and the trimmed length is what counts', () => {
  assert.equal(normaliseDescription('  ซ่อมเครื่อง  ').value, 'ซ่อมเครื่อง');
  // 22 characters plus surrounding spaces still fits once trimmed
  const exact = 'ก'.repeat(DESCRIPTION_MAX_CHARS);
  assert.equal(normaliseDescription(`  ${exact}  `).value, exact);
});

test(`it is refused past ${DESCRIPTION_MAX_CHARS} characters`, () => {
  assert.equal(normaliseDescription('ก'.repeat(DESCRIPTION_MAX_CHARS)).error, undefined);
  const over = normaliseDescription('ก'.repeat(DESCRIPTION_MAX_CHARS + 1));
  assert.equal(over.value, undefined);
  assert.match(over.error, new RegExp(`ไม่เกิน ${DESCRIPTION_MAX_CHARS} ตัวอักษร`));
  assert.match(over.error, new RegExp(`${DESCRIPTION_MAX_CHARS + 1}`));
});

test('Thai vowels and tone marks each count as a character, as the input does', () => {
  // 'เครื่อง' is 7 code points — the textarea's maxlength counts them the same
  // way, so the server and the browser agree on when the limit is reached.
  assert.equal('เครื่อง'.length, 7);
  assert.equal(normaliseDescription('เครื่อง'.repeat(3)).error, undefined); // 21
  assert.notEqual(normaliseDescription('เครื่อง'.repeat(4)).error, undefined); // 28
});
