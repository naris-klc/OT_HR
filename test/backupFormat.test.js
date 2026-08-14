import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  FORMAT_VERSION,
  backupsToPrune,
  buildManifest,
  digest,
  fileNameFor,
  isBackupCollection,
  manifestProblem,
  parseDocs,
  restorableIndexes,
  serializeDocs,
  stampFor,
  verifyAgainstManifest,
  verifyRestored,
} from '../src/lib/backupFormat.js';

const { ObjectId } = mongoose.Types;

/**
 * WHAT A BACKUP HAS TO SURVIVE.
 *
 * These run without a database on purpose. The property that matters — that a
 * document written out and read back is the same document, of the same types —
 * is a property of the format, and testing it through a live Mongo would mean
 * the test only runs where a Mongo is running, which is not where regressions
 * are caught.
 *
 * Run with: npm test
 */

/** The shape of a real row: ids that point at other rows, and dates. */
const sampleEntry = () => ({
  _id: new ObjectId('66b9c0de1234567890abcdef'),
  employee: new ObjectId('66b9c0de1234567890abcd01'),
  workDate: '2026-08-05',
  status: 'approved',
  hours: 7.5,
  capExceeded: false,
  history: [
    { by: new ObjectId('66b9c0de1234567890abcd02'), at: new Date('2026-08-06T02:15:00.000Z'), action: 'approve' },
  ],
  createdAt: new Date('2026-08-05T10:00:00.000Z'),
});

test('ObjectId กลับมาเป็น ObjectId ไม่ใช่ string', () => {
  /**
   * The failure this exists for is silent. `JSON.stringify` turns an ObjectId
   * into a 24-character string, the restore writes that string into `_id`, and
   * the database accepts it — then every `populate()` resolves to null and
   * every report comes back empty with no error anywhere. There is no second
   * chance to notice: by then the original is gone.
   */
  const [back] = parseDocs(serializeDocs([sampleEntry()]));

  assert.ok(back._id instanceof ObjectId, '_id ต้องเป็น ObjectId');
  assert.ok(back.employee instanceof ObjectId, 'reference ไปยัง employee ต้องเป็น ObjectId');
  assert.ok(back.history[0].by instanceof ObjectId, 'ObjectId ที่ซ้อนอยู่ใน array ก็ต้องรอด');
  assert.equal(String(back._id), '66b9c0de1234567890abcdef');
});

test('Date กลับมาเป็น Date และเวลาไม่เคลื่อน', () => {
  // A Date that came back as an ISO string would sort as text and compare as
  // text — which mostly agrees with the calendar, right up until it does not.
  const [back] = parseDocs(serializeDocs([sampleEntry()]));

  assert.ok(back.createdAt instanceof Date, 'createdAt ต้องเป็น Date');
  assert.equal(back.createdAt.toISOString(), '2026-08-05T10:00:00.000Z');
  assert.equal(back.history[0].at.toISOString(), '2026-08-06T02:15:00.000Z');
});

test('สตริงวันที่ยังคงเป็นสตริง', () => {
  /**
   * `workDate` is a 'YYYY-MM-DD' STRING in this system and the reasoning is
   * load-bearing — see ApprovalDelegation and Holiday. A round trip that
   * helpfully promoted it to a Date would move every boundary by the server's
   * timezone, which is the exact thing storing it as a string prevents.
   */
  const [back] = parseDocs(serializeDocs([sampleEntry()]));
  assert.equal(back.workDate, '2026-08-05');
  assert.equal(typeof back.workDate, 'string');
});

test('ตัวเลขคงค่าและคงชนิด BSON เดิม', () => {
  /**
   * Canonical Extended JSON hands numbers back as BSON wrappers — `Double`,
   * `Int32`, `Long` — rather than as plain JS numbers, and that is the point
   * rather than a wart. The wrapper is what carries the WIDTH: a field stored
   * as an int32 goes back in as an int32 instead of being re-guessed by the
   * driver from a bare `7`. The driver unwraps them on insert, so what lands in
   * Mongo is the type that came out of it.
   *
   * The comparisons below therefore go through `valueOf()`. Asserting against
   * the wrapper itself would pin the mechanism instead of the property.
   */
  const [back] = parseDocs(serializeDocs([{
    hours: 7.5, count: 7, capExceeded: false, note: null, code: 'PM-0620',
  }]));

  assert.equal(back.hours.valueOf(), 7.5);
  assert.equal(back.hours._bsontype, 'Double', 'ทศนิยมต้องกลับไปเป็น double ตัวเดิม');
  assert.equal(back.count.valueOf(), 7);
  assert.equal(back.count._bsontype, 'Int32', 'จำนวนเต็มต้องไม่กลายเป็น double');
  assert.equal(back.capExceeded, false);
  assert.equal(back.note, null);
  assert.equal(back.code, 'PM-0620');
});

