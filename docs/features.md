# รายการฟีเจอร์ทั้งระบบ — อ่านจากโค้ดจริง

อ่านออกมาเมื่อ **2026-08-25** จากต้นไม้ไฟล์จริงและจากฐานข้อมูลจริง ไม่ใช่จาก
README และไม่ใช่จากความจำ วิธีที่ใช้ทั้งหมดอยู่ท้ายเอกสาร
(§ที่มาของแต่ละคอลัมน์) เพื่อให้รันซ้ำแล้วได้ตัวเลขเดิม

ขนาดของระบบ ณ วันนี้: **59 ไฟล์ `app/api/**/route.js` · 68 endpoint (method × path)
· 30 ไฟล์ `components/*.jsx` · 48 ไฟล์ `lib/*.js` · 101 ไฟล์เทสต์**

---

## วิธีอ่านคอลัมน์ “Mongo จริง”

คอลัมน์นี้ตอบคำถามเดียว — **ฟีเจอร์นี้เคยทำงานกับฐานข้อมูลจริงหรือยัง** ซึ่งไม่ใช่
คำถามเดียวกับ “มีเทสต์ไหม” เพราะ **เทสต์ในชุดนี้ไม่แตะ Mongo เลยสักตัว** (จำนวนที่วัดได้ล่าสุดอยู่ใน README §Status — ที่เดียว)

| สัญลักษณ์ | ความหมาย |
|---|---|
| ✅ | มีหลักฐานตรง — ร่องรอยที่ฟีเจอร์นี้ทิ้งไว้ยังอยู่ในฐานข้อมูล หรือ `otAccessLogs` บันทึกการเรียกไว้ หรือ README §Status บันทึกการเดินไว้เป็นวันที่ |
| ⚠️ | เคยเดิน แต่ **ร่องรอยถูกลบทิ้งแล้ว** — README บันทึกการเดินด้วยข้อมูลชั่วคราวที่ลบหลังเสร็จ ฐานข้อมูลวันนี้จึงไม่ยืนยันให้ |
| ❌ | **ยังไม่เคย** — ที่ที่ฟีเจอร์นี้จำเป็นต้องทิ้งร่องรอยไว้ ว่างเปล่า |
| ❓ | **ไม่แน่ใจ** — เป็นทางอ่านอย่างเดียวที่ไม่ทิ้งร่องรอย และไม่มีบันทึกการเดินไว้ที่ไหน |

> 🚶 **การเดินเมื่อ 2026-08-25 — แปดเส้นทางที่เคยเป็น ❌ ตอนนี้เป็น ⚠️ ทั้งหมด**
> เดินบน**สำเนาของฐานจริง** (`npm run backup` ของ `primus_ot` → `restore --to primus_ot_walk`)
> ยิงผ่าน HTTP จริงบน `next dev` :3002 อ่านยืนยันจาก Mongo ทุกครั้ง ไม่เชื่อ response
> แล้วคืนสภาพด้วย snapshot เดิมพร้อม diff ทีละ document — ขึ้น identical ทั้งแปดครั้ง
>
> ⚠️ ที่ได้จึงต่างจาก ⚠️ เดิมตรงเหตุผล: ไม่ใช่ “ร่องรอยถูกลบหลังเดิน” แต่คือ
> **ร่องรอยไม่เคยอยู่ใน `primus_ot` ตั้งแต่แรก** ฐานจริงไม่ถูกแตะเลยสักไบต์ ซึ่งเป็นเจตนา
> และแปลว่าคอลัมน์นี้จะยังไม่เป็น ✅ จนกว่าจะมีคนใช้ของจริง — รายละเอียดอยู่ใน README §Status

> ⚠️ **`otAccessLogs` เพิ่งเริ่มเก็บเมื่อ 2026-08-24 04:22** (819 รายการ · 28 เส้นทาง)
> การไม่พบเส้นทางหนึ่งในนั้นจึงแปลว่า “ไม่ได้ถูกเรียกในสองวันนี้” เท่านั้น
> ไม่ได้แปลว่าไม่เคยถูกเรียกเลย — นี่คือเหตุผลที่ ❓ แยกจาก ❌

---

## ก. เข้าถึงผ่านหน้าจอได้

แท็บทั้งหมดประกอบขึ้นที่ `components/App.jsx` (ราวบรรทัด 545–630) และขึ้นกับ
`user.role` กับ `user.maySubmitOt` ตารางด้านล่างเรียงตามลำดับที่แท็บโผล่จริง

### แท็บ `OT ของฉัน` — ทุกคนที่ `maySubmitOt`

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| ยื่นใบ OT | กรอกวัน–เวลา ระบบคำนวณชั่วโมงและช่องอัตรา แล้วส่งเข้าคิวหัวหน้า | `components/OtForm.jsx` · `app/api/entries/route.js` · `src/lib/otEngine.js` | `otEngine` `queueCapUsage` `advanceSubmission` `submissionWindowForm` `description` | ✅ 11 ใบในฐานข้อมูล · README walk 2026-08-14 |
| คำนวณล่วงหน้าก่อนกดส่ง | ฟอร์มยิง preview ทุกครั้งที่แก้เวลา เพื่อโชว์ชั่วโมงและคำเตือนก่อนยื่น | `app/api/entries/preview/route.js` · `OtForm.jsx:262` | `otEngine` `quickEditOvernight` | ✅ โดยอนุมาน — ทั้ง 11 ใบยื่นผ่านฟอร์มนี้ |
| แก้ไขใบของตัวเอง (ก่อนหัวหน้าเซ็น) | แก้เวลา/คำอธิบาย คำนวณใหม่ และบันทึกประวัติ | `app/api/entries/[id]/route.js` · `lib/entries.js` | `editPermission` `descriptionEdit` `quickEditOvernight` | ✅ README walk 2026-08-14 (เจอบั๊ก description cap ตรงนี้) |
| ยกเลิกใบของตัวเอง | ถอนใบที่ยังไม่มีใครเซ็น | `app/api/entries/[id]/cancel/route.js` | `cancelPermission` | ✅ มี 1 ใบสถานะ `cancelled` |
| **ขอถอนใบที่อนุมัติแล้ว** | ขอ ≠ ได้ — ยื่นคำขอพร้อมเหตุผล ใบยังนับอยู่จนกว่าจะมีคนตอบ | `app/api/entries/[id]/withdraw/route.js` · `lib/withdrawal.js` | `withdrawal` `approverCompanyScope` | ⚠️ เดิน 2026-08-25 — ขอ → ระหว่างรอสถานะยังเป็น `approved` → อนุมัติให้ถอน → `cancelled` |
| ดูประวัติของใบ | ใครทำอะไรกับใบนี้บ้าง เรียงตามเวลา | `app/api/entries/[id]/trail/route.js` | `hasAuditTrail` `latestPerChain` | ❓ |
| ดูว่ารออยู่ที่ใคร | บอกชื่อคนที่ต้องเซ็นขั้นถัดไป | `app/api/entries/approvers/route.js` · `lib/approverLine.js` | `approverLine` | ✅ `otAccessLogs` · README walk 2026-08-19 |
| ดูเพดานที่ใช้ไปแล้ว | ชั่วโมงสะสมของเดือน/สัปดาห์ เทียบเพดานแผนก | `app/api/entries/usage/[period]/route.js` · `lib/caps.js` | `queueCapUsage` `weeklyCap` `entryListCap` | ✅ `otAccessLogs` |

