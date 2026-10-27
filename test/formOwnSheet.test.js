import test from 'node:test';
import assert from 'node:assert/strict';

import { mayPrintForm } from '../lib/entries.js';
import { ROLES } from '../lib/roles.js';

/**
 * ใครพิมพ์ใบขออนุมัติ OT ของใครได้ — `mayPrintForm`, behind
 * app/api/reports/form/[period]/route.js.
 *
 * Written 2026-10-27 for THT0056: a ผู้จัดการแผนก whose request goes to a
 * ผู้อนุมัติรายคน was answered "ดูได้เฉพาะพนักงานในแผนกของตน" on their OWN
 * sheet, because the route asked `isDepartmentManager` — and through it
 * `signsPersonallyFor`, false for oneself — about the reader themselves.
 *
 * Run with: npm test
 */

const SHIPPING = '0000000000000000000000f1';
const SALES = '0000000000000000000000f2';

const person = (over) => ({
  department: SHIPPING, company: 'themtech', approvesDepartments: [],
  approvesCompany: null, active: true, ...over,
});

test('everybody may print their own sheet, whatever their บทบาท and approver', () => {
  for (const role of ROLES) {
    for (const personalApprovers of [[], ['ceo']]) {
      const me = person({ _id: 'me', role, personalApprovers });
      assert.equal(mayPrintForm(me, me), true, `${role} · ${personalApprovers.length ? 'รายคน' : 'แผนก'}`);
      // The browser hands `id`, the server `_id`; both are the same person.
      assert.equal(mayPrintForm({ ...me, _id: undefined, id: 'me' }, me), true, `${role} · id`);
    }
  }
});

test('THT0056 — a ผู้จัดการแผนก with a ผู้อนุมัติรายคน prints their own sheet', () => {
  const tht0056 = person({ _id: 'tht0056', role: 'dept_manager', personalApprovers: ['s001'] });
  assert.equal(mayPrintForm(tht0056, tht0056), true);
});

test("somebody else's sheet is still narrowed for a บทบาท that reads one team", () => {
  const head = person({ _id: 'head', role: 'dept_manager' });
  const staff = person({ _id: 'staff', role: 'employee' });
  const elsewhere = person({ _id: 'away', role: 'employee', department: SALES });
  const personal = person({ _id: 'own', role: 'employee', personalApprovers: ['ceo'] });

  assert.equal(mayPrintForm(head, staff), true, 'their own แผนก');
  assert.equal(mayPrintForm(head, elsewhere), false, 'another แผนก');
  assert.equal(mayPrintForm(head, personal), false, 'signed by a ผู้อนุมัติรายคน, not by them');

  const ceo = person({ _id: 'ceo', role: 'managing_director', department: SALES });
  assert.equal(mayPrintForm(ceo, personal), true, 'the ผู้อนุมัติรายคน prints who they sign for');
});

test('a บทบาท that reads every แผนก prints anybody', () => {
  const away = person({ _id: 'away', role: 'employee', department: SALES });
  for (const role of ['hr', 'admin', 'finance']) {
    assert.equal(mayPrintForm(person({ _id: role, role }), away), true, role);
  }
});