test('จำนวนเต็มขนาดใหญ่ไม่สูญเสียความละเอียด', () => {
  /**
   * This is why the format is canonical and not relaxed. Relaxed Extended JSON
   * writes a 64-bit integer as a bare JSON number, and 9007199254740993 comes
   * back as 9007199254740992 — off by one, no error, no warning, and no way to
   * tell afterwards which of the two the original was.
   *
   * Nothing in this system stores an integer that large today. The reason to
   * pin it is that a backup is read years after it is written, by which time
   * "nothing stores one today" is a statement about a schema that has moved.
   */
  const [back] = parseDocs(serializeDocs([{ big: 9007199254740993n }]));
  assert.equal(back.big.toString(), '9007199254740993');
});

test('ภาษาไทยรอด และหนึ่งบรรทัดต่อหนึ่งเอกสาร', () => {
  const docs = [{ reason: 'ลาป่วย' }, { reason: 'ไปราชการ\nสองบรรทัด' }];
  const text = serializeDocs(docs);

  // The second document contains a newline. If serialisation let it through
  // raw, the file would have three lines for two documents and the third would
  // not parse — so JSON's own escaping is what keeps one-per-line true.
  assert.equal(text.trimEnd().split('\n').length, 2, 'ต้องได้ 2 บรรทัดสำหรับ 2 เอกสาร');
  assert.deepEqual(parseDocs(text).map((d) => d.reason), ['ลาป่วย', 'ไปราชการ\nสองบรรทัด']);
});

test('collection ว่างได้ไฟล์ว่าง ไม่ใช่ไม่มีไฟล์', () => {
  // "no rows" and "not backed up" have to look different on disk.
  assert.equal(serializeDocs([]), '');
  assert.deepEqual(parseDocs(''), []);
  assert.deepEqual(parseDocs('\n\n'), [], 'บรรทัดว่างท้ายไฟล์ต้องไม่ทำให้พัง');
});

test('บรรทัดที่เสียบอกเลขบรรทัด', () => {
  const text = `${serializeDocs([{ a: 1 }])}{ ไม่ใช่ json }\n`;
  assert.throws(() => parseDocs(text), /บรรทัด 2/);
});

test('ลายนิ้วมือจับการแก้ไฟล์ได้', () => {
  const text = serializeDocs([sampleEntry()]);
  assert.equal(digest(text), digest(text), 'ข้อความเดิมต้องได้ค่าเดิม');
  assert.notEqual(digest(text), digest(`${text} `), 'ต่อท้ายช่องว่างเดียวก็ต้องจับได้');
});

test('verifyAgainstManifest จับไฟล์หาย ไฟล์เพี้ยน และไฟล์แปลกปลอม', () => {
  const text = serializeDocs([sampleEntry()]);
  const manifest = buildManifest({
    database: 'primus_ot',
    takenAt: '2026-08-14T00:00:00.000Z',
    collections: [
      { collection: 'otentries', count: 1, bytes: Buffer.byteLength(text), sha256: digest(text), indexes: [] },
      { collection: 'employees', count: 0, bytes: 0, sha256: digest(''), indexes: [] },
    ],
  });

  assert.deepEqual(
    verifyAgainstManifest(manifest, new Map([
      ['otentries', { bytes: Buffer.byteLength(text), sha256: digest(text) }],
      ['employees', { bytes: 0, sha256: digest('') }],
    ])),
    [],
    'ตรงทุกอย่างต้องไม่มีปัญหา',
  );

  const missing = verifyAgainstManifest(manifest, new Map([
    ['otentries', { bytes: Buffer.byteLength(text), sha256: digest(text) }],
  ]));
  assert.equal(missing.length, 1);
  assert.match(missing[0], /employees/);

  const tampered = verifyAgainstManifest(manifest, new Map([
    ['otentries', { bytes: Buffer.byteLength(text), sha256: digest(`${text}x`) }],
    ['employees', { bytes: 0, sha256: digest('') }],
  ]));
  assert.equal(tampered.length, 1);
  assert.match(tampered[0], /ลายนิ้วมือ/);

  // A stray file is the signature of two backups written into one folder, and
  // restoring that assembles a database out of two different days.
  const stray = verifyAgainstManifest(manifest, new Map([
    ['otentries', { bytes: Buffer.byteLength(text), sha256: digest(text) }],
    ['employees', { bytes: 0, sha256: digest('') }],
    ['holidays', { bytes: 10, sha256: digest('x') }],
  ]));
  assert.equal(stray.length, 1);
  assert.match(stray[0], /ไม่มีใน manifest/);
});