### แท็บ `รออนุมัติ` — หัวหน้างาน

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| อนุมัติใบ (ขั้นหัวหน้า) | เซ็นขั้นแรก ใบย้ายไป `pending_hr` | `app/api/entries/[id]/approve/route.js` · `lib/delegation.js` | `delegation` `adminApproval` `approverMultiDepartment` | ✅ 8 ใบมี `managerDecision.by` |
| **ปฏิเสธใบ** | ตีกลับพร้อมเหตุผล | `app/api/entries/[id]/reject/route.js` | `delegation` `adminApproval` | ⚠️ เดิน 2026-08-25 — `reject_mgr` แล้วส่งใหม่ผูก `refiledFrom` · ใบเก่าคงอยู่ · สิทธิ์ส่งใหม่ใช้ได้ครั้งเดียว |
| อนุมัติเป็นชุด | เลือกหลายใบแล้วเซ็นรวดเดียว | `components/ApprovalQueue.jsx` | `batchBarSticky` `batchConfirmLabel` | ❓ |
| **ตอบคำขอถอนใบ** | อนุมัติหรือปฏิเสธคำขอถอน | `app/api/entries/[id]/withdraw/decide/route.js` · `components/WithdrawalRequests.jsx` | `withdrawal` | ⚠️ เดิน 2026-08-25 — อนุมัติให้ถอน → `cancelled` · ไม่อนุมัติ → สถานะไม่ขยับเลย |

#### บนหน้าจอเดียวกัน แต่ไม่ใช่ของหัวหน้า — ฝ่ายบุคคล/ผู้ดูแลระบบ

สี่รายการนี้เคยอยู่ในตารางข้างบน ใต้หัวข้อที่เขียนว่า **หัวหน้างาน** ซึ่งผิด —
ตรวจใหม่เมื่อ 2026-08-25 โดยอ่าน guard ของ route จริงเทียบกับหัวข้อที่ครอบมันอยู่

* **`cap-override` เป็น `requireRole(…, 'hr', 'admin')`** หัวหน้ายิงมาได้ 403 ตรง ๆ
  (เดินจริงแล้ว) และปุ่มบนหน้าจอก็ขึ้นเฉพาะ `isHr` ที่ `ApprovalQueue.jsx`
* **แท็บย่อยวันเกิดทั้งแท็บไม่ถูกวาดให้หัวหน้าเลย** ตั้งแต่ 2026-08-13 —
  `QueueTabs.jsx` ถาม `birthdayActionPermission({ user }).ok` ก่อนจะวาดแท็บ
  ทั้งสองปุ่มในนั้นจึงเป็นของ ฝ่ายบุคคล เท่านั้น และเซิร์ฟเวอร์ปฏิเสธซ้ำอีกชั้น

> ⚠️ **`requireRole` ของ route วันเกิดกว้างกว่าความจริง** — ทั้งสามเส้นทางเขียนว่า
> `'manager', 'hr', 'admin'` แต่ `birthdayActionPermission` ข้างในปฏิเสธหัวหน้า
> (เดิน 2026-08-25: หัวหน้ายิงทั้งสองปุ่มได้ 403 พร้อมข้อความว่าเป็นของฝ่ายบุคคล)
> ส่วน `birthday/queue` ไม่ 403 แต่คืน**รายการว่าง** ให้ — อ่าน `requireRole`
> อย่างเดียวจึงตอบคำถาม “ใครใช้ฟีเจอร์นี้ได้” ไม่ได้

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| **ยกเว้นเพดานให้ใบหนึ่ง** | ปล่อยใบที่เกินเพดานแผนกผ่าน พร้อมเหตุผล | `app/api/entries/[id]/cap-override/route.js` | `queueCapUsage` `entryListCap` | ⚠️ เดิน 2026-08-25 — `capExceeded` ถูกล้าง แต่ `capSnapshot.breaches` ยังเก็บว่าเคยเกินอะไรไว้ |
| แท็บย่อย `วันเกิดที่ยังไม่มีใบ` | รายชื่อคนที่วันเกิดตรงกับวันทำงาน แต่ยังไม่มีใบ OT | `app/api/birthday/queue/route.js` · `components/BirthdayQueue.jsx` | `birthdayQueue` `birthdayCheck` `birthdayCardUi` | ✅ `otAccessLogs` 4 ครั้ง 2026-08-24 |
| **บันทึกว่าตรวจแล้ว (วันเกิด)** | ปิดรายการในคิววันเกิดโดยไม่ต้องออกใบ | `app/api/birthday/checks/route.js` · `components/birthdayActions.jsx` | `birthdayCheck` `birthdayQueue` | ⚠️ เดิน 2026-08-25 — บันทึก → หายจากคิว → ยกเลิก → กลับมา · เหลือ 2 แถว แถวแรกไม่ถูกลบ |
| **บันทึก OT ให้จากรายการวันเกิด** | ฝ่ายบุคคลออกใบแทนและอนุมัติในขั้นเดียว | `app/api/birthday/entries/route.js` · `lib/birthdayFiling.js` | `birthdayDirectApproval` `birthdayFileSheet` | ⚠️ เดิน 2026-08-25 — `approved` ชั้นเดียว ไม่มี `managerDecision` เลย · engine หักพักเที่ยงเอง 9 ชม. → 8 ชม. |

### แท็บ `รออนุมัติแทน` — ฝ่ายบุคคล/ผู้ดูแลระบบ (โผล่เมื่อมีทีมที่รับช่วงอยู่)

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| เซ็นขั้นหัวหน้าในฐานะผู้รับช่วง | คิวเฉพาะทีมที่ถูกมอบมา และบันทึกว่าเซ็นด้วยสิทธิ์ของใคร | `lib/delegation.js` · `lib/delegationQuery.js` | `delegation` `delegationQueryBinding` `approverCompanyScope` | ⚠️ README walk 2026-08-14 — ใบทดสอบถูกลบหลังเสร็จ วันนี้ไม่มีใบไหนมี `managerDecision.delegationId` |

### แท็บ `ไม่มีหัวหน้าเซ็น` — ผู้ดูแลระบบ (โผล่เมื่อมีใบค้าง)

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| **ผู้ดูแลระบบเซ็นแทนหัวหน้า** | เฉพาะใบที่ไม่มีใครเซ็นได้จริง ๆ (แผนกไม่มีหัวหน้า) ต้องกรอกเหตุผล | `lib/delegation.js` (`mayOverrideManagerStep`, `nobodyCanSign`) · `app/api/entries/route.js` | `adminApproval` `permissionRouteGuards` | ⚠️ เดิน 2026-08-25 — ไม่มีเหตุผล → 400 · `onBehalfOf`/`delegationId` ไม่มีในเอกสาร ไม่ใช่ null |

### แท็บ `รอ HR ยืนยัน` — ฝ่ายบุคคล/ผู้ดูแลระบบ

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| ยืนยันขั้น HR | เซ็นขั้นที่สอง ใบกลายเป็น `approved` | `app/api/entries/[id]/approve/route.js` | `delegation` `signingCoverage` | ✅ 6 ใบมี `hrDecision.by` |
| HR ปฏิเสธใบที่หัวหน้าเซ็นแล้ว | ขึ้นกับนโยบาย `hrMayReject` และ `hrRejectReturnsTo` | `app/api/entries/[id]/reject/route.js` | `delegation` | ⚠️ เดิน 2026-08-25 — `reject_hr` ลงเอยที่ `rejected` ตาม `hrRejectReturnsTo: 'employee'` |

### แท็บ `ตรวจสอบรายเดือน` — ฝ่ายบุคคล/ผู้ดูแลระบบ (หัวหน้าเห็นเป็น `สรุปทีม`)

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| ตารางรายเดือนทั้งบริษัท | ทุกใบของงวด กรองตามสถานะ/แผนก/คน | `app/api/reports/monthly/[period]/route.js` · `components/HrView.jsx` | `reportColumns` `emptyMonth` `monthSearch` `hrMonthCards` | ✅ `otAccessLogs` 10 ครั้ง |
| แถบแจ้งเตือนของเดือน | **บนสุดของหน้า** เหนือช่องเลือกเดือนและปุ่มพิมพ์/CSV · ระบุชื่อเดือนในหัวข้อ เพราะอยู่เหนือกล่องที่ตั้งเดือน · กล่องเดียว กางเป็นรายการในกล่องเดิม (หัวข้อ: ตัวเลข / คำแนะนำในวงเล็บ) · สีตามข้อความที่แรงที่สุด · ปุ่มกาง/พับและ ✕ อย่างละหนึ่งจุด · ✕ ปิดจนกว่าจะ refresh แล้วเหลือบรรทัด `แสดงแจ้งเตือนของ <เดือน> (n)` | `components/HrView.jsx` (`MonthAlerts`) · `components/PolicyVersion.jsx` (`policyVersionNotice`) | `hrMonthCards` | ✅ เดินบนสำเนาฐาน 2026-08-25 — 360×780 อยู่เหนือช่องเลือกเดือนจริง · มี `.alert` ใบเดียวทุกสถานะ ไม่มี `<details>` ข้างใน · พับ 97px กาง 259px รายการละ 80px · ปุ่มกาง/พับเป็นเม็ดยาเล็ก 34px (ปุ่มตัดสินใจบนการ์ดพนักงานยัง 44px) · ป้ายบนแถวอยู่ครบ |
| หน้าละ 5 คน บนมือถือ — ไม่มีกล่องเลื่อนซ้อน | ต่ำกว่า 860px รายชื่อเป็นการ์ด **หน้าละ 5 คน** เรียบไปกับสกรอลล์ของหน้าเว็บ · **ไม่มีกล่องเลื่อนซ้อน** — `.hr-table tbody` ไม่มี `max-height`/`overflow-y` และ `.table-wrap.card-list` เป็น `overflow: visible` (จำเป็น เพราะ `overflow-x: auto` ทำให้แกน y กลายเป็น `auto` ตามไปด้วย) · เรียงเป็น การ์ด 5 ใบ → แผงเปลี่ยนหน้า → `รวมทั้งหมด` → `วันเกิดของเดือนนี้` · **แผงเปลี่ยนหน้าแสดงทุกเดือน** รวมถึงเดือนที่ลงหน้าเดียวจบ — ปุ่มหัวท้าย `disabled` และบรรทัด `แสดง 1–4 จาก 4 รายการ` ยังบอกความยาวของรายการอยู่ · `pageCount` มีพื้นเป็น 1 จึงไม่มี `หน้า 1 / 0` · หน้าที่หายไปเพราะรายการสั้นลงถูก clamp ตอน render · เปลี่ยนเดือน/สถานะ/พิมพ์ค้นหา กลับหน้า 1 · แถวที่ไม่ได้อยู่ในหน้านี้ใส่คลาส `off-page` **ไม่ได้ `slice` อาร์เรย์** เพราะเดสก์ท็อปไม่มีแผงเปลี่ยนหน้า ถ้า slice เดือนจะเหลือ 5 คนบนจอใหญ่โดยไม่มีปุ่มไปหาที่เหลือ · **กล่องเลื่อนถูกถอดออก–ใส่กลับ–ถอดออกอีกครั้งในวันเดียว** เหตุผลของทั้งสองทางเป็นตัวเลขคนละตัว เขียนเทียบไว้เหนือ `CARD_PAGE` ใน `components/HrView.jsx` | `components/HrView.jsx` · `app/styles.css` (`.hr-table tbody` · `.pager-row` · `.off-page`) | `hrMonthCards` `monthSearch` | ✅ เดินบนสำเนาฐาน 2026-08-26 — 360×780 เดือนที่ปั้นไว้ 25 คน (มีใบอนุมัติ 24) · ไล่ทุก element ที่ `overflow-y` เลื่อนได้ **ได้ลิสต์ว่าง** · `.hr-table tbody` คำนวณเป็น `max-height: none` `overflow-y: visible` · หน้าสูง 3861px · วาด 5 การ์ด ซ่อน 19 · ปุ่มบนการ์ด 121×44 · `แสดง 1–5 จาก 24 รายการ` `หน้า 1 / 5` `ก่อนหน้า` disabled · ค้นหาจนเหลือ 2 คน แผงยังอยู่ `แสดง 1–2 จาก 2 รายการ` `หน้า 1 / 1` **ปุ่ม disabled ทั้งคู่** · 1440px วาดครบ 24 การ์ด (19 แถวยังมีคลาส `off-page` แต่ไม่มีกฎไหนอ่าน) แผงถูกซ่อน ยอดรวม `static` |
| `วันเกิดของเดือนนี้` อยู่ท้ายสุด | ต่อจาก `รวมทั้งหมด` ทันที และเป็นส่วนสุดท้ายของหน้า · **ระยะไม่คงที่แล้ว** เพราะไม่มีกล่องคุมความสูง — แปรตามความสูงของการ์ด 5 ใบ (ต่างกันได้ราวหนึ่งการ์ดตามจำนวนบรรทัดของชื่อ) แต่ไม่แปรตามจำนวนคนในเดือน | `app/styles.css` (`.hr-table tbody` · `.month-card` order) | `hrMonthCards` | ✅ เดินบนสำเนาฐาน 2026-08-26 — 360×780 ในพิกัดหน้า: การ์ดใบแรก 842 → ใบที่ห้า 1513 → แผง 1707 → ยอดรวม 1792 → หัวข้อวันเกิด 1870 · ค้นหาจนเหลือ 2 คน: 932 → 1084 → 1279 → 1363 → 1458 · (ตอนมีกล่อง วัดได้ว่าอยู่ใต้ก้นกล่อง 12px และ **ไม่ขยับเลย** เมื่อเปลี่ยนหน้า ซึ่งเป็นสิ่งเดียวที่แบบนี้ทำไม่ได้) |
| `รวมทั้งหมด` อยู่ใต้แผงเปลี่ยนหน้า | ต่ำกว่า 860px แถวยอดรวมเป็นการ์ดธรรมดาในสายเนื้อหา `static` วางต่อจากแผงเปลี่ยนหน้า · พื้น `--neutral-wash` ยังอยู่เพราะเป็นตัวบอกว่าแถวนี้เป็นของเดือน ไม่ใช่ของคน · ไม่มี `position`/`z-index`/เงา เพราะไม่มีอะไรลอดใต้มัน · เคยเป็น `sticky` สองแบบ: ลอยเหนือแถบล่าง แล้วติดก้นกล่อง | `app/styles.css` (`.hr-table tbody tr.total-row` · `.table-wrap.card-list`) | `hrMonthCards` | ✅ เดินบนสำเนาฐาน 2026-08-26 — `position` คำนวณออกมาเป็น `static` · ไล่หน้าทีละ 40px ผ่านแผงเปลี่ยนหน้า **14 ใน 17 จุดที่แผงอยู่ในจอ ยิง hit-test กลางปุ่มแล้วชี้กลับมาที่ปุ่มเอง** สามจุดที่เหลือคือตอนแผงยังอยู่ใต้แถบล่าง กับตอนมันขึ้นไปหลังแถบค้นหา ซึ่งเป็นแถบตรึงสองอันที่หน้านี้มีมาตลอด (ตอนมีกล่อง ตัวที่บังคือยอดรวม sticky ซึ่งเลื่อนไปกับแผง 2 ใน 19 จุด) |
| กดเปลี่ยนหน้าแล้วเลื่อนกลับไปหัวรายชื่อ | แผงเปลี่ยนหน้าอยู่ใต้การ์ดใบที่ห้า คนกดจึงกดโดยมีรายชื่อห้าใบอยู่เหนือหัวแม่มือ — ถ้าไม่เลื่อน การ์ดห้าใบใหม่จะถูกวาดเหนือจอที่ยังมองแผงอยู่ กดแล้วเหมือนไม่มีอะไรเกิดขึ้น · `goPage()` เรียก `scrollIntoView({ block: 'start' })` บนกล่องครอบรายชื่อ · จะหยุดต่ำแค่ไหนเป็นเรื่องของสไตล์ชีต — `scroll-margin-top: 156px` (แถบหัว 62 + ช่องค้นหา ~69 + บรรทัดที่โผล่ตอนค้นหา) · **อยู่ใน handler ไม่ใช่ `useEffect`** เพราะบน effect มันจะยิงตอน mount และทุกครั้งที่พิมพ์ในช่องค้นหา = จอกระโดดลงมาที่รายชื่อขณะคนกำลังพิมพ์ | `components/HrView.jsx` (`goPage` · `listRef`) | `hrMonthCards` | ✅ เดินบนสำเนาฐาน 2026-08-26 — เลื่อนจนเห็นแผงแล้วกด `ถัดไป`: หน้าเลื่อนจาก 1000 → 674 · กล่องรายชื่ออยู่ที่ 156 ในจอ · การ์ดใบแรกของหน้า 2 ห่างขอบล่างช่องค้นหา **24px** · `ก่อนหน้า` กลับมากดได้ |
| ฝ่ายบุคคลแก้ไขใบ | แก้ใบที่ยังไม่ปิดงวด ต้องมีเหตุผล บันทึกประวัติ | `components/HrEdits.jsx` · `components/HrEntries.jsx` | `editPermission` `editTally` `descriptionEdit` | ✅ README walk 2026-08-14 (`hr_edit` ในประวัติ) |
| **ปิดงวด / เปิดงวดที่ปิดแล้ว** | ล็อกเดือน ปิดทางเขียนของ 7 route · เปิดคืนได้เฉพาะผู้ดูแลระบบพร้อมเหตุผล | `components/PeriodLock.jsx` · `app/api/periods/[period]/{close,reopen}/route.js` · `lib/periodLock.js` | `periodLock` `periodLockRoutes` `periodReminder` `replayPeriodLock` | ⚠️ เดินอีกครั้ง 2026-08-25 — ปิด → ยื่นเข้าเดือนนั้น 409 → เปิดคืน (admin + เหตุผล) → ยื่นได้ · `events` เรียงถูก · **`otPeriodLocks` ในฐานจริงยังว่างอยู่** |
| พิมพ์ใบ F-HR-027 ทั้งเดือนรวดเดียว | รวมทุกคนในงวดเป็นชุดพิมพ์ | `components/PrintFormBatch.jsx` · `app/api/reports/form/[period]/route.js` | `formBundle` `formPrintScope` `printFlagLayout` | ✅ `otAccessLogs` — แต่ยังไม่เคยส่งเข้าเครื่องพิมพ์จริง |
| ส่งออกรายการเป็น CSV | ทุกใบของงวดตามตัวกรองที่ตั้งไว้ | `app/api/exports/entries.csv/route.js` | `accountingReconciliation` | ✅ `otAccessLogs` 2 ครั้ง |
| ส่งออกสรุปรายเดือนเป็น CSV | ยอดรวมต่อคนต่อเดือน | `app/api/exports/monthly.csv/route.js` | `reportColumns` `emptyMonth` | ❓ |