test('รายงานทุกปัญหาพร้อมกัน ไม่ใช่ทีละข้อ', () => {
  // Somebody about to overwrite a live database gets the whole list once.
  const manifest = buildManifest({
    database: 'primus_ot',
    takenAt: '2026-08-14T00:00:00.000Z',
    collections: [
      { collection: 'a', count: 0, bytes: 0, sha256: digest(''), indexes: [] },
      { collection: 'b', count: 0, bytes: 0, sha256: digest(''), indexes: [] },
    ],
  });
  assert.equal(verifyAgainstManifest(manifest, new Map()).length, 2);
});

test('verifyRestored จับจำนวนที่กู้มาไม่ครบ', () => {
  const manifest = buildManifest({
    database: 'primus_ot',
    takenAt: '2026-08-14T00:00:00.000Z',
    collections: [{ collection: 'otentries', count: 812, bytes: 1, sha256: 'x', indexes: [] }],
  });

  assert.deepEqual(verifyRestored(manifest, new Map([['otentries', 812]])), []);
  assert.match(verifyRestored(manifest, new Map([['otentries', 811]]))[0], /811.*812/);
  assert.match(verifyRestored(manifest, new Map())[0], /ไม่ได้ถูกกู้คืน/);
});

test('index ถูกเก็บไว้ และ _id_ ถูกตัดออก', () => {
  /**
   * Dropping a collection drops its indexes. If the unique index on
   * `Employee.code` does not come back, the restored database accepts a second
   * PM-0620 that afternoon and says nothing — and that duplicate is in the next
   * backup too.
   */
  const kept = restorableIndexes([
    { v: 2, key: { _id: 1 }, name: '_id_' },
    { v: 2, key: { code: 1 }, name: 'code_1', unique: true, ns: 'primus_ot.employees' },
  ]);

  assert.equal(kept.length, 1, '_id_ ต้องถูกตัดออก — Mongo สร้างเองและปฏิเสธถ้าสร้างซ้ำ');
  assert.deepEqual(kept[0], { key: { code: 1 }, name: 'code_1', unique: true });
  assert.equal(kept[0].unique, true, 'unique ต้องรอด ไม่งั้นรหัสพนักงานซ้ำได้');
  assert.equal('v' in kept[0], false);
  assert.equal('ns' in kept[0], false);
  assert.deepEqual(restorableIndexes(undefined), []);
});

test('manifest เรียง collection คงที่ และนับยอดรวมให้', () => {
  const manifest = buildManifest({
    database: 'primus_ot',
    takenAt: '2026-08-14T00:00:00.000Z',
    collections: [
      { collection: 'otentries', count: 812, bytes: 1, sha256: 'x', indexes: [] },
      { collection: 'employees', count: 41, bytes: 1, sha256: 'y', indexes: [] },
    ],
  });

  assert.deepEqual(manifest.collections.map((c) => c.collection), ['employees', 'otentries']);
  assert.equal(manifest.totalDocuments, 853);
  assert.equal(manifest.format, FORMAT_VERSION);
});

test('manifest รุ่นอื่นถูกปฏิเสธ ไม่ใช่เดาต่อ', () => {
  // A backup half-understood is worse than one that will not open: the second
  // is noticed.
  assert.equal(manifestProblem({ format: FORMAT_VERSION, collections: [] }), null);
  assert.match(manifestProblem({ format: 99, collections: [] }), /รุ่น 99/);
  assert.match(manifestProblem(null), /อ่านไม่ได้/);
  assert.match(manifestProblem({ format: FORMAT_VERSION }), /ไม่มีรายการ collection/);
});

test('ชื่อ collection ที่พาไฟล์ออกนอกโฟลเดอร์ถูกปฏิเสธ', () => {
  assert.equal(fileNameFor('otentries'), 'otentries.jsonl');
  assert.throws(() => fileNameFor('../secrets'), /ไม่รองรับ/);
  assert.throws(() => fileNameFor('a/b'), /ไม่รองรับ/);
  assert.throws(() => fileNameFor('.hidden'), /ไม่รองรับ/);
});

test('collection ของ Mongo เองไม่ถูกสำรอง', () => {
  assert.equal(isBackupCollection('otentries'), true);
  assert.equal(isBackupCollection('system.views'), false);
  assert.equal(isBackupCollection(''), false);
});

// ── retention: the one thing here that destroys data ────────────────────────