### แท็บ `สรุป OT ส่งบัญชี` — ฝ่ายบุคคล/ผู้ดูแลระบบ

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| ใบส่งบัญชีต่อบริษัท | แยก Primus / Themtech · เลือกรวมคนที่ OT เป็นศูนย์ได้ | `components/AccountingView.jsx` · `app/api/reports/accounting/[period]/route.js` · `lib/accounting.js` | `accountingReconciliation` `reportDimension` `zeroRowReason` `emptyMonth` | ✅ README walk เต็มรูปแบบ + `otAccessLogs` 4 ครั้ง |
| ตารางพอดีจอ บนมือถือ | ต่ำกว่า 860px ตารางทั้งสองของหน้านี้ (ใบต่อบริษัท และ `รวมทุกบริษัท`) **ไม่เลื่อนแนวนอนอีกแล้ว** — ทุกแถวเป็นกริดห้าช่องเท่ากันทั้ง `thead`/`tbody`/`tfoot` คอลัมน์ตัวเลขจึงยังอ่านลงตามแนวตั้งได้ · `แผนก` กับ `หมายเหตุ / บริษัท` พับลงบรรทัดที่สองใต้ชื่อ (`รวมทุกบริษัท` พับ `จำนวนคน` พร้อมป้ายกำกับที่หายไป) · หัวคอลัมน์ย่อด้วย `RateHead` prop `short` — `×1.5 วันหยุด` → `×1.5 หยุด` เก็บทั้งสองคำไว้ในมาร์กอัปแล้วซ่อนทีละคำด้วย `.rh-wide`/`.rh-narrow` เพราะฝั่งเซิร์ฟเวอร์ไม่รู้ความกว้างจอ · ตัวเลขลดหนึ่งขั้นเป็น 12px ระยะขอบเซลล์ 3px · **ลดขนาดอย่างเดียวไม่พอ** — ได้ราว 60px จากที่เกินอยู่ 256px · เส้นคั่นและพื้นของแถวสรุปย้ายจาก `td` ขึ้นไปที่ `tr` เพราะพื้นระดับเซลล์เว้นช่องว่างระหว่างกริดกับบรรทัดที่พับไว้ · **ไม่มีคอลัมน์ตรึงแล้ว** ตรึงไว้เพื่อการเลื่อนแนวนอนซึ่งไม่มีอีกต่อไป | `app/styles.css` (`.acct-table` · `.allco-table` · `.rh-narrow`) · `components/common.jsx` (`RateHead`) · `components/AccountingView.jsx` | `accountingReconciliation` `docsMatchCode` | ✅ เดินบนแอปที่ build แล้ว 2026-08-26 — 360px: `.table-wrap` กว้าง 304 `scrollWidth` 304 ช่องกริดวัดได้ 112/46/46/46/54 · 320px และ 360px `document.scrollWidth === clientWidth` · 1280px แถวยังคำนวณเป็น `display: table-row` ความกว้างเดิม 168/165/52/58/58/137/300 |
| ยอดสรุปอยู่บน บนมือถือ | ต่ำกว่า 860px ลำดับในตารางใบต่อบริษัทคือ หัวคอลัมน์ → `รวมแผนก` และ `รวมทั้งหมด` → รายชื่อ · ทะเบียน active 20 คน (ไพรมัส 15 · เดมเทค 5) และตารางแสดงเฉพาะคนที่มี OT — ติ๊ก `แสดงพนักงานที่ไม่มี OT` จึงเติมแถวเปล่าให้ 13 คนที่ `role: 'employee'` — กรณียาวสุดจึงราว 15 แถวต่อบริษัท (~1,350px) และตัวเลขที่เป็นเป้าหมายของหน้านี้ (ยอดต่อแผนก และการแยกสามช่องเรตของบริษัท ซึ่งเป็นที่มาของช่อง 1.50/3.00 บนกระดาษ) เคยอยู่ท้ายสุด · ยอดรวมของบริษัทอยู่บนหัวการ์ดเป็นชิปมาตลอด แต่การแยกช่องเรตไม่ได้อยู่ · ทำด้วย `order` บนตารางที่เป็น flex column — **มาร์กอัปเดียว สองลำดับ** กลไกเดียวกับที่ `.month-card` ยก `วันเกิดของเดือนนี้` ขึ้นเหนือเชิงอรรถ · ในเอกสาร `tfoot` ยังอยู่ท้ายเหมือนเดิม ซึ่งเป็นลำดับของเดสก์ท็อป CSV และใบกระดาษ · หัวคอลัมน์ยังอยู่บนสุดและคุมทั้งสองบล็อก เพราะทั้งคู่วางบนกริดห้าช่องเดียวกัน · เส้นคั่นย้ายไปที่ `tbody` และ `tfoot` เลิกวาดเส้นชนกับเส้นใต้หัวคอลัมน์ · **`รวมทุกบริษัท` ไม่ถูกสลับ** เพราะมีสามแถว การยกยอดรวมขึ้นเหนือสองตัวที่มันบวกมาไม่ได้ช่วยอะไร | `app/styles.css` (`.acct-table > tfoot` · `.acct-table > tbody`) | `hrMonthCards` | ✅ เดินบนแอป 2026-08-26 — 360px `display: flex` `order` 0/1/2 สามบล็อกอยู่ที่ y = 749 / 780 / 965 · 1280px ตารางเดียวกันคำนวณเป็น `display: table` ทุก `order` เป็น 0 และ `tbody` (514) อยู่เหนือ `tfoot` (642) · **บีบแถวรอบสอง** หลังโดนติว่าโปร่งเกิน: เซลล์ที่พับคืน `padding: 8px 7px` ที่ค้างจากกฎ COMPACT (ใต้กริดมันไม่ได้คั่นเซลล์ แต่ไปพองแทร็ก และพองสองครั้งต่อแถว) เหลือให้ `tr` กับ `row-gap` พูดเรื่องระยะแทน · วัดใหม่ `รวมแผนก` 91 → 55px · แถวคน 109 → 76px · แถวที่มีคำเตือนค้างอนุมัติ 161 → 108px · บรรทัดสองของแถวสรุปกลายเป็นคำบรรยายบรรทัดเดียว (ป้ายชิดซ้าย จำนวนคนชิดขวา 11px) และ `tfoot tr + tr` มีเส้น `--line-softer` คั่น |
| CSV ส่งบัญชี | ไฟล์เดียวกันแบบมี BOM ให้ Excel อ่านภาษาไทยออก | `app/api/exports/accounting.csv/route.js` | `accountingReconciliation` | ✅ README walk (ตรวจ `EF BB BF` แล้ว) |
| พิมพ์ใบส่งบัญชี | เวอร์ชันกระดาษของตารางเดียวกัน | `components/AccountingPrint.jsx` | `printFlagLayout` | ❓ หน้าจอเคยใช้ กระดาษยังไม่เคย |

### แท็บ `สรุป OT แยกแผนก` — ฝ่ายบุคคล/ผู้ดูแลระบบ

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| ยอดชั่วโมงต่อแผนก | นับสองบริษัทรวมกัน — คนละคำถามกับใบส่งบัญชี | `components/DepartmentView.jsx` · `lib/departmentSummary.js` | `reportColumns` `emptyMonth` `employeeCode` | ✅ อ่านจาก `/reports/accounting` ตัวเดียวกัน |
| CSV / พิมพ์ แยกแผนก | ไฟล์และกระดาษของตารางเดียวกัน | `app/api/exports/departments.csv/route.js` · `components/DepartmentPrint.jsx` | `reportColumns` | ❓ |

### แท็บ `ใบ F-HR-027` — ทุกคนที่ `maySubmitOt`

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| ใบขออนุมัติของตัวเอง | ฟอร์มกระดาษของงวดตัวเอง · `formPrintScope` ตัดสินว่าพิมพ์เฉพาะใบที่อนุมัติแล้วหรือทั้งหมด | `components/PrintForm.jsx` · `app/api/reports/form/[period]/route.js` | `formPrintScope` `printFlagLayout` `formBundle` `birthdayOnPaper` | ✅ `otAccessLogs` |

### แท็บ `ตั้งค่าระบบ` — ฝ่ายบุคคล/ผู้ดูแลระบบ · 7 หัวข้อ