const stamps = (...s) => s.map((x) => `primus_ot-${x}`);

test('เก็บชุดใหม่สุดไว้ ลบที่เหลือจากเก่าสุด', () => {
  const all = stamps('20260811-000000', '20260812-000000', '20260813-000000', '20260814-000000');
  assert.deepEqual(
    backupsToPrune(all, 'primus_ot', 2),
    stamps('20260811-000000', '20260812-000000'),
  );
  assert.deepEqual(backupsToPrune(all, 'primus_ot', 4), [], 'มีเท่าที่เก็บ ไม่ต้องลบ');
  assert.deepEqual(backupsToPrune(all, 'primus_ot', 9), [], 'เก็บมากกว่าที่มี ก็ไม่ลบ');
});

test('เรียงตามชื่อ ไม่ใช่ตามลำดับที่ระบบไฟล์คืนมา', () => {
  /**
   * The stamp sorts as the calendar does, so this needs no `stat` and no clock —
   * and a folder copied in from another machine keeps its place in the sequence
   * instead of jumping to the front on its mtime.
   */
  const jumbled = stamps('20260814-000000', '20260811-000000', '20260813-000000');
  assert.deepEqual(backupsToPrune(jumbled, 'primus_ot', 1), stamps('20260811-000000', '20260813-000000'));
});

test('ไม่แตะอะไรที่เครื่องมือนี้ไม่ได้สร้าง', () => {
  /**
   * `--out` pointing at a shared drive is the ordinary case, so a retention
   * sweep that removed whatever else was in the folder would be a data-loss bug
   * wearing a housekeeping hat.
   */
  const mixed = [
    ...stamps('20260811-000000', '20260812-000000'),
    'เอกสารสำคัญ',
    'primus_ot-notes',
    'primus_ot-2026-08-11',
    'README.txt',
    '.hidden',
  ];
  assert.deepEqual(backupsToPrune(mixed, 'primus_ot', 1), stamps('20260811-000000'));
});

test('สองฐานข้อมูลในโฟลเดอร์เดียวกันไม่ลบของกันและกัน', () => {
  const both = [
    ...stamps('20260811-000000', '20260812-000000', '20260813-000000'),
    'primus_ot_test-20260811-000000',
    'primus_ot_test-20260812-000000',
  ];
  assert.deepEqual(backupsToPrune(both, 'primus_ot', 1), stamps('20260811-000000', '20260812-000000'));
  assert.deepEqual(
    backupsToPrune(both, 'primus_ot_test', 1),
    ['primus_ot_test-20260811-000000'],
    'ชื่อที่เป็นคำนำหน้าของอีกชื่อต้องไม่ถูกเหมารวม',
  );
});

test('ชื่อฐานข้อมูลที่มีอักขระพิเศษไม่กลายเป็น regex', () => {
  // A database called `a.b` must not match `axb`, or a retention sweep on one
  // database quietly eats another's backups.
  const names = ['a.b-20260811-000000', 'axb-20260811-000000', 'a.b-20260812-000000'];
  assert.deepEqual(backupsToPrune(names, 'a.b', 1), ['a.b-20260811-000000']);
});

test('ไม่มีทางลบทั้งหมด แม้จะสั่งให้เก็บ 0', () => {
  /**
   * "Delete all my backups" is not a retention policy, and an unset variable
   * landing as 0 — or as an empty string, or as text — is the likeliest way to
   * ask for it by accident. Every one of those reads as 1.
   */
  const all = stamps('20260811-000000', '20260812-000000');
  for (const keep of [0, -5, null, undefined, NaN, '']) {
    assert.deepEqual(
      backupsToPrune(all, 'primus_ot', keep),
      stamps('20260811-000000'),
      `keep=${String(keep)} ต้องยังเหลือชุดล่าสุดไว้`,
    );
  }
});

test('โฟลเดอร์ว่างไม่พัง', () => {
  assert.deepEqual(backupsToPrune([], 'primus_ot', 3), []);
  assert.deepEqual(backupsToPrune(undefined, 'primus_ot', 3), []);
});

test('ชื่อโฟลเดอร์เรียงตามเวลาได้', () => {
  // Sorting by name has to equal sorting by time, or "the latest backup" needs
  // a person to read timestamps.
  assert.equal(stampFor(new Date('2026-08-14T09:31:07.123Z')), '20260814-093107');
  assert.ok(stampFor(new Date('2026-08-14T09:31:07Z')) > stampFor(new Date('2026-08-14T09:31:06Z')));
  assert.ok(stampFor(new Date('2026-09-01T00:00:00Z')) > stampFor(new Date('2026-08-31T23:59:59Z')));
});