| หัวข้อ | ฟีเจอร์ในนั้น | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| 1 แผนกและเพดาน | เพิ่ม/แก้แผนก · เพดานเดือนและสัปดาห์ · รูปแบบโอที (`normal`/`daily`/`none`) | `app/api/departments/` · `lib/departments.js` · `lib/otMode.js` | `departmentPermission` `otMode` `weeklyCap` | ✅ 5 แผนก · `otAccessLogs` มี PATCH 2 ครั้ง |
| 1 ↳ ปิด/เปิดใช้งานแผนก | ผู้ดูแลระบบเท่านั้น · ไม่มีการลบถาวรในระบบเลย | `app/api/departments/[id]/route.js` | `departmentPermission` `permissionRouteGuards` | ❌ ทั้ง 5 แผนก `active: true` — ยังไม่เคยปิดแผนกไหน |
| 2 พนักงาน | เพิ่ม/แก้ทะเบียน · ตั้งบทบาท · เซ็นให้บริษัท · เปิด-ปิดบัญชี | `app/api/employees/` · `lib/employees.js` | `rosterPermission` `rosterRouteGuards` `personalFields` `signingCoverage` `approverCompanyScope` | ✅ 20 คน · `otEmployeeAudits` 37 รายการ |
| 2 ↳ ตั้งรหัสผ่านใหม่ให้คนอื่น | สุ่มรหัสชั่วคราว โชว์ครั้งเดียว บังคับเปลี่ยนตอนเข้าครั้งถัดไป | `lib/tempPassword.js` | `tempPassword` `passwordReveal` `lockout` | ✅ 9 รายการ `password_reset` |
| 2 ↳ เปลี่ยนรหัสพนักงาน | ผู้ดูแลระบบ และต้องระบุเหตุผล | `lib/employees.js` (`codeChangePermission`) | `employeeCode` `rosterAudit` | ✅ 2 รายการ (2026-08-11) |
| 2 ↳ นำเข้าพนักงานจาก CSV | ตรวจสิทธิ์รายแถว · มีปุ่มดาวน์โหลดแม่แบบ | `app/api/employees/import/` · `lib/birthDate.js` | `birthDateImport` `rosterRouteGuards` | ✅ 2 รายการ `source: 'import'` (2026-08-18) |
| 2 ↳ พิมพ์ใบแจกรหัสผ่าน | กระดาษแจกรหัสชั่วคราวหลังนำเข้า | `components/PasswordSlips.jsx` | `passwordSlips` | ❓ |
| 2 ↳ ประวัติ/ผลกระทบรายคน | ใครแก้อะไรในแถวนี้ · ย้ายบริษัทแล้วกระทบรายงานย้อนหลังกี่เดือน | `app/api/employees/[id]/{audit,impact}/` · `lib/rosterImpact.js` | `rosterAudit` `rosterImpact` `reportDimension` | ❓ |
| 3 วันหยุดบริษัท | เพิ่ม/ลบวันหยุด · แก้แล้วคำนวณใบที่กระทบใหม่ทันที | `app/api/holidays/` · `lib/holidays.js` | `holidayYear` `birthdayOnPaper` | ✅ 6 วันหยุด · replay run 2026-08-17 |
| 3 ↳ นำเข้าวันหยุดจาก CSV | ทั้งปีทีเดียว พร้อมแม่แบบ | `app/api/holidays/import/` | `holidayYear` | ✅ 2 รายการ `source: 'import'` |
| 4 นโยบายการคำนวณ | 32 ค่า — พัก ปัดเศษ ขั้นต่ำ เพดาน วันเกิด ขอบเขตการพิมพ์ ฯลฯ | `app/api/settings/policy/route.js` · `lib/policySave.js` · `src/config/policy.js` | `policyVersion` `policyEffectiveDate` `policyReplay` `policyInert` `otEngine` | ✅ 11 เวอร์ชันในฐานข้อมูล |
| 4 ↳ ประวัติเวอร์ชันนโยบาย | ทุกการเปลี่ยนกลายเป็นเวอร์ชัน · ใบชี้ไปที่เวอร์ชันที่ใช้ตอนคำนวณ | `lib/policyVersion.js` · `components/PolicyVersion.jsx` | `policyVersion` `policyReplay` `birthDateReplay` | ✅ ทุกใบมี `policyVersionId` ครบ |
| 4 ↳ ยืนยันข้อ [OPEN] | ฝ่ายบุคคลเซ็นรับค่าที่ระบบเดาไว้ · ผูกกับค่าที่เซ็น · ใส่ที่มา/เหตุผลได้ | `lib/policyConfirmations.js` · `lib/policyConfirmSave.js` | `policyConfirmation` | ✅ 4 รายการ (2026-08-14 · ยังไม่มี `values`) |
| 5 ผู้รับช่วงอนุมัติ | มอบคิวหัวหน้าให้คนอื่นชั่วคราว และถอนคืนได้ | `app/api/delegations/` · `lib/delegation.js` | `delegation` `delegationQueryBinding` | ✅ 1 รายการ สร้างแล้วถอนคืน 2026-08-14 |
| 6 ประวัติการแก้ทะเบียน | ตารางรวมของทุกคน · allowlist ฟิลด์ รหัสผ่านลงไม่ได้ | `app/api/employees/audit/route.js` · `lib/rosterAudit.js` | `rosterAudit` `rosterRouteGuards` | ❓ ข้อมูลมี แต่ไม่มีร่องรอยการเปิดอ่าน |
| 7 ชื่อบริษัทและฟอร์ม | ชื่อไทย/อังกฤษ และรหัสฟอร์มบนกระดาษ | `app/api/settings/route.js` | `settingsCoverageUi` | ✅ PATCH 1 ครั้ง 2026-08-24 |

### แท็บ `บันทึกระบบ` — ผู้ดูแลระบบเท่านั้น · 5 แท็บย่อย

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| ภาพรวม / การเข้าใช้งาน / การแก้ไขข้อมูล / ทั้งหมด | ข้อมูลจราจร ม.๒๖ · เขียนที่ `route()` ที่เดียว จึงครอบทุก route โดยอัตโนมัติ | `lib/http.js` · `lib/accessLog.js` · `app/api/logs/` | `accessLog` `logRouteGuards` `logCardMobile` `logPageNote` | ✅ 819 รายการ |
| CSV ข้อมูลจราจร | ไฟล์เต็มทุกคอลัมน์ สำหรับคนที่จะไม่ได้ login | `app/api/exports/logs.csv/route.js` | `logRouteGuards` | ✅ 2 ครั้ง |
| การใช้สิทธิ์พิเศษ | 6 เหตุการณ์ที่ปกติจะถูกปฏิเสธ พร้อมเหตุผล อ่านจาก 4 collection ไม่ใช่ traffic log | `lib/complianceExport.js` · `lib/complianceQuery.js` | `complianceExport` `complianceCardMobile` | ✅ 19 ครั้ง |
| CSV การใช้สิทธิ์พิเศษ | ไตรมาสเดียวจบ ไม่มี `?actor=` โดยตั้งใจ | `app/api/exports/compliance.csv/route.js` | `complianceExport` | ✅ 4 ครั้ง |

### หน้าจออื่นที่ไม่ได้อยู่ในแถบเมนู

| ฟีเจอร์ | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| เข้าสู่ระบบ / ออกจากระบบ | JWT ใน cookie `ot_token` · หน่วงเวลาแบบทวีคูณเมื่อรหัสผิด ไม่ล็อกบัญชี | `app/api/auth/` · `lib/session.js` · `lib/loginThrottle.js` | `loginThrottle` `lockout` `loginBlankFields` | ✅ login 14 · logout 12 ครั้ง · README walk 2026-08-14 |
| ข้อมูลส่วนตัว | ดูข้อมูลตัวเอง · เปลี่ยนรหัสผ่านตัวเอง · หัวหน้าตั้งผู้รับช่วงของตัวเอง | `components/ProfileView.jsx` · `app/api/employees/me/password/route.js` | `profileActions` `personalFields` `tempPassword` | ❓ ไม่มี audit สำหรับการเปลี่ยนรหัสตัวเอง · 3 บัญชียังค้าง `mustChangePassword: true` |
| หัวหน้าบันทึก OT แทนลูกทีม | ใบข้ามขั้นที่ผู้ยื่นเองจะต้องเซ็น · ติดธง `filedBy` | `lib/proxyFiling.js` · `app/api/entries/route.js` | `proxyFiling` `approverCompanyScope` | ✅ 1 ใบมี `filedBy` ต่างจากเจ้าของ · README walk 2026-08-14 |
| แบนเนอร์เตือนสำรองข้อมูล | อ่านโฟลเดอร์ `BACKUP_DIR` จริง ไม่ใช่ log ของ Task Scheduler | `components/BackupBanner.jsx` · `app/api/settings/backup-status/route.js` · `lib/backupStatus.js` | `backupStatus` | ✅ 71 ครั้ง |
| แถบเตือนนโยบายเปลี่ยน | ขึ้นบนคิวอนุมัติเมื่อค่ากฎที่ใช้อยู่ไม่ตรงกับเวอร์ชันที่บันทึกไว้ | `components/PolicyVersion.jsx` (`PolicyDriftBanner`) | `policyVersion` `policyInert` | ✅ |

---

## ข. มี route แต่ไม่มีหน้าจอ — ต้องยิง API เอง

จาก 68 endpoint มีเพียง **2 ตัว** ที่ไม่มีปุ่มไหนในแอปเรียกถึง

| endpoint | ทำอะไร | ไฟล์หลัก | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| `POST /api/settings/recompute` | คำนวณใบทั้งงวดใหม่ · ใส่ `includeApproved: true` แล้วจะขยับตัวเลขที่เซ็นรับไปแล้ว (ผู้ดูแลระบบ และต้องมี `note`) | `app/api/settings/recompute/route.js` · `src/services/otService.js` | `policyReplay` `replayPeriodLock` `permissionRouteGuards` | ⚠️ เดิน 2026-08-25 — replay ทั้งมีและไม่มี `includeApproved` · **เดือนที่ปิดงวดถูกข้ามเสมอ** (`updated: 0`, ใบไม่ขยับ) · ก่อนหน้านั้น `otPolicyReplayRuns` มี 30 รายการ แต่ไม่มีสักรายการที่ filter เป็น `{period}` (18 รายการมาจากการแก้ทะเบียน · 11 จากการบันทึกนโยบาย · 1 จากนำเข้าวันหยุด) |
| `GET /api/health` | ให้ตัวเฝ้าระวังภายนอกเรียก · route เดียวที่ไม่ผ่าน `requireAuth` | `app/api/health/route.js` | — | ❓ ไม่พบใน `otAccessLogs` เลยตั้งแต่ 24 ส.ค. |

> `PATCH /api/settings` เคยอยู่ในรายการนี้ ตอนนี้มีหน้าจอแล้ว (ตั้งค่าระบบ → ชื่อบริษัทและฟอร์ม)

---

## ค. Script บนเซิร์ฟเวอร์

| คำสั่ง | ทำอะไร | ไฟล์ | เทสต์ | Mongo จริง |
|---|---|---|---|---|
| `npm run seed` | ล้าง 5 collection แล้วสร้างข้อมูลตัวอย่างใหม่ · `seedGuard` ปฏิเสธถ้ามีข้อมูลที่ seed ไม่ได้สร้าง | `src/seed.js` · `lib/seedGuard.js` | `seedGuard` `seedEntryPoint` | ✅ ฐานข้อมูลปัจจุบันมาจากการ seed 2026-08-13 |
| `npm run backup` | dump ทุก collection เป็น Extended JSON ผ่าน driver (เครื่องนี้ไม่มี `mongodump`) | `src/backup.js` · `src/lib/backupFormat.js` | `backupFormat` `seedEntryPoint` | ✅ ชุดสำรองจริง 6 ชุดใน `backups/` และ 2 ชุดใน `C:\Users\suwan\OT-Backups` |
| `npm run restore` | กู้คืน · ตรวจลายนิ้วมือทุกไฟล์ก่อนแตะ collection แรก · สร้าง index คืน | `src/restore.js` | `restoreArgs` `backupFormat` `seedEntryPoint` | ✅ README round trip 2026-08-14 เทียบไบต์ต่อไบต์ |
| `npm run reset-admin -- <CODE>` | ทางกลับเข้าบัญชีผู้ดูแลระบบที่ลืมรหัส · เฉพาะแถว admin · ลงบันทึกโดยไม่ระบุตัวผู้กระทำ | `src/reset-admin-password.js` | `lockout` `permissionRouteGuards` | ⚠️ เดิน 2026-08-25 — ปฏิเสธสามทาง แล้วรหัสใหม่ล็อกอินผ่าน HTTP ได้พร้อม `mustChangePassword` · เขียนแถว `source: 'script'` ที่ไม่มีผู้กระทำ |
| `npm run whatif` | ตีราคาการเปลี่ยนนโยบายก่อนเปลี่ยนจริง · อ่านอย่างเดียว ปลอดภัยกับ prod · `-- --show` บอกค่าที่ใช้อยู่จริง | `src/whatif.js` | — | ✅ ใช้ตอบข้อ [OPEN] เมื่อ 2026-08-13 |
| `npm run migrate:company` | เติม `company` ให้แถวที่เกิดก่อนมีฟิลด์นี้ · `--dry` ดูแผนได้ | `src/migrate-company.js` | — | ❓ ไม่มีร่องรอย · วันนี้ไม่มีพนักงานคนไหนขาด `company` จึงเป็น no-op อยู่แล้ว |
| `npm run migrate:policy-version` | สร้างเวอร์ชันที่ 1 แล้วชี้ทุกใบที่ยังไม่มีตัวชี้ไปที่นั้น | `src/migrate-policy-version.js` · `lib/policyVersion.js` | `policyVersion` (ส่วน `planBackfill`) | ❓ ทุกใบมี `policyVersionId` ครบ แต่ฐานข้อมูลถูก seed ใหม่เมื่อ 2026-08-13 ทับหลักฐานไปแล้ว |
| `npm run migrate:birthday-rule-start` | ย้ายวันเริ่มมีผลของกฎวันหยุดวันเกิดไปต้นเดือน | `src/migrate-birthday-rule-start.js` | `birthdayCheck` `otBirthday` | ✅ เวอร์ชันที่ 10 (2026-08-20) มีเหตุผลตรงกับสิ่งที่สคริปต์นี้เขียน |
| `npm test` | ทั้งชุด · ไม่แตะ Mongo เลย | `test/*.test.js` | — | — |
| `npm run build` / `start` / `dev` | Next 16.3 · **สั่ง `build` ขณะ `start` ทำงานอยู่ ทำให้หน้าที่เปิดค้างพังจนกว่าจะรีสตาร์ท** | `next.config.js` | — | — |
| `scripts/backup.ps1` | ตัวที่ Task Scheduler เรียกทุกวัน 01:00 · ต้องทดสอบด้วย `powershell.exe` ไม่ใช่ `pwsh` | `scripts/backup.ps1` | — | ✅ `backups/backup.log` มีบันทึกถึง 2026-08-25 |
| `scripts/backup.sh` | ตัวเดียวกันฝั่ง POSIX | `scripts/backup.sh` | — | ❓ |
| `scripts/make-icon.js` | สร้างไฟล์ไอคอน/โลโก้ใน `public/` | `scripts/make-icon.js` | — | ✅ `public/logo.png` และ `public/logo-mark.png` มีอยู่ |

---

## สิ่งที่ควรอ่านก่อน deploy — ฟีเจอร์ที่เทสต์ผ่านแต่ยังไม่เคยเดินกับ Mongo

นี่คือคำตอบของคำถามข้อสุดท้ายในโจทย์ เรียงจากความเสี่ยงมากไปน้อย ทุกข้อมีเทสต์
ครอบและเทสต์ผ่านหมด — และเทสต์ทั้งชุดไม่แตะฐานข้อมูล ซึ่งเป็นชนิดของ
ช่องว่างที่บั๊ก `year` หายของปฏิทินวันหยุดเคยซ่อนอยู่

| ฟีเจอร์ | หลักฐานว่ายังไม่เคย | ทำไมถึงเสี่ยง |
|---|---|---|
| **`POST /api/settings/recompute`** | ไม่มี replay run ที่ filter เป็น `{period}` | เป็นทางเดียวที่ขยับตัวเลขที่เซ็นรับไปแล้ว และเป็นทางที่ต้องพิมพ์ curl เอง ไม่มีหน้าจอคอยกันพิมพ์ผิด · README ยังบันทึกไว้ด้วยว่ามันไม่ถูก ปิดงวด กั้น |
| **ปิดงวด** | `otPeriodLocks` = 0 | มี 7 route อ่านค่าล็อกนี้ · เดือนแรกที่ปิดจริงคือครั้งแรกที่โค้ดเส้นนี้เจอข้อมูลจริง |
| **ปฏิเสธใบ (ทั้งขั้นหัวหน้าและขั้น HR)** | ไม่มีใบสถานะ `rejected` | เป็นครึ่งหนึ่งของการตัดสินใจในคิวอนุมัติ · `hrRejectReturnsTo` เลือกได้ 2 ทาง ยังไม่เคยวิ่งสักทาง |
| **ขอถอนใบที่อนุมัติแล้ว และการตอบคำขอ** | ไม่มีใบไหนมี `withdrawal.state` | สร้างเสร็จ 2026-08-14 · คำขอที่ค้างอยู่ขวางการปิดงวดด้วย จึงพันกับข้อข้างบน |
| **ผู้ดูแลระบบเซ็นแทนหัวหน้า** | ไม่มี `managerDecision.adminOverride` | สร้างเมื่อ 2026-08-24 · ADM ยังไม่มีหัวหน้า ใบที่ยื่นในแผนกนั้นวันนี้ต้องผ่านทางนี้ทางเดียว |
| **บันทึกว่าตรวจแล้ว / บันทึก OT ให้ จากคิววันเกิด** | `otBirthdayChecks` = 0 และไม่มีใบจากทางนี้ | เขียนใบและอนุมัติในขั้นเดียว — ข้ามลายเซ็นสองขั้นโดยตั้งใจ |
| **ยกเว้นเพดานให้ใบหนึ่ง** | ไม่มีใบไหนมี `capOverride` | เพดานเป็นเหตุผลเดียวที่ใบถูกกัน · มีใบที่ `capExceeded` แล้ว 1 ใบ แปลว่าสถานการณ์นี้เกิดขึ้นจริงได้ |
| **`npm run reset-admin`** | ไม่มี audit `source: 'script'` | เป็นทางกลับเข้าระบบทางเดียวเมื่อ admin ลืมรหัส — ตัวที่จะได้ใช้ตอนที่เดือดร้อนที่สุด |
| **ปิดใช้งานแผนก** | 5 แผนก `active: true` ทั้งหมด | ระบบไม่มีการลบแผนก ปิดใช้งานคือทางเดียว |
| **เซ็นขั้นหัวหน้าในฐานะผู้รับช่วง** | ⚠️ เคยเดิน 2026-08-14 แต่ร่องรอยถูกลบ | เดินแล้วจริง — อยู่ในรายการนี้เพื่อบอกว่าฐานข้อมูลวันนี้ไม่ยืนยันให้ |
| **ใบส่งบัญชีและใบ F-HR-027 บนกระดาษ** | README บันทึกไว้เอง | ความกว้างคอลัมน์และจำนวนแถวต่อหน้าวัดด้วยตาเปล่า ยังไม่เคยพิมพ์ออกมาจริง |

---

## ที่มาของแต่ละคอลัมน์

รันซ้ำได้ทั้งหมด และไม่มีขั้นตอนไหนเขียนอะไรลงฐานข้อมูล

```bash
# จำนวน route และจำนวน endpoint
find app/api -name route.js | wc -l
for f in $(find app/api -name route.js); do
  grep -oE "export (const|async function) (GET|POST|PATCH|PUT|DELETE)" "$f"; done | wc -l

# route ไหนถูกเรียกจากหน้าจอบ้าง — ส่วนต่างคือกลุ่ม ข
grep -rhoE "api\.(get|post|patch|del|download|upload)\(" -A0 components/ | sort -u

# แต่ละแถวอยู่ใต้หัวข้อที่บอกบทบาทถูกไหม — เทียบกับ guard ของ route จริง
grep -oE '`app/api/[^`]*route\.js`' docs/features.md | tr -d '`' | sort -u |
  while read -r f; do printf '%s -> ' "$f";
    grep -oE "requireRole\(await requireAuth\(req\),[^)]*\)" "$f" || echo "requireAuth only"; done
```

คำสั่งสุดท้ายคือสิ่งที่เจอว่าสี่แถวอยู่ผิดหัวข้อเมื่อ 2026-08-25
`test/docsMatchCode.test.js` ถือกฎนี้ไว้ให้แล้วสำหรับหัวข้อที่เขียนว่า **หัวหน้างาน**
แต่มันจับได้แค่ชั้น `requireRole` เท่านั้น — route ที่ `requireRole` กว้างแล้วไป
ปฏิเสธข้างในอย่างสามเส้นทางวันเกิด เครื่องไม่รู้ ต้องอ่านเอง

หลักฐานฝั่งฐานข้อมูลอ่านด้วยสคริปต์ชั่วคราวที่ต่อผ่าน `MONGODB_URI` แล้วนับอย่าง
เดียว หลักการมีสองข้อ:

* **collection ว่าง = ฟีเจอร์ที่จำเป็นต้องเขียนลงตรงนั้นยังไม่เคยทำงาน** —
  `otPeriodLocks`, `otBirthdayChecks` และการไม่มีใบสถานะ `rejected` มาจากข้อนี้
* **`otAccessLogs` = เส้นทางที่ถูกเรียกจริง** แต่ครอบคลุมตั้งแต่ 2026-08-24 เท่านั้น

**สิ่งที่วิธีนี้ตอบไม่ได้:** หน้าจอที่คนเปิดดูเฉย ๆ ก่อน 2026-08-24 ไม่ทิ้งร่องรอย
ไว้ที่ไหนเลย ทุกช่อง ❓ ในเอกสารนี้คือกรณีนั้น — ไม่ได้แปลว่า “น่าจะไม่เคย” แต่แปลว่า
**“ระบบไม่มีทางรู้”** ซึ่งเป็นเหตุผลที่ `otAccessLogs` ถูกสร้างขึ้นตั้งแต่แรก และอีก
สามเดือนเอกสารฉบับนี้จะตอบคำถามเดียวกันได้ดีกว่านี้มาก
