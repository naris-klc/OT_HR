# ระบบขออนุมัติทำงานล่วงเวลา — Primus Instrument Co., Ltd.

v1 scaffold implementing the OT System requirements (draft v1.0, derived from
form **F-HR-027 Rev.4**). Replaces the paper form
ใบขออนุมัติทำงานล่วงเวลา/ทำงานในวันหยุด.

**The system never calculates money.** It records hours, classifies them into
the ×1.5 and ×3 buckets, and totals them. No rates, no baht, anywhere.

## เอกสารสำหรับคนที่ไม่ได้อ่านโค้ด

ส่วนที่เหลือของไฟล์นี้เขียนให้คนที่ดูแลโค้ดอ่าน มีสามอย่างที่ไม่ใช่ และมันอยู่ใน
[`docs/`](docs/) เพราะคนที่ต้องใช้มันจะมาหามันในวันที่การนั่งอ่านไฟล์ 170 kB ไม่ใช่
ทางเลือก:

- **[docs/features.md](docs/features.md)** — ทุกคน: **รายการฟีเจอร์ทั้งระบบ**
  แยกเป็นสามกลุ่ม (มีหน้าจอ · มีแต่ route · เป็น script) พร้อมบอกต่อรายการว่ามี
  เทสต์ครอบไหม และ**เคยเดินกับฐานข้อมูลจริงหรือยัง** อ่านออกมาจากโค้ดและจากฐาน
  ข้อมูลจริง ไม่ใช่จากไฟล์นี้ — ใช้ประเมินความเสี่ยงก่อน deploy
- **[docs/contingency.md](docs/contingency.md)** — ฝ่ายบุคคล / หัวหน้างาน:
  ต้องทำอะไรเมื่อระบบเข้าไม่ได้ กระดาษ F-HR-027 → คีย์กลับเข้าระบบ →
  กระทบยอดก่อนพิมพ์
- **[docs/network.md](docs/network.md)** — คนที่ดูแลเราเตอร์: หมายเลขของเซิร์ฟเวอร์
  ทำไมมันต้องเลิกเป็น DHCP lease และขอบเขตของวง LAN ควรอยู่ตรงไหน

สองไฟล์หลังมีรายการสิ่งที่ **ยังไม่ได้ทำ** ติดอยู่ด้วย รายการพวกนั้นคือสภาพจริงของ
การติดตั้งใช้งาน ให้รักษาให้มันทันสมัยไว้ ไม่ใช่ทำให้มันดูเรียบร้อย

---

## Setup

```powershell
npm run setup          # installs dependencies
copy .env.example .env # then edit MONGODB_URI and JWT_SECRET
npm run seed           # demo departments, people, holidays, and examples A–E
                       # REFUSES on a database holding anything it did not create
npm test               # the calculation engine test suite
npm run dev            # UI + API together on :3000
```

Locked out of the only ผู้ดูแลระบบ account? `npm run reset-admin -- ADMIN` —
see [ใครทำอะไรได้](#ใครทำอะไรได้--ฝ่ายบุคคล-กับ-ผู้ดูแลระบบ).

Upgrading a database seeded before the two-company split? Run
`npm run migrate:company` once — see [Two companies](#two-companies-primus--themtech).

**Deploying the birthday-remark move?** `birthdayReasonOnForm` **leaves**
`DEFAULT_POLICY` — “วันเกิด” is off F-HR-027 and printed on สรุป OT ส่งบัญชี
instead, and neither is a setting any more (see
[วันเกิดพนักงานเป็นวันหยุดของคนนั้น](#วันเกิดพนักงานเป็นวันหยุดของคนนั้น--two-flags-and-a-remark-that-moved)).
A key leaving has the same consequence as a key joining: press **บันทึกกฎที่ใช้อยู่เป็นเวอร์ชัน**
under ตั้งค่าระบบ → นโยบายการคำนวณ, or entries filed from the deploy carry no
`policyVersionId`. No migration otherwise — no figure moves, and a stored
override for the retired key is ignored by `Setting.effectivePolicy()`.

**Deploying the proxy-filing and delegation work?** Two new keys join
`DEFAULT_POLICY` (`proxySkipsOwnApproval`, `proxyNoteOnForm`), which moves the
effective policy away from the newest recorded version — and until somebody
presses **บันทึกกฎที่ใช้อยู่เป็นเวอร์ชัน** under ตั้งค่าระบบ → นโยบายการคำนวณ,
every entry filed from that moment is stamped with no `policyVersionId` and
nothing anywhere errors. See
[When the live rules are not on record](#which-rules-produced-this-figure). No
migration is needed otherwise: `filedBy` absent means self-filed, which is what
every existing entry is.

**Deploying the birthday check-and-settle work?** It read: *one new key joins
`DEFAULT_POLICY` — “hrDirectApproveBirthday” (default true) — with the same
consequence every joining key has, so press บันทึกกฎที่ใช้อยู่เป็นเวอร์ชัน; no
migration otherwise, the “otBirthdayChecks” collection starts empty and the new
`submit_hr_verified` history action only has to exist in the enum before a row
can use it.* **That whole arrangement was withdrawn on 2026-09-03** — see
[สวัสดิการวันเกิด](#สวัสดิการวันเกิด--เจ้าของวันเกิดยื่นเอง-ผ่านหัวหน้าเหมือนใบปกติ).
There is no key to add and nothing to press for it. A database that already ran
it keeps both the collection and the rows, and neither is read any more.

**Deploying the เหมารายวัน tick?** Nothing to do for rows filed before it:
`flatDaily` is a field on the entry with a `false` default, not a policy key, so
no version is left unmatched and no month is restated — every row written before
2026-09-03 was filed under no such rule, and `false` is exactly what that was.

**Rows filed WITH it ticked before 2026-09-07 were computed under one of two
withdrawn readings**, and neither is what the engine says now. Nothing rewrites
them on deploy — the figures on a stored entry move only when something
recomputes it — so **look before deploying**, one query:
`db.otentries.find({ flatDaily: true })`. Run against this database on
2026-09-07 it returns **three rows, all of them the July scan demo seed's**
(`src/seed-scan-people.js`), nothing anybody filed:

| row | as stored | what a replay gives now |
|---|---|---|
| `2026-07-11` PM00112 (Sat) approved | `ot15_holiday` 8 | `ot15_holiday` 8 — unchanged |
| `2026-07-06` THT0107 (Mon) approved | `ot15_weekday` 8 | `ot15_weekday` 8 — unchanged |
| `2026-07-22` PM00112 (Wed) pending | three noughts, `normalHours` 8 | `ot15_weekday` 8 |

The two approved rows are ceiling-era and land on exactly the figures they
already hold, which is not luck: a ceiling and a flat eight agree whenever the
day ran at least eight hours in the OT window. **Neither signed figure moves.**
The third is the 2026-09-04 reading, is `pending_hr`, and would gain eight hours
of OT the first time the month is replayed. That is the right answer under the
rule and it is still a figure changing under somebody, so it is worth saying out
loud rather than discovering in a total.

A row that is not demo data is not a migration to write on your own: restating a
signed figure is HR’s call. `npm run whatif` prices a POLICY change read-only and
is the tool for one; it cannot price this, because a code change is on both
sides of its comparison — the table above was produced by replaying the three
sessions through `loadContext`/`compute` and printing the result instead of
saving it.

*(This paragraph read “**An empty result is the likely answer (the tick was one
day old and prod has not been deployed to since)**” until 2026-09-07, of the
narrower query `{ flatDaily: true, "totals.otHours": { $gt: 0 } }`. The query was
then actually run, and it was not empty.)*

**And the rule is LIVE on this installation the moment this ships**, including
its วันเกิด corner: `birthdayHolidayEnabled` is **false in the file and `true` in
`Setting.policy`** here (`npm run whatif -- --show`, read 2026-09-07). Do not
read the default and conclude a birthday is an ordinary day — see
[The policy file is not what runs](#which-rules-produced-this-figure).

Upgrading a database from before policy versioning? Run
`npm run migrate:policy-version` once — see
[Which rules produced this figure](#which-rules-produced-this-figure). It writes
only version pointers; no entry's hours or status is touched.

Requires **Node 20+** and a MongoDB instance. For production, `npm run build`
then `npm start` — and on the machine that actually serves the office, neither
of those is typed by hand every morning: see
[ให้แอปขึ้นเองทุกครั้งที่ล็อกอิน](#ให้แอปขึ้นเองทุกครั้งที่ล็อกอิน--task-scheduler).

**`npm run seed` will not run against a database it did not create.** It opens
with five `deleteMany({})` — departments, employees, holidays, entries and
settings — which is the point of it on a laptop and is the roster plus every
hour anybody has filed on the company server. It now counts what is there
first: employees outside its own list, entries filed through the app, roster
audits, policy versions, HR's answers to the [OPEN] items, delegations, closed
periods. Any of them and it prints what it found and exits 1.

`npm run seed -- --force` overrides it. Take a backup first, and know that the
wipe is **partial** — the audit trail, the policy versions, the delegations and
the period locks are not among the five collections it clears, so a forced
reseed leaves them pointing at people and entries that no longer exist.

### เครื่องนี้คือ staging — แผนตอนย้ายขึ้น Production Server ของบริษัท

**สถานะที่ตกลงกันเมื่อ 2026-08-27** โปรเจกต์นี้อยู่ในช่วงพัฒนา/ทดสอบบนแล็ปท็อป
เครื่องนี้ รอย้ายไปรันบน **Production Server จริงของบริษัท** ในอนาคต สคริปต์และ
ขั้นตอนทั้งหมดในหัวข้อถัดไปจึงเขียนไว้เพื่อ**ยกไปใช้ที่นั่น** ไม่ใช่เพื่อผูกกับ
เครื่องนี้ — และนั่นคือเหตุผลที่[ไม่ลงงานตามตารางบนเครื่องนี้](#ให้แอปขึ้นเองทุกครั้งที่ล็อกอิน--task-scheduler)

> ⚠️ **“staging” เป็นสิ่งที่เครื่องนี้จะเป็น ไม่ใช่สิ่งที่มันเป็นอยู่แล้ว** ตอนนี้
> ฝ่ายบุคคล ยังใช้เครื่องนี้ทำงานจริงที่ `192.168.109.76:3000` ([Status](#status))
> ตราบใดที่ยังไม่มีเซิร์ฟเวอร์บริษัท การล่มหนึ่งครั้งยังแปลว่าไม่มีใครยื่นหรืออนุมัติ
> OT ได้จนกว่าจะมีคนมาเปิดใหม่ ทั้งสองอย่างนี้จริงพร้อมกัน

#### สิ่งที่ยกไปได้ทันที ไม่ต้องแก้

`npm run build` แล้วรันด้วย `next start` คือโหมด production เต็มรูปแบบและไม่ผูกกับ
เครื่องไหน · `scripts/deploy.ps1` หา repo root จากตำแหน่งไฟล์ตัวเองและรับ `-Port`
เป็นพารามิเตอร์ (แก้เมื่อ 2026-08-27 — ก่อนหน้านั้นพาธถูกเขียนตายไว้ในไฟล์ จึงรันได้
เครื่องเดียว) · `scripts/start-server.ps1` หา root จากตัวเองมาตั้งแต่แรก · คุกกี้
session ตั้ง `secure` ตาม**การเชื่อมต่อจริง** ไม่ใช่ตาม `NODE_ENV` (ดู
`lib/session.js` กับ `lib/httpsRequest.js`) จึงทำงานถูกทั้งบน HTTP ใน LAN และบน
HTTPS หลัง reverse proxy โดยไม่ต้องแตะอะไร

#### ถ้าเซิร์ฟเวอร์บริษัทเป็น Windows Server

ใช้[สูตร S4U + AtStartup](#หรือให้ขึ้นตั้งแต่บูต-โดยไม่ต้องมีใครล็อกอิน--s4u) ได้เลย
— มันถูกออกแบบมาสำหรับเคสนี้พอดี คือขึ้นเองตั้งแต่บูตโดยไม่ต้องมีใครล็อกอิน แล้วเดิน
[สามข้อยืนยัน](#ยืนยันว่าใช้ได้จริง--สามข้อ) ซึ่ง**ยังไม่เคยถูกเดินที่ไหนเลย** จึงเป็น
ของจริงที่ต้องทำ ไม่ใช่พิธีกรรม

#### ถ้าเซิร์ฟเวอร์บริษัทเป็น Linux (Ubuntu/Debian)

ทั้งหมดใน `scripts/*.ps1` ใช้ไม่ได้ ตัวจัดการโปรเซสเปลี่ยนเป็น **systemd** หรือ
**PM2** ส่วนคำสั่งที่เสิร์ฟแอปยังเป็นอันเดิม — `npm start` = `next start -p 3000`

```bash
# PM2 — สั้นที่สุด
pm2 start npm --name ot-system -- start
pm2 save && pm2 startup       # ให้ขึ้นเองตอนบูต

# หรือ systemd — ไม่ต้องมี dependency เพิ่ม และเป็นทางที่ distro รองรับเอง
sudo tee /etc/systemd/system/ot-system.service >/dev/null <<'UNIT'
[Unit]
Description=PRIMUS OT system
After=network.target mongod.service

[Service]
Type=simple
User=ot
WorkingDirectory=/srv/ot-system
EnvironmentFile=/srv/ot-system/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now ot-system
```

`Restart=always` กับ `RestartSec=10` คือของที่ `RestartCount`/`RestartInterval` ใน
Task Scheduler ทำอยู่ และ `After=mongod.service` แทนการหน่วง 60 วินาทีในทริกเกอร์
ตอนบูต — ตรงกว่า เพราะมันรอ**บริการ** ไม่ใช่รอ**เวลา**

#### สิ่งที่ต้องตั้งใหม่ไม่ว่าเซิร์ฟเวอร์จะเป็นอะไร

`.env` ทั้งไฟล์ (`MONGODB_URI`, `JWT_SECRET`) — `JWT_SECRET` คนละค่าแปลว่าทุก
session ที่ค้างอยู่ใช้ไม่ได้ ซึ่งถูกต้องแล้ว · **ฐานข้อมูล** ย้ายด้วย
[`npm run backup` / `npm run restore`](#สำรองและกู้คืนข้อมูล) · **กฎไฟร์วอลล์**
ตอนนี้เปิด `:3000` ให้เฉพาะ `192.168.109.0/24` ซึ่งเป็นซับเน็ตของออฟฟิศนี้เท่านั้น ·
**งานสำรองข้อมูล** ปลายทางปัจจุบันอยู่บนดิสก์ลูกเดียวกับฐานข้อมูล ซึ่งบนเซิร์ฟเวอร์
จริงควรเป็นที่อื่น

### ให้แอปขึ้นเองทุกครั้งที่ล็อกอิน — Task Scheduler

**อ่านหัวข้อนี้เมื่อ:** เปิดหน้าเว็บแล้วขึ้น "This site can't be reached" ·
เครื่องเพิ่งรีสตาร์ต · หรือต้องเอาโค้ดใหม่ขึ้น

“เครื่องจริง” คือแล็ปท็อปเครื่องนี้ ([Status](#status)) ตัวที่ทำให้แอปขึ้นเองจึงเป็น
Task Scheduler ตัวเดียวกับที่ [งานสำรองข้อมูล](#ตั้งเวลาสำรองอัตโนมัติ) ใช้อยู่

> 🔴 **ไม่ลงงาน `OT server` บนเครื่องนี้ — ตัดสินใจแล้วเมื่อ 2026-08-27 อย่าเสนอซ้ำ**
> เหตุผลคือเครื่องนี้ถูกเก็บไว้เป็นเครื่อง **dev/test** จึงไม่คุ้มที่จะผูกงานตามตาราง
> เข้ากับมัน ทั้งหัวข้อนี้จึงเป็น **สูตรสำหรับเครื่องที่จะเป็น production จริง** ไม่ใช่
> รายงานสภาพเครื่องนี้ · `Get-ScheduledTask` ถูกอ่านสามครั้ง — 2026-08-20,
> 2026-08-25 และ 2026-08-27 — งาน OT ตัวเดียวบนเครื่องคือ `OT backup`
>
> **สิ่งที่ยอมรับไปพร้อมกับการตัดสินใจนี้ เขียนไว้ตรง ๆ** — แอป**ไม่ขึ้นเอง**หลัง
> รีสตาร์ตหรือหลังล็อกอิน · **ไม่มีอะไรปลุกมัน**เมื่อโปรเซสตาย และเครื่องนี้เคยมี
> โปรเซสตายเองมาแล้วสองครั้ง (`RestartCount` ที่เขียนไว้ข้างล่างเป็นค่าของงานที่
> ไม่มีอยู่) · คนต้องเป็นคนเริ่ม ทางที่ใช้จริงคือ
> [`deploy-ot.ps1`](#เอาโค้ดใหม่ขึ้น--deploy-otps1) หรือรัน `start-server.ps1` ด้วยมือ
>
> ⚠️ **และ ณ วันที่ตัดสินใจ เครื่องนี้ยังเป็นตัวที่ ฝ่ายบุคคล ใช้อยู่จริง** ที่
> `192.168.109.76:3000` ผ่านกฎไฟร์วอลล์ของ LAN ([Status](#status)) — “dev/test”
> เป็นสิ่งที่เครื่องนี้จะเป็น ไม่ใช่สิ่งที่มันเป็นอยู่แล้ว ตราบใดที่ยังไม่มีเครื่อง
> production แยก การล่มหนึ่งครั้งยังแปลว่าไม่มีใครยื่นหรืออนุมัติ OT ได้จนกว่าจะมี
> คนมาเปิดใหม่
>
> `scripts/start-server.ps1` เองยังถูกเขียนไว้สำหรับงานตามตารางและยังถูกทุกบรรทัด
> — การอยู่หน้าฉาก การ normalise exit code และสัญญาณ restart ไม่ได้เสียหายอะไรจาก
> การที่ยังไม่มีงานมาอ่านมัน ถ้าวันหนึ่งมีเครื่อง production จริง สูตรข้างล่างพร้อมใช้
> และให้เดินสามข้อ [ยืนยันว่าใช้ได้จริง](#ยืนยันว่าใช้ได้จริง--สามข้อ) ด้วย เพราะยัง
> ไม่มีข้อไหนถูกเดินที่ไหนเลย

> 🔴 **โหมดที่ต้องเป็นคือ `next start` และเครื่องเคยรัน `next dev` อยู่ทั้งเช้า**
> วันที่ 2026-08-27 พบว่า :3000 ถูกถือโดย `next dev -p 3000` — เสิร์ฟจาก working
> tree ตรง ๆ ไม่ใช่จาก build แปลว่าโค้ดที่ยังไม่ commit ขึ้นจอ HR ทันทีที่เซฟ และ
> `.next\BUILD_ID` ค้างอยู่ที่ของสองวันก่อนโดยที่หน้าเว็บดูปกติดี
>
> **วิธีดูว่าตอนนี้เป็นโหมดไหน** — pid ที่ถือพอร์ต **บอกไม่ได้** ทั้งสองโหมดลงมาที่
> worker ตัวเดียวกันคือ `node ...\next\dist\server\lib\start-server.js` คำว่า
> `dev` หรือ `start` อยู่ที่ **โปรเซสแม่**
>
> ```powershell
> $c = Get-NetTCPConnection -LocalPort 3000 -State Listen
> $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($c.OwningProcess)"
> (Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)").CommandLine
> ```
>
> อีกทางที่ไม่ต้องแตะโปรเซสเลย: ขอ HTML จากเซิร์ฟเวอร์แล้วดูชื่อ chunk — build จริง
> ได้ชื่อสั้นที่ผ่าน hash และเปลี่ยนทุก build ส่วน dev ได้ชื่อที่สะกดตามโมดูล เช่น `components_HrView_jsx` นำหน้า
> และ `/_next/static/development/_devMiddlewareManifest.json` ตอบ 200 เฉพาะบน dev

**สิ่งที่งานนี้รัน** คือ `scripts/start-server.ps1` ซึ่งห่อคำสั่งเดียว —
`node node_modules\next\dist\bin\next start -p 3000` — สิ่งที่ตัวห่อเพิ่มเข้ามาคือ
สี่อย่างที่งานตามตารางเวลาต้องการ: **อยู่หน้าฉาก** (Task Scheduler นับว่างานยัง
ทำงานอยู่ตราบใดที่โปรเซสของ action ยังอยู่) · **เขียน log** · **ออกด้วยรหัสที่ไม่ใช่
ศูนย์เมื่อพัง** เพราะนั่นคือสัญญาณเดียวที่ตัวตั้ง restart อ่าน · และ **ปฏิเสธที่จะเป็น
เซิร์ฟเวอร์ตัวที่สอง** ถ้ามีอะไรฟังพอร์ตนั้นอยู่แล้ว มันจะบันทึกแล้วออกด้วยศูนย์
แทนที่จะวนเริ่มใหม่ทุกนาทีชนพอร์ตที่ไม่มีวันว่าง

> 🔴 **`scripts/start-server.ps1` ต้องไม่มีอักขระนอก ASCII แม้แต่ตัวเดียว**
> Task Scheduler รันมันด้วย `powershell.exe` — Windows PowerShell 5.1 — ซึ่งอ่าน
> ไฟล์ที่ไม่มี BOM เป็น ANSI `scripts/backup.ps1` มีข้อความไทยอยู่ข้างใน จึงต้อง
> พึ่ง BOM ของมันตลอดไป และวันที่โปรแกรมแก้ไขไฟล์ตัวหนึ่ง "เก็บกวาด" BOM ทิ้ง
> parser ก็พังที่บรรทัด 65 แล้วงานออกด้วยรหัส 1 **ก่อนถึงบรรทัด log แรก** ไฟล์นี้
> เลี่ยงทั้งกองด้วยการไม่มีอะไรให้เข้ารหัสผิด — ภาษาไทยอยู่ในหัวข้อนี้ ซึ่งไม่มีอะไร
> ต้อง parse มัน
>
> กฎนี้กับกฎ BOM ของ `scripts/backup.ps1` ถูกบังคับด้วย
> `test/scriptEncoding.test.js` — ทุกไฟล์ `.ps1` ใน `scripts/` ต้อง**อย่างใดอย่างหนึ่ง**
> คือมี BOM หรือเป็น ASCII ล้วน และมีอีกสองเคสระบุว่าไฟล์ไหนเลือกทางไหนอยู่ตอนนี้
> การเปลี่ยนทางจึงต้องเป็นการแก้เทสต์โดยตั้งใจ ไม่ใช่สิ่งที่บังเอิญยังผ่าน

#### ทำไมเรียก `node` ตรง ๆ ไม่ใช่ `npm start`

`npm start` ในไฟล์ `package.json` คือ `next start -p 3000` — ปลายทางเดียวกันเป๊ะ
แต่ทางที่ไปถึงต่างกัน: Task Scheduler จะต้องเรียก `npm.cmd` ซึ่งเป็นแบตช์ไฟล์ มันเปิด
`cmd.exe` แล้ว `cmd.exe` เปิด `node` อีกที กลายเป็นสองชั้นระหว่างงานกับเซิร์ฟเวอร์
และทั้งสองชั้นนั้นทำสามอย่างพัง — **สั่งหยุดงานแล้วลูกหลุด** (ฆ่าตัวห่อ node
ยังถือพอร์ต 3000 อยู่) · **รหัสออกถูกเขียนทับ** npm รายงานรหัสของตัวเองพร้อมกล่อง
ข้อความของมัน ซึ่งคือสัญญาณที่ตัวตั้ง restart ใช้ตัดสิน · และ **ต้องพึ่ง PATH**
ให้หา `npm.cmd` เจอในบริบทที่ไม่ใช่ของคนล็อกอิน

`node .next\standalone\server.js` **ไม่ใช่ทางเลือกในตอนนี้** — `next.config.js`
ไม่ได้ตั้ง `output: 'standalone'` โฟลเดอร์นั้นจึงไม่มีอยู่หลัง `npm run build`
(ตรวจแล้ว 2026-08-25) จะใช้ต้องเปลี่ยนวิธี build ก่อน ซึ่งไม่จำเป็นสำหรับเครื่องนี้

ตัวห่อ PowerShell เองก็เป็นหนึ่งชั้นเหมือนกัน ต่างกันตรงที่มันมีอยู่เพื่อทำสองอย่างที่
npm ทำพัง — เปลี่ยนทางเดินของ log และส่งต่อรหัสออกของลูก — และมันเป็นแบบเดียวกับ
`scripts/backup.ps1` ที่ตั้งสำเร็จมาแล้วบนเครื่องนี้

#### log อยู่ที่ไหน

ทั้งสามไฟล์อยู่ในโฟลเดอร์ `logs\` ของ repo (ถูก `.gitignore` คลุมด้วย `*.log`)

| ไฟล์ | มีอะไร |
|---|---|
| `logs\task.log` | บรรทัดละเหตุการณ์ — เริ่มเมื่อไหร่ ตายเมื่อไหร่ ด้วยรหัสอะไร ต่อท้ายเรื่อย ๆ ไม่เคยล้าง **นี่คือไฟล์ที่ตอบว่า "มันรีสตาร์ตตอนไหน"** |
| `logs\server.log` | ทุกอย่างที่แอปพิมพ์ออก stdout ของรอบที่กำลังรัน |
| `logs\server.err.log` | ทุกอย่างที่แอปพิมพ์ออก stderr ของรอบที่กำลังรัน |

สองไฟล์หลังถูกย้ายเป็น `server.prev.log` / `server.err.prev.log` ทุกครั้งที่เริ่มใหม่
— รอบที่ตายกับรอบที่มาแทนจึงอยู่ข้างกัน ไม่ใช่ทับกัน ซึ่งเป็นสิ่งเดียวที่ตอบได้ว่า
“มันตายเพราะอะไร” หลังจากการรีสตาร์ตเขียนทับไฟล์สดไปแล้ว

#### คำสั่งลงทะเบียน — รันหนึ่งครั้ง

ทดสอบด้วยมือก่อนหนึ่งรอบเสมอ และทดสอบด้วย `powershell.exe` ไม่ใช่ `pwsh` — ตัวที่
Task Scheduler ใช้คือ 5.1

```powershell
# ถ้าพอร์ต 3000 ว่าง คำสั่งนี้จะยึดหน้าจอไว้และเสิร์ฟจริง (Ctrl+C เพื่อหยุด)
# ถ้าไม่ว่าง มันจะบอกว่าใครถืออยู่แล้วออกด้วย 0 — ทั้งสองทางคือคำตอบที่ถูก
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "C:\Users\suwan\Documents\OT_HR\scripts\start-server.ps1"
```

```powershell
$repo = 'C:\Users\suwan\Documents\OT_HR'

# -WindowStyle Hidden เพราะ LogonType Interactive จะเปิดหน้าต่างคอนโซลค้างไว้บน
# เดสก์ท็อปทั้งวัน และหน้าต่างที่ปิดได้ด้วยการเผลอกดคือเซิร์ฟเวอร์ที่ปิดได้ด้วย
# การเผลอกด · -WorkingDirectory เพราะ Task Scheduler เริ่มงานที่ C:\Windows\System32
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}\scripts\start-server.ps1" -Port 3000' -f $repo) `
  -WorkingDirectory $repo

# หน่วง 30 วินาที ให้บริการ MongoDB (StartType Automatic) ตั้งตัวก่อน
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT30S'

# RestartCount/RestartInterval = ถ้าโปรเซสตายเอง ให้ลองใหม่ทุก 1 นาที (ต่ำสุดที่
# Windows ยอม) จนกว่าจะขึ้น · ทั้งคู่ต้องใส่คู่กัน ใส่ตัวเดียวคำสั่งจะ error
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

# ตั้งเป็น property หลังสร้าง ไม่ใช่ผ่านพารามิเตอร์ — ค่า 0 คือ "ไม่จำกัดเวลา"
# ค่าตั้งต้นคือ 72 ชั่วโมง ซึ่งแปลว่าวันหนึ่ง Windows จะฆ่าเซิร์ฟเวอร์ทิ้งเฉย ๆ
$settings.ExecutionTimeLimit = 'PT0S'
# ไม่ให้ถูกหยุดตอนเครื่องเลิก idle
$settings.IdleSettings.StopOnIdleEnd = $false

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'OT server' `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'เสิร์ฟระบบ OT ที่พอร์ต 3000 ตอนล็อกอิน และเริ่มใหม่เองถ้าโปรเซสตาย — log อยู่ที่ logs\task.log' `
  -Force
```

#### …หรือให้ขึ้นตั้งแต่บูต โดยไม่ต้องมีใครล็อกอิน — S4U

**นี่คือรูปแบบที่ควรใช้ ถ้าจะลงงานนี้ที่ไหนสักที่** — และมันไม่ได้ถูกลงบนเครื่องนี้
ดูกล่องแดงบนหัวข้อ · เลือกรูปแบบนี้ไว้เมื่อ 2026-08-27 เพราะเหตุผลที่คนตั้งงานนี้คือ
“เครื่องรีสตาร์ตแล้วเว็บต้องกลับมาเอง” และ `-AtLogOn` ตัวเดียวแก้เคสนั้นไม่ได้ —
เครื่องนี้ไม่มี auto-logon รีบูตแล้วทิ้งไว้ที่หน้าล็อกอิน แอปก็ยังดับ

ต่างจากสูตรข้างบนสามจุด: **ทริกเกอร์สองตัว** (`-AtStartup` หน่วง 60 วินาทีให้
MongoDB ตั้งตัวก่อน และ `-AtLogOn` หน่วง 30 ไว้เป็นตาข่ายรับกรณีล็อกอินโดยไม่ได้
รีบูต) · **`-LogonType S4U`** แทน `Interactive` — งานจึงรันได้โดยไม่มี session ของ
ผู้ใช้ และไม่ต้องเก็บรหัสผ่านไว้ที่ไหน · และ **ต้องรันในหน้าต่างที่ Run as
administrator** ซึ่งบัญชี `suwan` ทำได้ (อยู่ในกลุ่ม Administrators — ตรวจ
2026-08-27)

```powershell
$repo = 'C:\Users\suwan\Documents\OT_HR'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}\scripts\start-server.ps1" -Port 3000' -f $repo) `
  -WorkingDirectory $repo

# ตอนบูต: 60 วินาที เพราะตอนนั้นบริการ MongoDB เพิ่งเริ่มพร้อมกับทุกอย่างในเครื่อง
$tStartup = New-ScheduledTaskTrigger -AtStartup
$tStartup.Delay = 'PT60S'
# ตอนล็อกอิน: ตาข่ายรับกรณีเปิดเครื่องค้างไว้แล้วมีคนล็อกอินทีหลัง — MultipleInstances
# IgnoreNew กับ branch พอร์ตไม่ว่างใน start-server.ps1 ทำให้ยิงซ้ำแล้วไม่เป็นไร
$tLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$tLogon.Delay = 'PT30S'

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$settings.ExecutionTimeLimit = 'PT0S'
$settings.IdleSettings.StopOnIdleEnd = $false

# S4U = “service for user” รันในนามบัญชีนี้โดยไม่ต้องมี session และไม่เก็บรหัสผ่าน
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName 'OT server' `
  -Action $action -Trigger @($tStartup, $tLogon) -Settings $settings -Principal $principal `
  -Description 'เสิร์ฟระบบ OT ที่พอร์ต 3000 ตั้งแต่บูต และเริ่มใหม่เองถ้าโปรเซสตาย — log อยู่ที่ logs\task.log' `
  -Force
```

> ⚠️ **งานจะรันใน session 0 ไม่มีหน้าจอ** ซึ่งเซิร์ฟเวอร์ HTTP ไม่มีปัญหาด้วย แต่
> แปลว่าอะไรที่ต้องการเดสก์ท็อปจะไม่ทำงานในงานนี้ · และ `$env:USERNAME` ใน
> หน้าต่างที่ยกสิทธิ์ยังเป็น `suwan` ตราบใดที่ยกสิทธิ์ของบัญชีเดิม — ถ้าใส่รหัสของ
> บัญชี Administrator คนละตัว งานจะถูกลงทะเบียนในนามบัญชีนั้นแทน แล้วทริกเกอร์
> ตอนล็อกอินจะไม่มีวันยิง ตรวจด้วย `(Get-ScheduledTask -TaskName 'OT server').Principal.UserId`

#### ยืนยันว่าใช้ได้จริง — สามข้อ

ก่อนเริ่ม ให้ปิดเซิร์ฟเวอร์ที่สั่งเริ่มด้วยมือไว้ก่อน มิฉะนั้นตัวห่อจะเจอพอร์ตไม่ว่าง
แล้วออกด้วย 0 อย่างถูกต้อง — และงานจะขึ้นว่า `Ready` ไม่ใช่ `Running` ซึ่งอ่านแล้ว
เหมือนล้มเหลวทั้งที่ไม่ใช่

```powershell
# 1) ล็อกออฟแล้วล็อกอินใหม่ — รอ 40 วินาที (หน่วง 30 วิ + เวลาบูตแอป)
Get-ScheduledTask     -TaskName 'OT server' | Select-Object State          # Running
Get-ScheduledTaskInfo -TaskName 'OT server' | Select-Object LastRunTime, LastTaskResult
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess
(Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing).StatusCode   # 200
```

`LastTaskResult` เป็น **267009** คือ "กำลังทำงานอยู่" ไม่ใช่ error — เป็นค่าที่ถูก
สำหรับงานแบบนี้ ส่วน **267011** แปลว่ายังไม่เคยรัน และ **0** บนงานนี้แปลว่ามัน
*จบไปแล้ว* ซึ่งบนงานที่ควรรันค้างไว้คือสิ่งที่ต้องไปอ่าน `logs\task.log`

```powershell
# 2) ฆ่าโปรเซสแล้วมันต้องกลับมาเอง — รอถึงหนึ่งนาทีเต็ม (RestartInterval)
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Start-Sleep -Seconds 90
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess
Get-Content logs\task.log -Tail 4
```

ใน `logs\task.log` ต้องเห็นสองบรรทัดติดกัน — `server exited with code ...` แล้วตาม
ด้วย `starting: ...` ที่เวลาใหม่ ถ้าเห็นบรรทัดแรกแต่ไม่เห็นบรรทัดที่สอง แปลว่างาน
ไม่ได้ตั้ง restart ไว้ ให้ตรวจ `RestartCount` ด้วย
`(Get-ScheduledTask -TaskName 'OT server').Settings`

```powershell
# 3) รีสตาร์ตเครื่อง แล้วล็อกอิน — รอ 1 นาที
Get-ScheduledTaskInfo -TaskName 'OT server' | Select-Object LastRunTime, LastTaskResult
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess
Get-Content logs\task.log -Tail 3
```

สิ่งที่ต้องดูคือ **บรรทัด `starting:` ใน `logs\task.log` ที่มีเวลาหลังการรีสตาร์ต** —
ไม่ใช่แค่พอร์ตเปิด เพราะพอร์ตที่เปิดอยู่อาจเป็นของโปรเซสที่ใครสั่งเริ่มด้วยมือก็ได้
`LastRunTime` ที่เป็นเวลาหลังบูตคือคำยืนยันอีกทาง

> ⚠️ **ทริกเกอร์คือ "ตอนล็อกอิน" ไม่ใช่ "ตอนเปิดเครื่อง"** เครื่องนี้ไม่ได้ตั้ง
> auto-logon (ตรวจแล้ว 2026-08-25) ถ้ารีสตาร์ตแล้วทิ้งไว้ที่หน้าจอล็อกอิน แอปจะยัง
> ไม่ขึ้นจนกว่าจะมีคนล็อกอินเป็น `suwan` — ล็อกหน้าจอทีหลังได้ ไม่กระทบ
>
> ถ้าต้องการให้ขึ้นตั้งแต่บูตโดยไม่มีใครล็อกอิน ต้องเปลี่ยน principal เป็น
> `-LogonType S4U` (หรือ Password) แล้วเพิ่มทริกเกอร์ `-AtStartup` — ซึ่ง**ต้องรัน
> คำสั่งในหน้าต่างที่ Run as administrator**
>
> **และนั่นทำได้** บรรทัดนี้เคยเขียนว่า “บัญชี `suwan` ไม่ได้อยู่ในกลุ่ม
> Administrators (ตรวจแล้ว 2026-08-25) จึงเป็นการตัดสินใจแยกอีกเรื่องหนึ่ง” —
> อ่านซ้ำเมื่อ 2026-08-27 ด้วย `Get-LocalGroupMember -Group 'Administrators'` แล้ว
> เจอ `LAPTOP-TTK6SH4F\suwan` อยู่ในกลุ่ม สิ่งที่เป็นจริงคือ session ปกติ**ไม่ได้
> ยกสิทธิ์** (`IsInRole(Administrator)` = False จนกว่าจะ Run as administrator) ซึ่ง
> เป็นคนละเรื่องกับการไม่ได้เป็นแอดมิน
>
> **ข้อนี้สำคัญกับเหตุผลที่คนส่วนใหญ่มาตั้งงานนี้ตั้งแต่แรก** ถ้าเป้าหมายคือ “เครื่อง
> รีสตาร์ตแล้วเว็บต้องกลับมาเอง” ทริกเกอร์ `-AtLogOn` ตัวเดียว**ไม่พอ** เพราะเครื่อง
> นี้ไม่มี auto-logon — รีบูตแล้วทิ้งไว้ที่หน้าล็อกอิน แอปก็ยังดับอยู่ดี ต้องมี
> `-AtStartup` กับ `S4U` ด้วย และงานจะรันใน session 0 แบบไม่มีหน้าจอ ซึ่งเซิร์ฟเวอร์
> HTTP ไม่มีปัญหาอะไรกับมัน

#### เช็คว่าแอปยังอยู่ไหม — และเริ่มใหม่ด้วยมือ

```powershell
cd C:\Users\suwan\Documents\OT_HR

# ยังอยู่ไหม
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess
(Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing).StatusCode
Get-Content logs\task.log -Tail 5

# เริ่มใหม่ — ทางที่ควรใช้ก่อน
Start-ScheduledTask -TaskName 'OT server'

# เริ่มใหม่ด้วยมือล้วน ๆ (ถ้างานตามตารางมีปัญหา) — หน้าต่างนี้ต้องเปิดค้างไว้
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "C:\Users\suwan\Documents\OT_HR\scripts\start-server.ps1"

# หยุด — ต้องสองบรรทัด
Stop-ScheduledTask -TaskName 'OT server'
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

**ทำไมการหยุดต้องสองบรรทัด** `Stop-ScheduledTask` ฆ่าตัวห่อ PowerShell และ `node`
ที่เป็นลูกของมันอาจรอดมาเป็นโปรเซสกำพร้าที่ยังเสิร์ฟอยู่ ซึ่ง**ไม่ใช่เรื่องร้ายแรง**
— แอปยังทำงาน เพียงแต่ Task Scheduler จะขึ้นว่าไม่ได้รัน และตัวห่อรอบหน้าจะเจอ
พอร์ตไม่ว่างแล้วออกด้วย 0 อย่างสงบ แต่ถ้าตั้งใจจะหยุดจริง ๆ ต้องฆ่าตามพอร์ตด้วย

#### เอาโค้ดใหม่ขึ้น — `deploy-ot.ps1`

**ต้องหยุดก่อน build** `next start` ถือ `BUILD_ID` ที่มันบูตมา ดังนั้น
`npm run build` ทับข้างใต้เซิร์ฟเวอร์ที่รันอยู่จะทำให้ทุกหน้าที่เปิดค้างไว้ขอไฟล์ที่
ไม่มีแล้ว (500 จนกว่าจะรีสตาร์ต) และบน Windows โปรเซสที่รันอยู่ยังจับไฟล์ใน `.next`
ไว้ด้วย **เรื่องนี้เกิดจริงเมื่อ 2026-08-26** — build เวลา 16:45 ทับเซิร์ฟเวอร์ที่
เริ่มไว้ 15:42 และเช้าวันรุ่งขึ้น :3000 ตอบ 500 ให้ CSS กับ JS ของตัวเอง

ลำดับที่ถูกคือ **หยุด → `npm run build` → ปลุกใหม่** ระหว่างนั้นแอปดับราวหนึ่งนาที
และเพราะ[ยังไม่มีงานตามตาราง](#ให้แอปขึ้นเองทุกครั้งที่ล็อกอิน--task-scheduler)
ขั้นสุดท้ายไม่ใช่ `Start-ScheduledTask` — สคริปต์เดียวที่ทำครบทั้งสามขั้นคือ

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\suwan\deploy-ot.ps1
```

มันบันทึกสภาพก่อนหน้า (commit, `BUILD_ID`, pid, โหมด) · บอกว่ากำลังแทนอะไรอยู่ ·
**ฆ่าโปรเซสแม่ก่อนลูก** เพราะทั้ง `next dev` และตัวห่อ `start-server.ps1` จะปลุกลูก
กลับมาถ้ามันรอดกว่า · `npm run build` · แล้วปลุกด้วย `Invoke-CimMethod` (ไม่ใช่
`Start-Process` ซึ่งจะฝากเซิร์ฟเวอร์ไว้ใน job object ของหน้าต่างที่เรียก แล้วตายไป
พร้อมกัน)

> ⚠️ **ตัวจริงคือ `scripts/deploy.ps1` ใน repo — `C:\Users\suwan\deploy-ot.ps1`
> เป็นแค่ตัวเรียกสามบรรทัด** แยกกันด้วยเหตุผลคนละข้อ · **พาธสั้น**มีไว้ให้พิมพ์จาก
> ความจำได้โดยไม่มีช่องว่าง เพราะครั้งแรกที่วางสคริปต์นี้ไว้ในโฟลเดอร์ชั่วคราว พาธ
> ยาวจนการใส่เครื่องหมายคำพูดเพี้ยน แล้วมีการรายงานว่าสำเร็จบนรอบที่ไม่เคยรัน ·
> **ตัวจริงอยู่ใน repo** เพราะขั้นตอน deploy ที่ไม่ได้อยู่ใน version control คือสิ่งที่
> ไม่มีใครรีวิว ไม่มีใครสำรอง และไม่ได้ถูกแก้ไปพร้อมกับ commit ที่ทำให้มันเปลี่ยน —
> มันอยู่นอก repo จนถึง 2026-08-27 ซึ่งเป็นสาเหตุที่มันบรรยายเซิร์ฟเวอร์ `next start`
> อยู่ทั้งวันในขณะที่เครื่องรัน `next dev`
>
> และมันต้องรันใน **หน้าต่าง PowerShell ปกติ ไม่ใช่ผ่าน Claude Code** เพราะขั้นฆ่า
> โปรเซสคือสิ่งที่ตัวกรองสิทธิ์ปฏิเสธ · ไฟล์ใน `scripts/` เป็น ASCII ล้วนเหมือน
> `start-server.ps1` ด้วยเหตุผลเดียวกัน และ `test/scriptEncoding.test.js` บังคับไว้

**ตรวจก่อนว่ามันจะไม่พัง** — build ลง distDir สำรองแล้วเปิดบนพอร์ตอื่น โดย :3000
ยังเสิร์ฟอยู่ตลอด `next.config.js` คอมมิต `distDir: process.env.VERIFY_DIST_DIR || '.next'`
ไว้แล้ว จึงไม่ต้องแก้ไฟล์อะไร

```powershell
$env:VERIFY_DIST_DIR = '.next-verify'; npm run build
$env:VERIFY_DIST_DIR = '.next-verify'; npx next start -p 3001
# ...เดินของจริงบน :3001 แล้วค่อยลบทิ้ง
Remove-Item -Recurse -Force .next-verify
```

**ข้อสุดท้ายคือข้อเดียวที่พิสูจน์อะไรได้** `BUILD_ID` ใหม่บนดิสก์บอกแค่ว่า build
เกิดขึ้น ไม่ได้บอกว่าเซิร์ฟเวอร์ที่รันอยู่เสิร์ฟมัน — สองอย่างนี้แยกกันมาแล้วเมื่อ
2026-08-26 `deploy-ot.ps1` ขั้นที่ 5 จึงดึง CSS ออกมาจากเซิร์ฟเวอร์เองแล้ว grep
ไม่ได้อ่านไฟล์บนดิสก์

> ⚠️ **คำที่ grep ต้องเป็นของ*ชุดแก้นี้* ไม่ใช่คำที่ค้างมาจากรอบก่อน** ขั้นที่ 5
> เคยฝัง `pager-step` ไว้ตายตัวตั้งแต่ 2026-08-26 ถึง 2026-08-31 ซึ่งเป็นคลาสที่
> งานแผงเปลี่ยนหน้าเพิ่มไว้ — และ build ทุกครั้งหลังจากนั้นก็มีมันติดมาด้วย
> การ grep จึงพิสูจน์ได้แค่ว่า *build บางอัน* ขึ้นแล้ว ไม่ใช่ว่า *build นี้* ขึ้น
> ซึ่งเป็นความผิดพลาดชนิดเดียวกับที่ขั้นนี้มีไว้จับ ตอนนี้เป็นพารามิเตอร์
> `-Sentinel` ตั้งต้นเป็นคลาสใหม่ล่าสุด (`policy-diffs`) — **ย้ายมันทุกครั้งที่
> deploy ของที่เพิ่มคลาสใหม่ และส่ง `-Sentinel` เองถ้าชุดแก้นั้นไม่ได้เพิ่มคลาส**

## สำรองและกู้คืนข้อมูล

สังเกต `--` ที่อยู่หน้า flag ถ้าไม่มีมัน npm จะเก็บ flag พวกนั้นไว้ใช้เอง แล้วคำสั่ง
จะทำงานสำเร็จโดยที่เพิกเฉยต่อทั้งสองตัวอย่างเงียบ ๆ — เขียนลง `./backups` ซึ่งเป็น
ค่าตั้งต้น บนดิสก์ลูกเดียวกับฐานข้อมูล และไม่มีการลบชุดเก่า นี่คือความผิดพลาดข้อเดียว
ในหน้านี้ที่หน้าตาเหมือนทำสำเร็จ ตัวห่อหุ้มข้างล่างใส่ `--` มาให้แล้ว จะได้ไม่มีใคร
ต้องจำ

```powershell
npm run backup                                    # → ./backups/primus_ot-<วันเวลา>/
npm run backup -- --out D:/ot-backups             # ที่ที่ไม่ใช่ดิสก์ลูกนี้
npm run backup -- --out D:/ot-backups --keep 30   # …และลบทิ้งให้เหลือ 30 ชุดล่าสุด
npm run restore -- <โฟลเดอร์>                      # ตรวจสอบและแสดงแผน ไม่เขียนอะไร
npm run restore -- <โฟลเดอร์> --yes                # กู้ทับฐานที่ MONGODB_URI
npm run restore -- <โฟลเดอร์> --to <uri> --yes     # ซ้อมกู้ลงฐานทดสอบ
```

เครื่องที่รันระบบนี้ไม่ได้ติดตั้ง `mongodump` ทั้งสองสคริปต์จึงเดินผ่าน driver ตัว
เดียวกับที่แอปใช้อยู่แล้ว — มันทำงานได้ทุกที่ที่ `npm run dev` ทำงานได้ ผลลัพธ์เป็น
Extended JSON หนึ่งเอกสารต่อหนึ่งบรรทัด บวก `manifest.json` ที่ถือ SHA-256 ของทุก
ไฟล์และนิยามของ index ไว้ `mongorestore` อ่านมันไม่ได้ ตัวอ่านมีตัวเดียวคือ
`npm run restore`

**รายชื่อ collection มาจากฐานข้อมูล ไม่ได้มาจากรายการโมเดล** `lib/db.js` import
โมเดลมาหกตัว แต่ `src/models/` มีสิบตัว — การสำรองที่ขับด้วยทะเบียนโมเดลจะข้าม
`otEmployeeAudits`, `approvaldelegations` และ `otPolicyReplayRuns` ไปเงียบ ๆ
แล้วรายงานว่าสำเร็จ ชุดสำรองที่ขาดไปสาม collection แย่กว่าไม่มีชุดสำรองเลย
เพราะมันคือสิ่งที่คนเชื่อถือ

> ประโยคนี้เคยอ่านว่า "สิบสองตัว" และนับ `otPeriodLocks` เป็นข้อที่ห้า จน
> 2026-08-31 ที่ ปิดงวด ถูกถอนออก (ดู `lib/periodStatus.js`) และโมเดลถูกลบไป ·
> เคยอ่านว่า "สิบเอ็ดตัว" และนับ “otBirthdayChecks” เป็นข้อที่สาม จน 2026-09-03
> ที่งานวันเกิดฝั่งฝ่ายบุคคลถูกถอน
> **นี่คือเหตุผลที่บรรทัดนั้นถามฐานข้อมูล ไม่ใช่ถามทะเบียนโมเดล** — การถอนฟีเจอร์
> ไม่ต้องแก้อะไรตรงนี้เลย collection ที่ยังอยู่แต่ว่างก็ยังถูกสำรอง และที่ถูก drop
> ไปแล้วก็แค่หายไปจากรายการ · **และนี่คือครั้งที่สองที่มันพิสูจน์ตัวเอง**:
> “otBirthdayChecks” ยังมีเอกสารจริงอยู่ข้างใน ไม่มีอะไรอ่านมันแล้ว และมันยังถูก
> สำรองครบทุกคืนโดยไม่ต้องมีใครไปเพิ่มชื่อมันไว้ที่ไหน

**ไม่มีอะไรถูกเขียนถ้าไม่มี `--yes`** การรันแบบตั้งต้นจะตรวจลายนิ้วมือทุกไฟล์
เชื่อมต่อ พิมพ์ออกมาว่ามันจะลบอะไรบ้าง แล้วหยุด ไฟล์ถูกอ่าน ถูก hash และถูก parse
*ก่อน* ที่ collection แรกจะถูกลบ ชุดสำรองที่ขาดหายหรือถูกแก้จึงถูกพบตั้งแต่ตอนที่
ฐานข้อมูลจริงยังอยู่ครบ การกู้ทับฐานที่มีข้อมูลอยู่จะทำสำเนาความปลอดภัยไว้ก่อนเสมอ
(ใส่ `--no-safety-backup` เพื่อข้าม สำหรับฐานทดสอบ) ส่วน collection ที่มีอยู่ในฐาน
ปลายทางแต่ไม่มีในชุดสำรอง จะถูกปล่อยไว้เฉย ๆ และรายงานให้ทราบ — สาเหตุที่พบบ่อย
ที่สุดคือกู้ผิดฐาน

index ถูกเก็บและสร้างคืน การลบ collection ทำให้ index ของมันหายไปด้วย และการกู้คืน
ที่ไม่มี index กลับมา จะได้ตัวเลขคืนครบแต่ไม่ได้ข้อบังคับคืนเลยสักข้อ: unique index
บน `Employee.code` คือสิ่งที่กัน PM-0620 ตัวที่สองไม่ให้เกิดขึ้น

**ชุดสำรองที่ไม่มีใครเคยกู้ คือชุดสำรองที่ไม่รู้ว่าอยู่ในสภาพไหน** `--to` มีไว้เพื่อ
แก้เรื่องนั้น — ชี้การกู้ไปที่ฐานข้อมูลทิ้ง ๆ แล้วให้มันตรวจจำนวนให้ ตรวจครบวงจรแล้ว
เมื่อ 2026-08-14: การสำรองฐานที่กู้กลับมา ให้ไฟล์ที่เหมือนกันทุกไบต์และนิยาม index
ที่เหมือนกันครบทั้งสิบเอ็ด collection

`backups/` อยู่ใน `.gitignore` ชุดสำรองหนึ่งชุดคือสำเนาทะเบียนพนักงานทั้งชุด —
`passwordHash` ของทุกบัญชี และ `birthDate` ที่ `publicEmployee()` กรองออกจากสายตา
หัวหน้างานโดยตั้งใจ เก็บมันไว้นอกดิสก์ลูกนี้ `--out` มีไว้เพื่อการนั้น

### ตั้งเวลาสำรองอัตโนมัติ

**บนเครื่องนี้ — Windows, Task Scheduler** นี่คือตัวที่ทำงานอยู่จริงวันนี้:
“เครื่องจริง” คือแล็ปท็อป ตัวตั้งเวลาจึงเป็นตัวที่ติดมากับมัน

**ตั้งไว้แล้วเมื่อ 2026-08-18** งานชื่อ **`OT backup`** รัน **ทุกวัน 01:00** เก็บ
30 ชุด สถานะ `State: Ready` และ log อยู่ที่ `backups\backup.log`

> ⚠️ **งานนี้สำเร็จแล้ว และมันยังไม่ใช่การสำรองข้อมูลจริง ๆ อยู่ดี**
> ปลายทางถูกเปลี่ยนเป็น **`C:\Users\suwan\OT-Backups`** เมื่อ 2026-08-24 เพราะ
> ไดรฟ์ `E:` ไม่เคยถูกเสียบเลย ตอนนี้จึงรันผ่านทุกคืน — ตรวจล่าสุด 2026-08-25 07:53
> ได้ `LastTaskResult: 0` และ 12 collection รวม 785 รายการ
>
> **แต่ `C:` คือดิสก์ลูกเดียวกับที่ MongoDB อยู่** ดิสก์เสียเมื่อไหร่ก็หายไปพร้อมกัน
> ทั้งฐานข้อมูลและชุดสำรอง สิ่งที่การตั้งค่าปัจจุบันป้องกันได้คือ "ลบผิด" กับ
> "กู้ข้อมูลย้อนหลัง" ส่วนสิ่งที่มันป้องกันไม่ได้คือ "ดิสก์พัง" ซึ่งเป็นเหตุผลข้อแรก
> ที่คนทำสำรองข้อมูล **ยังรอฮาร์ดดิสก์ภายนอกอยู่** เสียบแล้วให้สร้างโฟลเดอร์ปลายทาง
> เปลี่ยน `-Destination` ของงาน แล้ว `Start-ScheduledTask -TaskName 'OT backup'`
> และยืนยันว่าได้ `LastTaskResult: 0`
>
> ตัวห่อหุ้มจะตรวจปลายทางแล้วปฏิเสธ แทนที่จะสร้างโฟลเดอร์ให้ การปฏิเสธนั้นตั้งใจ:
> การสร้างโฟลเดอร์ให้เท่ากับวางชุดสำรองไว้บนดิสก์ลูกไหนก็ตามที่ path นั้นตกลงไป
> ซึ่งก็คือดิสก์ลูกที่ชุดสำรองมีไว้เพื่อจะ*ไม่*อยู่บนมัน
>
> โฟลเดอร์ที่ sync ขึ้นคลาวด์ (OneDrive) พาข้อมูลออกจากแล็ปท็อปเครื่องนี้ได้จริง
> แต่ชุดสำรองหนึ่งชุดถือ `passwordHash` ของทุกบัญชี และ `birthDate` ของพนักงานทุกคน
> — นั่นคือการอัปโหลดข้อมูลส่วนบุคคลของพนักงานไปให้บุคคลที่สาม เป็นเรื่องที่เจ้าของ
> การตัดสินใจต้องตัดสิน ไม่ใช่เรื่องความสะดวก **ตัดสินไปแล้วเมื่อ 2026-08-18 ว่าไม่เอา**

> 🔴 **`scripts/backup.ps1` ต้องคง UTF-8 BOM ไว้เสมอ** Task Scheduler รันมันด้วย
> `powershell.exe` — Windows PowerShell 5.1 — ซึ่งอ่านไฟล์ที่ไม่มี BOM เป็น ANSI
> ข้อความภาษาไทยทุกบรรทัดในสคริปต์จะกลายเป็นอักขระเพี้ยน parser ไปเจอ
> `Unexpected token` ที่บรรทัด 65 แล้ว PowerShell ออกด้วยรหัส 1 **ก่อนถึง
> `Write-Log` บรรทัดแรก**: งานรายงานว่าล้มเหลว และไฟล์ log ไม่ถูกแตะเลย ที่เดียวที่
> ใครจะไปหาสาเหตุจึงว่างเปล่า นี่คือวิธีที่เรื่องนี้ถูกพบเมื่อ 2026-08-18 — สคริปต์
> ถูกทดสอบด้วย `pwsh` 7 เท่านั้น ซึ่งใช้ UTF-8 เป็นค่าตั้งต้น และเนื้อหาส่วนนี้ที่
> พิมพ์อยู่เหนือมันไม่เคยทำงานได้จริงเลย โปรแกรมแก้ไขไฟล์ที่ "เก็บกวาด" BOM ทิ้ง
> จะทำให้มันพังซ้ำแบบเงียบ ๆ — ตั้งแต่ 2026-08-25 `test/scriptEncoding.test.js`
> จะจับได้ก่อนถึง Task Scheduler

```powershell
# ทดสอบด้วยมือก่อนหนึ่งรอบเสมอ — ต้องได้ exit code 0
# และทดสอบด้วย powershell.exe ไม่ใช่ pwsh — ตัวที่ Task Scheduler ใช้คือ 5.1
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "C:\Users\suwan\Documents\OT_HR\scripts\backup.ps1" -Destination E:\ot-backups -Keep 30

# ตั้งให้รันทุกวัน 01:00 — นี่คือคำสั่งที่ใช้จริงเมื่อ 2026-08-18
$repo = 'C:\Users\suwan\Documents\OT_HR'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}\scripts\backup.ps1" -Destination E:\ot-backups -Keep 30' -f $repo) `
  -WorkingDirectory $repo
$trigger  = New-ScheduledTaskTrigger -Daily -At 1am
# StartWhenAvailable is what covers a laptop that was asleep at 01:00 — without
# it a missed run is simply skipped and nobody is told. MultipleInstances
# IgnoreNew stops a slow run being overlapped by the next night's.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'OT backup' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'สำรองฐานข้อมูล OT ไป E:\ot-backups ทุกวัน 01:00 เก็บ 30 ชุด — ดู backups\backup.log' -Force
```

คำสั่งตรวจสอบภายหลัง — สองบรรทัดที่ควรรู้:

```powershell
Get-ScheduledTaskInfo -TaskName 'OT backup' | Select LastRunTime, LastTaskResult, NextRunTime
Get-Content backups\backup.log -Tail 5
```

`LastTaskResult: 0` คือการสำรองที่เกิดขึ้นจริง `1` คือหาปลายทางไม่เจอ นอกนั้นให้
ไปอ่าน log

**ถ้าวันหนึ่งย้ายไปเซิร์ฟเวอร์ Linux — ใช้ cron** `scripts/backup.sh` ทำสามอย่าง
เดียวกัน ตัวห่อหุ้มทั้งสองตัวถูกทำให้เดินตรงกันโดยตั้งใจ แก้ตัวไหนต้องแก้อีกตัวด้วย

```sh
chmod +x scripts/backup.sh
0 2 * * *  cd /srv/ot && scripts/backup.sh /mnt/backups 30
```

ตัวห่อหุ้มทั้งสองบางมาก: สิ่งที่มันรันคือ `npm run backup -- --out … --keep …`
เท่านั้น สิ่งที่มันเพิ่มเข้ามาคือสิ่งที่งานตามตารางเวลาต้องการแต่คนที่นั่งอยู่หน้า
คีย์บอร์ดไม่ต้องการ — **log** เพราะตอนตีสองไม่มีใครนั่งดู · **exit code ที่ไม่ใช่
ศูนย์** เมื่อล้มเหลว เพราะนั่นคือสิ่งที่ Task Scheduler และ cron รายงาน · และ
**การปฏิเสธเมื่อไม่พบปลายทาง** เพราะไดรฟ์ที่ไม่ได้เสียบคือความล้มเหลวธรรมดา ๆ ของ
วันจันทร์ และถ้าไม่มีการตรวจนี้ `--out` จะสร้างโฟลเดอร์ให้อย่างช่วยเหลือดี บนดิสก์
ลูกที่ถือฐานข้อมูลอยู่ ซึ่งเป็นดิสก์ลูกที่ชุดสำรองมีไว้เพื่อจะไม่อยู่บนมัน

`--keep N` ลบชุดเก่า *หลัง* ชุดใหม่ถูกเขียนและตรวจแล้ว ไม่เคยลบก่อน มิฉะนั้นการรัน
ที่พังกลางทางจะทิ้งสำเนาของเมื่อวานไปเพื่อเปิดที่ให้สำเนาที่ไม่มีอยู่จริง ตัวเลือกว่า
จะลบอะไรคือ `backupsToPrune` ซึ่งบริสุทธิ์และมีเทสต์: มันจับคู่เฉพาะรูปแบบ
`<ฐานข้อมูล>-YYYYMMDD-HHMMSS` เท่านั้น การชี้ `--out` ไปที่ไดรฟ์ที่ใช้ร่วมกันจึงกวาด
อย่างอื่นในนั้นไปไม่ได้ · ฐานข้อมูลสองฐานที่เขียนลงโฟลเดอร์เดียวกันไม่ลบของกันและกัน
· และ `--keep 0` ถูกอ่านเป็น 1 เพราะ "ลบชุดสำรองของฉันให้หมด" ไม่ใช่นโยบายการเก็บ
รักษา และตัวแปรที่ไม่ได้ตั้งค่าคือวิธีที่มีโอกาสมากที่สุดที่จะเผลอสั่งแบบนั้น ก่อนลบ
ทุกโฟลเดอร์จะถูกตรวจซ้ำว่ามี `manifest.json` ไหม — ชื่อโฟลเดอร์เป็นสิ่งที่ใครก็สร้าง
ได้ — โฟลเดอร์ที่ไม่มีจะถูกรายงานและปล่อยไว้เฉย ๆ

**ตอนนี้ตั้งไว้แล้วทั้งหมด** สคริปต์เขียนและทดสอบแล้ว งานตามตารางเวลาลงทะเบียนแล้ว
และรันผ่านทุกคืน สิ่งเดียวที่ยังขาดคือ**ปลายทางที่ไม่ใช่ดิสก์ลูกเดียวกับฐานข้อมูล**
— ดูกล่องคำเตือนข้างบน

แอป Next.js ตัวเดียวให้บริการทั้งสองฝั่ง — ไม่มีพอร์ต API แยก และไม่มี proxy
`.env` ถูกอ่านโดย Next โดยตรง

**แผนกจริง 18 แผนกเข้าฐานข้อมูลนี้แล้วเมื่อ 2026-09-03** ด้วย
`npm run import:departments` (`--dry` เพื่อดูอย่างเดียว, `--yes` เพื่อยืนยัน)
— ชื่อและ **เพดาน ชม./เดือน** มาจากตาราง `หน่วยงาน.pdf` แผ่นเดียวกัน ·
สคริปต์**เพิ่มอย่างเดียว ไม่แก้และไม่ลบของเดิม** แผนกที่มีรหัสหรือชื่อไทยซ้ำจะถูก
ข้ามและรายงาน จึงรันซ้ำได้ · **รหัสแผนกเป็นสิ่งที่สคริปต์ตั้งเอง** เพราะตารางนั้น
ไม่มีคอลัมน์รหัส — เปลี่ยนได้ที่ ตั้งค่าระบบ → แผนก โดยไม่กระทบอะไร ทุกจอแสดง
`nameTh` · **ผู้เซ็นของแต่ละแผนกยังไม่ได้ใส่** เพราะผู้เซ็นคือ*คน*ในทะเบียน และ
ทะเบียนจริง 163 คนยังไม่ได้นำเข้า — ใครเซ็นให้ใครมาพร้อมคนอยู่แล้ว
(ดู `isDepartmentManager`: ขอบเขตอ่านจากการเป็นสมาชิกแผนก + บทบาท ไม่ใช่จาก
`Department.manager`) **ห้าแผนกที่ seed ไว้ (`ENG` `PROD` `QC` `WH` `ADM`) ถูกลบไปแล้ว**ในบ่าย
วันเดียวกัน ด้วย `npm run rehome:demo-roster` — ย่อหน้านี้เคยเขียนว่าทั้งห้า
"ยังอยู่ครบ เพราะพนักงาน seed 22 คนชี้อยู่" · **ไม่มีใครถูกลบ** ทั้ง 22 บัญชี
ถูก*ย้าย*ทั้งทีมไปแผนกจริงที่ใกล้เคียงที่สุด (ENG→`RND` · PROD→`PROD1` ·
QC→`PROD2` · WH→`WH-FG` · ADM→`HRD`) พร้อมใบ OT 22 ใบของพวกเขา · **ทั้งทีม
ย้ายไปด้วยกันเสมอ** เพื่อให้แต่ละทีมยังมีหัวหน้างานที่เซ็นให้ได้ · การย้าย*ใบ*
เป็นการเขียนทับสิ่งที่แถวนั้นเคยบอก และปลอดภัยเพราะเป็นข้อมูลตัวอย่างล้วน —
บนชั่วโมงจริงต้องปิดใช้งานแผนกแทน ไม่ใช่ย้ายใบ · `ADMIN` เป็นบัญชี
ผู้ดูแลระบบเดียวของระบบและทะเบียนจริงไม่มีแถวของมัน สคริปต์จึงย้ายมันก่อนอย่างอื่น
และปฏิเสธที่จะเขียนอะไรเลยถ้าหาปลายทางไม่เจอ

บัญชีที่ seed ไว้ (รหัสผ่านจาก `SEED_PASSWORD` ค่าตั้งต้น `primus123`):

| รหัส | บทบาท |
|---|---|
| `PM-0412` | พนักงาน — เป็นเจ้าของตัวอย่างที่คำนวณไว้ A–E |
| `PM-0100` | หัวหน้างาน แผนก Engineering |
| `HR-001` | ฝ่ายบุคคล |
| `ADMIN` | ผู้ดูแลระบบ |

รหัสผ่านร่วมนั้นเป็น **ของสำหรับการพัฒนาเท่านั้น** และใช้ได้เฉพาะกับแถวที่
`npm run seed` เขียนขึ้น ไม่ใช่วิธีที่บัญชีจริงได้รหัสผ่านมา — ดูหัวข้อถัดไป

### รหัสผ่านแรกเข้า: คือรหัสพนักงาน และมีแถบเตือนอยู่จนกว่าจะเปลี่ยน

หัวข้อนี้ชื่อ “รหัสผ่านชั่วคราว: สุ่มขึ้นมา แสดงครั้งเดียว และไม่เคยคำนวณจากอะไร”
จนถึง **2026-09-02** ซึ่งเป็นวันที่ ฝ่ายบุคคล ขอรหัสพนักงานกลับมาเป็นค่าเริ่มต้น
ประวัติทั้งหมดอยู่ท้ายหัวข้อนี้ — อ่านก่อนจะแก้อะไรตรงนี้

บัญชีที่ถูกสร้างจาก ทะเบียนพนักงาน — ทีละคนหรือด้วย CSV — จะได้ **รหัสพนักงานของ
ตัวเอง** เป็นรหัสผ่าน ผ่าน `defaultPassword()` ใน `lib/employees.js` ซึ่งอ่าน
`employee.code` ของแถวที่เพิ่งเขียน (ผ่าน `trim` + `uppercase` ของ schema มาแล้ว)
เก็บขีดกลางไว้ตามที่พิมพ์อยู่บนบัตร — `PM-0620` คือ `PM-0620` ไม่ใช่ `PM0620`
เพราะคนที่พิมพ์มันที่หน้าล็อกอินกำลังลอกจากสิ่งที่ถืออยู่ในมือ

**การกดปุ่ม “รีเซ็ตรหัสผ่าน”** ในทะเบียนพนักงาน หรือใน แก้ไข →
สิทธิ์และสถานะ ตั้งค่ากลับเป็นค่าเดียวกันนี้ กล่องยืนยันบอกทั้งชื่อและค่าก่อนเขียน
(“คุณต้องการรีเซ็ตรหัสผ่านของ … กลับเป็นรหัสพนักงาน (PM-0620) หรือไม่”)
แล้วจึงแจ้งผลพร้อมค่าที่เซิร์ฟเวอร์ตอบกลับมาจริง

**สิ่งที่จ่ายค่าให้กับความเดาได้นี้คือ `mustChangePassword`** ซึ่งถูกตั้งพร้อมกัน
ทุกครั้ง จากทุกเส้นทางที่ออกรหัสให้ และ `POST /api/employees/me/password`
ปฏิเสธรหัสใหม่ที่ซ้ำกับรหัสเดิม จึงไม่มีใครล้างธงนี้ด้วยการพิมพ์รหัสพนักงานกลับเข้าไป

**ไม่มีหน้าคั่นก่อนเข้าระบบแล้ว ตั้งแต่ 2026-09-04** ย่อหน้าข้างบนเคยอ่านต่อว่า
บัญชีที่ถือธงนี้ “ไปหน้าจอไหนไม่ได้เลยนอกจากตั้งรหัสผ่านของตัวเอง” และช่วงที่รหัส
เดาได้ใช้งานได้จริงคือ “จนกว่าจะล็อกอินครั้งแรก” — **สองประโยคนั้นเป็นของเดิมทั้งคู่**
วันนั้นมีคำขอสองรอบ: รอบแรกขอให้คนที่ยังไม่อยากเปลี่ยนรหัสเข้าใช้งานได้ก่อน จึงเติมปุ่ม
“ข้ามไปก่อน · เข้าใช้งานเลย” ลงบนหน้านั้น · รอบที่สองหลังจากเดินของจริงแล้วคือ
**“ไม่ต้องเข้ามาหน้านี้แล้ว ไม่เอาหน้านี้แล้ว”** หน้า ตั้งรหัสผ่านของคุณ (“FirstLogin”)
จึงถูกลบทิ้งทั้งหน้าในวันเดียวกัน — หน้าที่ทุกคนที่มาถึงกำลังมองหาทางออกจากมัน
คือหน้าที่คิดค่าผ่านทางเป็นคลิกเปล่า ๆ

ตอนนี้ **ล็อกอินแล้วเข้าแอปเลยทุกบัญชี** และเรื่องนี้ถูกบอกด้วยข้อความสามที่แทน —
ที่แรกอยู่*ก่อน*ล็อกอินและวาดให้ทุกคนเห็นเสมอ อีกสองที่อ่านธง `mustChangePassword`
และหายไปเองเมื่อธงถูกล้าง:

- **บรรทัดใต้ช่องรหัสผ่านที่หน้าล็อกอิน** “เข้าใช้งานครั้งแรก · รหัสผ่านคือรหัสพนักงาน
  ของคุณ **ทั้ง PM และ THT** พิมพ์เป็นตัวพิมพ์ใหญ่ตามที่อยู่บนบัตร” · อ่านว่า
  “เข้าใช้งานครั้งแรก · รหัสผ่านคือรหัสพนักงานของคุณ พิมพ์เป็นตัวพิมพ์ใหญ่ตามที่อยู่
  บนบัตร” จนถึง 2026-09-08 ที่ช่อง*รหัสพนักงาน*เหนือมันเปลี่ยนตัวอย่างเป็น
  `PM00111 / THT1111` — กล่องบอกสองพรีฟิกซ์แล้ว บรรทัดนี้จึงห้ามอ่านเหมือนพูดถึง
  บริษัทเดียว และไม่ซ้ำตัวเลขเพราะตัวอย่างอยู่เหนือมันสามเซนติเมตร ·
  **เพิ่มกลับเมื่อ 2026-09-07** —
  ประโยคนี้เคยอยู่ในย่อหน้าท้ายการ์ดล็อกอินและถูกตัดไปเมื่อ 2026-09-04 พร้อมคำขอให้
  หน้านั้นสั้นและเป็นทางการ ประโยคนี้เป็นหนึ่งในสามที่ถูกตัด และเป็นข้อเดียวที่มีราคา:
  บัญชีที่ไม่เคยล็อกอินไม่มีทางรู้รหัสผ่านของตัวเองจากหน้าจอเลย ต้องโทรถาม ฝ่ายบุคคล
  ซึ่งมักจบด้วยการกด รีเซ็ตรหัสผ่าน ให้บัญชีที่ไม่ได้ต้องการมัน · **มันบอกเรื่อง
  ตัวพิมพ์ด้วยโดยตั้งใจ** `defaultPassword()` คืนค่าเป็นตัวพิมพ์ใหญ่ ช่อง*รหัสพนักงาน*
  ไม่สนตัวพิมพ์ (`codeMatcher`) แต่ช่อง*รหัสผ่าน*สนเสมอ คนที่พิมพ์ `pm00416` ลงทั้ง
  สองช่องจึงเข้าไม่ได้ทั้งที่ทุกตัวถูก
- **แถบเตือนบนหน้าแรกของบทบาทนั้น** “คุณยังใช้รหัสผ่านที่ฝ่ายบุคคลตั้งให้อยู่”
  พร้อมปุ่มที่พาไป ข้อมูลส่วนตัว (`PasswordReminder` ใน `components/App.jsx`)
  วาดครั้งเดียวบนหน้าแรก กฎเดียวกับแถบสำรองข้อมูลและประกาศวันหยุด
- **ข้อความเหนือฟอร์ม เปลี่ยนรหัสผ่าน บนหน้า ข้อมูลส่วนตัว** ซึ่งรับช่วงประโยคที่
  หน้าที่ถูกลบเคยพูดไว้ด้วย — ว่า “รหัสผ่านเดิม” คือรหัสพนักงานของตัวเอง สำหรับคนที่
  ไม่เคยมีใครบอกและได้แต่เดา · ทั้งสองที่ปิดทิ้งไม่ได้ เพราะเป็น*สถานะ* ไม่ใช่ข้อความ
  แจ้งผล และหายไปเองเมื่อธงถูกล้าง (หน้าจออ่าน session ใหม่ทันทีที่บันทึกรหัส
  จึงไม่ต้อง refresh)
- **ราคาที่จ่ายจริง: ช่วงที่รหัสพนักงานใช้ล็อกอินได้ ไม่ได้จบที่การล็อกอินครั้งแรก
  อีกต่อไป** มันจบเมื่อคนนั้นกด บันทึกรหัสผ่านใหม่ เท่านั้น ใครที่ไม่เคยเปลี่ยนก็ยังมี
  รหัสผ่านที่พิมพ์อยู่บนใบ OT ทุกใบ **นี่คือสิ่งที่ถูกเลือกแลกมาโดยรู้ตัว** ทางกลับคือ
  ทำหน้าคั่นขึ้นมาใหม่ ซึ่งเป็นสิ่งที่ถูกสั่งให้เอาออก — ถ้าจะต้องรัดกุมกว่านี้โดยไม่มี
  หน้าคั่น ทางที่เหลือคือกำหนดวันหมดอายุให้รหัสที่ยังไม่ถูกเปลี่ยน ซึ่งยังไม่ได้ถาม

**ไม่มีผู้เรียกคนไหนเลือกรหัสผ่านเองได้ นอกจากตอนสร้าง**
`PATCH /api/employees/:id` ตอบ 400 เมื่อเจอฟิลด์ `password` แทนที่จะทำตาม การรีเซ็ต
ขอด้วย `resetPassword: true` เท่านั้น และคอลัมน์ `password` ในไฟล์ CSV นำเข้าจะถูก
เพิกเฉยพร้อมคำเตือนบนแถวนั้น `POST /api/employees` รับรหัสที่ ฝ่ายบุคคล พิมพ์เองได้
แต่เดินผ่าน `chosenPasswordPermission()` ซึ่งยัง **ปฏิเสธรหัสผ่านทุกตัวที่มีรหัส
พนักงานอยู่ในนั้น** — `pm0620`, `Primus@PM-0620`, `xxPM0620xx` ถูกปฏิเสธหมด
ข้อยกเว้นเดียวคือค่าที่ตรงกับค่าเริ่มต้นเป๊ะ ๆ เพราะนั่นคือสิ่งที่การไม่พิมพ์อะไรเลย
จะได้อยู่แล้ว ทั้งหมดตรึงไว้ด้วย `test/tempPassword.test.js`

**สิ่งที่ยังคำนวณบนเบราว์เซอร์ไม่ได้คือ*ค่าที่ถูกเก็บ*** หน้าจอคำนวณค่านี้ได้และ
เอาไปเขียนเป็นประโยคให้อ่าน แต่ค่าที่เข้าฐานข้อมูลมาจากเซิร์ฟเวอร์เสมอ และหน้าจอ
แสดงค่าที่ *ตอบกลับมา* ไม่ใช่ค่าที่ตัวเองเดาไว้ — นี่คือครึ่งหนึ่งของบั๊กเดิมที่ยัง
ปิดอยู่ ดูย่อหน้าถัดไป

### รหัสผ่านที่ตั้งเอง: ยาวอย่างน้อย 4 · ไทยได้ · และมีเพดานที่ bcrypt

`passwordShapePermission()` ใน `lib/employees.js` คือกฎเดียวที่ใช้ทั้ง
`POST /api/employees` (ผ่าน `chosenPasswordPermission`) และ
`POST /api/employees/me/password` ของทั้งสองเซิร์ฟเวอร์ · เพิ่มเมื่อ **2026-09-02**
พร้อมการรองรับภาษาไทย

- **ยาวอย่างน้อย `PASSWORD_MIN_LENGTH` = 4** เดิมคือ 6 · นับเป็น UTF-16 code unit
  ซึ่ง**ไม่เท่ากับจำนวนตัวที่คนเห็น**สำหรับภาษาไทย: `ก่อ` คือสองตัวบนจอแต่สาม
  หน่วย เพราะวรรณยุกต์เป็นหน่วยของตัวเอง
- **อักขระที่ใช้ได้** ไทยทั้งบล็อก `฀-๿` (พยัญชนะ สระ วรรณยุกต์ เลขไทย ฿)
  · `a-zA-Z0-9` · และเครื่องหมาย ``!@#$%^&*()_+-=[]{};':"\|,.<>/?`` ·
  `PASSWORD_ALLOWED` คือกฎเดียวกันในรูปที่สั่งมา ส่วนที่ทำงานจริงคือตัวกลับด้าน
  เพราะมันบอกได้ว่า**ตัวไหน**ผิด ซึ่งจำเป็นเมื่ออักขระนั้นมองไม่เห็น
- **ที่ใช้ไม่ได้ และควรรู้ไว้** ช่องว่าง (`ดอก ไม้` ถูกปฏิเสธ) · `~` และ backtick ·
  ทุกอย่างนอกไทยกับ ASCII เช่น `é` `中` และอิโมจิ · ข้อความปฏิเสธจะบอกตัวอักษร
  พร้อมรหัส `U+XXXX` เสมอ
- **`PASSWORD_MAX_BYTES` = 72** เพราะ **bcrypt อ่านแค่ 72 ไบต์แล้วตัดที่เหลือทิ้ง
  เงียบ ๆ** และไทยตัวละ 3 ไบต์ เพดานจริงจึงราว **24 ตัวอักษรไทย** ไม่ใช่ 72 ·
  วัดกับ `bcryptjs` ของเครื่องนี้แล้ว: hash `ก`×24 + `A` แล้ว compare
  `ก`×24 + `B` ได้ `true` — สองรหัสผ่าน หนึ่งบัญชี ไม่มีอะไรฟ้อง · จึงปฏิเสธ
  ตั้งแต่ต้นทางแทนที่จะรับแล้วตัด

**กฎนี้ทำงานเฉพาะตอน*ตั้ง* รหัสผ่าน ไม่เคยทำงานตอน*ตรวจ*** รหัสผ่านที่เก็บไว้แล้ว
จึงใช้ได้ต่อไม่ว่ากฎจะแคบลงหรือกว้างขึ้น — เป็นเหตุผลที่ขยายรายการอักขระทีหลังได้
โดยไม่ต้อง migrate อะไร และตรึงไว้เป็นเทสต์ ไม่ได้ปล่อยเป็นคำอ้าง

**ภาษาไทยกับ hash: NFC** `Employee.hashPassword()` normalize เป็น NFC ก่อนเสมอ
เพราะ `ก` + `ุ` + `่` กับ `ก` + `่` + `ุ` เป็นคำเดียวกัน หน้าตาเหมือนกันบนทุกจอ
แต่เป็นคนละลำดับไบต์ — เครื่องหมายสองตัวนี้มี combining class ต่างกัน Unicode จึง
ถือว่าเป็นข้อความเดียวกันและ NFC จัดลำดับให้ · ถ้าไม่ normalize คนที่พิมพ์อีกลำดับ
หนึ่งจะเจอ “รหัสผ่านเดิมไม่ถูกต้อง” โดยที่บนจอถูกทุกตัว นี่คืออาการ
*สระ/วรรณยุกต์เพี้ยน* ตัวจริง · `verifyPassword()` ลองค่า**ดิบก่อน** แล้วค่อยลอง
NFC จึงไม่มีใครถูกล็อกออก: hash ที่เขียนไว้ก่อน 2026-09-02 ทำจากไบต์ที่ยังไม่
normalize และยังเปิดด้วยคีย์เดิมได้ · การเทียบครั้งที่สองเกิดเฉพาะเมื่อ normalize
แล้วค่าเปลี่ยนจริง ซึ่งไม่เคยเกิดกับ ASCII

**UTF-8 ตลอดทาง** `fetch` เข้ารหัส body เป็น UTF-8 อยู่แล้ว JSON เป็น UTF-8 ตาม
นิยาม (RFC 8259) และ `req.text()` ถอดเป็น UTF-8 เมื่อไม่มี charset กำกับ — ทั้งสาม
ข้อเป็น *ค่าเริ่มต้น* `lib/api.js` จึงส่ง `application/json; charset=utf-8` ออกไป
ตรง ๆ ตั้งแต่ 2026-09-02 ไม่ได้แก้บั๊กอะไร แต่ทำให้ไม่ต้องเดา

> **ประวัติของค่านี้ — สามรุ่น**
>
> 1. `defaultPassword()` = `Primus@` + รหัสพนักงาน ถูกถอดออกเพราะทะเบียนถูกพิมพ์อยู่
>    บนใบ F-HR-027 ทุกใบและในทุกไฟล์ที่ส่งบัญชี รหัสผ่านของทุกบัญชีที่ยังไม่มีใคร
>    ล็อกอินจึงเป็นข้อมูลสาธารณะ — และที่แย่กว่านั้นคือมันถูกคำนวณใน*เบราว์เซอร์*
>    โดยกล่อง ตั้งรหัสใหม่ ซึ่ง PATCH อะไรก็ตามที่ค้างอยู่ในช่องนั้นขึ้นไป
> 2. `generateTempPassword()` ใน `lib/tempPassword.js` — `node:crypto` บนเซิร์ฟเวอร์
>    หน้าตาแบบ `gof-mez-tab-4827` อ่านออกเสียงได้ ตัวพิมพ์เล็กทั้งหมด ไม่มี
>    `0 1 l i O` เลย **แสดงครั้งเดียว** ปิดแล้วดูซ้ำไม่ได้
> 3. รหัสพนักงาน (2026-09-02, ปัจจุบัน) เพราะรุ่นที่สองต้องอ่านทางโทรศัพท์ พิมพ์ผิด
>    บ่อย และบนทะเบียนที่คนส่วนใหญ่ไม่มีอีเมล มันหายไปเลยเมื่อกล่องถูกปิดเร็วไปหนึ่ง
>    จังหวะ **ราคาที่จ่ายคือข้อ 1 กลับมา** และสิ่งที่กันไว้คือ `mustChangePassword`
>    — ซึ่งตั้งแต่ 2026-09-04 เหลือเป็น *แถบเตือน* ไม่ใช่หน้าคั่นที่ปิดทางอยู่ ดูข้างบน
>
> `generateTempPassword()` **ยังอยู่และยังมีผู้เรียกหนึ่งราย** คือ
> `npm run reset-admin` เท่านั้น บัญชี ADMIN คือทางกู้ของทุกบัญชีอื่น จึงมีรหัสผ่านที่
> อ่านออกจากทะเบียนไม่ได้ — และรหัสพนักงานคือสิ่งที่พิมพ์ที่หน้าล็อกอินอยู่แล้ว

**รุ่นที่ 3 ไม่ได้ย้อนไปแก้แถวที่มีอยู่ก่อนหน้า และนั่นคือรอยต่อที่มองไม่เห็นจากหน้าจอ**
`91612a9` ลงเมื่อ **2026-09-02 14:36** แถวที่เขียนก่อนเวลานั้นยังถือรหัสสุ่มของรุ่นที่ 2
ซึ่งถูกแสดงบนจอครั้งเดียวและไม่ได้เก็บไว้ที่ไหนเลย อาการที่ ฝ่ายบุคคล เห็นคือ *บัญชีใหม่
บางใบล็อกอินด้วยรหัสพนักงานได้ บางใบไม่ได้* โดยไม่มีอะไรบนทะเบียนบอกว่าใบไหนเป็นใบไหน
· ตัวอย่างที่ชัดที่สุดคือสองแถวจาก CSV **ไฟล์เดียวกัน** `PM00416` กับ `THT0079` ถูก
นำเข้าห่างกัน 0.1 วินาทีเมื่อ 2026-09-02 เวลา 13:21 — ก่อน commit นั้น 75 นาที — ได้รหัส
สุ่มทั้งคู่ ใบแรกใช้ได้วันนี้เพราะมีคนกด รีเซ็ตรหัสผ่าน ให้ทีหลังเท่านั้น

**`npm run migrate:first-password`** (`src/migrate-first-password.js`) คือการซ่อมรอยต่อนั้น
ไม่ใส่ `--yes` = ดูอย่างเดียว · `--dry` ก็ได้ · มันแตะแถวที่เข้าเงื่อนไข **ทั้งสองข้อ**
เท่านั้น: `mustChangePassword` ยังเป็น true (ยังไม่เคยมีใครตั้งรหัสของตัวเอง — ธงนี้ถูก
ล้างโดย `POST /api/employees/me/password` ทางเดียว ซึ่งขอรหัสผ่าน*ปัจจุบัน*) **และ**
hash ที่เก็บอยู่ยังไม่รับ `defaultPassword(code)` · เงื่อนไขข้อแรกคือเหตุผลที่สคริปต์นี้
**ไม่ใช่รูรั่วของข้อห้ามที่ `npm run reset-admin` เขียนไว้ว่า “สคริปต์ที่รีเซ็ตใครก็ได้
เท่ากับเปลี่ยน ‘มี shell บนเครื่องนี้’ ให้เป็น ‘เป็นพนักงานคนไหนก็ได้’”** — สิ่งที่เหลือ
หลังกรองคือบัญชีที่**ไม่มีใครในโลกล็อกอินเข้าได้** จึงไม่มีการยึดสิทธิ์ของใคร · แถวที่
`npm run seed` เขียนไม่เข้าเงื่อนไขข้อแรก (seed ไม่เคยตั้งธงนี้) จึงถูกข้ามไปทั้งหมด
รวมทั้ง `ADMIN` — การเปลี่ยนรหัสผ่านของบัญชีกู้ระบบให้เป็นสตริง `ADMIN` ไม่ใช่สิ่งที่
migration ตัดสินใจเองได้

### ไม่มีใครล็อกตัวเองออกจากระบบได้

พื้นสามข้อ ทุกข้อถูกปฏิเสธที่ route บนเซิร์ฟเวอร์ทั้งสองตัว และถูกทำให้จางพร้อม
เหตุผลในกล่องแก้ไข (`test/lockout.test.js`):

- **บทบาท และ สถานะการใช้งาน บนแถวของตัวเอง** (`selfEditPermission`) ทั้งสองอย่าง
  ห่างจากบัญชีที่เข้าไม่ถึงหน้าจอที่จะใช้ย้อนการบันทึกนั้น อยู่แค่การกดบันทึกครั้งเดียว
  ฟิลด์อื่นทุกฟิลด์บนแถวของตัวเองเป็นเรื่องปกติ
- **รีเซ็ตรหัสผ่าน บนแถวของตัวเอง** (`selfEditPermission` เพิ่มเมื่อ 2026-08-24)
  ถูกปฏิเสธด้วยเหตุผลคนละอย่างกับสองข้อบน — ไม่ใช่เพราะ*คุณ*ย้อนคืนไม่ได้ แต่เพราะ
  คนอื่นอาจเป็นคนกด การรีเซ็ตจาก ทะเบียนพนักงาน ไม่ถามรหัสผ่านปัจจุบัน เครื่องที่
  ปล่อยทิ้งไว้โดยยังล็อกอินเป็น ฝ่ายบุคคล จึงห่างจากการที่คนแปลกหน้าถือรหัสที่ใช้ได้
  จริงอยู่แค่ปุ่มเดียว โดยเจ้าของตัวจริงถูกล็อกออกและแยกไม่ออกว่าต่างจากการลืมรหัส
  ตรงไหน · **ข้อนี้หนักขึ้นตั้งแต่ 2026-09-02 ไม่ใช่เบาลง** ย่อหน้านี้เคยอธิบายว่า
  หน้าจอ “พิมพ์รหัสใหม่ออกมาตรงนั้นเลย” ตอนนี้ไม่ต้องพิมพ์ด้วยซ้ำ — ค่าใหม่คือรหัส
  พนักงานซึ่งอยู่บนแถวเดียวกันนั้นเอง คนที่เดินผ่านโต๊ะจึงไม่ต้องอ่านอะไรจากหน้าจอเลย
  · หน้าโปรไฟล์ ทำงานเดียวกันและถามรหัสผ่านปัจจุบันก่อน
  **ผู้ดูแลระบบ ไม่ได้รับการยกเว้น** — ดู `npm run reset-admin` ข้างล่าง
  ซึ่งเป็นสิ่งที่ทำให้กฎแบบไม่มีข้อยกเว้นข้อนี้ปลอดภัย
  · ปุ่มนี้อยู่สองที่ตั้งแต่ 2026-09-02 — ในตารางทะเบียนพนักงาน และใน แก้ไข →
  สิทธิ์และสถานะ — ทั้งสองปุ่มปฏิเสธด้วยกฎเดียวกันและเปิดกล่องเดียวกัน
- **ผู้ดูแลระบบ คนสุดท้ายที่ยังใช้งานอยู่** (`lastAdminPermission`) จะถูกลดบทบาท
  หรือปิดใช้งานโดยใครไม่ได้เลย ฝ่ายบุคคล สร้าง Admin ขึ้นมาไม่ได้
  (`HR_ASSIGNABLE_ROLES`) ระบบที่ไม่มี Admin ที่ใช้งานอยู่เลยจึงไม่มีทางสร้างขึ้นมา
  คืน — การซ่อมจะต้องเปิดคอนโซลฐานข้อมูล ตอบ 409 ไม่ใช่ 403: ผู้กระทำมีสิทธิ์
  สิ่งที่ปฏิเสธคือสถานะของระบบ

---

## ใครทำอะไรได้ — ฝ่ายบุคคล กับ ผู้ดูแลระบบ

**กฎที่ใช้แบ่ง:** ฝ่ายบุคคล ต้องทำงานประจำวันจนจบได้เองโดยไม่ต้องขออนุญาตใคร
ส่วน ผู้ดูแลระบบ เก็บไว้สองอย่างที่แก้คืนยาก — เรื่องที่**ขยับตัวเลขที่มีคนเซ็นรับ
ไปแล้ว** และเรื่องที่**ไม่มีทางย้อนกลับ**ถ้าพลาด

ทุกข้อข้างล่างนี้บังคับ**ที่ route** หน้าจอจะทำปุ่มที่กดไม่ได้ให้จาง ๆ ไว้ แต่นั่น
เป็นเพียงมารยาท — มันช่วยไม่ให้ใครพิมพ์สิ่งที่กำลังจะถูกปฏิเสธ และทำให้การปฏิเสธ
ออกมาเป็นประโยคแทนที่จะเป็น 403 เฉย ๆ `test/permissionRouteGuards.test.js` ตรึงไว้
ว่าทุกกฎในหน้านี้อยู่ที่ฝั่งเซิร์ฟเวอร์ และไม่มีปุ่มไหนถูกยื่นให้คนที่เซิร์ฟเวอร์
จะปฏิเสธ

### เจ็ดบทบาท — และคำว่า `manager` ที่ถูกปลดระวาง

บทบาทเพิ่มจากสี่เป็นเจ็ดเมื่อ **2026-09-03** รายชื่อกับชื่อภาษาไทยอยู่ที่
`lib/roles.js` **ที่เดียว** — ก่อนหน้านั้นถูกเขียนไว้สามที่ที่ต้องตรงกันเอง
(enum ของโมเดล · `ROLE_OPTIONS` บน ทะเบียนพนักงาน · `ROLE_LABEL` ในรายงาน
การใช้สิทธิ์พิเศษ) และที่ที่มักถูกลืมคือชื่อภาษาไทย จอจึงโชว์คีย์ดิบให้คนที่มัน
เป็นตำแหน่งของเขาเอง

เรียงจากล่างขึ้นบน — และ**ลำดับนี้มีผล** เพราะ `outranks` อ่านคำตอบจาก index
ของ `ROLES`:

| คีย์ที่เก็บ | ชื่อไทย | หมายเหตุ |
|---|---|---|
| `employee` | พนักงาน | |
| `supervisor` | หัวหน้างาน | เดิมเก็บว่า `manager` |
| `finance` | การเงิน | **เทียบเท่าหัวหน้างาน ไม่ได้อยู่เหนือ** — คนละแผนกกัน และเซ็นให้กันไม่ได้ · เซ็นให้แผนกเดียว แต่**อ่าน**รายงานทั้งบริษัท ([ดูด้านล่าง](#การเงิน--เซ็นแผนกเดียว-อ่านทั้งบริษัท-แก้ไม่ได้)) |
| `dept_manager` | ผู้จัดการแผนก | |
| `division_manager` | ผู้จัดการฝ่าย | |
| `hr` | ฝ่ายบุคคล | |
| `admin` | ผู้ดูแลระบบ | |

**`manager` ถูกปลดระวาง ไม่ใช่เอามาใช้ต่อ** ของเดิมแปลว่า *หัวหน้างาน* —
คอมเมนต์ทุกบรรทัดในรีโปที่เขียนก่อนวันนั้นเขียนว่า หัวหน้า ตรงที่โค้ดเขียนว่า
`manager` และตารางชื่อไทยทั้งสองชุดก็แปลว่า "หัวหน้างาน" เจ็ดบทบาทใหม่มี
*ผู้จัดการแผนก* จริง ๆ อยู่เหนือหัวหน้างานหนึ่งขั้น ถ้าเก็บสตริงเดิมไว้แล้วให้
ความหมายใหม่ ทุกการเปรียบเทียบที่เขียนไว้แล้วจะยัง compile ผ่านและเริ่มตอบคนละ
คำถาม — จึงเปลี่ยนชื่อทิ้ง เพื่อให้ที่ที่ตกหล่นกลายเป็น "ไม่ตรงกับใครเลย" ซึ่ง
เห็นทันที แทนที่จะเป็น "ยกคิวของหัวหน้างานให้ผู้จัดการแผนกเงียบ ๆ"
`test/roles.test.js` ห้ามสตริงนั้นกลับเข้ามาใน `app/` `lib/` `src/`
`components/` และ `legacy/`

**ที่เดียวที่คำเดิมยังอยู่คือ `hrRejectReturnsTo: 'manager'`** ซึ่งเป็น*ค่าของ
policy* ที่ชี้ไปที่**ขั้น** `pending_mgr` ไม่ใช่บทบาท ขั้นแรกยังชื่อ mgr อยู่
ไม่ว่าใครจะถือ และค่านี้ถูกเก็บใน `Setting.policy` บนฐานข้อมูลจริงไปแล้ว
เปลี่ยนชื่อจึงต้องมี migration ของตัวเองโดยไม่ได้อะไรกลับมา — `Department.manager`
ก็เป็น *ฟิลด์* ไม่ใช่บทบาทเช่นกัน

**แถวที่เก็บ `manager` ไว้ย้ายด้วย `npm run migrate:roles`** (`--dry` เพื่อดู
อย่างเดียว, `--yes` เพื่อยืนยัน) รันบนฐานข้อมูลนี้แล้วเมื่อ 2026-09-03 — ห้าแถว
กลายเป็น `supervisor` · สคริปต์แตะ `Employee.role` อย่างเดียว **ไม่แตะ**
`OtEntry.history[].action` (`approve_mgr` บอก*ขั้น*ที่เซ็น ไม่ใช่บทบาทของคนเซ็น)
`OtEntry.status` หรือแถว `EmployeeAudit` — ร่องรอยที่ถูกเขียนใหม่ให้ตรงกับวันนี้
ไม่ใช่ร่องรอย

**และกฎข้อนั้นมีคู่ตรงข้ามของมัน: `npm run refresh:signature-names`** (2026-09-07)
ซึ่งเขียนทับ `OtEntry.history[].byName` โดยตั้งใจ ต่างกันตรงว่าแตะครึ่งไหนของแถว
· `by` คือ**ตัวตน** เป็น id บอกว่าใครกด และสคริปต์ไม่เขียนลงไปเลย ใช้แค่อ่านว่า
ชื่อไหนเป็นของแถวนั้น · สิ่งที่เปลี่ยนคือ**การสะกดชื่อของบัญชีเดิมนั้น** แถวยัง
บอกว่า `HR-001` อนุมัติใบนี้เมื่อนาทีนั้น เพียงแต่เริ่มสะกด `HR-001` แบบที่ทะเบียน
สะกดวันนี้ · **ที่ต้องมีเพราะ `byName` เป็นสำเนา** เขียนตอนกดปุ่ม (`byName:
actor?.name` ใน `OtEntry.log`) เพื่อให้คนที่ลาออกไปแล้วยังมีชื่อติดอยู่กับสิ่งที่
เคยเซ็น — ซึ่งดีทุกอย่างยกเว้นตอนที่**บัญชีถูกเปลี่ยนชื่อ** `HR-001` ถูกเปลี่ยนจาก
`ฝ่ายบุคคล` เป็น `ยิ่งยง` เมื่อ 2026-09-07 01:40 และ F-HR-027 ก็พิมพ์ผลลัพธ์ออกมา
ตรง ๆ: ช่องลงชื่อพนักงานอ่านทะเบียนสดได้ `ยิ่งยง` ช่องลงชื่อหัวหน้างานอ่านสำเนา
ได้ `ฝ่ายบุคคล` บนแถวเดียวกัน เรื่องคนคนเดียว · **รันบนฐานข้อมูลนี้แล้ว — 116 แถว**
(`approve_hr` 41 · `recompute` 73 · `submit_hr_verified` 1 · `submit` 1) ไม่มีบัญชี
อื่นเข้าเงื่อนไข · **แถวร่องรอยที่บันทึกการเปลี่ยนชื่อเอง (`EmployeeAudit.changes[].from`
= `ฝ่ายบุคคล`) ไม่ถูกแตะ** — สคริปต์ที่ลบหลักฐานว่าทำไมตัวเองต้องมีอยู่ ก็คือ
สคริปต์ที่ไม่ควรมีอยู่ · เอกสารอื่นที่เก็บสำเนาชื่อไว้เหมือนกัน (`otAccessLogs`
`otPolicyReplayRuns` `otPolicyVersions` `ApprovalDelegation`) **ไม่ถูกแตะ และสคริปต์
พิมพ์จำนวนแถวออกมาทุกครั้ง** เพื่อให้คำถาม "ทำไม log ยังเรียกชื่อเดิม" มีคำตอบก่อน
ที่ใครจะต้องไปตามหา

### ใบของใคร ไปหาใครเซ็น — the routing matrix

**ทุกบทบาทยื่น OT ของตัวเองได้ ตั้งแต่ 2026-09-03** และนั่นคือการกลับข้อ §2 ซึ่ง
เคยห้ามหัวหน้างานยื่น เพื่อไม่ให้เกิดคำถามว่า "แล้วใครอนุมัติหัวหน้า" · โครงเจ็ด
บทบาทตอบคำถามนั้นตรง ๆ แทนที่จะเลี่ยงมัน กฎอยู่ที่ `APPROVED_BY` ใน
`lib/roles.js` ที่เดียว:

| ผู้ยื่น | ขั้นที่ 1 (เรียงตามลำดับที่เลือกก่อน) | ขั้นที่ 2 |
|---|---|---|
| พนักงาน | หัวหน้างาน → การเงิน → ผู้จัดการแผนก → ผู้จัดการฝ่าย | ฝ่ายบุคคล |
| หัวหน้างาน | ผู้จัดการแผนก → ผู้จัดการฝ่าย | ฝ่ายบุคคล |
| ผู้จัดการแผนก | ผู้จัดการฝ่าย | ฝ่ายบุคคล |
| การเงิน · ผู้จัดการฝ่าย · ฝ่ายบุคคล · ผู้ดูแลระบบ | **ไม่มีขั้นที่ 1** | ฝ่ายบุคคล |

**ทำไมช่องแรกถึงมีมากกว่าหนึ่งตำแหน่ง** กฎที่ฝ่ายบุคคลให้มาเป็นแบบขึ้นทีละขั้น
— พนักงาน → หัวหน้างาน, หัวหน้างาน → ผู้จัดการแผนก · แต่วางบนทะเบียนจริงแล้ว
**13 จาก 18 แผนกไม่มีหัวหน้างานเลย** ซึ่งคือ 97 จาก 143 พนักงาน · แผนกผลิต1 มี
25 คนและคนที่ตาราง หน่วยงาน ระบุให้เซ็นคือ*ผู้จัดการแผนก* · สาขาทั้งสี่เซ็นโดย
ผู้จัดการสาขา · ส่วน แผนกจัดซื้อ กับ แผนกทรัพยากรมนุษย์ เขียน "HR" ไว้ในช่อง
หัวหน้างาน ตรง ๆ · ใบจึงไปหาขั้นแรกที่**มีคนถืออยู่จริง** และถ้าไม่มีใครเลยก็ไป
ที่ฝ่ายบุคคลทันที แทนที่จะค้างอยู่ที่ขั้นที่ไม่มีใครเซ็นได้ตลอดไป — ซึ่งเป็นสิ่งที่
เกิดกับแผนก ADM มาตลอด และปิดไปพร้อมกับรอบนี้

**สองแผนกที่ฝ่ายบุคคลเป็นหัวหน้างานนั้น เป็นกฎแล้ว ไม่ใช่ผลข้างเคียง**
(2026-09-07 ยืนยันมาว่า *"แผนกทรัพยากรมนุษย์ และ แผนกจัดซื้อ หัวหน้างานหรือคน
ที่อนุมัติจะเป็น HR"*) · ก่อนหน้านี้ทั้งสองแผนกไปที่ฝ่ายบุคคลอยู่แล้ว แต่ไป
เพราะ*ทะเบียนว่าง* — ไม่มีใครถือบทบาทเซ็นขั้นแรกในแผนกนั้น ซึ่งเป็นเรื่องของ
ใครบังเอิญเป็นพนักงานอยู่ ไม่ใช่เรื่องที่ใครตัดสินใจ · ตั้ง `ผู้จัดการแผนกจัดซื้อ`
ขึ้นมาวันไหน ใบของแผนกจัดซื้อจะย้ายไปรอลายเซ็นคนนั้นเงียบ ๆ ทันที · ตอนนี้เก็บ
เป็นฟิลด์ `signedByHr` บนตัวแผนก (`src/models/Department.js`) และ
`hrHeadsDepartment` ใน `lib/roles.js` เป็นตัวอ่าน — **อยู่เหนือทะเบียน** คือ
ถามก่อนจะไปดูว่ามีใครเซ็นได้บ้าง · แก้ได้ที่ ตั้งค่าระบบ → แผนกและเพดาน →
แก้ไข → **การอนุมัติ · ใครเซ็นขั้นที่ 1** และเขียนลงฐานที่มีอยู่แล้วด้วย
`npm run migrate:hr-headed`

**ผลที่เห็นทันทีคือคำเตือนที่หายไป** จอ ตั้งค่าระบบ เคยติด ⚠ ยังไม่มีหัวหน้า ให้
ทั้งสองแผนก และนับ 4 คนเป็น "ไม่มีใครเซ็นให้" (`unsignedStaff`) พร้อมปุ่ม
แก้ไขสิทธิ์พนักงาน ↗ ข้าง ๆ — เป็นการเตือนเรื่องที่ถูกต้องอยู่แล้ว และชี้ไปที่หน้า
ที่ "วิธีแก้" คือตั้งหัวหน้าที่ฝ่ายบุคคลไม่ได้อยากให้มี · ตอนนี้ช่องหัวหน้างานของ
สองแถวนั้นอ่านว่า **ฝ่ายบุคคล** ไม่ใช่ช่องว่างที่มีคำเตือน · ใบที่ยื่นไปแล้วไม่
ย้ายตาม — สถานะถูกตัดสินตอนยื่นและอยู่ขั้นเดิม (บนฐานนี้ไม่มีใบจากสองแผนกนี้
เลยสักใบ อ่านเมื่อ 2026-09-07)

#### ใครเห็นใบของใคร — กว้างกว่าใครเซ็นใบของใคร

**เซ็นคือขั้นเดียว เห็นคือทุกขั้นที่อยู่ใต้ลงไป** ฝ่ายบุคคลให้กฎนี้มาเมื่อ
2026-09-03: *"ยิ่งเป็นตำแหน่งที่สูงก็จะเห็นใบยื่นขอระดับที่อยู่ใต้บังคับบัญชา"*
· ผู้จัดการฝ่ายอ่านใบของผู้จัดการแผนก ของหัวหน้างาน และของพนักงาน ทั้งที่เซ็น
ให้เฉพาะผู้จัดการแผนก

    ผู้ดูแลระบบ  — ทุกอย่าง
    ฝ่ายบุคคล  ▸  ผู้จัดการฝ่าย  ▸  ผู้จัดการแผนก  ▸  หัวหน้างาน  ▸  พนักงาน
    ฝ่ายบุคคล  ▸  การเงิน  ▸  พนักงาน

**สองสาย และมองข้ามสายกันไม่ได้** การเงินห้อยอยู่ใต้ฝ่ายบุคคลโดยตรง มีพนักงาน
อยู่ใต้และไม่มีอะไรอีก — ผู้จัดการฝ่ายจึงไม่เห็นใบของการเงิน และการเงินไม่เห็น
ใบของหัวหน้างาน

**คำนวณจาก `APPROVED_BY` ไม่ได้เขียนตารางที่สอง** เดินขึ้นจากผู้ยื่นว่าใครเซ็น
ให้เขา แล้วใครเซ็นให้คนเหล่านั้น — ได้แผนภาพข้างบนพอดี และทำให้ตารางอนุมัติกับ
ตารางการมองเห็นแยกกันไม่ได้ · `visibleRolesFor` คือกฎ ส่วน
`visibleEmployeeClause` คือการอ่านฐานข้อมูลที่กฎนั้นต้องใช้ เพราะใบเก็บแค่
reference ของเจ้าของ ไม่ได้เก็บบทบาทไว้บนใบ

**ใบของตัวเองเห็นเสมอ** ไม่มีใครต่ำกว่าฝ่ายบุคคลที่อ่านใบของบทบาทเดียวกับตัวเอง
(หัวหน้างานสี่คนในแผนกผลิต2 ไม่เห็นใบของกันและกัน) แต่ความเป็นเจ้าของมาจาก*ตัวคน*
ไม่ใช่จากบทบาท

**ขอบเขตแผนกกับบริษัทยังใช้ควบคู่กัน** กฎนี้บอกว่า*บทบาทไหน* ส่วน
`approvalDepartments` กับ `approvesCompany` บอกว่า*คนไหน* — หัวหน้างานอ่านใบของ
พนักงานในแผนกที่ตนถือ ไม่ใช่ของพนักงานทั้งบริษัท

**คนที่อ่านได้รุ่นเดียวไม่มีดรอปดาวน์ให้เลือก** หัวหน้างานอ่านใบของพนักงาน
อย่างเดียว ตัวกรอง **บทบาท** บนคิวจึงไม่ถูกวาดให้เขาเลย — เปิดมาก็มีแต่
ทุกบทบาท กับรุ่นเดียวใต้มัน ซึ่งเป็นตัวควบคุมที่เปลี่ยนอะไรบนจอไม่ได้
· ฝ่ายบุคคลขอไว้ 2026-09-04 · **วัดจากสิทธิ์ ไม่ใช่จากแถวที่ถืออยู่**
(`seesRoles` บน session เหมือนที่ `coversDepartments` ทำกับตัวกรองแผนก) ด้วย
เหตุผลสองข้อ: ใบของหัวหน้าเองก็นั่งอยู่ในคิวเขาและเป็นแถวบทบาท `supervisor`
ถ้านับจากแถวดรอปดาวน์จะโผล่ขึ้นมาเสนอรุ่นที่เขาเซ็นไม่ได้อยู่ดี · และมันจะโผล่ ๆ
หาย ๆ ตามการเซ็น ทำให้แถบตัวกรองขยับขณะกำลังใช้อยู่

**`?employee=` แคบลงได้ ขยายไม่ได้** ตัวกรองนี้เขียนคีย์เดียวกัน กฎการมองเห็น
จึงถูกใส่เป็น `$and` ไม่ใช่ `q.employee` — ไม่งั้นตัวที่เขียนทีหลังชนะ และคนที่
ขอดูใบของคนเหนือตัวเองก็จะได้มันไป

**การเงิน กับ หัวหน้างาน เป็นเพื่อนร่วมขั้น** อยู่คนละแผนกที่ความสูงเดียวกัน และ
เซ็นให้กันไม่ได้ — `outranks` รู้ข้อนี้ ส่วน `RANK` ให้เลขต่างกันเพราะมันเป็น
index ของ array

### การเงิน — เซ็นแผนกเดียว อ่านทั้งบริษัท แก้ไม่ได้

ขอมาเมื่อ **2026-09-03** สองรอบ · รอบแรก: บัญชีการเงินต้องมี *บันทึกและประวัติ OT*
กับ *พิมพ์ใบขออนุมัติ OT ของตัวเอง* · *รออนุมัติ OT ของพนักงานในแผนก* เหมือนผู้ที่
ได้สิทธิ์อนุมัติ · "แต่จะเห็นเมนู **ตรวจสอบประจำเดือน** และ **รายงาน OT ฝ่ายบัญชี**
แต่ไม่สามารถแก้ไขข้อมูลได้" · รอบที่สอง: *"เพิ่มรายงาน OT ประจำทีม ให้กับบทบาท
บัญชีด้วย"*

**สองข้อนี้ดึงกันคนละทาง และนั่นคือเหตุผลที่มันเป็นคนละคำถามในโค้ด**

| คำถาม | ตอบที่ | การเงินได้อะไร |
|---|---|---|
| ใครเซ็นขั้นแรกของแผนกไหน | `SIGNER_ROLES` · `scopeFor` | **แผนกบัญชีและการเงินแผนกเดียว** เหมือนหัวหน้างานหนึ่งคน |
| ใครอ่านเดือนของทั้งบริษัท | `COMPANY_REPORT_ROLES` · `readsOwnTeamOnly` | **ทุกแผนก ทั้งสองบริษัท** เท่ากับที่ฝ่ายบุคคลเห็น |
| จอนี้กำลังขอเดือนแบบไหน | `teamScoped` (`?scope=team`) | **ทั้งสองแบบ** — คนละแท็บ |
| ใครแก้ใบที่ยื่นแล้วได้ | `mayCorrectEntries` · `editPermission` | **ไม่ได้เลย** — ฝ่ายบุคคลกับผู้ดูแลระบบเท่านั้น |

ก่อนหน้านี้สองคำถามแรกมีคำตอบเดียวกัน (`isSigner`) เพราะยังไม่มีบทบาทไหนที่เซ็น
แผนกเดียวแต่อ่านทั้งบริษัท ถ้าปล่อยไว้ การเงินจะได้ *ตรวจสอบประจำเดือน* แผนกเดียว
ข้าง ๆ *รายงาน OT ฝ่ายบัญชี* ที่ครบทุกแผนก — เดือนเดียวกัน สองจอ คนละยอด และไม่มี
อะไรบนจอทั้งสองที่อธิบายได้ว่าทำไม · **สี่ที่ที่เคยเขียน `isSigner(user.role)`
ตอนนี้ถาม `readsOwnTeamOnly` หรือ `teamScoped`** — `reports/monthly` ·
`exports/monthly.csv` · `exports/entries.csv` (สามตัวนี้ผ่าน `teamScoped`) และ
`reports/form` · ตกหล่นที่ใดที่หนึ่งคือตารางที่กดปุ่มพิมพ์แล้วได้ 403 ทุกแถว
ยกเว้นแผนกตัวเอง

#### เดือนเดียวกัน สองความกว้าง สองคีย์ — `team` กับ `monthly`

รอบที่สองบังคับให้แยก · *รายงาน OT ประจำทีม* กับ *ตรวจสอบประจำเดือน* เคยเป็นคีย์
`monthly` **ตัวเดียวกัน** — จอเดียว (`HrView`) ที่เซิร์ฟเวอร์ตัดสินขอบเขตจาก*บทบาท*
ของคนเปิด และหัวข้อหน้าถูกสลับด้วยตาราง `PAGE_BY_ROLE` ที่คีย์ด้วยบทบาทเช่นกัน ·
ใช้ได้ตราบใดที่ไม่มีบทบาทไหนต้องการทั้งสองการอ่าน และการเงินต้องการทั้งสอง:
ทั้งบริษัทเพื่อกระทบยอดกับ *รายงาน OT ฝ่ายบัญชี* และแผนกตัวเองเพราะเป็นคนเซ็น
ลายเซ็นแรกของมัน · **คีย์เดียวเป็นสองปุ่มในบาร์เดียวไม่ได้** สิ่งที่จอกำลังขอจึง
กลายเป็น*คีย์* แทนที่จะเป็นผลพลอยได้จากว่าใครถืออยู่

**และนั่นก็ปลดระวาง `PAGE_BY_ROLE` ไปด้วย** ซึ่งเป็นครึ่งที่ดีกว่าของรอบนี้ ·
ตารางหัวข้อที่คีย์ด้วยบทบาท**เคยพังเงียบ ๆ มาแล้วครั้งหนึ่ง**: มันเขียนว่า
`manager:` หลังจากคำนั้นเลิกเป็นบทบาทในเช้าวันเดียวกัน ตารางจึงไม่ตรงกับใครเลย —
ผู้เซ็นทุกคนกดแท็บ *รายงาน OT ประจำทีม* แล้วไปเจอหน้าที่พาดหัวว่า
*ตรวจสอบประจำเดือน* ซึ่งคือความผิดพลาดที่ตารางนั้นถูกเพิ่มเข้ามาเพื่อแก้พอดี ·
lookup ที่ไม่เจออะไรกับบทบาทที่ไม่มี override หน้าตาเหมือนกันทุกประการ จึงไม่มี
อะไรพัง ไม่มีอะไรบอก · ตอนนี้หัวข้อเป็นสมบัติของ**จอ** เขียนไว้ใน `PAGE`
ที่เดียวเหมือนจออื่นทุกจอ

**`?scope=team` แคบลงได้อย่างเดียว ไม่มีทางกว้างขึ้น** — `teamScoped` ใน
`lib/reports.js` ที่เดียว อ่านสองอย่าง: *บทบาท*บอกว่าคนนี้อ่านได้กว้างแค่ไหน
(`readsOwnTeamOnly`) และ*คำขอ*บอกว่าจอกำลังขอแบบไหน · หัวหน้างานส่ง
`scope=team` มาก็ได้สิ่งที่ได้อยู่แล้ว · ฝ่ายบุคคลส่งมาก็ยังได้ทั้งบริษัท เพราะ
`isSigner` เป็นเท็จสำหรับพวกเขา — ไม่ได้เซ็นแผนกไหน "แผนกของฉัน" จึงไม่มีความหมาย ·
บทบาทเดียวที่มันขยับคือการเงิน · แท็บค้าง URL ที่พิมพ์เอง หรือไคลเอนต์ที่ลืม
พารามิเตอร์ จึงทำให้รายงานไหนกว้างกว่าที่บทบาทอนุญาตไม่ได้ ซึ่งเป็นทิศทางที่สำคัญ

**ปุ่มส่งออกทั้งสองใบพก `scope` ไปด้วย** คำสัญญาข้อเดียวของปุ่มส่งออกคือมันคือ
ตารางที่มันนั่งอยู่ใต้ — ถ้าไม่พกไป การเงินที่ยืนอยู่บน *รายงาน OT ประจำทีม* จะ
โหลดไฟล์ของทั้งบริษัทลงมาจากตารางที่แสดงแผนกเดียว

**`approvesCompany` กลับมาทำงานบนแท็บทีม และถูกแล้ว** ฟิลด์นั้นบอกว่าลายเซ็นของ
คนนี้ครอบพนักงานครึ่งไหนของแผนก · บนแท็บกว้างมันถูกข้าม (อ่านทั้งบริษัทอยู่แล้ว)
บนแท็บทีมมันคือคำจำกัดความของคำว่าทีมพอดี · ทั้งสองอ่านค่าจาก `teamOnly` ตัว
เดียวกัน จึงตั้งค่าขัดกันเองไม่ได้

**`scope=report` คือทางลงไปดูรายแถว** ตารางเดือนเปิดเข้า *รายการ OT ของคนคนนั้น*
กับ *ประวัติการแก้ไข* ได้ ซึ่งสองจอนั้นเรียก `GET /api/entries` — ที่ยังคิด scope
จากบทบาทตามเดิม ยอดที่เห็นบนตารางจึงเปิดเข้าไปเจอลิสต์ว่าง · scope ใหม่นี้เปิดให้
เฉพาะบทบาทที่ `readsCompanyReports` เป็นจริงอยู่แล้ว จึงให้สิทธิ์ใหม่กับใครไม่ได้
เลย และ**คิวไม่ถูกขยาย**: `scopeFor` ไม่รู้จัก `readsCompanyReports` ด้วยซ้ำ —
ถ้าขยายที่นั่น การเงินจะเห็นใบที่รออนุมัติของทั้งบริษัทพร้อมปุ่มสองปุ่มที่ตอบ 403

**"ไม่สามารถแก้ไขข้อมูลได้" บังคับที่ route มาตลอด** `editPermission` ปฏิเสธทุกคน
ที่ไม่ใช่ฝ่ายบุคคล/ผู้ดูแลระบบ หรือเจ้าของใบที่ยังไม่มีใครเซ็น · สิ่งที่เพิ่มคือ
**หน้าจอเลิกยื่นปุ่มที่จะโดนปฏิเสธ** — ปุ่มแรกของแต่ละแถวอ่านว่า "ดูรายการ" แทน
"ดู / แก้ไขรายการ" และในจอรายแถวไม่มีปุ่ม *แก้ไข* กับ *ถอนใบวันเกิด* เลย · ข้อนี้
เป็นจริงกับ**หัวหน้างาน ผู้จัดการแผนก ผู้จัดการฝ่าย ด้วย** ซึ่งเปิดจอเดียวกันได้
ตั้งแต่ 2026-09-03 และถูกยื่นปุ่มที่กดไม่ได้มาตลอดโดยไม่มีใครทัก

**ไม่มีใครเซ็นใบของตัวเอง — ยกเว้นฝ่ายบุคคล** (`applicant_id !== approver_id`
ใน `approvalPermission`) · ข้อนี้ไม่จำเป็นต้องเขียนไว้จนกระทั่งทุกบทบาทยื่นใบได้:
ก่อนหน้านั้นมีแต่ `role: 'employee'` ที่ยื่นได้ และพนักงานอนุมัติอะไรไม่ได้อยู่แล้ว
· ข้อยกเว้นของฝ่ายบุคคลเป็นการตัดสินของฝ่ายบุคคลเอง 2026-09-03 — บัญชีฝ่ายบุคคล
ใช้ร่วมกันทั้งแผนก "คนเดิมเซ็นสองครั้ง" จึงไม่ใช่สิ่งที่ระบบตรวจได้ที่นั่นอยู่แล้ว
· **ผู้ดูแลระบบ ไม่ได้รับข้อยกเว้นนี้** เป็นบัญชีเดียวที่ถือไว้ซ่อมระบบ ไม่ใช่
สายตาคู่ที่สอง

**บันทึกและประวัติ OT เป็นของคนคนเดียวเสมอ** ไม่ว่าบทบาทไหน — จอนี้ขอ
`?scope=mine` ซึ่งเป็น `{ employee: user._id }` และ**แทนที่**ตัวกรองแผนก ไม่ใช่
แคบลงจากมัน · ก่อนหน้านี้จอนี้ขอลิสต์เปล่า ๆ แล้วรับ scope ปกติของบทบาทนั้นมา
ซึ่งไม่เป็นปัญหาตราบใดที่มีแต่พนักงานที่ยื่นใบได้ — พอทุกบทบาทยื่นได้
หัวหน้างานเปิดจอนี้แล้วเห็นใบของทั้งทีมอยู่ใต้หัวข้อที่เขียนว่า *ของฉัน* พร้อม
ยอดชั่วโมงที่นับรวมทั้งทีม และแต่ละแถวเขียนว่า "รอการอนุมัติจาก: <ชื่อตัวเอง>"
· แจ้งมาจากหน้าจอจริง 2026-09-03

**และไม่มีใครถูกเสนอชื่อเป็นผู้เซ็นใบของตัวเอง** `GET /api/entries/approvers`
ตัดตัวผู้เรียกออก และถามตารางลำดับด้วย — แผนกผลิต2 มีหัวหน้างานสี่คนที่ไม่มีใคร
เซ็นให้กันได้ ถ้าไม่ตัดจะขึ้นชื่อสามคนที่กดไม่ได้

**คิวและตัวเลขบน badge ใช้กฎเดียวกัน** `signableHere` บนจอถาม
`maySignFirstStep` และ `pendingMgr` ใน `queue-summary` นับเฉพาะใบที่คนอ่าน
เซ็นได้จริง — แผนกผลิต2 มีหัวหน้างานสี่คนและทุกคนยื่นใบของตัวเองได้แล้ว ถ้าไม่มี
ข้อนี้ ทั้งสี่จะเห็นใบของกันและกันพร้อมปุ่มสองปุ่มที่ตอบ 403

### ตาราง

| | ฝ่ายบุคคล | ผู้ดูแลระบบ | กฎอยู่ที่ |
|---|---|---|---|
| **ทะเบียนพนักงาน** | | | |
| เพิ่ม / แก้ไขพนักงาน | ✅ | ✅ | `rosterPermission` |
| ตั้งบทบาท พนักงาน / หัวหน้างาน / การเงิน / ผู้จัดการแผนก / ผู้จัดการฝ่าย | ✅ | ✅ | `HR_ASSIGNABLE_ROLES` |
| ตั้งบทบาท ฝ่ายบุคคล / ผู้ดูแลระบบ | ❌ | ✅ | `HR_ASSIGNABLE_ROLES` |
| แก้ไขแถวที่เป็น ผู้ดูแลระบบ (รวมรีเซ็ตรหัสผ่าน) | ❌ | ✅ | `rosterPermission` |
| เปลี่ยนรหัสพนักงาน | ❌ | ✅ *(ต้องระบุเหตุผล)* | `codeChangePermission` |
| รีเซ็ตรหัสผ่านให้คนอื่น | ✅ | ✅ | `rosterPermission` |
| รีเซ็ตรหัสผ่านให้ **ตัวเอง** | ❌ | ❌ | `selfEditPermission` |
| นำเข้าพนักงานจาก CSV | ✅ | ✅ | `rosterPermission` ต่อแถว |
| **แผนก** | | | |
| เพิ่มแผนก | ✅ | ✅ | `departmentPermission` |
| แก้ชื่อ / รหัส / เพดาน / รูปแบบโอที | ✅ | ✅ | `departmentPermission` |
| ปิดใช้งานแผนก | ❌ | ✅ | `departmentPermission` |
| เปิดใช้งานแผนกคืน | ❌ | ✅ | `departmentPermission` |
| ลบแผนกถาวร — **เฉพาะแผนกที่ไม่มีอะไรอ้างถึง** | ❌ | ✅ | `departmentDeletePermission` + `departmentDeleteBlock` |
| **ตั้งค่าระบบอื่น ๆ** | | | |
| รหัสเอกสาร OT (`formCode`) | ✅ | ✅ | `PATCH /api/settings` |
| ชื่อบริษัท (ไทย/อังกฤษ) | ✅ | ✅ | `PATCH /api/settings` *(ไม่มีหน้าจอ — ช่องกรอกถูกตัดออก 2026-08-31 เพราะไม่มีที่ใดพิมพ์ค่านี้)* |
| นโยบายการคำนวณ | ✅ | ✅ | `PATCH /api/settings/policy` |
| วันหยุดบริษัท | ✅ | ✅ | `/api/holidays` |
| ผู้รับช่วงอนุมัติ | ✅ | ✅ | `/api/delegations` |
| **การอนุมัติ** | | | |
| เห็นใบทุกแผนก ทุกบริษัท | ✅ | ✅ | `scopeFor` — ทั้งคู่ได้ `{}` ไม่มีตัวกรอง |
| เซ็นขั้น HR ทุกแผนก ทุกบริษัท | ✅ | ✅ | `approvalPermission` — ไม่มีการกรองขอบเขต |
| เซ็นขั้นหัวหน้าในฐานะ **ผู้รับช่วง** | ✅ | ✅ | `DELEGATE_ROLES` |
| เซ็นขั้นหัวหน้า **แทนแผนกที่ไม่มีหัวหน้า** | ❌ | ✅ *(ต้องระบุเหตุผล)* | `mayOverrideManagerStep` |
| เซ็นทั้งสองขั้นของใบเดียวกัน | ❌ | ❌ | `signedManagerStep` — §6 |
| แก้ไขใบที่ยังไม่ปิด | ✅ | ✅ | `editPermission` |
| **งวดและตัวเลข** | | | |
| ดูสรุปสถานะงวด | ✅ | ✅ | `/api/periods/[period]` — ทุกคนที่ล็อกอินอ่านได้ |
| คำนวณใหม่ (ใบที่ยังไม่อนุมัติ) | ✅ | ✅ | `authorizeReplay` |
| คำนวณใหม่ **รวมใบที่อนุมัติแล้ว** | ❌ | ✅ *(ต้องระบุเหตุผล)* | `authorizeReplay` |
| ยกเว้นเพดานให้ใบหนึ่ง | ✅ | ✅ | `/api/entries/[id]/cap-override` *(ไม่มีหน้าจอ — ปุ่ม **อนุมัติเกินเพดาน** และกล่องของมันถูกถอดออก 2026-09-02 เราต์ยังอยู่และยังปฏิเสธเหตุผลว่าง)* |
| เซ็นใบที่เกินเพดาน **โดยไม่บอกเหตุผล** | ❌ | ❌ | `overCeilingRefusal` — หัวหน้าก็ไม่ได้ ทั้ง อนุมัติ และ ไม่อนุมัติ |
| **บันทึกประวัติระบบ** | ❌ | ✅ | `/api/logs`, `/api/logs/summary`, `/api/exports/logs.csv` |

**ตารางนี้มีสองคอลัมน์เพราะสองบทบาทนี้เท่านั้นที่*แก้*อะไรได้บ้าง** ตั้งแต่
2026-09-03 มีบทบาทที่สามที่*อ่าน*บางแถวได้: **การเงิน** เปิด ตรวจสอบประจำเดือน
และ รายงาน OT ฝ่ายบัญชี ได้ทั้งบริษัท (และ รายงาน OT ประจำทีม เฉพาะแผนกที่ตัวเอง
เซ็น) พร้อมทั้งไฟล์ CSV และใบ F-HR-027 ของทุกคนบนสองจอกว้างนั้น · ทุกแถวที่เขียนว่า
✅ ข้างบนนี้ยังเป็น ❌ สำหรับการเงินทั้งหมด รวมทั้ง `editPermission` — ดู
[การเงิน — เซ็นแผนกเดียว อ่านทั้งบริษัท
แก้ไม่ได้](#การเงิน--เซ็นแผนกเดียว-อ่านทั้งบริษัท-แก้ไม่ได้)

### ลบแผนก — the row that says ❌ ❌ *(ไม่มีในระบบ)* until 2026-09-02

The table above read **`| ลบแผนกถาวร | ❌ | ❌ *(ไม่มีในระบบ)* | — |`**, and
`test/permissionRouteGuards.test.js` held it there with a test called *"there is
no way to delete a department, in any handler"* that walked the whole route
folder looking for `export const DELETE`. The reason it gave is still true and
is still the thing being protected:

> `OtEntry.department` is a required reference, set when the request was filed —
> the แผนก is snapshotted onto the entry on purpose, so a mid-month transfer
> leaves the hours where they were worked. Delete the row and `groupByDepartment`
> collapses every entry that pointed at it into one unnamed `ไม่ระบุแผนก`
> bucket, permanently, shared with every other department ever deleted.

**The middle sentence stopped being true on 2026-09-08** — the reports read
สังกัดหลัก now, not the entry's copy, so a mid-month transfer moves the hours
with the person (see *แผนก and บริษัท are both read from the roster at report
time* below). The conclusion is untouched and is now reached by a shorter route:
a hard-deleted department leaves every ROSTER row that pointed at it with nothing
to resolve, the entry's copy resolves to nothing either, and `groupByDepartment`
collapses them into the same permanent `ไม่ระบุแผนก` bucket.

**What that paragraph could not say is that every word of it is about a row
something POINTS AT.** A department created with a typo in its code five minutes
ago, that no employee has ever belonged to and no entry has ever named, costs
none of it: deleting it changes no figure, empties no queue and renames nothing
in any report, because there is nothing on the other end of the reference to
rename. That was the one case the blanket refusal could not tell apart, and it
left every mistyped department on the screen for ever, switched off, in a list
of eight.

**So the refusal moved from the handler to the data.** `departmentDeleteBlock`
in `lib/departments.js` is the whole rule and it counts nothing itself — the
caller counts and it decides:

| | |
|---|---|
| **who** | ผู้ดูแลระบบ only (`departmentDeletePermission`) — the guard makes a wrong press cheap, but it is still irreversible, and a recreated row is a different `_id` |
| **what** | zero rows in `employees` naming it **and** zero in `otentries`, both **all-time** — not the `headcount` on the table, which counts ACTIVE employees and reads 0 for a department whose whole team was deactivated last year |
| **asked twice** | `GET /api/departments/:id` answers it for the screen before the button is offered; `DELETE` counts again before it acts, so a stale page or a `curl` cannot get past it |

**Pressing ลบแผนก opens a read, not a confirmation.** What comes back picks the
dialog: a department that is being held gets *"ไม่สามารถลบแผนกนี้ได้เนื่องจาก
มีข้อมูลประวัติในระบบ แนะนำให้เปลี่ยนสถานะเป็น 'ปิดใช้งาน' แทน"* with the two
counts printed under it and a button that **does** the ปิดใช้งาน; one that is
free gets the ordinary confirmation. The order is the point — *"are you sure?"*
followed by *"actually you cannot"* is a dialog apologising for its own
question, and it teaches people to press through confirmations.

`active: false` is still the removal this system reaches for first, and it is
still the only one available for a department with any history at all.

**บันทึกประวัติระบบ เป็นสิ่งเดียวที่เป็นแท็บทั้งแท็บ ไม่ใช่หัวข้อย่อย** และตั้งใจให้เป็น
อย่างนั้น: ทุกหัวข้อภายใน ตั้งค่าระบบ เข้าถึงได้ทั้งสองบทบาท หัวข้อที่โผล่ให้
บทบาทเดียวจึงเป็นกฎที่ไปอยู่สองไฟล์ ส่วนเหตุผลที่ ฝ่ายบุคคล ถูกกันออกคือ
`hr-account-is-shared` — ทั้งแผนกบุคคลใช้บัญชีเดียวกันเข้าระบบ บันทึกจราจรที่
พวกเขาเปิดดูเองได้จึงไม่ใช่หลักฐานเกี่ยวกับ "คน" คนใดคนหนึ่ง

### ผู้ดูแลระบบ เซ็นแทนหัวหน้าได้ — และยังเซ็นใบเดียวคนเดียวไม่ได้

กฎสองข้อที่มาพร้อมกันเมื่อ 2026-08-24 และเข้าใจได้ก็ต่อเมื่ออ่านคู่กัน

#### ใบที่ไม่มีใครเซ็นได้

**แผนกที่ไม่มีหัวหน้าอยู่ในทะเบียน จะมีใบที่ไม่มีใครเซ็นได้เลย** และ
ผู้รับช่วงอนุมัติ ก็ช่วยไม่ได้: `delegationPermission` บังคับว่าคนมอบต้องเป็น
หัวหน้า และในเมื่อไม่มีหัวหน้าก็ไม่มีใครมอบ ก่อนหน้านี้ใบ OT ที่ยื่นในแผนกแบบนั้น
ค้างอยู่ที่ รอหัวหน้า ตลอดไป โดยไม่มีทางออกที่ไหนในแอปเลย

ย่อหน้านี้อ่านว่า *"วันนี้ ADM คือแผนกนั้นในทะเบียนจริง — ไม่มีหัวหน้า และไม่
เคยมีเลย"* จนถึง 2026-09-07 · **แผนก ADM ไม่มีอยู่ในทะเบียนแล้ว** —
`rehome-demo-roster` ย้ายคนใน ADM ไป แผนกทรัพยากรมนุษย์ และตาราง หน่วยงาน จริงมี
18 แผนกโดยไม่มี ADM · กฎไม่ได้เปลี่ยน แต่ตัวอย่างที่ยกไว้ไม่มีตัวตนแล้ว จึงเอา
ชื่อออกแทนที่จะใส่ชื่อแผนกใหม่ลงไป: **ทะเบียนกำลังถูกนำเข้าใหม่ทั้งชุด** ชื่อที่
เขียนลงวันนี้จะค้างเป็นของเก่าภายในวันเดียวกัน · จะรู้ว่าวันนี้แผนกไหนบ้าง อ่าน
จากจอ ตั้งค่าระบบ → แผนกและเพดาน ซึ่งนับด้วย `unsignedStaff` ตัวเดียวกับที่
route ปฏิเสธ — และแผนกที่ **ฝ่ายบุคคลเป็นหัวหน้างานโดยกฎ** (`signedByHr`) ไม่
นับอยู่ในนั้น เพราะไม่ได้ขาดหัวหน้า

`mayOverrideManagerStep` จึงเปิดให้ **ผู้ดูแลระบบ และเฉพาะผู้ดูแลระบบเท่านั้น**
เซ็นขั้นหัวหน้าได้ ฝ่ายบุคคล ไม่อยู่ในบรรทัดนั้นโดยตั้งใจ: §6 ต้องการสายตาคู่ที่สอง
มาดูตัวเลข และ ฝ่ายบุคคล *คือ* สายตาคู่ที่สองอยู่แล้ว การให้เขาลงลายเซ็นคู่แรกด้วย
ทำให้ขั้นที่สองกลายเป็นการตรวจงานตัวเอง ซึ่งคือสิ่งที่สองขั้นนี้มีไว้เพื่อป้องกัน

ลายเซ็นแบบนี้ต้องจ่ายสี่อย่างเสมอ:

- **ถามหัวหน้าตัวจริงก่อนทุกครั้ง** การเซ็นแทนวางไว้หลัง `managerClaim` ที่
  ตำแหน่งเดียวกับที่ผู้รับช่วงวางอยู่ แผนกที่*มี*หัวหน้าจึงเซ็นโดยหัวหน้าของเขาเอง
  และทางนี้จะถูกใช้ก็ต่อเมื่อไม่มีใครอื่นเซ็นได้แล้วจริง ๆ
- **ต้องระบุเหตุผล** ไม่ระบุคือ 400 และเป็นกฎที่ปฏิเสธ ไม่ใช่ route ยืนอยู่ระดับ
  เดียวกับ `authorizeReplay` และ เปลี่ยนรหัสพนักงาน: *อะไร*ที่เปลี่ยนไป
  ประกอบขึ้นใหม่จากใบได้ทีหลัง แต่*ทำไม*ถึงอนุญาต ประกอบขึ้นใหม่ไม่ได้
- **ร่องรอยบอกไว้** `managerDecision.adminOverride` กับแถวประวัติอีกหนึ่งแถว
  พิมพ์ใน ประวัติรายการ ว่า `· เซ็นแทนหัวหน้า (ผู้ดูแลระบบ)` พร้อมเหตุผลอยู่ใต้บรรทัดนั้น
  ใช้ฟิลด์ของตัวเองเพราะสามฟิลด์ของผู้รับช่วง (`onBehalfOf`, `onBehalfOfName`,
  `delegationId`) **ว่างทั้งหมด** สำหรับกรณีนี้ — ไม่มีใครมอบสิทธิ์ และไม่มีหัวหน้า
  คนไหนอนุญาต ถ้าปล่อยให้ใช้สามฟิลด์นั้น มันจะแยกไม่ออกจากหัวหน้าธรรมดาที่เซ็นให้
  ทีมตัวเอง
- **มีให้กดบนหน้าจอเดียวเท่านั้น** แท็บ **ไม่มีหัวหน้าเซ็น** (ผู้ดูแลระบบ และ
  เฉพาะตอนที่จำนวนมากกว่าศูนย์) แสดงเฉพาะใบที่ `nobodyCanSign` หาเจอ ตัว*กฎ*
  เปิดให้ผู้ดูแลระบบเซ็นขั้นหัวหน้าของใบไหนก็ได้ แต่หน้าจอที่ไล่ใบที่รออนุมัติทั้ง
  บริษัทมาให้ ก็เท่ากับชวนให้เขาไปเซ็นใบที่หัวหน้าของใบนั้นกำลังจะเซ็นอยู่แล้ว ซึ่งจะ
  ทำให้สายตาคู่ที่สองของ §6 กลายเป็นพิธีกรรมในทางปฏิบัติ ทั้งที่ตัวกฎดูเหมือนไม่ถูกแตะ

`nobodyCanSign` ถาม**เป็นรายใบ ไม่ใช่รายแผนก** และนั่นไม่ใช่ความจู้จี้: แผนกหนึ่ง
อาจมีหัวหน้าที่เซ็นให้เฉพาะ ไพรมัส ขณะที่มีพนักงาน เดมเทค นั่งอยู่ในแผนกนั้นสองคน
ใบของสองคนนั้นเซ็นไม่ได้เท่ากับใบของ ADM ทั้งที่มองจากทุกหน้าจอแล้วแผนกดูมีคนดูแล
ครบ

#### …และ §6 ตอนนี้แปลว่า “สองคน” จริง ๆ

**ข้อนี้ปิดช่องที่มีมาก่อนการเซ็นแทน** §6 ต้องการลายเซ็นสองอัน แต่ไม่มีอะไรตรวจว่า
มันมาจาก*คน*สองคน — กฎนี้ถูกค้ำไว้ด้วยรูปร่างของบทบาทล้วน ๆ (หัวหน้าเซ็นก่อน
ฝ่ายบุคคลเซ็นทีหลัง ไม่มีใครเป็นทั้งสอง) และ `DELEGATE_ROLES` ทำให้มันพังเงียบ ๆ
ตั้งแต่วันที่เขียนมันขึ้นมา:

> ฝ่ายบุคคล ถูกตั้งเป็น ผู้รับช่วง ได้ ดังนั้น HR ที่ถือสิทธิ์รับช่วงอยู่จะอนุมัติขั้น
> **หัวหน้า** ด้วยสิทธิ์ของคนที่มอบให้ ใบย้ายไป รอ HR ยืนยัน แล้วคนเดียวกันนั้นเอง
> ก็เป็น `isHr` และเซ็นปิดท้าย คนเดียว สองลายเซ็น ไม่มีกฎการรับช่วงข้อไหนถูกละเมิด
> และไม่มีอะไรที่ไหนบอกไว้

ทำซ้ำให้เห็นกับ `approvalPermission` ตัวจริงเมื่อ 2026-08-24 ด้วยรูปแบบการรับช่วง
ที่มีอยู่ในทะเบียนจริง ตอนนี้ `signedManagerStep` ปฏิเสธมันแล้ว — และปฏิเสธ
**แบบทั่วไป** โดยดูที่ `managerDecision.by` เพราะถ้าเขียนว่า "ผู้ดูแลระบบเซ็นทั้งสอง
ขั้นไม่ได้" มันจะแก้เฉพาะทางใหม่ แล้วปล่อยทางของ ผู้รับช่วง ไว้เหมือนเดิมทุกประการ

- ดูที่**ตัวคน** ไม่ใช่บทบาท: ผู้ดูแลระบบคนอื่น หรือ ฝ่ายบุคคล คนไหนก็ยืนยันใบนั้นได้
- **การถือ**สิทธิ์รับช่วง ไม่เท่ากับ**การได้เซ็น** — HR ที่ถูกตั้งเป็นตัวสำรองไว้แต่
  ไม่เคยใช้ ยังยืนยันได้ตามปกติ กฎที่หยาบกว่านี้เท่ากับริบงานไปจากคนหนึ่งเพราะปุ่มที่
  เขาไม่เคยกด
- 409 ไม่ใช่ 403: เขามีสิทธิ์เซ็นขั้น HR อยู่แล้ว สิ่งที่ปฏิเสธคือสถานะของ*ใบนี้*
- คิวถามคำถามเดียวกัน แถวแบบนี้จึงแสดงเหตุผลแทนที่จะแสดงปุ่มสองปุ่มที่กดแล้วได้ 409
  ทั้งคู่

### ทำไม “ลบแผนก” จึงไม่มี

`OtEntry.department` เป็น **reference ที่บังคับมี และถูกกำหนดตอนยื่นใบ** — แต่
**ตั้งแต่ 2026-09-08 ไม่มีรายงานไหนอ่านมันแล้ว** ทุกใบถูกจัดตาม *สังกัดหลัก* ใน
ทะเบียน (ดู *แผนก and บริษัท are both read from the roster at report time*
ข้างล่าง) ย่อหน้านี้เคยอ่านว่า “แผนกถูกถ่ายภาพนิ่งลงบนใบโดยตั้งใจ การย้ายแผนก
กลางเดือนจึงทิ้งชั่วโมงไว้ที่ที่มันถูกทำ” ซึ่งจริงจนถึงวันนั้น · ข้อสรุปไม่เปลี่ยน
ถ้าลบแถวแผนกทิ้ง ทุกใบที่ชี้มา
ที่มันจะยุบรวมเป็นถัง `ไม่ระบุแผนก` ถังเดียวไม่มีชื่อใน `groupByDepartment` —
อย่างถาวร และรวมกับทุกแผนกอื่นที่เคยถูกลบด้วย ส่วน `active: false` ไม่ต้องจ่ายอะไร
แบบนั้นเลย: แผนกหายไปจากทุกช่องเลือก คนในแผนกยื่นใบไม่ได้อีก และทุกเดือนที่ปิดไป
แล้วยังอ่านออกมาถูกต้อง

ดังนั้นจึงไม่มี `DELETE` handler อยู่ใต้ `app/api/departments/` ในไฟล์ไหนเลย และ
`test/permissionRouteGuards.test.js` เดินไล่ทั้งโฟลเดอร์เพื่อรักษาสภาพนั้นไว้

### ข้อยกเว้นหนึ่งข้อ: ใบที่อนุมัติแล้วขยับได้เฉพาะ ผู้ดูแลระบบ — ยกเว้นการแก้วันเกิด

**กฎ:** ชั่วโมงที่มีคนลงชื่อรับไปแล้ว จะไม่ขยับเพราะมีใครมาพลิกสวิตช์ทีหลัง
`recomputeEntries` ปฏิเสธใบที่อนุมัติแล้ว เว้นแต่ผู้เรียกส่ง `includeApproved` มา
และ `authorizeReplay` กั้นตรงนั้นไว้ให้เฉพาะผู้ดูแลระบบที่เขียนเหตุผลมาด้วย

**ข้อยกเว้นข้อเดียว และเป็นข้อยกเว้นที่ตั้งใจ:** การแก้ **วันเกิด** ใน
ทะเบียนพนักงาน จะคำนวณใบของคนนั้นใหม่ด้วย `includeApproved: true` จาก route ที่
ฝ่ายบุคคล เข้าถึงได้ โดยไม่ผ่าน `authorizeReplay`
(`app/api/employees/[id]/route.js`)

**ทำไม** `authorizeReplay` มีไว้เพื่อไม่ให้ใครตีความ*คำถามเชิงนโยบาย*ใหม่ แล้วแอบ
แถลงตัวเลขทั้งเดือนใหม่ตามความเข้าใจของตัวเอง แต่วันเกิดไม่ใช่การตีความ —
**มันคือข้อเท็จจริงที่ถูกบันทึกผิด** วันเกิดของพนักงานเป็นวันหยุดของคนนั้น การย้าย
วันจึงย้ายว่าวันไหนเป็นวันหยุดของเขา และใบที่อนุมัติแล้วซึ่งถูกปล่อยไว้เฉย ๆ ก็คือ
ตัวเลขที่พิมพ์อยู่บน F-HR-027 ใต้ประเภทวันที่ตอนนี้ทุกคนเห็นตรงกันแล้วว่าผิด
กระดาษใบนั้นผิดเฉย ๆ และผิดมาตั้งแต่วันที่พิมพ์ — ฝ่ายบุคคลตัดสิน 2026-08-18

**สิ่งที่ข้อยกเว้นนี้ยังต้องจ่าย** ทุกอย่างที่ทางออกฉุกเฉินเรียกร้อง ยกเว้นการตรวจ
บทบาท:

- **⚠️ ไม่มีกำแพงระดับเดือนแล้ว** ข้อนี้เคยอ่านว่า "**ปิดงวด ยังเป็นกำแพงอยู่** —
  `recomputeEntries` ข้ามเดือนที่ปิดแล้วเสมอไม่ว่าจะถูกสั่งให้ทำอะไร" ปิดงวด ถูกถอน
  ออกเมื่อ 2026-08-31 (ดู `lib/periodStatus.js`) การแก้วันเกิดจึงคำนวณใบที่อนุมัติ
  แล้ว**ทุกเดือน**ใหม่ ไม่ว่าเก่าแค่ไหน และไม่ว่าจะพิมพ์ส่งบัญชีไปแล้วหรือยัง
  นี่คือการอ่านกฎของฝ่ายบุคคลตามที่ตั้งใจ ไม่ใช่ช่องที่เหลือไว้ — วันเกิดที่บันทึกผิด
  ทำให้กระดาษผิดตั้งแต่วันที่พิมพ์ สิ่งที่การแก้ติดค้างไว้คือ*ความเห็นได้* ไม่ใช่
  *ความยับยั้ง* ซึ่งคือสามข้อที่เหลือ
- **ทุกใบที่ตัวเลขขยับจริงจะเก็บภาพ `before` ไว้** พร้อมบรรทัด `recompute` ที่ถือ
  `BIRTHDATE_REPLAY_NOTE` การแถลงตัวเลขใหม่จึงโผล่ใน ประวัติรายการ ข้าง ๆ การแก้ไข
  ธรรมดา
- **การรันถูกบันทึกใน `otPolicyReplayRuns` ภายใต้ `source: 'birthdate'`** ไม่ใช่
  `'manual'` ซึ่งเป็นค่าที่ endpoint คำนวณใหม่เขียน สองอย่างนี้เป็นคนละการกระทำ
  ภายใต้คนละอำนาจ การอ่านย้อนหลังต้องแยกมันออกจากกันได้ และ `source` ทำ index ไว้
  สำหรับคำถามนี้โดยเฉพาะ
- **หน้าจอบอกจำนวนใบที่เซ็นรับไปแล้วและถูกขยับ** เป็นตัวเลขตรง ๆ

### สิทธิ์ ผู้ดูแลระบบ ที่ยังไม่มีหน้าจอ

เหลืออยู่ข้อเดียว ตัวอย่างทั้งสองข้างล่างสมมติว่ารัน `next start` บนเครื่องนี้ และ
มี session cookie ของบัญชี ผู้ดูแลระบบ อยู่ · `--cookie` รับค่าของ `ot_token` จาก
เบราว์เซอร์ที่ล็อกอินอยู่แล้ว (devtools → Application → Cookies)

**คำนวณใหม่รวมใบที่อนุมัติแล้ว** — `POST /api/settings/recompute` ไม่มีปุ่มสำหรับ
เรื่องนี้อยู่ที่ไหนบนหน้าจอไหนเลย และตั้งใจให้เป็นอย่างนั้น: มันเป็นการกระทำเดียวที่
แถลงตัวเลขที่มีคนเซ็นรับไปแล้วใหม่ และไม่ควรเป็นปุ่มที่ใครเผลอไปเจอเข้า

```bash
# ตัวอย่างจริง — คำนวณใบของงวด 2026-08 ใหม่ รวมใบที่อนุมัติแล้ว
curl -X POST http://127.0.0.1:3000/api/settings/recompute \
  -H 'Content-Type: application/json' \
  --cookie 'ot_token=<ค่าจากเบราว์เซอร์ที่ล็อกอินเป็น ผู้ดูแลระบบ>' \
  -d '{"period":"2026-08","includeApproved":true,"note":"HR ตอบข้อ OPEN 1 เมื่อ 2026-08-24 — คำนวณทั้งเดือนใหม่"}'
```

> ⚠️ **`includeApproved: true` เปลี่ยนตัวเลขที่เซ็นรับไปแล้ว** ทุกใบที่มันขยับคือ
> ตัวเลขที่หัวหน้าเซ็นและฝ่ายบุคคลยืนยันแล้ว และอาจถูกพิมพ์ลงใบ F-HR-027 ที่อยู่ใน
> แฟ้มของใครสักคนไปแล้ว `note` เป็นสิ่งที่ต้องกรอกและไม่ใช่ของประดับ — มันเป็นสิ่ง
> เดียวที่จะอธิบายการแถลงตัวเลขใหม่ครั้งนี้ใน `otPolicyReplayRuns` ได้ในภายหลัง
> **สั่ง `npm run backup` ก่อน** และรัน `npm run whatif` เพื่อดูราคาของการเปลี่ยน
> ก่อนจะรันคำสั่งนี้เพื่อเปลี่ยนจริง
>
> **ไม่มีเดือนไหนถูกกันไว้อีกแล้ว** ย่อหน้านี้เคยอ่านว่า "เดือนที่ปิดงวดแล้วจะถูกข้าม
> เสมอ ไม่ว่าจะส่งอะไรมาก็ตาม" พร้อมบอกว่าคำตอบคืน**จำนวน**ไว้ที่ `skippedClosed`
> และ**ชื่อเดือน**ไว้ที่ `closedPeriods` ปิดงวด ถูกถอนออกเมื่อ 2026-08-31 (ดู
> `lib/periodStatus.js`) ทั้งสองฟิลด์นั้นถูกลบทิ้ง ไม่ใช่ปล่อยให้เป็นศูนย์ค้างไว้ และ
> `skipped` เหลือเหตุผลเดียวคือ `'approved'` — ใบที่มีคนเซ็นแล้วและไม่ได้สั่ง
> `includeApproved` มาด้วย
>
> **สิ่งที่ยังกั้นอยู่คือ `authorizeReplay`** ผู้ดูแลระบบเท่านั้น และต้องมี `note`
> ซึ่งตอนนี้เป็นด่านเดียวที่เหลือระหว่างตัวเลขที่เซ็นรับไปแล้วกับการถูกแถลงใหม่

ถ้าไม่ใส่ `includeApproved` endpoint เดียวกันนี้ก็เป็นงานธรรมดาที่ ฝ่ายบุคคล ทำได้
— มันคำนวณใหม่เฉพาะใบที่ยังไม่ถูกตัดสิน:

```bash
curl -X POST http://127.0.0.1:3000/api/settings/recompute \
  -H 'Content-Type: application/json' --cookie 'ot_token=<…>' \
  -d '{"period":"2026-08"}'
```

`PATCH /api/settings` ไม่อยู่ในรายการนี้แล้ว: รหัสเอกสาร OT ตอนนี้เป็นหัวข้อหนึ่ง
ใน ตั้งค่าระบบ ที่ทั้งสองบทบาทเข้าถึงได้ — หัวข้อนี้เคยชื่อ ชื่อบริษัทและรหัสฟอร์ม
จนถึง 2026-08-31 หน้าจอตอนนี้แก้ได้เฉพาะ `formCode` ที่พิมพ์ลงกระดาษจริง ส่วน
`companyName` / `companyNameEn` ยังอยู่ในฐานข้อมูลและยังแก้ผ่าน endpoint นี้ได้
แต่ไม่มีช่องกรอกในแอปแล้ว เพราะไม่มีหน้าจอหรือแบบฟอร์มใดพิมพ์ค่านั้นออกมา

### `npm run reset-admin` — ทางกลับเข้าบัญชี ผู้ดูแลระบบ

ผู้ดูแลระบบ เป็นทางร้องเรียนขั้นถัดไปของ ฝ่ายบุคคล และตัวเองไม่มีทางร้องเรียนขั้น
ถัดไปอีก `rosterPermission` ปฏิเสธการเขียนทุกอย่างที่ HR ทำกับแถวที่เป็น Admin —
รวมทั้งการตั้งรหัสผ่านใหม่ — ในระบบมีบัญชี Admin ที่ใช้งานอยู่เพียงบัญชีเดียว และ
hash ที่เก็บไว้ย้อนกลับไม่ได้ ดังนั้นก่อนจะมีสคริปต์นี้ Admin ที่ลืมรหัสผ่านจึงไม่มี
ทางกลับเข้าระบบเลย นอกจากเปิด mongo shell แล้วคำนวณ bcrypt hash เอง

```bash
npm run reset-admin -- ADMIN
```

```
ตั้งรหัสผ่านใหม่ให้ ADMIN · ผู้ดูแลระบบ แล้ว

  รหัสผ่านชั่วคราว:  gof-mez-tab-4827

รหัสนี้แสดงเพียงครั้งเดียว — ฐานข้อมูลเก็บไว้เป็น hash เท่านั้น
ถ้าทำหาย ให้รันคำสั่งนี้ใหม่ จะได้รหัสใหม่อีกอัน
เข้าใช้งานได้ทันที และจะเห็นแถบเตือนให้เปลี่ยนรหัสผ่านจนกว่าจะเปลี่ยนจริง
```

- **รันบนเซิร์ฟเวอร์เท่านั้น** มันมี main guard ตัวเดียวกับที่ `npm run seed`,
  `npm run backup` และ `npm run restore` มี — การ import ไฟล์นี้ไม่ว่าด้วยเหตุใด
  ก็ไม่ได้ตั้งรหัสผ่านใหม่ให้ใคร
- **ไม่ได้ให้อำนาจกว้างกว่าที่ฐานข้อมูลให้อยู่แล้ว** คนที่รันมันได้คือคนที่นั่งอยู่หน้า
  เครื่องที่ถือ `MONGODB_URI` และเขียน collection ด้วยมือได้อยู่แล้ว สิ่งที่สคริปต์นี้
  เพิ่มเข้ามาคือการซ่อมนั้นเดินผ่านตัวสุ่มรหัสตัวเดียวกัน ธง `mustChangePassword`
  ตัวเดียวกัน และร่องรอยตรวจสอบชุดเดียวกันกับการตั้งรหัสใหม่จากหน้าจอ
- **เฉพาะแถวที่เป็น ผู้ดูแลระบบ** บัญชีอื่นทุกบัญชีมีทางอยู่แล้ว — ฝ่ายบุคคล ตั้งใหม่
  ให้จาก ทะเบียนพนักงาน และทางนั้นบันทึกว่าใครเป็นคนกด สคริปต์ที่ตั้งรหัสให้ใครก็ได้
  จะเปลี่ยน *มี shell บนเซิร์ฟเวอร์นี้* ให้กลายเป็น *เป็นพนักงานคนไหนก็ได้* ซึ่งเป็น
  ทางลัดที่สั้นที่สุดไปสู่ลายเซ็นของหัวหน้า รหัสที่ไม่ใช่ admin จะถูกปฏิเสธโดยระบุชื่อ
  และแถวที่ปิดใช้งานแล้วก็เช่นกัน
- **ต้องระบุรหัสพนักงาน** มันไม่ไล่หา "ตัว admin" แล้วตั้งรหัสให้กับอะไรก็ตามที่หาเจอ
- **มันทิ้งบันทึกไว้ และบันทึกนั้นบอกว่าไม่มี session อยู่เบื้องหลัง** แถวใน
  `otEmployeeAudits` ถือ `action: 'password_reset'`, `source: 'script'` และ
  **ไม่มีผู้กระทำ** — ผู้เรียกคือใครก็ตามที่นั่งอยู่หน้าคอนโซล และระบบไม่มีทางรู้ว่า
  เป็นใคร การใส่ชื่อใครลงไปตรงนั้นคือการแต่งขึ้น และร่องรอยที่แต่งขึ้นหนึ่งช่องก็ไม่ใช่
  หลักฐานสำหรับช่องอื่น ๆ อีกต่อไป ประวัติการแก้ทะเบียน พิมพ์มันออกมาว่า
  `ตั้งรหัสผ่านใหม่ (สคริปต์บนเซิร์ฟเวอร์)`
- **รหัสผ่านชั่วคราวใช้ `generateTempPassword()`** และตั้งแต่ **2026-09-02**
  นี่คือ *ผู้เรียกรายเดียว* ของฟังก์ชันนั้นทั้งระบบ บรรทัดนี้เคยอ่านว่า “ตัวเดียวกับ
  ที่หน้าจอใช้ ไม่มีสูตรที่สอง” ซึ่งไม่จริงแล้ว — หน้าจอตั้งรหัสผ่านเป็น **รหัสพนักงาน**
  ส่วนสคริปต์นี้ยังสุ่ม และตั้งใจให้ต่างกัน: ADMIN คือทางกู้ของทุกบัญชีอื่น ไม่มี
  ฝ่ายบุคคล อยู่เหนือมันคอยสังเกตว่ามีคนแปลกหน้าไปถึงก่อน และรหัสพนักงานคือสิ่งที่
  พิมพ์อยู่ที่หน้าล็อกอินอยู่แล้ว ดูหัวข้อ *รหัสผ่านแรกเข้า* ข้างบนว่าทำไมเรื่องนี้ถึง
  สำคัญ · ตรึงจากทั้งสองด้านด้วย `test/permissionRouteGuards.test.js` และ
  `test/tempPassword.test.js`

ถ้าบัญชีที่เข้าไม่ได้เป็นบัญชี **ฝ่ายบุคคล** สคริปต์นี้ไม่ใช่คำตอบ: ให้ ฝ่ายบุคคล
คนอื่นหรือ ผู้ดูแลระบบ ตั้งรหัสใหม่ให้จาก ทะเบียนพนักงาน ซึ่งเร็วกว่าและบันทึกชื่อคน
ที่ทำไว้ด้วย

---

## บันทึกประวัติระบบ — ข้อมูลจราจรทางคอมพิวเตอร์

**ตั้งค่าระบบ ไม่ใช่ที่อยู่ของหน้านี้ — เป็นแท็บของตัวเอง และเห็นได้เฉพาะ
ผู้ดูแลระบบ** (`components/LogSystem.jsx`, `app/api/logs/`).

มีร่องรอยสามชุดที่ตอบคำถาม *ตัวเลขนี้เมื่อก่อนเป็นเท่าไร* ได้อยู่แล้ว: `history`
บน OtEntry, `otEmployeeAudits` สำหรับทะเบียน และ `otPolicyVersions` สำหรับการ
คำนวณ ทั้งสามชุดเป็นเรื่องของ **ค่า** ไม่มีชุดไหนตอบคำถามที่ พ.ร.บ. ว่าด้วยการ
กระทำความผิดเกี่ยวกับคอมพิวเตอร์ **มาตรา ๒๖** ถามผู้ให้บริการได้: ณ เวลาหนึ่ง
*ใคร* เชื่อมต่ออยู่ *จากที่ไหน* และแตะอะไรบ้าง — รวมถึงคนที่แค่เข้ามาดูเฉย ๆ และคน
ที่กรอกรหัสผ่านแล้วถูกปฏิเสธ

การเปิดอ่านไม่ทิ้งร่องรอยไว้ในสามชุดนั้นเลย การล็อกอินที่ผิดสิบเอ็ดครั้งตอนตีสอง
จากหมายเลขที่ไม่มีใครรู้จักก็เช่นกัน `otAccessLogs` คือที่ที่สองอย่างนั้นไปลง

### เก็บอะไรบ้าง และเก็บที่จุดไหน

หนึ่งเอกสารต่อการเรียก API หนึ่งครั้ง เขียนโดย **`route()` ใน `lib/http.js`** —
ประตูเดียวที่ handler ทุกตัวในแอปนี้เดินผ่าน ตำแหน่งนี้คือตัวการออกแบบทั้งหมด:
route ที่เพิ่มเข้ามาปีหน้าจะถูกบันทึกโดยที่คนเขียนไม่ต้องรู้ด้วยซ้ำว่ามีฟีเจอร์นี้อยู่
ส่วนทางเลือกอีกทาง (วาง `logAccess()` ไว้หัว handler ห้าสิบตัว) มีรูปแบบความล้มเหลว
อยู่แบบเดียว คือ handler ที่ใครสักคนเขียนตอนรีบ ชื่อบนแถวมาจาก **`requireAuth`**
ด้วยเหตุผลเดียวกัน — มันคือฟังก์ชันที่รู้ และ route ที่ไม่เคยเรียกมันเลยก็คือ route
ที่ไม่ได้ยืนยันตัวตนใคร ซึ่งตรงกับความหมายที่แถวไม่มีชื่อควรจะมี

การเขียนถูกตั้งคิวด้วย `after()` จาก `next/server` มันจึงไม่ไปคั่นระหว่าง handler
กับคนที่รออยู่ และมันเกิดขึ้นแม้ handler จะ throw ออกมา — 500 คือกรณีที่บันทึกมี
ค่ามากที่สุด

| | |
|---|---|
| เวลา · วิธี · เส้นทาง · พารามิเตอร์ | ตามที่ร้องขอมา โดย query string ถูกกลบค่าไว้ |
| ผลลัพธ์ · เวลาที่ใช้ | สถานะที่**เซิร์ฟเวอร์**ตัดสิน ไม่ใช่สิ่งที่ handler ตั้งใจ |
| ผู้ใช้งาน | รหัส ชื่อ และบทบาท เก็บซ้ำไว้ในแถว — บันทึกยังตอบได้แม้บัญชีนั้นถูกลบไปแล้ว |
| หมายเลขไอพี · อุปกรณ์ | hop แรกของ `x-forwarded-for` พร้อมทั้งสายทั้งเส้นถ้ามี |
| เหตุการณ์ | `request` · `login` · `login_failed` · `logout` |

### สิ่งที่ไม่เก็บเด็ดขาด

**เนื้อหาที่ส่งเข้ามา (request body) ไม่สรุป ไม่ตัดทอน ไม่แม้แต่ "เก็บเฉพาะชื่อ
ฟิลด์"** `lib/rosterAudit.js` ระบุรายชื่อฟิลด์ที่มันบันทึกได้ ส่วนที่นี่ไปไกลกว่านั้น
อีกขั้น คือไม่บันทึกค่าของฟิลด์ใดเลย `POST /api/auth/login` และ
`POST /api/employees/me/password` มีรหัสผ่านแบบข้อความธรรมดาติดมาด้วย และตัวบันทึกที่
มีเส้นทางเก็บ body อยู่ในตัว ก็ห่างจากการเขียนรหัสผ่านนั้นลง collection ที่
ผู้ดูแลระบบ เปิดดูบนหน้าจอ อยู่แค่การ refactor ครั้งเดียว ที่นี่ไม่มีเส้นทางแบบนั้น
ไม่มีช่องบน schema ให้ทำแบบนั้น และ `test/logRouteGuards.test.js` จะพังทันทีถ้าสอง
ข้อนี้เปลี่ยนไป

เนื้อหาที่ตอบกลับ (response body) ถูกกันออกด้วยเหตุผลข้อที่สอง: คำตอบของ
`GET /api/employees` คือทะเบียนพนักงานทั้งชุด บันทึกที่เก็บคำตอบไว้จึงเท่ากับสำเนา
ที่สองของข้อมูลส่วนบุคคลทุกอย่างในระบบ อยู่ใน collection ที่ไม่มีสิทธิ์รายแถวแบบที่
ปกป้องสำเนาแรกอยู่เลย

**ข้อยกเว้นข้อเดียว** คือ `attemptedCode` — รหัสพนักงานที่ถูกพิมพ์ตอนล็อกอินแล้ว
ล้มเหลว ถ้าไม่มีมัน การไล่เดารหัสสี่ร้อยครั้งจะกลายเป็นสี่ร้อยแถวที่เหมือนกันหมดว่า
มีคนล็อกอินเป็นใครสักคนไม่สำเร็จ เพราะข้อความปฏิเสธถูกทำให้เหมือนกันโดยตั้งใจ ไม่ว่า
รหัสนั้นจะมีอยู่จริงหรือไม่

### ผู้ดูแลระบบ เท่านั้น — และไม่ใช่ ฝ่ายบุคคล

หน้าจออื่นทุกหน้าที่ HR เข้าถึงได้เป็นเรื่องของ OT หน้านี้เป็นเรื่องของ **คน**:
บัญชีไหนเชื่อมต่ออยู่ตอน 22:40 จากโทรศัพท์เครื่องไหน และเปิดอะไรดู บัญชีล็อกอินของ
ฝ่ายบุคคล ใช้ร่วมกันทั้งแผนก การยื่นหน้าจอที่ระบุว่าใครทำอะไรให้พวกเขา จึงเท่ากับ
บอกแต่ละคนว่าคนอื่นทั้งหมดทำอะไรไปบ้าง — ขณะที่บันทึกกิจกรรมของ HR เองก็จะถูกอ่าน
ได้โดยคนใดก็ตามในแผนกที่อยากรู้

**การเปิดอ่านบันทึกก็ถูกบันทึกด้วย** นั่นไม่ใช่ผลพลอยได้จากวิธีเขียนโค้ด แต่เป็น
คุณสมบัติที่ทำให้ collection นี้มีค่าขึ้นมา บันทึกที่ผู้ดูแลระบบเปิดอ่านได้โดยไม่ทิ้ง
ร่องรอย ไม่ได้บอกอะไรเลยเกี่ยวกับบัญชีเดียวที่เข้าถึงได้ทุกอย่าง

**ไม่มีลบ ไม่มีแก้ และไม่มี "ล้างบันทึก"** — ทุกฟิลด์บนโมเดลเป็น `immutable`
ไม่มี route ไหนเปิดให้เขียน และหน้าจอก็ไม่มีอะไรให้วาด

### เก็บไว้นานเท่าไร

มาตรา ๒๖ กำหนด**พื้น**ไว้ที่ **เก้าสิบวัน** ไม่ใช่เพดาน

* ไม่ตั้ง `LOG_RETENTION_DAYS` — ซึ่งเป็นค่าตั้งต้น — แล้ว**จะไม่มีอะไรถูกลบเลย**
  collection ที่โตเกินไปเป็นปัญหาที่ใครก็แก้ได้ในวันอังคารวันไหนก็ได้ ส่วนบันทึกที่
  ถูกลบไปก่อนจะมีคนมาขอ เป็นปัญหาที่ไม่มีใครแก้ได้
* ถ้าตั้ง จะมีการสร้าง TTL index ค่าที่ต่ำกว่า 90 จะถูก**ดันขึ้นเป็น 90 แทนที่จะทำ
  ตาม**: สภาพแวดล้อมยืดเวลาเก็บให้ยาวขึ้นได้ แต่ย่นให้สั้นกว่าที่กฎหมายกำหนดไม่ได้
* Mongo อ่าน index นั้นครั้งเดียวตอนสร้าง การเปลี่ยนตัวแปรทีหลังไม่ขยับ index ที่มี
  อยู่แล้ว ต้องใช้ `collMod` หรือลบ `createdAt_1` ทิ้ง

`npm run backup` เก็บ collection นี้ไปพร้อมกับทุกอย่าง เพราะมันอ่านรายชื่อ
collection จากฐานข้อมูลจริง ไม่ใช่จากรายการในทะเบียนโมเดล

### อ่านทีละหน้า — และหน้าจอไปถึงแถวสุดท้ายได้จริง

**ตารางทั้งสองบนหน้านี้มีแถบเปลี่ยนหน้าอยู่ท้ายตาราง** ตั้งแต่ 2026-09-08 —
ตารางบันทึกใต้สามแท็บที่เป็นรายการ และตาราง การใช้สิทธิ์พิเศษ ใต้แท็บที่ห้า
แถบเดียวกัน (`TablePager` ใน `components/common.jsx`) เลือกจำนวนแถวต่อหน้าได้
**10 · 20 · 50 · 100** เริ่มที่ 10 บอกว่ากำลังอ่านแถวไหนอยู่
(`แสดง 1–10 จากทั้งหมด 120 รายการ` และ `หน้า 1 / 12`) และมีลูกศร `‹` `›`
ที่**หมดสิทธิ์กดเมื่อสุดทาง แต่ไม่หายไป** — ปุ่มที่หายไปตอนสุดทางจะดันปุ่มข้าง ๆ
มานั่งที่เดิมของมัน แล้วนิ้วที่กำลังกดรัวก็จะไปโดนปุ่มที่พากลับทางเดิม

> **เดิมเป็นปุ่ม ดูย้อนหลังเพิ่ม และมันมีเพดาน** `limit` เริ่มที่ 100 กดทีละ 200
> จนถึง 500 แล้วขึ้นแถบเหลืองว่า `แสดงได้สูงสุด 500 รายการต่อครั้ง` พร้อมแนะให้
> โหลด CSV **แถวที่เก่ากว่าแถวที่ห้าร้อยจึงเปิดดูบนหน้าจอไม่ได้เลย** ทางเดียวคือ
> บีบช่วงวันที่ให้แคบลง หรือเปิด Excel — บนหน้าจอเดียวในระบบนี้ที่มีไว้เพื่อ*อ่าน*
> อย่างเดียว และหน้าต่างนั้นโตได้อย่างเดียว ย้อนกลับไม่ได้ ถอนที่กดไปแล้วไม่ได้

**ตารางบันทึกแบ่งหน้าที่เซิร์ฟเวอร์ ตาราง การใช้สิทธิ์พิเศษ แบ่งที่เบราว์เซอร์**
และเป็นคนละแบบด้วยเหตุผลของแต่ละ endpoint `GET /api/logs` รับ `skip` เพิ่มมา
และนับด้วย `countDocuments` ทุกครั้ง `หน้า 3 / 47` จึงเป็นตัวเลขจริงไม่ใช่การเดา
ส่วน `GET /api/logs/compliance` **ยังไม่มีเพดานและยังส่งทุกแถว** เพราะมันอ่านสี่
collection ผ่านตัวโหลดตัวเดียวกับที่ CSV ใช้ — สอนให้มัน `skip` คือการอ่านงวด
เดียวกันด้วยวิธีที่สอง และจอกับไฟล์จะเริ่มรายงานไตรมาสไม่ตรงกัน ประโยคใต้ตาราง
นั้นยังเขียนว่า **ไม่มีการตัดท้าย** อยู่ เพราะนั่นเป็นคำพูดเรื่อง*รายงาน* ไม่ใช่เรื่อง
การจัดหน้า: แบ่งหน้าคือการย้ายแถวไปอยู่คนละหน้า ไม่ใช่การตัดแถวทิ้ง

#### กด `‹` `›` แล้วหน้าจอไม่ขยับ — และวิธีที่ทำให้ไม่ขยับคือไม่ยุบหน้า

**แจ้งมาเมื่อ 2026-09-08 ว่า "หน้าจอเด้งขึ้นด้านบนเวลากดปุ่มเปลี่ยนหน้า" และ
สาเหตุที่ควรจะเป็นนั้นไม่มีอยู่จริง** — ทั้งหน้านี้และ `TablePager` ไม่มี
`window.scrollTo` และไม่มี `scrollIntoView` สักตัวเดียว ไม่เคยมีด้วย สิ่งที่ทำให้
หน้าจอเด้งคือตัวโหลด**ล้างข้อมูลของตัวเองก่อน**:

```js
setData(null);                       // ← ตรงนี้คือทั้งหมดของบั๊ก
api.get(`/logs?${params}`).then(setData);
```

ระหว่างที่กดกับที่คำตอบมาถึง ตาราง แถบเปลี่ยนหน้า และปุ่มที่เพิ่งถูกกด ถูกแทนด้วย
บรรทัดเดียวว่า `กำลังโหลด…` เอกสารยุบจาก 1318px เหลือเท่าจอ `maxScroll` กลายเป็น 0
เบราว์เซอร์จึง**หนีบ** `scrollY` ลงมา — และการหนีบทำให้ค่าเดิมหายไปเลย พอแถวกลับมา
หน้าสูง 1337px อีกครั้ง แต่คนอ่านอยู่บนสุดแล้ว โดยไม่มีอะไรเก็บตำแหน่งเดิมไว้

**วัดบนแอปที่ build แล้วบนโคลนของ prod:** `scrollY` = 418 ก่อนกด · 0 ที่ 120ms
หลังกด · 0 ทุกจุดที่วัดหลังจากนั้น · `document.activeElement` เป็น `BODY`
ไม่ใช่ปุ่มลูกศร เพราะปุ่มอยู่ในส่วนที่ถูกแทนไปแล้ว

**ทางแก้จึงไม่ใช่การเลื่อนกลับ แต่คือไม่เอาความสูงของหน้าออกไปตั้งแต่แรก**
(`useKeptFetch` ใน `components/common.jsx`) แถวเดิมอยู่บนจอจนกว่าหน้าถัดไปจะมาแทน
แถบเปลี่ยนหน้าไม่เคยถูกถอด และไม่มีอะไรต้องเลื่อนกลับเพราะไม่มีอะไรขยับ · การเลื่อน
กลับเป็นคำตอบที่ผิดรูปสองชั้น: มันไปแย่งค่าที่เบราว์เซอร์ทิ้งไปแล้ว และคนอ่านยังเห็น
หน้าจอกระตุกหนึ่งเฟรมอยู่ดี · **ปุ่มยังโฟกัสอยู่ด้วยเหตุผลเดียวกัน** element ที่ไม่ถูก
ถอดก็ไม่เสียโฟกัส ไม่ต้องมีใครไปคืนให้ กด `›` รัว ๆ จึงทำได้ทั้งเมาส์และคีย์บอร์ด

**หลังแก้ วัดซ้ำแบบเดิม:** `scrollY` = 418 ทุกจุดที่วัด · ความสูงเอกสารคงที่ 1318px ·
`.table-pager` อยู่ที่ 786px จากขอบบนจอทั้งก่อนและหลัง · โฟกัสอยู่ที่
`.pager-step.pager-next` ตลอด

> **ยังมีการขยับที่เหลืออยู่หนึ่งอย่าง และมันถูกต้อง** บนตาราง การใช้สิทธิ์พิเศษ
> หน้าถัดไปอาจ*เตี้ยกว่า*จริง ๆ (แถวมีความสูงไม่เท่ากัน — บางแถวมีเหตุผลยาว
> บางแถวไม่มี) เอกสารจึงสั้นลงและ `scrollY` ถูกหนีบตาม วัดได้ 1009 → 382 · แต่
> **สิ่งที่คนอ่านมองอยู่ไม่ขยับ**: `.table-pager` อยู่ที่ 743px ก่อนกด และ 744px
> หลังกด เทียบกับตอนเป็นบั๊กที่ขยับจาก 786 ไป 1223 นั่นคือเนื้อหาที่สั้นลงจริง
> ไม่ใช่หน้าจอที่เด้ง และการตรึงความสูงไว้กันก็คือการเว้นที่ว่างไว้เฉย ๆ

**ระหว่างที่ยังโหลด** ตารางจาง (`opacity: .62`) พร้อม `aria-busy` และแถวรับคลิกไม่ได้
ชั่วคราว เพราะคลิกที่แถวจะเปิดป๊อปอัปของ*แถวที่กำลังจะถูกแทน* · **แถบเปลี่ยนหน้าไม่
จางและไม่ถูกปิด** เพราะการกดรัวคือเรื่องที่ถูกแจ้งมา · และเพราะกดซ้อนได้ ตัวโหลดจึง
ต้องมีลำดับกำกับ — คำขอที่ใหม่ที่สุดเท่านั้นที่เขียนได้ ไม่งั้นคำตอบของหน้า 2 ที่มา
ช้ากว่าหน้า 3 จะทิ้งแถวของหน้า 2 ไว้ใต้แถบที่เขียนว่า `หน้า 3` (เดินจริงด้วยการหน่วง
เน็ต 1200ms แล้วกดซ้อน — ได้ `หน้า 3 / 12` กับ `แสดง 21–30` ตรงกัน)

> **[OPEN] ตัวเลข ทั้งหมด ขยับระหว่างเปลี่ยนหน้า — และนั่นคือหน้าจอนี้ ไม่ใช่บั๊ก**
> การเปิดอ่านบันทึกก็ถูกบันทึก `route()` เขียนแถวให้ `GET /logs` เหมือนทุกคำขอ
> ซึ่งเป็นคุณสมบัติที่ทำให้ collection นี้มีค่า ทุกครั้งที่กด `›` จึงเพิ่มอีกหนึ่งแถว
> และเพราะเรียงใหม่ไปเก่า แถวใหม่ไปอยู่**หน้าสุด** ทุกแถวหลังจากนั้นเลื่อนไปหนึ่ง
> ตำแหน่ง — แถวสุดท้ายของหน้า 1 จึงโผล่ซ้ำบนหัวหน้า 2 ได้ · เดินบนโคลนเมื่อ
> 2026-09-08 เห็น `ทั้งหมด` ไต่ 95 → 96 → 97 ในสามครั้งที่กด · **ปุ่มเดิมก็เป็น
> แบบนี้และมองไม่เห็น** หน้าต่างที่โตอย่างเดียวอ่านใหม่จากหน้าสุดทุกครั้ง แถวที่ซ้ำ
> จึงเป็นแถวที่อยู่บนจอแล้ว ที่เปลี่ยนไปคือตอนนี้*พิมพ์จำนวนออกมา* การขยับจึงเห็นได้
> แทนที่จะเงียบ ซึ่งถูกทางสำหรับจอตรวจสอบ · **ทางแก้มีอยู่และยังไม่ทำ**: ตรึงเวลา
> ของแถวใหม่สุดจากการอ่านครั้งแรก แล้วส่งเป็นขอบบนของทุกหน้าถัดไป การเข้าใช้
> หนึ่งครั้งจะได้เดินบนภาพนิ่งภาพเดียว — เป็นการเปลี่ยนสิ่งที่ **ขอจาก endpoint**
> ไม่ใช่เรื่องของแถบ และควรถามก่อนทำ

`MAX_LIMIT` ยังเป็น 500 เท่าเดิม แต่ตอนนี้มันคุม**หนึ่งหน้า** ไม่ใช่หนึ่งการเข้าใช้
และหน้าที่ใหญ่ที่สุดที่จอนี้ขอคือ 100 · การเรียงเปลี่ยนจาก `{ createdAt: -1 }` เป็น
`{ createdAt: -1, _id: -1 }` ด้วย ซึ่งไม่ใช่การตกแต่ง: แอปนี้ตอบหลายคำขอได้ใน
มิลลิวินาทีเดียว และเมื่อสองแถวเวลาเท่ากันแต่ลำดับไม่คงที่ การอ่านสองครั้งที่ข้าม
คนละจำนวนแถวจะทำให้บางแถวโผล่ทั้งหน้า 2 และหน้า 3 ส่วนอีกแถวไม่โผล่เลย —
บนแฟ้มตรวจสอบ นั่นคือแถวที่คนตรวจไม่เคยได้เห็น

### ตอนต้องส่งสำเนาให้คนอื่น

**ดาวน์โหลด CSV ตามตัวกรอง** บนแท็บที่เป็นรายการแท็บไหนก็ได้ หรือ
`GET /api/exports/logs.csv?from=…&to=…` คำขอที่ฟีเจอร์นี้มีไว้รองรับ ไม่ได้มาจาก
คนที่จะได้ล็อกอิน สิ่งที่เขาขอคือสำเนาที่ครอบคลุมช่วงเวลาที่ระบุ และอ่านได้โดยไม่ต้อง
มีแอปนี้ ไฟล์นี้จึงมี**ทุก**คอลัมน์ รวมทั้งคอลัมน์ที่หน้าจอย่อไว้ — user-agent เต็ม ๆ
แทนที่จะเป็น "Chrome · Windows" และสาย forwarded ทั้งเส้นแทนที่จะเป็น hop แรก
งานของหน้าจอคือทำให้อ่านง่าย งานของไฟล์คือทำให้ครบ

### การใช้สิทธิ์พิเศษ — the compliance report

**เป็นแท็บที่ห้าของ บันทึกประวัติระบบ และเป็นแท็บเดียวที่ไม่ได้อ่าน `otAccessLogs`**
สี่แท็บข้าง ๆ คือข้อมูลจราจรที่หั่นมาสี่แบบ ส่วนแท็บนี้ตอบคนละคำถาม — *มีอะไรถูกทำ
ไปบ้างที่ตามกฎแล้วควรจะถูกปฏิเสธ และทำไมถึงอนุญาต?*

`otAccessLogs` ตอบคำถามนี้ไม่ได้ ห้าเหตุการณ์ที่สำคัญอยู่ในนั้นจริง ปนอยู่กับอีก
แสนเหตุการณ์ที่ไม่สำคัญ และ**ไม่มีเหตุการณ์ไหนถือ "ทำไม" มาด้วย** เพราะบันทึกจราจร
ไม่เคยอ่าน request body

**ห้าอย่างนั้น และเกณฑ์ที่ใช้คัด** เกณฑ์ไม่ใช่ "สำคัญไหม" แต่คือ *ถ้าคนทำเป็นคนอื่น
เรื่องนี้จะถูกปฏิเสธหรือไม่ และระบบประกอบเหตุผลขึ้นใหม่เองไม่ได้ใช่หรือไม่* มีห้าอย่าง
ที่ผ่านเกณฑ์ และมันคืออำนาจเฉพาะ ผู้ดูแลระบบ ในตารางข้างบนพอดี บวกอำนาจของ
ฝ่ายบุคคล อีกหนึ่งข้อที่มีรูปร่างเดียวกัน:

| ประเภท | คืออะไร | ต้องมีเหตุผลไหม |
|---|---|---|
| `password_reset` | บัญชีหนึ่งถูกคนอื่นตั้งรหัสผ่านใหม่ให้ หรือถูกตั้งโดย `npm run reset-admin` | ไม่ |
| `admin_override` | ผู้ดูแลระบบ เซ็นขั้นหัวหน้าในที่ที่ไม่มีหัวหน้าคนไหนเซ็นได้ | **ต้อง** |
| `role_change` | บทบาท ข้ามเข้าหรือข้ามออกจาก ฝ่ายบุคคล / ผู้ดูแลระบบ | ไม่ |
| `code_change` | รหัสพนักงาน ถูกเปลี่ยน | **ต้อง** |
| `replay_approved` | ใบที่มีคนเซ็นแล้วถูกคำนวณใหม่ (`includeApproved`) | **ต้อง** |

> **เคยมีหกอย่าง** ประเภทที่หกคือ `period_reopen` — "งวด ที่ปิดแล้วถูกเปิดคืน,
> **ต้อง**ระบุเหตุผล" — ถูกถอนไปพร้อม ปิดงวด เมื่อ 2026-08-31 (ดู
> `lib/periodStatus.js`) **ไม่มีแถวไหนหายไปจากไฟล์เก่า** เพราะ `otPeriodLocks`
> ว่างมาตลอด ไม่เคยมีงวดไหนถูกปิด จึงไม่เคยมีการเปิดคืนให้บันทึก

การเลื่อนจาก `employee → manager` **ไม่อยู่**ในนี้ — นั่นคือการรับคนเข้าทำงานตามปกติ
และการใส่มันลงไฟล์ก็คือการกลบบัญชีที่กลายเป็น ผู้ดูแลระบบ ให้จมหายไป การอนุมัติ
ตามปกติ การแก้ไขตามปกติ และการเปิดอ่านทุกชนิดก็ไม่อยู่เช่นกัน: มันคืองานประจำวัน
มันอยู่ในสามแท็บข้างบนและอยู่ใน ประวัติ ของแต่ละใบอยู่แล้ว และไฟล์ตรวจสอบที่รวม
พวกนั้นเข้าไปด้วยคือไฟล์ที่ไม่มีใครอ่านจนจบ

**ช่อง เหตุผล ที่ว่างคือสิ่งที่ตรวจพบ ไม่ใช่ปัญหาการจัดรูปแบบ** — สามในห้าอย่างนั้น
ทำไม่ได้เลยถ้าไม่มีเหตุผล หน้าจอบอกจำนวนไว้เหนือตาราง และ CSV ปล่อยช่องนั้นให้ว่าง
จริง ๆ มันจึงเรียงและกรองในฐานะช่องว่างได้ใน Excel

**เฉพาะ ผู้ดูแลระบบ และไม่ใช่ ฝ่ายบุคคล เด็ดขาด — เพราะพวกเขาอยู่ *ใน* ไฟล์นี้**
ทุกรหัสผ่านที่ HR ออกให้คือหนึ่งแถว และบัญชีล็อกอินของ ฝ่ายบุคคล ใช้ร่วมกันทั้งแผนก
(`hr-account-is-shared`) สำเนารายการการใช้อำนาจพิเศษของตัวเองที่พวกเขาหยิบไปได้เอง
จึงไม่ใช่หลักฐานเกี่ยวกับ "คน" คนใดคนหนึ่ง เส้นเดียวกันและเหตุผลเดียวกันกับสี่แท็บ
ข้าง ๆ

**ไม่มี `?actor=` โดยตั้งใจ** ต่างจากการส่งออกข้อมูลจราจร จุดสำคัญของไฟล์นี้คือมัน
*ครบสำหรับช่วงเวลาหนึ่ง*: "PM-0620 ทำอะไรไปบ้าง" เป็นคำถามที่ไฟล์นี้ตอบได้ด้วยการ
ถูกอ่าน ส่วนพารามิเตอร์ที่คืนค่าเพียงบางส่วน คือบางส่วนที่ภายหลังจะมีคนจำว่าเป็น
ทั้งหมด ช่วงวันที่และประเภทเหตุการณ์เป็นตัวกรองสองอย่างเดียวที่มี และทั้งคู่อยู่บน
ชื่อไฟล์เอง

```bash
# ทั้งไตรมาส ทุกประเภท
curl -o compliance.csv --cookie 'ot_token=<…ผู้ดูแลระบบ…>' \
  'http://127.0.0.1:3000/api/exports/compliance.csv?from=2026-07-01&to=2026-09-30'

# เฉพาะประเภทที่ตัวเลขขยับได้
curl -o compliance.csv --cookie 'ot_token=<…>' \
  'http://127.0.0.1:3000/api/exports/compliance.csv?from=2026-07-01&to=2026-09-30&kinds=replay_approved,admin_override'
```

สาม collection ออกมาเป็นเส้นเวลาเดียว **เรียงจากเก่าไปใหม่** — ต่างจากทุกหน้าจอใน
แอปนี้ เพราะไฟล์นี้ถูกอ่านในฐานะเรื่องราวของหนึ่งไตรมาส ไม่ใช่ถูกกวาดตาหาสิ่งที่
เพิ่งเกิดล่าสุด (จอที่ลิสต์ใบจัดกลุ่มตามรหัสพนักงานก่อนตั้งแต่ 2026-09-07 แต่
*ภายในคนคนเดียว*ยังใหม่ไปเก่าเหมือนเดิม — ดู §`เรียงตามลำดับตัวเลข`) กฎอยู่ที่ `lib/complianceExport.js` (บริสุทธิ์ ทดสอบที่
`test/complianceExport.test.js`) การอ่านอยู่ที่ `lib/complianceQuery.js` และหน้าจอ
กับไฟล์เรียกตัวโหลดตัวเดียวกัน จึงเป็นไปไม่ได้ที่สองอย่างนั้นจะรายงานคนละไตรมาส

---

## Layout

```
src/config/policy.js      every [OPEN] item as a named flag — start here
src/config/companies.js   the two payroll entities and the code-prefix rule
src/lib/otEngine.js       the arithmetic: segmentation, buckets, break, rounding
src/lib/csv.js            CSV in/out, UTF-8 BOM on the way out
src/models/               AccessLog, ApprovalDelegation, BirthdayCheck,
                          Department, Employee, EmployeeAudit, Holiday,
                          OtEntry, PolicyReplayRun, PolicyVersion, Setting
src/services/otService.js engine ↔ database: compute, cap check, replay
src/migrate-company.js    one-off: fill `company` on a pre-split database
src/migrate-policy-version.js
                          one-off: record the rules in force and point every
                          existing entry at them
src/reset-admin-password.js
                          the way back into an ผู้ดูแลระบบ account — server
                          console only, admin rows only, audited
app/api/                  the HTTP layer — auth, entries, departments,
                          employees, holidays, reports, exports, settings
app/layout.js, page.js    the shell; styles.css + print.css live here
components/               React UI + the three printable A4 forms
lib/                      request plumbing: db, session, http, route helpers
lib/policyVersion.js      what a rule set is, whether two of them compute the
                          same, and who a replay may touch — pure
lib/policySave.js         record the rules, then replay against them; shared by
                          both servers' settings routes
lib/proxyFiling.js        who may file OT on somebody's behalf, and where that
                          request starts — pure
lib/delegation.js         windows, the no-chains rules, who may approve and on
                          whose authority — pure
lib/delegationQuery.js    the reads and the clock behind it, kept apart for the
                          reason policySave.js is
lib/accounting.js         สรุป OT ส่งบัญชี, shared by its report and its CSV
lib/accountingRows.js     entries → rows, the hours that reach no row, and the
                          sheet's own reconciliation — pure
lib/accessLog.js          what a traffic record may say and may never say, how
                          an address and a request are read — pure
                          (พ.ร.บ. คอมพิวเตอร์ มาตรา ๒๖)
lib/accessLogWrite.js     the one mongoose call behind it, kept apart for the
                          reason policySave.js is
lib/requestContext.js     an AsyncLocalStorage scratchpad one request long — how
                          requireAuth puts a name on a log row without every
                          handler having to pass one
lib/departmentSummary.js  the same month regrouped by แผนก, both companies in
                          one count — shared by its screen, its CSV and its
                          printed form
lib/departments.js        who may write a แผนก row, and why `active` is the one
                          field ฝ่ายบุคคล do not get — pure
lib/complianceExport.js   which five events count as the exercise of a
                          privileged exception, and the row shape three
                          collections are normalised to — pure
lib/complianceQuery.js    the three reads behind it, kept apart for the reason
                          policySave.js is; one loader for the screen and the
                          CSV so they cannot disagree
lib/pdfExport.js          a print view as a PDF file: the standalone document,
                          the lock on markup that arrived from a browser, and
                          the headless Edge/Chrome already on the machine — no
                          dependency, and no second statement of the A4 layout
lib/printFile.js          what a saved sheet is called, and the DOM the file is
                          made from; one name for the print dialog and the
                          download, so one document cannot arrive twice
lib/smartDate.js          ปี พ.ศ. หรือ ค.ศ. — the one place that subtracts 543,
                          the one 2400, and the leap years judged in ค.ศ.;
                          read by the roster form, both roster endpoints, the
                          CSV importer and both holiday calendars — pure
lib/scanFile.js           the .txt a fingerprint scanner writes, read: two
                          machines, two line shapes, and the encoding decided
                          from the bytes (UTF-8 with a BOM, or TIS-620). Reads
                          dates through `smartDate`, so a machine set to
                          เดือน/วัน/ปี is refused line by line rather than
                          quietly believed — pure, so the preview in the browser
                          and the import on the server are one piece of code
lib/scanMatch.js          the row's own times against the scanner's file — a
                          QUESTION and never an arithmetic: nothing it returns
                          can move an hour, a bucket, a ceiling or a status.
                          Pure, so every edge (overnight, เหมารายวัน, the
                          morning punch that must not answer for an evening
                          request, the 17:00 nobody scans at) is a case rather
                          than a hope
lib/scanMatchQuery.js     the punches those rows need, in two queries whatever
                          the month's length — joined on `codeKey`, never on
                          `employee`, which is null for anybody the roster did
                          not hold on import day
test/                     131 files, run by `npm test`. Six named below as a
                          sample; docs/features.md maps every feature to the
                          files that cover it
test/proxyFiling.test.js    who may file for whom, and where it starts
test/delegation.test.js     windows, chains, cycles, and what the trail keeps
test/otEngine.test.js       worked examples A–E plus edge cases
test/reportColumns.test.js  no rate bucket lost between engine and paper
test/accountingReconciliation.test.js
                            no person's hours lost between database and paper
test/emptyMonth.test.js     a month with no OT still produces every document
```

The domain layer under `src/` is deliberately framework-free: models, services
and the engine know nothing about Next.js, so the whole suite — **2380 tests
across 131 files**, measured 2026-09-08 — runs with plain `node --test`, no
server and no database. Only `app/` and `lib/` touch the framework. (It read "2344 tests across 129 files … measured 2026-09-08" until **ประวัติเวอร์ชันนโยบาย ได้แถบเปลี่ยนหน้าแบบเดียวกัน** — fourteen more cases in `tablePager` and NO new file, because it is the same component under a third table. Two props were added for it. `unit` names what a row is called — "เวอร์ชัน" here against "รายการ" on the log — because the sentence is fixed (`แสดง 1–10 จากทั้งหมด 24 <unit>`) and a caller needing a different SENTENCE would be a caller this component is the wrong shape for. `SHORT_PAGE_SIZES` is 5 · 10 · 20, because a list that gains a row when somebody changes a rule — twenty-four of them here after a year, and the route stops at fifty — would offer `50` and `100` as two choices that both mean "all of it". **The cut is in the browser and the diff column is why**: the route computes each version's `changes` against `versions[i + 1]`, so a page fetched with `skip` would leave every page's oldest version without a predecessor in its own result, printing `ไม่ได้โหลดเวอร์ชันก่อนหน้ามาเทียบ` on nine rows out of ten that have one sitting a page away. A version means nothing except against the one before it, so the chain is loaded whole. The round also closed something the pager exposed rather than caused: the route has always stopped at fifty and nothing said so — the table simply ended, and its oldest row printed that same sentence, which reads as one row that could not be compared rather than as a list that was cut. `หน้า 3 / 3` is a claim about a whole list, so the route now sends `total` and the screen says which claim it is making — and "2313 tests across 128 files … measured 2026-09-08" until **ตารางทั้งสองบนบันทึกประวัติระบบ แบ่งหน้าแทนปุ่ม ดูย้อนหลังเพิ่ม** — `tablePager` is the 129th file, nineteen cases, and NO new component file: `TablePager` sits in `components/common.jsx` beside everything else both pop-ups and every screen share. Two tables on one screen are the reason it is one component — the traffic list under three of the tabs and การใช้สิทธิ์พิเศษ under the fifth, read by the same person in the same sitting, so two pagers built separately would be two answers to "what does › do at the end" and two ways of counting from 1. `HrView`'s own `.pager-row` is deliberately NOT folded in: it is a `<td colSpan={10}>` inside a `<tbody>`, `display: none` above 860px, laid out as a two-row grid for a 280px card, and one component whose layout is decided by which of three screens is asking is a component neither can be changed in. What they share is the VOICE — `‹`, `หน้า A / B`, `แสดง n–m จาก T รายการ`, a 38px square — shared by naming the same classes. **What was removed is a ceiling, not a button.** `limit` began at 100, ดูย้อนหลังเพิ่ม added 200 at a time to 500, and at 500 an amber panel said `แสดงได้สูงสุด 500 รายการต่อครั้ง` and offered the CSV: `hasMore` is a boolean, so the press was into the dark; the window only ever grew, so the way back was to change a filter; and past row 500 the answer to "what did this account open on Tuesday" was to download a file and open Excel, on the one screen in this app whose whole job is being read. `GET /api/logs` gained `skip` and a `countDocuments`, so `หน้า 3 / 47` is a fact and the last page is reachable — `MAX_LIMIT` is still 500 and now caps a PAGE, of which the largest this screen asks for is 100. The case that earns its place is the sort: `createdAt: -1` alone is not a total order, this app serves several requests inside one millisecond, and across two reads that skip different numbers of rows an unstable tie is a record that appears on page 2 and again on page 3 while another appears on neither — which on an audit log is a row that was never shown to the person auditing. `_id` is the tiebreaker. The specification asked for `disabled:opacity-40` on the chevrons and it is the one line of it that was not built: `.btn:disabled` declares `opacity: 1` on purpose, because a ghost faded to .4 is illegible on ธีมมืด, so a disabled end keeps its transparent ground and goes one step quieter instead — the same three properties the phone pager settled on in 2026-08-28. การใช้สิทธิ์พิเศษ cuts its page in the BROWSER and its route stays uncapped, because that loader is shared with the CSV and teaching it to skip would be the second way of reading one period; `ไม่มีการตัดท้าย` survives in the sentence under the table, because it was always a claim about the report and never about the layout — and "2306 tests across 128 files … measured 2026-09-08" until **ใบ F-HR-027 เป็น 1–31 ทุกเดือน และช่องลงชื่อตัดคำนำหน้าออก** — seven cases and NO new file, because neither half is a new subject: the grid is `oneRowPerDate`, which already owns which lines the sheet has, and the คำนำหน้า is `formSignatures`, which already owns what goes in the box. Four of the seven are the grid, and three of those are about the rows February gains rather than the count itself — that they carry a day number and `date: null`, that `byDate` is built from the dated rows alone so no segment can reach them, and that the sheet keys its rows by day number, since three rows with a null date would share one React key. The other three are the title: that นางสาว is tested before นาง, or `นางสาวปิยะนุช` signs as `สาวปิยะนุช`; that a name which is nothing but a title falls through to the next word rather than emptying a signature box; and that a title the list does not know prints as part of the name, where somebody can see it. — and "2319 tests across 128 files … measured 2026-09-07" until **การพับข้อความได้มาตรฐานเดียว หลังลองสามรูปในวันเดียว** — the case count came back to where it started, which is the honest record of a round that ended by putting two of its own answers back. The rule that survived is about WHICH text gets a control at all, and it has three parts. **A card's subtitle is drawn in full**: the grey line under นโยบายการคำนวณ or วันหยุดบริษัท is two or three lines and folds nothing worth a press. It was folded across nine components for an hour that afternoon, and what that bought was a screen opening on a heading and the word อ่านต่อ. **An alert's alarm is never folded**: it is read at the moment it is drawn or it is not read. That is why the long warning on that page was answered by making it SHORT rather than by hiding it — the heading became a count (`มีการปรับแต่งค่าจากโปรแกรมเดิม 3 รายการ`), the paragraph became one line pointing at the column the current values are in, and the three overrides became three chips. They are all amber: the chip carried the arithmetic flag in its COLOUR for a day, which put a grey chip in the banner's top half indistinguishable from the grey chips of ตรึงไว้เท่ากับค่าตั้งต้น in its folded half — two meanings in one shade — so every chip above the fold is now the one colour that means "this installation changed it", and whether it moves hours is said in the words inside it. What folds behind `ดูรายละเอียด` is the other half, the values stored at the figure the program ships today: nothing is wrong about those and nothing is being asked, and they matter on the day a release moves a default and this installation does not follow it. `LivePolicy` is named in `ALERTS_THAT_MAY_FOLD` as the only place a fold may appear inside an `Alert`, with a case pinning that its count, its sentence and its chips all stand outside — `UnrecordedPolicy` beside it stays whole, because it has a button in it and the paragraph a fold would hide is the reason that button exists. **The text under one setting is what the control is for**: นโยบายการคำนวณ asks nineteen questions and explains twelve of them under the question, the longest 671 characters, which is a dozen lines on a 360px phone. Two lines stay and the qualification folds. "Fewer than two lines" and "under about 150 characters" are the same rule, and only the first survives a 360px screen, so the button is still drawn from a MEASUREMENT of what the clamp hid. What moved in the markup is where the control sits: closed it rides the END of the second line, over the ellipsis the clamp draws, so `…อ่านต่อ` reads as the sentence continuing — a `--card-fade` gradient under an absolutely placed button, on the one background everything folded sits on. Open it is `ย่อข้อความ` at the foot of the block, where the eye is when the reading finishes. It was a link adrift on a line of its own before, which is what the round that showed nothing at all made obvious. The word grew its direction for the same reason: `ย่อ` alone is what บันทึกระบบ's cards say when they close a LIST of rows, and the two controls can be a thumb's width apart. `lines={0}` survives in three places. Two are the cards whose whole explanation IS bullets — ทะเบียนพนักงาน and ไฟล์สแกนนิ้วมือ — because a `-webkit-box` cut through a `<ul>` takes the markers with it and two bullets of six preview nothing. The third is นโยบายการคำนวณ, where the last change of the day moved the cut from a COUNT OF LINES to a POINT IN THE CONTENT: a row stands at its question and at `ค่าที่ใช้อยู่: …` — what the rule is set to, in the dropdown's own words — and what the question means, what each option is for and where the value came from are one fold under that line. It had two folds before, one either side of that sentence, so a reader met two อ่านต่อ per row before reaching the line most visits are for; a row with nothing behind its answer now draws no control at all, and the answer line itself is never folded, because a screen that asks for a signature and hides what is being signed for is the failure that whole row exists to prevent. What still cuts at two lines with `…อ่านต่อ` riding the end of the second is รายละเอียดงานที่ขอ OT on the approval card — and it read "2312 tests across 128 files … measured 2026-09-07" until **คู่มือเตรียมไฟล์บนการ์ดพนักงานถูกพับไว้หลังปุ่ม** (the shape above replaced this one the same day) — two cases in `birthDateImport` and NO new file, because folding a warning is not a new subject: the file that already pins the วัน/เดือน warning to that card is the file with a stake in where the warning went. Six bullets stood between the card's heading and its first control, which on a phone is a screen and a half of grey in front of ค้นหาพนักงาน — the reason for most visits to the card. Five of the six are a manual for a FILE, read once by whoever prepares the roster in Excel, and they went behind วิธีเตรียมไฟล์นำเข้า in the row beside นำเข้ารายชื่อจาก CSV. The sixth stayed, because it is a fact about the SCREEN rather than about the file: every change is recorded, including the ones typed into the dialog by hand and never near a CSV. The two cases are the pair that can go wrong on their own — the list unmounted rather than hidden in CSS, so nothing folded is read out, focused or measured; and the audit line standing above the fold rather than swept into it. It was not `Disclosure` at the time — that control clamped a PARAGRAPH and measured what the clamp hid — so this was a list folded whole, the way `ScanImport` then folded its รายละเอียด. Both of those sentences stopped being true within the day: `Disclosure` learnt to hide a whole body and to draw itself as a `<ul>`, and both ghost buttons went — and it read "2294 tests across 127 files … measured 2026-09-07" until **ไฟล์ Excel อัปโหลดได้ตรง ๆ ไม่ต้อง Save As เป็น CSV** — `xlsxImport` is the 128th file, eighteen cases, and the round is one dependency-free module: a .xlsx is a ZIP of XML, `node:zlib` inflates it, and `src/lib/xlsx.js` reads the two files inside that matter. The reason is not convenience. **`05/03/1998` is 5 March or 3 May and nothing in a CSV can settle it** — that sentence is why lib/birthDate.js exists, why the download template's sample day is 25, and why the import screen asks a person to read a list of spelled-out months before pressing the green button. It is a property of CSV, not of Excel: the workbook that CSV was saved FROM holds the date as a NUMBER, the same number on every machine on earth, with the display format kept separately. A roster imported as .xlsx cannot have its birthdays transposed at all, so the preview it would be checked with is not drawn and the panel says why rather than leaving a blank where a list should be. Six of the eighteen cases are dates — the 1900 leap-year bug Excel keeps for compatibility with a spreadsheet from 1983 (serial 60 is "29 February 1900", a day that did not happen, and is refused), the 1904 epoch Excel for Mac used, and a time of day dropped rather than rounded. The case that earns its place ahead of all of them is `a blank cell shifts nothing`: an empty cell is written `<c r="B2" s="1"/>`, and the first pattern this module used matched that self-closing tag and then ran on to the NEXT cell's closing tag hunting for a body, so every value after a blank landed one column left — which on the real department table read a shared-string INDEX out as a ceiling in hours. A number, in a column of numbers, that nothing downstream would have questioned. Two more pin that both importers go through one door and that the sniff is on the file's first four bytes rather than on its name, because `roster.csv` that is really a workbook is what "Save As" with the wrong type selected produces — and "2278 tests across 126 files … measured 2026-09-07" until **ไฟล์ทะเบียนพนักงานจริงนำเข้าได้** — `departmentMatch` is the 127th file, sixteen cases, and the round is the one that let the actual company in. `POST /api/employees/import` keyed a single map on `code.toUpperCase()` and tested บทบาท against `ROLES` directly, so the real roster — 163 people, PM and THT together, the file this system was built to hold — failed EVERY row on แผนก and 162 of them on บทบาท, because it is typed in Thai, which is the language every screen in the system prints those two columns in. `roleFromLabel` had existed with full tests since the labels did and nothing called it. Only four of the sixteen cases are about the generosity that repairs it — รหัส, ชื่อไทย and ชื่ออังกฤษ all reaching the row, with the unit word แผนก / ฝ่าย / สาขา optional, which is what the seven rows writing `ประสานงานขาย` for `แผนกประสานงานขาย` needed. The rest are the guard that makes generosity safe to have: an exact name always beats a prefix-stripped one, so a department really called `ขาย` keeps it from `ฝ่ายขาย`; and a key two departments would answer to answers for NEITHER, refused by name rather than resolved, because a matcher that guesses puts somebody's hours under another team's ceiling with nothing on any screen saying a choice was made. Two more are the template HR downloads to type into, whose own two sample rows named `ENG` and `PROD` — departments this roster does not have, so the file handed out to prevent errors contained two of them — and "2259 tests across 125 files … measured 2026-09-07" until **ข้อความอธิบายที่ยาวเกินหน้าจอ เริ่มพับเก็บได้** — `disclosure` is the 126th file, fourteen cases, and only three of them are about the control. The rest are about the ways a fold hides text for good: the cut is made in the STYLESHEET, so a folded paragraph is folded in the first paint rather than drawn in full and collapsed a frame later under somebody's thumb; and the button is drawn from a MEASUREMENT of what the clamp actually hid, never from the length of the string — an อ่านต่อ that reveals nothing is a press that appears to do nothing, and it would sit under half the rows on นโยบายการคำนวณ. Two more are the pair that cannot be got back by pressing anything: nothing is measured while the fold is OPEN, or ย่อ would disappear from under the reader when the clamp came off and the two heights agreed; and `@media print` unfolds every paragraph and drops the control, because paper has no button and a printed page carrying two lines of a rule would be reporting the screen rather than the text. One is the leading, which the walk on the built app turned up and which is part of the cut rather than a style choice: `.hint` gives 12.5px text an 18.75px line box and a line of Thai in it is 21px of ink, so a two-line clamp was showing the tops of the third line as a dotted row under the ellipsis. The last is the ban that keeps this one control the only one — a second line-clamp anywhere in the stylesheet, or one set inline by a component, is a clamp with no way to reach what it hid. It read "2282" for the afternoon the fourth F-HR-027 column existed; withdrawing that round took its cases with it — and "2240 tests across 124 files … measured 2026-09-07" until **ประวัติรายการ ในป๊อปอัปของผู้ตรวจ เลิกลิสต์แถวที่ระบบเขียนเอง** — `queueHistoryFilter` is the 125th file, thirteen cases, and only four of them are about the switch itself. Five are about the LIST it reads: that `recompute` is the whole of it today, that neither generated filing goes in (`submit_birthday` IS the request that put the entry in the queue, and hiding it leaves a reader looking for a filing that never comes; `submit_hr_verified` is a person reading a clock record and putting their name to two times), and that an entry which is nothing but replays draws no heading rather than a heading over nothing. Two are the regression the round could have shipped — `editsOf()` pairs each snapshot with the values it produced by reading the row BELOW it, so the walk still reads the full history and only the drawing is filtered; a filtered walk would hand an edit the "before" of the replay above it and print a change nobody made. The last two are where the switch is deliberately NOT thrown: ประวัติ OT ของฉัน and ฝ่ายบุคคล's month table, the two screens whose question is what has happened to this entry rather than who is being asked to sign it — and "2195 tests across 124 files … measured 2026-09-04" until **เรียงใบตามรหัสพนักงาน reached every list of ใบ rather than the two report screens alone** — six cases and NO new file, because the comparator is one function in `lib/entries.js` and the endpoint that reads it is one endpoint: five of the six are in `entryListCap`, beside the cap they have to be read with, since the query still orders by date and what a full list drops is still the OLDEST and not whoever falls past the middle of the register. — and "2165" until **a month of scanner files became FOUR files rather than two** — six more cases in `scanFile` and NO new file, because the reading did not change: what arrived is the other half of a file's identity. Two of the six are the machine numbering, which is a LABEL nobody can check against the bytes and is therefore pinned here; two are the company, decided from the roster and never from the `PM` / `THT` prefix, with a disagreement REPORTED rather than resolved; and two are the grid — that four is `SCAN_FORMATS.length × companies.length` and never a literal, and that a file which fits no slot is not quietly counted into one. — and "2157 across 121 files" until **the last twenty `<select>`s in the app became `PickOne`** — `noNativeSelect` is the 122nd file, four cases, and it is one rule over the whole tree rather than the per-screen bans that preceded it: no component draws a `<select>`, a `type="date"`, a `type="month"` or a `type="time"`, and every list that opens is `.pick-menu`. The fifth case is in `queueDropdown` and is the thing that had to exist before ทะเบียนพนักงาน could drop its tag — a row that is ON the list and is not this person's to take, refused to the pointer, to Enter, to ↑/↓, to Home/End and to the letter somebody types out of habit, because `<option disabled>` did all five for free and an `<li>` has none of them — and "2139 across 120 files" until **ไฟล์ .txt จากเครื่องสแกนนิ้วมือ became something ฝ่ายบุคคล can import from ตรวจสอบประจำเดือน** — `scanFile` is the 121st file, eighteen cases, and the samples in it are the two real files byte for byte rather than tidied-up ones: the TIS-620 header, the UTF-8 byte-order mark and the space padding are the whole of what the module has to survive. Only five of the eighteen are about reading a good line. The rest are the silent failures available to a file that arrives once a month from a machine nobody here configured — a header counted as a scan, `07/25` read as 7 January, a TIS-620 byte becoming `�` in the copy of the file the system keeps, and the same person at the same second stored twice — plus the one property that makes the preview checkable instead of believable: every line of the file lands in exactly one of four piles and the four add up. **Nothing in the app reads what it stores**, which is the state on purpose and is written into the model — and "2123" until **the question got a standing answer** — sixteen more cases in `birthDateImport`, for ตั้งค่าระบบ → รูปแบบวันที่ใน CSV and the decision that an unsettleable file is now READ under it rather than refused. Nine of the sixteen are the boundary rather than the feature: the interpreter called with no options still refusing, evidence still beating the setting and not being REPORTED as the setting, a month-first file still refused whatever is set, a self-contradicting file still refused, a per-file answer still outranking the company's, and a bad setting throwing instead of going quiet. The rest are the setting itself — it cannot hold a value the interpreter would throw on, it is not inside `policy` where it could mint a version, the screen previewing a file reads the same value the route will, and the panel says out loud which rows it read that way — and "2110" until **the ambiguous วันเกิด column started being a QUESTION** — thirteen more cases in `birthDateImport` and one rewritten in `smartDate`, for the round that let HR say "this file is วัน/เดือน/ปี" instead of being sent back to Excel to retype a column by hand. Eight of the thirteen are refusals that must SURVIVE the feature: a declaration the file contradicts, in both directions; a file that contradicts itself, under every declaration and none; an unrecognised order that has to throw rather than quietly become "nobody answered"; and the plain ambiguous file with nobody answering, which must be refused exactly as it always was. The other five are the promise the feature rests on — the answer comes from a person, the rows are read back before anything is written, and what travels with the upload is the answer rather than the dates the screen computed from it — and "2088" until **a refused roster CSV started naming every line it was refused over, `01/01/2540` stopped being called ambiguous, and the picker moved to the sentence telling HR to use it** — eleven cases in `birthDateImport` and NO new file, because the interpretation rule did not change then: the three refusals are the same three, and what they now carry is `blocking`, the whole of the evidence rather than the first line of it. Four are about that list — every ambiguous row, both sides of an inconsistent file in line order, the ambiguous rows that ride along with a month-first one because they are wrong too, and the empty list a file that IMPORTS has to keep. Four are the case that had no business being refused at all: a cell whose day and month are the SAME NUMBER reads identically either way, and it was being listed as `เป็นได้ทั้ง 1 มกราคม 1997 และ 1 มกราคม 1997` and helping refuse whole files over a doubt with no consequence — with one of the four on the template, which wrote `1989-05-12` and so could not survive being opened and saved in the Excel it is handed to somebody to type into. The other three are about the screen: the panel that lists the lines, the server refusal that used to arrive as one sentence with its payload dropped, and the error message that had no way off the card. The rest of the move to 2108 landed in the same tree from the queue and roster work, not from this round — and "2074 across 119 files" until **the queues of the four who sign the first step started listing a request until it is confirmed** — `queueRoleFilter` is the 120th file, and the fourteen cases in it are mostly not about the `บทบาท` dropdown that was asked for: they are about the two silent failures the round could have shipped, a queue offering a decision on a row its reader may not sign, and a filter the SCREEN sets that empties the table without saying it did — and "2071" until **ตั้งรหัสผ่านของคุณ was deleted** — the screen an account with `mustChangePassword` used to meet before anything else. One case in `tempPassword` and NO new file: the case that used to say the flag reaches a gate now says it reaches a strip on the landing tab, and bans the gate coming back under any name. The count moved by one because the sentence naming the character set went from being asked for on two screens to being banned everywhere but the form — and "2000 across 118 files" until **บันทึกเป็น PDF started producing a file** rather than naming a destination in the browser's own print dialog — `printPdf` is the 119th file, twenty-six cases, and eleven of them are one table: every way a script, a frame or a fetch can be spelled in markup that arrives from a browser, each its own case, because the failure that matters is ONE of them starting to get through while the rest still do not. The cases that are not about that lock are about the promise the feature rests on — that the file is the DOM the printer would have been given, never a second rendering of the month — and the one print view that refuses to make a file at all, which is the password slips — and "1983 across 117 files" until **บทบาท went from four to seven** — `roles` is the 118th file, seventeen cases, and only the first handful are about the seven themselves: the rest are about the rename underneath them, because the retired `manager` used to BE a role and used to mean หัวหน้างาน. The two that earn the file are the ban on that spelling returning to `app/`, `lib/`, `src/`, `components/` or `legacy/` — with `hrRejectReturnsTo` and `Department.manager` named as the only lines allowed to keep it — and the case that fails if `ROLES` is ever tidied into alphabetical order, which would silently make ผู้ดูแลระบบ the lowest rung because `outranks` reads its answer off that array's index — and "2096 across 122 files" until สวัสดิการวันเกิด went back to being filed by the person whose birthday it is and ฝ่ายบุคคล’s birthday work was withdrawn — the only round in this history where the file count went DOWN: seven files left (absentCallout, birthdayCardUi, birthdayCheck, birthdayDirectApproval, birthdayFileSheet, birthdayQueue, birthdaySelfFiling) and two arrived, `birthdayTick` for the claim the tick makes and `flatDaily` for the eight-hour day — and "2070 across 121 files" until ฝ่ายบุคคล's queue started listing a request from the moment it was filed — `queueStatusColumn` is the 122nd file, twenty-one cases, and only four of them are about the สถานะ column that was asked for: the rest are about what a queue has to stop offering once it holds a row its reader cannot sign, and about the two things the twelfth column pushed out of shape — the sentence that stands in place of a row's buttons, and the ceiling figure that went under them — and "2060 across 120 files" until Ctrl+P on รายงาน OT ฝ่ายบัญชี stopped dropping the last three columns — `screenTablePrint` is the 121st file, seven cases, and two of them pin rules that go AGAINST a browser default rather than with it: `@page` stays at margin 0, and `tfoot` is forced back to a row group so รวมทั้งหมด cannot reprint at the foot of every page — and "2033 across 119 files" until หนึ่งวัน หนึ่งใบ reached the printed sheet as well as the filing form — `oneRowPerDate` is the 120th file, fifteen cases, and the ones that matter are about the hours the sheet now drops rather than the rows it no longer draws — and "2025" until หน้ารายละเอียด on รายการ OT ของฉัน started drawing the reviewer's three cards — eight new cases in `approverLine`, and NO new file, which is the point of that round: `ReasonCard`, `CapCard` and `SignatureFacts` moved into `components/common.jsx` and both pop-ups read them, so what would have been a second file of assertions about a second copy is two blocks added to the files `description` and `queueCapUsage` already had — and "2006 across 118 files" until the two ลงชื่อ columns on F-HR-027 started printing the names — `formSignatures` is the 119th file, nineteen cases, and most of them are about the rows where a name may NOT be printed — and "1996 across 117 files" until the hour figures on F-HR-027 and the `รวม ชม.` beside them stopped sitting against their right edge — `hoursColumnCentred` is the 118th file, ten cases, and six of the ten pin things that did NOT change: the sheet's headings, the blank an hour cell keeps when the day has no OT, and the 52px the screen's columns are still measured at — and "1977" until signing an entry over a department ceiling started costing a sentence — `overCeiling` is the 117th file, nineteen cases across the rule, the two routes that enforce it, the sheet that prints it and a ban on a second `isOverCeiling` boolean — and "1940" until the era rule stopped being written in four places — `smartDate` is the 116th file and nineteen of the cases added since that figure are its: the rule itself, the 2400 line from both sides, the calendar judged in ค.ศ., the MM/DD refusal that names the swap, and the two bans that are the point of the file — no other file in `app/`, `lib/`, `src/`, `components/` or `legacy/` may subtract 543 or compare a year to 2400 — and "1932" until the roster CSV started converting พ.ศ. years instead of refusing them — `birthDateImport` traded three cases that pinned the refusal for eleven about the conversion, the 2400 floor, both separators, the calendar being checked in ค.ศ., and the count the preview has to show — and "1931" until the สถานะ paragraph in แก้ไขแผนก went behind a (?), and "1915" before that, until คำขอถอนใบที่อนุมัติแล้ว learnt to answer several at once — nine new cases in `withdrawalRowLayout`, covering the heading's count, the 400px ceiling on the stack, and the shape of อนุมัติให้ถอนทั้งหมด — with seven more landing in the same tree from the roster work, and "1912" until the same row lost the green `อนุมัติ` pill that was being read as a third button, and "1901 across 114 files" before that, until the row on คำขอถอนใบที่อนุมัติแล้ว stopped being a flex line with one shrinkable item in it — `withdrawalRowLayout` is the 115th file — and "1894" and "1896" until เวลาเริ่ม / เวลาสิ้นสุด became a header you can type in over two snapping wheels — six new cases in `pickTime`, and the two figures either side of it are one round of the same control and one round of doc-and-script work landing between them — and "1896" before that, until `PickOne`'s panel was portaled — four cases about placing itself in the page became two about not having to — and "1894" before that, until the minute column started stepping by five, and "1891" until บันทึก OT แทนพนักงาน lost its sub-header and its two panels of prose, and "1889" until the sentence under วันที่เริ่ม was rewritten and then withdrawn — submissionWindowForm gained a comment-stripper self-test and split one assertion in two, and the pair that pinned the new wording became the pair that bans both wordings — and "1888" until the panel's own width was pinned, and "1887" before that, until สถานะที่นับ on ตรวจสอบรายเดือน stopped being a `<select>` too — the twenty-first and twenty-second cases in queueDropdown, and no new file — and "1820 across 110 files" until the queue's two filters stopped being `<select>`s — queueDropdown is the 111th file — and "1805 across 109 files" until the ค้นหา box went over บันทึก OT แทนพนักงาน's name list — and "1814", "1816" and "1818" as the tick box, the button and the queue's head each got their own — and "1797 across 108 files" until the menu was reorganised one block per role and roleNavTabs went in to hold it there, and "1792 across 107 files" until the fourteen-day chart on ภาพรวม was given a height to draw its bars in, and "1785 across 106 files" until the four counted lists on ภาพรวม stopped each opening on however many rows the endpoint had sent them, and "1776 across 105 files" until the ลบ button on วันหยุดบริษัท stopped asking its question in the browser's own box, and "1763 across 104 files" until สวัสดิการวันเกิด stopped being something a person could file for themselves — birthdaySelfFiling is the 105th file — and "1757" until หนึ่งวัน หนึ่งใบ, and "1753" until เวลาทับซ้อน reached the form later the same day, and "1780 across 106 files" until the withdrawal of ปิดงวด later the same day took two whole files with it — periodLockRoutes and replayPeriodLock — and rewrote a third, and "1767", "1766", "1764", "1757", "1752 across 105 files", "1751", "1750", "1748", "1745", "1729 across 104 files", "1728", "1727", "1722 across 103 files" and "1723" earlier the same day — two cases about `backdrop-filter` became one when the filter itself went — and "1722", "1721" and "1720" before that, and "1719", "1718", "1717", "1715" and "1713" on 2026-08-27, "1707 across 102 files" on 2026-08-26, and
"1706", "1701", "1700", "1699", "1697", "1694", "1689", "1687", "1678" and "1672" earlier the same day and "1654 … 2026-08-25" before that, and
was already five behind when the "1701" was re-checked. The file count read
"101 files" through all of them and moved with
`test/entryRowChrome.test.js`.)

That is also why it stays fast: the suite finishes in **about 2 s**, which is a
budget rather than an observation. (It read "410 tests, under 400 ms" until
2026-08-25 — the budget is per test, and four times the tests for five times
the time is the budget holding, not slipping.) A test file that reaches for a
model drags mongoose into a suite that never opens a connection and costs a
third of a second on its own — which is exactly why the mongoose call behind a
write lives in its own file, `lib/policySave.js` beside the pure rules it uses.

`legacy/server.js` and `legacy/routes/` are the retired Express implementation.
**There is no npm script that starts it any more** — this paragraph said
`npm run legacy:start` and named the files under `src/`, both true before the
folder was moved. Run it by hand if you ever need the comparison. Delete the
folder once you are satisfied the port is faithful.

**It is no longer a faithful copy and is not being kept as one.** It drifted
first at the re-filing chain (`refiledFrom` / `resubmittedTo` were never ported)
and now again at proxy filing and delegation: `legacy/routes/entries.js` knows
nothing about `filedBy`, and its approve and reject handlers still carry the
role-and-status ladder that `lib/delegation.js` replaced. Rules that must hold
everywhere — `authorizeReplay`, `savePolicy` — are still shared by both servers
on purpose; this feature's are not, because the Express entry routes are no
longer a path anybody can reach.

### The engine is pure

`src/lib/otEngine.js` has no database, no clock, and no timezone. It takes wall
-clock strings and returns segments. That is deliberate: everything the
requirements call "the arithmetic, and the arithmetic is what the whole system
exists to get right" is testable without a running server, and a timezone can
never silently move a date.

Sessions are stored as `workDate` + `startTime` + `endTime` + `endsNextDay`
(§12.2), not as timestamps. The paper form has one row per date, and wall-clock
fields map onto it one-to-one.

---

## The twelve [OPEN] items

All twelve are implemented as **configuration, not assumptions**. Change one
value in [`src/config/policy.js`](src/config/policy.js) — or flip it at runtime
under **ตั้งค่าระบบ → นโยบายการคำนวณ** — and nothing else needs touching.
Changing an arithmetic flag replays every entry still in flight through the
engine; entries already approved are left alone, because silently restating a
signed-off number is worse than an inconsistency.

| # | Question | Default shipped | Flag |
|---|---|---|---|
| 1 | Break on every session? | Only the part overlapping 12:00–13:00 | `breakMode: 'lunchWindow'` |
| 2 | Overnight: one break or two? | One per lunch window crossed | `breakPerCalendarDay: true` |
| 3 | Round down / up / nearest? | Down, per bucket, to 30-minute blocks, forgiving nothing | `roundingMode: 'floor'`, `roundingIncrementMinutes: 30`, `roundingGraceMinutes: 0` |
| 4 | Under 1 hour: accept, raise or reject? | Accept the real hours, flag for HR ⚠ | `belowMinimum: 'accept'` |
| 5 | OT starts 17:00 or 17:01? | 17:00 — 17:00–20:00 is 3 h | `otStartsAtCoreEnd: true` |
| 6 | Per-department shifts? | No | `shiftPatternsEnabled: false` |
| 7 | HR reject after manager approved? | Yes, back to the employee | `hrMayReject`, `hrRejectReturnsTo` |
| 8 | Cap hit: block or warn? | Warn, flag for HR | `capBehaviour: 'warn'` |
| 9 | Cap counts clock or weighted hours? | Clock (example D = 14) | `capBasis: 'clock'` |
| 9 | Where does a week begin? | Monday–Sunday | `weekStartsOn: 1` |
| 10 | Holiday calendar format? | Both paths built | CSV upload + manual entry |
| 11 | Roster as a file or typed in? | Both paths built | CSV upload + manual entry |
| 12 | HR boxes: raw or multiplied? | Raw hours | `hrSummaryBasis: 'raw'` |

Two later flags sit beside them, both COSMETIC and neither an [OPEN] item:
`proxySkipsOwnApproval` (default `true`) and `proxyNoteOnForm` (default
`false`) — see [หัวหน้าบันทึก OT แทนลูกทีม](#หัวหน้าบันทึก-ot-แทนลูกทีม).

### What HR sets about the arithmetic itself

Four of the rows above are the whole of how a session's minutes become hours,
and they are read in this order — break, buffer, block, minimum:

| Setting | Flag | Offered | Ships as |
|---|---|---|---|
| วิธีการปัดเศษ | `roundingMode` | ปัดลงทั้งหมด · ปัดขึ้นทั้งหมด · ปัดเข้าหาค่าใกล้ที่สุด · คิดตามจริงเป็นทศนิยม | `'floor'` |
| ปัดเศษทีละกี่นาที | `roundingIncrementMinutes` | 5 · 10 · 15 · 30 · 60 | `30` ⚠ |
| ผ่อนปรน — ใกล้ครบบล็อกแล้วปัดขึ้นให้ | `roundingGraceMinutes` | ไม่ใช้ · 5 · 10 · 15 | `0` — off ⚠ |
| เวลาขั้นต่ำในการเริ่มนับ OT | `minimumBufferMinutes` | ไม่ใช้ · 5 · 10 · 15 · 30 · 60 | `0` — off |

**`'exact'` is a fourth answer, not a fourth block.** It rounds nothing and does
not read the increment — and does not clear it either, so switching back to
floor/ceil/nearest restores whichever block HR last chose.

**ผ่อนปรน is the last few minutes of a block rounding up instead of down.**
Added 2026-09-02 on a request for "บวกลบ 5 หรือ 10 และ 15 นาที", with 29 นาที →
0.5 ชม. and 55 นาที → 1 ชม. as the worked examples. The floor is unchanged
underneath it — a session that has not reached the window still rounds down, so
under floor/30 with a grace of 5: 24 → 0, 25 → 30, 49 → 30, 55 → 60. The ลบ half
needs no setting; the block already does it, and this key only ever adds.

- **Read under `'floor'` alone.** `'ceil'` rounds every remainder up already,
  `'nearest'` forgives half a block by construction, `'exact'` rounds nothing.
- **A grace of half a block *is* `'nearest'`,** minute for minute — 15 under a
  30-minute block, 30 under a 60-minute one. Two ways to one rule, not a stack.
- **Ignored, never clamped, when it is not smaller than the block.** 15 on a
  15-minute block would hand a whole block to a session of nought, so the engine
  falls back to the plain floor and the row says so rather than quietly running
  a 7.5 nobody chose. `roundingGraceOf` in
  [`src/lib/otEngine.js`](src/lib/otEngine.js) is the single place that decides
  this; `roundingZeroesUnder` and the badge's reading both import it.
- ⚠ **It moves the line short work is refused at.** Rounding alone zeroes
  everything under `increment − grace`, not under `increment` — so floor/30 with
  a grace of 10 stops refusing the 20–29 minute callouts it used to refuse, and
  `minimumBufferMinutes: 0` becomes an unanswered question again. The two are
  one question asked twice.

**The buffer is not a second `minimumHours`.** They answer different questions
and run in that order:

- **The buffer** asks *was any of this OT at all?* Measured on the minutes as
  worked — after the break, **before** rounding, so 25 minutes under a 30-minute
  buffer is nought whatever the block would have made of it, and 35 minutes goes
  on to the block like any other session. Measured on the **whole entry**;
  `minimumHoursScope` is the 1-hour minimum's scope and does not reach it.
- **`belowMinimum`** asks *the OT there is came to less than an hour — accept it
  and flag it, pad it, or refuse the entry?*

A session the buffer zeroed **skips the minimum entirely**. That ordering is the
point: run the other way, `belowMinimum: 'raise'` would pad a 25-minute callout
back up to a full hour and invert both answers at once. There is nothing short
left to raise — the session is not short OT, it is not OT.

Such a session is **refused at the form** rather than stored as a nought, like
every other 0-hour result (see [A request that computes to nothing is refused, in
words](#a-request-that-computes-to-nothing-is-refused-in-words)) — and the
sentence names the buffer, because the date, the times and the length are all
correct and every other explanation would send somebody back to a form that is
already right. A replay refuses too: an entry already filed keeps the hours it
was filed with and is reported as skipped, rather than being quietly emptied in
somebody's queue.

⚠ **Five- and ten-minute blocks, and `'exact'`, do not land on two decimals.**
Hours are stored to 2 dp throughout (`minutesToHours`), so 20 minutes is 0.33 h
and two such columns can print 0.33 + 0.33 against a total of 0.67. Nothing is
lost — every figure is stored in the unit it is printed in — but a form whose
columns miss its total by 0.01 is a question somebody will ask. Blocks of 15, 30
and 60 are exact at two decimals and cannot drift.

### ⚠ Six of these are unrecorded, and the system says so

"Default" covers two very different things, and printing both the same way is
how one of them gets forgotten. Most rows above are a recommendation from the
requirements doc that nobody has objected to. Six are something else. Four are
values **reverse-engineered from how the old paper appears to have been filled
in**; the other two are values nobody ever gave at all. Each one can move hours,
and none of them is on the record.

It read "Five of these are unrecorded" until 2026-09-03, and "Four of these are
**unanswered**" until 2026-09-02. HR answered the rounding increment out loud on
2026-09-02 — 30 นาที — and the badge stayed up, correctly: what this list tracks
is whose answer is **recorded**, and a rule agreed to in a corridor is exactly as
unrecorded as one
nobody has considered. Pressing ยืนยัน is the act that writes down who said it
and when. The fifth item arrived the same day, and the sixth on 2026-09-03.

| Question | What the system does today | Why it is that |
|---|---|---|
| Rounding direction | **Down** — a part-block is cut (`roundingMode: 'floor'`) | Added 2026-09-03, and it was missing for the opposite reason to every other item here: not overlooked, but written down as **answered**. The badge originally sat on `roundingMode`'s row as a stand-in, because the increment was a number in the file with no row of its own. When the increment got its dropdown on 2026-09-02 the badge moved onto it — correctly — and this table gained the sentence "`roundingMode` is *not* unconfirmed — `'floor'` is the doc's own recommendation." **That is what every other item in this list is**: `belowMinimum` and `minimumHoursScope` are here on exactly those grounds. Retiring a stand-in had quietly recorded the rule it stood in for as settled. **HR's answer of 30 นาที sizes the block and does not say which way a part-block goes** — the two readings of their sentence are 29 นาที → 0 ชม. and 29 นาที → 0.5 ชม. It moves more hours than anything else on the list. **A proposed answer was written up on 2026-09-03** — `nearest`, block 30, buffer 0, grace 0 — with the reasoning, the evidence and the impact in `docs/hr-briefing.md`. It is a proposal: nothing on the machine has been changed for it |
| Rounding increment | 30 minutes (half hour) | The requirements doc, and what every figure in the database was computed with. The badge used to sit on `roundingMode`'s row for want of one of its own; the increment has its own dropdown now, so it moved — and the direction kept a badge of its own, see the row above. **HR answered this on 2026-09-02: ปัดเศษทีละ 30 นาที**, which is the value already running. Nothing changes and nothing replays. It read "the badge comes off when somebody presses ยืนยัน" until 2026-09-03 — **it was pressed on 2026-09-02 at 16:09 and the badge is up again**, for a different reason: the sign-off was recorded against `{ roundingIncrementMinutes: 30, roundingGraceMinutes: 0 }`, because the grace shared this badge that morning. The grace moved to 5 that afternoon, so the signature no longer covers what is running and the item reports itself unconfirmed again. **That is the merge this catalogue was split to prevent, and it had already happened before the split** — the sign-off records HR as having chosen ผ่อนปรน: ปิด, which is a value nobody put to them |
| ผ่อนปรนการปัดขึ้น | **5 minutes** on this machine (`roundingGraceMinutes`), so 25–29 minutes reaches the buffer as half an hour. It ships at 0 and the table read "**Off — 0**, so 29 minutes is nought and the entry is refused" until 2026-09-03 | Added 2026-09-02 for "บวกลบ 5 หรือ 10 และ 15 นาที". It shared the increment's badge for one morning, on the reasoning that the block and the grace are one answer — and was split back out the same afternoon, when HR answered the increment and said nothing about the grace, which did not exist when they were asked. One badge over both would have made ยืนยัน on their answer *also* record them as choosing ปิด. **A badge covers exactly as much as one answer covers**: splitting a question HR answers in one breath makes them press twice, merging two they answer separately puts their name on something they never said, and only the second is a lie |
| Under the 1-hour minimum | Record the hours actually worked and flag the entry (`belowMinimumFlagged`) | The reading that keeps every answer open. It was `'reject'` — read off a `'reject'` override that sat in `settings` against a file saying `'raise'` — and refusing the entry means not recording work that was done, which is a liability rather than a conservative default. It read "HR has still not answered, so the badge stays" until 2026-09-03 — **somebody pressed ยืนยัน on this machine on 2026-09-02 at 16:09**, through the shared ฝ่ายบุคคล account, so the record now names an account rather than a person. Whether that was an answer or a pass through the settings page is not something a signature can say |
| What the minimum applies to | The **whole entry** — every bucket summed, then compared to 1 h (`minimumHoursScope: 'sheet'`) | `computeSession` has only ever done it this way, and it is the reading that refuses least. The per-column reading is `'bucket'`: the same rule asked of each rate column, so a Friday-night shift running into Saturday is measured twice. Having a flag is not an answer. It read "HR still has not given one, and the badge now sits on the dropdown" until 2026-09-03 — this was also signed on 2026-09-02 at 16:09, six seconds after the row above it |
| Start buffer — เวลาขั้นต่ำในการเริ่มนับ OT | **30 minutes** on this machine (`minimumBufferMinutes`); it ships at 0, and this column read "**No threshold — 0**" until 2026-09-03 | Added 2026-08-13 on HR's request, with 30 นาที used only as the worked example in the ask, never as an instruction. It ships at 0 because any other value would have restated hours for a rule nobody had switched on — and 0 is the *absence* of a guess rather than a guess, which is why it carried no badge until one was added. ⚠ It is **inert** only while rounding already refuses everything it would refuse: floor/30 with no grace zeroes every session under a block, so a buffer up to 30 changes nothing but the wording of the refusal. A grace lowers that line to `30 − grace` and the buffer starts biting from there — which is why the settings row derives its note rather than stating a number. ⚠ **It runs *before* the grace, on the minutes as worked**, so a buffer set above that line cancels the grace over exactly the range the grace was turned on for. That is the state this machine has been in since 2026-09-02: grace 5 opens 25–29 minutes, buffer 30 refuses them anyway. The two are one question and have to be answered together |

These carried a **รอ HR ยืนยัน** badge on ตั้งค่าระบบ → นโยบายการคำนวณ, and
pressing ยืนยัน recorded who signed one off and when — it changed no value,
appended no policy version and replayed nothing, which was enforced
structurally: the records lived on `Setting.policyConfirmations`, a *sibling* of
`Setting.policy`, so they could not reach `canonicalPolicy`, a `policyHash` or
the engine. Six items, an amber pill per row, and a sign-off form under each one.

⚠️ **THE WHOLE MECHANISM WAS WITHDRAWN ON 2026-09-08, ASKED FOR AND CONFIRMED**
— the list, the badge, the form, both endpoints, the two lib files that held the
rules and the one mongoose call behind them, and the field. The reason given was screen clutter,
and it was real: the form was a labelled text box, a button and a grey sentence
drawn open on every unanswered row at once, four to six of them on one page.

**What it cost is this table.** Nothing on any screen now separates a rule
ฝ่ายบุคคล actually answered from a rule this system read off the old paper —
they print identically, as "ค่าเริ่มต้น", which is the exact confusion the list
existed to undo. The questions themselves did not close: the rows below are
still the six, they still move hours, and this README is now the only place that
says so. The records already written are still in the database and are not ours
to delete — see the note where the field used to be in
[`src/models/Setting.js`](src/models/Setting.js), and the longer one where the
list used to be in [`src/config/policy.js`](src/config/policy.js).

All six sat on a dropdown by the end. Two of them did not at first: the
minimum's scope was a rule the engine had and the policy had no key for, and the
rounding increment was a number in `src/config/policy.js` with no row on the
page. Both borrowed a neighbouring row, or none at all, until the flag they are
about existed. Having a dropdown was not an answer, and neither is having been
told one in a meeting.

**Two of the five are the same question.** The start buffer asks "was this OT at
all"; the rounding increment answers it as a side effect, because a session
shorter than one block floors to nought and is refused before the buffer is ever
consulted. Verified against the engine on 2026-08-14: `--set
minimumBufferMinutes=15` and `=30` both report no entry affected, and that is the
rules overlapping rather than a thin database. The consequence is a trap worth
stating out loud — answering the buffer "0" is only correct *while rounding
alone refuses everything under 30 minutes*, and there are now two ways to stop
that being true: lowering the increment, and turning on ผ่อนปรน. Either one
makes the buffer a live question again with its badge already cleared.
[`src/config/policy.js`](src/config/policy.js) says so on all three keys, and
`roundingZeroesUnder` in [`lib/policyInert.js`](lib/policyInert.js) derives the
line rather than stating it, so the settings row cannot go stale.

### Why OPEN 1's default is the lunch window, not a threshold

The doc suggests either a duration threshold or the 12:00–13:00 window. Only
the window is consistent with the worked examples. A 5-hour threshold would
deduct an hour from example **D** (Fri 17:00 → Sat 07:00, 14 clock hours),
making it 13 — but the doc states D is 14. The lunch-window rule reproduces all
five examples untouched, and it settles OPEN 2 structurally: a 17:00 → 07:00
session crosses no lunch window, so it deducts nothing.

`test/otEngine.test.js` pins this — there is a test asserting the threshold
mode gets D "wrong", so the reasoning survives whoever reads it next.

The lunch-window rule also puts the deduction in the right *bucket* for free:
the break is removed as a hole in the session, so an hour taken during holiday
core hours comes off the ×1.5 column, not the ×3 one. A flat deduction has no
principled bucket to come out of.

### OPEN 6 is not really a config flag

If HR answers "yes, shifts differ by department", `shiftPatternsEnabled` is not
enough. Shift patterns change what "outside 08:00–17:00" *means* per employee,
so `coreStartMinute`/`coreEndMinute` have to move off the global policy and onto
the employee or department record, and the engine needs a per-day shift lookup
rather than two constants. That is a schema change. It is the one open item
that can still cause structural rework, which is why the doc's own "answered
maybe" is worth pushing on.

### Two ceilings per department, and why the week one is COSMETIC

A department carries `monthlyCapHours` and `weeklyCapHours`, both on the
department record (§12.3), both nullable, and **blank means no ceiling — which
is not the same as a ceiling of 0**. Both are checked on every submission and an
entry can breach either, both, or neither; when it breaches both, both are
reported, because next Monday clears one of them and nothing clears the other
before the month turns. There is no second mechanism for the weekly one —
`capBehaviour: 'warn'` flags it and `'block'` refuses it, exactly as for the
month.

Weekly hours are attributed **by the date of each segment**, not by the entry's
`workDate`. A shift running 22:00 Sunday → 02:00 Monday is two hours in the week
that is closing and two in the week that just opened; charging the whole entry
to the week it started in would overstate one week and leave the other showing
room it does not have. The engine already cuts sessions at midnight, so this is
read off `entry.segments` rather than recomputed.

Where a week begins is `weekStartsOn` (default Monday), and it is registered in
`COSMETIC_KEYS`, which deserves a word because the label fits badly. That list
is not "flags that do not matter" — moving the boundary genuinely changes which
entries carry `capExceeded`. It is consulted for exactly one decision: whether a
policy save must replay stored figures. Moving the boundary replays nothing
because it moves no figure — every `segments`, `buckets` and `totals` value is
bit-identical either side of the change, and it is only the *grouping* of
already-computed segments that differs. It sits beside `capBehaviour` and
`capBasis` for that reason, and the consequence it shares with them — that
`capExceeded` on a stored row reflects the ceiling in force when it was filed —
is not new with it. Contrast `weekendDays`, which is ARITHMETIC: that one
decides which days are วันหยุด and therefore which bucket an hour is paid at.

The arithmetic is pure and lives in `lib/caps.js`; `checkCap` in
`src/services/otService.js` supplies each window's numbers. The weekly query
runs on a **date range rather than a period**, since the week of 30 November
opens in one month and closes in the next.

### เกินเพดานแล้วยังเซ็น — the sentence that costs, and where it is read

**2026-09-02.** ไม่อนุมัติ has demanded a reason from everybody since it
existed. อนุมัติ never had — and an entry carrying `capExceeded` is exactly the
one where that asymmetry bites: the hours are past a limit somebody set on
purpose, they are on their way to payroll, and the only record of why anybody
thought that was all right was that a button had been pressed. The flag was
shown on two screens, both of them the approval queue, which accounting does
not open and which no longer holds the row by the time a month is closed.

So **deciding a flagged entry now costs a sentence, either way and at either
step** — `overCeilingRefusal` in `lib/caps.js`, applied by both
`/api/entries/[id]/approve` and `/api/entries/[id]/reject`. The rule is in
`caps.js` rather than in the routes for the reason `approvalPermission` is:
อนุมัติ and ไม่อนุมัติ are two halves of one decision made by the same people
at the same moment, and a check living in one of them is a check the other was
always going to be missing. On `reject` it can never fire — that route refuses
an empty reason twenty lines earlier — and it is called anyway, because "this
is unnecessary here" is a fact about today's code that nothing would notice
going stale.

- **One box, two rules.** The confirmation dialog already demanded a sentence
  for a different reason: an administrator signing the หัวหน้า step of a
  department that has no หัวหน้า (`OVERRIDE_NOTE_REQUIRED`). The two are
  independent — one is about who is signing, the other about what is being
  signed — and a batch can need both. They share the one textarea and reach
  the server as one `note`, because one person is making one decision; what
  changes with which rule fired is the label above the box, not the number of
  boxes.
- **One banner, and no fourth button.** *(2026-09-02, later the same day.)* The
  dialog opened on two amber boxes driven by the same rows — a list of who was
  over, then a notice saying a reason was required — so it said เกินเพดาน twice
  before it said anything new, and on a phone the pair pushed the textarea
  below the fold, on the one dialog whose whole point is that something has to
  be typed into it. They are one box now: the headline
  (`overCeilingApproveHead`), the rows with every ceiling each of them passed
  (`describeBreaches`), and the line saying where the sentence will be read.
  The headline says **ยืนยันอนุมัติ** rather than the server's
  อนุมัติ/ไม่อนุมัติ, because this sheet has one button and it says yes; both
  sentences are built from one `OVER_CEILING_FACT`, so they cannot end up
  describing different ceilings, and `OVER_CEILING_REASON_REQUIRED` is
  untouched — it is what the routes refuse with and what กล่องไม่อนุมัติ prints.
- **อนุมัติเกินเพดาน is gone from every screen.** The fourth button on an HR
  card, and `OverrideModal` behind it, were withdrawn the same day: a row over
  its ceiling is signed with the same ยืนยัน as every other row, and the
  dialog that opens is what collects the sentence. The difference that made
  the button worth removing is the flag — waiving CLEARS `capExceeded`, and
  deciding with a reason leaves it standing, which is what draws the figure
  red on รายงาน OT ฝ่ายบัญชี — on the screen since 2026-09-02, and on the
  PRINTED sheet since later the same day, which is the half that was missing:
  the screen is checked by the person who already knows what they signed, and
  the sheet is read by accounting, who does not. A button that quietly took a
  row off that report,
  sitting a thumb away from the one that does not, is not a second way to do
  the same thing. `POST /api/entries/[id]/cap-override` is still mounted and
  still refuses an empty reason; nothing in the application reaches it, and
  the `capOverride` on rows written before that date is still read.
- **A waived entry is not asked twice.** `capOverride` is ฝ่ายบุคคล granting
  the exception in writing, and asking the next signer to justify it again
  would be asking them to re-decide something that is not theirs. The reason
  they produced would be a restatement of HR's.
- **The reason lands in two places.** `history` gets it through `entry.log()`,
  one row per step, and that is the account that cannot be overwritten. The
  entry also gets `overCeilingReason`, which the last decision overwrites —
  that copy exists because สรุป OT ส่งบัญชี holds a month of rows and cannot
  walk every entry's history to colour a number.
- **There is no `isOverCeiling` field, deliberately.** `capExceeded` has meant
  precisely that since the ceiling existed and a dozen screens, reports and
  tests read it; a second boolean for one idea is two booleans that will one
  day disagree with nobody able to say which is right. `test/overCeiling.test.js`
  fails the build if one appears.

**And the sheet says it.** On สรุป OT ส่งบัญชี the row's `รวม ชม.` is drawn in
`--danger-ink` when any entry behind it went over a ceiling — the same red the
queue uses for the same fact — with the account in the หมายเหตุ column and a
hover tooltip reading `รายการเกินเพดาน | เหตุผลผู้อนุมัติ: …`. It is **not a
warning**: the hours are approved, correct and being paid, and the colour says
this figure was a decision somebody had to justify. A tint or an amber would
make an ordinary signed month look like a problem, which is how a mark stops
being read.

Three things about that figure are worth stating because each was a wrong first
guess:

- **The report asks a different question from the queue.** `wasOverCeiling`
  counts an entry whose ceiling was later WAIVED, because the waive sets
  `capExceeded` false — so the rows accounting most needs are exactly the ones
  the live flag has stopped naming. `capSnapshot.breaches` survives a waive and
  is what proves it; the waiver itself is the fallback for rows filed before
  the weekly ceiling existed, which carry no `breaches` at all.
- **The approver's reason and HR's waiver are separate lines.** Two people, two
  questions — merging them would print HR's sentence under the หัวหน้า's name.
- **The hours quoted are the flagged entries', not the row's total.** Somebody
  with four ordinary shifts and one long night went over on the night. The row
  still prints its full total; saying 40.5 in the tooltip would claim the whole
  month was over a limit when one shift was.

The tooltip is a `title`, not a portal-backed popover, and that is a decision
rather than an omission: the table is a horizontal scroller, so anything
positioned inside a cell is clipped by it — the problem `components/popover.jsx`
exists to solve, at the cost of a portal, a placement pass and a dismiss
listener. None of it is worth paying for here, because the same words are on
the row already, where they survive a phone, a print preview and a second
reading. The tooltip is the shortcut; the หมายเหตุ column is the record.

### ⚠ วันหยุดบริษัท: `year` is not what decides anything, and once it was

**Fixed 2026-08-11. Read this before deploying — it changes what closed months
compute to.**

`Holiday.year` is a denormalised copy of the first four characters of `date`,
derived by a `pre('validate')` hook. All four write paths — manual add and CSV
import, on both servers — upsert with `findOneAndUpdate`, which is *query*
middleware: the document hook never ran, and `runValidators: true` only checks
paths present in the update, so `year: { required: true }` never complained
about a field nobody had mentioned. **Every holiday ever created through the app
went in without a `year`.** And `loadHolidaySet()` filtered on `year`.

So HR added วันหยุดบริษัท, saw it appear on the calendar, and the engine could
not see it: every ใบ OT on that date was computed and paid at ×1.5 วันปกติ
instead of ×1.5/×3 วันหยุด. The recompute that fires on save reported
`updated: 1, changed: 0`, which reads like success. Nothing on any screen
disagreed with anything on any other screen. Only the seeded rows — written
through `new Holiday()` + `save()` — had a `year` and therefore worked.

Fixed on both sides: the upserts set `year` through the exported `yearOf()`, and
**nothing that decides a rate reads it any more** — `loadHolidaySet` and both
calendar list endpoints range over `date` instead (`'YYYY-MM-DD'` sorts
chronologically, and the unique index on it serves the query). The second half is
the one that matters: it makes a future missed write cosmetic rather than a
payroll error. Pinned by `test/holidayYear.test.js`.

**On deploy.** Holidays already in the database with no `year` become effective
the moment this ships — which is correct, and is a change. Days HR believed were
holidays start being paid as holidays. Approved entries do not move (the replay
refuses them, as always), so nothing already sent to accounting is restated; ใบ
ที่ยังไม่อนุมัติ on those dates will recompute upward the next time anything
replays them. Before deploying, list them and tell payroll which dates they are:

```js
db.holidays.find({ year: { $exists: false } }).sort({ date: 1 })
```

### ประกาศวันหยุดบริษัท — the banner everybody in the system reads

**Added 2026-08-28.** `components/HolidayBanner.jsx`. It read *"at the top of
both employee screens: the dashboard and the OT form"* until later the same day,
and it is on **four** screens now — those two, plus the landing tab of every
other role. Asked for in as many words: *"ทุกคนที่อยู่ในระบบคือแจ้งหมดเหมือน
พนักงาน"*. A หัวหน้า, ฝ่ายบุคคล or admin who never opened หน้า OT ของฉัน had
never been told which days the company is shut, and they are the people
answering the requests those days produce.

**Where each role meets it**, which is `defaultTab(role)` in
`components/App.jsx` and therefore the first screen after signing in:

| Role | Landing tab | Mounted by |
|---|---|---|
| พนักงาน | หน้า บันทึกและประวัติ OT, and the OT form | `EmployeeView` |
| หัวหน้า | รออนุมัติ | `App` |
| ฝ่ายบุคคล | รออนุมัติ OT | `App` |
| ผู้ดูแลระบบ | ตั้งค่าระบบ | `App` |

### ห้าแท็บเปลี่ยนชื่อเมื่อ 2026-08-31 — และชื่อเก่ายังอยู่ทั่วเอกสารนี้

Asked for as making the menu read more formally. **Five labels, one file, two
places in it**: the `PAGE` table is the heading on the app bar of each screen
and the `tabs` array is the menu itself, both in `components/App.jsx`.
`.sidebar` on a desktop and `.mobile-nav` on a phone render **the same `tabs`
array** — they are never on screen together and cannot disagree, which is the
same reason the queue badge is computed once. *(Since 2026-09-03 the sidebar
cuts that array into three headed blocks; it read* "and the phone bar still
draws it flat" *until 2026-09-04, when the phone bar started cutting the same
array into slots of its own — and then, later that day, gathering those slots
into slots of its own. Two partitions, one array, and the array is still the
only place a label, an icon, a badge or an order is decided. See*
แถบข้างแบ่งเป็นสามบล็อก*,* แถบล่างเหลือสี่ปุ่ม *and* แถบล่างออกแบบใหม่ *below —
the last of which is also where the phone got the sidebar's headings back, in a
drawer.)*

| It read, until 2026-08-31 | It reads | key | who sees it |
|---|---|---|---|
| รอ HR ยืนยัน | **รออนุมัติ OT** | `confirm` | ฝ่ายบุคคล · ผู้ดูแลระบบ |
| ตรวจสอบรายเดือน | **ตรวจสอบประจำเดือน** | `monthly` | ฝ่ายบุคคล · ผู้ดูแลระบบ · **การเงิน** *(อ่านอย่างเดียว)* |
| สรุป OT ส่งบัญชี | **รายงาน OT ฝ่ายบัญชี** | `accounting` | ฝ่ายบุคคล · ผู้ดูแลระบบ · **การเงิน** *(อ่านอย่างเดียว)* |
| สรุป OT แยกแผนก | **รายงาน OT แยกแผนก** | `departments` | ฝ่ายบุคคล · ผู้ดูแลระบบ |
| บันทึกระบบ | **บันทึกประวัติระบบ** | `logs` | ผู้ดูแลระบบ |
| รออนุมัติ | **รายการรออนุมัติ** | `approve` | ผู้เซ็นขั้นแรกทั้งสี่บทบาท |
| สรุปทีม | **รายงาน OT ประจำทีม** | `team` | ผู้เซ็นขั้นแรกทั้งสี่บทบาท **รวมการเงิน** |
| OT ของฉัน | **บันทึกและประวัติ OT** | `mine` | ทุกบทบาท |
| ใบ F-HR-027 | **พิมพ์ใบขออนุมัติ OT** | `form` | ทุกบทบาท |

*(`สรุปทีม` เคยเป็นคีย์ `monthly` ตัวเดียวกับ ตรวจสอบประจำเดือน จนถึง 2026-09-03
— จอเดียว สองบทบาท เซิร์ฟเวอร์เป็นคนตัดสินขอบเขต และหัวข้อหน้าถูกสลับด้วยตาราง
`PAGE_BY_ROLE` ที่คีย์ด้วยบทบาท · พอการเงินต้องมี**ทั้งสอง**การอ่าน คีย์เดียวเป็น
สองแท็บในบาร์เดียวไม่ได้ จึงแยกเป็น `team` กับ `monthly` และตารางหัวข้อนั้นก็ไม่
เหลืออะไรให้ทำ — ดู §`การเงิน`)*

*(ช่อง "who sees it" เขียนไว้ตามวันที่เปลี่ยนชื่อ — ตอนนั้นสี่บทบาท เห็นดังนี้:
`approve` และ `monthly` แบบทีม คือ หัวหน้างาน, และสองแถวล่างคือ พนักงาน เท่านั้น ·
คอลัมน์นี้เป็นสถานะปัจจุบัน หลัง* บทบาทเพิ่มเป็นเจ็ด *และ* การเงินเห็นสองเมนูของฝ่ายบุคคล
*เมื่อ 2026-09-03 ส่วนชื่อทั้งเก้าไม่ได้ขยับ)*

`ตั้งค่าระบบ` was asked to stay and stayed. **No key moved**, and the keys are
what the rest of the app is written against — `tab`, `home`, `trail`, the route
guards, every test. A label has always been a string on a screen here.

**The last two landed in a second pass**, asked for the same day and about the
หัวหน้างาน bar specifically, and each turned down a second candidate for a
reason worth keeping. **รายการรออนุมัติ and not "รออนุมัติ OT"** — that is now
the ฝ่ายบุคคล tab one row up. No account reaches both, so nothing would collide
on any screen; two different queues under one name is a collision in every
sentence written about them afterwards, which is the cost that actually gets
paid. **รายงาน OT ประจำทีม and not "สรุป OT ภาพรวมทีม"** — the other two report
tabs were renamed to รายงาน OT ฝ่ายบัญชี and รายงาน OT แยกแผนก an hour earlier,
so this one takes the same shape and the three read as one family.

**The พนักงาน pair came back swapped, and that is the one worth reading.** It
was asked for as `OT ของฉัน` → "ประวัติการทำ OT" and `ใบ F-HR-027` →
"ยื่นขออนุมัติ OT" — correct Thai for the two things an employee does, on the
wrong two tabs. `mine` is `EmployeeView`: the hero, `+ บันทึก OT ใหม่`, the
phone FAB, and ประวัติการขอ OT behind ดูประวัติทั้งหมด — **filing happens
there**, and history is one of the two things on it. `form` is `MyForm`: pick a
month, get `PrintForm`, sign it, hand it to ฝ่ายบุคคล — **nothing on it files
anything**. Shipped as asked, the tab promising to file could not, and the only
one that could would have read "ประวัติ". Raised before any edit; the answer was
to name each screen after the work it does. `test/roleNavTabs.test.js` holds it
there, and holds `showFab` to `mine` — a label that moved filing to `form`
without moving the FAB would be a tab that says ยื่น and has no way to.

**พิมพ์ใบขออนุมัติ OT and not ใบ F-HR-027**, for the reason HR's button took
the same day: the controlled-form code is what the sheet is called in the
filing cabinet, not what the person pressing the button calls what they are
about to print. The two now match word for word — HR's reads พิมพ์ใบขออนุมัติ
OT ทุกคน, and an employee's is their own copy of it.

**`monthly` appears twice in that table, and that is the interesting row.** One
screen key, two roles, two labels — ฝ่ายบุคคล open the whole company and a
หัวหน้า opens their own team, scoped by the server. The MENU has always said
two things about it; the HEADING did not, so a หัวหน้า pressed สรุปทีม and
arrived at a page titled ตรวจสอบรายเดือน, which is HR's job description and not
theirs. Harmless while the tab was three syllables and nobody looked twice, and
not harmless once the tab was renamed to something a person would expect the
page to repeat back. `PAGE_BY_ROLE` in `components/App.jsx` is the fix: keyed by
role and then by tab, consulted before `PAGE` and falling through to it, so it
stays the exception rather than a second copy.

**The nav builder is one block per role now**, which is the other half of the
same request. Nothing about who sees what changed — the หัวหน้างาน's second tab
used to be pushed seventy lines below its first, after the ฝ่ายบุคคล block it
can never enter, and the พนักงาน's two sat at opposite ends of the function.
Every role between a pair fails the pair's condition, so every list came out in
the order it was already in. `test/roleNavTabs.test.js` holds the arrangement
there: which tab sits behind which gate, and in what order the gates open.

**What each role's bar actually holds**, counted off `lib/session.js` where
`maySubmitOt` is now true for **every** บทบาท (it read `role === 'employee'`
until 2026-09-03, and the two figures in this table that moved most are the ones
that follows from):

| Role | Tabs | |
|---|---|---|
| พนักงาน | 2 | บันทึกและประวัติ OT · พิมพ์ใบขออนุมัติ OT |
| หัวหน้างาน | 4 | those two · รายการรออนุมัติ · รายงาน OT ประจำทีม |
| ผู้จัดการแผนก · ผู้จัดการฝ่าย | 4 | the same four |
| การเงิน | 6 | those four · **ตรวจสอบประจำเดือน · รายงาน OT ฝ่ายบัญชี** |
| ฝ่ายบุคคล | 7 | the พนักงาน pair · รออนุมัติ OT · ตรวจสอบประจำเดือน · รายงาน OT ฝ่ายบัญชี · รายงาน OT แยกแผนก · ตั้งค่าระบบ |
| ผู้ดูแลระบบ | 8 | those seven and บันทึกประวัติระบบ |

*(It read "หัวหน้างาน 2 · ฝ่ายบุคคล 5 · ผู้ดูแลระบบ 6" until 2026-09-03, when
§2's bar on หัวหน้างาน filing their own OT was withdrawn and the พนักงาน pair
became everybody's — and "A หัวหน้า's two are the whole bar … the one nav in
this app that is not a compressed version of a longer list", which was true for
exactly as long as that bar was.)*

**Seven is a steady state and not a maximum.** Two more tabs come and go, both
ฝ่ายบุคคล/ผู้ดูแลระบบ only and both keyed on the data rather than the role —
รออนุมัติแทน while any team is covered, ไม่มีหัวหน้าเซ็น while any request is
stuck. A covered team makes ฝ่ายบุคคล eight; an admin with both faults open sees
ten.

### แถบข้างแบ่งเป็นสามบล็อก — 2026-09-03

**Asked for the same day and caused by the row above it.** The moment
`maySubmitOt` became true for every บทบาท, a ฝ่ายบุคคล's menu opened with two
screens about their **own** hours and ran straight on into five about everybody
else's, with nothing marking where one job stopped. Seven rows in one
undivided column, and the first two are a different job from the rest.

`NAV_GROUPS` in `components/App.jsx` is the table, and it has three rows:

| Heading | What is under it | Folds |
|---|---|---|
| **ข้อมูลส่วนตัว** | บันทึกและประวัติ OT · พิมพ์ใบขออนุมัติ OT | **yes**, behind one row reading **OT ส่วนตัว** |
| **การอนุมัติ & รายงาน** | รายการรออนุมัติ · รออนุมัติแทน · ไม่มีหัวหน้าเซ็น · รออนุมัติ OT · ตรวจสอบประจำเดือน · รายงาน OT ประจำทีม · รายงาน OT ฝ่ายบัญชี · รายงาน OT แยกแผนก | no |
| **การตั้งค่าระบบ** | ตั้งค่าระบบ · บันทึกประวัติระบบ | no |

**A block with no rows is not drawn, heading included** — a พนักงาน sees
ข้อมูลส่วนตัว and nothing else, and การเงิน see the first two and no third.
**Nobody gained or lost a tab**; the table above is the same seven, eight and
two, with lines drawn in them.

**การตั้งค่าระบบ was asked for as "ผู้ดูแลระบบ", and that is the one thing here
that did not ship as requested.** ฝ่ายบุคคล reach ตั้งค่าระบบ — they maintain
ทะเบียนพนักงาน, นโยบาย and วันหยุด there — and they are **not** ผู้ดูแลระบบ. A
heading naming a บทบาท over rows a different บทบาท presses is the `PAGE_BY_ROLE`
fault three paragraphs up, moved from the page to the menu, and it is worse in
the menu: in a system where บทบาท decides what a person may do, a heading that
files somebody under the wrong one reads as a statement about their access. The
other two headings name whose work is behind them and stay true for every
reader; this one names the screens instead. บันทึกประวัติระบบ is still
ผู้ดูแลระบบ's alone, and still gated on the role rather than on the heading.

**`group` is a field on the push, not a lookup table.** `tabs` stays the one
place the menu is decided — who sees what, in what order, with which icon and
badge — and `NAV_GROUPS` only says which heading a row is drawn under. A table
keyed by tab would be a second list to keep in step, and the way it would fail
is a tab quietly not being drawn.

**The phone bar ignores all of it** — it cuts the same array by its own field.
It read *"and still maps flat `tabs`"* until 2026-09-04; see
แถบล่างเหลือสี่ปุ่ม below for what replaced that and why. While it was flat, the
property that made it safe was that the grouping is a **partition that preserves
order**: every role's tabs leave the builder personal-first and system-last, so
filtering by group and concatenating gives back the identical sequence. Break
that — push a personal tab down among the reports — and the sidebar would hoist
it to the top while `.mobile-nav` left it where it was written, and one menu
would be in two orders on two devices. `test/roleNavTabs.test.js` still asserts
that ordering property, because the sidebar's own cut depends on nothing else.

**The fold has three states and the third is the useful one.**
`personalToggled` starts `null` — neither open nor shut — and until somebody
presses it the fold follows the tab: open exactly when the screen you are on is
inside it. No single boolean default is right for everybody, because a พนักงาน
**lands on** one of those two screens and would meet a fold hiding the page in
front of them, while ฝ่ายบุคคล land on รออนุมัติ OT and asked for a shorter
column. A press then pins it, in both directions, for the rest of the session:
a fold that re-opened itself the next time navigation happened to land inside it
would be undoing the one thing the person who pressed it is sure they did.

**OT ส่วนตัว never wears `.active`.** That mark means *this is the page you are
on*, and pressing this row opens a list rather than a screen. Shut over the
open page it takes `.current` instead — a white overlay wash and a 2px
`--green-lift` bar down its left edge — which says the page is behind this row
without claiming to be it. Two rows wearing one mark is how a person stops
trusting the mark; mechanically it is also the second source of `'active'` that
`test/navActiveTab.test.js` counts occurrences of in that block of markup.

**The `user` glyph is new** and sits beside `users` in `components/icons.jsx` —
one figure against two, which is the whole distinction: two people means a queue
whose rows belong to somebody else. Not `clock`, which is worn by `mine`, the
first screen inside the fold; a parent row wearing its own child's glyph says
the two are the same thing.

**การเงินได้สองเมนูของฝ่ายบุคคล ชื่อเดิม อ่านได้อย่างเดียว** — ขอมาเมื่อ
2026-09-03 · ทั้งสองจอเป็น**ทั้งบริษัท ทุกแผนก** ไม่ใช่ทีมของตัวเอง เพราะ
รายงาน OT ฝ่ายบัญชี ครอบทุกแผนกอยู่แล้วโดยธรรมชาติของมัน และคนที่กระทบยอด
สองใบนี้ต้องมองเดือนเดียวกัน · ชื่อเมนูจึงเป็นชื่อเดียวกับของฝ่ายบุคคลคำต่อคำ
ไม่ใช่ "รายงาน OT ประจำทีม" ที่แคบกว่า — สองชื่อสำหรับจอเดียวคือสิ่งที่ทำให้
เขียนประโยคถึงมันไม่ได้ · กฎอยู่ที่ `COMPANY_REPORT_ROLES` และ
`readsOwnTeamOnly` ใน `lib/roles.js` ที่เดียว และเป็นคนละคำถามกับ `SIGNER_ROLES`
โดยตั้งใจ: การเงินเซ็นให้ **แผนกบัญชีและการเงิน** แผนกเดียวเหมือนหัวหน้างาน
เซ็นให้แผนกของตัวเอง แต่*อ่าน*ทุกแผนก · ส่วน**แก้ไขไม่ได้** อยู่ที่
`mayCorrectEntries` ใน `lib/entries.js` ซึ่งเป็นครึ่งบทบาทของ `editPermission`
เอง — จอถามข้อเดียวกันกับที่ route ใช้ปฏิเสธ ปุ่มกับคำปฏิเสธจึงแยกจากกันไม่ได้

### แถบล่างเหลือสี่ปุ่ม — the phone bar draws slots, not tabs — 2026-09-04

Asked for on 2026-09-04: the bottom bar had grown to **eight** buttons for
ผู้ดูแลระบบ and seven for ฝ่ายบุคคล, sharing 360px — about 45px a button, with a
22px glyph and a Thai label wrapping under it. The measurement two sections down
is the same complaint from the other end: at six tabs an admin's bar reached
88px at 320px, with three labels stacked three lines deep.

**Five slots, declared once in `BAR_SLOTS` (`components/App.jsx`), each with a
SHORT label — and never more than four of them drawn.** *(The table read four
until* แถบล่างของหัวหน้างานเป็นสี่หน้าจอ *below, which gave* `form` *a slot of
its own for every บทบาท but two. It had had one once before, beside a* `side`
*column, for a single round earlier the same day.)*

| # | slot | label | glyph | what is behind it |
|---|---|---|---|---|
| 1 | `personal` | ประวัติ OT | `clock` | บันทึกและประวัติ OT |
| 2 | `form` | พิมพ์ใบ OT | `document` | พิมพ์ใบขออนุมัติ OT *(ฝ่ายบุคคล และผู้ดูแลระบบ อยู่ใน เพิ่มเติม)* |
| 3 | `queue` | รออนุมัติ | `check` | รายการรออนุมัติ · รออนุมัติ OT · รออนุมัติแทน · ไม่มีหัวหน้าเซ็น |
| 4 | `reports` | รายงาน | `chart` | รายงาน OT ประจำทีม · ตรวจสอบประจำเดือน · รายงาน OT ฝ่ายบัญชี · รายงาน OT แยกแผนก |
| 5 | `more` | เพิ่มเติม | `sliders` | ตั้งค่าระบบ · บันทึกประวัติระบบ |

*(Slots 1 and 3 read* OT ส่วนตัว *and* รออนุมัติ *until the same section; the
first was renamed, the second was already that.)*

**It is not a second menu, and `bar` is a field on the push for that reason** —
exactly as `group` is. `tabs` is still the whole of who sees what, in what
order, with which label, icon and badge; the slots hold the *same* entries, and
a slot with more than one opens a sheet listing them under the labels and glyphs
they already wear. Nothing is hidden from a phone that a desktop has, and no
name is decided twice. A lookup table keyed by tab would be a second list to
keep in step, and the way it fails is a tab that quietly stops being drawn.

**A slot holding exactly one tab goes straight to that screen and wears that
screen's glyph — and its `short` name, where it has one.** *(It read "…* ***is***
*that tab — its label, its glyph, its badge, one press to the screen" until*
แถบล่างออกแบบใหม่ *below, and then "but* ***not*** *its name" until*
แถบล่างของหัวหน้างานเป็นสี่หน้าจอ *after it.)* What a slot may never wear is a
screen's `label`: a name in this app is a sentence — บันทึกและประวัติ OT,
รายงาน OT ประจำทีม, eighteen and nineteen characters — and a quarter of a 360px
bar is about twelve. A `short` is capped at twelve by
`test/roleNavTabs.test.js`, and there is exactly one — รายงานทีม on `team`.
What each role sees:

| Role | tabs | buttons | which |
|---|---|---|---|
| พนักงาน | 2 | 2 | ประวัติ OT · พิมพ์ใบ OT |
| หัวหน้างาน · ผู้จัดการแผนก · ผู้จัดการฝ่าย | 4 | 4 | those, plus รออนุมัติ and **รายงานทีม** — every button one press from a screen, no sheet |
| การเงิน | 6 | 4 | …with **รายงาน ▾** holding three |
| ฝ่ายบุคคล | 7 | 4 | ประวัติ OT · **รออนุมัติ ▾** three · **รายงาน ▾** three · **เพิ่มเติม ▾** two |
| ผู้ดูแลระบบ | 8 | 4 | the same, with **เพิ่มเติม ▾** three |

**ฝ่ายบุคคล and ผู้ดูแลระบบ keep พิมพ์ใบขออนุมัติ OT in เพิ่มเติม, and that is
the one place the two cuts disagree.** On the sidebar both personal screens fold
under OT ส่วนตัว; on their phone bar the queues and the reports already hold a
slot each and ตั้งค่าระบบ has to go somewhere, so a slot for `form` would be a
**fifth** column. `mine` is where filing happens and is opened every day; `form`
prints a sheet that is already filed and is opened at the end of a month, so it
is the one that goes to the back. `test/roleNavTabs.test.js` asserts that this is
the *only* crossing, so the next one has to be argued for. *(It was in
เพิ่มเติม for* ***every*** *role between* แถบล่างออกแบบใหม่ *and*
แถบล่างของหัวหน้างานเป็นสี่หน้าจอ*, and for one round before that it had a slot
for a third reason: the bar was being split into ส่วนตัว and จัดการทีม halves,
which needed the personal pair adjacent.)*

**`.active` is still only ever the page you are on.** A slot with a menu behind
it takes `.current` — the sidebar's own mark for the OT ส่วนตัว fold — and the
row inside the sheet is what carries `aria-current="page"`. Both marks are the
same green, deliberately: what a reader needs from the colour is *you are here*,
and a third shade would be a state to learn on a bar of four. What a press
*does* is said by the **▾** after the label, which is inline inside it rather
than a row of its own — the bar's height is its labels', and a caret on a line
of its own would cost every phone in the office eleven pixels of page.

**The sheet is `Popover`, not a panel of its own.** The same portaled panel the
three pickers open, in its below-860px sheet form: over a scrim, off the bottom
edge, dismissed by Escape, by a press outside and by ปิด. A bottom bar is the
worst place in this app to build a second panel — it is `fixed` at the foot of
the screen, so a list opening out of it needs placement, a flip, a scrim and a
way out, which is `components/popover.jsx` retyped in the one component nobody
opens on a desktop. `test/popover.test.js` holds that there is one of it.

**The badge on a menu slot is the sum of what is behind it**, and it still knows
nothing about which slot is lit — the bar answers *is there anything for me over
there*, and over there is a sheet now rather than a screen. Each row in the
sheet carries its own count, so the question is answered at both depths.

### แถบล่างออกแบบใหม่ — four icons, one line, and the menu moves upstairs — 2026-09-04

The third round on this bar in one day, and the one that undid the second.
Reported with a picture of ตั้งค่าระบบ at 360px: *"ปัจจุบันยัดเยียดและตัวอักษร
ทับกัน"* — five columns, a heading strip over them, and Thai labels wrapping into
each other. Four things were asked for and all four are here.

**One — four icons, and the ส่วนตัว / จัดการทีม headings come off the bar.**
They had been added that morning (§แถบล่างแบ่งครึ่ง, withdrawn) and they cost
17px on the one surface in the app that cannot spend any: the bar is fixed over
the foot of every page and `--nav-h` turns each of its pixels into a pixel the
page gives up. `form` went back to เพิ่มเติม with them, since the fifth slot
existed only to make the halves contiguous. *(A fifth slot came back later the
same day for a reason of its own — see* แถบล่างของหัวหน้างานเป็นสี่หน้าจอ
*below. The halves did not.)*

**Two — the label is the SLOT's, always.** *(Superseded later the same day by*
แถบล่างของหัวหน้างานเป็นสี่หน้าจอ *below: a slot holding one tab may wear that
tab's* `short`*, and one does. The finding underneath — that a label must be
about twelve characters — is what both rounds are built on and did not move.)*
This is the change that actually fixed the wrapping and it is the one worth
arguing. The bar used to show a screen's own name whenever a slot held just one
— right while a bar had two buttons on it, and the whole problem once it had
four: บันทึกและประวัติ OT is nineteen characters and 81px of bar is about
twelve. The slot names — OT ส่วนตัว · รออนุมัติ · รายงาน · เพิ่มเติม — are nine
to eleven and were already written. **It is not a second name for a screen**:
`PAGE` and `tabs` are still the only places a screen is named, and the screen
announces itself in full in the app bar one line up. A slot is a category; its
glyph still follows a single tab, because a glyph is not a sentence.

**Three — 24px glyph, 11px label, and the height goes into the gaps.** The
numbers came with the request. `gap: 6px` and `padding: 8px 4px` from 4 and 6/2,
which is the negative space it asked for and is what the labels gave back by
stopping at one line. `white-space: nowrap` with an ellipsis is a **guard, not
the mechanism** — every label fits at every width, measured; what the guard buys
is that a longer one some day degrades into a truncation rather than into the
two-line collision this bar has been reported for twice. `min-width: 0` on the
button is the other half of it: without it a flex item's floor is its content's
min-content width, Thai breaks inside a word, and the ellipsis can never fire
because nothing ever overflows.

**Four — the grouping moved to a drawer under the avatar** (`NavDrawer`). The
app bar's avatar went straight to ข้อมูลส่วนตัว and now opens the whole menu:
the sidebar's three headed blocks — `navGroups`, not a fourth partition of
`tabs` — then a **บัญชี** foot with ข้อมูลส่วนตัว and ออกจากระบบ. It is
`Popover` in its sheet form, so it is the panel the pickers and เพิ่มเติม
already open rather than a fourth kind of thing. ข้อมูลส่วนตัว is one press
further than it was; what that press buys is every other screen at the same
depth, with the headings that say whose work each one is.

**เพิ่มเติม was already a bottom sheet and was checked rather than changed.**
Walked: full width, `bottom: 0`, over a scrim, with a ปิด button and the slot's
name over the rows.

#### The drawer was 814px tall on a 780px screen — found in the walk

`.pop.sheet` is `bottom: 0` and had **no cap**, which was safe while every sheet
in the app was short by construction: a calendar is six rows, a time panel five
stops, a slot's menu four destinations. The drawer is the whole menu. A panel
pinned to the bottom grows upward, so at 360×780 its top measured **-34px** with
the name at the head of it off the screen, and at 360×667 **-147px** with four
rows unreachable — and nothing scrolled.

**The cap is on the panel and the scroll is on the list**, which is the part
worth keeping: `overflow-y` on the panel would carry the who-block and the ปิด
button away with the rows, and ปิด is the one control on a sheet a phone can be
sure of. `max-height: 88dvh` — **`dvh` and not `vh`**, because `vh` is the
tallest the viewport ever gets on a phone with a retracting address bar, so a
panel measured in it hangs off the bottom for as long as that bar is showing.
Re-walked: 686px at 780 and 587 at 667, top on screen both times, 128px and
227px of scroll in the list, ปิด visible throughout, and `elementFromPoint` at
the centre of the last row returns that row.

#### Measured on the built app, ธีมมืด, over CDP as five roles

| Role | buttons | bar @360 | @320 | label lines | clipped |
|---|---|---|---|---|---|
| พนักงาน | 2 | 79px | 79px | 1 | none |
| หัวหน้างาน | 4 | 79px | 79px | 1 | none |
| การเงิน | 4 | 79px | 79px | 1 | none |
| ฝ่ายบุคคล | 4 | 79px | 79px | 1 | none |
| ผู้ดูแลระบบ | 4 | 79px | 79px | 1 | none |

Icons measure 24px and labels 11px on every button; button widths are 87px at
360 and 77 at 320 for a four-button bar. No `.nav-side-head` is rendered for any
role. No console errors. **The bar was 104px before this round and is 79** —
25px of every page handed back, and the same number on every role, which it had
not been since the labels were renamed on 2026-08-31.

### แถบล่างของหัวหน้างานเป็นสี่หน้าจอ — four buttons, four screens, no menu — 2026-09-04

The fifth round on this bar in one day, and the first that is about **one
บทบาท** rather than about the bar's height. Asked for as a หัวหน้างาน's four
tabs, in this order, with no เพิ่มเติม and no dropdown left on it:

| # | asked for | glyph | it opens | slot |
|---|---|---|---|---|
| 1 | ประวัติ OT | Clock | บันทึกและประวัติ OT | `personal` |
| 2 | พิมพ์ใบ OT | FileText | พิมพ์ใบขออนุมัติ OT | `form` |
| 3 | รออนุมัติ | Inbox *(+ ป้ายเลข เมื่อค้าง > 0)* | รายการรออนุมัติ | `queue` |
| 4 | รายงานทีม | BarChart | รายงาน OT ประจำทีม | `reports` |

**Three of the four were already one press from a screen; what changed is two
labels and where `form` sits.** `personal` was OT ส่วนตัว and is ประวัติ OT;
`queue` was already รออนุมัติ. `form` moved out of เพิ่มเติม into a slot of its
own — which is what empties เพิ่มเติม for a ผู้เซ็น, since it was the only thing
in there for them. A slot with nothing in it is not drawn, so the bar comes out
at four buttons with no sheet behind any of them.

**ฝ่ายบุคคล and ผู้ดูแลระบบ keep `form` in เพิ่มเติม, and the reason is
arithmetic.** Their queues fill one slot and their reports another; ตั้งค่าระบบ
and, for one of them, บันทึกประวัติระบบ still need somewhere to go. A slot for
`form` on top of that is a fifth column at 72px on a 360px phone, which is the
crowding of this same day arriving from the other side. `seesEveryRole` is the
predicate, it is asked once, on the push, and it is the only role rule in the
bar's half of the builder — the derivation that cuts `tabs` into slots still
knows nothing about บทบาท.

**รายงานทีม is the one per-tab `short` in the app, and the `reports` slot is why
it had to exist.** That slot holds one screen for a ผู้เซ็น — their own แผนก's
month — and three company-wide sheets for ฝ่ายบุคคล. รายงานทีม over ฝ่ายบุคคล's
three would say something false about what is behind it, so the rule is that a
slot holding **one** tab may wear that tab's `short`, and a slot holding several
always wears its own name. ฝ่ายบุคคล and การเงิน still read รายงาน.

#### Walked on the built app at 360×780, four บทบาท, scratch database

| Role | buttons | which | bar | label lines |
|---|---|---|---|---|
| พนักงาน | 2 | ประวัติ OT · พิมพ์ใบ OT — both a screen, 174px each | 79px | 1 |
| หัวหน้างาน | **4** | ประวัติ OT · พิมพ์ใบ OT · **รออนุมัติ** *(ป้ายเลข 2)* · รายงานทีม — **every one a screen**, 87px each | 79px | 1 |
| ฝ่ายบุคคล | 4 | ประวัติ OT · รออนุมัติ · **รายงาน ▾** · **เพิ่มเติม ▾** | 79px | 1 |
| ผู้ดูแลระบบ | 4 | the same four | 79px | 1 |

No `aria-haspopup="menu"` on any of a หัวหน้างาน's four, which is the request
read back off the DOM: four columns, four screens, nothing folded. The green
`.active` was on รออนุมัติ, where that account lands.

**What did not change.** The badge is still drawn only above zero and is still
the sum of what is behind a slot; `.active` is still the only green that means
*this is the page you are on*; every label is still one line — ประวัติ OT and
พิมพ์ใบ OT are ten characters, against the twelve a quarter of a 360px bar
holds — so `--nav-h` is still 79px. The requested `/supervisor/…` paths have no
counterpart here and none was added: **this app has no routes**. Every screen in
it is React state (`tab` in `Shell`), which is what `components/nav.jsx` and its
`useBackHandler` exist to make survivable; there is one URL and the print sheets
are the only things that leave it.

### What the longer labels cost the phone bar — measured, 2026-08-31

Walked on the built app at :3001 against a seeded scratch database, logged in
as each of the four roles over CDP at 320 / 360 / 390 / 430 px. **Nothing
overflows, nothing is clipped, and no label is cut off** at any width for any
role — `.mobile-nav` is `display: flex` with `flex: 1` buttons, Thai breaks
inside a word, and `--nav-h` is measured from the bar itself so
`.mobile-nav-spacer` follows whatever height it takes. What changed is HEIGHT.

| Role | tabs | bar @320 | @360 | @390 | @430 |
|---|---|---|---|---|---|
| พนักงาน | 2 | 66px | 66px | 66px | 66px |
| หัวหน้างาน | 2 | 66px | 66px | 66px | 66px |
| ฝ่ายบุคคล | 5 | 77px | 77px | 77px | 77px |
| ผู้ดูแลระบบ | 6 | **88px** | 77px | 77px | 77px |

⚠️ **A dated record of a walk, and every figure in it has been superseded.** The
tab counts are the ones of that day; since 2026-09-03 they are 2 · 4 · 7 · 8,
with การเงิน's 5 in between. This read *"the bar has not been re-measured at
those counts… worth re-walking at 320px before the next release"* until
2026-09-04, and what answered it first was not a re-walk but the slots: **the
bar is at most four buttons now**, whatever the role, so the six- and eight-tab
cases this section measures cannot occur. It was re-walked twice more the same
day — once when the bar was split in two and once when that was undone — and the
live table is in แถบล่างออกแบบใหม่ above: **79px for every role at both widths**,
rather than the 66 / 77 / 88 here. The mechanism that made the measurement safe is unchanged and still is:
`--nav-h` is read off the bar itself by a ResizeObserver, so the spacer follows
whatever height the labels take. See แถบล่างเหลือสี่ปุ่ม above.

**The two-tab bars are clean** — every label sits on one line at every width,
`บันทึกและประวัติ OT` measuring 98.5px in a 174px tab at 360. That is the bar
this round was about and it needs nothing.

**The five- and six-tab bars are the ones that paid.** At 360px each ฝ่ายบุคคล
tab is 69.6px wide and three of five labels take two lines; for ผู้ดูแลระบบ each
tab is 58px and five of six do. At 320px an admin's bar reaches 88px with three
labels stacked **three lines** deep. It read **66px for every role** before the
renames of the same day, so this is 11px of a phone screen for ฝ่ายบุคคล and 22
for an admin at 320 — a cost the first two rounds did not measure and should
have. It is a legibility question rather than a broken layout, and the labels
were chosen deliberately, so it is written down here rather than quietly undone.

*(This paragraph is what the change of 2026-09-04 answered. The labels were not
undone; the number of them on one bar was. Four buttons at 360px is 90px each,
which is more than the two-tab bar's own tabs had.)*

**The count badge is amber, and it was `--danger` until 2026-08-31.** Asked for
on the หัวหน้างาน bar and taken across the whole app in one move, because the
stylesheet's own rule for it is *"count badges are alarms, not decoration — one
colour, used only here"*: one colour for every count, or the same number means
different things depending on who is logged in. Four tabs wear it —
รายการรออนุมัติ, รออนุมัติ OT, รออนุมัติแทน, ไม่มีหัวหน้าเซ็น. `--amber` with
`--on-amber` is the pair this file had already tuned for this exact object;
both themes clear AA. **What it gives up, said plainly:** red is gone from the
nav, and with it the one place this app distinguished a *fault* from a *queue* —
ไม่มีหัวหน้าเซ็น is a fault and now wears the same amber as three ordinary
queues. It keeps a tab of its own, which is the distinction that was doing the
work. (`test/navActiveTab.test.js` had been calling this "THE ORANGE BADGE" in
its own header the whole time it was red, which is how a colour drifts from
what everybody believes it is.)

**Why the old names are still everywhere below this line.** They are in dated
records — *"reported on 2026-08-28, the badge read 6 from ตรวจสอบรายเดือน"* —
and rewriting those would restate what was said about a screen under a name it
did not have that day. About 180 lines of source comment are in the same
position. The anchor for all of them is the block above `PAGE` in
`components/App.jsx`, which is the one place that says which old name is which
screen. Headings, the permissions table and the landing table above are live
statements and were rewritten.

**Four strings that look like the old names and are not**, each checked and
each deliberately left: the `⚠️ รอ HR ยืนยัน` chip on ตั้งค่าระบบ →
นโยบายการคำนวณ is a **policy value** waiting on a sign-off, not this queue;
`PrintFormBatch`'s `unmarked` scope is labelled รอ HR ยืนยัน in a list of
**document conditions** beside ยังไม่อนุมัติ, where "รออนุมัติ OT" would read
as a contradiction; the confirm queue's own subtitle pairs ตรวจสอบรายเดือน with
a หัวหน้า's ตรวจสอบรายวัน, which is a **cadence** and the pair is the point; and
`lib/accessLog.js` describes the log routes as *เปิดดูบันทึกระบบ* — those
strings are written into `otAccessLogs`, which is append-only, so changing them
splits one screen's trail across two names and is a decision rather than a
rename.

**On the landing tab and nowhere else**, the rule `BackupBanner` beside it
already follows: a standing announcement is equally true on every screen, and
one repeated on all of them becomes furniture.

**Two mounts and not one, and they are not a duplicated rule.** `App`'s is
skipped when the landing tab *is* หน้า OT ของฉัน, because `EmployeeView` draws
its own there — and it draws a better one: the employee screens know which month
they are showing and pass it, so paging back to July announces July. `App` has
no month picker to read, so whoever lands there gets today's.

Asked for as an announcement rather than a notification, and the distinction is
the whole design. A toast confirms
something that just happened and removes itself after four seconds
(`components/Toast.jsx`); this is true all month, nothing happened to cause it,
and the point is that everybody has read the same thing **before** they file.

**What it says.** The month's announced holidays — each one two lines, the date
with its weekday and then the holiday's name under it, smaller and one step
quieter — and a pill that opens the year's calendar. On a month with none it says so out
loud (`เดือนนี้ไม่มีวันหยุดบริษัทที่ประกาศไว้`) and names the next one, because an
empty month and a month nobody has entered look identical from the screen, and
the reader who assumes the second files a normal-rate request for a day the
company was shut.

It said more when it shipped: a sentence of rates — *"ยื่นคำขอ OT ตรงกับวันเหล่านี้
ระบบจะคิดเป็น OT วันหยุด ให้อัตโนมัติ — 08:00–17:00 ×1.5 · นอกเวลา ×3 ·
เสาร์–อาทิตย์เป็นวันหยุดอยู่แล้วโดยไม่ต้องประกาศ"* — which was argued for here and
removed on request the same day.

**The name took three rounds to find its line, and the shape is the reason.** It
began beside the date, was removed altogether, and came back underneath. Beside
the date it is fine until a name is `วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนี
พันปีหลวง`, which on a phone wrapped to three lines and dragged the entries below
it out of alignment; on its own line it wraps inside its own block and every
entry still starts at the same left edge. The list gaps carry the grouping —
**10px between two holidays against 1px between a date and its own name** — or a
three-holiday month reads as six loose lines. It was 7px for one round and read
as too tight, which the ratio explains: the line above a date is the previous
holiday's NAME, and those two are exactly the pair that must not look like one.

**Three quiet levels, not two.** The date is `--ink`, the holiday's name
`--ink-2`, the weekday `--muted`. The name and the weekday shared `--muted` for
a round, on the reasoning that both are the date's supporting cast — and on a
phone that turned out to be wrong in a way worth recording: the weekday is a
*check* on the date, read once and never again, while the name is the
announcement's actual content. All three are pinned against `--green-bg` in
`test/theme.test.js`.

**Where the เสาร์–อาทิตย์ clause went, and why it mattered.** Saturday and Sunday
are holidays *by rule* and are deliberately not rows in the collection — the
weekday decides them, in `makeIsHoliday` — so a list of announced days read on
its own says that an unlisted Sunday is an ordinary working day. That is the one
wrong conclusion this banner can cause. Removed from the banner on request, the
fact is still stated in the ปฏิทินวันหยุดประจำปี dialog's subtitle, one tap from
the button, and the OT form labels the day it is given and splits the rates in
front of the person filing. `test/holidayNotice.test.js` did not lose that
assertion with the paragraph — it now pins the dialog, so the fact cannot leave
the component silently.

**Nothing here reads a holiday's name to decide anything, and that survived the
round that asked it to.** The ask was *"ลบคำว่า ทดสอบ ออกจากรายการวันที่ 28 และ
31"* — two days the calendar genuinely holds under that name, kept there on
purpose. It was answered by dropping the name column for **every** row rather
than for those two, and when the names came back a round later they came back
the same way: `h.name`, whatever `h.name` says. A rule that hid a row, or a
name, **because of what it said** would put this screen and `loadHolidaySet()`
on different lists of which days are holidays, which is the exact shape of the
`Holiday.year` bug two sections up. A day named badly is fixed where the name
is — ตั้งค่าระบบ → วันหยุดบริษัท — and `test/holidayNotice.test.js` refuses any
comparison against the text in this component.

**It is in flow at the top, not `position: sticky`.** The requirement was that it
not go away by itself, and it does not: there is no ✕ and no dismissed flag,
unlike `MonthAlerts`, which is HR's own working panel and is meant to be shut
once read. Pinning it was considered and rejected for a reason about this app
rather than about stickiness — `.appbar` is already `sticky; top: 0` and the tab
strip `sticky; top: 62px`, and a third band would hold about 90px more of a
780px phone. Both screens it sits on are short columns read top to bottom, so
the top of the content is above everything either of them has.

**Nothing here decides a rate**, which is why a failed fetch renders nothing
instead of an error strip. `loadHolidaySet()` on the server is the only thing
that decides which bucket an hour lands in, and it reads the same collection —
the banner is a second reader of one fact, never a second source of it.

**One request per YEAR, not per month.** The dashboard's month picker moves
`period` on every press, and every API call writes a row to บันทึกระบบ by design
(`lib/accessLog.js` records reads too — it is a traffic log under มาตรา ๒๖, not
a business audit trail). Keyed on the month, paging through a year would be
twelve requests and twelve log rows; the calendar dialog reuses what the banner
already holds for the same reason.

**`GET /api/holidays` was already open to everyone** — *"Everyone reads the
calendar — the submit form needs it to label the day"* — while the maintained
list lives on ตั้งค่าระบบ → วันหยุดบริษัท, which is admin-and-HR only. The
ปฏิทินวันหยุดประจำปี dialog is that permission finally having a screen.

**A dialog, and deliberately not a screen.** Confirmed as the structure on
2026-08-28: no route of its own and no tab in the bottom bar — a `Modal` opened
from the banner's own pill, which is a bottom sheet below 860px and a centred
dialog above it, with `Modal`'s ✕ at the top right and drag-to-dismiss on a
phone. This app has **one route**; every screen is a `tab` inside it, so giving
the calendar a screen would have been a two-line change that nothing else would
have objected to — which is exactly why the decision is written down here and
pinned in `test/holidayNotice.test.js` rather than left to be re-litigated.

**The year is listed by month**, one `<tbody>` per month with the month's name
as a `<th scope="rowgroup">` across both columns. A row group is what this
actually is, so it is one — not a `<tr>` with a `colSpan` dressed as a heading,
which is the difference between a screen reader announcing สิงหาคม 2569 as the
group a row belongs to and reading it out as an ordinary cell.

**And the rows under a month band drop the month.** The date cell used to read
`8 สิงหาคม 2569` on every line; under a heading that already says สิงหาคม 2569
that is three of four words repeated, so the cell is the day number — `--mono`
and tabular, because it is read down the column — with the weekday under it.
`holidayCalendarByMonth()` in `lib/holidayNotice.js` does the grouping and is
built ON `holidayCalendar()` rather than beside it, so the dialog cannot end up
grouping a row the banner refused to draw. It takes its order from that sort
rather than sorting again: a Map keeps insertion order, so the months come out
chronological without the function knowing what a month is.

**Months with no holiday are not in it**, which is a decision. A year has twelve
months and this list has eight days in it; drawn as twelve headings, eight of
them saying ไม่มีวันหยุด, the dialog becomes a page of empty boxes with the
answer scattered through it. The per-month statement that IS worth making is the
banner's own — *"เดือนนี้ไม่มีวันหยุดบริษัทที่ประกาศไว้"*, about the one month
somebody is actually filing in, where the absence changes what they do.

**Walked on the built app** at 390px and 1280px as a real employee: eight days
in four bands — มกราคม 1, เมษายน 3, สิงหาคม 3, ธันวาคม 1 — the sheet flush to
the bottom edge of the phone and `scope="rowgroup"` on every band. The ✕ sits
12px in from the sheet's right edge on a phone and 20px on the desktop dialog,
which is `Modal`'s own geometry: the calendar draws no close mark of its own.

### ⚑ The phone layout is signed off — these numbers are the template

**Approved 2026-08-28** as the standard for this card on mobile, after five
rounds of adjustment on one banner. What was approved is a shape, and a shape is
only a decision if the numbers that make it are written down:

| | value | why it is that and not the next number |
| --- | --- | --- |
| holiday entry | two lines | the date with its weekday, the name under it |
| date | 13.5px / 600 / `--ink` | the thing being announced |
| holiday name | 12.5px / `--ink-2` | content, subordinate to its date |
| weekday | 12.5px / `--muted` | a *check* on the date, read once |
| between two holidays | **10px** | the line above a date is the previous holiday's NAME |
| date to its own name | **1px** | ten against one is what makes the pair obvious |
| calendar button | full width, centred, **44px** | the phone target this app uses everywhere |
| its edge | `currentColor` at 55%, no fill | outlined, and never the brand green — see below |
| list to button | **10px** | must beat the 3px inside the list |
| fold control | ▲/▼ top right, 44px target | added 2026-08-28; ▲/▼ and never ✕ — see below |
| folded height | **65px** against 253px open | 8.4% of a 390px phone against 32.5% |

**Every one of those is asserted in `test/holidayNotice.test.js`**, so this is a
template the build enforces rather than a paragraph somebody has to remember. A
future change to any of them is a deliberate departure and will say so by
failing; that is the point. The pairs `--ink`, `--ink-2` and `--muted` on
`--green-bg` are held to AA in `test/theme.test.js` on both themes.

**The button stays outlined for a reason that outlives this card.** `+ บันทึก OT
ใหม่` is the filled green button and the only primary action on that screen. A
second green control one card away — even an outlined one — makes the reader
decide which is the point. Anything copying this template onto another screen
inherits that constraint, not just the numbers.

### ย่อ / กาง — and why it does not contradict "ไม่หายไปเอง"

**Added 2026-08-28**, after the template was signed off, and it is the one
change to it that had to be argued rather than measured. This banner was built
to a requirement that reads like the opposite of a fold — *"ให้คงอยู่บนหน้าจอ
ไม่หายไปเอง เพื่อให้พนักงานรับรู้ข้อมูลตรงกันก่อนยื่นเอกสาร"* — and shipped with no
dismiss control at all, pinned by a test that said so.

That requirement is about the announcement being **seen**, not about its height.
Folded, the month and the day count are still on the screen — *"📢 ประกาศวันหยุด
ประจำเดือน สิงหาคม 2569 (3 วัน) ▼"* — and only the detail goes. **There is no
state in the component where the section is not rendered**, and the one early
`return null` is about the fetch, not about a press. That is now what the test
pins, which is a better invariant than "no control exists": it survives the
feature instead of forbidding it.

**▲/▼ and never ✕**, though the request offered both. A mark has to be honest
about what the press does. An ✕ on a notice means *"I have dealt with this, take
it away"* — a promise this control cannot keep, because the banner is back on
the next screen either way, and a reader who pressed ✕ and saw it again reads
that as a bug rather than as a fold.

**The state is a browser preference, not an account setting.** `ot-holiday-fold`
in localStorage, `ot-` prefixed like `ot-theme`, stored as *"folded, or nothing
at all"* so an absent key IS the default — a cleared browser and a browser that
has never been asked behave identically. **Read in a mount effect and never
during render**, the rule `ThemeChoice` follows for the same reason: this
component renders on the server too, and a first render that read localStorage
would throw or disagree with what the browser holds, and React would hydrate the
mismatch. Unlike the theme it needs no boot script and has no flash — the banner
draws nothing until its fetch returns, by which time the effect has long run.
One key for both employee screens: folding it on the dashboard is not a request
to see it again on the form.

**Driven end to end on the built app**, because a persistence feature checked
without a reload is a state variable: open **253px** → press ▲ → **65px**, key
`"1"` → *reload* → still 65px → press ▼ → 253px, key removed → *reload* → still
open. On a 390px phone that hands **188px** back to the ชั่วโมง OT card, which
is 24% of the viewport.

**Two things it got wrong on a phone, reported the day it shipped.** The
calendar pill sat at the end of a line of text, which is right on a desktop
where it is read as part of the paragraph — and wrong on a phone, where that
paragraph wraps to three lines and the pill lands alone under the last of them
hugging the left edge with the card empty beside it. Below 860px it is the
card's own row now: full width, centred, and **44px**, which is the height every
other phone target in this app takes (`.action-row > .btn`, `.pick-list .check`).
Its edge comes up with it — `.fold-pill`'s border is `currentColor` at 28%,
tuned for a pill riding *inside* a sentence, and alone on a row it needs 55% to
read as a control. **Still `currentColor` and still no fill**: `+ บันทึก OT ใหม่`
is the filled green button and the only primary action on that screen, and a
second green control one card away — even an outlined one — would make the
reader decide which is the point.

And the sentence about rates shipped as `--ink-2` at 12.5px, two steps below the
dates at once, which made the line that says what the whole banner was FOR the
faintest thing in it; it went to `--ink`, and then the sentence itself was
removed a few hours later. What survives from that round is the contrast pinning
in `test/theme.test.js`: `--ink` and `--muted` on `--green-bg`, a background it
had never checked against anything but `--green-dark` — an alert puts the panel's
own hue on it, and this banner is the first thing in the app to put ordinary body
text there.

**And with the sentence gone, the button had its air taken back.** `.fold-pill`
carries `margin-top: 8px` for the panel it was written for, where it follows a
paragraph; here it now follows a list of dates, and 8px left it floating with the
removed sentence's worth of space still under it. `.announce .fold-pill` sets
**10px** — which has to beat the 3px between the list's own rows, or the button
reads as a fourth date. Measured after, on the built app: the banner is **176px
on a 390px phone**, 22.6% of that viewport, down from 289px and 37%. It reads
**247px, 31.7%** now that the names are back on lines of their own — the whole
of the difference, and what a three-holiday month costs to say properly.

**And a blue box under the thumb, reported the same day.** Pressing the arrow on
a phone drew a square of the browser's own highlight colour over it, and the
focus rectangle could stay behind after the finger lifted. Two different things
draw that box — the tap highlight while the press is down, `outline` after it —
and both are sized to the **44px hit area**, not to the 11px glyph, so what a
reader sees is a blue box in the corner of the announcement with an arrow
somewhere inside it.

**The fix was written here and does not live here**, which is worth recording
because the round that moved it came a few hours later on the same day: the next
report said *"น่าจะเป็นทุกปุ่มที่อยู่ในระบบเลย"*, and it was — see
[The two rectangles a browser draws](#the-two-rectangles-a-browser-draws-on-a-control).
`-webkit-tap-highlight-color` is inherited and is now declared once on `html`;
the ring is a base `:focus-visible` at the lowest specificity in the file.
`.announce-fold` keeps **one declaration** out of all of it — `outline-offset:
1px` instead of the base 2px, because this button's 44px hit area is held out of
the layout by negative margins and a ring 2px out is drawn into the heading
beside it. The 6px radius stays with it, for the same reason: the ring follows
the box, and every other corner in this panel is round.


### วันเกิดพนักงานเป็นวันหยุดของคนนั้น — two flags, and a remark that moved

A benefit that arrived after the twelve, and the only rule in the system whose
answer depends on **who** worked rather than only on when.

| Flag | What it decides | Arithmetic? |
|---|---|---|
| `birthdayHolidayEnabled` | Off by default. On, a birthday falling Mon–Fri is a holiday for that person alone: 08:00–17:00 goes to `ot15_holiday`, the hours either side to `ot3_holiday` | **Yes** |
| `birthdayLeapFallback` | Which day a 29 February birthday lands on in a non-leap year — `'feb28'` (default), `'mar01'` or `'none'` | **Yes** |

There was a third, `birthdayReasonOnForm`, and it is **gone** — see
[Where “วันเกิด” is printed](#where-วนเกด-is-printed) below.

Because the day type now depends on the person, the engine no longer resolves
it. `computeSession` takes a **`dayTypes` map** the caller has already resolved,
and a date missing from that map **throws** rather than defaulting to a working
day — guessing would put holiday hours in the ×1.5 weekday column with nothing
on the entry, the form or the audit trail recording that a guess was made.
`resolveDayTypes()` in `src/lib/otEngine.js` is the whole rule; the engine
itself never learns that birthdays exist.

Segments also carry a `dayReason` (`weekend` / `companyHoliday` / `birthday`)
alongside `dayType`. The arithmetic never reads it. It exists because the reason
is not recoverable afterwards: an overnight session starting on a birthday
Friday and running into Saturday produces two identical-looking `ot3_holiday`
segments that got there by different rules, and only one of them moves if the
benefit is withdrawn.

### Where “วันเกิด” is printed

**Not on F-HR-027.** It used to be: the sheet's calendar marked the date วันหยุด
and printed “วันเกิด” under the day number, behind `birthdayReasonOnForm`,
default on. HR answered that question on **2026-08-10** and answered it the other
way — F-HR-027 Rev.4 is a controlled form and the word is off it. So the flag is
retired rather than defaulted off: a decision that has been made is not a
setting, and a dropdown would leave the word one click from the form. The sheet
prints the day number alone, and `formDayTypes()` in `lib/reports.js`
**takes no birth date** — a signature that cannot be passed the wrong argument is
a stronger rule than a flag both servers have to remember to read.

Nothing on that sheet ever rendered a day type, so what this removed is the note
and only the note. A Tuesday a birthday made a holiday still prints its hours in
the วันหยุด columns, because those come from `entry.segments`.

**On สรุป OT ส่งบัญชี, beside the row — “วันเกิด”.** Where HR wrote it by
hand on the paper this sheet replaces, and for the reason they did: ×1.5 วันหยุด
hours against somebody who worked an ordinary Tuesday read as an error, and
accounting sends a sheet that does not explain it back. The grid stops after
**3.00** and the 82mm of white to its right is a borderless fifth column carrying
the remark — no heading, no rules, no tint, empty on every row with nothing to
explain, and **no change to `ROWS_PER_PAGE`**: it is a cell in an existing row,
which is the same trick the ไม่ถูกนับ flag uses in the thead margin band.

**The word alone on the paper; the hours where they are summed.** The strip used
to read “วันเกิด 8.00 ชม.” — HR asked on **2026-08-11** for the hours off it, so
the printed sheet matches the handwriting it replaces. The split is still a
SPLIT rather than a new figure, and it is still carried: `birthday_hours` in the
CSV and the หมายเหตุ sentence beside it, which is the file accounting keys from
when the 1.50 column covers both a Saturday and a birthday. On screen,
ตรวจสอบ/ส่งบัญชี still shows *“วันเกิด · 8.00 ชม. อยู่ในช่องวันหยุด”* — that is
the screen the figure is checked on. `ot15Hours` is unchanged by the split's
existence, nothing sums the two together, and `reconcile()` still balances
`filed = reported + unaccounted`.

**In the CSV as `birthday_hours`, appended last.** After หมายเหตุ, never inserted
— accounting's sheets count columns from the left and a column in the middle
shifts every one after it with no error anywhere. Blank rather than `0.00` for
somebody with none, like every other hour column in that file, and subtotalled on
the รวมแผนก / รวมทั้งหมด lines so the column adds up down the page. ASCII and
unlocalised for the reason `company_code` is: it is the column their system sums.
The Thai sentence stays in หมายเหตุ as well — that is the remark the *paper*
carries, so a person holding both reads the same words on each.

**Read off the segment, never off the roster.** `birthdayHoursOf()` in
`lib/accountingRows.js` sums the segments whose `dayReason` is `birthday` — a
label written when the entry was filed, which is also why the sheet keeps
explaining a figure after HR turns the benefit off: the hours stayed, so the
explanation stays with them. The report loads no `birthDate`, resolves no
calendar, and returns a NUMBER with no date on it to leak.

**THE MONTH MAY BE DISCLOSED; THE DATE MAY NOT.** That is the rule that replaced
“the submission sheet never mentions a birthday”, deliberately, when accounting
asked for the remark. What they are told is how many hours in the month came from
a birthday — enough to reconcile the figure beside it — and never which day. The
older rule and its test are gone; `test/birthdayOnPaper.test.js` pins the new one,
including that no `birthdayDate`-shaped field exists anywhere on the path.

**Not on สรุป OT แยกแผนก.** That sheet goes to management, not to accounting, and
it has no figure that reads as an error without the remark — so adding it there
would disclose something for no reason. It is HR's call to make, not a
consistency argument, and it is pinned as absent.

`birthDate` itself remains not colleague-visible: `publicEmployee()` filters it out
of the roster for everyone except the person, HR and admin — managers included.

### สวัสดิการวันเกิด — เจ้าของวันเกิดยื่นเอง ผ่านหัวหน้าเหมือนใบปกติ

**HR's rule, 2026-09-03**, and it reverses the arrangement this section used to
describe end to end. The birthday holiday is claimed by the person whose
birthday it is, on the ordinary OT form, with a **วันเกิด** tick-box on it, and
the request goes to the หัวหน้า and then to ฝ่ายบุคคล like every other request.
Two signatures, §6 unbent, one door.

#### What the tick does, and what it does not

It is **a claim, not a label**. Ticking it fills 08:00–17:00 into the two time
boxes — a สวัสดิการวันเกิด is a whole day off, so its hours are a day shift and
nothing like the 17:00–20:00 the form otherwise opens on — and then the server
checks it: `birthdayTickRefusal()` in [`lib/entries.js`](lib/entries.js) reads
the `dayTypes` map `loadContext` already resolved and answers with a sentence
when the day is not what the tick says. `POST /api/entries`, the edit path and
the preview all refuse with that one sentence, so the line on the screen and the
line in the 409 are the same line.

It does **not** decide the hours. `resolveDayTypes()` has already read the
person's stored วันเกิด under the policy in force on the work date and answered
holiday-because-birthday, so an untouched form filed on one's own birthday
computes and pays exactly as a ticked one. Nothing is stored either: the tick is
not a field on `OtEntry`, and every screen that marks such a row reads it back
off `segments[].dayReason` (`isBirthdayWelfare()`). A second copy on the entry
could disagree with the engine, and there would be no way to tell which one was
lying.

**Since 2026-09-07 รออนุมัติ OT is one of those screens** — asked for together
with the เหมารายวัน chip, *เพื่อให้ผู้อนุมัติรู้*. `BirthdayWelfareMark` is drawn
in the queue's `รายละเอียด` column and in its pop-up, and it answers the
question that row poses on its own: hours sitting in the **OT วันหยุด** columns
on a date the วัน column calls อ. Reading `dayReason` rather than the tick is
what makes it right on a row whose owner's วันเกิด was corrected after filing —
it says what the hours ARE, not what somebody claimed. The chip's `title` used
to end *ฝ่ายบุคคลเป็นผู้บันทึกและอนุมัติรายการนี้ให้*, which went with the queue
on 2026-09-03 and had survived only because nothing drew the chip where it was
plainly wrong; on this screen it would tell a หัวหน้า mid-decision that the
request under their finger had already been recorded and approved. **Who filed a
row is `ProxyMark`'s question**, answered from the row's own history, and that
stays right on the rows filed under the old arrangement too.

Two refusals, because the two mistakes have different ways out:

- **an ordinary workday** — the tick is on the wrong date. Pick the day that
  matches ทะเบียนพนักงาน, or take the tick off and file ordinary OT.
- **a Saturday or a company holiday** — the day was already วันหยุด for
  everybody, so the birthday rule added nothing (`resolveDayTypes` answers
  `weekend` / `companyHoliday`, never `birthday`). The sentence says the hours
  **still count in full** as an ordinary holiday request, because being told
  only “ไม่ได้” over a day somebody worked reads as their hours being refused.

The form cannot check any of this itself and is not asked to: `publicEmployee()`
keeps `birthDate` off the roster the browser holds, so the preview answers and
the form prints what it gets back — the same shape `weekdayRefusal` has.

#### ~~วันเกิดที่ยังไม่มีใบ~~ — what was withdrawn with it, and what that cost

Everything ฝ่ายบุคคล used to do about birthdays went on the same day: the queue
**วันเกิดรอตรวจ**, the month table **วันเกิดของเดือนนี้**, the two buttons on
every row, the “ไม่ได้มาทำงาน” record, the single-signature filing, four routes,
three components, three lib files, one model and one policy flag.

**The problem it existed for was real, and is worth stating before the reason it
went.** A birthday falling Mon–Fri is a holiday for one person, and the day
looks exactly like a working day: same shift, same colleagues, nothing on any
calendar. So the request went unfiled — unlike a Saturday, which announces
itself — and the benefit ended up granted in the settings and claimed by nobody.
ฝ่ายบุคคล chased it: a queue listed every birthday with no request against it,
they read the fingerprint scanner's own export for that person on that date, and
they typed the two times. Because they were holding the evidence a หัวหน้า would
have been asked for, that one act both filed and approved the request — the only
filing in this system that ever reached `approved` with a single signature on
it, recorded honestly as `submit_hr_verified` with the reason on the row.

**Why it is not needed.** The person whose birthday it is knows it is their
birthday. Nothing else in this system chases unfiled hours — an evening nobody
files is simply an evening nobody files — and once the day is theirs to claim,
an unclaimed birthday is the same kind of thing.

**What it cost, said plainly rather than left to be discovered.** Nothing now
notices somebody who worked their birthday and never filed. That is a deliberate
trade, and what it bought is a second workflow, a second write path, a second
kind of signature and a whole screen out of the system.

> This paragraph read “**The system has no way to know they were here; the
> fingerprint scanner is not connected to it and never was — a person read that
> export**” until 2026-09-04, when ฝ่ายบุคคล got a button on ตรวจสอบประจำเดือน
> that imports the scanner's own `.txt`. **Half of that sentence is now false and
> the half that matters is still true.** The export is in the database —
> `otScanPunches` holds one row per scan, so a query CAN say that somebody's
> finger was on the machine on their birthday. What has not changed is that
> **nothing asks it**: no screen, no report and no rule reads that collection,
> and a person still has to look. The scanner is a store, not a source; see
> `src/models/ScanPunch.js` for why the deciding was deliberately left undone.

**Two more consequences worth writing down**, because each was a property of the
withdrawn path and not of the feature it served:

- **The submission window now reaches birthdays too.** “app/api/birthday/entries”
  was deliberately exempt from `maxPastSubmissionDays` — the queue existed to
  settle days that had been MISSED, sometimes weeks back, and a rolling window
  would have greyed out exactly those. There is no exempt door now. That key is
  `null` today (see §ยื่นย้อนหลัง), so nothing is out of reach yet; the day HR
  sets a number, a birthday nobody filed in time goes out of reach with
  everything else, and no second path can still open it.
- **หัวหน้า had no route to their own birthday — CLOSED the same day.** It read
  "§2 keeps them out of `POST /api/entries` (`maySubmitOt()` is
  `role === 'employee'` and nothing else) … **[OPEN]** — HR's answer on
  2026-09-03 is that approvers will get a way to file their own OT, with rules
  still to be given". The rules were given that afternoon and are the routing
  matrix (§ใบของใคร ไปหาใครเซ็น): `maySubmitOt()` is true for every บทบาท,
  a หัวหน้างาน's own request goes to a ผู้จัดการแผนก, and the birthday holiday
  they were always granted is now a ใบ they file themselves like anybody else.

#### The rows it wrote are still in the database, and still say what they are

`submit_hr_verified` stays in `OtEntry`'s history enum, `isHrVerifiedBirthday()`
still reads it, and ตรวจสอบประจำเดือน still counts those rows for the months
they fall in — “HR อนุมัติชั้นเดียว *n* รายการ”. A row filed under a rule that
has since been withdrawn is still a row somebody signed for. The same goes for
the “otBirthdayChecks” collection the “ไม่ได้มาทำงาน” button wrote to: nothing
reads it any more, and nothing deletes it.

### A request that computes to nothing is refused, in words

08:00–17:00 on an ordinary Wednesday is entirely normal working time, so the
engine keeps none of it (`NORMAL_HOURS_IGNORED`) and the session totals zero.
**All four write paths refuse it** rather than storing the nought: a 0-hour
request is a row in a queue, a line on F-HR-027 and a name in a monthly total, all
saying somebody worked no overtime, and none of them can be told apart from a
mistake.

The sentence is `noOtHoursMessage()` in [`lib/entries.js`](lib/entries.js), in one
place because four routes on two servers say it. It names the boundary from the
**policy** rather than hard-coding 08:00–17:00, and it names the way out — a
holiday, including your own birthday when the rule is on, counts the whole day. On
a day that already IS a holiday it says something else entirely: there is no
normal working time to blame, so a nought there means the break rule or the
rounding ate the session.

It also takes the **engine's result**, for the one case where no sentence about
the clock is true. เวลาขั้นต่ำในการเริ่มนับ OT can empty a session that is on the
right day, at the right hours, and long enough to have produced OT — a 25-minute
callout under a 30-minute buffer. Every other explanation would send somebody
back to a form that is already correct, so that one names the buffer, says how
many minutes were worked against it, and says not to change anything.

**A replay is the fifth path and holds the same rule.** Recomputing an entry that
comes out at nought — the buffer raised, the block widened, the core boundary
moved — fails that entry rather than storing the nought: it keeps the hours it
was filed with, and the save reports how many were skipped and why. An entry
already in a queue is not somewhere a 0 may appear by a rule change that nobody
looked at it under.

**และช่อง “วันเกิด” ที่ติ๊กไว้ ต้องเป็นวันเกิดจริง.** It read *“และวันเกิดของ
ตัวเอง ยื่นเองไม่ได้เลย”* from **2026-08-31** to **2026-09-03**: สวัสดิการวันเกิด
was a day the company granted and ฝ่ายบุคคล recorded off the fingerprint
scanner's export, so it was not something a person filed for themselves, and
`birthdayOtRefusal` answered 409 on both write paths. HR reversed that with the
queue behind it — see §สวัสดิการวันเกิด above. What refuses now is the opposite
mistake: `birthdayTickRefusal()` in [`lib/entries.js`](lib/entries.js) answers
409 when the **วันเกิด** box is ticked and the day is not one, on POST
/api/entries and on the edit route behind it — the commonest correction there is
moves `workDate`, and without it a ticked request could be filed on the one day
the tick is true and dragged onto any other.

**It is a refusal on the ordinary path, not a hidden field.** There is no
ประเภท OT dropdown and the tick is not one: the kind of day is RESOLVED from the
person's stored วันเกิด, and the box only says what the filer believes about it.
The form learns the answer the way it learns `weekdayOtRefusal` — by asking the
preview, which returns the very sentence the write path would refuse with — and
greys บันทึก on it. A browser that could work this out for itself would have to
be sent a birth date, which is the one thing it may not hold (`publicEmployee`).

**Two things it deliberately does NOT refuse.** A **หัวหน้า บันทึกแทนลูกทีม** on
a day that happens to be their team member's birthday files as it always did:
the tick is not theirs to give, they are not told whose birthday it is, and the
hours land in the วันหยุด columns anyway because the engine put them there. And
the **tail of an overnight shift**: a request filed against an ordinary Monday
that runs past midnight into the filer's birthday is Monday's request and files.
The rule asks about `workDate` and nothing else in the map — a tick on such a
request would be a claim about the wrong day, and *not* ticking it costs nothing.

**The note above the split is what explains that tail** — and, since 2026-09-03,
the day itself for anybody who did not tick the box. The form prints, above the
figures, that the hours went to the วันหยุด columns because the date is the
filer's own birthday and *ยื่นถูกแล้ว*, read off the preview's `dayReason` rather
than recomputed in the browser. It is withheld on a proxy filing, since it would
tell a หัวหน้า when their team member was born, and withheld when the box IS
ticked, since the ⓘ line at the top of the form has already said it.

**And ฝ่ายบุคคล can put the tick right without refusing the request — 2026-09-07.**
The box is in `แก้ไขชั่วโมง` inside รายละเอียด on รออนุมัติ OT as well as on the
filing form (`QuickEdit` in [`components/ApprovalQueue.jsx`](components/ApprovalQueue.jsx)),
because a request filed with the box in the wrong state had one way out of that
screen and it was ไม่อนุมัติ — the round trip the panel exists to spare. It is
the same claim checked the same way: the panel asks the preview, prints
`birthdayRefusal` in its one banner and greys บันทึกชั่วโมงใหม่ on it.

**Only ฝ่ายบุคคล and ผู้ดูแลระบบ are shown that box**, through
`mayCorrectEntries` — the very predicate `editPermission` accepts a correction
from, so the tick cannot be drawn for somebody the route would answer 403 to. It
is the หัวหน้า rule of the paragraph above, turned around: a signer is not told
when their team member was born, so a box they could only tick by guessing is a
box that teaches them the answer through its refusal. **เหมารายวัน is NOT behind
that gate** — whether a day was hired whole is not a private fact about a person.
The ตำแหน่ง rule added on 2026-09-08 (§ช่องติ๊กเหมารายวันแสดงเฉพาะเจ้าหน้าที่บริการ)
is on the **filing form only**: this panel is where a tick filed wrongly gets put
right, and a gate here would be a gate on the correction as well as on the claim.

### เหมารายวัน — a day hired whole counts eight hours of OT ×1.5, in the column the day decides

**HR's rule, 2026-09-03**, asked for in these words: some departments do work
เหมา, *but not every day and not everybody*. So it is a **tick on the request**
and not the department-wide `otMode: 'daily'` beside it, which answers a
different question — “does ordinary weekday OT exist in this department at all”
— and goes on answering it unchanged. Only the person filling the form in knows
which day was sold that way, which is why `flatDaily` is an entered field on the
entry, is in `ENTERED_FIELDS`, and makes an edit that toggles it a real edit with
a `before` on it.

Ticking it fills 08:00–17:00 in, like the **วันเกิด** box beside it and through
the same one handler, so the two cannot come to fill in different days. **เวลาเริ่ม
stays editable** — that was asked for in the same breath, because somebody who
came in at 07:30 files 07:30 — and on a flat day the times then change **nothing
at all** in the figures.

**เวลาสิ้นสุด is not typed; it is เวลาเริ่ม plus nine hours.** HR, 2026-09-07:
*เปลี่ยนเวลาเริ่มได้ แต่เวลาจบไม่สามารถปรับได้ ให้บวกจากเวลาเริ่ม 9 ชั่วโมงอัตโนมัติ
… คือ บวกเวลาพักด้วย*. Start at 07:00 and the box reads 16:00; the box is greyed
out and moves only when the start does. A flat day is a **fixed length** — the
office day bought whole — so its finish is an answer to where it began rather
than a second thing to be typed, and 07:00–18:00 was a row that read as eleven
hours, paid eight, and carried nothing explaining the gap.

> This section read “**The times stay editable**” until 2026-09-07, of both
> boxes. Only the start half of that survives. The วันเกิด tick beside it is
> **unchanged** and both of its times are still free: a birthday is an ordinary
> shift on a day that happens to be a holiday, and its length is whatever it was.

**Nine on the clock, eight on the pay, and both are true.** The span is
`FLAT_DAY_SPAN_MINUTES` in [`lib/entries.js`](lib/entries.js) — eight hours of
work with the hour at noon in the middle of them — and it decides only what the
two boxes read. The figure stays `flatDailyMinutes()`, derived from the policy
below, so **ใบขออนุมัติทำงานล่วงเวลา counts eight hours, break excluded**, on a
07:00–16:00 day exactly as on an 08:00–17:00 one. `flatDayEnd('08:00')` is
`'17:00'`, which is what keeps the fill and the rule from drifting apart;
test/flatDaily.test.js holds them to it.

The derived end **wraps**: a flat day begun at 16:00 finishes at 01:00, and an
end before its start with `endsNextDay` false is `END_BEFORE_START` out of the
engine, on a time nobody typed. The same press that computes the end computes
whether it crossed midnight.

> This paragraph read "**ทำงานข้ามคืน is greyed out with it**" until 2026-09-08.
> There is no such box on this form any more — it was removed for every kind of
> day, not only for flat ones, and the wrap is now announced by the amber
> `ข้ามคืน · สิ้นสุดวัน…ถัดไป` line beside เวลาสิ้นสุด. See
> §ทำงานข้ามคืนไม่ใช่คำถามอีกต่อไป below.

**A flat
row already stored keeps its own times** and is not re-derived when the form
opens it — 08:00–20:00 was a legal flat day before this rule, its end is the
record of when somebody was on the premises, and the figures are eight either
way. Re-picking เวลาเริ่ม is what re-derives it.

**The tick is also in `แก้ไขชั่วโมง` on รออนุมัติ OT — 2026-09-07 — and there it
fills in nothing at all.** A request filed without it reads as an ordinary
twelve-hour shift and pays like one, with nothing on the row saying a tick is
missing; before this, putting that right meant refusing the request and having
it filed again. What does NOT come across from the filing form is the
08:00–17:00 fill: on that form those two times are a default nobody has typed
over yet, and in the review panel they are the times printed on F-HR-027 and
signed. Overwriting them would falsify the sheet to move a figure the sheet does
not carry — eight hours whatever the clock says. The rest is the same rule from
the same `flatDayEnd`: the end box is greyed, and re-picking เวลาเริ่ม is what
moves it. See `QuickEdit` in [`components/ApprovalQueue.jsx`](components/ApprovalQueue.jsx).

#### ช่องติ๊กเหมารายวันแสดงเฉพาะเจ้าหน้าที่บริการ

**HR, 2026-09-08:** *ช่องติ๊กเหมารายวันแสดงเฉพาะเจ้าหน้าที่บริการ*. Nine people on
the live roster hold that ตำแหน่ง and they are the only ones sold by the day; for
everybody else the box was a control with no correct use, sitting beside two that
have one. The list is `FLAT_DAILY_POSITIONS` in [`lib/entries.js`](lib/entries.js)
and `isFlatDailyPosition` is the predicate the form draws behind.

**A ตำแหน่ง and not a แผนก, matched whole.** `หัวหน้าแผนกบริการ` is on the same
team and is deliberately not offered the box: the rule HR gave names a job, not a
team. A substring match on `บริการ` would take that row in, and every ตำแหน่ง
containing the word after it — the shape of mistake nobody reports, because a box
shown to too many people looks exactly like a box.

**Whose ตำแหน่ง is asked follows who the request is for**, the same question the
preview’s `forWhom` answers: the signed-in person on their own form and on
ฝ่ายบุคคล’s correction of their row (`position`, handed in by the screen that
already holds the person — this form fetches nobody), and the **ticked ลูกทีม** on
บันทึก OT แทนพนักงาน. There it is `every` and not `some`, with a ticked list
required: a batch carries one set of ticks for everybody in it, so a box shown
because one name in eight qualifies is a box that writes เหมารายวัน onto the other
seven.

**It is a rule about what is DRAWN, not about what is accepted.** The write path is
untouched — `flatDaily` is still an entered field POST /api/entries takes from
anybody, and every row already carrying it is read, printed and priced exactly as
before. Which is why **the box is shown anyway when it is already ticked**,
whatever the ตำแหน่ง says: a request filed before this rule, or one ฝ่ายบุคคล
ticked from แก้ไขชั่วโมง, would otherwise open here with eight hours priced onto it
and no control on the screen able to take the flag off. The rule withholds a new
claim; it never swallows a stored one.

#### ไม่พักเที่ยง — offered on a day the whole company has off, and on no other

**HR, 2026-09-08:** *ช่องติ๊กไม่พักเที่ยง โชว์เฉพาะวันหยุดเสาร์อาทิตย์และวันหยุด
ของบริษัท ไม่รวมวันเกิด*. On an ordinary weekday the box was a question about an
hour nobody was working through: a 17:00–20:00 evening does not cross noon, so
ticking it changed nothing, and a control that changes nothing is a control
somebody eventually ticks anyway.

`isCompanyOffDay` in [`lib/entries.js`](lib/entries.js) is the predicate — the
holiday calendar plus the policy’s own `weekendDays`, and nothing else.

**The exclusion HR asked for is the boundary this app already enforces.** A
สวัสดิการวันเกิด is a holiday for one person, resolved from a stored วันเกิด that
this screen is **not allowed to hold** — `publicEmployee` keeps `birthDate` off
every roster a manager reads. So the rule is answered in the browser, from the
company calendar, and a birthday cannot register as a company day off even by
accident: there is no argument to pass one in. That is why this is not read off
the preview, which knows the person and would have to be trimmed.

Two more things fall out of answering it from the calendar rather than the
preview. It works on **บันทึก OT แทนพนักงาน before a ลูกทีม is ticked** — the
preview is withheld until then, and whether a Saturday is a Saturday has nothing
to do with who is filing. And it **does not flicker**: the calendar is fetched
once per year (`/holidays?year=`), not once per keystroke in a time box.

**Already ticked, always shown** — the same exception `mayTickFlatDaily` carries,
and reachable in one sitting here rather than only across a rule change: tick it
on a Saturday, then move วันที่ทำงาน to the Tuesday. Without the guard the box
vanishes with the flag still true, and an hour goes undeducted with nothing on
the screen able to put it back. Unticking it on that Tuesday is what makes the
box go.

**Nothing here decides a figure.** `noBreakTaken` is still an entered field the
write path takes from anybody and the engine still deducts the lunch hour from
it — `weekendDays` was added to what `/api/auth/me` sends purely so the browser
can draw this. A failed calendar fetch leaves the box undrawn on a day it could
have been offered, which is the safe direction to be wrong in.

**And the strip itself goes when all three are withheld**, which is now
reachable: บันทึก OT แทนพนักงาน on an ordinary Tuesday with nobody ticked draws no
วันเกิด (proxy), no เหมารายวัน (no ตำแหน่ง to read) and no ไม่พักเที่ยง.

#### ทำงานข้ามคืนไม่ใช่คำถามอีกต่อไป — the tick came off the filing form

**HR, 2026-09-08, in the same breath as the re-ordering:** *ตัดช่องติ๊กข้ามคืนออก*.
It was never a question anybody could answer two ways. The engine accepts exactly
one value of `endsNextDay` per pair of times and throws on the other, so every tick
of that box was either redundant or a server error — and the error came back as
**"A single session cannot exceed 24 hours"**, a sentence about a limit for what
was really a tick-box in the wrong state.

`endsNextDayFor(startTime, endTime)` in [`lib/entries.js`](lib/entries.js) is this
app’s one answer to the question, and it is now asked on **every press that moves
a time**: `setStart` and `setEnd` in [`components/OtForm.jsx`](components/OtForm.jsx).
The field is unchanged — still entered, still posted, still stored, still what the
engine and F-HR-027 read — only the person has stopped being asked for it.

**The reader is still told.** With no box to look at, the amber
`ข้ามคืน · สิ้นสุดวัน…ถัดไป` line beside เวลาสิ้นสุด is the only thing on the screen
that says a shift wraps, so it says the word as well as the day, and it is drawn
from `form.endsNextDay` — the very value about to be posted.

**What it cost, said plainly:** a 17:00 shift ending 20:00 the NEXT day —
twenty-seven hours — can no longer be filed. The engine refused it as `TOO_LONG`
before this, so nothing that used to save has stopped saving.

`แก้ไขชั่วโมง` on รออนุมัติ OT took the same road on 2026-09-07 and stopped one step
short: it keeps a greyed, read-only box that **reports** the answer. The two screens
have not drifted — a reviewer correcting somebody else’s times is reading a record,
and the flag is part of what they are checking.

#### The eight hours are OT ×1.5, and the day says which column

**HR settled it on 2026-09-07, in one sentence:** *ให้คิดตามวันไปเลย **ถ้าวันหยุด
ก็ใส่ 8 ชั่วโมงวันหยุด ถ้าไม่ใช่วันหยุดก็ใส่ 8 ชั่วโมงวันปกติ** แต่แค่เป็นแบบเหมา*.
Three decisions in one line, and they are separable:

- **The column is the day's.** A holiday — Saturday, Sunday, the company
  calendar, or the filer's own วันเกิด — puts the eight hours in `ot15_holiday`;
  an ordinary working day puts them in `ot15_weekday`. Nothing in the flat branch
  re-decides what kind of day it is: `resolveDayTypes` has already answered that
  for this employee, and the answer is read rather than recomputed.
- **The length is the tick's.** `flatDailyMinutes(policy)` and nothing else,
  in both directions — *สแกนเข้าก่อนหรือออกก่อนหรือหลัง 17:00 น. ก็คือ 8 ชั่วโมง*.
- **The rate is ×1.5 always.** On a holiday every minute is a holiday minute, so
  reading the bucket off the clock would put an evening start in `ot3_holiday`.
  **`ot3_holiday` is nought on every flat day there is** — the multiplier is
  written into the branch and never clocked.

**An overnight flat shift is one day and one row**, dated `workDate`. A Saturday
evening running to 06:00 Sunday is eight hours in total rather than eight per
date, and the column is Saturday's — reading the far side would let it depend on
how late somebody stayed, which is the opposite of *แบบเหมา*.

**A flat day now spends the ceiling and reaches payroll's multiplier**, and that
is the part to say out loud rather than leave to be discovered in a total: hours
in a rate column are counted by `lib/caps.js` against the department's monthly
and weekly limits and are weighted ×1.5 on สรุป OT ส่งบัญชี. Under the
2026-09-04 reading they did neither — they were `normalHours`, which no ceiling
reads. Walked on 2026-09-07: filing one flat weekday for an employee already at
34 hours of a 40-hour month put the row over the limit, and signing it cost the
approver a written reason, exactly as any other over-ceiling row does.

> **This has been answered three times and the two withdrawn readings are worth
> keeping**, because each explains a shape in the code and in the tests.
>
> **A ceiling** (2026-09-03 → 2026-09-04): the day was computed the ordinary way
> and trimmed back to eight from the end. An evening beginning at 20:00 kept its
> `ot3_holiday`, and a half day was paid a half day, because a ceiling is a
> maximum.
>
> **Not OT at all** (2026-09-04 → 2026-09-07): *ก็คือ 8 ชั่วโมงไม่มีบวกเพิ่ม*
> read as the ordinary day. All three rate columns at nought and the eight hours
> in `totals.normalHours`, on the reasoning that a day already paid for by the
> flat rate could not also be an overtime claim.
>
> For part of 2026-09-07 there was a fourth, narrower rule between them: OT ×1.5
> **only** on a flat day that fell on the filer's own วันเกิด, *เฉพาะวันที่ไม่ได้
> เป็นวันเสาร์อาทิตย์และวันหยุดบริษัท*, with every other flat day still eight
> normal hours. It was widened the same day to the rule above, and the carve-out
> went with the narrowing that needed it.
>
> What survived all four is the LENGTH. `totals.normalHours` is nought on every
> session the engine computes now, and stays on the model for the rows written in
> those three days — see the field's own note in
> [`src/models/OtEntry.js`](src/models/OtEntry.js). The warning is
> `FLAT_DAILY_CAPPED`, its ceiling-era name, restored with the arithmetic that
> gives it one; `FLAT_DAILY_NO_OT` went out with the reading that produced it.

**Eight is not a setting.** `flatDailyMinutes()` in
[`src/lib/otEngine.js`](src/lib/otEngine.js) derives it from
`coreEndMinute − coreStartMinute` less the lunch hour — the same arithmetic the
ordinary day is already drawn out of — so a company that moves its core hours
moves this with it and there is no second number in ตั้งค่าระบบ for the two to
disagree over.

**It short-circuits the other four rules rather than running after them**, and
the ordering is the rule. The buffer, the rounding block and the minimum each ask
*how much of what was worked is payable OT*, and a flat day does not answer that
question: the figure is the day's own length, agreed in advance. Left in front of
it, `belowMinimum: 'reject'` would throw a flat evening out of the form for being
under an hour of overtime it is not measuring, and `'raise'` would pad a figure
that is already exact. `NORMAL_HOURS_IGNORED` is dropped with them: nothing on a
flat day is ignored for falling inside ordinary hours — the whole day is the
claim.

**Eight however long they stayed — and however short.** *เข้าก่อน / ออกก่อน /
หลัง 17:00* all read the same: a flat RATE is a price, not a measurement, so a
day that was sold whole is worth the whole day even if somebody went home at
noon. This is the half that reverses the ceiling outright, which did not pad a
short day because a ceiling is a maximum. The hours beyond eight are
`flatDailyTrimmed` and are named by `FLAT_DAILY_CAPPED` — 08:00–20:00 on a
holiday is eight counted and three trimmed. A day shorter than eight trims
nothing and says nothing.

**The clock times stay as worked.** `totals.clockHours` is still the whole
shift, `totals.breakHours` is still the break that was taken, the row prints the
times somebody was here, and every scan punch of the day is drawn beside them.
The segment's `minutes` is deliberately not `end − start` — `applyFlatDeduction`
has always shortened a segment without moving its clock.

**A flat day prints on F-HR-027**, and that follows from the rule rather than
from a decision about the paper: the sheet is filled from `entry.segments`,
`onSheet` keeps a request off a month it has no segment in, and a flat day has
one segment carrying eight hours in a rate column. **This is new on 2026-09-07.**
Under the 2026-09-04 reading a flat request had no segments at all — no OT hours,
nothing to put in a rate column — so it was in the system, signed off, and absent
from the overtime form; and the **[OPEN]** item asking ฝ่ายบุคคล whether they
wanted those days listed on paper anyway is **closed by the rule**, not by an
answer. They are on the sheet, in the column the day gives them.

**It was the one request this system stored with no OT hours on it**, and it is
not any more. Every write path refuses `otHours <= 0` — the 0-hour rule, whose
sentence is `noOtHoursMessage` in [`lib/entries.js`](lib/entries.js) — because a
stored nought is a row in a queue, a line on F-HR-027 and a name in a monthly
total all saying somebody worked no overtime, which reads as a mistake and cannot
be told apart from one. `zeroOtHoursAllowed` beside that sentence exempted the
flat day, is still asked by POST, by PUT, by the legacy router, by the replay and
by the บันทึก button, and now **has almost nothing left to excuse**: a flat day
arrives with eight hours like any other request. The one way back to nought is a
policy whose core day is zero-length, and on that policy the exemption is still
the right answer — the alternative is refusing every เหมารายวัน request with a
message about times that are not the problem.

### หนึ่งวัน หนึ่งใบ — one line per day on the paper, one request per day in here

F-HR-027 gives each day of the month **one line**. That is not a layout detail
to work around: two live requests on 5 August have nowhere to print, so the
sheet accounting receives either loses one of them or runs a second line through
a box sized for one. HR asked for the system to hold the paper's shape on
2026-08-31, and **a date now carries one live request and no more** — whatever
the hours are, and whether or not they overlap. 08:00–12:00 and 18:00–21:00 on
one day share not a single minute and are still refused; the day's work belongs
on the day's line, which means one entry covering it.

The rule is `findSameDate` in [`lib/overlap.js`](lib/overlap.js), and the
sentence is `sameDateMessage`: **พบรายการ OT ของวันที่ 05/08/2026 แล้ว
กรุณาแก้ไขรายการเดิม**. The date is written the way the form's own
`<input type="date">` writes it rather than in Thai and พ.ศ., because the person
reading it is looking at that box; a date in prose is spelt the other way
everywhere else in this system, and that is a different job.

**Only live requests hold a day.** The rows compared against come from
`neighbouringEntries` in [`lib/overlapQuery.js`](lib/overlapQuery.js), which
narrows to `CAP_STATUSES` — so a **rejected** or **cancelled** request holds
nothing. That is deliberate and load-bearing rather than an oversight in the
strictness: **ส่งใหม่** files a fresh request for the same date after a
rejection, and an employee may cancel their own and file again, and both are
shipped features that this rule would otherwise have quietly removed. Neither a
rejected nor a cancelled row ever reaches an F-HR-027 line, which is the whole
reason the rule exists, so neither has any claim on one. *If HR does want a date
locked by a cancelled row as well, the change is one status list in
`neighbouringEntries` — say so and it moves.*

#### เวลาทับซ้อน is still underneath it, and still needed

The date rule is stricter than the minute rule on one day and **blind exactly
where it is not**: a shift filed against Friday that runs to 02:00 prints on
Friday's line while occupying four hours of Saturday. A request on Saturday is a
different date, so `findSameDate` allows it, and the two claim the same hours
anyway. That is the pair `findOverlaps` exists for — it places each session on
one timeline shared by every date and asks whether they share a minute, with
both ends half-open so that clocking off one job at 19:00 and onto another is
not a clash. It was written for a pair (17:00–19:00 and 18:30–20:30 on one
evening) that the date rule now catches first, and `latestPerSession` in
[`lib/reports.js`](lib/reports.js) never caught at all — its key is the WHOLE
window, so it fires only on two filings of exactly the same session.

So both run, off one read, in `refuseDayConflict`: the day first, the minutes
behind it, and **never both sentences at once** — a same-date pair is usually an
overlapping pair too, and two sentences about one mistake reads as two mistakes.

**All three write paths ask** — filing, editing, and ฝ่ายบุคคล filing from the
scan record — with a 400 and the offending request named. `test/overlap.test.js`
reads the tree and fails if a route that writes a session forgets to.
An **edit** is where the day rule earns its place on `PATCH`: the commonest
correction there is moves `workDate`, and it can land on a day that is already
filed without the times clashing at all.

**And the form says it before the press.** A refusal on บันทึก is the right
answer at the wrong moment for this mistake: somebody filing a day twice does
not know the first request exists — that is why they are typing it again — so
the whole form gets filled in, read back, and only then refused.
`POST /api/entries/preview` asks the same `refuseDayConflict` on every keystroke
that moves the date or a time, and [`components/OtForm.jsx`](components/OtForm.jsx)
prints **the server's own sentence** with the request it names drawn underneath
as a row — date, window, status chip, and for an overlap the minutes shared —
then greys บันทึก. The sentence is never re-worded in the browser, and neither
rule is re-implemented there: what the screen holds is one month of one list,
and a day can be taken by a request a หัวหน้า filed on this person's behalf or
by one in a month the list is not showing.

The one case that warns instead of blocking is a **proxy batch of more than one
name**. The preview is computed against the first person ticked (`forWhom`), so
what it found is that one person's day, and shutting the button would refuse
seven filings over an eighth person's — `conflictBlocks` is what draws that
line. Each POST is checked against its own person and the summary names whoever
was refused, which is exactly how the ceiling already behaves on that screen.

The rule is enforced where entries are WRITTEN, not where they are printed:
nothing goes back and splits a day that was already double-filed. On 2026-08-31
the database was counted for that — `{employee, workDate}` appears twice for
nobody, at any status, in all 11 entries — so there is nothing to clean up and
no existing row that this makes uneditable.

### Getting the birthday into the system — one reading, every row

**2026-09-04.** The วันเกิด column of a roster CSV is read **strictly
วัน/เดือน/ปี**, asked for in one line: *"ให้ Strict เป็น วัน-เดือน-ปี ถาวร"*.

> ปี > 2400 → **พ.ศ.**, ลบ 543 · ปี ≤ 2400 → **ค.ศ.** ใช้ตามนั้น
> `12/05/1989` · `12-05-1989` · `1/2/2540` · `2540-01-05` — all four accepted

- **Every row, unconditionally.** `05/03/1998` is 5 March whether or not any
  other row in the file has an opinion about it, and no caller can pass an order
  that changes that: `resolveBirthDates(cells)` takes no options at all.
- **Both separators**, `/` and `-`, one or two digits for the day and the month.
  A four-digit leading group can only be a year, so `2540-01-05` and `05/01/2540`
  cannot be confused with each other.
- **The era is per cell**, decided by `lib/smartDate.js` — now the only place in
  the tree that subtracts 543 or compares a year against 2400. The calendar
  check runs on the CONVERTED year: 29 February exists in 2539 only because it
  exists in 1996.
- **A cell that is not a real date under that reading fails its own row.** The
  row is skipped and named on the preview; the rest of the file imports. There
  is no whole-file refusal left, so `resolveBirthDates` returns no `ok` and no
  `fileError`.

#### What went, and what it cost

For a month this section described the opposite design, and the machinery is
worth naming because it is what these two paragraphs replace. `lib/birthDate.js`
treated วัน/เดือน order as a fact about the FILE: it collected evidence (a row
holding `15/05/1998` can only be วัน/เดือน — no month is 15), read the ambiguous
rows beside it under that, refused a file that settled nothing, and — on the
morning of 2026-09-04 — grew a per-file question on the import screen and a
company-wide default in ตั้งค่าระบบ → รูปแบบวันที่ใน CSV to answer it with.
All of it is gone: the evidence pass, the three refusals, the two buttons, the
*Setting.csvDateOrder* field, the settings section that edited it, and the
fifty-two test cases that pinned them.

**What that costs, said plainly because nothing on a screen will say it
afterwards.** A roster that really was written month-first now imports. Every
row of it whose day is 12 or under — roughly two in three — is stored with the
day and month swapped, silently, and **no screen, report or comparison in this
system can ever contradict it**: a birthday is only ever compared against
itself. The remaining third fail their own rows.

**Two things stand between that file and the roster, and neither is decoration:**

- **The preview spells the month as a word.** `05/03/1998 → 5 มีนาคม 1998`, on
  the พนักงาน card, before anything is uploaded. The numerals are what HR is
  already looking at in the file and are exactly what does not tell 5 March from
  3 May. This is why `readableDate` is one of the deliberate exceptions to
  [ทั้งระบบใช้ DD/MM/YYYY](#ทั้งระบบใช้-ddmmyyyy--วันเดือนปี) — rendering it as
  numerals would leave the check checking nothing.
- **A row that cannot be วัน/เดือน says why by name.** `05/25/1998` does not
  fail as *"ไม่มีอยู่จริงในปฏิทิน"*, which would send somebody hunting a
  calendar mistake in a date whose numbers are all correct. It says the file
  looks เดือน/วัน/ปี, names the date the value would be under that reading, and
  says the repair is to the whole column — so one skipped row reads as evidence
  about the file rather than as a puzzle about one person.
- **The template defends itself.** Its sample birthday is `1989-05-25`, and the
  25 is the point: it read `1989-05-12` until 2026-09-04, and an English-locale
  Excel rewrites that as `05/12/1989` on save — which now imports **silently as
  5 December**. A day past 12 turns that same round trip into a row that fails
  loudly instead.

The two paragraphs above used to end differently. The bullet on evidence read
*"`15/05/1998` can only be read one way … so it settles the order for every
ambiguous row beside it, and the screen names the row that decided it"*, and a
`01/01/2540` was marked *sameNumbers* so a file of nothing else would report its
order as `same` rather than claiming to be ISO. Neither is true now: no row
settles anything for another, and `ORDER_LABEL` describes a shape (`iso`, `dmy`,
`mixed`) rather than naming a decision.

#### What HR sees before pressing ยืนยันนำเข้า

Because a wrong reading is indistinguishable from a right one the moment it
lands, the พนักงาน screen **shows the interpretation before it is applied** and
uploads nothing until someone confirms. The preview runs the same pure module
the route does; the server reads the bytes again rather than trusting the dates
the screen computed.

**The rows that will be skipped come first in the sample.** Under a strict
reading a failed row is usually evidence about the whole column, and the first
three cells of a two-hundred-row file would show none of them.

**The panel's colour is a claim about the file, not a standing caution.** It was
amber for every readable file until 2026-09-02, which put a roster with nothing
wrong with it under the same "!" as one with rows about to be dropped — and a
warning that is always on is a warning nobody reads. It is green when the file
imports whole and amber when `rowErrors` names rows that will be skipped. The
third colour is gone with the refusal it stood for: *"and red when nothing will
be imported at all"* stopped being reachable on 2026-09-04. ยืนยันนำเข้า is the
app's ordinary green button and is live the moment the preview appears; a
converted era rides in the ℹ️ line, which is `--info` precisely so it is not one
of the two colours that mean *decide something*.

**A refusal ends with the file picker, not with a sentence about one.** Every
refusal on this card asks for the same thing — open the file in Excel, set the
whole วันเกิด column to `YYYY-MM-DD`, save, upload again — and until 2026-09-04
the only control that could do the last step was the `นำเข้ารายชื่อจาก CSV`
label at the top of a card that is by then several screens tall. เลือกไฟล์ใหม่
now sits on the panel that says to use it, on the red one and on the amber one
where rows are about to be dropped; the green one keeps two buttons, because a
third thing to read before pressing ยืนยันนำเข้า is a cost paid on every
ordinary import.

**And the refusals the preview cannot make now arrive with lines too.** Two
rows spelling one รหัสพนักงาน is a server-only check — `codeCollisions` needs
the roster's own normalisation — as is a row this account may not write. Those
came back as `setError(err.message)`: one sentence, no file name, no lines, and
the `payload` the route had gone to the trouble of sending dropped on the
floor. `importError` is that path's own notice now: it names the file, says
first that **nothing was written — not one row** (which is the only question
anybody actually has after a refused upload), lists the clashing codes by line,
and carries the same เลือกไฟล์ใหม่ button. It listed the birthday column's
blocking lines beside them until 2026-09-04; the วันเกิด column can no longer
refuse a file, so there is nothing of its to list. It is
cleared when a new file is picked, so a refusal can never be read as belonging
to the file beside it.

### ปี พ.ศ. หรือ ค.ศ. — one reader for the whole system

The rule is four lines long, which is exactly why it had been written four
times by **2026-09-02**:

> ปี **> 2400** → พ.ศ. → **ลบ 543** (`2515` → `1972`) · ปี **≤ 2400** → ค.ศ. →
> ใช้ตามนั้น

`lib/holidays.js` had it, `legacy/routes/holidays.js` had a hand copy of that,
`lib/birthDate.js` had a third with a comment saying its 2400 was *"the same
2400 the holiday calendar uses"* — a copy admitting to being one — and the
roster form had none at all. All four now call **`lib/smartDate.js`**, and
`test/smartDate.test.js` fails the build if any other file in `app/`, `lib/`,
`src/`, `components/` or `legacy/` subtracts 543 or compares a year to 2400
again. Adding 543 is not banned and could not be: every screen that prints a
date does it, and a display that is wrong is seen the same day. Subtracting is
what decides what gets **stored**, and that is wrong where nobody can see it.

Collapsing them closed two holes that were live until that day:

- **`normaliseDate()` handed back any `YYYY-MM-DD` untouched.** Of the four ways
  one date can be written, the two ISO ones therefore skipped the era rule
  entirely: an uploaded calendar saying `19/09/2569` imported as 2026 and one
  saying `2569-09-19` imported as **the year 2569**, filing `Holiday.year` in a
  century no screen in this app can draw. The same passthrough skipped the
  calendar, so `2026-02-30` became a holiday on a day that does not exist.
- **The roster form and its two endpoints never read the era at all.**
  `Employee.birthDate` is matched against `^\d{4}-\d{2}-\d{2}$`, and
  `2515-09-19` satisfies that perfectly — so a พ.ศ. year in ISO shape reached
  the database verbatim from anything that was not the CSV import, and was then
  read back as a birthday five centuries away, silently, because a birthday is
  only ever compared against itself. `POST /api/employees` and
  `PATCH /api/employees/:id` now read it through the same function and refuse a
  cell they cannot read rather than dropping it — a วันเกิด is optional, so a
  value quietly discarded looks exactly like a value nobody typed.

**And the วันเกิด box can be typed into now**, which is the reason any of this
came up. Every other date in this app is near today; a birthday is thirty to
sixty years away, and HR is copying it off a personnel sheet that keeps it in
พ.ศ. `PickDate` takes a `typeable` flag — **on for the two วันเกิด boxes and
nothing else in the app** — which puts a `พิมพ์วันที่` row above the calendar
that accepts either era in either shape and **says back what it understood
before it is committed to**:

```
19/09/2515
→ 19/09/2515 · แปลง พ.ศ. → ค.ศ. ให้แล้ว · เก็บเป็น ค.ศ. 1972-09-19
```

> The middle line read "**→ 19 กันยายน 2515**" until 2026-09-04, when the app
> settled on one date form — see §"ทั้งระบบใช้ DD/MM/YYYY" below. What answers
> "which number was the month" is now the ISO half, and that is why it is not
> decoration.

That echo is also what makes `DD/MM/YYYY` safe to assume for a typed value
where a CSV column cannot assume it: `05/03/1998` comes back as
`เก็บเป็น ค.ศ. 1998-03-05` **and says so**, to somebody standing there who can
see that it is wrong. A value
that is only wrong because it is the other way round — `03/25/1998` — is
refused with the swap named (`25/03/1998`) rather than performed, which is the
same guess the CSV importer refuses, declined in the one place a person could
answer it. It commits on Enter or on ใช้วันที่นี้ and **never on blur**: a
half-typed value committing itself when the reader clicks a day in the grid
below would answer with the date they abandoned.

**Storage is ค.ศ.; display stays พ.ศ. everywhere, unchanged.** `thaiDate` adds
543 for every screen, and `thaiText` in `lib/smartDate.js` is the same sentence
for the server side, where `lib/api.js` — which reaches for `fetch` and a token
— has no business being. A test asserts the two agree rather than leaving it to
hope. **The SHAPE those two write changed on 2026-09-04** and the era did not —
see the next section.

---

## ทั้งระบบใช้ DD/MM/YYYY — วัน/เดือน/ปี

**2026-09-04**, asked for in one line: *"ฟิคทั้งระบบให้ใช้ DD/MM/YYYY (วัน/เดือน/ปี)
ใช้ทั้งระบบเลย"*, with either era acceptable. **The era did not move** — every
date on every screen is still พ.ศ., and every date in the database is still ค.ศ.
What moved is the shape.

**A date used to be written three ways depending on where you met it:**

| where | before | now |
| --- | --- | --- |
| prose — pop-ups, printed sheets, confirmations | `19 กันยายน 2569` | `19/09/2569` |
| tables — คิวรออนุมัติ, the accounting note | `19 ก.ย. 69` | `19/09/2569` |
| audit trails — five of them | `19/9/2569 16:03:22` | `19/09/2569 16:03:22` |

Three shapes for one fact is three column widths to lay out for and three things
a reader has to learn are the same thing. The third was the worst of them: it
was whatever `new Date(x).toLocaleString('th-TH')` returned, which is the right
order and the right era **unpadded**, and which changed shape again between
`dateStyle: 'short'` and `'medium'` — บันทึกระบบ used both, side by side, on one
screen.

**Four functions, and no fifth.** `thaiDate` and `thaiStamp` in `lib/api.js` for
the browser; `thaiText` and `thaiStampText` in `lib/smartDate.js` for the server
and the two CSV exports, which take their timezone from the caller because a
file that leaves this machine has no reader's zone to borrow. `thaiDateTime` is
`thaiStamp` without the seconds and with the *น.* — it is what a signature being
READ prints. The short table form was **deleted**: with numerals there is nothing left
for a short form to shorten, and `19/09/2569` is the same ten characters
`19 ก.ย. 69` was.

**Zero-padded, both halves**, which is why these are written by hand rather than
handed to the locale. A column whose dates change width between the 9th and the
10th is the whole reason the padding is not optional.

### The three places a month is still spelled out, on purpose

- **`periodLabel`** — *สิงหาคม 2569*. A งวด is a month; there is no day to put
  in front of it, so DD/MM/YYYY has nothing to say about it. The calendar
  headings and the report headings are the same case.
- **`readableDate` in `lib/birthDate.js`** — the roster-import preview. It
  tells *5 มีนาคม* from *3 พฤษภาคม* for somebody checking a file against the
  people they hired; printing both as `05/03` and `03/05` would answer the
  question by restating it. Since the importer stopped refusing month-first
  files later the same day, this line is the only check left. (Its companion —
  the two ตัวอย่าง on ตั้งค่าระบบ → รูปแบบวันที่ใน CSV — went with that card.)
- **`thaiWords` in `lib/smartDate.js`**, which is the same exception with the
  same reason: it is used once, in the refusal that tells somebody who typed
  `03/25/1998` which date they probably meant.

`test/dateFormat.test.js` holds all of it — the shapes, the padding, the ban on
any locale date formatting in `app/` `lib/` `src/` `components/` `legacy/`, the
two files allowed to touch `Intl.DateTimeFormat` (neither prints a date for a
person to read), and the rule that catches a regression rather than a spelling:
**a month name may not have a day in front of it**, in exactly two files.

---

## ไฟล์สแกนนิ้วมือ — เก็บไว้ก่อน ตัดสินทีหลัง

**2026-09-04.** ฝ่ายบุคคล now import the fingerprint terminals' own `.txt`
from **ตรวจสอบประจำเดือน**, under the month's status card and above the table.
**Four files a month** — two machines × two companies — one button, and
**nothing in the app reads what it stores**.

> The opening of this section read "**Two machines, two shapes, one button**"
> for part of the same day, before HR said that each machine exports ไพรมัส and
> เดมเทค separately. Two shapes was never wrong; it was half of what identifies
> a file, and the half that was missing is the one the person holding four
> exports needs. See the checklist below.

### A month brings FOUR files, and the card is a checklist

Stated by HR on 2026-09-04: **each machine exports each company separately** —
เครื่องที่ 1 · ไพรมัส, เครื่องที่ 1 · เดมเทค, เครื่องที่ 2 · ไพรมัส,
เครื่องที่ 2 · เดมเทค. They are uploaded one at a time, in any order.

So a batch has to know **which of the four it is**, and the two halves of that
are answered differently:

| | read from | when it cannot be read |
|---|---|---|
| **which machine** | the SHAPE of a line — there is no device field anywhere in either file | `mixed` (both shapes in one file) |
| **which company** | the ROSTER: every punch's code is looked up and `companyOf` asked about the person | `mixed` (two payrolls in one file) · `null` (nobody in it is on the roster) |

**The company is never read off the `PM` / `THT` prefix**, and that is not
fussiness: `src/config/companies.js` says in its own words that the prefix is a
convention the roster follows and the stored field is the answer — "a roster
that stops following the prefix convention must not silently move somebody onto
the wrong payroll". So the file's people are looked up, and what the roster says
about them is what decides. Codes that match nobody vote for nothing; they are
counted and listed as `unknownCodes` instead.

**A disagreement is reported, not resolved.** If one file's people are not all
on one payroll, either the premise above has stopped being true or the wrong
export was taken — both are things somebody has to be told, and neither is
something to pick a winner for. The batch is stored with `company: 'mixed'`,
`companyCounts` keeps the evidence (`142 ไพรมัส · 1 เดมเทค` is a leaver's finger;
`80 · 76` is the wrong file), and it **fills no slot**. Refusing the upload
would lose the evidence that the premise moved.

**The screen is a checklist and not a list of uploads**, which is the whole
point of the block: a list of three rows does not answer *which one am I still
missing* — the reader has to hold the expected four in their head and subtract —
and a month where one slot was imported twice and another not at all reads as
"3 ไฟล์" either way. The header counts **slots filled, not files uploaded**.

**Nothing anywhere writes the number four.** It is
`SCAN_FORMATS.length × companies.length` (`buildScanSlots` in `lib/scanFile.js`),
so a third terminal or a third payroll entity grows the grid on its own. A
literal `4` in a component would be a promise that stops being true silently.

#### A second file over the same dates REPLACES the first

*"ถ้าเป็นวันที่ซ้ำกับไฟล์เดิม ให้เอาไฟล์ใหม่ทับไฟล์เก่าไปเลย"* (HR, 2026-09-04).
A re-export is what a corrected file is, so the later one wins.

**The scope is the SLOT × the new file's date range**, and both halves are load-
bearing:

- **The slot** (`format` + `company`, matched exactly). เครื่องที่ 1 and
  เครื่องที่ 2 are two doors and both readings of a day are real, so replacing
  "the day" would delete the other machine's evidence. A file whose company came
  out `mixed` or unresolved can only replace another that came out the same way
  — a file nobody can place must not take over a slot it was never in.
- **The date RANGE, not the set of days present.** A corrected export can
  legitimately DROP a day — one recorded in error — and replacing only the days
  the new file mentions would leave that day's rows standing, which is the one
  outcome nobody could explain afterwards. Inside `from`..`to` the new file is
  the truth, including where it is silent.

**The delete runs BEFORE the insert.** Writing first and deleting after would
need the delete to know which rows it had just written, and a delete that has to
spare something is a delete that will one day spare the wrong thing.

**A deletion nobody can see is the failure mode here**, so both sides are
written down and the screen prints them: the new batch keeps `replaces` (which
files, how many rows each) and `replacedPunchCount`; each old batch gets
`supersededBy`. **The old batch row survives with its `text` intact** — the file
is still the record of what the machine said and of what somebody imported, even
after its rows stopped being the live ones. `buildScanSlots` therefore names the
NEWEST file in a slot, because that is the one whose rows are in the database.

The same BYTES twice is still `previousImport`, found by sha256 — a different
sentence, and now a rarer one: identical bytes replace themselves, so the row
count comes out the same rather than as "0 รายการใหม่".

> Until this landed, a re-import was a NO-OP: `$setOnInsert` kept the first
> file's rows and its provenance, and the screen explained the resulting
> "0 รายการใหม่" with a “slotAlready” line naming the earlier file. That was the
> right default for "the same month uploaded twice" and the wrong one for
> "somebody exported it again after fixing it", which is what actually happens.

**เครื่องที่ 1 is the columns shape and เครื่องที่ 2 is the slashed one** —
answered on 2026-09-04, because it is not derivable from the bytes. The number
is a LABEL: nothing in the system branches on it. (`THT07261.txt` reads as
THT · 07 · 26 · 1 and agrees, which is worth writing down and not worth relying
on.)

### The two files, and why the shape is the only device id there is

```
01/07/2026 07:26:22 THT0107              ← `spaced`  · columns, TIS-620 header
01/07/2026/07:21:27'PM00112              ← `slashed` · UTF-8 with a BOM
```

A line carries three things: the date, the time, and a รหัสพนักงาน. **There is
no in/out flag** — a day with four punches on it says four times and nothing
about which is which — and no serial number, no device field and no header at
all on the second format. The separator is the fingerprint, so it is what
`lib/scanFile.js` reads the machine off, and it is stored on the batch and on
every row. The two patterns cannot both match one line (`spaced` needs
whitespace after the date, `slashed` needs a `/`), so detection is a reading
rather than a guess and does not depend on the order they are tried in.

### The encoding is decided from the bytes, not from the extension

The slashed machine writes UTF-8 with a byte-order mark; the columns machine
writes its header in TIS-620 — `ÇÑ¹/àÇÅÒ` is what `วัน/เวลา` looks like read as
Latin-1. **Today that costs nothing and tomorrow it might cost everything:**
every DATA line in both files is pure ASCII, so a plain UTF-8 decode would parse
every punch correctly and mangle only the header, which is skipped anyway. What
it would also do is store a header of `�` as “the file HR imported”. A record of
a file is worth having only if it is the file. `decodeScanText` tries UTF-8 —
which is self-validating, so a decode with no replacement character is a decode
that was right — and falls back to `windows-874`.

### วัน/เดือน/ปี is not guessed, and a machine set to English is refused loudly

Dates go through `smartDate` (§ปี พ.ศ. หรือ ค.ศ.), which reads the Thai order
and **refuses** `07/25/2026` rather than swapping it. That refusal is what makes
this safe on a file nobody watched being written: a terminal configured in
English produces a file where every day past the 12th fails, so a month of
American-order scans arrives as a pile of errors nobody could mistake for a good
import. What it cannot catch is a file that stops on the 12th — which is why the
preview prints the date range, in whatever shape the rest of the app prints
dates — `scanDateRange` goes through `thaiText` rather than formatting its own,
so it followed the app-wide switch to `01/07/2569` without being touched.

### Every line lands in exactly one of four piles, and the four add up

`punches` · `skipped` (the header, a page break — not a scan at all) ·
`errors` (shaped like a scan, but the date or time does not exist) ·
`duplicates` (the same person, date and second twice in one file). That
arithmetic is what makes the panel on screen **checkable** instead of something
HR has to take on trust, and it is pinned by a test.

### Importing the same month twice is safe, and says so

`otScanPunches` carries a unique index on `{ codeKey, date, time }` and the
import writes `$setOnInsert` upserts, so the second import inserts nothing,
reports `0 รายการใหม่`, and names the earlier file it matched. **A person will
import July twice** — it is the most predictable thing about a monthly manual
step — and without that index every figure ever computed from the collection
would be doubled by an honest mistake nobody would see. `codeKey` is
`normalizeCode()`, so a terminal reconfigured to print `PM-0620` where it used
to print `PM00620` does not double a month either.

### What is kept: the rows AND the file

`otScanBatches` holds the decoded file itself (`text`), its sha256, its size,
who imported it and when. The punches are this system's *reading* of the file,
and a reading can be wrong in ways that surface months later; the file is the
only honest answer to “what did it actually say”. It is the same argument the
withdrawal of ปิดงวด rests on from the other side — the record is the thing that
was signed, and here the machine's own output is the nearest thing to paper.

### ⚠ เวลาไม่ตรงกับไฟล์สแกน — the first reader of the punches, and it is a question

**2026-09-04, later the same day.** ฝ่ายบุคคล's drill-in on ตรวจสอบประจำเดือน
(**ดู / แก้ไขรายการ**) now compares each row's times against the scanner's file
and marks the ones that disagree. It is the first thing in this system to read
`otScanPunches` — and it does not cross the line above.

**Nothing about the row changes.** No hour, no rate bucket, no ceiling, no
status. `scan=check` on `GET /api/entries` hangs a `scanCheck` verdict beside
each row and every figure on it is the figure it was before the flag existed.
The rule is `src/models/ScanPunch.js`'s: **a machine may not restate a sheet two
people signed.** It may raise a question about one, and this is that question.

**Why this needs none of the three unanswered questions.** Deriving hours from
punches requires knowing which punch is in, which is out, and what an odd number
of them means. Asking *"is there a scan near the time this request claims"*
requires none of them: a scan near 17:30 is evidence somebody was at the door at
17:30, whichever direction they were walking.

**Three verdicts, and two of them are not the same warning:**

| | means | tone |
|---|---|---|
| `ok` | the scan-out **reached** the end the request claims (`>=`, no window — 2026-09-07), and the start either has a scan within the tolerance **or** had no scan to have (see below) | no chip, unless it overran by a block — see เกินเวลา |
| `mismatch` | the scan-out came **before** the requested end (ไม่ครบ, by any amount), or the start has a scan that disagrees — the punch is quoted with the shortfall | amber, `.chip.scan-off` |
| `no_scan` | this person has no punches at all that day | quiet, `.chip.scan-none` |

#### The words on the badges are HR's own — เกินเวลา · ไม่ครบ · ไม่ตรง

**2026-09-07**, given as definitions rather than as a change request, which is
how the vocabulary and the arithmetic came to be settled in one go:

| word | ฝ่ายบุคคล's definition | the comparison | chip |
|---|---|---|---|
| **เกินเวลา** | *ขอโอทีมาน้อยกว่าที่ทำจริง — ขอมา 19:00 น. แต่สแกนออก 19:30 น.* | scan-out ≥ end + `SCAN_OVER_MINUTES` | grey, `.chip.scan-over` |
| **ไม่ครบ** | *ขอโอทีมามากกว่าเวลาที่ทำจริง — ขอมาถึง 20:00 น. แต่สแกนออก 19:30 น.* | scan-out < end, by any amount | amber, `.chip.scan-off` |
| **ไม่ตรง** | *ไม่มีการสแกนนิ้วแต่ยื่นขอโอที* | no punches at all that day | grey, `.chip.scan-none` |

The three are named **from the request's point of view** — how the paper
compares with the day — which is why เกินเวลา and ไม่ครบ are opposites rather
than degrees of one thing. `SCAN_BADGE` in `lib/scanMatch.js` holds the words.

> `ไม่มีข้อมูลสแกนนิ้ว` and `สแกนออกก่อนเวลา OT` were the wordings until
> 2026-09-07; they are **ไม่ตรง** and **ไม่ครบ** now. A fourth badge is NOT one
> of the three and keeps a longer name for that reason —
> `เวลาเริ่มไม่ตรงกับสแกน` (`SCAN_BADGE.START_OFF`), a start the machine
> actively disagrees with on a row whose end is fine. Calling it ไม่ตรง would
> collide head-on with the word that now means *no scan at all*.

##### เกินเวลา is a fact, and `state` does not move for it

**A row that overran is still `SCAN_MATCH.OK`.** Asked and answered on
2026-09-07 — *ข้อเท็จจริง ป้ายเทา ไม่นับกองที่ต้องตรวจ* — and the split is the
one this feature keeps arriving at: the **verdict** answers *does somebody have
to look at this row* and the answer is no, while the **mark** says what the
machine witnessed. `metEnd` stays `>=` and the earlier decision of the same day
stands; `overTime` is a flag beside it, built exactly as `missingOtStart` is.

**The threshold is one OT block — `SCAN_OVER_MINUTES`, 30 นาที**, asked for as
*เกิน 30 นาที (เท่าบล็อก OT)*. Two reasons and both matter. The engine floors OT
to whole 30-minute blocks, so an overrun shorter than a block contains no OT the
person could have claimed even had they filed it. And nobody's last door event
lands on the exact minute their request ends — at zero grace a 20:03 scan on a
20:00 request is เกินเวลา and so is most of the month, which is the
mark-on-every-row failure this module has already paid for twice. **The short
side keeps no grace at all** (*ถ้าเวลาไม่ตรงกันขึ้นทุกกรณี*): a shortfall is a
claim to money, an overrun is a gift, and a gift three minutes wide is not news.

**The line under the chip says the minutes were not paid** — *ชั่วโมงคิดตามใบที่
ยื่น ไม่ได้บวกเพิ่มให้*. Without it, "the machine saw more than the paper" reads
as an amount owed. Nothing here has ever moved a figure and this does not either.

**Never on a เหมารายวัน row.** A day bought whole never claimed a length, so
there is nothing for a scan to exceed; `overTime` carries `!flatDaily` so the
new sentence cannot appear under the green chip.

**And one MARK that is not a verdict**, drawn beside any of them:
`ไม่ได้สแกนเข้า OT` (`missingOtStart`, quiet, `.chip.scan-noin`) — the start of
this OT had no door event to witness it. It sits on rows whose verdict is `ok`,
which at this company is most of them. See §…but not a finding is not the same
as not worth saying.

**On a `flatDaily` row none of the three verdicts draws**, and neither does the
mark — the green เหมารายวัน chip does instead, whatever the verdict. See below.

The last two must never be printed as one sentence. A row whose day has punches
but none near the request may be a wrong request; a row with no punches at all
is a **gap in the evidence** — the file may not have been imported, or the
person may have been at another site. They ask different things of the reader.

#### เหมารายวัน is a FACT, not a warning — the row is green

**ถ้าติ๊กเหมารายวัน เวลาสแกนไม่ตรงไม่เป็นไร แต่ต้องมีแจ้งเตือนว่าเขาเหมารายวัน**
(HR, 2026-09-04). A flat day is bought whole — eight hours however long the
person stayed — so **the times on that request are not a claim the machine can
contradict.** What the row needs to say is not "look at this", it is "this one
was filed flat". (Which column those eight hours land in is the day's answer —
see the rule above — and it changes nothing here: no flat day states a length a
scan can be short against.)

So a `flatDaily` row draws `FlatDailyMark`: the green chip **เหมารายวัน**, the
same green `OT สวัสดิการวันเกิด` wears, because the two are the same kind of
fact — how a request was filed, and why its hours were counted the way they
were. `ScanMismatchMark` stands down entirely on those rows; there is never an
amber mark on a flat day. This paragraph went on **“The NUMBERS survive
underneath in the quiet voice … and every one of them ends — ยังได้ 8 ชั่วโมง
ตามเดิม”** until later the same day: the shortfall was withdrawn from flat rows
altogether on 2026-09-07 — see the fix below the table.

**Under the chip, on every flat row, the rule itself**: `FLAT_DAILY_SAY` —
**พนักงานเหมารายวัน — นับ 8 ชั่วโมงเป็น OT ×1.5 ไม่ว่าจะอยู่นานแค่ไหน**. That line
is unconditional, and it has to be: the rate column beside it reads `8.00`
against times that may say five hours or twelve, which on any other row would
mean the entry failed to compute. Drawn only where a scan disagreed — which is
what it did while it only had to say the disagreement was fine — the figure would
be unexplained on every other flat row. One exported constant, used by the badge
and by the form’s preview, so the screen that files a flat day and the screen
that reviews one cannot word the rule twice.

**It does not name the column, and that is deliberate.** The one string is drawn
on วันหยุด rows and วันปกติ rows alike, so a sentence saying "วันหยุด" would be
wrong on half of them — and the column is on the row already. What is not on the
row is why a twelve-hour shift reads 8.00.

> It read **พนักงานเหมารายวัน — นับ 8 ชั่วโมงปกติ ไม่คิดชั่วโมง OT** while there
> were three noughts to explain (2026-09-04 → 2026-09-07), and for part of
> 2026-09-07 there were TWO constants — `FLAT_DAILY_BIRTHDAY_SAY` beside it and
> `flatDailySay()` choosing between them off the engine's `dayReason` — while the
> OT reading was a rule about วันเกิด days only. Both went out with that
> distinction the same day.

**It is drawn from `entry.flatDaily`, never from `scanCheck`** — so it is on the
row in a month whose scanner file nobody has imported, and it was true before
this system could read a punch at all. A mark that appeared only once somebody
uploaded a `.txt` would mean two different things on two different months.

##### The four shapes a flat day takes, and why they all read as ONE LINE

HR named three: **ไม่ได้สแกนนิ้ว · สแกนออกก่อนเวลา · สแกนเข้าแต่ไม่ได้สแกนออก**,
and an overrun is the fourth. All four land on the same answer — the sheet gets
its eight hours and nobody does anything — and since **2026-09-07** they all
print the same single line, with nothing after it:

| what happened | the row says under the green chip |
|---|---|
| no punch at all that day | `พนักงานเหมารายวัน — นับ 8 ชั่วโมงเป็น OT ×1.5 ไม่ว่าจะอยู่นานแค่ไหน` |
| left before the claimed end | *(the same line)* |
| punched once, nothing at the end | *(the same line)* |
| stayed past the claimed end | *(the same line)* |
| the times agree with the file | *(the same line)* |

One line for every kind of flat day as well as every kind of scan: a วันหยุด row
and a วันปกติ row say the same thing here, because what differs between them is
the column, and the column is on the row.

> **This is a fix, and the thing it fixes is a sentence that argued with
> itself.** Until then the line carried the scan finding as well — `… ไม่คิด
> ชั่วโมง OT · เวลาสิ้นสุด สแกน 15:40 · ขาดอีก 80 นาที — ยังได้ 8 ชั่วโมง
> ตามเดิม` — on the reasoning that the numbers were worth knowing even where
> nothing was wrong. Reported as a bug on 2026-09-07 and it is one: the first
> half says the times on this request are not something the machine can be short
> against, and the second half measures a shortfall against them anyway.
> **ไม่มีการตัดเวลา** — the eight hours are not reduced by anything a scanner
> recorded, so there is no shortfall to state. The same edit took it off the
> chip's `title`, which had carried the long `ใบนี้เป็นใบเหมารายวัน … (ไม่ต้อง
> แก้)` version of the same contradiction.
>
> `scanMismatchDetail` returns null on a flat row now — first, above `no_scan`
> and above เกินเวลา — so no screen can print it: the chip, its tooltip, the
> line beneath it and the badge all read one answer.

**The row is not left without evidence.** `ScanDayPunches` still prints the
day's own scan times under it, as it does on every row that has any. What is
gone is the arithmetic against a claim a flat day never made — a reader who
wants to check the filing has the raw times and can do it themselves.

###### A row reading `08:00–17:00` on an ordinary Wednesday is a flat day, and that is the whole of it

Reported alongside the sentence above — *ช่วง 08:00–17:00 ในวันทำงานปกติ … ไม่
ควรถูกนำมาคำนวณเป็นรายการ OT* — and the row it names (22/07/2569, PM00112) is
`flatDaily: true`, `totals.otHours` **0**, `totals.normalHours` **8**. It is not
being counted as OT: every rate column on it is nought, which is the rule since
2026-09-04. The 17:00 is the form's own arithmetic — a เหมารายวัน filed at 08:00
gets a nine-hour span (8 + lunch) and the end box is not typed.

**No OTHER row can be in that state.** `zeroOtHoursAllowed` in lib/entries.js
returns `flatDaily` and nothing else, so every write path — submit, the employee
edit, the HR correction, the legacy router and the replay — refuses a request
that computes to no OT hours, with `noOtHoursMessage` naming the reason.
Counted on the database on 2026-09-07: **0** non-flat rows with `otHours ≤ 0`.
That is why the flat-day gate above is the complete answer to "hide the OT
shortfall warning on a row that claims no OT" — there is no second kind of row
to hide it on.

**ก่อนเวลา / หลังเวลา, never เข้า / ออก** on the rows that *do* still get a
sentence. The scanners write no in/out flag, so "สแกนออกก่อนเวลา 80 นาที" would
be this module inventing the one field the file does not have. Which SIDE of the
claimed time a punch fell on says the same useful thing and claims nothing about
which way the person was walking.

**The eight hours were checked against the engine, not assumed** —
`flatDaily` on `08:00–17:00` and on `08:00–20:00` both compute to
`totals.normalHours` **8** with every rate column at nought, on a holiday and on
a weekday alike. Since 2026-09-04 the day of the week no longer changes the
answer at all, which is the point of the rule and was not true of the ceiling
that preceded it: **a paragraph here used to have to caveat that a weekday flat
day computed to 0 while a holiday one computed to 8.** Both are the same eight
normal hours now, and neither is OT.

##### Telling the two piles apart for the whole month

*"แจ้งเตือนเพื่อให้ HR แยกออกระหว่างงานเหมากับเวลาไม่ตรงงานปกติ"* — the chips do
that row by row, in colour. `summariseScanChecks` does it for the month, in a
number, above the table: **`1` แถวไม่ครบ · `1` แถวเวลาเริ่มไม่ตรง · `0`
แถวไม่ตรง (ไม่มีสแกนนิ้ว) · `2` แถวเกินเวลา · `3` แถวเป็นใบเหมารายวัน** — HR's own
words in the order they defined them, and **only the first two are errands**. A
flat day is never counted into the warning piles, whatever its scan verdict;
เกินเวลา is counted ALONGSIDE the verdict rather than instead of it, since an
overrun row is `ok` and can never double-count with the piles above it. Those
exclusions ARE the separation, written as arithmetic instead of as a colour, and
it is where the rule can have a test on it rather than being an `if` inside a
component.

**`mismatch` is still the whole errand pile and `short` + `startOff` partition
it**, split on `endShortMinutes` — the same field `scanBadgeLabel` chooses
between the two amber badges on, so a count and a chip cannot disagree about
which shape a row is. That split was **found by walking the built app, not by a
test**: the arithmetic was right, and a card reading `2 แถวไม่ครบ` over one
ไม่ครบ row and one เวลาเริ่มไม่ตรงกับสแกน row was naming a pile after half of
what was in it.

> It read "**`1` แถวเวลาไม่ตรง · `0` แถวไม่มีข้อมูลสแกน · `3` แถวเป็นใบ
> เหมารายวัน**" until 2026-09-07, with no เกินเวลา column and with the word
> ไม่ตรง used as the umbrella for every mismatch. Both screens that draw this
> line — ตรวจสอบรายเดือน and the import card on ตรวจสอบประจำเดือน — carry the
> same four words, because two screens naming one comparison differently is how
> a reader comes to believe they are two comparisons.

The flat-day count still prints on a month with no scan file at all, because it
is a fact about how the requests were filed.

> This section read "**เหมารายวัน warns too, and says so** … the chip reads
> `เหมารายวัน · เวลาไม่ตรงกับสแกนนิ้ว`" for part of the same day. That was the
> first reading of the same ask and it was **amber**; the follow-up reversed it.
> The reversal is not cosmetic: an amber mark on a row where there is nothing to
> find is exactly what teaches a reader to stop opening the amber marks that are
> not nothing.

**Matching needs no window, and since 2026-09-07 the END does not either.**
Whether the START matches is simply "is there a punch within the tolerance", and
no window can affect that answer; the END stopped asking that question the same
day and asks `>=` instead, which no window can affect either. It read "What
needs a bound is which punch gets
NAMED when a side does not match … past **eight tolerances** (two hours at the
default, measured per side) it says ไม่มีสแกนใกล้เคียง instead, which is true"
until then — and on the end that bound was making the screen contradict itself.
A row printing `สแกน 07:30 , 22:15` underneath said `เวลาสิ้นสุด ไม่มีสแกน
ใกล้เคียง` above it, because 22:15 was 135 minutes from a 20:00 claim and the
bound was 120.

Asked for in the shape of the fix — *ถ้ามีเวลาที่สแกนเข้าออกงานหลายเวลา ให้
เปรียบเทียบเวลาที่ยื่นขอโอทีและเอาเวลาสแกนนิ้วที่ใกล้ที่สุดกับเวลาที่ยื่นขอโอที
มา* — so **the end takes the nearest punch of the day however far it is**, and a
gap over two hours is written in ชม./นาที (`gapText`) because "604 นาที" printed
in the same words as a 40-minute discrepancy is what made a far punch read as a
number the machine could not make sense of. Under two hours the wording is
unchanged, so no sentence HR already reads was reworded.

**No verdict moved with the WINDOW.** A punch inside the tolerance was inside
the old window too, so lifting the bound changed evidence, not arithmetic. What
did move verdicts, later the same day, is the rule the end is read by — `>=`
instead of a distance — and that is stated as its own change above rather than
folded into this one.

**The START keeps the two-hour window**, and keeps it for the reason the bound
existed: there the far punch is the 07:26 morning arrival, on nearly every row
of the month, and quoting it as the scan nearest a 17:30 start is the noise this
feature nearly died of. Past that window the start has no witness at all, which
is what `ไม่ได้สแกนเข้า OT` below is the answer to. The end is safe unbounded
because it is the one event of an OT day the machine is in a position to record,
so a far punch there is a finding rather than a coincidence — `07:42` alone
against a 19:30 end is HR's own third shape, สแกนเข้าแต่ไม่ได้สแกนออก.

> That bound was `tolerance * 4` measured from the request's own ends, and it
> was **wrong in the way that matters** — found by walking a built app on
> 2026-09-04, not by a test. A เหมารายวัน row finishing at 20:00 whose real
> nearest scan was 21:10 reported *"เวลาสิ้นสุดต่างจากเวลาสแกน 17:29 อยู่ 151
> นาที"*: 21:10 fell one minute outside the bound, so the only punch left inside
> it was the one at the START of the OT. **The warning was right and its
> evidence was the wrong evidence**, which is worse than no evidence — a reader
> checks 17:29, finds it is the start-of-OT scan, and concludes the feature is
> confused. `test/scanMatch.test.js` holds that case now.

**Overnight rows are read on one number line.** A request ending 02:00 next day
is minute 1560 from its `workDate`'s midnight and a punch at 02:04 the following
morning is 1564 — four apart, which is what they are. Compared as clock faces
they would be 1436 apart and every ข้ามคืน row in the system would be flagged.

#### The row prints the day's scans — the evidence, not only a verdict

*"เอาเวลาที่สแกนเข้าออกตลอดทั้งวันมาโชว์ ในแต่ละวัน"* (HR, 2026-09-04), asked
after the first REAL month was walked. Every row with any punches now carries

```
17:00–19:30
สแกน 07:21, 19:30
```

> The separator lost its leading space on 2026-09-07 — asked for in the shape
> *แสดงเวลาสแกนนิ้วทั้งหมดของวันนั้นเสมอ เช่น "สแกน 07:34, 19:30"*. It reads as
> an ordinary Thai list now rather than as a machine listing; nothing else about
> the line changed.

**Why a verdict alone was not enough, measured on the real July file.** The two
people in it scan **twice a day** — arriving around 07:2x and leaving at 19:30 —
and **nobody scans at 17:00 when the OT begins**, because 17:00 is the end of
the normal shift, not an event at the door. So:

| over 27 comparable rows | ตรง | ไม่ตรง |
|---|---|---|
| start AND end compared | 2 | **25** |
| end only | 24 | 3 |

with the failing side being **start 25 · end 3**. Twenty-five rows were flagged
on an instant the machine was never in a position to record. That is the "a
warning on every row" failure this module's own header names, arriving not from
a bug but from how the door is actually used.

**A system that cannot know which punch was meant to be which can still print
what the machine said.** It costs nothing, assumes nothing, and hands the
comparison to the person holding the sheet — who can see at a glance that
`ใบ 17:00–19:30` against `สแกน 07:21, 19:30` is an ordinary day.

**Drawn on every row that has scans, matching or not.** Times that appeared only
where something was wrong would be read AS a warning, which is the thing they
were added to replace.

**A list of times, never `เข้า` / `ออก`.** The machines carry no in/out flag; a
reader can see what a morning-and-evening pair means and the system is not in a
position to assert it. A punch on the following morning is marked `(+1)` — on an
overnight row it belongs to the row but not to the date, and a bare `02:04`
among evening times reads as the wrong morning.

> This block read "**The amber chip was left exactly as it was**, so on a month
> like July it still marks those 25 rows … narrowing the chip to the END side is
> a one-line change and was NOT made here: which side is worth warning about is
> HR's call" until later on 2026-09-04. **The call was made** — the section
> below is it.

#### Nobody scans at 17:00 — so the start is not held against the row

Told to us in full on 2026-09-04:

> พนักงานส่วนใหญ่สแกนเข้างานก่อน 08:00 น. และไม่ค่อยสแกนเลิกงานตอน 17:00 น. ใน
> กรณีที่มีโอที … จะสแกนแค่สองรอบ คือเข้างานเช้าก่อน 08:00 น. และสแกนออกอีกทีตอน
> เลิกโอที แต่ก็อาจจะมีบางส่วนที่สแกนทั้งก่อนเข้างาน 08:00 น. และตอน 17:00 น.
> เมื่อเลิกงาน แล้วมาสแกนอีกทีตอนที่เข้ามาทำโอที และสแกนตอนออกโอที

**The machine records a door, and at 17:00 the person is already inside** — the
shift they arrived for merely ended. On the two-punch day there is no event at
the door to find and there never was going to be one, so `เวลาเริ่ม ไม่มีสแกน
ใกล้เคียง` was the system marking almost every row of the month for a reader to
check something the reader could already see was fine.

So: **a start with no punch near it is not a finding on a day that has a punch
earlier than it.** That earlier punch IS the explanation — the person was inside
— and the verdict then rests on the END, which is the one event of an OT day the
machine is in a position to record.

##### And the test is DIRECTION, not presence

The rule above read `!start && onDay.some(...)` — *no punch near the start at
all*, plus one earlier in the day — until 2026-09-04. On the two-punch day that
is right. On the FOUR-punch day it silenced nothing, because there a punch near
the start always exists.

Two more answers from ฝ่ายบุคคล the same day settle what those extra punches
are. **พักเที่ยงไม่ต้องสแกนนิ้ว**, so a day is two punches or four and the
middle two are never lunch — they are 17:00 ตอนเลิกงาน and ตอนเข้ามาทำโอที, one
trip out and back at the shift boundary. And **ไม่มีกะดึก**, so nobody's shift
begins in the small hours and an earlier punch cannot be the start of something
else.

That is what makes the direction readable with no in/out flag. A request filed
`18:00–20:00` on the four-punch day quoted `เวลาเริ่ม สแกน 17:35 ก่อนเวลา 25
นาที` — and 17:35 is the person walking back **in**. They were inside from 17:35
onward exactly as the two-punch person is inside from 07:42 onward. Presence
cannot tell those apart; which side of the claimed start the punch fell on can.

`startFinding` on the check carries the verdict and the sentence both, and
`missingOtStart` is what is LEFT when there is no finding — never both on one
row.

| the day's punches, against a request `17:00–19:30` | before | now |
|---|---|---|
| `07:34, 19:30` — two punches, the common shape (**Case A**) | ⚠️ `เวลาเริ่ม ไม่มีสแกนใกล้เคียง` | ⬜ `ไม่ได้สแกนเข้า OT` only — the scan-out reached 19:30 |
| `07:42, 17:02, 17:28, 19:31` — four punches (**Case B**) | ✅ no chip | ✅ no chip |
| `07:42, 17:22, 17:40, 19:33` — left the shift 22 นาที late | ⚠️ | ⚠️ `เวลาเริ่มไม่ตรงกับสแกน` · `เวลาเริ่ม สแกน 17:22 หลังเวลา 22 นาที` |
| `19:33` alone — nothing before the OT began | ⚠️ | ⚠️ `เวลาเริ่ม ไม่มีสแกนใกล้เคียง` |
| `07:42` alone — forgot to scan out | ⚠️ both sides | ⬜ + ⚠️ `ไม่ครบ · ขาด 11 ชม. 48 นาที` · `เวลาสิ้นสุด สแกน 07:42 · ขาดอีก 11 ชม. 48 นาที — อาจลืมสแกนออก` |
| `07:42, 12:10` — went home at lunch | ⚠️ both sides | ⬜ + ⚠️ `ไม่ครบ · ขาด 7 ชม. 20 นาที` |
| `07:42, 19:20` — left 10 นาที early | ✅ no chip (inside the 15-นาที tolerance) | ⬜ + ⚠️ `ไม่ครบ · ขาด 10 นาที` — no grace on this side since 2026-09-07 |
| `07:30, 22:15` against **`17:00–20:00`** — stayed past the claim | ⚠️ `เวลาสิ้นสุด ไม่มีสแกนใกล้เคียง` | ⬜ + ⬜ `เกินเวลา · เกิน 2 ชม. 15 นาที` — **no longer a warning** |
| `07:21, 17:02, 17:35, 20:05` against **`18:00–20:00`** | ⚠️ `เวลาเริ่ม สแกน 17:35 ก่อนเวลา 25 นาที` | ⬜ `ไม่ได้สแกนเข้า OT` only (20:05 is 5 นาที over — under the 30-นาที block) |
| any of these, filed **เหมารายวัน** | 🟩 green only | 🟩 green only |

**What still warns was asked for in that shape.** A punch AFTER the claimed
start that disagrees is quoted — the door moved once the OT was supposed to be
running — and a start with nothing at all before it is a genuine gap, because at
this company the morning scan is the reliable one. A punch BEFORE the claimed
start is neither, **however far before**: the tolerance no longer decides that
side at all.

##### …but not a finding is not the same as not worth saying: `ไม่ได้สแกนเข้า OT`

Asked for later the same day, once the silence existed: *"แสดง Badge/Flag
Warning … `ไม่ได้สแกนเข้า OT` เพื่อเตือนว่าไม่มีสแกนเข้าช่วง 17:00 น."* Both
halves are right, and they answer different questions:

| | question it answers | on Case A |
|---|---|---|
| the VERDICT (`ไม่ครบ` / `เวลาเริ่มไม่ตรงกับสแกน`, amber) | does somebody have to go and look at this row? | **no** — silent |
| the MARK (`ไม่ได้สแกนเข้า OT`, grey) | what did the machine witness, and what did it not? | **the start had no witness** — said |

**So it is grey, and the grey is the argument.** It lands on 25 rows of 27 —
the same count that made the amber unreadable. A grey chip on twenty-five rows
is a column of labels; an amber one is twenty-five errands that turn out to be
none, which is what teaches a reader to stop opening the amber chips that are
not. `.chip.scan-noin` is its own class rather than `.chip.scan-none`'s, though
the declarations match today: "no scan at all" and "no scan at the start" are
different statements about a day.

**The `title` carries the second half.** `ไม่ได้สแกนเข้า OT` alone reads as a
problem, so the tooltip says why it is the ordinary shape of a day here and
which scan the comparison is actually resting on. Both strings are
`MISSING_OT_START` in `lib/scanMatch.js`, beside the flag, so the chip and the
sentence cannot drift.

**It draws on neither a flat day nor a `no_scan` row.** On a flat day nobody is
asking whether the door events are complete and the green chip is the row's
answer already — marking it grey would be the amber mistake repeated in another
colour. On a day with no punches at all, `ไม่มีข้อมูลสแกน` says the whole of it,
and two grey chips would be one statement cut in half. `showsMissingOtStart`
holds both gates so no component decides them again.

**It is read off the request's own start, not off a fixed 17:00–17:30 window.**
The helper this was asked for in names those clock times because that is what
the shift is, and for a request beginning at 17:00 the two agree exactly. They
part on two requests the window cannot see: one filed `18:00–20:00`, where
17:00–17:30 is not where its start is at all, and one whose OT-in scan is at
17:40 — where the window reports "no scan" while a scan sits right there
disagreeing by 40 นาที. The tolerance answers both, and it is the number
ฝ่ายบุคคล can still move.

**And the END keeps the punch it used.** A request `17:00–18:30` whose last scan
is `18:25` has an end 5 นาที out — and `18:25` also sits inside the START's
quote window (85 of the 120 minutes), so without this the start side would quote
the LEAVING scan as evidence about the arrival and warn on a row where nothing
is wrong. The same family as the 21:10 bug below: the wrong evidence is worse
than none. The exception is a punch inside the tolerance of both ends, which on
a short enough request is one trip through the door genuinely answering both.

#### Where you actually SEE the comparison — the card names the people

*"แล้วจะดูการเปรียบเทียบตรงไหน"* (HR, 2026-09-04), and the question was the
report of a real defect: **the marks were on the rows, and the rows are one
click deep** — inside ดู / แก้ไขรายการ for ONE person. HR import a file on
ตรวจสอบประจำเดือน and nothing on that screen moved. The only route to a warning
was to already know it was there and open people one at a time; on a roster of a
hundred and sixty that is not a thing anybody does, so the feature was built and
unreadable.

So the card carries the month's answer, and it **names the people**:

```
ผลเทียบกับใบ OT ของเดือนนี้  (7 ใบ · ตาม “สถานะที่นับ” ที่เลือกไว้ด้านบน)
1 แถวไม่ครบ · 1 แถวเวลาเริ่มไม่ตรง · 1 แถวไม่ตรง (ไม่มีสแกนนิ้ว) · 1 แถวเกินเวลา · 1 แถวเป็นใบเหมารายวัน
ดูได้ที่ปุ่ม ดู / แก้ไขรายการ ของคนเหล่านี้ในตารางด้านล่าง
สมชาย ใจดี (PM00112) — เวลาไม่ตรง 2 · สมหญิง รักงาน (PM-0620) — เวลาไม่ตรง 1 · ไม่มีสแกน 1
```

**เกินเวลา is on the count line and NOT in the list of names.** The names answer
*who do I have to go and look at*, and nobody has to look at a row where the
person worked longer than they claimed — the same reasoning that keeps the owner
of a flat day off that list. `groupScanChecksByPerson` is untouched by the new
mark for exactly that reason.

**The card says WHO, the table below is HOW.** The block deliberately links
nowhere: the control that opens a person is already on their row, and a second
way in would be two controls for one act. What it does is turn "this month has
three mismatches" into somewhere to go.

**Only people with something to look at are listed.** Somebody whose month
agrees is absent, and so is somebody whose only flagged rows are flat days —
putting a flat day's owner on a list of people to check is the same mistake the
amber chip was. `groupScanChecksByPerson` is where that exclusion lives, with a
test on it.

**`compare=1` is opt-in and asked for only when the month has scans.** The slot
list is two cheap queries; this one loads the month's entries and every punch
behind them, so an empty month pays for neither. The same call `usage=cap` makes
on the entries route.

**It reads the screen's own สถานะที่นับ**, forwarded as `status` rather than
assumed — two figures on one screen counted over different populations is a
difference nobody can account for and everybody notices.

#### Not importing all four is fine

Also said on 2026-09-04: **ไม่จำเป็นต้องเอาไฟล์เข้าครบทุกไฟล์ก็ได้.** A machine
may not have been emptied; a company may have had nobody on it that month. So
the grid is a MAP and not a target — an empty row reads `ยังไม่ได้นำเข้า
(ไม่บังคับ)`, nothing counts it as outstanding, and the comparison above runs on
whatever arrived. `missing` is still computed, because "which of the four is
this" is what the grid is for; what changed is that it is not a debt.

#### The tolerance is 15 นาที, and HR were asked on 2026-09-04

This heading read "**[OPEN]** The tolerance is 15 นาที and nobody at HR has been
asked" until then. Asked whether fifteen was too tight or too loose, ฝ่ายบุคคล
answered **ไม่** — neither. The number does not move; what changed is that it
now stands on an answer rather than on our own reasoning.

`SCAN_MATCH_TOLERANCE_MINUTES` in `lib/scanMatch.js`. That reasoning is kept
because it is still why fifteen was a safe thing to have been wrong about: a
person walks to the door and back, and the OT arithmetic already refuses
anything under a 30-minute block, so half a block cannot make a difference the
hours would notice. The number stays printed on the screen above the table
rather than left in the source, and the checker still takes it as an argument —
an answer given once is not an answer that can never change.

**It decides one side of one comparison, and fewer sides than it used to.**
Since the direction rule above it does not judge a punch that falls *before* a
request's start; it decides the end, and the start only for a punch after it.

It is deliberately **not** in `Setting.policy`: a key in there mints a policy
version and gets stamped onto entries, and this decides nothing about pay — it
decides how loud a screen is. The same call `รูปแบบวันที่ใน CSV` made.

#### The cell says four things, in three voices

The จาก–ถึง cell on ดู / แก้ไขรายการ prints, top to bottom: **the times somebody
typed**, **the badge**, **the badge's own explanation**, and **the day's punches
as the machine recorded them**. Until 2026-09-07 the last two were the same
12px in the same grey two pixels apart, so all four read as one paragraph of
grey under a pill. The explanation now takes 11.5px and `--muted-2` — a step
quieter than the punches line, which keeps `.cell-sub`'s 12px and `--muted` —
and the three gaps are 8 / 4 / 6px. **The order of loudness is the point**: what
the machine recorded outranks what this system says about it. **A row can carry
two badges** — `ไม่ได้สแกนเข้า OT` beside `ไม่ครบ · ขาด 47 นาที` — and at 191px
of content they do not fit on one line. They wrapped flush against each other, a
measured 0px, an amber border sitting on a grey one; and the second was indented
6px, because the gap that separates them side by side lived on its left. The gap
is on the first chip's right now and stacked pills clear each other by 4px —
reported on 2026-09-07 as "แท็กมันซ้อน ๆ กัน", which it was. The explanation
stops at `--muted-2` and does not go to `--muted-3`, because it carries the
minutes somebody may act on and `--muted-3` at 11.5px measures 2.79:1 on the
card in ธีมสว่าง. Pinned by `entryRowChrome`; measured at 1440px on the built
app against a clone of the real database, where it costs the tallest row 8px
(170 → 178) and the median 6 (116 → 122).

#### Where it is shown, and where it is not

**The ROW MARKS are ดู / แก้ไขรายการ only** — the summary that names the people
is on ตรวจสอบประจำเดือน itself, above the table (see the section above; that
split is what made the feature findable at all). Not on บันทึกและประวัติ OT: a
warning about a file ฝ่ายบุคคล import, on a request the employee filed
themselves, is a question they cannot answer. Not on the approval queues either
— a หัวหน้า signs a request before the month's scan file exists.

**The green เหมารายวัน chip is not one of those marks and does go on the queue**,
since 2026-09-07. Everything in this section is about a comparison with a FILE;
that chip is about the tick on the request, is true on a month nobody has
imported anything for, and is what tells the person signing why eight hours are
eight hours. See §เหมารายวัน is a FACT, not a warning.

**A month with no chips means one of two opposite things**, and a table is
silent in exactly the same way for both — every row agreed, or nobody imported
the file. So `scanChecked` rides beside the rows and the line above the table
says which. It is NOT a third bullet in `.entry-foot`: that footnote is pinned
at two lines by `test/entryRowChrome.test.js`, and the pin is not arbitrary — it
went from a wall of prose to two lines because a wall is what nobody reads.

### ⚠ What it deliberately does NOT do — and the question nobody has answered

**No FIGURE reads `otScanPunches`.** No report, no CSV, no F-HR-027 column and
no rule; the import does not call `recomputeEntries` and nothing anywhere moves.
The one reader is the warning above, which changes nothing and asks a question.
Turning a punch into an hour is a **policy** question with at least three parts
nobody has answered:

> This paragraph opened "**No screen, report, CSV, F-HR-027 or rule reads
> `otScanPunches`**" until the mismatch warning was built later the same day.
> A screen reads them now. What has not moved is the half that matters — no
> figure does — and the warning is deliberately built so that it needs none of
> the three answers below.

- which of a day's punches starts the OT and which ends it, on a machine with no
  in/out flag;
- what an odd number of punches on one day means;
- **whether a machine may contradict a sheet two people signed** — which is the
  one that matters, because a payroll figure with two sources and no rule saying
  which wins is worse than a payroll figure with one.

Storing the evidence first and deciding second is the order on purpose. The card
says so to the person pressing the button, `src/models/ScanPunch.js` says so to
whoever reads the model next, and this paragraph is the third place — because
the failure available here is somebody building the second half without noticing
that the first half made no promise.

**Unknown รหัส are reported, never refused.** A terminal holds fingers of people
who have left, of a test finger somebody registered once, and of whoever was
hired since the last roster edit. The import stores those rows as the machine
recorded them, resolves `employee` for the ones it can and leaves the rest null,
and puts the count on the batch and on the screen.

**There is no undo.** A wrong file imported is a batch row and its punches with
no button to remove them — the mistake it protects against (the same file twice)
is answered by the unique index instead. If HR ask for one, it is a route and a
confirmation, not a redesign.

---

## หัวหน้าบันทึก OT แทนลูกทีม

An employee who cannot get to the system — off site, no account on them, a
phone that will not load the form — still worked the hours. Their หัวหน้า can
file the request for them, and the request that comes out is **the employee's**:
`entry.employee` is the person who worked it, `entry.department` is theirs, the
ceiling it is measured against is theirs and the day types are resolved from
their birthday. The หัวหน้า appears in exactly one new field, **`filedBy`**.

Those two must never be conflated. Filed against the หัวหน้า instead, the hours
would land on the wrong person's month, the wrong department's cap and the
wrong F-HR-027 — and every figure on every report would still agree with every
other one.

### กล่องเลือกลูกทีม — and the ค้นหา box that used to sit over it

**The search box came out on 2026-09-01**, asked for as making the picker
compact. What settles it is the size of the thing being searched: `team` is the
non-manager staff of **one** แผนก, and this roster's largest is ENG at four
people (WH is two). A box over four names is furniture on a form that already
has plenty.

**What the picker is now**, top to bottom:

- **`บันทึกแทนพนักงาน * (เลือกแล้ว X คน)`** — and the parenthetical is drawn at
  nought too, which it was not before. This label is the only place on the
  screen that says how many people a press of บันทึก is about to file for, and a
  counter absent at 0 is one a reader has to notice ARRIVING to know it exists.
  It also stops the line reflowing as the first tick lands, which on a phone
  moved the `*` somebody was looking at.
- **`.pick-list`** — a scroll box, `max-height: 210px`, with the app's own
  scrollbar **recoloured to belong to it**. The single `::-webkit-scrollbar-thumb`
  rule at the top of the stylesheet is written for a bar running down the PAGE:
  a 10px track with the thumb inset by `border: 3px solid var(--bg)`. That
  border is a colour, not a transparency, so inside a `--card` container it drew
  three pixels of the page's ground down the inside edge. Only the colour is
  restated here — the width, the radius and the 3px inset stay the app's, and
  `scrollbar-width`/`scrollbar-color` says the same thing to Firefox.
- **A ticked row carries the highlight**, `--green-bg` under `--green-accent`
  mixed to 45% — the pair `.announce` already uses, not a new colour. An INSET
  ring rather than a border, so nothing reflows when a row is ticked and the
  edge closes on all four sides; the hairlines on both sides of it drop out, or
  a grey line runs immediately under the green one. It is `:has(input:checked)`
  and not a class computed from `targets`: the state is already in the DOM, and
  a second copy of it is what a future edit leaves behind.
- **เลือกทั้งหมด is still a union, not a replace** — with nothing narrowing the
  list the two compute the same array today, and the union is kept because it is
  idempotent (a duplicate id is a second request filed for the same person) and
  because the day this list is narrowed again by anything, a replace is a bug.

### And the prose around it, later the same day

Asked for as *ลดความรกของ UI*. Three pieces came off the screen; two were
deleted and one moved, and the difference between those verbs is the whole of
this section.

**Deleted: the sub-header** — *เวลาทำงานปกติ จันทร์–ศุกร์ 08:00–17:00 น. ·
นอกเหนือจากนี้นับเป็น OT*. On THIS screen the reader is a หัวหน้า filing for
their own team, which is the one audience that does not need telling. It is
**behind `!proxy`, not removed**: the employee's own บันทึก OT is where somebody
learns what counts as OT here, and the birthday wording beside it is a
correction of a sentence that was false on that row.

**Deleted: the note under the picker.** *เลือกได้เฉพาะพนักงานในแผนกของคุณ*
described the box directly above it — the list IS the department and nothing
else can be ticked.

**Moved: the blue panel**, into the ⓘ beside the heading — the same 17px circle
that carries a `?` on every field, wearing the `i` the app bar's note already
uses. Nothing was shortened. **The one-line replacement that was proposed is
what makes this a move rather than a cut**: it read *ระบบจะบันทึกว่าคุณเป็นผู้
บันทึกแทน และส่งเรื่องไปยัง HR โดยตรง*, and the second half is a promise this
app cannot make — whether the หัวหน้า step is skipped is a policy flag read off
the server, and a promise the settings could contradict is worse than no
promise. Behind an ⓘ there is room to say which of the two is true today.

**One thing is now a press away that was not.** *เลือกหลายคนได้เมื่อทำ OT
กะเดียวกัน วันเดียวกัน เวลาเดียวกัน* is not a description — it is the only
warning on the screen about a mistake the form permits. One date and one pair of
times are posted for everybody ticked, and **nothing here or on the server
refuses a batch whose people actually worked different hours**; the rows that
come out all look correct. It is in the ⓘ, which is a weaker place than a line
nobody can miss. Put it back on the screen if HR ever meets it.

**Measured on the built app**, ธีมมืด, as `PM-0100`: at 390×844 the card is
**751px** with the ⓘ shut and 858 open, and no `.hint`, `.alert` or
`.field-note` is drawn in it at all — the picker, ประจำเดือน and both times fit
on one screen, where the blue panel alone used to push the date field off. The
ⓘ is 17×17 on the heading's baseline, carries the sentence in `title` (322
characters with nobody ticked, 426 once the server has answered the routing
question) and reports `aria-expanded`.

**What the box was for, kept because the reasoning outlives it.** The one
promise it existed to keep was that narrowing must never lose a tick: `teamFind`
and `targets` were two separate pieces of state, so narrowing changed which
names were DRAWN and never wrote to the selection. Three ways that could break
were held by [`test/proxyTeamSearch.test.js`](test/proxyTeamSearch.test.js) —
filtering `targets` itself; **เลือกทั้งหมด replacing** the selection with what
was on screen; and **เลือกทั้งหมด reaching past the filter**. A line under the
list named the ticks a query was hiding, because *เลือกแล้ว 2 คน* over a list
showing none ticked is the screen arguing with itself. **All three are
unreachable with nothing to narrow** — the list IS the team — which is a
stronger guarantee than the three assertions were, and that file holds the bans
that say none of the machinery grew back.

The matcher it used, [`lib/personSearch.js`](lib/personSearch.js), is untouched
and still has three callers; this screen was the fourth. `ClearButton`,
`Highlight`, `Icon` and `searchPeople` left `components/OtForm.jsx` with the
box — a dead import compiles clean and would go on being bundled for nobody.

### The plate behind the tick box — a text-box rule on a checkbox

Reported 2026-08-31 as a square around the checkbox when you pick somebody, and
a background rectangle behind it. It reads like the focus-ring complaint of
2026-08-28 and is not one: nothing here was drawing an outline. **`.field
input` is the app's TEXT box, a checkbox is an `input`, and every tick list in
this app sits inside a `.field`.**

Measured on the built app before the fix, at 420px on ธีมมืด: the box came out
**17 × 46** — 17 wide from `.check input`'s own `width`, and 46 tall because
`min-height: var(--field-h)` beats a 17px `height` — filled with
`var(--field-bg)`, which is the plate somebody saw. A press added
`box-shadow: 0 0 0 3px var(--focus-ring)`, and that halo did **not** leave with
the pointer: the rule is `:focus`, not `:focus-visible`.

**And it had killed the keyboard's ring, which is the half nobody reports.**
`outline: none` is right for a text box whose ring is a box-shadow; on a
checkbox it meant `:focus-visible` matched, computed its 2px offset and drew
nothing. Tabbing through that list showed no focus at all.

**So the fix is not `outline: none`**, which is what was asked for and would
have deleted that ring on every control in the app to answer a complaint about
a shape — the rule above `:focus-visible` in the stylesheet already records
that argument from the last time. The three `.field input` rules that paint a
box — the base, its `:focus` and its `:disabled` — now exclude `[type=checkbox]`
and `[type=radio]`, keeping only `cursor: not-allowed` from the disabled one.
**Six places, not one:** tick lists sit in a `.field` on บันทึก OT แทนลูกทีม,
the queue, รายงาน OT ฝ่ายบัญชี and รายงาน OT แยกแผนก, so it belongs on the rule.
`accent-color: var(--green)` was already there and is what paints the tick.

**Measured again after the fix**, with a real pointer and real keys over CDP —
the DevTools protocol's own mouse and key events, dispatched at the browser's
input layer rather than by a scripted click, because whether `:focus-visible`
matches is decided by HOW the focus arrived:
the box is **17 × 17** with a transparent background and no border; a real
mouse click leaves **no outline and no shadow** once the pointer moves off; and
a real Tab gives `outline: 2px solid rgb(46, 119, 71)` — `--green`, back from
having drawn nothing at all.

**One trap only the walk found, and the `<span>` it bought is still there.**
`.check` is a flex row with a 9px gap, and `{p.name} · {p.code}` survives it
because adjacent text collapses into a single anonymous flex item. `Highlight`
returned real `<mark>` elements the moment a query matched — which become flex
items of their own and pull the name, the `·` and the code 9px apart, while
typing, on every row that matched. One `<span>` around the three puts them back
in one box. The mark went with the search box on 2026-09-01; the span did not,
because the next thing put in that row springs the same trap, and the assertion
in `test/proxyTeamSearch.test.js` is now the only thing that says so.

**Walked 2026-08-31** on the built app at :3001 against a seeded scratch
database, as `PM-0100` at 390×844 with `prefers-color-scheme: dark` forced: two
names ticked, then สมชาย, ใจดี, PM0388, pm-0388, *0388 ธนพล*, zzz typed in turn
— the label read **เลือกแล้ว 2 คน** through every one of them, and both were
still ticked after the ✕. The box measured background `rgb(19,26,23)`, text
`rgb(233,239,235)`, border `rgb(59,69,63)`, `padding-left: 40px`. **That box is
gone since 2026-09-01** and this paragraph is the record of what it did, not a
description of the screen.

### One line for the head — and the search box the tick-box fix broke

**The search box first, because it was mine.** The 2026-08-31 checkbox fix
spelled its exclusion `:not([type='checkbox']):not([type='radio'])`, which is
the obvious spelling and the wrong one: **a `:not()` takes the specificity of
its argument**, so `.field input` went from (0,1,1) to **(0,3,1)** and overtook
`.searchbox input.has-icon` at (0,2,1) — whose entire job is the 40px of left
inset that keeps a placeholder clear of the 🔍. Every search box inside a
`.field` fell back to `--field-pad-x`, 14px, under an icon spanning 13–30px.
Reported the next day as the placeholder overlapping the icon. `:where()`
contributes no specificity, so `:not(:where([type='checkbox'], [type='radio']))`
is the same exclusion with the rule left where it was. Measured after:
`padding-left: 40px`, text starting at 41px. **The lesson is the one this
stylesheet already wrote down** over `:focus-visible` — a base rule belongs at
the lowest specificity there is, and adding a `:not()` to one is raising it.

**Then the head.** `รอหัวหน้าอนุมัติ` → **`รออนุมัติ`**: a หัวหน้า reading their
own queue is the one person who does not need telling whose signature is
missing. The count already joined the title on phones, so the wrap was spending
a whole row on one button; `.card-head` was made nowrap there, with the button's
group `flex: none`. **That half lasted eight days — [the reversal is
below](#and-the-line-lasted-eight-days).**

**It took four passes and every number came off the built app**, which is the
part worth keeping:

| what was tried | what it did |
|---|---|
| `flex-wrap: nowrap` alone | 7px over a 320px screen — the head scrolled sideways, worse than the wrap |
| `min-width: 0` on the column | the column shrank past its own content; the title overflowed and slid under the button |
| no `min-width: max-content` on the name | column took its width from the long hint; title drew `รออนุ… · 2 รายการ` with 48px of the row empty |
| `.t` as a flex row | a flex item drops leading whitespace, so `{' · '}` rendered as `รออนุมัติ· 2 รายการ` |

So the one-line head started at **360px** and 320px kept the two-row shape it
had; the column was left at `min-width: auto` so it could not go under the
title; the name carried `min-width: max-content`; and a 5px `gap` put back the
space the markup had been getting from a text node. **Measured then**: one line
at 360 / 390 / 430 / 768 with the head at **88.5px** against 125.8 before, title
and button both full, and nothing overflowing at any width including 320.

### And the line lasted eight days

**Reported 2026-09-08: `+ บันทึก OT แทนพนักงาน` was cut off at the card's right
edge on a phone.** It reads as an overflow and it is one — but the queue's card
is `.card.flush`, which has carried `overflow: hidden` since it was written, so
nothing spilled onto the page and the page never scrolled sideways. The button
was **clipped**, which is why the label looked chopped rather than the screen
looking broken. `document.documentElement.scrollWidth` was clean at every width,
before and after; the only witness was `head.scrollWidth - head.clientWidth`.

**The one-line head named its own expiry and nobody was watching for it.** Every
rule in it rested on one measurement — that the title column's min-content is
THE TITLE — and `.hint .q-scope` took that back a day later by holding
`เฉพาะแผนก…` together as one word. The 11px hint bought the geometry back, and
the note that shipped with it said, in as many words, that a department named
longer than about thirteen Thai characters would undo it again, and that the
remedy then was **not another size** but letting the head stop being one line.

**The roster import was that day.** The live หน่วยงาน table is 18 departments
since 2026-09-08, and what the screen prints is `nameTh` ([`lib/session.js`](lib/session.js)),
not `name` — the two longest are **`แผนกการตลาดและกราฟฟิคดีไซน์` and
`แผนกออกแบบและวิจัยผลิตภัณฑ์`, 27 characters each**, against the 12 of
`ควบคุมคุณภาพ` the geometry had been worked out against. At 11px that clause
measures **226px** where the title is 129, so the column took 226, the button's
group was `flex: none` and could not give, and the pair ran off the end.

**Measured on the built app at :3001 against a clone of the live database**, as
a หัวหน้า moved into the longest-named department, `prefers-color-scheme: dark`:

| width | head over its card, before | + บันทึก OT แทนพนักงาน past the card edge | after |
|---|---|---|---|
| 320px | 0 | — | 0 — the 360px floor meant this width never had the one-line head |
| 360px | **93px** | **91.5px** of a 174.6px button | 0 |
| 390px | 63px | 61.5px | 0 |
| 430px | 23px | 21.5px | 0 |
| 768 / 860px | 0 | — | 0 |
| 1280px | 0 | — | 0, and untouched: still a row, 174.6px, 33px tall |

**So the head is a column below 860px.** The title and its hint take the card's
full width — the width a hint was always drawn to wrap inside — and the button
lands on the line beneath them at the card's full width: **258 / 298 / 328 / 368
/ 706 / 798px** at 320 / 360 / 390 / 430 / 768 / 860, 44px tall, its label one
line, and its right edge 19px inside the card at every one of them. `.card-head`
centres its items, so `align-items: stretch` is the half that makes it full
width rather than a chip floating in the middle of its own line. It costs the
head **123.8px** where it was 77–84, and **142.5px** at 320–390 where it already
was 142.5. A full-width action at this width is not a new shape here:
`.withdraw-batch` — อนุมัติให้ถอนทั้งหมด on the card directly above — has taken
the whole line at ≤860px since it was written.

**Everything the one line needed went with it**: `flex-wrap: nowrap`, the
`@media (min-width: 360px)` floor that only nowrap ever needed, `.t` as a flex
row with the 5px gap standing in for the space a flex item strips, `min-width:
max-content` on the name, `flex: none` on the count and on the group, and the
hint's 11px — which puts the hint back to the 12.5px every other card draws it
at. The 44px touch target stays; that rule is about thumbs, not about lines.

**And the same rule was clipping a head nobody had reported.**
บันทึกและประวัติ OT's head matches the same selector, and at 360px it was
running **102px** past its card with ทั้งหมด's right edge 101.5px outside it —
worse than the queue's, because a month picker beside the button made the
`flex: none` group wider still. `flex: 1 1 auto` on *every* control in the group
rather than on the button alone is what shares that line: the picker and
ทั้งหมด come out 130.4 / 115.8px at 360, and on the queue, where the count chip
beside the button is `display: none` and therefore not a flex item at all, the
button takes the whole width by itself.

**What is still true and is still not fixed.** `.hint .q-scope` is still one
unbreakable word, and at 320px it measures **256.8px inside a 258px column** —
1.2px of headroom. It fits, and it fits at every width above that, because the
hint now has the card rather than a share of a line. But a department renamed
longer than the two 27-character ones would overflow it, and `.card.flush` would
clip that too. The remedy is the one this section already demonstrates: nothing
in the head's geometry may be allowed to depend on a name somebody types into
ตั้งค่าระบบ.

### The button, and the header it opens

`+ บันทึก OT แทนพนักงาน` on the หัวหน้า's own queue since 2026-08-31 — it read
`+ บันทึก OT แทนลูกทีม` until then. **Two strings in two files**, and they are
one sentence a person reads across a press: the button in
`components/ApprovalQueue.jsx` says what is about to happen, and the pop-up's
header — `heading` in `components/OtForm.jsx`, written once because two
different elements draw it — says it has. Only the button was reported; changing
it alone would have left two words for one thing either side of a click.

**The label fits and always did.** Measured on the built app as a หัวหน้า at
320 / 360 / 390 / 430 / 768 / 860 / 1280 / 1440: **164.1px on one line at every
one of them** — 174.6px re-measured 2026-09-08 with the 44px padding on it —
and the page has never scrolled sideways. (Counted off the client rects of a
Range over the text, not by dividing the button's height by its line-height,
which reports a one-line label as two the moment a `min-height` applies.) It
read "no overflow, and … `.card-head` wraps below 860px, so the count chip and
this button are on a line of their own long before the space runs out" until
2026-09-08. The wrap was replaced by the one-line head a paragraph later the
same day, the one-line head OVERFLOWED eight days after that, and the label was
never what did it — [the head is a column now](#and-the-line-lasted-eight-days),
and the button has the whole of it.

**What the measurement did find was the touch target.** The button came out
**33px** at 320–860px while the same `.btn.sm` two rows below it in
`.row-actions` was 44 — `.card-head` is the third place one of these is pressed
with a thumb and the only one the phone rule had not reached. It is in that
rule now, which costs the head **114.8 → 125.8px** on a phone and **69.8 →
77px** at 768–860; the desktop is untouched at 33px. `ทั้งหมด` on
บันทึกและประวัติ OT is the other `.btn.sm` in a `.card-head` and gets the same
44px, which is the right direction for it too.

**Who may.** หัวหน้างาน only, and only for `role: 'employee'` people in their own
department (`proxyPermission`, [`lib/proxyFiling.js`](lib/proxyFiling.js)). Not
ฝ่ายบุคคล and not Admin: neither files OT today, and both would be filing for
people they do not work beside. The whole rule is one predicate, so widening it
later is a clause rather than a rewrite.

**`filedBy` is written on every entry**, including the ordinary ones where it
equals `employee`, so "was this filed by somebody else" is a comparison of two
present values rather than a rule with an exception. Entries from before the
field carry nothing, and for them absent means self-filed — *provable*, not
assumed: `POST /api/entries` accepted only callers passing `maySubmitOt()` and
wrote the caller as the employee. It is the one field in `OtEntry` whose absence
has a known meaning.

**The employee still owns it.** It appears in their **OT ของฉัน** without any
change to `scopeFor` — the entry is theirs — and they may correct or withdraw it
on the same terms as anything they filed themselves.

### It skips the step its author would have signed

A หัวหน้า who fills the form in and then presses อนุมัติ on it has checked
nothing. The signature is real in the sense that somebody made it and worthless
in the sense that it is the same person twice — and **the audit trail cannot
tell those apart afterwards**. It records ยื่นคำขอ → หัวหน้างานอนุมัติ →
ฝ่ายบุคคลยืนยัน and reads, correctly as far as anything on the page can show, as
two independent people agreeing. That is the lie. So the request is created at
`pending_hr`, having been approved by nobody, and the history says so.

`proxySkipsOwnApproval` (default `true`) turns it off, because "we want both
presses on the record whatever they are worth" is an answer HR is entitled to
give. The condition is deliberately **"could this filer sign the step"** and not
"was this a proxy filing": under the rules above the two pick out the same
entries, and only the first stays true if who may file is ever widened.

Nobody approves their own filing, and that is checked **again**, independently,
in `approvalPermission` — not left to the routing above having handled it. The
routing is a different rule in a different file behind a config flag, and a
request can reach `pending_mgr` carrying its author's name by more than one
route: the flag turned off, or a stand-in reaching a department whose entries
never passed their own step. A rule that depends on another rule breaks silently
the day somebody edits the other one.

### Before the first signature, not "while pending_mgr"

`editPermission` and `cancelPermission` drew their line at
`status === 'pending_mgr'`, which was the same line as "nobody has approved
this" for as long as those two could not come apart. A skipped request is
created at `pending_hr` with no approval on it, and read literally the old
spelling shut the employee out of their own request from the moment it existed.

`awaitingFirstSignature()` is now that line, written as *the old condition OR the
new one* rather than as the general rule `!managerDecision?.at` that both are
instances of. The general version is tidier and strictly narrower: under
`hrRejectReturnsTo: 'manager'` a refused entry returns to `pending_mgr` carrying
the manager's earlier decision, and the tidy rule would quietly close a door
that has been open since the first version — a rule change nobody asked for,
arriving as a side effect of a feature about something else.

### On screen and on the paper

Every list that shows a request shows who filed it: **หัวหน้าบันทึกแทน · ชื่อ**
beside the แก้ไขแล้ว mark it is deliberately *not* coloured like, on the
employee's own history, the approval queues, and ตรวจสอบรายเดือน → ดู /
แก้ไขรายการ. The review pop-up says it above the hours, where a view has not
been formed yet, together with the fact that nobody approved it and why.

**F-HR-027 gets a six-character `(แทน)`** in the รายละเอียดงานที่ทำ cell — where
`(ต่อจากคืนก่อน)` and `[ไม่พักเที่ยง]` already are, which is the one place on
that form carrying per-row remarks and the one HR reads today. Not a column and
not a row: the sheet is a fixed month of 31 rows with columns measured in
millimetres.

The block under the grid naming who filed and who signed on whose behalf is
behind **`proxyNoteOnForm`, default `false`**. F-HR-027 Rev.4 is a controlled
form, and a line nobody in HR has agreed to is a change to a document rather
than a feature — so it is written, testable, and off until somebody looks at a
printed sample and says yes. With it off, the same facts are on the **screen**
above the sheet, always: whoever pressed print is the person who can still do
something about a row filed by the wrong person.

---

## ผู้รับช่วงอนุมัติแทน — the stand-in

A หัวหน้า who is away can let somebody else sign their approval queue, between
two dates. The rules are pure and live in
[`lib/delegation.js`](lib/delegation.js); the reads and the clock are in
`lib/delegationQuery.js`, split for the reason the mongoose call behind a
policy save is split from the rules — the suite tests the rules without opening a
connection.

**A window, never a switch.** There is no `enabled` field, and that is the
design rather than an omission. A toggle gets turned on for a week and left on
for a year, because the person who would turn it off is the person who was
away — and nothing ever objects, since a stand-in signing and a stand-in who
should have stopped signing months ago are indistinguishable. A dated window
stops applying on its own.

Dates are `'YYYY-MM-DD'` **strings**, for the reason `Holiday.date` and
`Employee.birthDate` are: this is a range on a calendar, not a pair of instants.
Both ends are inclusive. The one date that has to be *produced* rather than read
is today's, and `today()` formats it in **`Asia/Bangkok`** (override with
`OT_TIMEZONE`) — `toISOString()` is UTC, and for the seven hours after midnight
it would name yesterday, opening a window late and holding it open through the
small hours after it should have shut.

**It adds a signature, it does not move one.** The real manager's claim is
settled before any delegation is consulted, so coming back early costs nothing
and needs no undo. Both may approve throughout.

**No chains, and the cycle is walked.** A stand-in may not be somebody who has
delegated their own queue away, and a manager holding somebody else's queue may
not pass one on — two rules that between them make the graph one edge deep, so a
loop is unreachable. `wouldCycle()` walks it anyway: that property holds only if
every row went through these rules, and rows fixed by hand or written in a race
did not. A cycle among approvers is the one shape here that cannot be reasoned
out afterwards, because every link in it looks legitimate on its own.

**Set by the manager, or by ฝ่ายบุคคล.** HR is not a courtesy: a หัวหน้า taken
ill on a Sunday night cannot log in to nominate anybody, and a rule that works
only while the person is well is not a rule for absence. The manager's own copy
is on **ข้อมูลส่วนตัว**; HR's is **ตั้งค่าระบบ → ผู้รับช่วงอนุมัติ**. One
component, because the screen used less often is the one that would end up
missing the rule that matters.

**The stand-in reads both queues, and can tell them apart.** `scopeFor` takes
the covered departments as an argument rather than looking them up, so it stays
pure; a manager's **รออนุมัติ** carries the covered team's rows alongside their
own, under a banner naming who is being covered and until when, with every
covered row wearing a **รับช่วง** chip.

Widening never applies to ฝ่ายบุคคล, who are not narrowed by department in the
first place — widening a scope that is not narrow would *narrow* it, and it
would do so silently, on the screen meant to show everything. So `scopeWidening`
hands the list only to somebody it would widen. What HR lack while standing in
is therefore not access but a **screen**: `GET /entries?scope=delegated` returns
the handed-over queue and nothing else, behind a **รออนุมัติแทน** tab that
appears while they are covering at least one team — keyed on teams covered, not
rows waiting, because an empty covered queue is still somebody's
responsibility and a tab that vanished with its last row is one nobody would
trust to be there tomorrow.

### The audit trail is the point

`history.by` stays **the person who pressed the button** — always, never the
manager they stood in for. Beside it:

- **`onBehalfOf`** — whose authority it was, with **`onBehalfOfName`**
  denormalised next to it for the reason `byName` is: a trail has to stay
  readable after somebody leaves, and a name copied at the moment of signing is
  the only version a later roster change cannot erase.
- **`delegationId`** — *where that authority came from*. A name answers "who
  signed". This answers "on what basis", which no number of names can. Without
  it the trail says B acted for A and leaves whoever is checking to take it on
  trust; with it there is a record with dates on it that either covers the day
  the decision was made or does not.

The same three ride on `managerDecision` and `hrDecision`. ประวัติรายการ prints
**หัวหน้างานอนุมัติ · โดย สมหญิง · ทำแทน สมชาย**, the review pop-up says it under
ผู้อนุมัติ, and the F-HR-027 note block carries it to the paper when
`proxyNoteOnForm` is on.

**And since 2026-08-31 the employee's own pop-up says it too**, under
**การอนุมัติ** — every signature on the request, oldest first, each with the
desk it was made at and the minute it was made: *หัวหน้างานอนุมัติ · วิชัย ศรีสุข
(หัวหน้างาน) · 13 ส.ค. 2569 14:34 น.* The three screens above all belong to
somebody reviewing; this is the one belonging to the person whose hours they
are, and until then it was the only one of the four that named nobody. Not for
want of the data — `approvalSteps` in `lib/approverLine.js` reads the same
history rows `EntryHistory` does — but because the one line it did draw prints
the LAST decision, and on an approved entry that is the ฝ่ายบุคคล step. **The
bracket says the desk, and the desk is read off the `action`**, never off the
signer's `position`: `approve_mgr` was the หัวหน้า step on the day it was pressed
and stays it, whereas a position is live and a promotion would silently re-label
every signature that person ever made. If a job title itself is ever wanted
against a signature, the honest way is a `byPosition` copied onto the row beside
`byName` at decision time — it cannot be recovered for rows already written,
which is the whole argument against reading it live.

**ฝ่ายบุคคล was a desk and not a person there, and the block said so out loud —
and as of 2026-09-07 it no longer says anything.** The department shares one
login (see ตาราง above), so `byName` on an `approve_hr` row was an account; the
name was not repeated in brackets — *ฝ่ายบุคคล (ฝ่ายบุคคล)* reads as two parties
— and a line under the list stated that the account is shared. A reader meeting
a real person's name on the row above has every reason to assume this one is a
person too, and the place to correct that is where it is read.

**That footnote is keyed on the account's NAME and the account has been
renamed.** `const shared = steps.some((s) => s.byName && s.byName === s.desk)` —
it drew only while the signer's stored name was the literal string `ฝ่ายบุคคล`,
which is what `HR-001` was called until an administrator renamed it to `ยิ่งยง`
at 01:40 that morning (roster audit; `position` became `ฝ่ายบุคคล` in the same
save). Nothing else changed and nothing failed: the note simply stopped
appearing, on old rows as well as new ones once
`npm run refresh:signature-names` brought the stored copies up to date. **Two
questions are open and neither is answerable from the code**: whether the login
is still shared by the department at all now that it carries a person's name,
and — if it is — what the note should key on instead, since a rule that reads a
person's NAME to decide what to draw is the mistake §วันหยุด records under
`Holiday.year`. Individual ฝ่ายบุคคล logins would be the only real fix and
nobody has asked for them.

**An expiry changes the queue, not the past.** Entries already approved keep the
status they were given: an approval is an event that happened, not a permission
re-evaluated on every read, and nothing recomputes one.
`test/delegation.test.js` pins that explicitly — it is exactly the kind of thing
a later reader might "fix". Ending a delegation early sets `revokedAt` and
deletes nothing, because approvals point back at it: an audit trail whose
evidence can be removed proves nothing.

---

## ขอถอนใบที่อนุมัติแล้ว — asking, not taking

`cancelPermission` draws its line at the first signature: before it the request
is the employee's to withdraw, after it the entry carries a decision made
against particular hours. That line is right. What was wrong was the sentence on
the other side of it — **“หัวหน้าอนุมัติแล้ว ยกเลิกเองไม่ได้ — ติดต่อฝ่ายบุคคล”** —
which sent the rest of the story outside the system.

**And that sentence itself stood until 2026-08-31**, months after the feature
below replaced what it described: `cancelPermission` went on answering
ติดต่อฝ่ายบุคคล on a signed entry, so anything that reached the rule rather than
the screen still sent people back to the phone call. It now names the button —
กด “ขอถอนใบ” — which makes it the mirror of `withdrawEligibility`'s own
redirect on the other side of the same line, where a request nobody has signed
is told to press ยกเลิก instead of asking. Two rules, one line between them, and
each pointing at the button the other side owns.

What happened out there was ฝ่ายบุคคล editing or cancelling the row on the
employee's say-so, and what the trail recorded was **ฝ่ายบุคคลแก้ไขข้อมูล**. Who
asked, when, why, and whether the manager who signed ever heard about it were
all real facts about that entry and none of them was written down. A withdrawal
that leaves no record of the request is a signed figure coming off the books on
the authority of a phone call.

**Asking and deciding are two acts, by two people.** The employee asks with a
reason; somebody whose signature is on the entry answers. There is deliberately
no path where ฝ่ายบุคคล records both halves in one press — that would rebuild the
hole, because the record of the request would again be somebody's memory of a
conversation.

**Nothing moves while a request is open.** The entry stays `approved`, its hours
stay in the month, in the department's cap usage and on F-HR-027. A request that
removed the hours on the spot would let one person take back what two signed.

**No new status.** A granted withdrawal ends at `cancelled` — what every rollup,
cap calculation and report already means by “these hours do not count”. The
request itself is a subdocument, `OtEntry.withdrawal`, and `history` carries one
row per ask and one per answer. The same reasoning `refileState` gives for not
being a status either.

| | who | what it writes |
|---|---|---|
| **ขอถอนใบ** | the employee, on their own entry, after the first signature | `withdrawal.state = 'requested'` · `withdraw_request`, status unchanged |
| **อนุมัติให้ถอน** | the department's หัวหน้า, a ผู้รับช่วง holding their queue, or ฝ่ายบุคคล | `granted` · `withdraw_grant` · status → `cancelled` |
| **ไม่อนุมัติ** | the same people | `refused` · `withdraw_refuse`, status unchanged |

A reason is **required** to ask, where `cancelPermission` deliberately asks for
none: removing a request nobody has looked at establishes nothing, but this asks
somebody to take back what they established, and the person deciding cannot
decide without knowing why. The same line `editPermission` draws for HR
corrections. A refusal requires one too, for the reason a rejection does — the
employee reads it, and “ไม่อนุมัติ” alone sends them back to asking in person.

Refusing is not final. Circumstances change, and the record of every ask and
every answer is the check on somebody asking repeatedly — not a lock that leaves
a phone call as the only way through, which is what this replaced. Contrast
`resubmittedTo`, which *is* a once-only door.

The rules are pure and live in `lib/withdrawal.js`; `withdrawEligibility` is the
same predicate the screen offers the button on and the route refuses with, so
the two cannot drift. Both routes refused a closed month until 2026-08-31 —
including the *ask*, because a request accepted into a closed month sat in a
queue where it could never be granted while the employee had been told their
withdrawal was under way. ปิดงวด was withdrawn, so neither refuses now and a
signed entry from any month can be asked back.

Reviewers find them on **คำขอถอนใบที่อนุมัติแล้ว**, above the approval queue,
fed by `GET /api/entries?withdrawal=open` in whatever scope the caller already
has. This paragraph ended **"It is not batchable, for the reason rejection is
not"** until 2026-09-02, when **อนุมัติให้ถอนทั้งหมด** was asked for and built —
several requests do land together, and answering ten identical ones a card at a
time is its own kind of not-reading.

**What the old argument bought is the shape of the button.** It is drawn only
above two or more; it writes nothing itself; and the box it opens is the
single-request dialog repeated — every name, date, figure and **reason in full**,
with the total coming off the books at the head of it. The thing the one-at-a-
time rule was protecting, that somebody read what they are granting, is still
what stands between the press and the write. The writes are then the ordinary
one-entry POSTs in a loop, in order, because there is no batch endpoint and each
grant is its own `history` row; a failure part-way leaves the grants before it
standing, so what failed is **named** and the list is re-fetched rather than
assumed.

**There is still no batch refusal, and that is the half of the old sentence that
was right.** A refusal carries a sentence the employee reads and one sentence
cannot be written to five people at once — the same reason the queue never
batches a rejection.

### The row is a grid, and it was a flex line with one item allowed to shrink

Fixed 2026-09-02, reported as *"ข้อความบีบอัดตกบรรทัดเป็นแนวตั้ง"*. The row held
five things in one `.item` flex line — the date chip, the sentence, the figure,
the status chip and two buttons — and four of the five were `flex: none`,
about 430px between them. Only the middle one could give, and `min-width: 0`
said it could give **everything**.

**Measured on the built app at 360px, with the old rule set put back on the row
from the console: the text column was 0.0px wide.** Not narrow — nought. The
row came out **934.8px tall**, and the reason the employee had typed wrapped
onto **21 lines** — the whole of what a reviewer is meant to read running down
the left of the row one or two characters at a time, while the figure and the
chip beside it held the width that would have fixed it. After the change, at
the same width: text column **252px**, row **259.3px**.

`.item.withdraw-item` in `app/styles.css` is a grid instead, and the space is
dealt out rather than fought over:

| | above 860px | below |
|---|---|---|
| the name band | row 1, beside the date chip | the same |
| the rest of the text | row 2, `minmax(0, 1fr)`, indented under the name | the same, full width |
| the two buttons | the right-hand column, bottom | own row, full width, 44px tall, equal halves |

`minmax(0, 1fr)` is the declaration doing the work: an `auto` column sizes to
its content and overflows, a plain `1fr` refuses to go below its minimum
content width, and only `minmax(0, 1fr)` both takes what is left and gives it
back.

**What is nowrap and what is not** is the other half, and they are not the same
answer. The employee code, the day with its clock span, the hours figure and
both button labels are single facts and carry `.nb` — a decision whose label
wraps at whatever width its row happened to leave has been read wrong. The name
carries `word-break: keep-all`, so a Thai full name may only come apart at the
space between its two runs. **The prose does not**: `เหตุผลที่ขอถอน` is free
text somebody typed, and forbidding every break inside a Thai run would push
the sentence out through the side of the card instead of wrapping it. The label
`เหตุผลที่ขอถอน:` is nowrap; what follows it is not.

The inline styles the row carried are gone in the same edit, for the reason
`.item-main` records — an inline style is the one thing the 860px block cannot
take back, and below 860px this row is a different shape entirely.

### The row went from five cells to three the same day

It read **"the figure and the status take a column of their own, stacked over
two rows"** until later on 2026-09-02, and that is what the table above used to
say. Three things changed, all asked for and all measured on the built app:

**1 — the green `อนุมัติ` pill is gone.** It was `<StatusChip>`, drawing the
entry's own status, and it was correct: these rows are still approved and still
counted. But it sat a few pixels from a button reading **อนุมัติให้ถอน** — two
small rounded objects side by side, one of them pressable, both saying อนุมัติ.
It was reported as a duplicate button, which is exactly how it read.

**What is NOT gone is the one thing it said that the card's heading does not.**
These rows are `approved` **or** `pending_hr` — `cancelPermission` opens the ask
at the *first* signature, not the last — and on a `pending_hr` row a grant takes
back a figure ฝ่ายบุคคล never confirmed. That is said now as a grey clause at
the end of the provenance line, `ใบนี้ยังรอฝ่ายบุคคลยืนยัน` (`.withdraw-unsigned`),
in a column where nothing can be pressed. A chip was what got mistaken for a
button; prose cannot be.

**2 — the hours moved into the line they belong to.** `17:00–21:00  3.5 ชม.`,
a quiet fill in the `.chip.muted` family at the size of the line it sits in,
**inside the same `.nb` run as the clock**. That is not decoration: the figure
is what a grant takes off the books, and a figure that can wrap away from the
clock it belongs to is how the wrong row gets withdrawn.

**3 — the date chip is centred on the NAME**, not on the four-line block. The
name band is its own grid row and both cells are `align-self: center`, so they
share the row's centre line — **measured at 0.00px apart at every width from
360 to 1440**. A `margin-top` on the chip would have hit the same number once
and drifted the first time a long name wrapped.

The row is `date · name` over `· rest` with the buttons down the right, and the
second row's first cell is empty so the prose keeps the chip's indent.

### An open request is ตกค้าง, and the card says so

This section read **"An open request blocks ปิดงวด"** until 2026-08-31, and the
failure it described was real: a withdrawal request nobody had answered sat on an
`approved` entry, so it was invisible to the pending count, and closing over it
meant it could never be granted and never refused.

**ปิดงวด was withdrawn.** HR print, sign and file F-HR-027 every month, and that
stack in the cabinet is the record — a second lock in the database bought nothing
and made every late correction an errand for an administrator. Nothing blocks now
and nothing can be stranded, because nothing shuts.

**What survived is the check, which was always the useful half.** Before pressing
print, ฝ่ายบุคคล want to know whether anything in the month is still waiting for
somebody. The card on ตรวจสอบรายเดือน — **สรุปสถานะงวด**, `components/PeriodStatus.jsx`
— answers exactly that, in the sentence HR asked for:

> งวด สิงหาคม 2569 — มีใบรออนุมัติค้างอยู่ 4 ใบ

### ตกค้าง and ควรตรวจ, and the line between them

The old distinction is kept, because it is still true — it just no longer decides
whether a button is pressable. `periodItems` in `lib/periodStatus.js` returns two
lists, and what separates them is **what printing the month does to them**:

> **ตกค้าง** is a thing nobody has answered. **ควรตรวจ** is a thing that is
> finished and worth a second look.

**ตกค้าง** — a request at `pending_mgr` is not on F-HR-027 at all, and an open
withdrawal means a row that *is* on the sheet may be about to come off it. Print
now and the paper is wrong, or goes stale the same week. Each is its own count
with its own sentence, never added together: they are cleared by different people
doing different things, and a single number would match neither screen.

> This read "**a request at `pending_mgr` or `pending_hr` is not on F-HR-027 at
> all**" until 2026-09-07. Half of it stopped being true when the shipped
> `formPrintScope` became ตั้งแต่หัวหน้าอนุมัติ: a `pending_hr` row IS on the
> sheet now, and unmarked — see §นโยบายการพิมพ์ใบขออนุมัติ OT below. It is still
> ตกค้าง, and for the reason that list exists: nobody has answered it. What
> changed is what printing the month does to it, which is what separates the two
> lists — printing a `pending_hr` row is now the ordinary way it gets answered.

**ควรตรวจ** — an entry flagged `capExceeded` or `belowMinimumFlagged` is
approved. Its hours are real, its status is final, and it prints correctly. It
carries a flag saying somebody decided something unusual. Counting it as ตกค้าง
would also contradict `capBehaviour: 'warn'`, which is the policy's own answer
that an over-cap request goes through carrying a flag — under that setting HR
approving it **is** the decision.

Only ตกค้าง colours the card and reaches the headline. A month with two over-cap
approvals in it is ready to print, and a flag that meant "there is something on
this screen" would be on every month there has ever been.

**เดือนก่อนหน้า** gets one line, and only when it still has something
unanswered. The old reminder spoke whenever last month was not *closed* — which,
because `otPeriodLocks` was empty on the live database every time it was
counted, meant every visit to every month, forever. A quiet finished month is now
silent.

`GET /api/periods/<period>` returns the five counts as `checks` from one
`$facet`, plus the built `headline`, `outstanding` and `review`, and still
returns `pending` at the top level so the reply stays a superset of what it was.
There is no `POST`: the two endpoints that closed and reopened a month are gone
from the tree, and `test/periodStatus.test.js` fails if either comes back.

---

## Which rules produced this figure

Answering an [OPEN] item mid-month is the point of these being runtime flags,
and it has a cost the flags alone cannot pay. Entries still in flight are
replayed through the engine; approved ones deliberately are not. So a single
month legitimately holds hours arrived at two different ways, the sheet balances
against itself either way, and until this existed there was no way — then or
ever afterwards — to tell which row was which.

**`otPolicyVersions` is append-only.** Every save that changes the policy
records the whole rule set as a new row; nothing is ever updated in place. Every
field on the model is `immutable`, so the guarantee is enforced by mongoose
rather than by everyone remembering. A version an entry points at means the same
thing in December that it meant in March, which is the only reason the pointer
is worth having.

**ตารางประวัติเวอร์ชันนโยบาย แบ่งหน้าที่เบราว์เซอร์ ไม่ใช่ที่ endpoint —
และคอลัมน์ สิ่งที่เปลี่ยนจากเวอร์ชันก่อนหน้า คือเหตุผล** (ตั้งแต่ 2026-09-08 ·
`TablePager` ตัวเดียวกับที่อยู่ใต้ตารางบน บันทึกประวัติระบบ · 5 · 10 · 20
เวอร์ชันต่อหน้า เริ่มที่ 10). Route คำนวณ `changes` ของแต่ละแถวจาก
`versions[i + 1]` คือเวอร์ชันก่อนหน้ามัน ซึ่งทำได้เฉพาะเวอร์ชันที่โหลดมาแล้ว — นั่นคือ
เหตุผลที่แถวเก่าสุดของรายการเขียนว่า `ไม่ได้โหลดเวอร์ชันก่อนหน้ามาเทียบ` แทนที่จะเป็น
`—` **ถ้าไปขอ endpoint ทีละสิบแถวโดยข้ามยี่สิบแถวแรก คอลัมน์นั้นจะพังที่แถวแรกของ
ทุกหน้า**: เวอร์ชันเก่าสุดของแต่ละหน้าจะไม่มีตัวก่อนหน้าอยู่ในผลลัพธ์ของตัวเอง แล้ว
พิมพ์ประโยคนั้นออกมา ทั้งที่ตัวก่อนหน้านั่งอยู่อีกหน้าเดียวถัดไป · ทั้งสายจึงถูกโหลด
มาแล้วเบราว์เซอร์เป็นคนตัดหน้า — เป็นคุณสมบัติของข้อมูล (เวอร์ชันหนึ่งไม่มีความหมาย
นอกจากเทียบกับเวอร์ชันก่อนมัน) ไม่ใช่ทางลัด · เดินจริงยืนยันแล้วว่าแถวแรกของหน้า 2
(เวอร์ชัน 14) แสดง diff จริง ไม่ใช่ประโยค "ไม่ได้โหลด…"

> **Route ยังหยุดที่ห้าสิบแถว และตอนนี้หน้าจอพูดออกมาแล้ว** เดิมตารางจบลงเฉย ๆ
> โดยแถวเก่าสุดเขียนว่า `ไม่ได้โหลดเวอร์ชันก่อนหน้ามาเทียบ` ซึ่งอ่านได้ว่า *แถวนี้เทียบ
> ไม่ได้* ไม่ใช่ *รายการถูกตัดตรงนี้* — พอมีแถบเปลี่ยนหน้าอยู่ใต้ตาราง ความต่างนั้น
> เลิกเป็นเรื่องความสวยงาม เพราะ `หน้า 3 / 3` เป็นคำพูดเกี่ยวกับรายการทั้งชุด · route
> จึงส่ง `total` (จำนวนเวอร์ชันที่มีอยู่จริง) มาคู่กับรายการที่ส่งได้ และเมื่อสองค่านี้
> ไม่เท่ากัน จะมีบรรทัดใต้ตารางบอกว่าเวอร์ชันที่เก่ากว่านั้นยังไม่ได้โหลดมา จึงยังไม่อยู่
> ในหน้าใดของตาราง · ฐานนี้มี 24 เวอร์ชัน บรรทัดนั้นจึงยังไม่ถูกวาด

**Every entry carries `policyVersionId`**, stamped by `applyComputation()` — the
one place engine output lands on a document, so submit, employee edit, hr_edit
and replay all get it without four separate things to remember. `otEngine.js` is
untouched by any of this and stays a pure function of `(session, policy)`: the
caller resolves the policy and hands it over, exactly as before. That purity is
what makes a replay reproducible three months later, and
[`test/policyReplay.test.js`](test/policyReplay.test.js) pins it.

**An approved entry is not replayed.** The rule lives in `planRecompute()` in
[`lib/policyVersion.js`](lib/policyVersion.js) rather than only in each caller's
query filter, because a filter is something every future caller has to remember
and this is a rule. `recompute: 'all'` is still there for a whole month being
restated — but it is never a default, it is **admin only**, and it requires a
`note` saying why. Both conditions are `authorizeReplay()`, one function shared
by all four ways in (the settings page and the manual replay, each on the App
Router and on the retired Express server), because a rule that has to be
remembered in four places will hold in three. HR answers the [OPEN] items; that
is what the settings page is for. Redoing a month somebody has signed off is a
different act from answering a question, and the person who signed it should not
also be the only person who can quietly redo it.

**What a replay leaves behind, at two levels.** Per entry: an approved entry
whose figures actually move keeps a `before` snapshot, so a restated figure
turns up in **ประวัติการแก้ไข** beside the ordinary corrections. "Actually
move" is `figuresMoved()`, compared **per bucket** rather than on the session
total — a rule change can push hours from ×1.5 into ×3 one for one, leaving
`otHours` identical while payroll pays a different amount against it, and read
on the total alone that entry looks untouched exactly where the change was
material. Snapshots stay quiet otherwise: a corrections column that fills with
two hundred rows which moved nothing is a column HR stops reading.

Per run: every replay is recorded in `otPolicyReplayRuns` — who ordered it,
when, under what note, from which versions to which, how many rows scanned,
replayed, changed, skipped, failed — **including the runs that changed
nothing**. That is the half the snapshots cannot cover. Without it, "the
recompute ran and the figures held" and "the recompute was never run" leave
identical traces, and those call for opposite reactions at month end. Also
append-only, and logged last so that losing the audit row can never lose the
recompute.

**The screens say so.** ตรวจสอบรายเดือน carries a banner when the month is not
uniform; ดู / แก้ไขรายการ carries the version per entry **in the ประวัติการแก้ไข
drawer**, one press from the row; ประวัติการแก้ไข prints `เวอร์ชัน 2 → เวอร์ชัน 3`
against a correction that crossed a boundary.

**No table has a กฎที่ใช้ column any more, and both went on 2026-09-04.** This
read "ตรวจสอบรายเดือน carries a กฎที่ใช้ column and a banner" until that morning,
when the per-person column came off: a version number per person was not what
that screen is read for, and the banner — which names every version in the month
and says what to do about it — is the half that was being used. The per-entry
column on ดู / แก้ไขรายการ went the same afternoon, on the same argument,
with the room it freed given to รายละเอียดงานที่ทำ and สถานะ rather than back to
the table. **Eight of those points went on to จาก–ถึง on 2026-09-07** —
`desc-col` 40% → 32%, `when-col` 15%/172px → 21%/204px — because the scan
column had meanwhile become the one wrapping: a day with three punches stood the
tallest row at 188px and broke `สแกน 07:26, 00:59 (+1), 07:23 (+1)` over three
lines. Measured at 1440px on the built app against a clone of the real database:
จาก–ถึง 172 → 215, รายละเอียดงานที่ทำ 280 → 236, the tallest row 188 → 170. The
sentence is NOT truncated at the new width and `entryRowChrome` bans it being
so — an ellipsis hides the half of a description that settles an argument
against the signed sheet. **What that costs:** a row nobody has ever edited has no drawer to
open, so its version is not readable on that screen at all — the banner is what
catches the case that matters, a month whose rows were not all computed the same
way. The banner
distinguishes three cases rather than firing on
all of them — flags that move numbers, flags that only move permissions, and
rows whose rules were never recorded — because a banner that fires when
`hrMayReject` was flipped trains HR to dismiss the one that fires when the
rounding rule changed mid-month.

**When the live rules are not on record, the settings page says so.** An entry
is stamped only when the policy in force matches the newest recorded version
exactly — a pointer to rules that did not produce the hours would be worse than
no pointer. The cost is that the mismatch is otherwise silent: a deploy that
changes a value in `src/config/policy.js` moves the effective policy with
nothing saved through the settings page, no version is written, and from that
moment every new entry is filed unstamped with no error anywhere. It would
surface weeks later as a monthly banner saying the figures cannot be compared —
the wrong problem, at the wrong time, to the wrong person. So
`GET /api/settings/policy-versions` returns a `live` block comparing the two,
and **นโยบายการคำนวณ** prints the drift with one button that records the
current rules as a version. That button changes no policy value and recomputes
nothing; entries already filed unstamped are the migration's job.

**`policyHash`** is an FNV-1a fingerprint of the canonical policy, stored on
each version for lookup and for printing beside the number so two people on a
phone can be sure they mean the same rule set. It is **not** what decides
whether a new version is needed — that stays `samePolicy()` on the canonical
string. 32 bits collide, and a collision consulted as an equality test would
swallow a real policy change: no version written, and a month of entries
attributed to rules that did not produce them. Wrong in that direction is
invisible and permanent; the string comparison it would replace costs nothing.

**Every policy flag must be classified** as arithmetic or cosmetic —
`ARITHMETIC_KEYS` or `COSMETIC_KEYS`, checked against `DEFAULT_POLICY` by a
test that fails on any key in neither. `sameArithmetic()` only compares the keys
it has been told about, so an unregistered flag that moves hours is not compared
at all: two versions differing by exactly that flag report as computing
identically and the monthly banner goes green saying the figures compare when
every one of them moved. There is no way to detect that afterwards, which is why
it is caught in the commit that adds the flag.

**Upgrading an existing database:** `npm run migrate:policy-version` records the
rules in force as version 1 and points every unstamped entry at it. It is the
single, deliberate exception to "an approved entry is never touched" — and it
writes a pointer and nothing else; no hours are recomputed by it. Idempotent on
two separate terms: an origin version is minted only when the collection is
empty, and an entry that already has a pointer is never rewritten, so a second
run reports nothing to do. `--dry` prints the plan; where the database's saved
overrides differ from the shipped defaults it prints the difference and stops
until you re-run with `--yes`, because version 1 records what the stored entries
were *actually* computed with and that is not always what is in the file.

---

## Two inconsistencies in the requirements doc

Neither changes the code, but both should be corrected in the doc:

1. **§1 says "eleven" open items; §13 says "twelve".** There are twelve,
   numbered OPEN 1–12.
2. **Example A is labelled "Tue 5 Aug".** The other examples label 7 Aug
   Friday, 8 Aug Saturday and 9 Aug Sunday — which makes 5 Aug a **Wednesday**.
   August 2026 fits every label except that one. Either way 5 Aug is a weekday,
   so A's expected result of 3.5 h @ ×1.5 is unaffected; the tests use 2026 and
   note the discrepancy.

---

## What the prototype got wrong

`OT-System.html` was the bundled prototype and is no longer in this folder —
it was removed along with `web/`, the Vite copy of the four screens, both of
which had stopped tracking the live code and were only ever a way to edit the
wrong file. Read it back from history if you need it:

```bash
git show ab8179a:OT-System.html > OT-System.html
```

For the record, the rules it invented and this scaffold does not have:

- a 21:00 weekday ceiling (§5: there is no ceiling)
- OT that cannot start before 17:00 (§5: early weekday starts count)
- a company-wide 36 hr/month cap (§7: caps are per-department and optional)
- day type from `day % 6` — weekend only, with no company holiday calendar,
  no ×3 bucket, and no way to cross midnight

---

## Outputs

**Printable form** — `components/PrintForm.jsx` renders F-HR-027 Rev.4 at A4
portrait, one employee per month, laid out cell for cell like the paper: วันที่
1–31, เวลาทำ OT (จาก/ถึง), the three yellow-headed hour columns,
รายละเอียดงานที่ทำ, per-row ลงชื่อ columns for พนักงาน and หัวหน้างาน, สรุปรวม,
and the dashed เฉพาะฝ่ายบุคคล box beside the ผู้ตรวจสอบ line.

**วันที่ 1–31 is thirty-one rows in every month** — asked for on 2026-09-08, and
the grid was the length of the month until then: 28 rows in February, 30 in
April. The paper form is ruled 1–31 whichever month is written at the top of it,
and a file of signed sheets is read across months by eye, so a February sheet
three rows shorter than March's is one somebody has to measure before they can
compare it. The rows past the end of the month carry their day number and
nothing else — the same blank line a day nobody worked has always printed — and
they carry **no date**: `formGridDays` in `lib/reports.js` answers `null` there,
so there is no `2026-02-30` for a segment to be matched against and the three
extra lines are blank by construction. A 31-row sheet was already the ordinary
case and still fits one side of A4; the short months now print the same page.

**The two ลงชื่อ columns are typed, not signed** — since 2026-09-02, and they
"stayed empty for hand signing" until then. HR asked for the names to print and
asked for them AS the signature: the sheet is not signed by hand once it is off
the printer. Nothing new is recorded to do it. `managerSignature` in
`lib/approverLine.js` reads `byName` off the entry's own history rows — the same
rows การอนุมัติ in the pop-up prints — so the two cannot come to name different
people, and a row nobody has approved prints blank rather than borrowing a
plausible name.

**ลงชื่อหัวหน้างาน names whoever pressed อนุมัติ** — asked for in those words on
2026-09-07, and it read "reads `byName` off the entry's own `approve_mgr` history
row" until then, blanking the box on every row ฝ่ายบุคคล approved themselves.
`approve_mgr` is still looked for first and still wins, so an ordinary sheet is
unchanged: the หัวหน้า signs, ฝ่ายบุคคล confirm after them, and the column keeps
naming the หัวหน้า. Where that step never happened the column names the
ฝ่ายบุคคล who approved instead — a บทบาท whose `APPROVED_BY` row is empty files
straight to their desk (ฝ่ายบุคคล's own OT among them, since they may approve it
themselves), and `submit_hr_verified` files and approves in one act off the
fingerprint scanner. The เฉพาะฝ่ายบุคคล box at the foot of the sheet is
untouched by any of this: it is the second signature on a two-signature entry,
it keeps its rule to sign on, and a name in the column does not fill it in.

**The given name alone, in bold, with no คำนำหน้า, no surname and no
punctuation** — the box carries a name and nothing else. `นางสาวปิยะนุช
พรมประชุม` signs as `ปิยะนุช`. No date beside it either, because the column is
19mm; each signature's minute is still recorded and still shown on การอนุมัติ.
`firstName` in `lib/api.js` is the split, and it makes two cuts: the surname
went on 2026-09-02 (it was the second line that put a 25-row month onto two
sides of A4), and the title on 2026-09-08. It read "the first whitespace-
separated word" until then, with a note beside it saying that was safe because
nobody on the roster wrote a title as a word of its own — measured on 22 seeded
people, still true when the real 164 arrived, and no protection at all, because
every title on that roster is written *joined* to the given name. The box read
`นายไพฑูร`. `NAME_TITLES` is the list, นางสาว before นาง because นาง is a prefix
of it; a title not on the list prints as part of the name, where somebody can
see it. Which rows print blank, and the page counts that set the 7.2pt type
size, are in §Status under `test/formSignatures.test.js`.

Rows are built from *segments*, not entries, so an overnight session's hours
land in the column the clock decides. **Only the date it was filed against gets
a line**, though: since 2026-09-02 the segment after a midnight prints nowhere,
and the hours it holds are named on the screen above the sheet
(`notPrintedHours`) instead. This paragraph read "an overnight session appears on
both dates … Friday's row reads 17:00–24:00 and Saturday's 00:00–07:00" until
2026-09-08, which had been false for six days — see §หนึ่งวัน หนึ่งใบ and
`test/oneRowPerDate.test.js`.

### The two CSVs beside it, and the bug their new labels exposed

Renamed 2026-08-31 with the button above them: **ส่งออกรายการ OT (CSV)** (it
read "ส่งออกรายรายการ (CSV)") and **ส่งออกรายงานสรุปประจำเดือน (CSV)** (it read
"ส่งออกสรุปรายเดือน (CSV)"). The old pair distinguished two *grains* of one
thing and read as a single word split in half; these name the two documents.
**The endpoints and the downloaded filenames did not move** — `OT-2026-08.csv`
and `OT-monthly-2026-08.csv` are what HR has been filing all along.

**Nothing about the styling changed, and that was the answer rather than the
omission.** `.btn.ghost` already carries `border: 1px solid var(--line)` and
hovers to `--green-tint` with a `--green` border and `--green-dark` type — a
bordered secondary that belongs to the filled green without competing with it.
The pair were `.btn.outline` greens for a while and were deliberately taken
back to plain ghosts, because สรุป OT ส่งบัญชี draws its second button the same
way and two screens doing one job in two voices is a difference a reader has to
account for.

**What the longer labels did expose is real.** `.export-row` also carries
`.row`, which declares `align-items: flex-end` — right for the flex line it is
above 860px, wrong for the grid it becomes below, and a grid inherits it. So
the two CSV buttons hung from the bottom of their row instead of filling it.
That was invisible for as long as both labels wrapped to the same number of
lines, and it stopped being invisible at 320–360px where the new right-hand
label takes three lines and the left one takes two: measured on the built app
before the fix, **67.5px beside 53px**, the short one floating with a 14px gap
over it. One line — `align-items: stretch`, the grid default that was being
overridden — puts them back to equals, and **the row's total height does not
change**.

**Measured after the fix**, built app on :3001 against a seeded scratch
database, as `HR-001` over CDP: no button overflows and the page never scrolls
sideways at 320 / 360 / 390 / 430 / 860 / 1280 / 1440. Desktop puts all three on
**one line at 38.5px each**; 320 and 360 give the CSVs **67.5px each**, 390 and
430 **53px each**, 860 **44px each**. `.action-row` on สรุป OT ส่งบัญชี and
รายงาน OT แยกแผนก is the same shape with its own `align-items: center` and is
deliberately left alone — both its labels take two lines, so nothing shows
there yet. It is the next place this bites.

**พิมพ์ใบขออนุมัติ OT ทุกคน** — the same sheet for a whole month in one
document, one person to a side of paper. The button read "พิมพ์ F-HR-027 ทุกคน"
until 2026-08-31, when the label was asked to name the document instead of the
controlled-form code: the code is what the sheet is called in the filing
cabinet, not what the person pressing the button calls what they are printing.
Nothing else moved — the `title` on the button still reads *รวมใบ F-HR-027
ของทุกคนในตารางไว้ในเอกสารเดียว*, the sheet itself is still stamped F-HR-027,
and the per-row button in the table still says **พิมพ์ F-HR-027**.
`components/PrintFormBatch.jsx` renders
`F027Sheet` once per employee, each one fetched from
`GET /api/reports/form/:period?employee=` exactly as the per-row button fetches
it, so a page in the bundle and a page printed on its own are the same page.
The sheet element is declared in one file only —
[`test/formBundle.test.js`](test/formBundle.test.js) pins that, because a
second copy of a controlled form is a second form the day one of them is
corrected.

Who is in the bundle is the rows of ตรวจสอบรายเดือน as they stand: same order,
same **สถานะที่นับ**. Somebody with no OT that month has no row and gets no
sheet — a blank F-HR-027 is a page nobody signs — and somebody whose only hours
are still in a queue is in or out according to the filter, which is the same
lever that decided whether their row was on the screen at all. What the filter is
worth ON the sheets is not the bundle's decision and never the screen's: each is
fetched with the statuses `formPrintScope` resolves to, which under three of its
four answers ignore `?status=` entirely — see the next section. Sheets are
fetched four at a time, and an employee whose sheet fails is named above the
stack rather than silently missing from it.

> That last sentence read "**each is fetched with the form route's own statuses
> (อนุมัติแล้ว + ค้างอนุมัติ), which is what the paper has always shown**" until
> 2026-09-07, and it had been describing a route that no longer existed since the
> flag went in: the list stopped being fixed the day HR could choose it.

### นโยบายการพิมพ์ใบขออนุมัติ OT — which rows reach the paper

**`formPrintScope`, four answers, and the shipped one is ตั้งแต่หัวหน้าอนุมัติ.**
HR, 2026-09-07: *ข้อมูลที่พนักงานยื่นขอโอที **ต้องขึ้นในใบขออนุมัติทำงานล่วงเวลา
ตั้งแต่ตอนที่มีคนกดอนุมัติ***. The table is `formPrintStatuses` in
[`lib/reports.js`](lib/reports.js), applied by the ROUTE and never by the screen.

| answer | the sheet carries | `?status=` |
|---|---|---|
| `signed` — ตั้งแต่หัวหน้าอนุมัติ (**shipped**) | อนุมัติแล้ว + รอ HR | ignored |
| `approved` — เฉพาะที่ฝ่ายบุคคลยืนยันแล้ว | อนุมัติแล้ว | ignored |
| `screen` — ตาม สถานะที่นับ | whatever the filter says | followed |
| `draft` — ใบร่างเดินเรื่อง | all three live statuses | ignored |

**The default was `approved` until 2026-09-07, and it was the LAST signature
rather than the first.** A request the หัวหน้า had approved was off the sheet
until ฝ่ายบุคคล confirmed it — on the very sheet ฝ่ายบุคคล confirm *from*, whose
foot carries the **เฉพาะฝ่ายบุคคล** box that is that confirmation. The paper
could not be printed for the step it exists to carry out, and a หัวหน้า who
signed in the app found the row missing from the month they were handed. Walked
on 2026-09-07 against the live database: THT0074's สิงหาคม sheet printed one day
and 8.00 ชม. with a 3-hour row the หัวหน้า had approved nowhere on it.

**It reverses a decision recorded on 2026-08-24**, and the note that recorded it
is worth keeping: *กลับเป็นค่าเริ่มต้น — ใบที่เซ็นรับต้องมีเฉพาะรายการที่อนุมัติ
แล้ว*. Both sentences are about the same fear and they differ on one word —
อนุมัติแล้ว meant `status: 'approved'` to this code, both signatures, and means
"somebody pressed อนุมัติ" in the newer one. `signed` is that reading; `approved`
is still there for the other, and is the right answer for a month printed to file
after it is settled.

**The failure the flag exists for is untouched.** A `pending_mgr` row — the one
NOBODY has approved — is as far off this sheet as it ever was, and reaches paper
only under `screen` and `draft`, where it prints `(รออนุมัติ)` in the
รายละเอียดงานที่ทำ cell and where ตั้งค่าระบบ carries a warning. A `pending_hr`
row carries **no mark and never did** — `formPendingStatuses` has said since it
was written that รอ HR is settled *on the paper* while no รอหัวหน้า row can reach
the same sheet, because the only step left is the box at the foot. What the
screen above the sheet does say, with dates, is which rows those are.

**THE SHIPPED DEFAULT IS NOT WHAT RUNS UNTIL SOMEBODY SETS IT**, and on this
installation nobody had. `Setting.policy` shadows `src/config/policy.js`
silently, and the stored answer here was still `approved` — so a สิงหาคม or
กรกฎาคม sheet went on hiding รอ HR rows for the whole day the new default
shipped. Reported on 2026-09-07 in exactly those terms, against วีระพงษ์ ศรีมงคล
PM00112: *ไม่ขึ้นในใบอนุมัติ ทั้งที่หัวหน้าอนุมัติแล้ว*. Two of that month's
twelve rows — 20/07 and 22/07, both `pending_hr` — were being filtered out
before any of the sheet was built.

**Set on this database on 2026-09-07**: `approved` → `signed`, through
`savePolicy` so the otPolicyVersions row was appended exactly as a press of
ตั้งค่าระบบ appends one (seq 24, note on the record, actor ADMIN). Nothing was
recomputed and no stored figure moved — `formPrintScope` is cosmetic, see
[`lib/policyVersion.js`](lib/policyVersion.js), and `savePolicy` replays only on
arithmetic keys. **This is a stored value, so it does not travel**: a fresh
database gets the file's `signed` and this one had to be told.

**รายละเอียดงานที่ทำ is capped at 22 characters** — `DESCRIPTION_MAX_CHARS` in
[`src/config/policy.js`](src/config/policy.js), enforced by
`normaliseDescription()` on both write paths and shown as a live counter on the
form. The paper column is one line of a fixed-width cell, so anything longer is
not recorded, it is ellipsised. **That cell is 51mm again** — it was cut to 37mm
for the afternoon of 2026-09-07, when a fourth จำนวนชั่วโมง column was on the
sheet and had to be paid for out of the only flexible column; HR asked for that
column off the same day. The *schema* limit stays at 500 on purpose:
Mongoose validates the whole document on save, so tightening it would make
every entry written before the cap unsaveable — you could no longer approve or
recompute a historic month. Editing such an entry asks HR to shorten it rather
than truncating it silently.

**Who may edit a submitted request, and until when.** `PATCH
/api/entries/:id` takes two callers, and the line between them is the first
signature on the entry.

*The employee, while the entry is still `pending_mgr`.* Nobody has approved
anything yet, so correcting a mistyped time, an overnight flag or a thin
description only changes what the manager is about to read. **แก้ไข** sits
beside **ยกเลิก** on those rows in ประวัติการขอ OT and on the recent list
(`components/EmployeeView.jsx`); it opens the same form the entry was written
in, with the same live preview. Hours are recomputed and the cap re-checked
with the entry's own current hours excluded, so an edit is measured against the
month without itself in it. No reason is required — there is no decision to
explain — and the edit is stamped into the history as `edit`. The status does
not move: it was waiting for the manager before and it still is.

*HR and Admin, at any live status.* Once the manager has approved, the entry
carries a decision made against particular hours and the employee is out of it
— from there a correction is HR's, or it is a fresh request. HR opens
**ตรวจสอบรายเดือน → ดู / แก้ไขรายการ** on any employee row
(`components/HrEntries.jsx`). The cap is re-checked against *that employee*
rather than against HR, and **the approval already collected stands** — an
approved entry stays approved rather than going back round the manager over a
typo, which is how a month stops closing on time. The price of that wider reach
is an audit trail: HR must give a reason, and the edit is stamped as `hr_edit`
with the name and the reason, shown under the description.

**Reading the corrections back, per person.** The audit trail is only worth
keeping if it can be found. Every edit stores the version it replaced
(`history.before`), and per entry that has always been readable behind
**ข้อมูลเดิม** — but only by someone who already suspected that row. HR
reconciling a closed month against the signed paper asks the question the other
way round: *was anything in this person's month changed after it was filed?*

So ตรวจสอบรายเดือน carries a **แก้ไข** column — the number of corrections in
that person's month, with HR's own count under it — and the number opens
**ประวัติการแก้ไข** (`components/HrEdits.jsx`): one row per correction, newest
first, saying which OT day it touched, when, by whom, the reason HR gave, and
เดิม → ใหม่ for every field that moved. Rows are the edits rather than the
entries carrying them, so three changes to one day read as three events.

**The two numbers are one object, since 2026-09-07** — `.edits-pill`, a compact
green pill centred in its column with `1 ครั้ง` over `ฝ่ายบุคคล 1` in a quieter
line. It read as two until then: a full `.btn.ghost.sm`, built for a row of
actions, with the second figure as a loose line UNDER it, both hanging off the
right edge because the cell carried `num`. `hrCount` is counted among the same
snapshots as `count` (`editTally`), so it can never appear without it, and the
markup now says so by nesting it. **It is still a button** — pressing it is what
opens ประวัติการแก้ไข, and a badge that only looked like one would be a figure
with no way to ask what it counts.

The count is tallied over every entry in the month at the status filter in use
(`editTally`, `lib/reports.js`) — **including filings superseded by a later one
for the same session**. Those never reach anybody's hours, but they were still
corrected, and a count that disagreed with the list it opens would be worse
than no count at all.

Entries that are rejected or cancelled are refused to both — those are closed.
A rejected request is not edited and resubmitted; the employee presses
**ส่งใหม่**, which fills a blank form from the old row and files a *new*
request. The rejected one stays as it was, so the month's record still shows
what was asked for and what came back.

Neither path touches the printed **ใบขออนุมัติทำงานล่วงเวลา / ทำงานในวันหยุด**
(F-HR-027). That form is rendered from the entries as they stand at print time
(`components/PrintForm.jsx`) — there is nothing on it to edit, and no way to
change what it says except by changing the entries behind it.

#### The row's last cell — one control, and the rest is sentences

A card on **ดู / แก้ไขรายการ** offers HR exactly one action, **✏️ แก้ไข**, and
until 2026-08-26 it did not look like it. Beside it sat **ไม่มีประวัติการแก้ไข**
as a `disabled` button — and `.btn:disabled` fills with `--neutral-wash`, which
in ธีมมืด is **lighter than the `--card` a ghost button is drawn on**. So the
dead control came out brighter than the live one, and at **134px against 57** it
was more than twice the width. Two buttons on the row, and the eye went to the
one that does nothing. Measured on the built app before the change; the numbers
are in `test/entryRowChrome.test.js`, which now forbids a disabled button in
this file outright.

**The fix is not a colour, it is a part of speech.** ไม่มีประวัติการแก้ไข was
always a *statement about the row* rather than an offer, so it is drawn as one —
`.cell-sub.th`, which is exactly what the same cell has used for **แก้ไขไม่ได้**
all along. Nothing is lost by it: the point of saying so at all is that an
absent control reads as a screen that forgot, and a sentence says it as plainly
as a dead button did.

**The row's last cell is two slots, and every row has both.** Left: what can be
*done* to this row — ✏️ แก้ไข, or แก้ไขไม่ได้ where the row is ยกเลิก or
ไม่อนุมัติ. Right: what can be *read* about it — ดูข้อมูลเดิม, or
ไม่มีประวัติการแก้ไข. That pairing was true in the markup from the day the cell
was written and invisible on the screen: `.entry-actions` is a flex run with a
6px gap, so the second thing started wherever the first one ended — the
right-hand control landed at **1192px** on the row whose left slot is the
sentence แก้ไขไม่ได้ and **1221** on the five whose left slot is the pencil
button, and on a phone at four different x-positions down a month of six cards.
A column of controls that does not line up reads as a column of *different*
controls, which is the opposite of what this cell is: the same two questions
asked of every row. `width: 100%` fills the cell — the eleventh column on the
desktop, the card on a phone — and `margin-left: auto` on the **last** child
puts the right-hand slot on its right edge.

**The last child, and not `justify-content: space-between`.** Three things land
here on an untouched วันเกิด filing the system wrote — แก้ไข, ถอนใบวันเกิด and
ดูข้อมูลเดิม — and space-between would push ถอนใบวันเกิด out to the middle, away
from the แก้ไข it belongs with. Pushing only the last one keeps *what can be
done* as one group at the left however many things are in it.

**Then, on 2026-08-26, the two of them were told apart by weight.** On a ยกเลิก
row the cell holds แก้ไขไม่ได้ and ดูข้อมูลเดิม side by side — a thing that
cannot be done and a thing that can — and both were `--muted` at nearly one
size, the live one a white button with a `--line` hairline on a white card. Two
labels, and which was which came only from the words. The sentence goes a step
lighter, to `--muted-2`: it stands in for a control that is not on offer, and a
disabled control is quieter than a live one everywhere else in this app.
**Both** sentences take it, not only แก้ไขไม่ได้ — ไม่มีประวัติการแก้ไข stands in
for ดูข้อมูลเดิม in exactly the same way, and that the two speak in one voice is
the whole reason neither of them is a disabled button any more. The button gains
an edge, `--line-lift` — the token for the border of something sitting *above*
the page — one step darker than `--line` in both themes, and the smallest change
that makes the live control the heavier of the pair. **Not a fill:**
`--neutral-wash` behind a ghost button is what `.btn:disabled` looks like, and
dressing the live control in the dead one's clothes is the defect the paragraph
above this one records.

**And the one control carries a picture.** `pencil` in
[`components/icons.jsx`](components/icons.jsx) — drawn, not the ✏️ character,
for the reason the whole icon file exists: a glyph is whatever the font on the
device decides, and this app runs on Windows, iPhones and Android. It is two
strokes rather than three, because at the 15px it renders at the third lands
within a pixel of the second and the tip goes to a smudge. `.btn.with-icon` is
opt-in by class, since `display: inline-flex` on `.btn` itself would relayout
every button in the app to serve the one that has an icon.

**A ghost button also has a press now, which it did not.** `.btn:active` moves
every button down one pixel — enough on a filled button, and nothing at all on a
ghost, which is the card's own background with a hairline round it. Under a
thumb, which covers the button, that was no feedback whatsoever. The three
states are a ladder in one family: `--card` at rest, `--green-tint` on hover,
`--green-bg` on press, with `--green` on the border for both. All tokens, both
themes, no colour named at the rule — the standing rule `test/theme.test.js`
holds this stylesheet to.

**And the one value that wraps got a line-height of its own.**
รายละเอียดงานที่ทำ is the only cell on the card whose value runs to two lines —
*"ทดสอบ calibration ชุด PM-3000 ก่อนส่งมอบ (ไม่พักเที่ยง)"* — and at the table's
1.5 the pair closed up into a block whose last line then sat 10px above the
next field, sharing one gap measured for neither. The field underneath was
**กฎที่ใช้** — a *label*, starting at the opposite edge — until 2026-09-04; it is
สถานะ now, which carries no label, and the two numbers below are kept because a
chip needs that separation from a paragraph at least as much as a label did.

**Two numbers, because one of them could only do half the job.** A line-height
separates the two lines from each other and puts half its growth under the last
of them — at 1.75 that is 1.75px into the gap below and no more, which is not
what "these are two different things" looks like when the thing underneath is a
heading. So the cell also takes `padding-bottom: 4px`, and the card's 10px flex
gap becomes 14 under this one field: 10 for the rhythm, 4 for the fact that what
is above it is a paragraph and what is below it is a label. Measured on the
built app from the last glyph to the label's first: **16.75px** before any of
it, 18.15 at 1.7 alone, **22.5** now — 10 gap + 4 padding + 5.25 of half-leading
under the last line + 3.25 above the label's own. It read "1.7, no padding" for
part of 2026-08-26. The table's own `td` rule is left alone: on the desktop this
cell is a column beside ten others, and a line-height set for a wrapped card
value would loosen every row of every table in the app.

**And ตั้งโดย ฝ่ายบุคคล went a step lighter than the version it hangs under.** It
was an inline `fontSize: 11.5` on `--muted` — the same grey as the figure above
it, 2.5px smaller — so the pair read as one two-line value rather than as a
figure with a note about it, and the figure is what a reader came to that column
for. `.pv-by` carries the size and `--muted-2`, which measures **3.41:1** on
`--card` in ธีมสว่าง: under AA, and deliberately, for four words that name a
*shared account* rather than a person, so the words name a login and not
somebody — and are never the answer to a question this column is being asked.
The version number keeps `--ink`. The other two 11.5s in that file,
*เปลี่ยนกฎการคำนวณ* and *ปนกัน*, are left alone: they inherit amber from the span
they sit in, and greying them would take the warning off them.

**The card breathes at 10px, not 8.** Every field on these cards is a label and
a value on *one* line — floated label at the left, value flowing to the right of
it — so that gap is the only vertical space between one fact and the next, and
at 8px against a 1.5 line-height six fields ran together into a block of text.
10px is the step the cards themselves are spaced by, so a card's insides and the
space around it are one rhythm. It is `.stack-table`'s rule, so every card list
in the app gets it.

**The notice under the name has one place, whether or not there is a notice.**
Most months carry no policy warning, so that slot is empty on most people — and
`.alert` brought its own 12px top margin while `.audit-bar` brings 16, so the
first thing under the heading sat 12px down on a month that had a warning and
16px down on one that did not. Four pixels is not the point: HR reads this
screen one employee after the next, and a block that moves between them is a
difference the eye reports every time. The banner is wrapped in
`.entry-notice`, the wrapper carries no margin, and the notice inside it carries
**16** — the same figure the bar takes. An empty slot is then zero pixels tall
and contributes nothing, with no `:empty` rule to get right, and a full one puts
the bar exactly as far below the banner as the banner is below the heading.

**Not a reserved height,** which is the other way to stop a jump and the wrong
one here. The banner is two lines on one month and four on another, so there is
no single number to hold open; holding the tallest open would put a void under
the name of every ordinary employee to spare the eye a jump it only sees when
moving between two of them. Nothing on this screen shifts *during* a load
either — the heading, the notice, the bar and the table all render in one pass
once the month is in.

**The bar stands 16px below the warning, not 12.** Adjacent margins collapse,
so `.alert`'s 12 and `.audit-bar`'s 12 came to 12 — two bordered boxes twelve
pixels apart, reading as one stack of two panels rather than as a warning and
then a control. The number is on the bar rather than as a `margin-bottom` on
`.alert`, which would move every notice in the app to space one bar on one
screen; when there is no warning to show it is the gap under the card's heading
instead, which wants the same.

**A bar with nothing to show fades, and the reason for it does not.** The
checkbox has carried `disabled` since it was written and the label has been
`--muted-2` for as long — but a greyed word beside a live-looking box reads as a
quiet label, not as a control that will not answer. The whole left-hand group
fades now: box, tick and words together, which is what "this cannot be pressed"
looks like everywhere else. **The colour goes darker by a step so the fade costs
nothing:** stacking `opacity` on `--muted-2` would land the words at **2.15:1**
on `--neutral-wash`, while `--muted` at 75% comes out at **3.19** — which is
where `--muted-2` at full opacity already was (3.20). The group visibly dims and
not one word became harder to read. (Disabled controls are exempt from the
contrast minimum; the exemption is not taken here, because those five words are
the only thing that names what the box does.) The sentence at the right end does
**not** fade — it is not part of the disabled control, it is the *reason* the
control is disabled — so once the left side dims the reason is the more readable
of the two, which is the right way round.

**And the box holds its contents the way the warning above it does.** `12px
16px`; it read "11px 13px" until 2026-08-26, a pair of numbers this bar arrived
with and nothing else in the app used. Two panels in a stack that hold their
contents at different distances from their own border read as two kinds of box
rather than two of the same kind. (The warning's *text* still starts further in
— 43px against 17 — because its mark and the 9px gap after it sit inside that
padding. That is the mark doing its job; it is the box edges that have to
agree.) Measured on the built app: the label's left edge and the sentence's
right edge are both **17px** from the border, and the checkbox, the label and
the sentence share one axis.

**The bar above the table was centred and the sentence in it was not.**
แสดงประวัติการแก้ไขทั้งหมด is a checkbox at the left and *"6 จาก 6 รายการมี
ประวัติให้ดู"* pushed to the right, in a flex row that has said
`align-items: center` since it was written — and the sentence still came out
**seven pixels above** the checkbox beside it. `align-items` centres a flex
item's *margin* box, and `.card .hint` gives every hint inside a card
`margin-bottom: 14px`, so fourteen pixels of nothing underneath lifted the words
by half of it. Nothing about the rule looked wrong, which is why it stood for as
long as it did: the misalignment was inherited from four hundred lines away.
`.audit-bar .hint` states all four sides now, so the next thing added to this
bar cannot inherit one either. Measured on the built app at 1280px: 302.8 /
302.8 / **295.8** before, 295.9 / 295.9 / 295.9 after.

**And the left margin went too, because it was wrong on the second line.** The
rule read `margin: 0 0 0 auto` — the sentence pushed to the right end, which is
right on one line and wrong on two: an auto margin pushes right on a *wrapped*
line as well, so on a phone the sentence sat alone against the far border with
nothing to be right of. `justify-content: space-between` on the bar does the
same job on one line and the opposite one on two, because `justify-content`
applies to each flex **line** — and a line holding one item places that item at
its start. The sentence lands under the label at the same left edge. Two items
exactly, which is what makes space-between safe here; `.entry-actions` uses the
last-child margin instead precisely because a third control can appear there.

**And below 860 it stacks, because there the sentence is a description.** This
paragraph read *"and no breakpoint, because the words are what decide"* until
2026-08-26, and the measurement under it still stands: the bar needs **444.7px**
of inside width to hold the longer of the two sentences on one line and has that
from a viewport of about **535px** up — measured on the built app, not assumed,
470px of inside at 560 against 390 at 480 — so the wrap fell exactly where the
words stopped fitting. What the words cannot decide is what the sentence *is*.
Below 860 the table beside it is already a column of cards, the bar is as wide
as a phone, and *"6 จาก 6 รายการมีประวัติให้ดู"* is not the far end of a row any
more — it is what ticking the box will show, and that belongs under the box at
its left edge. The phone rule sets `flex-direction: column` with
`align-items: flex-start` (the base rule's `center` is a *cross*-axis
instruction, and in a column the cross axis is the horizontal one, so without
this the stack comes out centred) and a **6px** gap rather than the bar's 14 —
that figure was measured between two independent items side by side, and between
a label and its own sub-text it is a chasm. Above 860 nothing moved: the label
starts 17px in and the sentence ends 17px from the other side, verified across
360 / 400 / 480 / 560 / 700 / 860 / 1280.

**The history drawer is a card on a phone, and its green edge was floating
inside it.** ประวัติการแก้ไข opens as a second `<tr>`, which at this width is a
card like the row above it — 15px of padding, a 1px border, a 14px radius.
`.audit-drawer` is a panel with a 3px accent down its left side, and that accent
is the whole of what says *this belongs to the row above*; inset by the card's
padding and border it ran down the middle of a white margin, beside nothing, and
the drawer's words started **35px** from the card's edge (16 + 3 + 16) against
the **15px** every field on the row above starts at. A card inside a card, out
of line with it. The padding moves from the card to the panel — the card holds
nothing else — so the stripe lands on the card's own left border, parallel with
it, and 12px of padding past the 3px stripe puts the text back at 15. `overflow:
hidden` goes with it: the cell carries `--neutral-wash` and now reaches the
corners, and a square wash inside a 14px radius is worse than the inset it
replaced. The top margin is untouched — the 10px `.stack-table tbody` puts
between every pair of cards, which is what holds the drawer to the row it opened
from. On the desktop nothing changed; there the accent has always sat against
the left wall of a `colSpan` cell.

**And the caption under ประวัติการแก้ไข is 12px, not 12.5.** *"แถวด้านบนคือข้อมูล
ล่าสุดที่พิมพ์ลงใบ F-HR-027…"* explains what the two halves of the drawer are,
and it is read once, by somebody opening this for the first time. Under it stand
the timestamps, which are read every time — and at `.hint`'s 12.5px the caption
was within half a pixel of `.entry-history .who` and a whole one *above*
`.entry-history .when` (11.5), so three lines of grey type came out the same size
and the eye had nothing to start at. A lighter grey was asked for and is not
taken, which is the third time that has been settled on this screen: `--muted-3`
on the drawer's own `--neutral-wash` is **2.79:1** in ธีมสว่าง against
`--muted-2`'s **3.20**, and this line is already below AA. The size carries the
step down on its own. The margin moved out of the JSX with it — it was an inline
style, which is there for one reason (`.card .hint` gives every hint inside a
card `margin-bottom: 14px`, and 14px between this caption and the first
timestamp read as a gap between two sections) and is the one place that reach is
invisible from.

**Every alert in the app breathes 2px wider.** An alert is a 17px mark, a 9px
gap and then a block of text — so the left edge of the *words* is already 26px
inside the box while their right edge was 14px from it, and a notice of three
lines sat visibly off-centre in its own border. The padding is `12px 16px`; it
read "12px 14px" until 2026-08-26. `.alert.tight`, the one-size-down notice a
bottom sheet uses, states its own and is untouched — which is the relationship
“test/absentCallout.test.js” (ลบแล้ว 2026-09-03) was written to hold.

**The footnote is a boxed note now, not a ruled-off one.** *การแก้ไขของฝ่ายบุคคล
จะคำนวณชั่วโมงใหม่ทันที…* sat 12px under the last card in the same grey as the
notes *inside* the cards, so the eye took it as one more line of the last row.
It read "12px with a hairline and 12px of air above it" for part of 2026-08-26,
and that only half worked: a rule says where the note starts and says nothing
about where it stops, so at the foot of a long month it still trailed off into
the page. It is a panel now — `--neutral-wash` behind it, a `--line-soft`
border, `--radius` corners and `10px 14px` of padding — the same quiet pair the
audit drawer and the เดิม → ใหม่ rows are already drawn in, so it is the app's
panel and not a new one. The padding read "12px 14px" for part of the same day:
two short lines in the last thing on the card want the box to read as a margin
note, not as a fifth panel. **It is outside the conditional that draws the
table,** so it is in the same place on every employee — including a month with
no rows at all, where ไม่มีรายการในเดือนนี้ stands where the table would be and
the note still says what an edit would do. `margin-bottom` goes to 0 against `.card .hint`'s 14, because
this is the last thing in the card and that 14 left 32px under it against 18 at
every other edge.

**And the two rules are on two lines.** They were one sentence joined by a ·,
and Thai has no spaces: the layout had a single unbreakable string to place and
broke it wherever the box happened to end, so the tail of the first rule and the
head of the second shared a line. Each has its own bullet now — *การแก้ไขโดย
ฝ่ายบุคคล ระบบจะคำนวณชั่วโมงใหม่ทันที (คงสถานะอนุมัติเดิม)* and *หากรายการถูก
ยกเลิกหรือไม่อนุมัติ พนักงานต้องยื่นส่งรายการเข้ามาใหม่* — drawn with a
`::before` rather than `list-style`, for the reason `.alerts-list` already
spells out: a `list-style` disc sits outside the content box and would hang into
the panel's padding. The `padding-left` is on the item and not on the list, so a
rule that wraps to a second line aligns under its own first line rather than
under its bullet.

**On a phone it lines up with the cards, not with the card it is in.** Below
860px the rows are cards inset 12px by `.stack-table tbody`'s padding, while the
note is a sibling of the whole table and so ran the full width of the `.card` —
12px wider on each side than everything it is about, which is exactly what a
block that has slipped out of its column looks like. The same 12px puts its left
and right edges on the cards' edges.

**It keeps `.hint`'s colour on purpose, and that is the second time.** A lighter
grey was asked for on 2026-08-25 and asked for again on 2026-08-26, and
`--muted-3` on the wash measures **2.79:1** in ธีมสว่าง against 3.20 for the
`--muted-2` it inherits — this is the sentence that says what an edit does to a
signed month, and it is already under AA at the size it is. (On `--card`, before
the panel, those two read 2.98 and 3.41; the wash costs a little contrast, and
that is the price of the box.) The box, the smaller face and the space carry the
hierarchy instead of the contrast carrying it. (For the record, ธีมมืด on the
wash: `--muted-2` is 4.59 and `--muted-3` 3.83 — the light theme is still the
half that cannot afford it.)

**Four inline greys left the file with them.** The day under the date, ข้ามคืน,
who last edited the row and the ceiling warning were `fontSize: 12` and
`fontSize: 11.5` written by hand; they are `.cell-sub.th` and `.cell-note` now,
which is what **คิวรออนุมัติ** already prints the same two strings from. Two
screens quoting one fact in two type sizes is what those classes exist to
prevent — and an inline style is the one thing the 860px block cannot reach.

**ไม่พักเที่ยง is the exception, and it is a red highlight — 2026-09-08.** Asked
for in those words while reading รออนุมัติ OT: *ตรงไม่พักเที่ยงขอเป็นไฮไลท์สีแดง*.
The two flags that share that cell are not the same kind of fact. ข้ามคืน
**describes the shift** — it says which day the end time belongs to and moves no
figure by itself, so it keeps `.cell-note`’s quiet amber. ไม่พักเที่ยง is the one
flag on the row that **adds an hour to the total two columns along**: the lunch
hour is deducted from every other request in the table and not from this one, and
that is exactly what a reviewer scanning the queue is looking for.

`.cell-flag` is `display: block; width: fit-content` — **a mark on the words, not
a wash across the cell**. A block fill in a table cell of unknown width reads as a
state of the whole ROW; stopping it at the end of the word is what makes it a
highlight. `white-space: nowrap` goes with that: plain text breaking mid-phrase
reads as a sentence continuing, and the same break inside a fill reads as a broken
box — which is what it did in ประวัติการขอ OT, whose เวลา column is under 100px.

It takes `--danger-bg` / `--danger-ink`, the pair ไม่อนุมัติ already wears, so
there is **one red in the app** and the highlight follows ธีมมืด without a second
rule (both are `light-dark()`). It is **not a `.chip`**: every pill on that row is
a STATUS — รอหัวหน้า, รอ HR, เหมารายวัน — and a fourth pill that is not a status
is how a reader learns the shape means nothing.

**Both tables, one mark.** รออนุมัติ OT is where it was asked for; ประวัติการขอ OT
on the employee’s own screen is the same square of the same table about the same
request, and two marks for one fact is what these classes exist to prevent. It
does **not** go on ใบ F-HR-027 — `[ไม่พักเที่ยง]` there is paper, which has no
theme and no colour here.

**แถบแจ้งเตือนของเดือน — one panel, whole.** Two notices about the month itself
can be on screen at once above the search box, and both are tall: the policy
warning names every version in the month and says what to do about it, and
อนุมัติชั้นเดียว explains a signature that is missing on purpose. Measured at
360×780 on 2026-08-25 the two panels came to **340px** — most of a phone screen
spent before a single row of the month was reached.

`MonthAlerts` is one `.alert` that counts them: *"แจ้งเตือนของ สิงหาคม 2569 · 2
ข้อความ"*, with *"กฎการคำนวณคนละชุด · HR อนุมัติชั้นเดียว 1 รายการ"* a step
quieter under it and **ดูรายละเอียด ▼** / **ซ่อน ▲** at the end of that same
flow. The labels are there because a bare *"2 ข้อความ"* makes a reader open it
to find out whether either of them matters, which is the fold costing more than
it saves; they are drawn **shut only**, because open the list's own headings are
those same words.

**FIRST OF EVERYTHING ON THE PAGE** — above สถานะที่นับ, above ประจำเดือน and
the search box, above พิมพ์ใบขออนุมัติ OT ทุกคน and the two CSVs, above the
list. (That button was called พิมพ์ F-HR-027 ทุกคน until 2026-08-31, which is
the name it goes by in the three quoted orderings below; the position is what
they are about and none of it moved. It
read "above the ประจำเดือน box, above พิมพ์ F-HR-027 ทุกคน and the two CSVs,
above the search box" until 2026-08-27, when ประจำเดือน moved down to join the
search box, and "above สถานะที่นับ, above พิมพ์ F-HR-027 ทุกคน and the two CSVs,
above ประจำเดือน and the search box" for the rest of that day, until the two
controls went back into the card ABOVE the buttons — see §"ประจำเดือน
ย้ายลงมาอยู่กับช่องค้นหา" and §"งวดกับช่องค้นหาขึ้นเหนือปุ่มส่งออก
และถอดการ์ดที่ครอบรายชื่อ" below. Still first of everything in all three.) What it warns
about is the figures on this screen and the person it warns is the one about to
sign them, so it is read before the controls rather than after somebody has
already pressed พิมพ์. It sat between the policy banner and the search box until
later on 2026-08-25, and inside the month card before that.

**It names the month because it is now above the box that sets it.** In its old
place, directly over the list, *"เดือนนี้"* was answered by the period picker two
inches above it; from the top of the page it is a question, and a warning about a
month a reader has to scroll *down* to identify is a warning they check twice.
The recall line the ✕ leaves behind says it too — *แสดงแจ้งเตือนของ สิงหาคม 2569
(2)*.

**The button is inline, not on a block of its own,** and that is worth 25px: it
is a touch target, and the labels wrap to two lines of Thai at 360px, so stacked
it was a whole row of the panel spent on one control. Inline it lands at the end
of the wrapped text.

**And it is a mini pill, not a button.** `.fold-pill` started as bare bold text
— a 17px line of writing that happened to be clickable — and overcorrected into
a 44px bordered box that was the heaviest object in a panel whose whole point is
the sentence beside it. It is now 12.5px at weight 500 rather than 12px at 600,
which is the one combination that drops the visual weight without making the
label harder to read, with 3px of vertical padding and a line at 28% of the
panel's own ink. **34px on a phone, not 44** — this app has two touch floors and
has had them since the batch bar: 44 for decisions, 34 for the controls beside
them (`.queue-mobile-bar`'s undo, pinned in `test/batchBarSticky.test.js`).
Opening a fold is not a decision, and 34 is still comfortably over the 24px WCAG
2.5.8 AA floor; what it gives up is the AAA 44, on the one control on this panel
that is not signing anything. The two buttons on every employee card keep 44.

Shut the panel is **97px**, open **259px**. It read "127px collapsed, 437px open"
earlier the same day, then "103px / 308px", then "107px / 269px".

**What opens is a list INSIDE it, not a second stack of panels.** The first
version of this counted the notices on a strip and then rendered the two
original panels underneath — three boxes where there had been two, with the
strip naming what the first box then said again. It read as a bug and was one.
So the panels are gone from this screen: `<PolicyVersionBanner>` is not imported
here any more, and each notice is an item of one `.alerts-list`. It read "the
panels open underneath it" for a few hours on 2026-08-25.

**An item is two lines.** The heading and its figures RUN TOGETHER on the first
— *"กฎการคำนวณคนละชุด: เวอร์ชัน 10 (1 ใบ) · เวอร์ชัน 1 (19 ใบ)"* — because they
are one statement, and two blocks made a three-line item out of a two-line one
wherever the pair happened to fit. The instruction goes under it **in brackets**,
which marks it as guidance about the line above rather than more of it — the job
the block margin used to do and does not have to. Each item is 80px at 360px; it
read "three blocks, 101px and 113px" until later the same day.

A **bullet and a gap**, not a hairline between rows. Hairlines came first, on the
argument that a disc in front of a bold line inside an already-marked panel is a
third level of decoration — true of a list whose items are one line each, and
these are two. The bullet is what says where the next item starts when the one
above it did not end at the right-hand margin, and the rule it replaces was
drawing a box inside a box for the same job. It is drawn with `::before` rather
than `list-style`, which would hang the disc into the panel's own padding.

**One line each, and what that cost.** The four policy sentences ran to three
apiece and every one opened by restating the condition — *"กฎที่ใช้คำนวณ
ชั่วโมงต่างกันจริง — ตัวเลขรวมจึงมาจากวิธีคิดมากกว่าหนึ่งแบบ"* in front of what
to do about it. The item's heading already says that in four words, directly
above, so it was the same fact twice fourteen pixels apart on the screen with the
least room for it. อนุมัติชั้นเดียว lost its sentence about the empty signature
box in the history, which is what *ไม่ผ่านหัวหน้างาน* already predicts and which
is spelled out in §"One signature, and the trail says so" for whoever needs it.

What did **not** go is the instruction and where to carry it out.
*ตรวจก่อนเซ็นรับรอง* is the whole reason the policy notice exists;
`npm run migrate:policy-version` is the whole reason its unversioned case does.
A version of this that kept only the figures would be a tidier panel that had
stopped saying the thing it is for.

**The fourth sentence came down again on 2026-08-26.** It read *"หน้านี้ไม่ได้
โหลดกฎเบื้องหลังมาด้วย — ดูที่หน้า ตรวจสอบรายเดือน ซึ่งเทียบให้แล้ว"* and is now
*"หน้านี้ไม่ได้โหลดกฎมาเทียบ — ดูที่หน้า ตรวจสอบรายเดือน"*. Thai has no spaces,
so seventy-six characters of it is one unbreakable run three lines deep inside an
amber box; both halves that matter survive — why this screen cannot answer, and
which one can.

**And the screen it names is now the way there.** This is the case whose whole
content is *"the answer is somewhere else"* — `arithmeticMixed` is null because
รายการ OT holds version numbers and not the snapshots behind them, and
ตรวจสอบรายเดือน holds both. Naming the screen and leaving the reader to find it
was the sentence doing half its job: กลับไปสรุปรายเดือน is at the top of the same
card, and nothing joined the two up. **ตรวจสอบรายเดือน** is a `.link` now, and
`HrEntries` passes its own `onClose` as the callback — leaving *is* arriving.
It is **optional**, and that is not defensive coding: `MonthAlerts` draws this
same notice *on* ตรวจสอบรายเดือน, where a link back to the screen you are already
on is worse than none, so it passes nothing and gets the plain string. The shape
is `AddBirthDateHint`'s, which degrades the same way for a หัวหน้า who has no
ตั้งค่าระบบ tab. Each half of the wording is written once, so the string and the
linked version cannot drift apart.

**A link inside a notice takes the notice's colour, not the app's green.**
`.link` is `--green-text` at 13px on a line-height of 1, which is right in a
table cell and wrong twice over here: green is what this app uses for *go* and
for *approved*, so inside an amber box it reads as a second, unrelated signal —
and 13px/1 dropped into a 12.5px line set at 1.75 sits off the baseline of the
words either side of it. Inside `.alert` it takes `font: inherit` with the
weight back at 500, an underline **at rest** rather than on hover — a link in a
coloured panel cannot use colour alone to be findable, because the whole panel
is coloured — and the `-ink` of whichever palette it is in. `--amber-ink` on
`--amber-bg` measures **5.46:1** in ธีมสว่าง against `--amber`'s 3.46, and in
ธีมมืด it is the *brighter* of the two: a control is the one thing in a notice
that has to be legible. This also picks up the link
*ดูรายละเอียดที่หน้านโยบายการคำนวณ* in `LivePolicyNotice`, which had been green
inside an amber box since it was written.

**And the instruction is grey now, in both renderers.** Three lines in one amber
at nearly one size is a block, and a block is read as one thing or skipped as
one thing — the third line is the only one that says what to DO about the other
two. A lighter amber was what was asked for and is the one option that costs
readability: `--amber` on `--amber-bg` already measures **3.46:1** in ธีมสว่าง —
a known, recorded debt of this palette — and 85% opacity would take it to 2.80.
`--muted` on the same ground is **5.04** and passes AA; on `--green-bg`, which is
what the `ok` variant of this same notice is drawn on, 4.99. So the line that
separates from the amber is also the only one in the box that passes. The rule
is `.alert .say`, and the panel gave up an inline `fontSize: 12.5` to reach it —
`.alerts-list .say` keeps its own smaller size and its opacity, states no
colour, and greys with it. One notice, one decision about how loud its
instruction is.

**Every word of it lives in one module.** `policyVersionNotice()` in
[`components/PolicyVersion.jsx`](components/PolicyVersion.jsx) answers whether
there is anything to say, how loud, the version list and which of the four
sentences applies; `PolicyVersionBanner` is now a renderer of that same call and
nothing else. Two screens draw the warning — this list, and the full panel
ตรวจสอบใบของพนักงาน opens — and a warning worded twice is a warning that gets
corrected once.

**The panel takes the colour of the worst of them** — amber if any notice is
amber — or the fold has quietly downgraded a warning by folding it.

**One control for the whole thing.** ดูรายละเอียด ▼ / ซ่อน ▲ and the ✕, and
nothing inside the list folds again: a second *ดูรายละเอียด* two levels down is
a reader asking which of them they just pressed. อนุมัติชั้นเดียว's own
`<details>` went with the panels.

**✕ lasts until the page is reloaded, and leaves something behind.** The panel
is remounted by a `key` on every change of ประจำเดือน or สถานะที่นับ — that is
what stops an open list describing a month that has gone — so the dismissal
cannot live in its state, which the same remount would clear. It is a
module-level flag: it outlives the remount, outlives leaving the tab and coming
back, and dies with the document. Not `sessionStorage`, which survives the
reload, so a dismissal made in August would still be in force the next morning
with a different month on screen.

What it leaves behind is **แสดงแจ้งเตือนของเดือนนี้ (2)** on one line, counted
from the month on screen. Dismissing closes the panel; it does not make a
warning unreachable, and it never touches the rows' own chips. A different
month's different warning is then a different number in that line rather than a
panel reappearing in front of somebody who said they did not want one.

**The export buttons come up to the controls they act on.** 8px at 360px, the
same as the gap between the buttons themselves, which is what makes them one
block rather than a section break — at 12px the row above had already stacked
into three full-width controls and the extra air read as a division between the
controls and the buttons that act on what they set. 12px stays on a desktop.
(This paragraph and the one in `components/HrView.jsx` both read "the selects"
until 2026-09-01, when the last `<select>` on the screen became `PickOne`;
what is above the buttons now is ประจำเดือน, ค้นหา and สถานะที่นับ, and not one
of the three is a tag the operating system draws a list for.) The
value moved out of an inline `marginTop` on the element to `.export-row` in the
stylesheet, because an inline style is the one thing the 860px block cannot
reach.

Walked at 360×780 on the built app against a clone, 2026-08-25: the panel above
the ประจำเดือน box and above the export row, **one** `.alert` on the page in
every state, no `<details>` inside it, one toggle and one ✕; shut 97px, open
259px with both items at 80px, dismissed 0 with the recall line naming the month;
the pill 108×34 shut and 62×34 open while the two buttons on every employee card
measured 44; 8px between the last select and พิมพ์ F-HR-027 ทุกคน, 12px at 1440px;
the per-row chip present throughout.

**What is still above the first employee card**, measured the same way: "754px
shut, 645px with the panel dismissed" on 2026-08-25, and **65px less than that**
since 2026-08-27 — see the next section for where those 65 came from and, more
usefully, where they did NOT. Most of what is left is the controls card — its own
`<h2>ตรวจสอบรายเดือน</h2>` and `สิงหาคม 2569` repeat the app header and the
alert panel directly above them, and dropping that pair below 860px is worth
about 60px more. Not done: it is a title, not spacing.

### ประจำเดือน ย้ายลงมาอยู่กับช่องค้นหา — 2026-08-27

**Asked for as "the screen does not say which month it is showing", and that was
right about the symptom and wrong about the cause.** The picker was on the
screen the whole time, in the card at the top beside สถานะที่นับ. Measured on the
built app at 360px: it sat at y=284 and the search box at y=749 — **465px apart,
with the export row and งวด สิงหาคม 2569 ยังเปิดอยู่ between them** — so by the
time anybody was reading the list it was two screens back and the only thing
naming the month was a grey line under the heading.

It is now in `.month-find`, in one row with the box that filters that list.
**ประจำเดือน first, ค้นหา second**: the month decides what is in the list and the
search only decides which of it is drawn. On a phone the two stack inside the
row; on a desktop they share the line, ประจำเดือน at a declared
`flex: 0 0 170px` because `.field`’s own `flex: 1` is a basis of nothing and two
fields grasping at nothing split the row in half.

**The two boxes did not END on the same line until 2026-08-28**, and that is the
cost of putting them in one row that took longest to see. `.month-find` declared
`align-items: center`; `.row`, the rule it overrode, declares `align-items:
flex-end` for exactly this case. ประจำเดือน is a `.field` **with** a label — 12px
of type, a 7px gap, a 46px box, 65px in all — and ค้นหา is a `.field` with none,
so centring the two in the taller one’s line left the search box floating nine
pixels off the floor: its bottom edge level with nothing, its top edge level with
the word ประจำเดือน. Reported as the search box reading like something belonging
to that label rather than a control standing beside its box, which is what it
was. The override is gone and the row ends its children where every other `.row`
in the app ends them. **แสดง n จาก m คน keeps `center`, now as its own
`align-self`** — one line of type stood on the floor of a 46px row hangs its
descenders below the boxes’ own, and centring that count was the whole of what
the row-wide `center` was ever wanted for.

**The row ABOVE it needed the opposite answer, reported the same day.** หัวข้อ
ตรวจสอบรายเดือน sits on the left of the first row of that card and สถานะที่นับ on
the right, and that row was `align-items: flex-end` too — an inline style on the
JSX, and `.row`’s own value. Measured on the running app at 1280px before
anything moved: the right column began at y=202.5 and the left at y=226.25, so
the label floated **23.75px** above the heading and the heading sat level with
the middle of the `<select>` beside it. The heading block is 42.25px tall
(19.5 + 4 + 18.75) against the labelled field’s 66 (12 + 7 + 47); ending them
level is what put the difference at the top, where it shows. (สถานะที่นับ was a
`<select>` when this was measured and is `PickOne` since 2026-09-01. The
geometry did not move with it: `.field .pick-one` takes the same height and
inset as `.field select` did, out of the same rule — which is why the argument
above is still the one this row is settled by. Its `maxWidth: 220` left the JSX
in the same change and is `.head-split .status-pick` in the stylesheet now.
**The labelled field is 72 tall (18 + 7 + 47) since 2026-09-04**, and read
"66 (12 + 7 + 47)" until then: `PickOne` renders through `Field` now, so its
label sits in a `.field-head` whose `min-height: 18px` reserves the row a (?)
would need. That is 6px more above the box and none below it, so the difference
this paragraph is about got 6px bigger and `baseline` — which re-derives the
offset from the two texts rather than hard-coding it — is what keeps the row
settled without a number here changing.)

**Both rows now line up, and they line up on different things — that is the
point, not an inconsistency.** `.month-find` ends its two boxes level at the
bottom because a reader compares the bottom edges of two controls.
`.head-split` puts its two sides on one baseline because a heading and a caption
are compared by the line the writing sits on. A single rule for both rows would
be wrong on one of them.

All four candidates were rendered against the running app and measured rather
than argued — the columns are the gap between the two columns’ tops, then
between the two texts’ baselines, then the card’s height:

| `align-items` | tops | baselines | card |
| --- | --- | --- | --- |
| `flex-end` (was) | +23.75px | +32.75px | 235px |
| `center` | +11.88px | +20.88px | 235px |
| `flex-start` (was, three rounds) | 0 | +9.00px | 235px |
| **`baseline`** (is) | −4.00px | **0** | 239px |

**The tops were the wrong column to read, and it took a fourth round of the same
report to see it.** `flex-start` shipped to all three cards — ตรวจสอบรายเดือน,
then ส่งบัญชี, then แยกแผนก — and every round signed off by measuring the two
columns’ top *edges* at 0.00px and calling the row level. It came back in the
same words each time. A box top is not where anybody looks: the heading is 15px
of type on a 19.5px line and the label is 12px on a 12px line, so with the two
boxes flush the two lines of *writing* are 4px apart. Rulers drawn across the
running app at 1440px on 2026-08-28 put the heading’s baseline at y=123 and
บริษัท’s at y=119, with the label’s line running through the middle of the
heading’s letters — two texts on two lines, which is what was being reported.

`baseline` spends that same 4px the other way: the labelled field drops, the
card grows 4px, and the two texts share one line (measured after: **+0.00**).
It costs the top edges, which is what the note written when `flex-start` went in
held against it — *“the label lands 4px below the heading’s top”*. That trade is
settled now and the eye settles it. The ink is what a reader sees; the box is
what devtools shows. A `margin-top: 4px` on the fields measures identically
today and is a number copied out of two font sizes, stale the moment either
moves — `baseline` re-derives it.

**It is a class now, and it was an inline `alignItems`.** Same reason
`.export-row` and `.deleg-head-text` are classes: the 860px block cannot reach
an inline style. Nothing needs to reach this one today — `.field` is
`min-width: 100%` down there and the two sides stack, which makes `align-items`
inert — which is exactly when moving it is free.

**The class is `.head-split`, and it was `.month-head-top` for one commit.**
สรุป OT ส่งบัญชี was reported the same day with the identical row — `สรุป OT
ส่งบัญชี` and its month on the left, `บริษัท` and `ประจำเดือน` on the right —
and measured at the identical **23.75px**, which is not a coincidence: it is the
same two boxes, a 42.25px heading block against a 66px labelled field. Naming a
shared rule after the first card that needed it is how the second card ends up
with a copy of the declaration instead of a reference to it, so the rule was
renamed for what it does rather than where it started. All three callers are
pinned in `test/monthSearch.test.js`.

**The third caller is สรุป OT แยกแผนก, and it cost one class name.** Reported
later the same day in the same words — the heading low, `แผนก` and
`ประจำเดือน` floating above it — and measured on the running app at 1280px at
**5.5px**, not 23.75: the heading block is y=114.5 and the fields y=109. The
smaller number is that card's hint, which runs to two lines, so the left side is
61px against the field's 66.5 rather than 42.25 against 66, and ending the two
level had less to give away. Same defect, shorter arithmetic — and the fix was
`className="row head-split"` in place of the inline `alignItems`, with **not
one line of CSS written for it**. That is what the rename above bought. It read
"After: the three tops measure 0.00px apart" until 2026-08-28, when the fourth
round of the report established that the tops were never the thing to measure;
the three baselines are what read **0.00px** now. Its second row needed nothing,
for the reason the next paragraph gives — measured on the same build, the two
buttons are **38.5 / 38.5** and the tick box's centre is **0.00px** from theirs.

**`baseline` is right for `.head-split` and wrong for `.action-row`, and the
same word means two different things in the two rows.** In the heading row every
column's first baseline is a line of type — the `<h2>` on the left, the
`<label>` on the right, because a `.field` is a column flex container and takes
its baseline from its first item. In the action row it is not: `.check` is a
flex container whose first item is the 17px checkbox `<input>`, so its first
baseline comes from the BOX, not from the words beside it. `baseline` was tried
there and measured **4.75px of centre error against 0**. The rows keep different
values for that reason and not from neglect.

**ส่งบัญชี's second row was level all along, and it took four reports to find
what was actually being seen.** The buttons and แสดงพนักงานที่ไม่มี OT sit in
`.action-row`, which is `align-items: center`, and the tick box's centre
measured **0.00px** from the buttons' centre — with the two texts' baselines
**0.45px** apart, checked past the box-centre measurement on 2026-08-28 with a
ruler drawn across the running app at 1440px, at every width from 1024 to 1920.
All true, and none of it was the complaint. One thing that WAS crooked: the two
buttons against each other, **ส่งออกไฟล์บัญชี 38.5px beside พิมพ์แบบฟอร์ม
40.5px**, because `.btn` was `border: none` and `.btn.ghost` adds a 1px rule
without taking the padding back — see §Verified for the base-rule fix and the
six containers that had each patched it locally first.

**What the eye was reading was the AIR, and that air is row 1's arithmetic, not
row 2's.** Row 1's left column (heading + hint) is 42.25px against its right
column's 66 — **23.75px** short — so with both ends of row 2 hanging from one
row bottom, the gap above the buttons measured **40.25px** against the tick
box's **22.75**. It cannot be evened out here: level means both sides hang from
the same line, so the air above them differs by exactly what the columns above
them differ by. Put a margin over each side to even the air and the buttons and
the tick go 23.75px out of level; end row 1's columns level instead and the
heading loses the baseline the paragraph above is about. **One 23.75px,
spendable once** — and it was already spent, on the heading.

**So the row changes what the eye compares.** The tick box takes the buttons'
height and a rule of its own — `align-self: stretch` plus `.btn.ghost`'s own
`--line` and `--radius-sm` — and row 2 becomes three boxes with one top edge and
one bottom edge instead of a band with something floating beside it. **Nothing
moves**: `.check` is already a flex container that centres its own contents, so
the tick and the words measure 202.25px before and after. Top, bottom and centre
against the buttons all read **0.00px**, and on a phone, where the row is a grid
and the tick box takes a line of its own at `min-height: 44px`, it now matches
the two buttons above it rather than sitting bare against the card's edge.
Pinned in `test/buttonBox.test.js`.

**The gap above that row was two numbers for one distance.** ส่งบัญชี carried
`style={{ marginTop: 12 }}` and แยกแผนก `14`, hand-set on two cards that are
otherwise card for card the same — which is how the second one sits 2px lower
than the first with nothing on the page saying why. It is `.action-row`'s own
`margin-top: 12px` now, `.row`'s own gap, so the two rows of the filter header
are spaced the way the controls inside each row are; both inline styles are
gone and `test/buttonBox.test.js` pins that neither card sets it again. With
that and the baseline above, the two filter cards measure the same height for
the first time: **201.75px** each at 1440px, against 197.75 and 199.75 before.

This section read "the row directly above the list … and the search box has to
stay the last thing before the first card, which is the whole reason that row is
where it is rather than in the card above" until later the same day. That is no
longer where the row is: it is back in the controls card, one line under
สถานะที่นับ and **above** the export buttons, so what it is last before is those
buttons rather than the list.

It also read "สถานะที่นับ did NOT come with it: it governs the three export
buttons beside it, and those act on what it sets". สถานะที่นับ still is not in
this row — it is on the heading line above it — but the reason given has gone
with the arrangement: the buttons are not beside it any more, they are two rows
below, and all three controls are above them. See
§"งวดกับช่องค้นหาขึ้นเหนือปุ่มส่งออก และถอดการ์ดที่ครอบรายชื่อ" below.

**The move gave back no height at all, and that was measured rather than
assumed.** The controls card went **385px → 308** and `.month-find` went **69 →
146**, and the first employee card did not move by a pixel — y=842 before and
after, page height 3727 both times. Controls cost what they cost wherever they
are put; vertical space on a phone comes from removing something, not from
rearranging it. Worth writing down because "group these and the list gets more
room" is a reasonable thing to expect and it is not true.

**What did give room was one sentence: 44px.** *ไฟล์ CSV บันทึกด้วย UTF-8 BOM
เปิดใน Excel ภาษาไทยได้ทันที* is gone from under the export buttons — the same
call สรุป OT ส่งบัญชี made for the same sentence, an encoding detail that
reassures once and is noise every month after. The export row went **150px →
107**, the controls card **385 → 265**, and the first employee card came up to
**y=798** with the page at 3683. The files still carry the BOM;
`src/lib/csv.js` is where that lives and nothing about them changed.

**And then the containers gave back 21 more.** Asked for as "reduce the
padding", after the paragraph above had established that moving controls gives
nothing. What a phone can give back without losing a control is the space
AROUND them, and on this screen three containers stack before the reader
reaches the list. Measured at 360px, first employee card **y=798 → 777**:

| | was | is |
|---|---|---|
| `.month-head` and `.month-card` padding | 15px | **12px** |
| the gap each leaves under itself | 16px | **13px** — 18 since later that day |
| the band’s own padding | 10 / 12 | **8 / 10** |
| the band’s bottom margin | 12px | **10px** |

Two of those four rows are history by the end of the same day and are kept
because the 21px is: the band’s own padding and its bottom margin went with the
card the band was in, and `.month-card` stopped being a card at all — it has no
padding to trim now, so the first row is `.month-head` alone. The 12px is still
12px where it survives.

**Only this screen.** `.card` is worn by every screen in the app and 15px is
still its phone padding everywhere else; what is different here is the three
containers. **And the breakpoint is 860, not the 768 that was asked for** —
this app has one mobile breakpoint and 860 is the design’s own number, written
at the top of the stylesheet. A second one at 768 would leave 768–860 with the
phone layout and the desktop padding, a band nobody would ever look at and
every future rule would have to remember.

**The band’s side margins are the card’s padding, negated.** They were a
literal `-15px` against a literal `15` — two figures in two rules that had to
agree, with nothing saying so, and the pair broke the moment the padding came
down. `--month-pad` was declared on both cards and the strip measured from it,
so there was one number. That whole paragraph is history as of later the same
day — see the section below, which took the band out of the card altogether and
left it with no margins to negate.

### ถอดกล่องการ์ดที่ครอบ ประจำเดือน กับช่องค้นหา — 2026-08-27

**Asked for as "take the card off the month picker and the search box and let
them sit on the page".** They were the first thing inside `.month-card`, which
then went on to hold the whole list — a card inside a card, and on a phone, where
the list is drawn as one card per person on the page’s own ground, that outer box
read as a dark frame wrapped round two controls for no reason a reader could
name.

**Everything the phone rule for `.month-find` carried existed to undo the card
it was in.** The negative side margins took the row out to the card’s edges, the
padding gave back what those margins had just taken, the `--bg` fill covered the
card’s colour and the hairline drew the boundary the fill implied. Out on the
page there is nothing to undo: `--bg` **is** the page, and the gap under the row
is a real gap. The rule is one declaration now — it read `margin-bottom: 10px`,
which it already had, until the row went into the controls card that afternoon
and the one declaration became `margin-top: 8px`, which is `.export-row`’s own
number. One declaration either way, and none of the four is back.

**And the list goes out to the card’s edges for the same reason.** The wrap
paints `--bg` and `.hr-table tbody` insets the cards inside it; with the card’s
own 12px of padding left in place, every card in the list was framed twice, in
two colours — a `--card` ring around a `--bg` ring around an object that is
already a card. The wrap takes the same negated `--month-pad` the band used to,
and pulls up by it as well **when it is the first thing in the card**, which is
every month that is not being searched. While ค้นหา is narrowing the list the
CSV note sits above the wrap and keeps its own gap.

**That paragraph and the one under it are history as of the same afternoon, and
the fix they describe is one level up now.** The card came off the list
entirely below 860px, so there is no second ground to escape and no
`--month-pad` to negate — the three rules and the token are gone. The doubled
ring is a real thing that happens whenever a `--bg` wrap goes inside a `--card`
box, which is why the paragraphs stay; the arithmetic is not what runs. See
§"งวดกับช่องค้นหาขึ้นเหนือปุ่มส่งออก และถอดการ์ดที่ครอบรายชื่อ" below.

**The ring is 24 at the sides and 12 at the ends, and the sides had to be said
out loud.** `.hr-table tbody` read `padding: 12px` for as long as the card
around it padded by another 12, and between them an employee card stood 24px in
from the card’s border on every side. Going full-bleed took **both** of those
12s off the left and right at once and left the card 13px from the outer
border: two borders that close together read as one crowded edge, and it was
reported the same day as the cards running into the edge of the screen. So the
sides read `24px` in that shorthand — the number they always came to — and the
ends stayed 12, which is the gap between two cards in this list. **The 24 at the
sides was ground; the 12 at the ends is rhythm.** At 360px an employee card ran
**37 → 323**, exactly where it ran before the wrap moved; the 12px the move gave
back vertically was untouched (first card still **y=746**).

**The whole shorthand is `padding: 0` since the card came off later the same
day.** There is no outer border left to be crowded against — what bounds the
list is the page’s own 12px, so an employee card runs to the same edges the
controls card above it does, and the ground the 24 was buying is the page. The
ends went with it: 12 at the top was the gap under the top of the card, and the
thing above the list is now งวด…ยังเปิดอยู่ with its own gap under it — it read
"13px" until later the same day and is 18 now; 12 at the
bottom was the gap over the foot of the card, and `.month-notes` and
วันเกิดของเดือนนี้ declare their own 12 above them. **The 12px between two cards
is `gap` and never moved** — ground went, rhythm stayed.

**Nothing on this screen is clipped, and that was measured before it was
believed.** The same report said the export buttons were being cut off at the
top by the header. On the built app at 320px, 360px and 1280px: no button’s
scroll height exceeds its client height (nothing is cut off inside a control),
the document’s scroll width equals its client width at every one of those widths
(nothing overflows sideways), and `main` starts at **y=62** — the app bar is
`position: sticky` and is *in flow*, so at rest nothing is under it. What **is**
true is that a sticky bar has content pass under it while the page scrolls,
which is what it is for.

**The bar that appears across the middle of a full-page screenshot is a capture
artifact.** CDP’s capture-beyond-viewport mode paints sticky and fixed elements
at their viewport position, so `.appbar` and `.mobile-nav` land in the middle of
a tall image over whatever happens to be there. Screenshot the **viewport** when
the question is "what does this look like"; keep the full-page one for
measuring. Two rounds of this screen’s reports have been that artifact.

**Measured on the built app at 360px, first employee card y=777 → 746** — 31px,
and every pixel is a container’s chrome rather than a control:

| | px |
|---|---|
| the card’s top padding, no longer above the row | 12 |
| the band’s own padding, 8 top and 10 bottom | 18 |
| the hairline under it | 1 |

Page height **3609**. The row keeps the same 10px under itself it had inside the
card, and the first card now sits **23px** below it — the 10, the card’s border
and the list’s own 12.

**It also fixed something nobody had reported.** Inside the card, the row was
inside the `data.employees.length === 0` branch, so a month with no entries drew
**ไม่มีรายการในเดือนนี้** and no month picker at all: the one control that takes
a reader out of an empty month was the control the empty month took away, and
the only way back was a reload. The row is outside that branch now and is drawn
whatever the month holds. `test/monthSearch.test.js` pins both.

**สถานะที่นับ and the export buttons stayed in their card.** They are a group
that acts together — the three buttons export what the select sets — and a card
is the right thing round a group. What was wrong was a card round the two
controls that belong to the list below them.

That last sentence is the half that did not survive the afternoon: the two
controls went back into that card, and what came off instead was the card round
the **list**. The reading it replaces is that ประจำเดือน, สถานะที่นับ and ค้นหา
are one group — they decide which figures exist and which are drawn — and the
buttons act on what all three settled. See the section below.

**ตรวจสอบรายเดือน บนมือถือ: หน้าละ 5 คน แล้วเลื่อนหน้าเว็บตามปกติ.** Below
860px this screen is one card per person — that is where **ดู / แก้ไขรายการ**
and **พิมพ์ F-HR-027** live, and it is why this table left the sideways-
scrolling group the two accounting ones stayed in. A card is about 150px tall
with two buttons in it, so a sixty-person month was roughly nine screens of
scrolling between the search box and **รวมทั้งหมด** — and everything the phone
layout deliberately moved *up* to the total card (วันเกิดของเดือนนี้, then the
footnotes) sat below all nine of them.

**Seven arrangements have answered that, over 2026-08-25 and 26**: a fold at
five, a fold at ten, ten-loaded-per-press, five to a page with a pager, a
fixed-height box with the list scrolling inside it, the box wrapped around the
pager, and the pager on the page with no box. The shipped one was the last —
nothing on this screen scrolls but the page itself — and since 2026-08-28 there
is an **eighth beside it rather than instead of it**: a fold at three, on the
months that have no pager. Which of the two a month gets is decided by
`pageCount` in one place, and **never both at once**.

```
┌─────────────────────────────────┐
│ ผู้ดูแลระบบ              3      │ ← five cards, and five is all the layout
│ [ ดู / แก้ไขรายการ ] [ พิมพ์ ]  │   holds: no max-height, no overflow-y
│ ฝ่ายบุคคล              2.5      │
└─────────────────────────────────┘
   [‹]      หน้า 1 / 5       [›]      ← the pager, on months of MORE than five
        แสดง 1–5 จาก 25 รายการ          one 56px band, ends disabled
                                        (a month that fits shows three cards
                                         and [ ดูพนักงานทั้งหมด (4 ราย) ] here)
┌─────────────────────────────────┐
│ รวมทั้งหมด            75.5      │ ← under the pager, static, in the flow
└─────────────────────────────────┘
                                        (วันเกิดของเดือนนี้ closed this screen
                                         until 2026-09-03 — see below)
```

**The page bounds the distance, and nothing bounds the height.** Five cards, the
pager and the total are a length a phone scrolls in one gesture, so there is no
second scrollbar anywhere on the screen — `.hr-table tbody` is a plain flex
column and `.table-wrap.card-list` is `overflow: visible`, which it has to be
because `overflow-x: auto` at every other width computes `overflow-y` to `auto`
as well. The cost of paging at all is written down over `CARD_PAGE` in
[`components/HrView.jsx`](components/HrView.jsx).

**The order is cards → pager → total.** The pager belongs to the cards, not to
what follows them: *แสดง 6–10 จาก 57 รายการ* is a sentence about the five
immediately above it, and a month's total read in between breaks that sentence
in half. It sat *below* the total for a few hours on 2026-08-25, under a total
that was `position: sticky` and therefore made the pager the one row of the list
that could never share a screen with the figure.

It read *"cards → pager → total → วันเกิดของเดือนนี้"* until **2026-09-03**. That
last section — every birthday in the month, with the two buttons that settled
one — was the only thing on this screen that was WORK rather than a figure, and
several of the rounds recorded below are about getting a reader to it. It was
withdrawn with the rest of ฝ่ายบุคคล's birthday work; the footnotes end the card
now, and the phone's `order` swap that used to lift the birthdays over them went
with it. **Every dated round below that argues about where วันเกิดของเดือนนี้ sat,
what its card measured or how its fold was worded is a record of a screen that no
longer exists** — kept because the reasoning is about this card and this phone,
and would have to be had again by anyone adding a section here.

**The pager is drawn only when there is more than one page**, and this condition
has now existed, been removed, and come back — so both arguments are here.

*Removed on 2026-08-26:* it was `{shown.length > CARD_PAGE && …}`, so the live
four-person August had no pager at all — the foot of the list was a different
shape depending on how many people filed OT, and *แสดง 1–4 จาก 4 รายการ*, the one
line that says how long the list is, was missing from exactly the months short
enough to doubt.

*Back on 2026-08-28, as `{pageCount > 1 && …}`,* after the band was reported
twice in one day as something that should not be on the screen — first as grey
shapes crossing under the header, then, once the disabled chevrons had been
quietened, by name: *"Element ส่วนเกิน … หลุดขึ้นไปโผล่ใต้ Header … ลบส่วนเกินนี้
ออก"*, naming the count line and the buttons together. On a month that fits, the
band is a control that can do nothing — `current <= 1` and `current >= pageCount`
are both true — sitting above a sentence about a list the reader has already
scrolled past. **Twice reported as debris is the answer to whether it reads as a
statement about the month.**

**And the count is not lost with it**, which is what the old reasoning was
protecting: the export button at the top of the screen says *พิมพ์ใบขออนุมัติ OT
ทุกคน (4 คน)* (it read *พิมพ์ F-HR-027 ทุกคน (4 คน)* when this was decided on
2026-08-28; the count is the half that matters here and it did not change),
every card is on screen when there is one page, and the line comes back
the moment there is a second — which is exactly when a reader cannot see the whole
list. `pageCount` still has a floor of 1, so a month never says *หน้า 1 / 0*.
What it costs is still the foot's shape: ≤5 people reads card · total, more than
five reads card · pager · total.

**And a disabled end is an outline, not a slab** — since 2026-08-28, and the
reason is in §"เศษสีเทาที่ขอบ Top Bar" below. The app-wide `.btn:disabled` fills
with `--neutral-wash`, which is right for the buttons it was written for and
backwards for a `.btn ghost` whose live state is a transparent ground: on a
one-page month it made the two dead chevrons the most filled objects in the
band. They now keep the ghost's ground, a `--line` ring and a `--muted-2` glyph
— the same "a disabled control is quieter than a live one" this app states
elsewhere, and still not a fade.

**The pager is one band 56px tall, and it was two full rows and 73px** until
2026-08-26. The old shape put *แสดง 6–10 จาก 57 รายการ* across the full width of
the card on a line of its own, and under it two "106×44" buttons wearing
**‹ ก่อนหน้า** and **ถัดไป ›** with the page number between them. Nothing in it
was wrong. It was the tallest thing between the fifth card and **รวมทั้งหมด**,
on the one screen where the ground under the list is already spoken for, and it
was asked to be made compact.

**Both sentences survived; the buttons' own row did not.** *หน้า 2 / 5* sits
between two 38px squares carrying `‹` and `›`, and *แสดง 6–10 จาก 24 รายการ*
spans underneath them, a step quieter at 11.5px and `--muted-2`. The words went
onto `aria-label` — and `title`, for a desktop pointer — so a screen reader is
told **ก่อนหน้า** and **ถัดไป** exactly as before; the chevrons are the button's
*look*, not its name, which is why neither is `aria-hidden`.

**It was 38px for a few hours, and the buttons were 8.8px low.** The range was
the second line of a middle *column* rather than a row of its own, which is 18px
shorter and puts each chevron below the words it reads as being beside:
`align-items: center` centres a 38px square on a 37px two-line block, so the
square and the block shared a centre line while the button and *หน้า 2 / 5* did
not. Grid centring is honest there and the eye is not. Reported, measured at
**8.8px**, and rebuilt as two grid **rows** — `grid-template-areas` with the
buttons on the page number's row — which measures **0.0px** on both buttons and
costs 18 of the 35.

**38 and not 44 is a real trade.** Every other button on this card keeps the
44px target and these two give up 6px of it. What buys that back: a chevron has
no label to be missed by, the two sit 10px apart with the page number between
them rather than shoulder to shoulder, and neither is destructive — a mis-press
goes one page the wrong way and the button beside it undoes that.

**The three tracks are centred rather than pushed apart.** `.pager-controls` was
`1fr auto 1fr`, which pinned the buttons to the two ENDS of the card — the
layout of a wide table's footer, and the opposite of compact. It is
`auto minmax(0, auto) auto` under `justify-content: center` now, so the group
takes the width it needs; the two buttons stay the same distance from the middle
whatever the page number comes to, because both of them are the same square.

**The range spans all three columns, so the longest month stays on one line.**
*แสดง 116–120 จาก 120 รายการ* — the longest a sixty-person month can make it —
is about 150px against the 240 the card has at 320px. Confined to the middle
column it had about 144 and wrapped; across the whole band it does not, at any
width the app is used at. `text-wrap: balance` stays for the day that stops
being true: it splits a wrapped line down the middle rather than at its last
space, which is what left รายการ alone on a line. Measured by putting that exact
string into the live element at 320 and 360 — one line at both, and
`scrollWidth - clientWidth` is 0. Nothing in the seed data reaches it: the live
August is four people.

**รวมทั้งหมด lost 8px with it** — `padding: 11px 15px` where a person's card
takes 15 all round, so the row is 46px instead of "54". The horizontal 15 is not
free and stays: the total has to start on the same left edge as the names above
it and end on the same right edge as their figures, or the column the eye reads
down bends at the last row. The vertical 15 was buying nothing, because this row
has one line in it where a person's has three.

**The box this replaced, twice.** The list has been a scrollport twice —
`.hr-table tbody` at "max-height: 42dvh" (it read "58dvh" and "44dvh" earlier),
"min-height: 260px", "overflow-y: auto" and "overscroll-behavior: contain", with
the pager inside it and รวมทั้งหมด "position: sticky; bottom: 0" as its floor.
It was taken out on the morning of 2026-08-26, brought back that afternoon, and
taken out again the same afternoon. **Both directions are answers to real
measurements and they are not the same measurement**, which is why this keeps
moving:

- *For the box:* it kept the card's height fixed, so วันเกิดของเดือนนี้ sat
  "12px" under the list whatever the month held, and pressing **ถัดไป** left it
  exactly where it was.
- *Against it:* a scrollbar inside a page that also scrolls, two ways to reach
  the ninth person with nothing to say which was meant, and two scroll positions
  out of the nineteen probed where the sticky total lay across the middle of the
  pager buttons.

Without it the distance under the total varies by a line of name — one card's
worth at most — and never by the size of the month. A change here is a choice
between those two lists, not an improvement over nothing; the same note is over
`CARD_PAGE` in [`components/HrView.jsx`](components/HrView.jsx).

**Since 2026-08-26 the card itself is a fixed 170px** and that variance is
nearly gone with it: the ceiling column is a 108px track rather than `auto`, so
the sentence under the figure can no longer squeeze the name into three lines,
and `.cap-sub` holds two lines open whether or not there is a sentence to put
in them. What is left is a name long enough to run to three lines at 128px,
which no name in the roster does today. Measured at 360px before and after:
139 / 161 / 139 / 183, then 170 / 170 / 170 / 170.

### งวดกับช่องค้นหาขึ้นเหนือปุ่มส่งออก และถอดการ์ดที่ครอบรายชื่อ — 2026-08-27

**Two changes asked for together, and they are the same change seen from two
ends: fewer things between the reader and the month.**

**1 — ประจำเดือน and ค้นหา are now the second row of the controls card, above
พิมพ์ / ส่งออก.** Asked for as setting the งวด before the buttons that print it.
The card reads top to bottom as a sentence now:

| row | what it settles |
|---|---|
| ตรวจสอบรายเดือน + สถานะที่นับ | which statuses count |
| ประจำเดือน + ค้นหา + *แสดง n จาก m คน* | which month, and which of it is drawn |
| พิมพ์ใบขออนุมัติ OT ทุกคน + the two CSVs | what to do with what the first two settled |

It read the other way round for the rest of that day — three export buttons,
then งวด…ยังเปิดอยู่, and only then the box saying which month any of it is
about — which is a forty-page document offered before its period has been named.

**What is given up, said plainly: ค้นหา is no longer the last thing before the
first card.** That was the rule the morning's move was made under, and
`.export-row` and งวด…ยังเปิดอยู่ now stand between the box and the list it
narrows. Two things pay for it. The count — *"แสดง 3 จาก 24 คน"* — is inside
that row, beside the box, so a narrowed list says so where the narrowing was
done and not only where it landed. And the suggestion list is untouched: picking
a name still jumps straight to that person's row, which is the path that never
travels the distance at all.

**สถานะที่นับ stayed on the heading line** rather than joining the row. Three
controls on a line that already holds a heading is three widths to reconcile on
a desktop and a stack of three on a phone; two is a row.

**2 — the card round the list is gone below 860px.** Asked for as *"ถอด
Background Card ที่ครอบกลุ่มรายชื่อพนักงานออก ปล่อยให้การ์ดพนักงานแต่ละคนวางลงบน
Background หลักโดยตรง"*. On a phone this screen is one card per person on the
page's own ground — and all forty of them were inside a forty-first card, which
the eye has to account for before it can read any of them, and which put its own
border between the last row and the edge of the screen at exactly the point
somebody is looking for **รวมทั้งหมด**.

What comes off: the fill, the border, the radius, the 12px of padding and the
16px a card leaves under itself. What goes with it, because all of it existed to
undo the card: the wrap's negative side margins, its `:first-child` pull-up, the
`--month-pad` token, and `.hr-table tbody`'s `12px 24px` ring, which is
`padding: 0` now. **An employee card ran 37 → 323 at 360px and now runs
12 → 348** — the same left and right edges `.month-head` and งวด…ยังเปิดอยู่
stand on, which is what makes four objects read as one column instead of a card,
a bar and a list indented from both. วันเกิดของเดือนนี้ comes out to that edge
too, and it took three rules rather than one, because three paddings and a
border were between that section and the page. `.box` insets prose 15px and
carries a transparent `1px` border for variants that colour it; `.bmonth-table`'s
own tbody added 12 at the sides; and `table.mini` — the hairline round a small
ruled table, which is what that element is above 860px — drew a frame round the
whole column of cards.

**The last of those is the one worth writing down.** It was found by measuring
and not by looking: a birthday card stood **13..347** where an employee card
stood **12..348**, and the pixel each side was that border. The first rule
written for it, `.bmonth-table { border: none }`, shipped, was correct, and
changed nothing — `table.mini` is an element AND a class, so a bare class loses
to it wherever in the file it sits. `table.bmonth-table` is what wins. A rule
being in the bundle is not a rule that runs.

**`scroll-margin-top` is 86px, not 74.** The pager's landing has always said the
same sentence — the app bar's 62 plus 24 of air over the first card — and 74 was
enough only while the tbody's 12px of top padding sat inside the distance.

**Above 860px nothing moved.** The element still wears `card` and up there it
still is one: the desktop list is a table of eleven columns read down its own
header row, and a table needs a ground to be read against. One markup, two
layouts — the rule `.hr-table` itself has followed since the card list was
written. Both halves are pinned in `test/hrMonthCards.test.js`,
`test/monthSearch.test.js` and “test/birthdayCardUi.test.js” (ลบแล้ว 2026-09-03); the flatten test
asserts all four declarations, because a border with no fill is still a frame,
and the birthday one asserts the element is in the selector.

**Measured on the built app at 360px, admin, สิงหาคม 2569**: page height
**3609 → 3485**, the document's scroll width equal to its client width
throughout, employee cards and birthday cards both **12..348**, and the desktop
at 1280px unchanged.

### ช่องไฟรอบตัวคั่น และการ์ดวันเกิดที่กระชับลงหนึ่งในสาม — 2026-08-27

**Three asks in one message, all about the same axis: how far a thumb has to
travel down ตรวจสอบรายเดือน on a phone.** Page height at 360px, admin,
สิงหาคม 2569: **3485 → 3131**, with the desktop at 1280px unchanged to the pixel
(page height 1650 both sides, every box in the same place).

**1 — the pager and รวมทั้งหมด stand out of the list's own rhythm.** Asked for
as the two of them being *"ชิดการ์ดพนักงานเกินไป"*. They were, and the number
says why: the gap was exactly **12px**, which is the `gap` between one employee
card and the next, so a control and a month's total were spaced into the list at
the list's own pitch and read as the sixth and seventh people on the page.
Taking their border and fill off — done the day before — had stopped them
*looking* like cards; nothing had stopped them *sitting* like cards.

`.pager-row` takes `margin: 6px 0`, and because `.hr-table tbody` is a flex
column that **adds** to the 12px `gap` rather than collapsing with it, both gaps
come out at **18**. The total states no margin of its own on purpose: the
pager's bottom margin is the gap over รวมทั้งหมด, written once, and what follows
the total already declares its own 12.

*This is the state it was left in on 2026-08-27.* The margin read "6px" and the
gaps "18" until the same joint was asked about again the next day; both are 12
and 24 now — see §"วันเกิด แผนก บริษัท มาอยู่บรรทัดเดียว" below for what 18 was
missing. The shorthand is `12px 0 0` — **top only** — since the pager stopped
being drawn on a month that fits, and รวมทั้งหมด states its own `margin-top: 12px`
now: a gap hung on an element that is sometimes absent is sometimes absent, and
"the total states no margin of its own" was true only while the pager was
unconditional. The rest of this paragraph still holds.

**2 — the birthday card is about a third shorter.** Asked for as *"ปรับ Layout
ส่วนรายชื่อวันเกิดพนักงานให้กระชับขึ้น … เพื่อประหยัดพื้นที่ Vertical Space
บนมือถือ"*, with a horizontal carousel offered as one way and a smaller card as
the other. **The carousel was turned down**, on the one ground that decides it:
this section is the last thing that has to be *answered* before a month can be
closed, and a list where five of six people are off the right-hand edge is a list
somebody can finish without having seen them. Nothing is hidden; the same rows
are drawn in the same order, each shorter. A มีใบแล้ว card at 360px: **297 →
211**, and the section as a whole **1772 → 1396**.

| where it went | |
|---|---|
| **−35** | `padding: 0` on the cells, which had never once applied — see below |
| **−24** | บริษัท and ชั่วโมง on one line, in the second track the chip already uses — and แผนก joined them later the same day, see below |
| **−12** | the card's own padding, 15 → 12 |
| **−10** | `gap`, 4 → 3, over five rows |
| **−8** | the rule over วันเกิด, 8 + 8 → 6 + 6 |
| **−8** | the labelled lines' padding, 2 → 1 at each end, and 1.5 → 1.45 of leading |
| **−4** | the rule over the buttons, 10 + 10 → 8 + 8 |

**วันเกิด is not paired with anything, and that is a rule and not an oversight.**
It carries `white-space: nowrap` from the component, so it has no wrap to fall
back on: the longest date this app draws — *13 สิงหาคม 2569 วันพฤหัสบดี* — is
most of a 312px card on its own, and a pair that fits in August and overflows in
November would push the page sideways nine months a year. The three labelled
cells all wrap; บริษัท and ชั่วโมง are the two that stay short in every month.

*The rule held for as long as the date was long.* On 2026-08-28 the phone card
took the short date form and `dayAbbr` instead — 185px of date became 87 — and
all three facts went onto one line; the `nowrap` and the reasoning above are
still exactly why the SHORT form was the thing that had to change. **The short
form no longer exists** — on 2026-09-04 every date became `19/09/2569`, which is
the same width the short one was, so the measurement below still stands and the
function it named does not. The labels
*วันเกิด* and *บริษัท* are gone from the card with it. See the section below.

**Two things were deliberately not taken.** The buttons keep `min-height: 44px`
— they are the decision the section exists to collect, and a target that shrinks
with the card is a target that gets missed — and the employee code stays on its
own line under the name, because that line is what makes this card and
วันเกิดรอตรวจ's the same object, and it was put back there on purpose the day
before.

*Both were taken later.* The code went onto the name's line the same day (see
the section after next), and the buttons came down to **40px** on 2026-08-28
when the ask named them directly and the card had nothing else to give — with
what that trades written out beside the rule. The reasoning above is still why
it was the LAST thing to go rather than the first.

**So the two screens are no longer the same density, and that is the price.**
วันเกิดรอตรวจ keeps the 15px card: it *is* a screen, the cards are the only thing
on it, and nothing above them competes for the scroll. Here the same rows are a
section reached after five employee cards, a pager and a month's total. Same
rows, same order, same cells, two densities — and the density is a property of
what is above the list, not of the list.

**`padding: 0` on those cells had never applied, and the card had been 35px
taller than its arithmetic since it was written.** `table.mini th, table.mini td
{ padding: 7px 10px; }` is two elements and a class; `.bmonth-table td` was one
class and one element and lost to it. Every cell carried 7px above and below and
10px in from the side — and the 10 only bit the cells *without* padding of their
own, which is why แผนก sat ten pixels to the right of วันเกิด under it, in the
column that had just been squared up to the page's edge. `table.bmonth-table td`
is what wins. **This is the second time this exact trap has been sprung on this
one element** — the first was `table.mini`'s border, three paragraphs up in the
section before this one — and both times the rule was in the bundle, was correct,
and did nothing. It was found by measuring the cells of a card that had just been
compacted and still came out taller than the sum of its parts.

`.bday-table` is not `mini` and never had this, which is why วันเกิดรอตรวจ needs
no such rule and must not be given one for symmetry.

**3 — งวด…ยังเปิดอยู่ stands 18px clear on both sides.** Asked for as *"เพิ่ม
Margin-bottom ให้การ์ด งวด สิงหาคม 2569 ยังเปิดอยู่ เล็กน้อย เพื่อแยกสัดส่วน
ระหว่าง Action Panel ด้านบน กับ Status Card ให้ชัดเจนยิ่งขึ้น"* — a property named
on one side of the card and a reason named on the other, and one number answers
both, because both gaps are the same rule. Three blocks stacked at an identical
13px was a column with no joints in it; the list under them keeps its own 12px
`gap`, so the column now reads **18 · 18 · 12 · 12 · 12** and the joint is where
the reader's eye was already trying to put one. It is 5px against the trim
recorded two sections up, and that trim was buying room for a list, not for the
boundary above it — the other two changes on this page gave back about 350px the
same afternoon.

**And the card round the employee list was already off.** The first line of the
ask repeated it; it had shipped hours earlier and is the section above. Measured
again here rather than taken on trust: an employee card runs **12 → 348** at
360px, the same edges the controls card and งวด…ยังเปิดอยู่ stand on, with no
container between the list and the page.

Pinned in `test/hrMonthCards.test.js` (the pager's margins, and that the tbody is
still a flex column so they add), `test/monthSearch.test.js` (the 18) and
“test/birthdayCardUi.test.js” (ลบแล้ว 2026-09-03) (the pairing, the `nowrap` that forbids the other
one, and the element in the selector). Verified on a built app on a scratch
`distDir` at :3001 with :3000 left serving, per AGENTS.md.

### กล่องแนะนำเป็นชั้นลอยจริง และกล่องสุดท้ายรอบรายชื่อหายไป — 2026-08-27

**Three details, and the middle one is the reason to write this section down: a
container that had survived two rounds of "remove the card" because its fill was
the page's own colour.**

**1 — the suggestion panel is a surface of its own.** Asked for as making the
autocomplete read as a floating layer that does not swallow the controls under
it. The report was right about a real thing, and the cause is one line:
`.pick-menu` was `background: var(--card)` and on this screen it opens **inside
a `--card` box**. Two identical fills, separated by a `--line` hairline and a
shadow that on the dark theme is black at a third opacity over a page that is
already nearly black. What HR was looking at was the controls card apparently
growing downwards and eating the export buttons.

| | was | is |
|---|---|---|
| fill | `--card` | **`--card-lift`** |
| edge | `--line` | **`--line-lift`** |
| shadow | `0 14px 34px` | **`0 2px 8px -2px`, then `0 14px 34px`** |
| phone cap | `min(264px, 46vh)` | **`min(240px, 40vh)`** |

**`--card-lift` is the same white as `--card` on the light theme and one step
UP on the dark, and that asymmetry is the token's whole content.** A light theme
separates two stacked surfaces with a shadow — the panel stays white and the
page darkens under it, which is what light falling on paper does. A dark theme
cannot: a shadow is black on a page that is already black, and this file already
paid to learn it. `.dept-menu` ran `--shadow-1` for a round and the note over it
records the result — it *"lifted the panel but put a dark band across the field
underneath it"*. What a dark theme separates with is **light**: the nearer
surface is the paler one. `--card` over `--bg` is the first step; this is the
second, for things that float over a card rather than over the page. On the
light side it must **not** be a grey — a panel a shade darker than the white card
under it reads as disabled, and the depth would point the wrong way.

**The tight shadow is the edge, not the lift.** 34px of blur says "floating" and
says nothing about where the panel *stops*, which is what a half-covered button
at its bottom edge needs. `0 2px 8px -2px`, pulled in 2 so it cannot leak out at
the sides of a panel that is the full width of its field — and still
`--shadow-soft` on both, because the tone was the half that was already right.

**What the cap does not do, said plainly:** it does not stop the panel covering
the export buttons. Nothing can — the list opens under the box it belongs to and
the buttons are what is under that box. What it changes is how much goes at
once, and the `vh` half is for the keyboard: this box is typed into, so the panel
is tallest exactly when the viewport is shortest. On a 360×780 phone with the
keyboard up the visible page is nearer 400px, where 46vh was 184 and 40vh is 160.

**2 — the last container around the list is gone, and it was `.table-wrap`.**
Asked for a third time — *"Remove Outer Card Background ที่ล้อมรอบกลุ่มรายชื่อ
พนักงานและส่วน Pagination ออกทั้งหมด … แบบ 100%"* — and this time it was found by
walking the ancestors of an employee card on the built app, `tr` up to `body`,
asking each one whether it paints anything:

```
DRAWS  tr                      the employee card itself
       tbody                   —
       table.hr-table          —
DRAWS  div.table-wrap.card-list  background var(--bg), border-radius 14px   ← this
       div.card.month-card     —   (the card taken off earlier that day)
       div.page                —
       main                    —
       div.body                —
DRAWS  div.shell               the page
```

**A filled, rounded box around exactly the group that was named** — the five
cards, the pager and รวมทั้งหมด, and nothing else on the screen. It has been
invisible for one reason: its fill is the page's own colour. That is also why it
survived two rounds of looking at the screen, and why it took a measurement to
find. Same class of thing as the strip and the negative margins before it —
chrome that existed to undo a card, still in the file after the card.

**`background: none`, not deleting the rule it overrides.** That shorthand is
doing two jobs: `.table-wrap` paints four scroll-hint gradients at this width,
two `--card` covers and two shadows that promise more table to the right, and the
`--bg` was covering them. `none` clears image and colour in one word. **And the
14px radius goes with it** — `overflow` is `visible` here so it has never drawn a
pixel, but a card's radius on a card's fill is how a container that is supposed
to be gone waits in the file for the day the page ground changes colour.

**Scoped to `.month-card`, which is the point.** วันเกิดรอตรวจ's list wears the
same two classes and sits inside a real `<div className="card flush">`, where the
`--bg` *is* the ground and without it the 12px between two cards is 12px of the
card's own colour. Same markup, two grounds. After this the chain from an
employee card to the page paints nothing at all — re-walked on the built app, and
that is the assertion, not the appearance.

**3 — ไม่พบข้อมูลพนักงานที่ค้นหา takes 56px top and bottom**, up from the app-wide
40. `.empty` is 40px everywhere else and is right everywhere else, because it is
drawn *inside* something and a frame is what says where the middle is. On this
screen there is no frame any more: the message and its ล้างการค้นหา button sit on
the page between งวด…ยังเปิดอยู่ and วันเกิดของเดือนนี้, and 40 is the padding of
a box that is not there. The card above contributes 18 and what follows
contributes 12, so the visible air is **74 above and 68 below** — not equal, and
not makeable equal from one rule when one of the two neighbours is not always
drawn. The sides stay at 20: the line carries a quoted search term and has to
wrap somewhere sensible in 336px.

Pinned in `test/approverMultiDepartment.test.js`, which owns `.pick-menu` — the
two shadows, the two tokens, and that the panel has not gone back to
`--shadow-1`. That last assertion was written wrong twice and both ways are
recorded beside it: an unanchored lazy match reported `.modal`'s shadow as this
panel's, and once anchored it caught **the comment written to justify it**, which
is the seventh time in this project a test has matched its own prose.

### แผนก เข้าแถวเดียวกับ บริษัท และ ชั่วโมง — 2026-08-27, และกล่องรอบรายชื่อที่ไม่มีอยู่

**Two things asked for together, and only one of them was there to do.**

**The birthday card loses its last spare line.** After the first compaction the
card was five rows of one fact each, and three of those rows — แผนก, บริษัท,
ชั่วโมง — used less than half the width between them. A third grid track puts
all three on one line: `auto minmax(0, 1fr) auto`, so แผนก sizes itself on the
left, บริษัท takes what is left in the middle, and ชั่วโมง lands in the same
right-hand track the status chip already occupies — the figure reads down the
card's right edge under the status it belongs with.

| | first compaction | second | third |
|---|---|---|---|
| a มีใบแล้ว card at 360px | 211px | 185px | **172px** |
| a card with no hours | 167px | 145px | **132px** |
| the whole section | 1396px | 1249px | **1166px** |
| the page | 3131px | 2984px | **2901px** |

**The third round took the last two things that were not a touch target or a
type size.** The card's own padding, 12 → **10** — the employee cards above keep
15 and should, they are the screen's subject and each one is a decision to open.
And the employee code went back onto the name's line, which is a **reversal**
recorded as one: it was inlined here once, put back on its own line earlier the
same day to keep this card identical to วันเกิดรอตรวจ's, and inlined again once
that symmetry had already been traded away two paragraphs up in the same
stylesheet. Keeping one line of a symmetry after the symmetry itself is gone is
keeping the cost without the thing it bought.

**What that costs is a column**, and it is worth saying: codes on their own line
all start at the same x and the eye can run down them; after a Thai name of any
length they start wherever the name ends. Affordable on a card that holds at most
one person per birthday in the month and is never scanned by code —
วันเกิดรอตรวจ, where somebody might, keeps its column, and a test pins that
asymmetry in both directions.

**It saved 11px and not 16**, because the status chip is 25px tall and the name's
row cannot be shorter than the chip standing in it. That is the floor, and it is
why this is the last round of this kind: what is left is 44px of button, 25px of
chip row, three lines of facts and 20px of padding. **The remaining lever is the
number of cards, not the card** — which is the round below.

**The `gap` between cards did not move and that is deliberate.** 12px is what the
employee list keeps between its own cards; two columns of cards read down one
screen whose rhythms differ by two pixels is a difference that says nothing. What
came down to 10 is the tbody's ENDS — the gap under the summary lines and the gap
over the footnotes — which are boundaries, not beats.

**แผนก keeps its voice and loses its row.** It is the only fact on this card
drawn as bare grey text — no label, as on วันเกิดรอตรวจ — and moving it into a
row with two labelled facts does not make it one of them. What it gains is a
**6px joint on its right**, which is not padding: the grid `gap` is one number
for the whole card and 8px of it between แผนก and บริษัท's label reads as a word
space, so *"วิศวกรรม บริษัท"* comes out looking like one phrase in a script that
sets no spaces between words anyway. 14px is where the eye stops joining them.

**The track sizes are the risk and they were measured, not reasoned.** Three
rows span all three tracks — the name, the status sentence and วันเกิด — and a
spanning item's width is distributed across the tracks it covers, so a long
วันเกิด (which is `nowrap` and cannot give way) can in principle inflate the
`auto` track แผนก sits in. Walked on the built app at **320, 360 and 430px**:
the row stays one line and `scrollWidth` equals `clientWidth` at all three. At
320px the longest department on the roster — ควบคุมคุณภาพ — does push บริษัท
into a second line inside its own cell, and that card comes out 163px instead of
145. **That is the designed give**: `minmax(0, 1fr)` is what pays, the card grows
one line, and the page never grows sideways.

**The rule over the buttons is 6 + 6**, matching the one over วันเกิด. It was 10
+ 10, then 8 + 8, and now the card has two rules of one weight rather than two of
two.

#### ดูรายการที่ตรวจสอบแล้ว (n รายการ) — the rows that ask nothing are folded

**Asked a fifth time, and the card had run out of room to give.** Two mechanisms
were named again: วันเกิด / แผนก / บริษัท and the buttons on one horizontal
strip, or a horizontal scroll. **The strip does not fit, and that was measured
rather than argued.** A card at 360px is **316px** wide inside its own padding.
The natural width of the pieces that were to go on it:

| row | date | + แผนก | + บริษัท | + buttons | = |
|---|---|---|---|---|---|
| a settled row, no button | 130 | 80 | 63 | 0 | **297** |
| the longest settled row | 130 | 114 | 68 | 0 | **336** |
| one button (ดูใบ) | 130 | 81 | 63 | 49 | **355** |
| **ต้องตรวจ — two buttons** | 130 | 82 | 63 | 316 | **592–623** |

It is short even on the row with no button at all, and short by a factor of two
on the ต้องตรวจ rows — the ones this section exists for. Nothing about that
changes with a tidier layout; 316px is 316px.

**So the lever is the number of cards.** Every row that is not ต้องตรวจ gets a
`settled` class and is hidden below 860px behind one full-width button that says
how many are behind it. A six-birthday August draws **three** cards instead of
six: the section goes **1166 → 748px** and the page **2901 → 2483** — more than
the four rounds of card compaction before it managed between them. Opening it
puts all six back and adds only the button's own 54px.

**Why this and not the carousel, at the fifth time of asking.** Both hide rows;
they differ in *which*. A carousel hides whatever is off the right edge, and on a
list sorted by date that is as likely to be a ต้องตรวจ row as a settled one — on
the last screen standing between HR and closing the month, **a row that asks
something and is not visible is the one failure this section was built to
prevent**. The fold hides only rows that ask nothing, the count is on the button
in both states, and nothing that needs answering ever leaves the screen. The
class is written as an exception — `status === DUE ? undefined : 'settled'` —
rather than by listing the other four statuses, so a status added later is folded
by default and can never become a row that asks something off screen.

**ยังไม่ถึงวัน folds with the settled ones.** A date that has not arrived asks
nothing today either, and the summary line above still counts it separately, so
the number is never lost.

**Closed by default, and it does not persist.** A month is worked in one sitting;
carrying "I opened the settled list once" into the next month would be a setting
nobody set. **Above 860px nothing happens at all**: the button is `display: none`
and the rule that hides the rows lives in the phone block, so the desktop table
still draws every row of the month — one markup, two layouts, which is the rule
this screen has kept throughout. Measured at 1280px before and after: page 1650,
section 516, every birthday row 54 or 75px.

**The label was reworded on 2026-08-28, and it is chosen from the rows rather
than written into the button.** It read *"ดูอีก 3 คนที่ไม่ต้องตอบตอนนี้"* and was
asked to become *"ดูรายการที่ตรวจสอบแล้ว (3 รายการ)"* — a more formal HR
register, and the better wording. **It is not true of every month.** What this
fold hides is every row that is not ต้องตรวจ, and that set includes ยังไม่ถึงวัน:
a birthday later this month that nobody has checked and nobody *can*, because the
date has not arrived and there is no scan record to check against yet. The
summary two lines above counts exactly those as รอถึงวัน, so a button calling
them ตรวจสอบแล้ว would have the screen contradicting itself on the last stop
before a month is closed.

So the asked-for wording is used wherever it is true — most months, and every
month once its last birthday has passed — and *"ดูรายการที่ไม่ต้องดำเนินการ
(n รายการ)"*, the same register and true of both halves, when the fold is holding
a date that has not come round yet. The test is “SETTLED_STATUSES” from
“lib/birthdayCheck.js” (ลบแล้ว 2026-09-03) — the app's own list of "nothing
left to do about this birthday", which is FILED, ABSENT and HOLIDAY and not
UPCOMING — rather than a `!== UPCOMING` written here, so a status added later is
not silently described as checked by a label written before it existed. **The
count stays in both states and in both wordings**, which is the property this
fold has had from the start.

Walked on the built app at 320, 360 and 431px against a clone of the live
database with one birthday moved to a Monday still ahead: closed and open, both
wordings, each on one line. *(Moved to a **Monday** on purpose — the first
attempt put it on the 30th, which is a Sunday, and HOLIDAY outranks UPCOMING, so
the row came back settled and proved nothing.)*

#### …and the card around the employee list was not there to remove

The other half of the same request — *"ถอดกรอบ Background Card สีดำล้อมรอบ
รายการพนักงาน (สมชาย, ถาวร, สุจินดา), ปุ่ม Pagination และกล่องสรุปยอด 34.5"* —
had already shipped twice, and this time it was checked a third way rather than
answered a third time. An ancestor walk only finds a container that is an
*ancestor*; a sibling painting behind the list would not appear in one. So the
gaps themselves were sampled — the browser's own hit-test, at four x positions in
the 12px between two employee cards, in the "18px" between the pager and
รวมทั้งหมด — 24 since 2026-08-28 — and in the 12px between two birthday cards,
each walked up to whatever actually paints there.

**All twelve points answer the same element: `div.shell`, `rgb(16, 21, 19)`** —
the page. The employee list, the pager, the total and the birthday cards below
them are all standing on the one ground, and there is nothing between them and
it. The names on screen during that check were วิชัย, สุรชัย, **สมชาย**, ถาวร
and สุจินดา, so it was run against the same สถานะที่นับ the report was written
from.

**Which leaves the browser.** A page loaded before a deploy keeps the stylesheet
it loaded with, and this app's chunk names are content-hashed — so a tab that was
open across the 14:40 or 15:19 deploy is still being served the old CSS by its
own cache until it is reloaded. Both halves of this request describe the app as
it was before those two deploys. There is no scheduled task and no service
worker on this box to push a new bundle at an open tab; a hard reload is the
whole of it.

### วันเกิด แผนก บริษัท มาอยู่บรรทัดเดียว — และช่องไฟใต้การ์ดใบสุดท้าย — 2026-08-28

**Two asks, both about ตรวจสอบรายเดือน on a phone, and the sixth round on this
one card.** Measured on the built app at 360px on a scratch `distDir` at :3001,
with :3000 untouched; the desktop at 1280px does not move by a pixel — page
height, section height and every birthday row (54 or 75px) are the same before
and after.

**1 — วันเกิด / แผนก / บริษัท share one line, and the buttons still do not.**
Asked as *"จัดวางข้อมูล วันเกิด / แผนก / บริษัท และปุ่ม Action … ให้อยู่ในระนาบ
ที่ประหยัดพื้นที่แนวตั้ง"*. The buttons are refused for the second time by the
same table two sections up — the ต้องตรวจ strip needs 592–623px of a 316px card
and no layout closes a gap of that size. The three facts are a different
question, and this time the arithmetic changed.

**What changed is the date, and it was the whole obstacle.** *25 พฤศจิกายน 2569*
+ *วันพฤหัสบดี* measures **185px** of the 314px a card has inside its padding —
185 + แผนก 89 + บริษัท 40 + two joints is 330, over the edge before a label is
drawn, and the cell carries `white-space: nowrap` from the component so it has no
wrap to fall back on. The short date form and `dayAbbr` — the pair lib/api.js
had built for คิวรออนุมัติ, and which on 2026-09-04 became `thaiDate` + `dayAbbr`
at the same width — say the same two facts in **87px**, and the row comes to
**282** at its worst (ควบคุมคุณภาพ, the longest department this roster holds)
with the chip's track still 90 wide beside it.

**Nothing is lost by shortening it here.** The month and the year are on the
period picker at the top of the screen and in the heading over the list, and this
list is one month by construction — printing them on six cards says them seven
times. The day of the week is *not* dropped, only abbreviated: Saturday and
Sunday are already holidays and that is what วันหยุดอยู่แล้ว rows turn on.

**Both lengths are in the markup and the stylesheet picks.** `.date-full` and
`.date-abbr` are two spans; the desktop hides the short one, the phone block
hides the long one, and the two rules are the same weight, so the order in the
file is what decides. **Nothing in the component asks how wide the screen is** —
the rule this screen has kept throughout — and the desktop table, which reads
this column down the page, keeps *13 สิงหาคม 2569 / วันพฤหัสบดี* untouched.

**The two labels went with it.** `วันเกิด` and `บริษัท` cost 44px each of a
314px line. They were the column headings, moved onto the card when the `thead`
was dropped; on a card inside a section called วันเกิดของเดือนนี้ a date can only
be one date, and *ไพรมัส* is not mistakable for anything else. `ชั่วโมง` keeps
its label — a bare number is the one value on the card that nothing around it
explains — and moves up under the chip, onto the status sentence's row, because
มีใบแล้ว and the hours that ใบ carries are one fact read down the right edge.

| where the height went | |
|---|---|
| **−24** | the second fact line, gone: `"date dept co"` is one grid row where `"date date date"` over `"dept co hrs"` was two |
| **−13** | the hairline over วันเกิด, and its 6 + 6 — the card is down to **one** rule, over the buttons, where the reading actually changes |

**A ต้องตรวจ card at 360px: 172 → 142px. A settled one: 102, and a มีใบแล้ว one
163.** With the three settled rows folded away as they are by default, the
section goes **748 → 658** and the page **2483 → 2405** — three cards' worth of
saving less the 12px the pager below took back in the same round. The fold is
still the biggest lever this section has; the card is now the smaller one twice
over.

**The third track has a floor now, and that is the one thing to check before
moving anything into it.** `grid-template-columns: auto auto minmax(min-content,
1fr)` — วันเกิด sizes the first, แผนก the second, and the third is shared by the
chip, ชั่วโมง and บริษัท. Its floor is the widest of those three's min-content,
which is the chip (*วันหยุดอยู่แล้ว*, about 90px and unbreakable in Thai), so a
long department can never squeeze the status out of its corner. **แผนก is the
give**: `overflow-wrap: anywhere` makes its min-content one character, so in the
worst case it breaks mid-word and the card grows a line rather than the page
growing sideways. Walked at 320, 360 and 430px against the longest department and
the longest date: `scrollWidth == clientWidth` at all three, and at 320 the one
ควบคุมคุณภาพ row takes the second line it is entitled to.

**2 — the foot of the last employee card, before the pager.** Asked as the
bottom of สุจินดา's card wanting to be *"โปร่งและสม่ำเสมอกับการ์ดใบอื่น"* — the
same joint that was reported as *ชิดเกินไป* the day before, when it was 12 and
became 18.

**18 was real and it was not enough, because the two things this joint separates
are not two borders.** Above it, a card's last ink is a 44px bordered button
sitting 15px inside the card's own edge; below it, the band's first ink is a 38px
*filled* chevron square with no padding at all, hard against the top of its row.
`.pager-row` now takes `margin: 12px 0`, and because `.hr-table tbody` is a flex
column that **adds** to the 12px `gap` rather than collapsing with it, both gaps
come out at **24** — twice the cards' own pitch. The column reads 12 · 12 · 12 ·
12 (five cards) · **24** · pager · **24** · total. รวมทั้งหมด still states no
margin of its own: the pager's bottom margin is the gap over it, written once.

### เศษสีเทาที่ขอบ Top Bar — และการ์ดวันเกิดรอบที่เจ็ด — 2026-08-28 รอบสอง

Three asks after the round above went live. Measured at **412×887**, the width
the report came in at, on the deployed app first and on a scratch build after.

**1 — the card gives up its last two numbers.** *"ปรับลด Padding บน-ล่าง …
ลงอีกเล็กน้อย"* and *"ปรับขนาดปุ่ม … ให้มีความสูงลดลงเล็กน้อย เพื่อให้สอดคล้อง
กับขนาดการ์ดรูปแบบใหม่"*. Padding **10 → 8** and the buttons **44 → 40**: a
ต้องตรวจ card **142 → 134**, the section **658 → 634**, the page **2405 → 2381**.

**The 44 was refused five times and this is what it cost to give it up, stated
plainly.** 44 is Apple's HIG figure and what this app uses wherever a finger
decides something. WCAG 2.2's own minimum (2.5.8, AA) is **24×24 CSS px**, so 40
is nowhere near a floor — and the target is not 40px, it is **152 × 40**, because
the two buttons split the card's width. Both answers are reversible: a filed ใบ
can be withdrawn, and ไม่ได้มาทำงาน has ยกเลิกการตรวจ beside it, so a mis-press
costs a second press rather than a wrong figure in a closed month. **The employee
cards above keep 44** and so does วันเกิดรอตรวจ — same two-densities rule this
card has been built on since round one, and “test/birthdayCardUi.test.js” (ลบแล้ว 2026-09-03) now
pins all three numbers so nobody harmonises them in either direction.

*The buttons went to **36** the same day, one round later, and the paragraph
above is the argument for it too — one step further along the same trade. The
numbers in it read 40 because that is where this round left them.*

**8px is the floor for the padding.** Below it the 1px border and the text start
reading as one edge. What was left after this round was type size and touch
targets, and the next round took 4px of the second.

**2 — the grey shapes at the top bar are the pager, and nothing was deleted.**
Reported as *"มีเศษ Element สีเทาโผล่ขึ้นมาบริเวณ Top Bar (ตรงข้อความ แสดง 1-4
จาก 4 รายการ)"* with a request to remove the leftover. **It was hit-tested before
anything was changed**, at the reported coordinates on the deployed app at
412×887: `button.btn.ghost.sm.pager-step.pager-prev` and `.pager-next`, both
`disabled`. Not a leftover — the pager's own two chevrons, four lines above the
text that names them.

**What made them read as debris is that the disabled state is LOUDER than the
live one.** `.pager-step` is a `.btn ghost`: transparent ground, hairline ring.
The app-wide `.btn:disabled` gives it a `--neutral-wash` fill — and on a month
that fits on one page *both* ends are disabled, so the band carries two filled
grey squares that can never do anything. `.appbar` is `position: sticky`, so the
page scrolls under it — and the bar was **frosted glass** at the time, so a 38px
grey square crossing that edge showed *through* the header as a rounded shape.
(The frost went later the same day, and §"แถบบนกับแถบล่างทึบแล้ว" below is why.)
This app already states the rule that was being broken — *"a disabled control is
quieter than a live one everywhere else in this app"*, written for แก้ไขไม่ได้ on
the entry rows — and names this exact failure there: `--neutral-wash` behind a
ghost is what a dead button looks like.

So the fix is the voice and not the element: `background: none`, a `--line` ring,
a `--muted-2` glyph — one selector deeper than the app-wide rule, which is
untouched. **Still not a fade**: `opacity` stays 1, because a ghost at .45 is
illegible on the dark theme. The band is still drawn on every month, including
the ones that fit, for the reason recorded above.

**3 — the foot of the list already clears the bar, and here is the number.**
Asked to check that the fold button — *"ดูอีก 3 คนที่ไม่ต้องตอบตอนนี้"* as it read
that morning — is not touching or sinking
into the bottom nav. Scrolled to the very end of the page at 412×887: the
button's bottom edge stands **62.7px** clear of the bar's top, and `main` itself
ends **23.7px** clear — which is `.mobile-nav-spacer`, `--nav-h + 24`, doing
exactly what it was written to do (24 is two card-gaps; the note is above the
rule). **Nothing was added**, and that is the finding rather than a shortcut: the
screen has just been through seven rounds of taking vertical space out, and
padding the foot would hand some of it back to no purpose. What the report
describes is what a *fixed* frosted bar does mid-scroll — content passes under
it until the scroll reaches the end.

### แผงเปลี่ยนหน้าไม่ถูกวาดในเดือนที่พอดีหน้าเดียว — 2026-08-28 รอบสาม

**The same band, reported a second time, and this round it goes.** Round two
found that the "เศษ Element สีเทา" at the top bar was the pager's two disabled
chevrons and quietened them; the next screenshot named the whole band —
*"Element ส่วนเกิน (ข้อความ 'แสดง 1-4 จาก 4 รายการ' และปุ่ม Pagination) หลุดขึ้น
ไปโผล่ใต้ Header … ลบ Element ส่วนเกินนี้ออก"*.

**It is not a `position` or `z-index` fault, and that was checked before
anything moved.** `.appbar` is `position: sticky; top: 0; z-index: 20` — it is
*in flow*, and the page scrolls under it, which is what a header does. Nothing
escapes it and nothing is stacked wrongly. (It was also **frosted** at the time,
which is the half of this that *was* a defect; it is opaque since the round
below.) What was true is the other half of the report: on a month that fits on
one page the band **is** surplus. `{pageCount > 1 && …}` now wraps the whole row,
and §"แผงเปลี่ยนหน้า" above carries the argument in both directions, because
this condition has been added, removed and added again.

**Removing a row moved a gap, and that is the part worth checking.**
`.pager-row` owned `margin: 12px 0` — its bottom margin was the gap over
รวมทั้งหมด, deliberately written once — and a gap that lives on an element which
is sometimes absent is sometimes absent. The total would have slid back to the
list's own 12px pitch and read as the fifth person, which is the exact defect
that margin was added for on 2026-08-27. So the pager keeps a **top** margin only
and รวมทั้งหมด states its own: 24px above the total either way, measured at
431×896 with the pager gone.

**And two numbers came down with it.** The birthday card's buttons **40 → 36**
— `padding-block: 7px` beside the `min-height`, because `.btn.sm` stands about
37.6px on its own and a `min-height` under 38 decides nothing without it, which
is the "the rule is in the bundle, is correct, and does nothing" trap this table
has now been caught by three times. And `.mobile-nav-spacer` **24 → 36**, three
card-gaps, after the foot of this screen was raised a second time.

**Measured at 431×896, the width the report came in at:** a ต้องตรวจ card
**134 → 130**, the buttons exactly **36**, the fold button's clearance over the
bar **62.7 → 74.7**, the page **2381 → 2279**, and `scrollWidth == clientWidth`.
The section that started this week at 1772px is **622**.

### หน้าละ 5 คน กับพับที่ 3 — สองกลไก ไม่เคยอยู่พร้อมกัน — 2026-08-28 รอบห้า

**Asked for by name:** *"ให้ Limit แสดงการ์ดพนักงานเพียง 3 รายการแรกเท่านั้น"*
with **ดูพนักงานทั้งหมด (4 ราย)** under the third card. The employee list is the
tallest object on this screen — a card is about 170px — and everything HR comes
here to *answer* is below it.

**It is the eighth arrangement over this one list, and the first that does not
replace the one before it.** The rule the previous seven produced is that *two*
mechanisms over one list is the failure: a reader who can reach the ninth person
either by pressing ถัดไป or by opening a fold has two controls and no way to tell
which is meant. So:

| the month | what it gets | why |
|---|---|---|
| **≤ 5 people** (no pager) | 3 cards + **ดูพนักงานทั้งหมด (n ราย)** | the whole month is behind the button; opening it shows all of it |
| **> 5 people** | 5 cards + the pager | the pager already caps the list; a fold under it would reveal two cards |
| **while searching** | no fold, ever | `query` narrowed the list on purpose, and hiding two of four *matches* is the search failing at the one thing it was asked to do |

`pageCount === 1 && !query.trim() && shown.length > CARD_FOLD` is the whole of
it, in one place, and `CARD_FOLD` is 3 — the number that was asked for, and the
one that makes the button hide something on a month of four or five.

**One class still says one thing.** `off-page` is what the phone reads, and the
end of its range is `cardsTo` — the page's own end where there is a pager, the
fold's where there is not. The desktop reads neither: `.cards-more-row` joins
`.pager-row` in being `display: none` above 860px, and the table draws every row
of the month as it always has. **A class and not `shown.slice`**, for the reason
written over `CARD_PAGE`: slicing draws the desktop a month with people missing.

**The dropdown opens the fold**, the way it already set the page. Below 860px the
fourth card of a short month carries `off-page` exactly as the sixth of a long
one does, so a person picked from the suggestion list would otherwise have no
element on the screen to scroll to — the same defect, from the other mechanism.
The fold also resets with the month, the filter and the search box, beside
`page` and for the same reason: none of them is a state the reader carried in.

**Measured at 431×896 on a scratch build**, with the live month (four people):
closed **3 cards** and the page **2279 → 2165**; open **4 cards** and 2347; the
band 44px with 24px of air on both sides, the same joint the pager takes. On a
clone with nine people the fold is **absent** and the pager is there, five cards
to a page. Searching `PM` on that clone — five matches, one page — draws **no
fold**. At 1280px the desktop is untouched in both states: every row, no button,
page height identical.

### แถบบนกับแถบล่างทึบแล้ว — เศษที่เห็นคือเงาผ่านกระจกฝ้า — 2026-08-28 รอบหก

**Three reports, one cause, and it took the third to see it.** *"เศษ Element
สีเทาโผล่ขึ้นมาบริเวณ Top Bar"*, then the same again after the disabled chevrons
were quietened, then *"เศษกรอบปุ่ม/Element เกินโผล่ขึ้นมาเล็กน้อย"* pointing at
a **ดูใบ** button and a **ดูพนักงานทั้งหมด** button. Nothing was ever stray. The
bars were **frosted glass**:

```
.appbar     background: rgba(16, 21, 19, .92)   backdrop-filter: blur(10px)
.mobile-nav background: rgba(16, 21, 19, .96)   backdrop-filter: blur(12px)
```

At `.92` the header paints **8% of whatever is under it**, blurred. A bordered
button crossing that edge therefore draws a soft ghost of its own frame *inside*
the header, above where the button actually is — and on this dark ground the
worst case is exactly what got reported: a green-ringed button, or a
`--neutral-wash` chevron, smeared across the bar. The nav at `.96` does the same
4% at the other end of the page, where what passes under it is the **last control
on the screen**.

**So both bars are opaque** — one token, `--bar-ground`, `light-dark(#ffffff,
#101513)`. The values are the colours the translucent ones already composited
to, which is why the nav's contrast figures were measured against "~#101513"
while the token still carried an alpha: **nothing about the look moved; only what
shows through did.**

**And `backdrop-filter` went with the alpha, along with a workaround it needed.**
A backdrop-filtered element is composited as its own layer and stops obeying
z-index — that is a real bug this app hit, and `body.has-dialog .appbar, …
.mobile-nav { backdrop-filter: none; }` was the answer to it. An opaque bar has
nothing to blur, so the filter was buying nothing and keeping the hazard alive
between dialogs. Removing it removes the class of bug instead of answering it in
one place. `body.has-dialog` itself stays: it is what hides the nav and the FAB
while a sheet is open, which is the rule that actually holds a sheet down.

**What is left after this is a scrolled page under a header, and that is not a
defect.** At any given scroll offset the top of the list is half under the bar
and the foot of it is half under the nav; that is true of every scrolling screen
with fixed chrome. What has changed is that the half that is hidden is now
*hidden* rather than showing through as a ghost.

**And the foot of the list was measured again rather than padded again.** Asked
for a third time, as the *ซ่อนรายการที่ตรวจสอบแล้ว* button wanting **16–24px**
of clearance over the nav. Scrolled to the very end at 431×896, in the expanded
state the report was made in: **75.5px** — three times what was asked for, and
`main` itself clears by 36. Nothing was added. What the screenshots show is a
page stopped **50px short of its end**, where the last control genuinely sits
about 25px above the bar, which is what scrolling does and what the opaque bar
now makes read as "under the menu" instead of "smeared into it".

### เส้นขอบของแถบบน กับ 48px ที่ก้นหน้า — 2026-08-28 รอบเจ็ด

**The fourth report of the thing at the top, and this time the answer is a cue
rather than a removal.** *"ตรวจพบเศษ Text/Element ล้นออกมาบริเวณใต้ Header
หลัก"*, with a fix proposed: `overflow: hidden` on the parent container.

**Nothing is escaping a container, and that was checked rather than argued** —
the third way of checking this same thing in two days:

| what was asked | what the running app says |
|---|---|
| is a card's content overflowing its box? | the hit-test at those coordinates names `tr.settled` of the birthday table — a whole card, not a fragment |
| is a parent clipping wrongly? | `.shell`, `.body`, `main` and `.table-wrap.card-list` all measure `border-radius: 0; overflow: visible` — no box is being escaped, so `overflow: hidden` on any of them clips nothing |
| is it z-index? | `.appbar` is `sticky; top: 0; z-index: 20`, opaque since the round above, and it paints over what is under it |

**What was missing is the CUE.** A list passing under a header is what every
scrolling screen with fixed chrome does; what makes it read as debris rather
than as continuation is a boundary too quiet to say "this bar is above the
page". A 1px `--line` hairline was the whole of it. The bar now carries **a soft
shadow and a lifted hairline** — `--line-lift`, this app's token for the border
of something sitting *above* the page. The two split the work by theme: a black
shadow does most of nothing on a near-black page, so the lifted line carries the
dark theme and the shadow carries the light one.

**And the foot of the page is 48px — four card-gaps — for a reason the first two
asks did not give.** The third one named a consequence: *"เพื่อป้องกันปัญหาการ
กดผิดไปโดนเมนูด้านล่าง"*. A measurement cannot answer a mis-tap, and 12px of
scroll at the very end of a page is a cheap answer to one. At 431×896 in the
expanded state the last control now clears the bar by **87.5px** and `main` by
**48.5**. The derivation is unchanged and is written over `.mobile-nav-spacer`.

### กระดาษขาวใต้แถบดำ — ใบ F-HR-027 กับปลายอีกข้างของรอบเจ็ด — 2026-08-28 รอบแปด

**The same report as the round above, from the other end of the screen and from
the one screen where the contrast is total.** *"ตารางและเนื้อหาภายในหน้าโผล่เลย
ออกไปนอกแถบ Navigation Bar ทั้งด้านบนและด้านล่าง"*, with three fixes proposed:
`overflow: hidden` on a wrapper, more padding, and an opaque fill with a
`z-index` on the bottom bar. All three already existed; the round above had put
the last two in that morning.

**And once more nothing is escaping anything.** This time the check was the
running app rather than the stylesheet — headless Chrome against `next start`
on :3000, logged in as an employee at 441×908, which is the width the reported
screenshot was taken at:

| what was asked | what the running app says |
|---|---|
| does anything paint over a bar? | a hit-test every 2px down both boundaries names `.print-bar` above y=121.5 and `td.n` below it, `td.n` up to y=840 and `.mobile-nav` from y=842 — no pixel is shared |
| do the bars have a fill? | both `rgb(16, 21, 19)`, fully opaque, since the round above |
| does the page overflow sideways? | `documentElement.scrollWidth` 441 = `innerWidth` 441 |
| is the foot of the page short? | `.mobile-nav-spacer` measures 114px against a 66px bar |

**What is different on this screen is what passes underneath.** Everywhere else
it is `--card` sliding under `--bar-ground` — one step apart, and this section
read *"the round above's hairline is enough"* until 2026-08-31, when the same
complaint came back from exactly there; see the round below. ใบ F-HR-027 is a
sheet of **#ffffff paper**, white
on both themes because it is a printable form, and it is cut flush by a
near-black bar at both ends. The reporter said exactly this: *"ถ้าพื้นข้างหลัง
มันคนละสีมันจะเห็นชัด"*. A boundary that reads as continuation at one step of
contrast reads as a mistake at the full range.

**So both bars this screen has now cast the app bar's shadow**, same falloff,
`0 6px 14px -8px var(--shadow-soft)` — `.print-bar` down onto the paper, and
`.mobile-nav` the same numbers negated, casting up. It read *"neither takes the
lifted hairline the app bar needed"* until 2026-08-31 — `.mobile-nav` takes it
now, and `.print-bar`, which only ever hangs over the paper, still does not.

**On every other screen the bottom bar's new shadow is nearly nothing, and that
is expected.** It is not written for them. What was missed is that nothing else
was written for them either — the round below.

### เส้นขอบของแถบล่าง — ปลายที่รอบแปดยกเว้นไว้ — 2026-08-31

**The fourth telling of one report, and this time from the screen the last three
rounds set aside.** A picture of ตั้งค่าระบบ on ธีมมืด at 430px, with the
sentence *"ข้อมูลมันโผล่"* — the foot of a `--card` list cut off flush by the
bottom bar, ending against nothing.

**Measured, nothing is escaping anything, again.** Headless Chrome against the
running app as ผู้ดูแลระบบ at 430×740, scrolled to the middle of แผนกและเพดาน:

| what was asked | what the running app says |
|---|---|
| does the badge leave the bar? | `.count` sits at 672–688, the bar's top edge at 663 — **9px inside** |
| does anything of the bar paint above its own edge? | a hit-test at −1, −3 and −6px across the full width names nothing belonging to `.mobile-nav` |
| what is the boundary made of? | `--line` `rgb(48, 57, 52)` over a card of `rgb(31, 39, 35)` — **two steps of a near-black**, under a shadow the same section above calls "nearly nothing" here |

**So the cue was the thing missing, exactly as it was at the top of the screen
three days earlier, and the answer is the one the app bar already got.**
`.mobile-nav`'s `border-top` goes `--line` → **`--line-lift`**, `rgb(74, 85, 78)`
against that same card. The shadow carries the light theme and the white paper;
the lifted hairline carries ธีมมืด. Neither is doing the other's work, and the
two bars this app pins to the edges of a phone now say the same thing in the
same way.

**What the round above got wrong was not the fix but its scope.** It asked which
surface needed carrying, answered "the paper", and stopped — the ordinary screen
was named in the same paragraph, called "nearly nothing", and left with a
hairline chosen for a case that had already been shown to fail.

### The first card was never clipped — the ค้นหา bar was on it

Reported on 2026-08-26 as "the employee name on the top card has disappeared",
with the fix suggested as a missing top margin. It was neither.

**The name was in the data and in the DOM.** `PM-0100` is `วิชัย ศรีสุข` in the
database and the cell rendered it. **And the spacing was already right**: in
flow the first card sat "12px" under the search box, one card-gap, the same
distance every other card keeps from the one above it. (It is **23px** since
2026-08-27 — the row left the card, so the gap is now its own 10, the card’s
border and the list’s 12. Same fact, three pieces instead of one; see the
section headed ถอดกล่องการ์ดที่ครอบ ประจำเดือน กับช่องค้นหา.)

**What covered it was `.month-find` itself**, which was `position: sticky; top:
62px; z-index: 30`. Measured at 360px with the list scrolled to its top: the
app bar owned 0–62, the stuck search bar 62–131, and the first card's name sat
at **15–54** — entirely behind both. Every card passes under that bar; the
first one is only special in being where a thumb stops.

**So the bar is not sticky any more.** The alternative — leaving it and telling
people to scroll up — was offered and declined, and the reason to keep it had
already expired: it was written for "a card list of forty people is forty
screens of scrolling", and the pager landed afterwards and made the list **five
cards**. A control pinned over 131px of a 780px phone to save a scroll that is
no longer forty screens long was paying rent it had stopped earning. It also
cost the pager one of the three scroll positions where that control could not
be pressed.

**What was kept is the strip** — the full-bleed margins, the padding, the
list's own `--bg` ground and the hairline under it. None of that was ever about
stickiness; it is what says the box filters the thing below it. **What went
with the sticky** is `position`, `top`, `z-index` and the `!important` on the
fill, which was defending against exactly one failure — a transparent bar over
moving cards — that no longer exists. The suggestion panel keeps its own
`z-index: 5` and still paints over the list, which the list carries nothing to
contest; walked and hit-tested after the change.

**A fallback for a genuinely nameless employee went in anyway.** The row is
`{row.employee.name || '—'}` now — the app's own stand-in, the one every other
name already takes — because the row had no answer for that case and the report
was a fair question to ask of it.

**And the bottom of the page moved with it.** `.mobile-nav-spacer` was a flat
74px against a nav bar that is **88px at 320px**, 77 at 360 and 430, and 66
above 600 — the height is its buttons', and the six Thai labels wrap to three
lines on the narrowest phone. It went to "88" that day: the tallest the bar
gets, one number rather than a breakpoint pinned to where six words happen to
rewrap.

**One number for the tallest case still left the narrowest phone with nothing.**
The spacer was 88 at every width and the bar is not: measured at the foot of
ตรวจสอบรายเดือน on 2026-08-26, the gap between the END OF THE CONTENT and the
top of the bar was **0px at 320**, 11 at 360 and 430, and 22 at 700 — at 320 the
last row of the page ended on exactly the pixel the bar began. Nothing was
hidden and nothing was clear either, and one more line of label — a renamed tab,
a larger system font, a phone this was never measured on — would have taken the
last row under the bar.

*This is not the figure the walk in [`docs/features.md`](docs/features.md)
records, and the two do not disagree.* That walk measured from the bottom of the
last section BOX — 30px higher up, with its own margin under it — and got
"30 / 41 / 41 / 52" across the same four widths. Both are the same 0 / 11 / 11 /
22 plus a constant. The number that decides whether anything is trapped is this
one, because the spacer is what ends the page.

**So the bar measures itself now.** A `ResizeObserver` on the `<nav>` publishes
its height as `--nav-h` on the document element, and the spacer is
`calc(var(--nav-h) + 24px)`; an observer and not a measurement on mount, because
the height changes with no re-render behind it — a rotation, a resize, a webfont
arriving after first paint. The measured height already includes
`env(safe-area-inset-bottom)`, because the bar pads past the home indicator
itself, so the inset appears in the stylesheet only inside the `var()` fallback.
That fallback is still the 88, and it is what draws for the frame before the
observer runs and in print, where `.no-print` takes the bar away entirely. The
24 on top is air, not clearance: `var(--nav-h)` alone is already the whole of
"nothing is trapped under the bar", and this is the gap between the last thing
on the page and the bar once the reader has scrolled as far as the page goes. It
was "12" for a few hours and was asked to be more — at 12 the last card of
วันเกิดของเดือนนี้ ends flush enough against the bar to read as cut off by it
rather than as the end of the page. It is a multiple of the **card-gap**, the
12px this list already puts between two cards, rather than a number chosen by
eye. Measured when it was "24": at 320 / 360 / 430 / 700 the spacer was
**112 / 101 / 101 / 90** — the bar's own 88 / 77 / 77 / 66 — and the gap between
the end of the content and the top of the bar was **24 at all four**, where it
had been 0 / 11 / 11 / 22.

**It is 48 — four card-gaps — since 2026-08-28**, and it read "24" and then
"36" earlier the same day. The foot of ตรวจสอบรายเดือน was raised three times.
Twice it was measured and reported rather than changed, because the numbers said
it was already clear: at 412×887 the last control stood **62.7px** off the bar,
then **75.5**, against an ask for *"16–24px"*. The ask came back both times,
which makes it a judgement about how the foot READS rather than a claim about
the measurement. **The third ask named a consequence the measurements do not
cover** — *"เพื่อป้องกันปัญหาการกดผิดไปโดนเมนูด้านล่าง"*, a mis-tap landing on
the menu — and that is worth 12px of scroll at the very end of a page. The
derivation did not move: it is still a multiple of the 12px this list puts
between two cards. The last control now clears the bar by **87px**. It applies
to every phone screen, not one: this spacer is the app's single answer to a
`fixed` bar, and a per-screen number would be a second answer that drifts.

**`with-fab` takes the larger of the two.** The FAB on หน้า OT ของฉัน floats
92px up from the *viewport* and is 58 tall, and it knows nothing about how tall
the bar underneath it grew — so on a phone where the labels run to three lines
the bar can be the taller thing to clear. The rule is `max()` of the two, and
whichever it is, it clears.

**It is not a filter,** and nothing that is counted, exported or printed reads
it — which was true of every version this screen has had, and is why each could
be swapped for the next without a single figure moving. **รวมทั้งหมด** is the
server's `grandTotal` for the whole month. **พิมพ์ใบขออนุมัติ OT ทุกคน** bundles
every person the search matched, on this page or not. Both CSVs are built
server-side and have never known what is on screen. A new month, a new
สถานะที่นับ or a new search puts the page back to 1 — `query` and not `find`
since the debounce landed, so the pager moves when the list under it does rather
than 300ms ahead of it.

**The exception, and it is not a reset.** Picking somebody from the suggestion
list under the search box sets the page that *holds* them, because on a phone a
person on page 7 has no card on the screen at all. That box, its dropdown and
what a pick does — it opens **ดู / แก้ไขรายการ** for that person — are described
in §"และกล่องแนะนำบนตรวจสอบรายเดือน". That section was filed under สรุป OT
ส่งบัญชี's box while the two were the same box; ส่งบัญชี gave its box up on
2026-08-27 and this screen is the only caller now.

**A page that stops existing is clamped, not drawn empty.** `load()` can shorten
the list without the month, the filter or the search changing — HR opens
somebody's month and withdraws the last live entry in it. `current` is
`Math.min(page, pageCount)`, clamped at render so the empty page never exists
for a frame, with `page` itself left alone so a list that grows back returns the
reader where they were.

**One markup, two layouts.** The component marks which rows are off the current
page (`off-page`) and the *stylesheet* decides whether that means anything —
only below 860px. Above it `.pager-row` is `display: none` and `off-page` is
given **no rule at all**, which is what leaves every row drawn; one
`display: none` written into the desktop block by mistake would take fifty-five
people out of the desktop month, and `test/hrMonthCards.test.js` asserts its
absence for that reason. There is no `matchMedia` in the component either.

**And it is why the list is not `shown.slice(from, to)`,** which is the shorter
way to draw five cards and draws five *rows* with it. The desktop has no pager
to reach the other fifty-five with, so a sliced list is a month with most of the
month missing on the layout that has always shown all of it. The phone draws
exactly five either way; only this way leaves the desktop the month.

**A new page starts at the top of the list** — the first of the two places this
component touches the DOM (the other is the dropdown's scroll, added
2026-08-26; it read "the one place" until then), and it is there because the
walk found the bug rather than because it looked likely. The pager sits under the fifth card, so **ถัดไป** is
pressed with five cards' worth of list above the thumb; without scrolling, the
next five people are drawn up there out of the viewport and a button whose label
did not change appears to have done nothing. `goPage()` calls
`scrollIntoView({ block: 'start' })` on the list wrap, and how far down to stop
is `scroll-margin-top: 86px` in the stylesheet — 62px of `.appbar` plus 24 of
air, which puts the first card of a new page 24px clear of the bar. It read
"156px" until 2026-08-26, when `.month-find` stopped being sticky: the extra 94
was that box, and a landing still sized for it would now leave 94px of empty
ground over the first card. It read "74px" until 2026-08-27 — the same 24 of
air, but measured **through** `.hr-table tbody`’s own 12px of top padding, which
sat inside the distance and made 62 + 12 enough. That padding is `0` since the
card round the list came off, so the wrap’s top edge is the first card’s and the
whole 24 is stated here. A figure measured through another rule’s padding goes
stale, silently, when that padding does.

**In the handler, not on an effect.** While the list was a box the reset was
`scrollTop = 0` on a `useEffect` over `[current, find, period, statusFilter]`,
which was the same act as scrolling the box. With the *page* doing the scrolling
it is not: an effect over those deps fires on mount and on every keystroke in
the search box, and the screen would jump down to the list while somebody was
still typing above it. Pressing one of the two buttons is the only thing that
scrolls the list *by itself*.

It stopped being the only thing that scrolls the page on 2026-08-26, and the
second one is deliberately not on those deps either: picking somebody from the
suggestion list scrolls to their row — from an effect, but one that fires on
`jump`, a request made by a click and spent once. Nothing about typing reaches
it. See §"และกล่องแนะนำบนตรวจสอบรายเดือน".

Walked 2026-08-26 at 360×780 against a clone of the database on `next dev`, the
month seeded to 25 people (24 with approved entries) because the live August has
four. **Nothing on the page is an inner scrollport** — every element with an
`overflow-y` that actually scrolls was collected and the list came back
**empty**; `.hr-table tbody` computes `max-height: none` and
`overflow-y: visible`, `.table-wrap.card-list` computes `overflow-y: visible`,
and the page's own scroll height is "3861px". **5 cards drawn** with **19**
`off-page`. Down the page: first card **842** → fifth card **1513** → pager
**1707** → total "1792" → **วันเกิดของเดือนนี้** "1870". Both card buttons
**121×44**; the total `position: static`; **ก่อนหน้า** `disabled` on page 1.

The three quoted figures are from before the pager was compacted on 2026-08-26
and are what the 35px it gave back is measured against — everything from
**รวมทั้งหมด** down moved up by that much, and the total's own 8px moved
**วันเกิดของเดือนนี้** up by 43. Re-measured on the live four-person August at
360px rather than on that clone, so the two sets of numbers are not each other's
replacements: the pager row **73 → 56** and the total row **54 → 46**, both
measured on the elements themselves. The page's own scroll height is NOT
quoted here: วันเกิดของเดือนนี้ loads after first paint, so two readings of it
are only comparable if both waited long enough, and the pair taken that day did
not obviously do so. The two rows above are what changed and they were measured
directly.

**The pager is pressable across its travel.** Walking the page past it in 40px
steps, **14 of the 17** positions where it is on screen return the button itself
under a thumb at its centre. The three that do not were the two fixed bars this
screen had at the time: on the way in it is still under the bottom nav, and at
the far end it had gone up behind the **ค้นหา** bar. Centred, both buttons hit
themselves. With the box, the thing that covered them was the sticky total
*inside* the list — two positions out of nineteen — which is the difference
between a bar the reader scrolls past and one that travels with the control.

**One of those three is gone.** `.month-find` stopped being sticky on
2026-08-26 and scrolls away with the list now, so the only thing left that can
cover the pager is the bottom nav on the way in — and the spacer above it grew
from 74px to "88" the same day, and then stopped being a number at all: it is
`calc(var(--nav-h) + 24px)`, and `--nav-h` is what the bar reports. See §"The
first card was never clipped".

**ถัดไป** gave *หน้า 2 / 5* over *แสดง 6–10 จาก 24 รายการ*, moved the page from
**1000 to 674**, and put the list wrap at **156** in the viewport — the first
card of page 2 at **24px clear** of the search bar's bottom edge. Re-measured
after the bar was un-stuck on 2026-08-26: the wrap lands at **74** and the first
card at **86**, still **24px clear**, now of the app bar.

**The one-page case, which is what the persistent pager is for.** Narrowing the
search to two people left the pager exactly where it was, reading
*หน้า 1 / 1* over *แสดง 1–2 จาก 2 รายการ* with **both** buttons `disabled`, the total
under it and the birthdays under that. At 1440px: `max-height: none`,
`overflow-y: visible`, all **24 cards** drawn (19 of them still carrying
`off-page`, which no rule up there reads), the pager `display: none`, the total
`position: static`.

The measurements the box was signed off with, kept because they are what these
are being compared against: "328px" tall with a scroll height of "1083px",
"7 rows inside it", the order in its own scroll space "last card 618 → pager 769
→ total 854", both buttons "116×44", and **วันเกิดของเดือนนี้** "12px" under the
box — unmoved at "y=489" when the page changed, which is the one thing this
arrangement does not do.


**CSV export** — `/api/exports/entries.csv` (per entry),
`/api/exports/monthly.csv` (per employee per month) and
`/api/exports/accounting.csv` (the submission sheet, see below), all written
with a **UTF-8 BOM**. Without it Excel on Thai Windows renders every ชื่อ-สกุล
as mojibake. Cells beginning `=`, `+`, `-` or `@` are quote-prefixed so a work
description cannot become a spreadsheet formula.

---

### The two rectangles a browser draws on a control

**2026-08-28, รอบแปด**, and it is the second base-rule bug this stylesheet has
had. It was reported the day before about one button — the ▲/▼ on the holiday
banner — and fixed there; the next report was *"น่าจะเป็นทุกปุ่มที่อยู่ในระบบเลย"*,
which is the sentence that says the answer was in the wrong place.

**A blue rectangle appears over a button when it is pressed on a phone.** It
reads as one bug and it is two, drawn by two different mechanisms:

| | What draws it | When | Sized to |
|---|---|---|---|
| **Tap highlight** | the browser, filling the box | while a finger is down | the hit box |
| **Focus ring** | the browser's `outline` on `:focus-visible` | keyboard, not thumb | the border box |

Both are sized to the BOX and not to the mark inside it, which is why this
surfaced on the fold arrow first: an 11px glyph in a hit area padded out to 44px
for a thumb, so the rectangle is four times the size of the thing it is drawn
around.

**The tap highlight is one declaration for the whole app**, because
`-webkit-tap-highlight-color` is an **inherited** property:

```css
html { -webkit-tap-highlight-color: transparent; }
```

Two controls had declared it for themselves before this — `.appbar .mark-btn`
and `.announce-fold` — and both are gone. A property that covers everything by
inheritance and is written per-control instead is a list somebody has to
remember to add to, which is the same failure in a different key as the one
`test/buttonBox.test.js` records.

**The focus ring is replaced, not removed.** `outline: none` across the app is
the obvious reading of the report and it is the wrong fix: it deletes the only
sign a keyboard user has of where they are, on every control at once, to answer
a complaint about a *colour*. So there is a base ring instead, and it is
declared at the lowest specificity there is — one pseudo-class, no element and
no class — so that every rule already in the file still beats it:

```css
:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
```

Those values are not new. They are what `.btn:focus-visible` had drawn since the
day buttons got a ring at all; that rule is now deleted and this is where they
live.

**Eight controls had copied that declaration out for themselves** — `.appbar
.mark-btn`, `.btn`/`.link`/`.seg button`, `.tip-btn`, `.modal-x`, `.dept-pill
button`, `.searchbox-clear`, `.password-field .reveal`, `.picked-clear`, plus
`.announce-fold` the day before — and two of them said so in a comment reading
*"Not a `.btn`, so the app's focus rule does not reach it"*. Four were the base
values word for word and are deleted. The other four differ only in the offset
and are **one declaration each** now:

```css
.searchbox-clear:focus-visible      { outline-offset: -2px; }   /* inside a field */
.password-field .reveal:focus-visible { outline-offset: -2px; }
.dept-pill button:focus-visible     { outline-offset: 1px; }
.picked-clear:focus-visible         { outline-offset: 1px; }
.announce-fold:focus-visible        { outline-offset: 1px; }
```

**Two deviations are real and stay whole.** The sidebar keeps `--green-lift`
and an inward `-2px`. The offset is the durable half of that: a nav row is the
full width of the rail, so an outward ring would be drawn on the rail's own
edge whatever colour it is. The reason given for the *colour* read "the **dark**
sidebar... `--green` has nowhere near the contrast on that surface that it has
on a card", and **since 2026-09-07 that is true in ธีมมืด only** — the rail is
`--panel-rail`, which is white in ธีมสว่าง. The deviation stands anyway, and
the phone bar is why: `.mobile-nav button:focus-visible` is in the same
selector list and has been drawing this ring on a white bar since the bar
existed. `--green-lift` measures **3.40:1** on white, over the 3:1 a ring is
held to. And the three controls whose ring is a
`box-shadow` — `.state-badge`, `.stat.as-button`, `.log-tally li > button` —
keep `outline: none` beside it, which is a control answering for itself rather
than a blanket.

**What is pinned, and what is deliberately not.** `test/pressChrome.test.js`
parses the stylesheet into rules and asks four questions: the tap highlight is
declared exactly once and on `html`; a base `:focus-visible` exists at bare
specificity; no rule repeats the base ring's colour; and `outline: none` is
never written against a selector that is not a specific control. **None of them
pins the colour** — a ring that becomes some other token is a design decision,
and a ring that goes back to being declared once per control is the bug
returning.

**Not fixed here, and it is a real cost:** a control with no `:active` state of
its own now has no press feedback on a phone at all, because the browser's
highlight was the feedback. `.btn` has one (`translateY(1px)`), and so do the
appbar mark and a handful of others; the small marks — `.modal-x`,
`.searchbox-clear`, `.tip-btn` — have `:hover` only, and a phone has no hover.
Nobody has reported it and no press state has been designed, so nothing was
invented for it.

---

## Two companies: Primus / Themtech

The roster spans two legal entities, which file their payroll separately, so
every employee carries a `company` — `primus` or `themtech`. **The arithmetic
never reads it.** The engine, the caps, F-HR-027 and the two per-entry exports
are identical either way.

Two things do read it: **สรุป OT ส่งบัญชี**, which is what the field was carried
for, and — only where somebody has set it — **who may sign a request**, below.

**Assigning it.** Stated on the Admin screen or in the roster CSV's `company`
column wins. Left blank, the code prefix decides: `PM…` → Primus, `THT…` →
Themtech, with or without a dash. A code matching neither — `HR-001`, `ADMIN` —
falls back to Primus, and every row that fell back is *reported*: the CSV
import returns it as a warning and `npm run migrate:company` prints it by name.

It is stored rather than derived on the fly. The prefix is a convention, not a
rule, and the day the roster departs from it nobody should quietly change
payroll.

### เซ็นให้บริษัท — one แผนก, two หัวหน้า

A department that holds people from both payrolls can be signed for by two
หัวหน้า, one per company, **without the department being duplicated**. The field
is `Employee.approvesCompany` on the หัวหน้า, and it narrows the rule that was
already there rather than replacing it: their own department first, and then —
if this is set — only the people in it whom that company pays.

| `approvesCompany` | who they sign for |
|---|---|
| unset / null (**the default**) | everybody in their department, both payrolls |
| `primus` | the ไพรมัส half of their department |
| `themtech` | the เดมเทค half |

**Unset is the state of every row until somebody changes one**, and unset is the
behaviour this system had before the field existed — so the three arrangements
(nobody split, everybody split, and the mixture a company part-way through the
change actually has) are one field and no migration.

**Why not a second department row.** `PM-PROD` / `THT-PROD` would work today
with no code at all, and it splits two things that should not split: the
department's ceiling becomes two ceilings, and สรุป OT แยกแผนก — which exists to
count the people who sit in one room whatever entity pays them — reports the room
as two rows. This keeps the department whole and splits only the signature.

**Why on the person and not in a mapping table.** `Department.manager` already
exists and is read by nothing (see the note on `isDepartmentManager`); a third
place recording "who approves here" would be a third answer to drift from the
other two. The rule is decided where it has always been decided — the หัวหน้า's
own row — so there is one source and no join to keep in step.

**A stand-in exercises the giver's scope, not their own.** This is the whole of
what makes cover work: when the ไพรมัส หัวหน้า goes on leave and hands their
queue to the เดมเทค หัวหน้า, that person signs the ไพรมัส half **in the giver's
name** for the length of the window, and their own half as themselves. Read the
other way round — the holder's scope applied to a borrowed queue — the delegation
would grant nothing and the team would have nobody for a fortnight. The
delegation screen prints the scope being handed over for the same reason.

**A department nobody's scope covers has nobody who can sign.** Deliberately
visible: §6 requires two signatures and ฝ่ายบุคคล do not stand in for the first
one by outranking it, so those requests wait at `pending_mgr` until somebody
covers the team. The answer is a **ผู้รับช่วง**, which expires on its own and
records whose authority was used — not a silent fallback in the code.

**The queue is built from the same claims the button is.** A row that a reviewer
cannot sign must not be in their queue: nothing on an entry records a company (see
below — and that is on purpose), so a scoped claim becomes `{ department, employee:
{ $in: … } }` over the people that payroll pays, resolved through `companyOf` in
JavaScript rather than as a mongo filter, because a row whose `company` was never
filled in is still on a payroll and a query cannot see that. With nobody scoped
the query is byte-for-byte the one it always was.

### แผนก and บริษัท are both read from the roster at report time — so both edits are retroactive

Both are dimensions the same monthly reports are split by. They used to behave
oppositely; since **2026-09-08** they behave the same, and the change is the
point of this section. The heading read *"แผนก is snapshotted onto the entry ·
บริษัท is not — and that is why one edit is retroactive and the other is not"*
until that day.

| | where the report reads it from | editing the roster row |
|---|---|---|
| **แผนก** | `entry.employee.department` — the **สังกัดหลัก on the roster**, asked at report time (`groupEntriesByEmployee` in `lib/accountingRows.js`). `entry.department` is still written and still required; nothing reads it for a report any more. | **fully retroactive since 2026-09-08.** Every month that person has ever filed is counted under whichever department the roster says today, closed months included. |
| **บริษัท** | `companyOf(entry.employee)` — asked **at report time** (`lib/accounting.js`, via `groupEntriesByEmployee`). Nothing on the entry records a company. | **fully retroactive.** Every month that person has ever filed moves between the PM and THT files the instant the field is saved, closed months included. |

ทะเบียนพนักงาน warns about both and **both warnings now carry a count** — how
many months, how many ใบ, how many hours — from one read of that person's
approved entries (`/api/employees/:id/impact`, `moveImpact` in
`lib/rosterImpact.js`). บทบาท still gets no number, and should not: the sheet is
built entries-first so the roster filter only adds blank lines, and a count that
is always zero is a warning people learn to click past.

**Why แผนก changed.** It was snapshotted because a mid-month transfer has to
leave the hours where they were worked — the manager who signed them owns them,
and the department's ceiling was measured against them. That reading lost to a
different requirement on 2026-09-08: HR asked that **one person appear under one
department, their สังกัดหลัก**, on both สรุป OT ส่งบัญชี and สรุป OT แยกแผนก.
A person cannot be in one place and also stay where their old hours were worked;
the roster won. The price is stated plainly because it is real: **moving somebody
between departments restates months whose sheets have already been signed**, and
nothing in the app refuses that — ปิดงวด was withdrawn on 2026-08-31, so the
signed paper is the record and a restatement is invisible from inside. The guard
is the red dialog and its count. Measured on the live database the day it
changed, **0 of 2 entries were filed under a department other than their
owner's**, so nothing moved on the way in.

**Why บริษัท was always this way.** It started life as a *relabelling* of an
existing roster (`npm run migrate:company` filled it in from code prefixes), so
at the time the field was added, reading it live was the only way old months
could split at all.

**If you are about to change this** — most likely by putting one of the two back
on the entry so that history stops moving — `test/reportDimension.test.js` will
go red, deliberately. It pins today's behaviour on both axes so the change has to
be made on purpose rather than arrived at. Making it would also need a decision
about what to backfill the existing entries with (today's roster value is the
only thing available, which reproduces exactly the retroactive restatement the
change is meant to stop) and would need `RETROACTIVE_FIELDS` in
`lib/rosterImpact.js` and the dialog copy in `components/AdminView.jsx` to move
with it.

**Removing it.** If the two-company split is dropped for good: delete
`src/config/companies.js`, the `company` field and `pre('validate')` hook in
`src/models/Employee.js`, `src/migrate-company.js`, `test/companies.test.js`,
the `COMPANIES` list in `lib/api.js`, `lib/accounting.js` and the two routes
over it, `components/AccountingView.jsx` and its tab in `components/App.jsx`,
and the `company` handling in `app/api/employees/**` and the บริษัท column in
`components/AdminView.jsx`.

### เรียงตามลำดับตัวเลข — one comparator for every document of a month

ขอมาเมื่อ **2026-09-03**: *"ตรวจสอบประจำเดือนและรายงาน OT ฝ่ายบัญชี ใบต้องเรียง
ตามลำดับตัวเลขนะ"* · ทั้งสองจอ (และไฟล์ที่ส่งออกจากมัน) เรียงตาม**รหัสพนักงาน
แบบตัวเลข** ผ่าน `compareCodes` ใน `src/lib/employeeCode.js`

**ทำไม `localeCompare` เฉย ๆ ถึงใช้ไม่ได้กับทะเบียนนี้** ทะเบียนสะกดรหัสรูปแบบ
เดียวกันสองแบบ (`PM-0412` กับ `PM00416` — ดู §ทะเบียนพนักงาน) การเทียบทีละตัวอักษร
จะแยกทางกันที่ตัวที่สี่ `4` กับ `0` — เลขศูนย์ที่เติมมาเพื่อความยาว**ชนะ**ตัวเลข
ที่มันเติมให้ ผลคือรหัสห้าหลักทุกตัวลอยขึ้นไปอยู่เหนือรหัสสี่หลักทุกตัว:

| | ลำดับที่ได้ |
|---|---|
| เดิม (ทีละตัวอักษร) | PM00416 · PM00511 · PM-0100 · PM-0412 · PM-0620 |
| ตอนนี้ (ตามตัวเลข) | PM-0100 · PM-0412 · PM00416 · PM00511 · PM-0620 |

`compareCodes` ตัดรหัสเป็นช่วงตัวเลขกับช่วงตัวอักษรแล้วเทียบทีละช่วง — ตัวเลข
เทียบเป็น*จำนวน* ตัวอักษรเทียบด้วย `CODE_LOCALE` ที่ตั้งชื่อไว้ · **และตัดสิน
เสมอกันไม่ได้**: `PM-0620` กับ `PM620` เป็นคนละคนแต่เป็นจำนวนเดียวกัน ถ้าปล่อยให้
เสมอ `.sort()` จะสลับที่กันเองระหว่างการส่งออกสองครั้งของเดือนที่ไม่มีอะไรเปลี่ยน
จึงตัดสินด้วยสตริงที่ normalize แล้วเป็นด่านสุดท้าย

**ที่เดียว หกเอกสาร** — ตาราง `ตรวจสอบประจำเดือน` · `ส่งออกรายการ OT (CSV)` ·
`ส่งออกรายงานสรุปประจำเดือน (CSV)` · `รายงาน OT ฝ่ายบัญชี` (จอ ใบพิมพ์ และ CSV
อ่านจาก `lib/accounting.js` ตัวเดียวกัน) · `รายงาน OT แยกแผนก` ซึ่งถาม
`compareCodes` มาตั้งแต่เขียน · และตั้งแต่ **2026-09-07** คือ**รายการใบทุกใบที่
`GET /api/entries` ตอบ** ดูหัวข้อถัดไป · คนที่กระทบยอดใบที่เซ็นแล้วกับไฟล์ไล่นิ้ว
ลงทั้งสองใบพร้อมกัน สองใบคนละลำดับคือการทำงานนั้นสองรอบ

#### ทุก role ไม่ใช่แค่สองจอรายงาน — 2026-09-07

ขอมาเป็นประโยคเดียว: *"เรียงใบตามรหัสพนักงานทุก role"* · รอบ 3 ก.ย. แก้เฉพาะ
เอกสารของคนที่**ปิดเดือน** ส่วนจอที่คนอื่นเปิดทั้งวันคือรายการใบ ซึ่งยังเรียงตาม
วันที่อยู่ — `รายการรออนุมัติ` · `รออนุมัติ OT` · `รออนุมัติแทน` ·
`ไม่มีหัวหน้าเซ็น` · `คำขอถอนใบ` · `บันทึกและประวัติ OT` ทั้งหมดนี้คือ
`GET /api/entries` เราต์เดียว จึงเป็นการแก้ที่เดียวเช่นกัน ตัวเปรียบเทียบชื่อ
`byEmployeeThenLatest` อยู่ใน `lib/entries.js`

**ใหม่ไปเก่าเหมือนเดิม*ภายในคนคนเดียว*** — คีย์วันที่ยังเรียงจากมากไปน้อย ไม่ใช่
ความสวยงามแต่เป็นของที่พังได้จริง: `components/EmployeeView.jsx` วาด
`รายการล่าสุด` จาก `monthEntries.slice(0, 5)` ซึ่งคือห้าแถวแรกของรายการนี้ ถ้าเรียง
วันจากน้อยไปมาก การ์ดที่หัวเขียนว่า *ล่าสุด* จะโชว์ห้าใบที่**เก่าที่สุด**ของเดือน
โดยไม่มีอะไรบนจอบอก · และแปลว่า `?scope=mine` **ไม่ขยับเลย** เพราะรายการของคนเดียว
มีรหัสเดียว คีย์แรกจึงไม่ตัดสินอะไร · ไฟล์ที่ส่งออกยังเรียงวันจากเก่าไปใหม่ตามเดิม
ซึ่งเป็นเส้นแบ่งที่ `lib/complianceExport.js` เขียนไว้อยู่แล้วว่าจอตอบ *"เพิ่งเกิด
อะไรขึ้น"* ส่วนไฟล์ถูกอ่านจากบนลงล่าง

**คีย์ที่สามและสี่คือ `startTime` แล้ว `createdAt`** — คนหนึ่งถือสองใบในวันเดียว
ได้เมื่อมีใบข้ามคืน และใบที่ยื่นใหม่ชนกันได้ทั้งวันและเวลา สองแถวที่เท่ากันทุกคีย์
คือรายการที่สลับลำดับตัวเองระหว่างการเปิดสองครั้งของเดือนที่ไม่มีอะไรเปลี่ยน

**แต่ `.sort({ workDate: -1, createdAt: -1 })` บน query ยังอยู่ และต้องอยู่** — มัน
ตัดสินว่า*แถวไหนได้กลับมา*เมื่อรายการชนเพดาน 500 (`capFor`) ไม่ใช่ว่าวางเรียงยังไง
มองโกเรียงตาม `employee.code` ไม่ได้เลย (เป็น ObjectId จนกว่า `populate` จะเติม —
กับดักเดียวกับที่ `ส่งออกรายการ OT (CSV)` ติดมาหลายเดือน) แถวที่หลุดเพดานจึงยังเป็น
**ใบที่เก่าที่สุด** ตามที่แบนเนอร์เหนือตารางบอก ถ้าไปตัดตามรหัสแทน คนครึ่งหลังของ
ทะเบียนจะหายทั้งคนโดยไม่มีอะไรบอก

**`legacy/routes/entries.js` ไม่ได้แก้** — เป็น Express ที่ปลดระวางแล้วและตามหลัง
อยู่ก่อนแล้วในเรื่อง proxy filing กับ delegation (ดู §โครงสร้าง)

**และ `ส่งออกรายการ OT (CSV)` ไม่เคยเรียงตามรหัสเลย** — เจอวันเดียวกัน · เดิมเขียน
`.sort({ 'employee.code': 1, workDate: 1 })` ไว้บน query แต่ `employee` บนใบเป็น
ObjectId ที่ `populate` มาเติมทีหลัง มองโกจึงเรียงตาม path ที่ไม่มีในเอกสาร (ไม่
ปฏิเสธ แต่ไม่เรียงอะไรเลย) เหลือ `workDate` เป็นเงื่อนไขเดียวที่ทำงานจริง ไฟล์จึง
ออกมาเรียงตามวันโดยคนสลับกันไปมา ทั้งที่อ้างว่าเรียงตามคอลัมน์ที่มันไม่ได้เรียง ·
ตอนนี้เรียงใน JavaScript หลัง populate — รหัส แล้ววันที่ แล้วเวลาเริ่ม (คีย์ที่สาม
เพราะคนหนึ่งถือใบข้ามคืนบวกใบของวันนั้นได้ สองแถวที่เท่ากันทุกคีย์คือไฟล์ที่สลับ
ตัวเองได้)

### รายงาน OT ฝ่ายบัญชี — the submission sheet

**ฝ่ายบุคคล, ผู้ดูแลระบบ and การเงิน** — `COMPANY_REPORT_ROLES`, at
`/api/reports/accounting/:period` with the matching
`/api/exports/accounting.csv`. Both are built by `lib/accounting.js`, once: a
subtotal on the screen that disagreed with the file exported from it would be
found by accounting, not by us.

*(It read "**HR and Admin only**" until 2026-09-03. การเงิน are the desk this
sheet is SENT to, so being unable to open it was the odd part; they read it, and
they change no row of it. A หัวหน้างาน still cannot — this spans both payrolls
and every แผนก, and scoping it down would produce a submission sheet that is
silently incomplete.)*

**The sheet is built entries-first, and that order is load-bearing.** Every
approved entry makes a row, whoever filed it; the roster query
(`{ active: true, role: 'employee' }`) runs *afterwards* and only ADDS the blank
lines for people with no OT. So that filter decides whose **empty** row is
printed and nothing else — a manager who worked OT and somebody who left in
March are both on the sheet with their hours, because their entries put them
there. Built the other way round, the same filter would silently drop those
people's hours and the sheet would still balance against itself. This is pinned
by a source check in `test/accountingReconciliation.test.js`, because it is a
property of the order two loops run in and that is exactly the kind of thing a
later edit reverses while making a screen behave.

It differs from ตรวจสอบรายเดือน in two ways, and both are the point.

*It counts only `approved`.* There is no สถานะที่นับ selector here. The flow is
pending_mgr → pending_hr → approved, and `approved` **is** "HR ยืนยันแล้ว" —
HR's confirmation is the step that sets it. Anything still in the queue is
reported at the top of the screen ("ยังมีรายการค้างอนุมัติ n รายการ") and in
the หมายเหตุ column, but never added in. A sheet that reached accounting with
unconfirmed hours on it would be a payroll error, not a filter preference.

*It is partitioned by company.* One table per entity, labelled บริษัทที่ 1 and
บริษัทที่ 2, plus a รวมทุกบริษัท table for the covering note when both are
submitted together. The partition is decided in one place —
`companyOf()` — as stored field → code prefix → `DEFAULT_COMPANY`, so a
database that predates `npm run migrate:company` (where `company` is unset)
still splits correctly instead of filing everybody under one entity.

**The screen and the paper are two different documents, on purpose.** The
screen is ตรวจสอบรายเดือน's table — พนักงาน | แผนก | ×1.5 ปกติ | ×1.5 วันหยุด |
×3 | รวม ชม. | หมายเหตุ — because it is read by the same person on the same
day as that screen, and two review tables with different column sets is how a
month goes wrong. `/api/exports/accounting.csv` follows the screen column for
column, in the same order.

**ช่องค้นหาพนักงานถูกถอดออกจากหน้านี้แล้ว — 2026-08-27.** This screen carried
the same ค้นหาชื่อ หรือ รหัสพนักงาน box as ตรวจสอบรายเดือน from 2026-08-26, with a
300ms debounce, a highlight, a suggestion list under it and a pick that scrolled
to the row and lit it for 1800ms. It was asked for and it worked; it was removed
a day later, also because it was asked for, and the reason it went is the only
part worth keeping: **the card above the figures is the only thing between the
tab bar and the first table on a phone.** Measured on the built app at 360px,
that card was 488px tall and the box was 81 of them.

What went with it: `find` / `query` and `FIND_DEBOUNCE_MS`, the listbox and its
five keys, `goToRow()`, `FLASH_MS` and the `acct-row-` ids, the
"แสดง n จาก m คน" count, the sentence saying the totals and the CSV did not
follow the box, and the ไม่พบพนักงานที่ค้นหา empty state. The stylesheet lost
`.acct-find` and the `.acct-table` half of the row flash. Nothing shared went:
`personMatches`, `Highlight`, `.pick-menu.find-menu` and `.hit` all still have
callers, and `test/monthSearch.test.js` still pins every one of them for
ตรวจสอบรายเดือน — which keeps its box. **That is where "where is ถาวร" is asked
now.** This screen is where a month is CLOSED, and closing it is done by reading
the sheets against the paper, not by looking one person up.

**And the card gave back 95px in all.** 488 → 393, so รวมทุกบริษัท’s own card now
starts at 596 instead of 691 on a 360px phone. The other 14 are the last hint no
longer reserving `.card .hint`’s 14px under itself when nothing follows it, and
2 are the gap over the buttons coming down to the 12 `.export-row` already
states. **บริษัท and ประจำเดือน were tried side by side for another 63 and put
back**: 304px inside the card leaves ~146 a column, and at that width บริษัท read
`ทุกบริษัท · 3` and ประจำเดือน read `August 202`. The ledger and that dead end
are written over `.acct-controls` in the stylesheet.

**รวมทุกบริษัท is the first card now, not the last.** total → per company → per
person, which is the order somebody closing a month reads in and the opposite of
the order the figures are built in. At the foot of two company sheets, the one
figure the covering note carries was the last thing on the screen, reached past
every row of both.


**สรุป OT ส่งบัญชี บนมือถือ: ตารางนี้เลื่อนแนวนอน และนั่นคือคำตอบที่เลือกแล้ว.**
Below 860px this table is laid out at `width: max-content` and scrolls sideways
inside its card, with พนักงาน frozen at the left edge. Measured at 360px: the
card is 304px and the seven columns come to 560px — พนักงาน 112 · แผนก 80 ·
×1.5 ปกติ 52 · ×1.5 วันหยุด 58 · ×3 วันหยุด 58 · รวม ชม. 60 · หมายเหตุ 140 —
so three of the seven are on screen and **รวม ชม. and the whole หมายเหตุ column,
where *ค้างอนุมัติ n รายการ · ไม่นับรวม* is said, are reached by pushing the
table sideways.**

**ขอบขวาบอกว่ายังมีต่อ — และบอกเฉพาะตอนที่ยังมีจริง.** Below 860px the scroll box
draws a fade in the card’s own colour down its right edge, **in front of the
table rather than behind it**: a sticky `::after` pinned to the right of the
scrollport, inert to the touch (`pointer-events: none`), pulled back across the
table by a negative margin its own width so it adds nothing to the scroll width.
Where the browser can follow a scroll, its opacity does — so it is gone at the
far right and is never drawn at all on a table that fits.

Measured on the built app at 360px on 2026-08-27: the card is 304px, the sheet’s
`scrollWidth` is 560 and so is the table’s — the same figure as without it — and
a tap at the far right edge of a row lands on `td.rate-col`, not on the fade.
รวมทุกบริษัท comes to 399 in that 304px card, so it draws one too; on a phone
wide enough to hold it, it would not.

**It was four background gradients painted BEHIND the table** from 2026-08-17,
honest in the same way — covers that travel with the content, shadows pinned to
the box — but every cell with a background of its own hid them, and on these two
sheets three kinds have one: `thead th` and `tfoot td` are `--neutral-wash` and
`tr.grand td` is green. So the edge appeared over the rows and stopped dead at
the heading strip and again at รวมแผนก, which reads as a smudge on the middle
rows rather than as an edge — it was reported as no hint at all.

**It fades to the card, and it is not a shadow.** The element was a shadow for
the first afternoon of 2026-08-27, and a photograph off a phone in ธีมมืด ended
that: a darkening laid over something already dark, with `23.` cut clean through
the middle beside it. `--card` to `--card-fade` makes the figure DISSOLVE, which
is the difference between a number that was cut off and a number there is more
of. `--card-fade` is the card colour at zero alpha and exists for this —
`transparent` is rgba(0, 0, 0, 0), so fading to it fades through grey.

**The fade ships to every browser; switching itself off is the conditional
part.** It was the other way round for the same afternoon — the whole element
behind `@supports` — which left the phones that cannot follow a scroll with
nothing, and nothing is the state that was reported as a bug twice. So the
gradient is unconditional and only the opacity that follows the scroll sits
behind the gate. The cost is stated rather than hidden: on iOS Safari before 26
the fade is drawn at the far right too, where there is no more table. That is a
small untruth at one end of one gesture, and it was preferred to a screen that
says nothing at all.

**That is a known trade, not an oversight, and it was re-opened and closed on
2026-08-26.** A phone layout that fits the card was built, shipped to prod and
taken back off the same day. Four states were looked at, all at 360px:

| | what it was | why it went |
|---|---|---|
| **A** | this table — seven columns, sideways scroll | the one that was kept |
| **B** | each row a grid of five tracks: name + the four figures, with แผนก and หมายเหตุ folded onto a second line; nothing scrolls; `RateHead` gained a `short` so ×1.5 วันหยุด read ×1.5 หยุด | summary still at the foot of ~15 rows |
| **C** | B, with `order` on a flex table lifting รวมแผนก and รวมทั้งหมด up under the heading row | the folded rows read as fragments |
| **D** | C, with the cell padding the COMPACT rule leaves on a grid item taken back out — รวมแผนก 91px → 55, a person's row 109 → 76 | **แบบเดิมสวยกว่า** |

**The judgement was on looks and it is the right one to defer to** — this screen
is read by the person who closes the month, and a layout they find ugly is a
layout they will avoid. The folded version is not lost: it is
`ebc8340`, `d2a66af` and `69daf3f` on this branch, reverted whole by the commit
that follows them, docs and tests included. Anything that rebuilds it should
read those three first rather than start again from the same measurements.

**The two things that made it worth trying are still true**, and are what to
weigh against the scroll if this comes back: seven columns of Thai do not fit
304px at any type size that can be read — tighter padding, smaller figures and
shortened headings together buy about 60px against a 256px overrun — and the
roster is 20 active people, 15 of them ไพรมัส, so the tall case is about 15 rows
in one company table.


The **paper form** is the accounting sheet: รหัส | ชื่อ-นามสกุล | **1.50** |
**3.00** under one ประจำเดือน banner, then the unruled remark strip. It combines วันปกติ and
วันหยุด into the single 1.50 column because the form has one, and anyone
reconciling the CSV against it adds those two columns. That is the only place
the two representations differ, and it differs because the paper is what gets
signed.

#### `unaccounted` / `reconciliation` — the one error the sheet cannot show

Every figure on these reports is a total of something visible, which means a
shortfall is invisible: the rows add up to the subtotals, the subtotals to the
grand total, and สรุป OT ส่งบัญชี to สรุป OT แยกแผนก — **all of them short by
the same amount**, all of them internally consistent. Somebody signs a total
that is wrong and there is nothing on the page they could have checked.

There is exactly one way in. An entry whose `employee` reference no longer
resolves has no row to land on. No route hard-deletes an employee — deactivating
is the supported path and it keeps the hours — so this arrives from a restore, a
half-finished import, or a fix applied straight to the database. It used to be
skipped by a bare `continue`.

So the report now carries two extra fields, both from
[`lib/accountingRows.js`](lib/accountingRows.js):

- **`unaccounted`** — `{ count, hours, entries[] }`. Nought in every ordinary
  month.
- **`reconciliation`** — `{ filed, reported, unaccounted, balanced }`, the sheet
  checking itself: **filed = reported + unaccounted**. Three sums over a month
  already in memory. Computed against every row the month produced, never the
  filtered view, or picking one company out of two would read as a shortfall —
  the loudest possible warning fired by the most ordinary possible action.

It shows up in four places: a red banner on both report screens, a **line on the
paper** of both printed forms, and a `ไม่ถูกนับ` row at the foot of both CSVs.
The paper matters most — the screen banner is seen by whoever pressed print, and
the person who signs is usually not that person.

On the accounting sheet the line **costs no row**: it renders inside the thead
margin band, so `ROWS_PER_PAGE = 37` and the spare-line arithmetic under the
last name are untouched, and with nothing missing the component returns `null`
and the sheet is byte for byte what it was. (`ROWS_PER_PAGE` is measured, not derived, so
anything above the grid goes in that band rather than in a row of its own.) On
the departmental sheet it is
one line under `รวมชั่วโมงทำOT`, and only on the **รวมทุกแผนก** closing sheet:
an unaccounted entry belongs to no department, so printing it under one
department's total would assert something untrue about that department.

The CSV line is the same shape as the `รวมแผนก` / `รวมทั้งหมด` / `รวมทุกบริษัท`
rows already in those files — blank `รหัสพนักงาน`, label in the name column —
so it adds no new case to a consumer that was already correct, and it is written
last, after the grand total. It is built by `unaccountedCsvRow(headers, …)`,
which sizes the row from the caller's own header array and places values **by
column name**: a row one cell short of its header opens with every column after
it shifted, which is a worse outcome than the missing hours it is reporting.

**What HR can actually do about it: nothing, in the UI.** `entry.employee` is
written once, at submission, and no route touches it afterwards — re-pointing an
orphan is a database job. The banner says so outright, because a warning that
sends somebody hunting for a button that does not exist is one that gets
dismissed by the second month. What it gives them instead is the **name of the
person who filed it**, read from `history[0].byName` — a copy of the name taken
at submission, denormalised so a deleted employee could not erase an audit
trail, which turns out to be exactly this case. "Find สมชาย in the roster" is
something HR can do; a 24-character ObjectId is not. The id, workDate,
department and the dangling reference are all there too, for whoever opens the
database. That last one needs a second unpopulated read of those few entries —
`populate()` replaces a reference to a missing document with `null` and throws
the id away with it.

**On screen the company is headed the way accounting names it — `PM · ไพรมัส`,
`THT · เดมเทค`.** The code leads because this is the one sheet another
department reconciles against and their records are keyed on it; the full legal
name stays underneath, because the figures are signed for by a company and not
by a code. **The printed sheet carries no company heading at all** — accounting
asked for the paper as the grid alone, so a loose page is placed by the PM- /
THT- prefixes in its รหัส column rather than by a line naming the company.
`accountingLabel()` is therefore a screen-and-CSV label, not a paper one.
`accountingCode` lives on `src/config/companies.js` as its own field
rather than reusing `codePrefixes`: the prefix is a convention the roster
follows and this is a label accounting has committed to, and if either moves it
should not drag the other with it. Nowhere else in the system is renamed — the
employee form, the profile and the department report are read by people who know
the company by name.

The CSV gains a **`company_code` column beside บริษัท**, not instead of it.
Replacing the Thai column would break every sheet and lookup already built on
the file; leaving it out would mean accounting mapping "ไพรมัส" to PM by hand
every month, which is a step that goes wrong quietly. Both columns, and neither
side has to change anything. Its header is unlocalised ASCII because it is what
their system matches on, not something a person reads.

**Summary rows sit in the foot of the same table** — one per department, then
the company — rather than in a second table beside it, so every figure is read
down the column it belongs to. A subtotal of zero prints blank like the people
in it; the company line always prints a figure, because a blank where the total
that gets signed for belongs reads as "not filled in".

**แสดงพนักงานที่ไม่มี OT** lists **every active person with no hours**,
whatever their บทบาท, as blank rows — the way the paper sheet does. A blank line
is accounting's evidence that somebody was checked, not skipped. A zero prints
blank rather than `0.00`, on the screen and in the CSV alike.

It read "active `employee`-role people" until **2026-09-08**, and that filter was
leaving **21 of the 164 active people off both sheets**: 10 ผู้จัดการแผนก,
7 หัวหน้างาน, and one each of การเงิน, ฝ่ายบุคคล and ผู้จัดการฝ่าย. §2 says a
manager's ordinary OT is not payable; it does not say the department has fewer
people in it, and a หัวหน้างาน with no line at all is indistinguishable from one
who was missed. The one exclusion is the **ADMIN** account — `ผู้ดูแลระบบ`, the
system escalation login rather than somebody on a payroll (`ADMIN_ROLE` in
`lib/accounting.js`). If it ever files OT its entries put it on the sheet anyway:
this filter decides blank lines and nothing else, which is the property
`test/accountingReconciliation.test.js` exists to hold.

**The printed sheet** (`components/AccountingPrint.jsx`, styles under `.acct`
in `app/print.css`) is the paper form HR already sends, and only that: four
ruled columns — รหัส, ชื่อ-นามสกุล, **1.50**, **3.00** — under one ประจำเดือน
banner, with nothing above the grid but the ไม่ถูกนับ flag in the months that
have one, and nothing below it: no subtotal rows, no total, no signature block.
Same print setup as F-HR-027, **A4 portrait, “ค่าเริ่มต้น” margins, no
scaling**, sharing its `@page` rule.

The ruled grid is 112mm of the 194mm, and everything on the sheet lines up with
it. That is not a layout accident: on the paper, remarks — “วันเกิด” beside a
name — were written by hand in the white strip *beside* the table. That strip is
now the sheet's fifth column, and it is drawn as paper rather than as part of the
form: 82mm, no heading, no rules, no tint, and empty except where a row has a
remark. The one remark it prints is “วันเกิด” — see
[Where “วันเกิด” is printed](#where-วนเกด-is-printed). Everything else the system
wants to say about a row still goes on the screen and in the CSV.

Two things differ from F-HR-027 by design. It always lists the full roster
regardless of the screen's checkbox, because a submission sheet with names
missing cannot be checked against anything. And it is **one company per
sheet**: the two file separately, so a page carrying both would have to be cut
up by hand. A roster longer than a page breaks across pages with the column
headings repeated rather than being shrunk to fit — unlike F-HR-027, this
sheet has no fixed number of rows to preserve.

**The preview is a stack of A4 sheets, and one element is one side.** The sheet
has been A4 to the millimetre since it was written — 194mm of body inside two
8mm bands is the 210mm width, and `min-height: 295mm` is the side, the 2mm of
slack being what stops a sheet measuring 297.1mm from ejecting a blank page into
the middle of a bundle. What it had no line for was where one sheet *stopped*:
white paper on a light grey desk, a soft shadow and 16px between, so a four-side
bundle read as one continuous scroll of white, and the question this screen
exists to answer — how many sheets of paper is this, and which company is on
which one — was answered by the print dialog, after deciding to print. Every
side is now its own `.acct`: a white card with a hairline edge (`--paper-edge`)
and a 2px radius, 32px of desk between one and the next, and a label in the top
right — `หน้า 3 / 4 (PM · ไพรมัส)`.

**It read differently for one afternoon on 2026-09-08.** The first answer was
one card per COMPANY with a dashed fold rule drawn across it at each page
boundary, and the argument for it is worth keeping because it is the argument
this had to answer: the card was the unit the *printer* broke on, so cutting the
preview into sides was a second pagination standing beside the browser's own,
with the sheet riding on the two agreeing. What settled it is that the second
pagination is now the *only* one. `paginate` in `components/AccountingPrint.jsx`
cuts the rows at `ROWS_PER_PAGE`, and 36mm of bands and headings plus 37 rows of
7mm is 295mm inside a 297mm page box — so every element is a page the paginator
has nothing left to break, and `.acct + .acct { break-before: page }` puts one
on each side. A rule drawn across a continuous white block was a picture of a
page break; this is a page.

**Every side carries its own headings and its own margin bands**, rendered into
each element rather than left to `display: table-header-group` to repeat — so a
page that comes loose from the stapled set looks on the screen exactly like the
one in your hand. A new company always starts a new side, which now falls out of
the loop rather than being a rule of its own. The five blank ruled lines stay
where they were: under the last name in the company, on the last side only.

**None of the card reaches the printer, and two parts of it may not.** The label
names the company — the one thing accounting asked to have taken off this sheet,
which is why a page that comes loose is placed by the PM- / THT- prefixes in the
รหัส column instead — so it is `no-print`. And the border is 1px on a block that
is `box-sizing: content-box` and exactly 210mm: left on, the sheet is wider than
the paper, and a browser fitting the page to its printable area answers that by
scaling the whole form down, moving every figure on it. The `@media print` block
in `app/print.css` takes the edge, the radius, the positioning and the gap off
again. `test/printFlagLayout.test.js` pins each of those, beside the ไม่ถูกนับ
flag it already held to the same promise.

**The same treatment is on the other two print views**, and one of them needed
the same cut. **สรุปชั่วโมงทำ OT แยกแผนก** (`components/DepartmentPrint.jsx`) is
33 rows to a side — 12mm band, 9mm banner, 7.5mm headings, 12mm band and 33 rows
of 7.5mm is 288mm — and a department longer than that runs onto a second side
with its green banner and its column headings repeated and its ลำดับที่ still
running, 1–33 then 34–45. The closing block — the two blank numbered lines,
รวมชั่วโมงทำOT and the ไม่ถูกนับ line — travels to the **last** side and only
that one, because a total at the foot of every side is two pages each claiming to
be the department's total. **F-HR-027** (`components/PrintForm.jsx`) needed no
cut: it is a fixed 31-row form that is one side by design, so the bundle only
gained the card and a label that counts **forms** rather than pages —
`ใบที่ 12 / 40 (สมชาย ใจดี)` — because a month with enough split sessions is
allowed to run onto a second side and a page count would be a number that
component cannot promise.

**Five blank ruled lines follow the last name, and no more.** They are what the
paper form gave you: somewhere to write in somebody who was missed between
printing the sheet and signing it. Until 2026-08-25 the last page was padded out
to a full `ROWS_PER_PAGE` instead — measured on the live database that day, the
month's two sheets carried **fourteen names and sixty blank ruled rows**, and a
company with four people printed a grid ruled to the foot of the page. A sheet
ruled to the bottom is not more usable than five lines; it is the same five
lines somebody writes on, under twenty-two they do not, and it reads as a roster
that is missing people.

**The five cannot change the page count**, and that is the property to keep if
the number is ever edited. Pages are `ceil(rows / 37)` — decided by the names —
and the filler is capped at the room left on the page the last name is already
on, so it can fill that page and can never start another. Printed to PDF through
the built app at 10, 35, 40, 67 and 80 people on 2026-08-25: **1, 1, 2, 2 and 3
pages, the same before the change and after it.** The one case that shows why
the cap is against the room and not a flat five is 36 rows, where it clips to a
single line; a flat five would have spilled onto a second side.

It is a different decision from `SPARE_ROWS` on the departmental sheet, which is
2 and stays 2: those lines are numbered and sit inside a department's own
ลำดับที่, so each one is a promise the sequence is still running. These are
unnumbered paper.

### และกล่องแนะนำบนตรวจสอบประจำเดือน — กดชื่อแล้วเข้าไปแก้ไขได้เลย

The third caller of that box, added the same day, and the first where picking a
suggestion does something other than move the page.

**Everything above is unchanged and shared.** The same `personMatches`, the same
`FIND_DEBOUNCE_MS` of 300 with its `find` / `query` pair and its early return for
✕, the same `Highlight` computed by `matchRanges()`, the same `.pick-menu`
`.find-menu` panel, the same five keys, the same "nothing is drawn when nothing
matches". A row reads:

```
[PM-0412] สมชาย ใจดี
วิศวกรรม | 15.5 / 40 ชม.
```

The first line is the same line ส่งบัญชี draws, from the same expression, and
`test/monthSearch.test.js` holds both to it. The second line is the difference. ส่งบัญชี prints `hours()` because its sheet has
no ceiling column; this prints **`capFigure(row.cap.usedHours, row.cap.capHours)`
— over the same `row.cap` the สะสม / เพดาน column reads on the row it takes you
to**, so a suggestion and the row it opens cannot quote a person's month
differently.

**The two are the same figures in two forms, and since 2026-08-26 they are not
the same string.** This paragraph read "the same helper … A department with no
ceiling reads `3 ชม.` with no denominator, exactly as its cell does" until then,
and the second half of that stopped being true when the ceiling COLUMN went over
to `capPair`: a cell under a heading that says "สะสม / เพดาน" now answers with
both halves always — `3 / —` where the department sets none — while this line,
which ends in `ชม.` and is a sentence rather than a column, keeps `capFigure`
and still reads `3 ชม.`. Same `row.cap`, same arithmetic, same rounding; the
dash is a column's business. See `capPair` in `lib/caps.js`, which is written
beside `capFigure` and says which is for which.

**Picking somebody OPENS their month.** This screen is where a month is checked
and where a wrong figure is corrected, and correcting it means being inside
**ดู / แก้ไขรายการ** for one person — so the pick puts HR there, rather than
scrolling to a row and stopping as it does on ส่งบัญชี, where the row *is* the
answer.

**Which makes the scroll and the flash deferred, and that is the whole of the
mechanism.** `setOpened()` replaces this entire screen by an early return, so at
the moment of the pick there is no row in the document to scroll to and no
element to light — and 1800ms of flash fired then would burn down while HR was
still reading the entries. `goToRow()` therefore records a request (`jump`) and
an effect spends it later, when `data` is back and none of `opened`, `auditing`
or `printing` is set. That is the moment HR presses **กลับไปสรุปรายเดือน**: the
list is drawn again, the page moves to their row and it lights. `flash` is a
second piece of state and not the same one, because the request and the lighting
are two different moments.

**The filter is left alone; the page is not, and they are not the same thing.**
`goToRow()` never calls `setFind` or `setQuery` — `test/monthSearch.test.js`
asserts both as negatives — because clearing the box would throw away the
narrowing somebody just did and make the row they asked for one of sixty again
the moment they came back to it. But below 860px the list is **five cards at a
time** and everybody else carries `off-page`, which is `display: none`: a person
on page 7 has no element on the screen to scroll to at all. So the page that
*holds* them is set from their place in `shown`, the same list the pager counts.
Above 860px there is no pager and `off-page` has no rule, so nothing a reader can
see changes there.

**And the flash is painted on the ROW here, the opposite of ส่งบัญชี's answer to
the same question.** This table has no sticky column, and below 860px the `<tr>`
*is* the card — it carries the fill, the border and 15px of padding, and the
cells inside it are bare blocks. Lit cell by cell it would come up green in
stripes with its own padding left plain. That card is also the one row in the app
whose real background the stylesheet **can** name, and therefore must: `rowFlash`
ends at `transparent`, which on a card with a `--card` fill finishes by showing
the page's ground through it for a frame, so the phone gets `rowFlashCard`, which
ends at `--card`. One extra `@keyframes`, and it is the only thing that differs.

**Walked on the built app, 2026-08-26**, against the live month at 360px and
1280px, and against a throwaway clone of it inflated to fourteen people so the
pager had somewhere to go. At 360px the panel is **304px wide, 4px under the
box**, max-height "264px" on the day of the walk and `min(240px, 40vh)` since
2026-08-27, `overflow-y: auto`, `z-index: 5`, `aria-expanded`
true and `aria-activedescendant` on the first row; the marks land on whole Thai
clusters (`สุ ส สุ สิ` for "ส"). Typing `สม` gave **11 suggestions of 14 people**;
picking the last opened *รายการ OT — สมหมาย ก้าวหน้า*, and **กลับไปสรุปรายเดือน**
came back on **หน้า 3 / 3** with the box still holding `สม`, the row carrying
`row-flash` and no `off-page`, `animation-name: rowFlashCard`, the row at 474px
of an 800px viewport, and the light gone within two seconds. At 1280px the panel
is 806px wide, the animation is `rowFlash`, and ↓ ↓ walks to the third row with
`aria-activedescendant` following, ↑ steps back, Escape shuts it, a click reopens
it and Enter opens the active person's month.

---

## รายงาน OT แยกแผนก — the departmental count

Its own tab for HR and Admin, beside สรุป OT ส่งบัญชี
(`components/DepartmentView.jsx`, the sheet in `DepartmentPrint.jsx`, styles
under `.otdept` in `app/print.css`).

**It answers the other question the month asks.** สรุป OT ส่งบัญชี partitions
by company, because the two entities file their payroll separately. This one
merges them and partitions by **แผนก**, because a department is one team
however its people are paid — the same room, the same shift, one number.
Splitting a department down the middle by payroll would answer neither
question.

Neither screen is a filter of the other, and both are built from the same
`accountingReport()` payload, regrouped in `lib/departmentSummary.js`. There is
one count of the month and two ways of adding it up, so the two screens cannot
disagree about a figure — and only the grouping had to be written, not a second
report.

The screen is สรุป OT ส่งบัญชี's, card for card: the same filter card and month
picker, the same แสดงพนักงานที่ไม่มี OT checkbox, the same backlog warning, and
one card per department closing with a รวมชั่วโมงทำOT foot.

Where that screen has บริษัท then ประจำเดือน, this one has **แผนก then
ประจำเดือน** — the same pair of controls in the same order, the narrower
question first. The dropdown lists ทุกแผนก, then one option per department,
each carrying its hours (`แผนกผลิต 1 · 644 ชม.`) so the month can be read off
the closed select. Both pickers format their options through `withHours()` in
`lib/api.js` — one control asking two different questions. Departments are a list that grows; two companies are two
companies. If the department selected is not in the month being shown — nobody
in it worked OT, or it has since closed — the picker falls back to ทุกแผนก
rather than sitting blank over an empty page. **The dropdown filters the screen
only.** พิมพ์แบบฟอร์ม always prints every department: the bundle is the
month's, and a page missing from it is not a filter preference.

What differs from the accounting screen is the columns: **1.50 | 3.00 | รวม ชม.**, the printed form's, not ตรวจสอบรายเดือน's
three rate buckets. This screen exists to be checked against the paper it
prints, and a column here that is not on the paper is a figure with nothing to
check it against. บริษัท is a column on the screen only — the reader can see
which payroll a name belongs to — and is not on the paper, which has no such
column.

### The file

**ส่งออกไฟล์แยกแผนก (CSV/Excel)** → `/api/exports/departments.csv`. The same
month as `accounting.csv`, added up the other way, and laid out like the screen
it comes from: each department's people in ลำดับที่ order, that department's
**รวมชั่วโมงทำOT** line, then **รวมทุกแผนก** at the end. Those รวม lines are in
the data rather than on a second sheet because this file is read by somebody
reconciling it against a signed form, not pivoted — and they carry no
รหัสพนักงาน, so a filter on that column still isolates the employee rows. UTF-8
BOM, as §10 requires, or Excel on Thai Windows renders every ชื่อ-สกุล as
mojibake.

Two columns exist here that are not on the paper: **แผนก**, because a row in a
file has to say which department it belongs to once the banner above it is
gone, and **บริษัท**, because a department holds both payrolls and payroll is
who gets asked about a figure.

Like the printed bundle, the file always covers **every** department whatever
the dropdown says — it is the month's file, and a department missing from it is
not a filter preference. แสดงพนักงานที่ไม่มี OT does ride along: whether
somebody with no hours gets a line is a question about the file.

### The printed form

One table per แผนก, **one department per side of paper**, printed as a single
document, closed by a **รวมทุกแผนก** sheet — the last page, both companies in
it, one line per department, which is where the covering signature goes.

Four columns under a green banner naming the department — ลำดับที่,
ชื่อ-นามสกุล, **1.50**, **3.00** — closed by a **รวมชั่วโมงทำOT** row whose
grand total sits in a yellow cell *outside* the grid, to the right of 3.00. No
title, no month, no บริษัท column, no signature block: the paper carries none,
and the sheet is meant to be laid beside it. The month is named on the screen
and on nothing that prints. Same print setup as the sheets above — **A4
portrait, “ค่าเริ่มต้น” margins, no scaling**, sharing their `@page` rule.

It is a different document from the accounting sheet, not a variant of it. That
one is the flat roster accounting receives, keyed by รหัสพนักงาน, split by
company and never split by department. This one is keyed by a ลำดับที่ that
restarts at 1 in every department, and is only meaningful split that way — so
the same ลำดับที่ appears on the screen, and a line can be read against its
printed line by eye.

Three details are the paper's, and each is load-bearing:

- **The tint belongs to the column, not to the figure.** Both hour columns are
  filled top to bottom — a figure, the blank where a figure would have gone,
  and the รวมชั่วโมงทำOT total all sit on the same colour — so the eye reads
  one band down the page, somebody with no OT is a gap in it rather than a
  differently-coloured cell, and the total reads as the foot of the column
  above it. The yellow cell is the one deliberate break, and it is outside the
  grid.
- **Two blank numbered lines** close every department — the line already
  exists, so a name missed between printing and signing can be written in.
  `SPARE_ROWS` in the component. The รวมทุกแผนก sheet has none: a department
  missing there is a whole sheet missing from the bundle, which is not
  something to write in by hand.
- **The yellow total is 1.50 + 3.00 as printed**, summed from the printed
  columns rather than from `otHours`, so the sheet adds up to what is on it.
  `sumRows()` does this once, for the screen and the paper alike.

Like the accounting sheet it always lists the full roster regardless of the
screen's checkbox. It fits ~34 lines to a side, so a department larger than
that continues onto a second page with the banner and column headings repeated
— the department a page belongs to has to be legible on every page it covers.

---

## Status

Written and complete: engine, models, API, exports, printable form, and the
role UIs. *(It read "the four role UIs" until 2026-09-03 — there are seven
บทบาท now, drawing five different menus between them.)*

บทบาททั้งเจ็ดใช้งานได้ครบตั้งแต่ 2026-09-03 บ่าย · ย่อหน้านี้เคยอ่านว่า
"**บทบาทมีเจ็ด แต่หน้าจอยังมีสี่** … บัญชีที่ตั้งเป็นสามบทบาทใหม่วันนี้จะล็อกอิน
เข้ามาเจอแท็บว่างเปล่า **จึงยังไม่ควรตั้งให้ใครจนกว่าขั้นที่สองจะลง**" ระหว่าง
เช้าถึงบ่ายของวันเดียวกัน — ตอนนี้ `maySubmitOt` จริงสำหรับทุกบทบาท และเมนูกับ
`defaultTab` เปิดด้วย `isSigner` จึงครอบทั้งสี่บทบาทที่ถือแผนก · **การเงินมีเมนู
ของตัวเองอีกหนึ่งบล็อก** ตั้งแต่เย็นวันเดียวกัน — ตรวจสอบประจำเดือน กับ
รายงาน OT ฝ่ายบัญชี ทั้งบริษัท อ่านอย่างเดียว · **ยังไม่มีแถว
ไหนในฐานข้อมูลนี้ถือสามบทบาทใหม่** เพราะทะเบียนจริง 163 คนยังไม่ได้นำเข้า —
ข้อนี้จึงยังไม่ได้เดินบนบัญชีการเงินจริง มีแต่ที่ตรึงไว้ด้วยเทสต์และเดินบนแอปที่
build แล้ว

**Verified**

- **ไม่พักเที่ยง บนแถวรายการ เป็นไฮไลท์สีแดง** — 2026-09-08, สั่งมาระหว่างอ่านหน้า
  รออนุมัติ OT: *ตรงไม่พักเที่ยงขอเป็นไฮไลท์สีแดง*.
  **สองป้ายในช่องเดียวกันไม่ใช่ข้อเท็จจริงชนิดเดียวกัน** — ข้ามคืน *อธิบายกะ* บอกว่า
  เวลาจบเป็นของวันไหน และไม่ขยับตัวเลขด้วยตัวเอง จึงยังเป็นสีเหลืองเงียบ ๆ ของ
  `.cell-note` · ส่วน ไม่พักเที่ยง คือป้ายเดียวบนแถวที่**บวกหนึ่งชั่วโมงเข้าไปในยอด**
  ที่อยู่ถัดไปสองคอลัมน์ เพราะชั่วโมงพักถูกหักจากทุกใบในตารางยกเว้นใบนี้ — ซึ่งเป็นสิ่งที่
  คนตรวจคิวกำลังกวาดตาหาอยู่พอดี.
  **เป็นมาร์กบนคำ ไม่ใช่พื้นทั้งช่อง** — `display: block; width: fit-content` พื้นสีที่
  กินทั้งช่องของตารางที่ไม่รู้ความกว้างจะอ่านเป็นสถานะของ*ทั้งแถว* · `white-space:
  nowrap` มาด้วยเหตุผลเดียวกัน: ตัวหนังสือธรรมดาที่ตัดคำอ่านเป็นประโยคที่ยังไม่จบ
  แต่การตัดคำในก้อนสีอ่านเป็นกล่องที่แตก — ซึ่งเกิดขึ้นจริงใน ประวัติการขอ OT ที่
  คอลัมน์ เวลา กว้างไม่ถึง 100px.
  **ใช้ `--danger-bg` / `--danger-ink`** คู่เดียวกับที่ ไม่อนุมัติ ใส่อยู่ — มีแดงเดียว
  ในระบบ และไฮไลท์ตามธีมมืดได้เองเพราะทั้งคู่เป็น `light-dark()` · **ไม่ใช่ `.chip`**
  เพราะทุกเม็ดยาบนแถวนั้นเป็น*สถานะ* (รอหัวหน้า · รอ HR · เหมารายวัน) เม็ดที่สี่ที่
  ไม่ใช่สถานะคือวิธีที่คนอ่านเรียนรู้ว่ารูปทรงไม่ได้แปลว่าอะไร.
  **ทั้งสองตาราง มาร์กเดียวกัน** รออนุมัติ OT คือที่ที่สั่งมา ส่วน ประวัติการขอ OT
  บนหน้าของพนักงานเองคือช่องเดียวกันของตารางเดียวกันเกี่ยวกับใบเดียวกัน · **ไม่ขึ้น
  บนใบ F-HR-027** เพราะ `[ไม่พักเที่ยง]` ที่นั่นคือกระดาษ ซึ่งไม่มีธีมและไม่มีสีตรงนี้.
  ✅ `npm test` **2380/2380** ผ่าน 2026-09-08 (เดิม 2379 · ไม่มีไฟล์เทสต์ใหม่ ·
  `entryRowChrome` รับเพิ่มหนึ่งเคส) · ✅ build ผ่านบน distDir แยก ·
  **วัดบนแอปที่ build แล้วที่ :3001** บนสำเนาของฐานจริง (`primus_ot_flag` · 76 ใบ ·
  ลบทิ้งแล้ว · `:3000` ไม่ได้รันอยู่เลย) — ธีมสว่าง `rgb(251,234,231)` พื้น /
  `rgb(180,64,47)` ตัวอักษร · ธีมมืด `rgb(51,26,19)` / `rgb(255,169,142)` ·
  **ก้อนกว้าง 67px ในช่อง 108px** (คิว) และ **67px ในช่อง 98px** (หน้าพนักงาน) —
  ไม่กินทั้งช่องทั้งสองที่ · ข้ามคืน ยังเป็น `rgb(168,121,26)` สว่าง /
  `rgb(214,166,124)` มืด ตามเดิม · **รอบแรก nowrap ยังไม่มี และมันตัดเป็นสองก้อน
  จริง ๆ ในหน้าของพนักงาน** — เจอจากการดูภาพ ไม่ใช่จากเทสต์ · ตรวจซ้ำที่ 1440px
  ทั้งสองธีมและที่ 390px ธีมมืด (การ์ดบนมือถือ) · ❓ ยังไม่ได้ deploy.

- **ช่องติ๊ก ไม่พักเที่ยง โชว์เฉพาะวันหยุดของบริษัท — เสาร์อาทิตย์และวันหยุดตามประกาศ
  ไม่รวมวันเกิด** — 2026-09-08, สั่งมาประโยคเดียว: *ช่องติ๊กไม่พักเที่ยง โชว์เฉพาะ
  วันหยุดเสาร์อาทิตย์และวันหยุดของบริษัท ไม่รวมวันเกิด*.
  **บนวันธรรมดา มันเป็นคำถามเกี่ยวกับชั่วโมงที่ไม่มีใครทำงานคร่อมอยู่** — เย็นวันอังคาร
  17:00–20:00 ไม่ผ่านเที่ยง ติ๊กแล้วไม่มีอะไรขยับ และตัวควบคุมที่ไม่ทำอะไรเลยคือ
  ตัวควบคุมที่สุดท้ายจะมีคนติ๊ก.
  **ข้อยกเว้นที่ฝ่ายบุคคลขอ คือเส้นเดียวกับที่ระบบกั้นไว้อยู่แล้ว** — สวัสดิการวันเกิดเป็น
  วันหยุด*ของคนคนเดียว* คิดจากวันเกิดที่เก็บไว้ ซึ่งจอนี้**ไม่มีสิทธิ์ถือ**
  (`publicEmployee` ตัด `birthDate` ออกจากทะเบียนที่หัวหน้าอ่าน) · กฎจึงถูกตอบ
  **ในเบราว์เซอร์** จากปฏิทินวันหยุดบริษัท + `weekendDays` และวันเกิดไม่มีทางเข้ามา
  แม้โดยบังเอิญ เพราะไม่มีอาร์กิวเมนต์ให้ส่งเข้ามา — `isCompanyOffDay` ใน
  `lib/entries.js`.
  **สองอย่างที่ได้มาฟรีจากการไม่อ่านจาก preview**: ใช้ได้บน บันทึก OT แทนพนักงาน
  **ก่อน**ติ๊กลูกทีม (preview ยังไม่มา แต่วันเสาร์ก็เป็นวันเสาร์อยู่ดี) และ**ไม่กระพริบ**
  เพราะปฏิทินถูกดึงปีละครั้ง ไม่ใช่ทุกครั้งที่พิมพ์เวลา.
  **ช่องที่ติ๊กไว้แล้วถูกวาดเสมอ** — ติ๊กบนวันเสาร์แล้วย้ายวันที่ไปวันอังคารในนั่งเดียวกัน
  ถ้าไม่กันไว้ ช่องจะหายพร้อมธงที่ยังเป็น true และชั่วโมงพักหนึ่งชั่วโมงจะไม่ถูกหักโดย
  ไม่มีอะไรบนจอเอากลับได้ · เอาติ๊กออกคือสิ่งที่ทำให้ช่องหาย.
  **ไม่มีอะไรตรงนี้ตัดสินตัวเลข** `noBreakTaken` ยังเป็นฟิลด์ที่ทางเขียนรับ และเอนจิน
  ยังหักชั่วโมงพักจากมันเหมือนเดิม · `weekendDays` ถูกเพิ่มเข้าไปในสิ่งที่
  `/api/auth/me` ส่ง เพื่อการวาดนี้อย่างเดียว · ดึงปฏิทินไม่สำเร็จ = ช่องไม่ถูกวาด
  ซึ่งเป็นทางที่ผิดแบบปลอดภัย.
  **และแถบทั้งแถบหายเมื่อไม่เหลือช่องไหนเลย** ซึ่งตอนนี้เกิดขึ้นได้จริง: บันทึก OT
  แทนพนักงาน บนวันอังคารธรรมดาโดยยังไม่ติ๊กใคร ไม่มีทั้งสามช่อง.
  ✅ `npm test` **2379/2379** ผ่าน 2026-09-08 (เดิม 2374 · ไม่มีไฟล์เทสต์ใหม่ ·
  `otFormChecks` รับเพิ่มห้าเคส) · ✅ build ผ่านบน distDir แยก ·
  **เดินบนแอปที่ build แล้วที่ :3001** ที่ 390×844 ผ่าน CDP บนสำเนาของทะเบียนจริง
  (`primus_ot_ticks` · ลบทิ้งแล้ว · `:3000` ไม่ได้รันอยู่เลย) ในฐานะ **PM00073
  เจ้าหน้าที่บริการ** — **อังคาร 08/09 ไม่มีช่อง** · **เสาร์ 05/09 มีช่อง** ·
  **ศุกร์ 04/09 ซึ่งเป็นวันเกิดของเขา ไม่มีช่อง** ทั้งที่หน้าจอขึ้นบรรทัด
  “วันเกิดของคุณ” และชั่วโมงลงช่อง **OT วันหยุด นอกเวลา ×3** จริง ๆ — ซึ่งเป็นข้อ
  ที่พิสูจน์ข้อยกเว้น · **พุธ 12/08 วันแม่แห่งชาติ มีช่อง** · **อังคาร 11/08 ไม่มีช่อง** ·
  ติ๊กบนเสาร์ 05/09 แล้วย้ายไปอังคาร 01/09 **ช่องยังอยู่และยังติ๊ก** เอาติ๊กออกแล้ว
  **ช่องหายไป** · ทั้งวันเกิดที่ย้ายมา 04/09 และการเปิดหน้าต่างยื่นย้อนหลังเป็นการแก้
  **บนสำเนา** เพื่อให้วันที่ที่ต้องการอยู่ในระยะที่ปฏิทินกดถึง · ❓ ยังไม่ได้ deploy.

- **แถบช่องติ๊กบนฟอร์มบันทึก OT เหลือสามช่อง เรียงใหม่ และเหมารายวันแสดงเฉพาะเจ้าหน้าที่บริการ**
  — 2026-09-08, สั่งมาสองประโยค: *ในหน้าบันทึกการทำงานล่วงเวลา ช่องติ๊กเรียงจาก
  วันเกิด >> เหมารายวัน >> ไม่พักเที่ยง ตัดช่องติ๊กข้ามคืนออก* · *ช่องติ๊กเหมารายวัน
  แสดงเฉพาะ เจ้าหน้าที่บริการ*.
  **ลำดับใหม่บอกว่าแต่ละช่องไปไกลแค่ไหน** — วันเกิด กับ เหมารายวัน ตอบคำถามเดียวกันว่า
  *วันนี้เป็นวันแบบไหน* และทั้งคู่เขียนกลับขึ้นไปในช่องเวลา จึงอยู่บนสุดใกล้สิ่งที่มันเปลี่ยน
  ส่วน ไม่พักเที่ยง เป็นเรื่องของหนึ่งชั่วโมงในกะ จึงอยู่ท้าย · เดิมเรียง ข้ามคืน →
  ไม่พักเที่ยง → เหมารายวัน → วันเกิด แบ่งเป็น "เรื่องของกะ" แล้ว "เรื่องของวัน"
  ซึ่งเป็นคำอธิบายที่จริงของสี่ช่องที่ไม่มีอยู่แล้ว.
  **ข้ามคืนไม่เคยเป็นคำถามที่ตอบได้สองแบบ** เอนจินรับค่า `endsNextDay` ได้ค่าเดียว
  ต่อคู่เวลาหนึ่งคู่ และ throw ใส่อีกค่า — ทุกการติ๊กจึงไม่ซ้ำซ้อนก็เป็น error จากเซิร์ฟเวอร์
  ที่อ่านว่า *A single session cannot exceed 24 hours* ซึ่งเป็นประโยคเรื่องเพดาน
  สำหรับสิ่งที่จริง ๆ แล้วคือช่องติ๊กที่อยู่ผิดสถานะ · ตอนนี้คิดจาก `endsNextDayFor`
  ทุกครั้งที่เวลาขยับ (`setStart` / `setEnd`) และ **ฟิลด์ไม่ได้หายไปไหน** ยังถูกส่ง
  ยังถูกเก็บ ยังเป็นตัวที่เอนจินกับใบ F-HR-027 อ่าน — เปลี่ยนแค่ว่าใครเป็นคนตอบ.
  **สิ่งที่เสียไป พูดตรง ๆ**: กะ 17:00 ที่จบ 20:00 ของ*วันถัดไป* (ยี่สิบเจ็ดชั่วโมง)
  ยื่นไม่ได้อีกแล้ว — แต่เอนจินปฏิเสธมันด้วย `TOO_LONG` อยู่ก่อนแล้ว ไม่มีใบไหนที่เคย
  บันทึกได้แล้วบันทึกไม่ได้.
  **คนกรอกยังรู้ว่ากะข้ามคืน** — บรรทัดสีเหลือง `ข้ามคืน · สิ้นสุดวัน…ถัดไป` ข้างช่อง
  เวลาสิ้นสุด อ่านจาก `form.endsNextDay` ตัวที่กำลังจะถูกส่งจริง.
  **กฎตำแหน่งเป็น ตำแหน่ง ไม่ใช่ แผนก และเทียบทั้งสตริง** — ทะเบียนจริงมี
  `เจ้าหน้าที่บริการ` เก้าคน ส่วน `หัวหน้าแผนกบริการ` อยู่แผนกเดียวกันและ**ตั้งใจ**
  ไม่ให้เห็นช่องนี้ ถ้าจับคำว่า `บริการ` แบบ substring จะดึงแถวนั้นเข้ามาด้วย และ
  ตำแหน่งอื่นที่มีคำนี้ทุกตำแหน่งหลังจากนั้น — ความผิดพลาดแบบที่ไม่มีใครแจ้ง เพราะช่อง
  ที่โชว์ให้คนมากเกินไปหน้าตาเหมือนช่องปกติทุกประการ.
  **ถามตำแหน่งของคนที่ใบนี้เป็นของเขา** ไม่ใช่ของคนที่กำลังกรอก — ฟอร์มตัวเอง
  และหน้าที่ฝ่ายบุคคลแก้ใบของเขา ใช้ `position` ที่จอซึ่งถือคนอยู่แล้วส่งเข้ามา
  (ฟอร์มนี้ไม่ยิงหาใคร) ส่วน บันทึก OT แทนพนักงาน อ่านจาก**ลูกทีมที่ติ๊กไว้** ด้วย
  `every` ไม่ใช่ `some` และต้องมีคนติ๊กอย่างน้อยหนึ่งคน — ชุดหนึ่งถูกยื่นด้วยติ๊กชุดเดียว
  กันทุกคน ช่องที่โผล่เพราะหนึ่งในแปดคนเข้าเงื่อนไขคือช่องที่เขียน เหมารายวัน ทับอีกเจ็ดคน.
  **เป็นกฎว่าวาดอะไร ไม่ใช่ว่ารับอะไร** ทางเขียนไม่ถูกแตะ — `flatDaily` ยังเป็นฟิลด์ที่
  `POST /api/entries` รับจากใครก็ได้ และทุกแถวที่ถืออยู่แล้วยังถูกอ่าน พิมพ์ และคิดเงิน
  เหมือนเดิม · **ช่องที่ติ๊กไว้แล้วจึงถูกวาดเสมอ** ไม่ว่าตำแหน่งจะเป็นอะไร ไม่งั้นใบที่ยื่น
  ก่อนกฎนี้ หรือใบที่ฝ่ายบุคคลติ๊กจาก แก้ไขชั่วโมง จะเปิดมาพร้อมแปดชั่วโมงที่ไม่มีตัวควบคุม
  ไหนบนจอเอาออกได้.
  **`แก้ไขชั่วโมง` บน รออนุมัติ OT ไม่ถูกแตะทั้งสองข้อ** — ช่อง เหมารายวัน ที่นั่นไม่มี
  กฎตำแหน่ง (มันคือที่ที่ติ๊กผิดถูกแก้) และช่อง ข้ามคืน ที่นั่นยังอยู่แบบเทาอ่านอย่างเดียว
  เพราะคนที่กำลังตรวจใบของคนอื่นกำลังอ่าน*บันทึก* และธงนั้นเป็นส่วนหนึ่งของสิ่งที่เขาตรวจ.
  ✅ `npm test` **2374/2374** ผ่าน 2026-09-08 (เดิม 2366 · `otFormChecks` เป็น
  ไฟล์เทสต์ที่ 131) · ✅ **build ผ่านแล้ว** บน distDir แยกที่ :3001 — `/` ตอบ 200
  และ API ตอบ 401 ตามประตูสิทธิ์ ไม่ใช่ 500.
  **แต่เทสต์ทั้ง 2374 ข้อผ่านอยู่ตอนที่แอปคอมไพล์ไม่ผ่าน** — คอมเมนต์ JSX ใน
  `components/HrEntries.jsx` ถูกวางเป็นลูกตัวแรกของ `return (` โดยไม่มี fragment ห่อ
  ไม่มีเทสต์ข้อไหนในชุดนี้เห็น เพราะไม่มีข้อไหนคอมไพล์ไฟล์นั้น
  *(แก้แล้ว — คอมเมนต์ย้ายขึ้นไปอยู่เหนือ `return (` เป็นคอมเมนต์ JS ธรรมดา และ build
  รอบถัดมาคอมไพล์ผ่าน)* ·
  ✅ **เดินบนจอจริงในฐานะผู้ใช้ที่ล็อกอินแล้ว** บนแอปที่ build แล้วที่ :3001 ที่ 390×844
  ผ่าน CDP บนสำเนาของทะเบียนจริง (`primus_ot_ticks` · 164 คน · ลบทิ้งแล้ว) —
  **เจ้าหน้าที่บริการ PM00073** เห็นสามช่อง เรียง `วันเกิด · เหมารายวัน · ไม่พักเที่ยง`
  ตรงลำดับ · **พนักงานผลิต1 PM00112** เห็นสองช่อง `วันเกิด · ไม่พักเที่ยง` ·
  **หัวหน้าแผนกบริการ THT0052** เปิด บันทึก OT แทนพนักงาน ยังไม่ติ๊กใครเห็นช่องเดียว
  ติ๊กลูกทีมที่เป็นเจ้าหน้าที่บริการแล้วช่อง เหมารายวัน โผล่ · **ทะเบียนจริงไม่มีทีมผสม
  สักทีมเดียว** (เจ้าหน้าที่บริการทุกคนอยู่แผนกที่เป็นตำแหน่งนี้ทั้งหมด) จึงสลับตำแหน่ง
  THT0136 เป็น พนักงานผลิต1 **บนสำเนา** เพื่อทดสอบ `every` — ติ๊กสามคนแรกช่องอยู่
  ติ๊กคนที่สี่ช่องหายทันที · **คำว่า ทำงานข้ามคืน ไม่ปรากฏในหน้าเลย** และตั้งเวลาสิ้นสุด
  เป็น `02:00` ผ่านตัวเลือกเวลาจริง แล้วขึ้นบรรทัดเหลือง
  **`ข้ามคืน · สิ้นสุดวันพุธถัดไป`** เอง พร้อม preview **9 ชม.** จากเซิร์ฟเวอร์ ไม่มี error ·
  **ใบเหมาที่ยื่นไว้แล้วของคนที่ตำแหน่งไม่เข้าเงื่อนไข** (ยิงผ่าน API ตรง ๆ ให้ PM00112)
  เปิด แก้ไขรายการที่ยื่นไว้ แล้ว**เห็นช่อง เหมารายวัน ติ๊กอยู่** เอาออกได้ ·
  ❓ ยังไม่ได้ deploy — ขณะนี้ **ไม่มีอะไรรันอยู่ที่ :3000 เลย**
  และ `.next` ไม่มี `BUILD_ID` ค้างอยู่.

- **ประวัติการแก้ทะเบียน folds each record down to its heading line** —
  2026-09-08, asked for as a collapsible list: the badge, the code and name, the
  account and the stamp on one row with a chevron at the end of it, and the
  `ค่าเดิม → ค่าใหม่` diff sliding open underneath.
  **The list is everybody's changes at once**, newest first, up to the
  endpoint's cap of 100 — and a record that moved four fields printed four
  arrow lines under its head. So "who touched the roster on Tuesday", the
  question this section exists to answer and which nothing else in the system
  can, was answered with two screens of diffs about fields nobody had asked
  after. **Measured on the built app: the list is 3,513px folded against
  27,786px with every record open at 1280, and 8,733 against 66,735 at 360px** —
  the same hundred records in **an eighth of the height**.
  **`TrailList` draws two screens and only one of them folds.** The same
  function renders the ประวัติการแก้ทะเบียน pop-up opened from one person's row,
  and that one is left flat on purpose: it holds ONE person's trail and was
  opened by somebody who has already said whose history they want, so the diff
  is the whole of what they came for and a fold would put a press between a
  question and its answer. `foldable` is its own prop rather than being read off
  `withWho`, which means something else and agrees with it only by accident.
  **กรองตามสิ่งที่ถูกแก้ arrives open**, and it is the one filter of the four
  that does. Somebody who has just asked for only the records that changed
  วันเกิด is asking about the DIFF; a column of headings would have hidden the
  thing they filtered for. The other three narrow who and what kind, both of
  which are already on the heading line.
  **The slide is `Disclosure`'s, class for class** — `.disclosure-slide` around
  a `.disclosure-body`, the `0fr → 1fr` grid row that animates to a height
  nothing had to measure. Reused rather than rewritten, so the visibility
  handoff that keeps folded content off the tab order, the
  `prefers-reduced-motion` rule and the `@media print` block that unfolds
  everything for paper all reach this without having been told it exists. What
  is NOT reused is the control: `Disclosure` draws its own อ่านต่อ link and
  cannot be handed another, and here the whole heading is the handle — a real
  `<button>`, because a 9px glyph is a target nobody hits with a thumb.
  **A record with nothing under its heading gets no chevron.** A fold over
  nothing is a control that lies about there being more. A ตั้งรหัสผ่านใหม่
  changes no field, but the sentence saying the password itself was never
  written down IS its body, so it folds like the rest.
  ⚠️ **One bug found in this round's own CSS and fixed before it shipped.** The
  5px between a heading and its diff went in as `padding-top` on the body, and
  the fold then never closed: measured folded, `grid-template-rows` computed to
  **5px** instead of 0. `min-height: 0` is what lets a `0fr` track resolve to
  nothing and it is about the CONTENT box — padding sits outside it, so five
  pixels of padding are five pixels the track cannot give up. It is a margin on
  the first child now, inside the box the slide already clips.
  **Walked on the built app at :3001 against a clone of the live database
  (`:3000` untouched, and `primus_ot_verify` dropped after)**, as ADMIN over
  CDP, dark theme, at 1280 and 360px. 100 records, **all 100 foldable and none
  drawn with a dead chevron**. Folded: `grid-template-rows: 0px`, body
  `visibility: hidden`, chevron `transform: none`. Open: `52.5px` at 1280 and
  `133.25px` at 360, body visible, chevron `matrix(-1, 0, 0, -1, 0, 0)` — one
  glyph turned over rather than two swapped. The heading is a `BUTTON` with
  `cursor: pointer` and `aria-expanded` flipping false → true. ขยายทั้งหมด
  relabels itself หุบทั้งหมด off the folds rather than off a flag of its own,
  and the round trip lands back on the exact figure it started from: card
  **3,951.6 → 28,224.6 → 3,951.6px**. No overflow on the card and none on the
  document at either width.

- **ใบ F-HR-027 มี 31 บรรทัดทุกเดือน และช่องลงชื่อเหลือแค่ชื่อ** — 2026-09-08,
  สั่งมาสองประโยคพร้อมชื่อใบเต็ม: *ฟิควันที่ 1-31 วันทุกเดือนเสมอ · ช่องลงชื่อพนักงาน
  และช่องลงชื่อหัวหน้างาน ตัดคำนำหน้านาย นาง นางสาวและนามสกุลออก เหลือแค่ชื่ออย่างเดียว*.
  **ข้อแรกคือรูปของกระดาษ ไม่ใช่ปฏิทิน** — ตารางเคยยาวเท่าจำนวนวันจริงของเดือน
  (กุมภาพันธ์ 28 บรรทัด เมษายน 30) ส่วนแบบฟอร์มกระดาษตีเส้น 1–31 ไว้ทุกใบ · แฟ้มที่
  เซ็นแล้วถูกอ่านเทียบข้ามเดือนด้วยตา ใบที่สั้นกว่าเพื่อนสามบรรทัดจึงเป็นใบที่ต้องนับก่อน
  ถึงจะเทียบได้ · **บรรทัดที่เกินปลายเดือนไม่มีวันที่ (`date: null`)** ไม่ใช่แค่ว่างเปล่า —
  ไม่มี `2026-02-30` ให้ segment ไหนไปตรงกับมันได้ และ `byDate` สร้างจากแถวที่มีวันที่
  เท่านั้น สามบรรทัดนั้นจึงว่างโดยโครงสร้าง ไม่ใช่ว่างเพราะบังเอิญไม่มีใครลง ·
  `formGridDays` อยู่ใน `lib/reports.js` ข้าง `formDayTypes` เพราะจำนวนบรรทัดของใบ
  ต้องถูกตัดสินที่เดียว · **คีย์ของแถวเปลี่ยนจากวันที่เป็นเลขวัน** ไม่งั้นสามแถวท้าย
  กุมภาพันธ์ได้คีย์ `null-0` เหมือนกันหมด.
  **ข้อสองเป็นการกลับคำอธิบายที่เขียนไว้เองเมื่อ 6 วันก่อน** — `firstName` ตัดนามสกุล
  มาตั้งแต่ 2026-09-02 ด้วยกฎ "คำแรกที่คั่นด้วยช่องว่าง" และมีโน้ตกำกับว่าปลอดภัยเพราะ
  *ไม่มีใครในทะเบียนเขียนคำนำหน้าแยกเป็นคำ* — วัดจาก 22 คนที่ seed ไว้ และยัง**จริง**
  เมื่อทะเบียนจริง 164 คนเข้ามา · ประโยคที่จริงแต่ไม่ได้ป้องกันอะไรเลย เพราะทะเบียนจริง
  เขียนคำนำหน้า**ติด**กับชื่อ ช่องลงชื่อจึงพิมพ์ `นายไพฑูร` และ `นางสาวปิยะนุช` ·
  **`NAME_TITLES` เรียง นางสาว ก่อน นาง** เพราะ นาง เป็นคำนำหน้าของ นางสาว — สลับ
  ลำดับแล้ว `นางสาวปิยะนุช` จะเซ็นว่า `สาวปิยะนุช` ซึ่งเป็นชื่อที่อ่านได้แต่ไม่ใช่ของใคร ·
  **ชื่อที่เหลือต้องไม่ว่าง** ชื่อที่มีแต่คำนำหน้า หรือเขียนคำนำหน้าแยกคำ ตกไปใช้คำถัดไป
  แทนที่จะคืนค่าว่าง · **คำนำหน้าที่ไม่อยู่ในลิสต์พิมพ์ติดไปกับชื่อ** (ว่าที่ ร.ต. · ดร.)
  เห็นบนกระดาษและแก้ด้วยการเติมอีกบรรทัดในลิสต์ ไม่ใช่ด้วยการเดา · **หัวใบ ชื่อ-สกุล
  ไม่ถูกแตะ** ยังพิมพ์ชื่อเต็มพร้อมคำนำหน้า สิ่งที่ขอคือสองช่องลงชื่อ.
  ✅ `npm test` **2313/2313** ผ่าน (เดิม 2306 · เจ็ดเคส ไม่มีไฟล์ใหม่) · **เดินบนแอปที่
  build แล้วที่ :3001** (`VERIFY_DIST_DIR=.next-verify` · :3000 ให้บริการตลอดและยัง
  เสิร์ฟอยู่หลังจบ · ลบ distDir แล้ว) เข้าเป็น `PM00002 นางสาวปิยะนุช พรมประชุม` จริง:
  **กันยายน 2569 (30 วัน) ตารางมี 31 บรรทัด** บรรทัดที่ 31 ว่างเปล่า และแถววันที่ 7
  พิมพ์ `ปิยะนุช` กับ `ปรเมษฐ์` ในสองช่องลงชื่อ · **กุมภาพันธ์ 2569 (28 วัน) ก็ 31
  บรรทัด** ครบถึงเลข 31 · `Page.printToPDF` ขนาด A4 ทั้งสองเดือน **ได้ 1 หน้า** ·
  API ตอบ 31 แถวทุกเดือนที่ลอง (2569-01 · 02 · 04 · 09 และ 2567-02 ปีอธิกสุรทิน
  ได้ 29 แถวที่มีวันที่ + 2 แถวว่าง) · ❓ ยังไม่ได้พิมพ์ลงกระดาษ A4 จริง · ❓ ยังไม่ได้
  deploy — `:3000` ยังเสิร์ฟ build เดิม.

- **ตัวอักษรไทยทั้งระบบเป็นตัวมีหัวแล้ว — `IBM Plex Sans Thai` → `IBM Plex Sans
  Thai Looped`** — 2026-09-07, สั่งมาว่า *เปลี่ยนตัวอักษรทั้งระบบให้เป็นตัวอักษรที่มีหัว
  ทั้งระบบเลยให้มันอ่านได้ง่าย ๆ*.
  **ที่มา** ดีไซน์เดิมมาพร้อม `IBM Plex Sans Thai` ซึ่งเป็นตัวไม่มีหัว — อ่านสวยแต่ ด/ค,
  ต/ค, น/ม แยกกันด้วยรายละเอียดเล็กมากเมื่อไล่ลงตารางหกสิบแถว ส่วนหัวคือสิ่งที่
  โรงเรียนและแบบฟอร์มราชการทุกใบสอน.
  **เลือกตัว Looped ของ IBM เอง ไม่ใช่ฟอนต์ตระกูลอื่น** เพราะเป็นแบบเดียวกัน
  metric เดียวกัน น้ำหนักครบสี่ระดับเท่ากัน — **ไม่มีขนาด ระยะบรรทัด หรือกล่องไหน
  ในไฟล์ขยับตามเลยสักจุด** ถ้าเปลี่ยนไปใช้ Sarabun หรือ Prompt คือต้องวัดใหม่ทั้ง
  ระบบ.
  **สี่ไฟล์** `app/layout.js` กับ `lib/pdfExport.js` (ลิงก์ Google Fonts ของหน้าจอและ
  ของ PDF) · `app/styles.css` (`--sans`) · `app/print.css` (ทั้งเจ็ดจุดของใบพิมพ์).
  **`--mono` กับ `--latin` ไม่แตะ** — หัวเป็นเรื่องของตัวอักษรไทย และสองตัวนั้นไม่มี
  ไทยอยู่เลย ตัวเลขจึงยัง tabular เหมือนเดิม · **`TH Sarabun New` ถูกเสียบเป็นตัวสำรอง
  ใน `--sans`** เพราะถ้าโหลดฟอนต์ไม่ได้ Windows จะตกไปที่ Leelawadee UI ซึ่งไม่มีหัว
  อีก — ตัวสำรองที่ล้มการเปลี่ยนแปลงไม่นับเป็นตัวสำรอง (`print.css` ทำแบบนี้อยู่แล้ว).
  ✅ `npm test` **2319/2319** ผ่าน · **เดินบนแอปที่ build แล้ว** (`VERIFY_DIST_DIR=
  .next-verify-font` · `next start -p 3007` · :3000 ให้บริการตลอดและยังตอบอยู่หลังจบ)
  ที่ 390×844 ธีมมืด ในฐานะ `ADMIN`: `document.fonts.check('16px "IBM Plex Sans Thai
  Looped"')` เป็น `true` · **ฟอนต์ที่หน้าโหลดจริงมีสองตระกูลเท่านั้น** `IBM Plex Sans
  Thai Looped` กับ `IBM Plex Mono` · ไม่มีที่ไหนใน HTML ขอตัวไม่มีหัวอีก · ข้อความไทย
  ที่สุ่มมาหกจุด (หัวเรื่อง แบนเนอร์วันหยุด ชื่อแท็บ ป้ายในการ์ดแผนก) คำนวณออกมาเป็น
  `"IBM Plex Sans Thai Looped"` ทั้งหมด · ภาพหน้าจอยืนยันด้วยตา: ก ถ ภ ญ มีหัวครบ
  และการ์ด ชิป ปุ่ม แถบล่าง อยู่ตำแหน่งเดิมทุกอัน.

- **ไม่ต้องมีช่องเหมารายวันบนใบ — แปดชั่วโมงของใบเหมาวันทำงานปกติกลับไปอยู่
  ช่อง เริ่ม 17.01-07.59 (วันจ.-ศ.) ตามเดิม** — 2026-09-07, สั่งมาพร้อมภาพใบจริงว่า
  *ไม่ต้องมีช่องเหมารายวัน 8.00-17.00 (วันจ.-ศ.) คือเหมารายวันคือใส่ชั่วโมงในช่อง
  เริ่ม 17.01-07.59 (วันจ.-ศ.)*.
  **ถามกลับก่อนแก้ เพราะช่องนั้นคือช่องที่ฝ่ายบุคคลรวมลงกล่อง OT×1.5 วันปกติ ท้ายใบ**
  — คำถามคือแปดชั่วโมงนั้นเป็น OT ×1.5 ด้วยไหม หรือแค่พิมพ์ในช่องนั้นเฉย ๆ · ตอบมาว่า
  **“ใช่ — เป็น OT ×1.5 เหมือนเดิมก่อนหน้านี้”** จึงเป็นการถอนกฎของบ่ายวันเดียวกัน
  กลับทั้งชุด ไม่ใช่แค่ย้ายตัวเลขบนกระดาษ.
  **สิ่งที่ถูกถอนคืน** — ครึ่งวันทำงานที่ให้ช่องอัตราสามช่องเป็นศูนย์และเก็บแปดชั่วโมง
  ไว้ที่ `totals.normalHours` · ช่องที่สี่บนใบและหัวช่องของมัน · pass ที่สองในเราต์ใบ
  และการขยาย `onSheet` · ประโยคใต้ป้ายเขียวที่แยกเป็นสองแบบพร้อมตัวเลือกของมัน
  (เหลือ `FLAT_DAILY_SAY` ประโยคเดียวเหมือนเดิม) · คำเตือน “ชั่วโมงในช่วง OT
  ไม่ถูกนับ” ของใบวันทำงาน · **ตารางกลับเป็นเก้าคอลัมน์** สามช่อง OT กลับไป 22mm
  และ รายละเอียดงานที่ทำ กลับไป 51mm.
  **สิ่งที่ยังอยู่** — ใบเหมาบนวันหยุดยังเป็น `ot15_holiday` 8 · `ot3_holiday` ยังเป็น
  ศูนย์บนใบเหมาทุกใบ · เวลาจบยังบวกให้เอง 9 ชม. · ป้ายบนคิวรออนุมัติ · และค่า
  `formPrintScope` บนฐานจริงของรอบก่อนหน้า · `totals.normalHours` กลับไปเป็นศูนย์
  ทุกใบที่ engine คำนวณ แต่ยังอยู่บนโมเดล เพราะแถวที่เขียนไว้ระหว่าง 4–7 ก.ย. ยังถืออยู่.
  **สองแถวบนฐานจริงที่เก็บ `ot15_weekday` 8 ไว้** (`PM00112 22/07` `รอ HR` และ
  `THT0107 06/07` **อนุมัติแล้ว**) **ตรงกับกฎที่ใช้จริงแล้ว** จึงไม่มีอะไรต้องคิดใหม่ —
  ข้อค้างของรอบก่อนหน้าปิดไปด้วยการถอนกฎ ไม่ใช่ด้วยการเขียนฐาน.
  **⚠ ยังไม่ได้เดินด้วยตาบนแอปที่ build แล้ว และยังไม่ได้ deploy** — `:3000` ยังเสิร์ฟ
  build เดิม · `npm test` 2278/2278 ผ่าน · `formSignatures` กลับไปนับเก้าเซลล์ และ
  เพิ่มการตรวจ colgroup กับ colSpan ที่หัวตาราง เพราะการถอนคอลัมน์คือการแก้ที่ทิ้ง
  span ค้างไว้ได้ง่ายที่สุด.
- **ใบขึ้นตั้งแต่หัวหน้าอนุมัติ จริง ๆ บนเครื่องนี้แล้ว** — 2026-09-07, แจ้งมาเป็น
  แถวจริง: *วีระพงษ์ ศรีมงคล PM00112 วันที่ 22/07/2569 ไม่ขึ้นในใบอนุมัติ ทั้งที่
  หัวหน้าอนุมัติแล้ว คือในใบสามารถขึ้นได้เลยถ้ามีคนกดอนุมัติแล้วไม่ต้องรอ HR*.
  **ค่าที่เก็บไว้ยังเป็น `approved`** ทั้งที่ไฟล์ ship `signed` มาตั้งแต่เช้า —
  `Setting.policy` บังเงาไฟล์เงียบ ๆ เดือน 07/2569 ของคนนี้จึงถูกกรองออกสองแถว
  (20/07 กับ 22/07 ทั้งคู่ `รอ HR`) · **แก้แล้วบนฐานจริง** `approved` → `signed`
  ผ่าน `savePolicy` เพื่อให้ otPolicyVersions ได้แถวเหมือนกดจากหน้าตั้งค่าระบบ
  (seq 24 · มีโน้ตกำกับ · actor ADMIN) · ไม่มีอะไรถูกคิดใหม่และไม่มีตัวเลขไหนขยับ
  เพราะคีย์นี้เป็น cosmetic · สำรองฐานก่อนเขียน · **เป็นค่าที่เก็บ จึงไม่เดินทาง**
  ฐานใหม่ได้ `signed` จากไฟล์ ส่วนฐานนี้ต้องบอกมันเอง.
  **เดินจริงบนสำเนาฐานด้วยแอปที่ build แล้ว** — restore ลง `primus_ot_walk` แล้วเปิด
  `:3005` คนละ distDir คนละฐาน (`:3001` มีคนใช้อยู่ ตรวจก่อนแล้ว) · ใบ 07/2569 ของ
  PM00112 ออกมา `printScope: signed` สิบสองแถว รวมสองแถว `รอ HR` · ปิดเซิร์ฟเวอร์
  ลบฐาน walk ลบ distDir แล้ว · **การแก้นี้ยังอยู่** ไม่ได้ถูกถอนไปกับช่องที่สี่.
- **ป้าย เหมารายวัน และ OT สวัสดิการวันเกิด ขึ้นบนคิวรออนุมัติแล้ว** — 2026-09-07,
  *ถ้าพนักงานติ๊กช่องเหมารายวันหรือวันเกิด ให้ขึ้นแท็กในรายละเอียดหน้ารออนุมัติ OT
  ด้วย เพื่อให้ผู้อนุมัติรู้*. ป้ายทั้งสองมีมาก่อนแล้วและอยู่บนทุกจอที่อ่านใบ
  **หลัง**ตัดสิน — หน้าของพนักงานเอง และ รายการ OT ของฝ่ายบุคคล — แต่ไม่เคยอยู่บน
  จอที่ตัดสิน · ขึ้นสองที่บนจอนั้น คือคอลัมน์ `รายละเอียด` และป๊อปอัปที่ปุ่มใน
  คอลัมน์นั้นเปิด (เหนือ `dl.fact-grid` เพราะบรรทัดถัดไปคือ `เวลาที่ขอ` ซึ่งบนใบ
  เหมาคือเวลาที่ป้ายกำลังบอกว่าอย่าเอาไปคูณ) · ไม่ได้อ่านช่องติ๊กกลับมา:
  `entry.flatDaily` เป็นฟิลด์บนใบ ส่วนวันเกิดอ่าน `segments[].dayReason` ที่ engine
  เขียน · **และข้อความตอนชี้ป้ายวันเกิดถูกตัดท่อนท้ายทิ้ง** — *ฝ่ายบุคคลเป็น
  ผู้บันทึกและอนุมัติรายการนี้ให้* จริงเฉพาะกับข้อตกลงที่ถูกถอนไปเมื่อ 2026-09-03
  และรอดมาได้เพราะไม่เคยมีจอไหนวาดป้ายนี้ตรงที่มันผิดชัด ๆ · **⚠ ยังไม่ได้เดิน
  ด้วยตาบนแอปที่ build แล้ว** — ที่ยืนยันคือ `npm test` และ build บน `distDir`
  ต่างหากแล้ว grep บันเดิล: ทั้งสองจุดอยู่ใน chunk ของคิวจริง · บนฐานข้อมูลนี้มี
  ใบเหมาที่ยังไม่อนุมัติอยู่ใบเดียว (22/07/2569 `pending_hr`) และยังไม่มีใบวันเกิด
  ที่รออนุมัติเลย จึงเป็นแถวเดียวที่จะเห็นป้ายตอนเดิน
- **เรียงใบตามรหัสพนักงาน ทุก role ไม่ใช่แค่สองจอรายงาน** — 2026-09-07, สั่งมาว่า
  *เอางี้ดีกว่าคือเรียงใบตามรหัสพนักงานทุก role เลยดีกว่า* ต่อจากรอบ 3 ก.ย. ที่แก้
  ไว้เฉพาะ `ตรวจสอบประจำเดือน` กับ `รายงาน OT ฝ่ายบัญชี`
  · **แก้ที่เดียว** — หกจอที่ลิสต์ใบ (`รายการรออนุมัติ` · `รออนุมัติ OT` ·
  `รออนุมัติแทน` · `ไม่มีหัวหน้าเซ็น` · `คำขอถอนใบ` · `บันทึกและประวัติ OT`) เป็น
  `GET /api/entries` เราต์เดียวกันหมด ตัวเปรียบเทียบคือ `byEmployeeThenLatest`
  ใน `lib/entries.js` ซึ่งถาม `compareCodes` ตัวเดียวกับอีกห้าเอกสาร
  · **`?scope=mine` ไม่ขยับ** และวันที่ยังใหม่ไปเก่า*ภายในคนคนเดียว* เพราะ
  `รายการล่าสุด` บน `บันทึกและประวัติ OT` คือห้าแถวแรกของรายการนี้ตรง ๆ
  · **เพดาน 500 ยังตัดใบที่เก่าที่สุดเหมือนเดิม** — `sort` บน query ไม่ได้ถูกถอด
  มันตัดสินว่าแถวไหนได้กลับมา ส่วนตัวเปรียบเทียบตัดสินว่าวางเรียงยังไง
  · ⚠ **ยังไม่ได้เดินด้วยตาบนหน้าจอ และยังไม่ได้ deploy** — ตรึงไว้ด้วยเทสต์
  (`entryListCap` ห้าเคส · `employeeCode` หนึ่งเคสที่อ่านซอร์สของเราต์) `npm test`
  2240/2240 ผ่าน · `:3000` ยังเสิร์ฟของเดิม
- **เหมารายวัน คิดตามวัน — แปดชั่วโมงเป็น OT ×1.5 ลงคอลัมน์ที่วันนั้นเป็น** —
  2026-09-07, สั่งมาว่า *ให้คิดตามวันไปเลย **ถ้าวันหยุดก็ใส่ 8 ชั่วโมงวันหยุด
  ถ้าไม่ใช่วันหยุดก็ใส่ 8 ชั่วโมงวันปกติ** แต่แค่เป็นแบบเหมา*.
  **คอลัมน์เป็นของวัน** — เสาร์อาทิตย์ วันหยุดบริษัท หรือวันเกิดของคนยื่นเอง ลง
  `ot15_holiday` · วันทำงานลง `ot15_weekday` · ไม่มีโค้ดตรงไหนตัดสินชนิดของวันซ้ำ
  `resolveDayTypes` ตอบไว้แล้วและสาขานี้แค่อ่าน.
  **ความยาวเป็นของช่องติ๊ก** — `flatDailyMinutes(policy)` เท่านั้น เข้าก่อน ออกก่อน
  หรืออยู่ถึงสองทุ่มก็เท่าเดิม.
  **อัตราคือ ×1.5 เสมอ ไม่อ่านจากนาฬิกา** — บนวันหยุดทุกนาทีเป็นนาทีวันหยุด ถ้าอ่าน
  ตามเวลาจริง เริ่มงานตอนเย็นจะได้ ×3 · `ot3_holiday` เป็นศูนย์บนใบเหมาทุกใบ.
  **กลับด้านกับกฎ 4 ก.ย. ทั้งข้อ** — `totals.normalHours` เป็นศูนย์ทุกใบแล้ว ฟิลด์
  ยังอยู่บนโมเดลเพื่อแถวที่เขียนไว้ในสามวันนั้น · `FLAT_DAILY_NO_OT` ออกไปพร้อมกฎ
  ที่สร้างมัน และ `FLAT_DAILY_CAPPED` ของยุคเพดานกลับมาพร้อมเลขคณิตที่ทำให้มันมี
  ความหมาย (08:00–20:00 วันหยุด = นับ 8 ตัด 3).
  **ระหว่างวันเดียวกันเคยเป็นกฎที่แคบกว่านี้** — *เฉพาะใบเหมาที่ตรงวันเกิด และเฉพาะ
  วันที่ไม่ได้เป็นเสาร์อาทิตย์หรือวันหยุดบริษัท* — แล้วขยายเป็นกฎข้างบนในวันเดียวกัน
  ข้อยกเว้นจึงหายไปพร้อมความแคบที่ต้องการมัน · `FLAT_DAILY_BIRTHDAY_SAY` กับ
  `flatDailySay()` ที่เกิดในรอบนั้นถูกถอนออกด้วย เหลือประโยคเดียวที่ไม่เอ่ยชื่อ
  คอลัมน์ เพราะมันถูกวาดบนทั้งสองแบบ.
  **ใบเหมาขึ้น F-HR-027 แล้ว** — มี segment หนึ่งแถว `onSheet` จึงรับเข้าโดยไม่ต้อง
  แก้ตามที่ไหน · ข้อ **[OPEN]** ที่ค้างว่า “จะให้ใบเหมาไปโผล่บนกระดาษที่ไหนไหม”
  ปิดด้วยกฎ ไม่ใช่ด้วยคำตอบ · และใบเหมาไม่ใช่ “ใบเดียวที่เก็บโดยไม่มีชั่วโมง OT”
  อีกต่อไป `zeroOtHoursAllowed` ยังอยู่ครบทั้งห้าทางแต่แทบไม่มีอะไรให้ยกเว้นแล้ว.
  **อ่านฐานจริงแล้ว (อ่านอย่างเดียว) 7 ก.ย.** — `birthdayHolidayEnabled` เป็น `true`
  ใน `Setting.policy` (ไฟล์เป็น `false`) กฎนี้จึงมีผลทันทีที่ deploy · มีใบ
  `flatDaily` 3 ใบ ทั้งหมดเป็นแถว seed ของเดือนกรกฎา · **สองใบที่อนุมัติแล้วคิดใหม่
  ได้เท่าเดิมทุกช่อง** (เพดานเดิมกับเหมาแปดชั่วโมงตรงกันเมื่อวันนั้นยาวถึงแปด) ·
  ใบที่สามยัง `pending_hr` และจะเปลี่ยนจาก 0 เป็น 8 ชม. `ot15_weekday` เมื่อ replay.
  **เดินบนแอปที่ build แล้วครบทุกรูปของวัน** — `:3001` คนละ `distDir` คนละฐาน:
  วันทำงาน 08:00–17:00 และเย็นวันทำงานได้ `ot15_weekday` 8 · เสาร์ 08:00–20:00 ได้
  `ot15_holiday` 8 ตัด 3 · วันหยุดบริษัทเริ่มสองทุ่มได้ `ot15_holiday` 8 (ไม่ใช่ ×3) ·
  วันเกิดวันอังคารได้ `ot15_holiday` 8 พร้อม `dayReason: 'birthday'` · แล้วยื่นจริง
  หนึ่งใบ เซ็นครบสองขั้น และ**เห็นแถวนั้นบน F-HR-027 จริง** ที่ 17:00–20:00 · 8.00
  ในช่อง OT วันปกติ · **ระหว่างทางเจอผลข้างเคียงที่ตั้งใจ**: ใบเหมากินเพดานเดือน
  แล้ว การเซ็นใบนี้จึงต้องมีเหตุผลกำกับเพราะเกิน 40 ชม.
  **ยังไม่ได้ deploy** — `npm test` 2240/2240 ผ่าน; `:3000` ยังเสิร์ฟของเดิม.
- **เหมารายวัน เลิกเป็นเพดาน — เป็น 8 ชั่วโมงปกติ ไม่มี OT เลย** — 2026-09-04,
  a reversal of the rule shipped the day before, asked for in one sentence:
  *ถ้าติ๊กแบบเหมารายวันไม่ว่าจะสแกนเข้าก่อนหรือออกก่อนหรือหลัง 17:00 น. ก็คือ 8
  ชั่วโมงไม่มีบวกเพิ่ม*.
  **ทั้งสามคอลัมน์เป็นศูนย์** — `ot15_weekday`, `ot15_holiday`, `ot3_holiday` —
  และแปดชั่วโมงไปอยู่ที่ `totals.normalHours` ซึ่งเป็นฟิลด์ใหม่บนใบ. เพดานเดิม
  ให้ยอดรวมถูกแต่ให้**คอลัมน์ผิด** และคอลัมน์คือสิ่งที่เงินถูกคิดจากมัน.
  **สั้นกว่าแปดก็ยังแปด**: เหมาคือ*ราคา*ของวัน ไม่ใช่*การวัด*วัน — ออกก่อนเที่ยง
  ก็ยังเป็นวันที่ถูกเหมาไปแล้ว ซึ่งเป็นครึ่งที่กลับด้านกับเพดานเดิมตรง ๆ.
  **กฎ OT อีกสี่ข้อไม่ทำงานกับใบนี้เลย** แทนที่จะทำงานแล้วถูกเขียนทับ — ไม่งั้น
  `belowMinimum: 'reject'` จะปฏิเสธเย็นวันเหมาที่ไม่ถึงชั่วโมง OT ที่มันไม่ได้ขอ.
  **และใบเหมาคือใบเดียวที่ระบบเก็บโดยไม่มีชั่วโมง OT** — `zeroOtHoursAllowed` ใน
  `lib/entries.js` เป็นข้อยกเว้นเดียวของกฎ 0 ชั่วโมง และถูกถามจากทั้งห้าทาง
  (POST · PUT · legacy · replay · ปุ่มบันทึก) จากฟังก์ชันเดียว.
  **พบบั๊กเก่าระหว่างทาง**: `recomputeEntries` และ `npm run whatif` ประกอบ
  session ขึ้นใหม่จากเอกสารโดย**ไม่ได้ส่ง `flatDaily` ไปด้วย** ตั้งแต่วันที่ช่องนี้
  เกิด — replay ครั้งแรกหลังจากนั้นจะเขียนชั่วโมง OT กลับลงใบเหมาที่อนุมัติแล้ว
  พร้อมแถว `recompute` ที่บอกว่านโยบายเป็นคนทำ · ยังไม่เคยเกิดจริงเพราะยังไม่มี
  การ replay หลังวันนั้น · `test/flatDaily.test.js` ตรึงทั้งสองที่ไว้แล้ว.
  **ยังไม่ได้ deploy** — เดินบน `npm test` และบน build ที่ `:3001` คนละ
  `distDir` เท่านั้น; `:3000` ยังเสิร์ฟของเดิมอยู่.
- **The phone's bottom bar was redesigned whole: four icons, one line of type
  under each, and the menu moved to a drawer under the avatar** — 2026-09-04,
  the third round on that bar in one day and the one that undid the second.
  Reported with a picture of ตั้งค่าระบบ at 360px: *"ยัดเยียดและตัวอักษรทับกัน"*.
  Four things were asked for and all four are here.
  **The ส่วนตัว / จัดการทีม headings came off the bar**, seventeen pixels after
  they went on that morning, and `form` went back to เพิ่มเติม with them — the
  fifth slot existed only to make the two halves contiguous.
  **The label under a glyph is the SLOT's name now, always**, and that is the
  change that actually fixed the wrapping. A screen's name in this app is a
  sentence — บันทึกและประวัติ OT is nineteen characters — and a quarter of a
  360px bar is about twelve. The slot names are nine to eleven and were already
  written. It is **not a second name for a screen**: there is no per-tab
  `short`, `PAGE` and `tabs` are still the only places a screen is named, and
  the screen says its own name in full in the app bar one line up. A slot's
  glyph still follows a single tab, because a glyph is not a sentence.
  **24px glyph, 11px label, and the height the labels gave back went into the
  gaps** — `gap` 4→6, `padding` 6/2→8/4. `nowrap` with an ellipsis is a guard
  rather than the mechanism: every label fits at every width, measured, and what
  the guard buys is that a longer one some day truncates instead of colliding.
  **And the grouping moved upstairs to `NavDrawer`.** The app bar's avatar went
  straight to ข้อมูลส่วนตัว and now opens the whole menu: the sidebar's three
  headed blocks — `navGroups`, not a fourth partition of `tabs` — then a บัญชี
  foot with ข้อมูลส่วนตัว and ออกจากระบบ. It is `Popover` in its sheet form, so
  it is the panel the pickers and เพิ่มเติม already open rather than a fourth
  kind of thing. เพิ่มเติม was already a bottom sheet and was checked rather
  than changed: full width, over a scrim, with ปิด.
  Walked on the **built app** at 320 and 360px, ธีมมืด, over CDP as five roles:
  every role gets four buttons or fewer, every label is one line and none is
  clipped (`scrollWidth - clientWidth ≤ 1`), glyphs measure 24px and labels 11,
  no `.nav-side-head` is rendered anywhere, and there are no console errors.
  **The bar is 79px for all five roles at all six widths measured** — 320 · 360
  · 390 · 430 · 600 · 820 — against 104 before this round. That is 25px of every
  page handed back and, for the first time since the tabs were renamed on
  2026-08-31, ONE height rather than a tallest case: `--nav-h`'s fallback is 79
  and says so.
  ⚠️ **A bug found in the walk and fixed in the same round.** `.pop.sheet` is
  `bottom: 0` and had no height cap — safe while every sheet in the app was
  short by construction, and not safe for a drawer holding the whole menu. The
  ผู้ดูแลระบบ drawer measured **814px on a 780px screen**: a panel pinned to the
  bottom grows upward, so its top came out at **-34px** with the name at the
  head of it off the screen, and at 360×667 at **-147px** with four rows
  unreachable and nothing scrolling. The cap is on the panel and the scroll is
  on the list — `overflow-y` on the panel would carry the who-block and ปิด away
  with the rows, and ปิด is the one control on a sheet a phone can be sure of.
  `max-height: 88dvh`, **`dvh` and not `vh`**, because `vh` is the tallest the
  viewport ever gets on a phone with a retracting address bar. Re-walked: 686px
  at 780 and 587 at 667, top on screen both times, 128 and 227px of scroll in
  the list, ปิด visible throughout, and `elementFromPoint` at the centre of the
  last row returns that row.
  ⚠️ **:3001 was taken over mid-round** by another `next start` from work running
  concurrently in this tree, so the walk ran on **:3002**. :3000 was never
  touched and answered 200 throughout.

- **The phone bar draws its two halves — ส่วนตัว | จัดการทีม — and the half you
  are in says so** — 2026-09-04, the second round on that bar the same day.
  Asked for as *"ให้แยกส่วน เรื่องส่วนตัว และ การจัดการทีม ชัดเจน"*: a
  หัวหน้างาน's bottom bar mixed the two screens about their own OT with the two
  about their team's and nothing on it said which was which.
  **The request offered a mode switch and what shipped is a line**, put to the
  user with both costs stated first. A signer has four screens: behind a switch,
  two of them are always one press further away, the pending badge sits on
  whichever half is not showing, and the bar gains a piece of state that has to
  be right when somebody comes back to it. The line costs a 17px strip and takes
  nothing away.
  **`พิมพ์ใบขออนุมัติ OT` took a slot of its own to make it possible.** It sat in
  เพิ่มเติม at the back of the bar — deliberately, so a พนักงาน got two buttons
  rather than one opening a list of two — which split the personal pair around
  the team's work and left no contiguous halves to draw a line between. A slot
  of its own answers the พนักงาน case just as well, and it retired the one
  documented crossing between the sidebar's cut and the phone's: there are none
  now, so every screen sits in the same part of the menu on both devices.
  Five buttons is the ceiling and only ฝ่ายบุคคล and ผู้ดูแลระบบ reach it.
  **No role decides who sees the line.** The strip is drawn when both halves
  have something in them, so a พนักงาน gets the plain bar they had and every
  signer gets the line — which is the roles the request named, reached from the
  data rather than from `isSigner`. `test/roleNavTabs.test.js` holds that, and
  holds the two properties underneath it: the halves are contiguous, and a
  screen's half is its sidebar block.
  **And the active state is a shape now, not only a hue.** The open screen's
  glyph sits on `--green-bg` — the fill `.pick-menu li[data-active]` already uses
  for *this row is the one* — behind the glyph rather than the button, because a
  button's height is its label's and a pill around the whole thing would be a
  different shape on every tab. The heading of the half you are in goes green and
  bold, which is the half of *"เห็นชัดเจนว่ากำลังอยู่ในหน้าของบทบาทใด"* that the
  colour under one button cannot answer: a colour has one meaning per bar, and
  the green already means *which screen*.
  Walked on the **built app** on a scratch `distDir` at 320 and 360px, ธีมมืด,
  over CDP as all **six** roles. 4 buttons split 2|2 for the four signers, 5
  split 2|3 for ฝ่ายบุคคล and ผู้ดูแลระบบ, 2 and no strip for พนักงาน; pressing
  across moves the lit heading for every role; no label overflows its button at
  either width; the divider paints at 1px `--line-lift`; no console errors. Bar
  heights measured at 320/360/390/430/600/820 come to 104/104/104/104/88/88 for a
  split role and 71 everywhere for พนักงาน, and `--nav-h`'s fallback moved 88 →
  104 to match.
  ⚠️ **A bug was found on the way and is fixed in the same round**:
  `.mobile-nav .label` was `11px/1`, and Thai does not fit inside its own font
  size — `รออนุมัติ OT` had been rendering with the mark on its last syllable
  struck through the `OT` beneath it since the tabs were renamed on 2026-08-31.
  It is `11px/1.45` now. **1.25 was tried first and still collided**, which is
  recorded because half a fix looks like a fix in a screenshot; it was found in a
  3× crop of the bar at 320px and is invisible at 100%.
  ⚠️ **The port moved mid-round.** :3001 was taken over by another `next start`
  from work running concurrently in this tree, so the walk finished on **:3002**.
  :3000 was never touched and answered 200 throughout.

- **The last twenty `<select>`s in the app became `PickOne`, so no dropdown on
  any screen is drawn by the operating system any more** — 2026-09-04, reported
  from a phone with a screenshot of รายงาน OT ฝ่ายบัญชี: the บริษัท box opened
  as a white sheet carrying the system's blue selection bar, in the middle of a
  charcoal-and-green page, beside a ประจำเดือน one column along that is
  `PickMonth` and is the app's own. *"ปรับ UI ทั้งระบบ โดยเฉพาะดรอปดาวน์ในมือถือ
  ที่ยังเป็นของเบราว์เซอร์ … อันไหนที่ยังไม่ได้เป็นแบบของระบบเปลี่ยนให้เป็น
  แบบของระบบทั้งหมดเลย"*
  **Thirteen places, twenty controls**: บริษัท on รายงาน OT ฝ่ายบัญชี · แผนก on
  รายงาน OT แยกแผนก · both boxes in the ผู้รับช่วงอนุมัติ dialog · รูปแบบโอที in
  แก้ไขแผนก · เซ็นให้บริษัท · แผนก for anybody who is not a signer ·
  บริษัท / บทบาท / วิธีตั้งรหัสผ่าน in เพิ่มพนักงาน · บริษัท / บทบาท /
  สถานะการใช้งาน in แก้ไขพนักงาน · the three short filters on ประวัติการแก้ทะเบียน
  · the seventeen rows of นโยบายการคำนวณ · the four filters on บันทึกประวัติระบบ.
  **`PickOne` grew three things to reach them.** It is a `Field` now rather than
  a `.field` of its own, which is what gives it the (?) and the two kinds of
  sentence under a control and stops it nesting a field inside a field in a
  dialog — `Field` took a `labelId` for it, because the pointing goes the other
  way here and the button carries `aria-labelledby`. An option may be
  `disabled`, which ทะเบียนพนักงาน depends on: บทบาท is drawn WHOLE for
  ฝ่ายบุคคล with ผู้ดูแลระบบ greyed, and `<option disabled>` did all of that for
  free while an `<li>` does none of it — so the row is refused to the pointer,
  to Enter, to ↑/↓, to Home/End and to the letter somebody types out of habit.
  And `hideLabel`, for นโยบายการคำนวณ alone, whose question is already in the
  left column: the `<label>` stays in the document for `aria-labelledby` and is
  clipped rather than hidden, or seventeen comboboxes on that page would have no
  name at all.
  **The one visible change where `PickOne` already stood** is the `.field-head`
  row, which reserves 18px whether or not there is a (?) beside the label — see
  the ตรวจสอบรายเดือน measurement above, where the labelled field went from 66 to
  72 tall. The ค้นหา box on the approval queue's toolbar was given the same
  wrapper in the same round rather than left 6px short of the four dropdowns
  beside it.
  Walked on the **built app** (`VERIFY_DIST_DIR=.next-verify-ui`,
  `next start -p 3001`; :3000 kept serving throughout and answered 200 after) at
  360×780 on ธีมมืด as `ADMIN`: `document.querySelectorAll('select').length` is
  **0 on all eleven tabs**. What opens is `rgb(39,48,41)` behind
  `rgb(74,85,78)` with 44px rows set in IBM Plex Sans Thai *(the loopless cut;
  the looped one took its place on 2026-09-07 and the panel is unchanged
  otherwise)* — the app's own
  panel, not the OS's sheet — and `elementFromPoint` down the middle of it comes
  back as a row of that panel rather than as anything painted over it. On
  นโยบายการคำนวณ the longest answer wraps to a 64px box against 46px for the
  three beside it, with the ▾ at 13px from the top edge on all four, so it stays
  on the first line; the clipped label is 1px wide, 18px tall and still carries
  `การหักเวลาพัก`. In แก้ไขพนักงาน every `.field-head` measures 18px, tipped or
  not. No console errors.
  ⚠️ **The greyed row was NOT walked.** ADMIN is refused no บทบาท, so the app
  never renders one; it would take an ฝ่ายบุคคล session to see ผู้ดูแลระบบ drawn
  faint, and minting that token was declined mid-round. What holds it today is
  `test/queueDropdown.test.js` — five keyboard and pointer paths plus the ARIA —
  and the `.pick-menu.one-menu li.off` rule. **Worth doing on the next HR walk.**
  A **finding that came out of the walk and is NOT part of this round**: the
  กรองตามบัญชี list on บันทึกประวัติระบบ prints raw role keys for the three rungs
  added on 2026-09-03 — `supervisor`, `division_manager`, `finance` — because
  `ROLE_LABEL` in `lib/accessLog.js` predates them and the `|| a.role` fallback
  shows through. The control was rewritten, the label map was not.

- **คิวของผู้เซ็นขั้นแรกเห็นใบทั้งสาย และช่อง บทบาท มาแทนช่องสถานะบนจอนั้น** — 2026-09-04 ·
  เดินบนแอปที่ build แล้วที่ :3001 (`VERIFY_DIST_DIR=.next-verify`) กับ**สำเนาฐานจริง**
  (`npm run backup` → `restore --to …primus_ot_walk`) โดยตั้ง `approvesDepartments` ของ
  PM-0147 (ผู้จัดการฝ่าย) เป็น RND + PROD2 และเลื่อน PM-0388 เป็น ผู้จัดการแผนก เพื่อให้มีใบ
  ของรุ่นถัดลงไปหนึ่งขั้นอยู่จริง — ไม่งั้นค่าเริ่มต้นของตัวกรองจะดูเหมือนทำงานทั้งที่ไม่มีอะไรให้กรอง ·
  ฐานที่ใช้เดิน drop ทิ้งหลังเสร็จ · :3000 ไม่ถูกแตะ และตรวจแล้วยังตอบ 200 หลังจบ
  · `/api/auth/me` ตอบ `coversDepartments: 3` และ `/api/entries?status=pending_mgr,pending_hr`
  ได้ **7 แถวเฉพาะสามแผนกนั้น** — รอหัวหน้า 5 ใบใน RND และ รอ HR 2 ใบใน PROD2
  · บนหน้าจอ ตัวกรองอ่าน `ค้นหา · บทบาท · แผนก · เดือน` และช่อง บทบาท **เปิดมาที่
  ผู้จัดการแผนก เอง** เหลือแถวเดียว หัวการ์ดอ่าน `1 / 3 รายการ · รอหัวหน้า 0 / 2 · รอ HR 0 / 2`
  · เมนูของช่องนั้นเรียงตามขั้น `ทุกบทบาท / พนักงาน 4 / ผู้จัดการแผนก 1 / ผู้จัดการฝ่าย 2`
  และกด ทุกบทบาท แล้วได้ 7 แถวกับ `3 รายการ · รอหัวหน้า 2 · รอ HR 2`
  · ใต้หัวข้ออ่าน `ตรวจสอบรายวัน · เฉพาะ 3 แผนกที่คุณดูแล` · ตาราง **12 คอลัมน์ กว้าง 1346**
  ในหน้าต่าง 1440 ไม่มี overflow แนวนอนของเอกสาร
  · แถวของ PM-0388 (ผู้จัดการแผนก) **มีปุ่ม อนุมัติ / ไม่อนุมัติ และติ๊กได้** ซึ่งคือ
  “กดอนุมัติแทนได้” ที่ขอมา · แถว รอ HR **ติ๊กไม่ได้ ไม่มีปุ่ม** อ่านว่า
  `ผ่านขั้นของคุณแล้ว — รอฝ่ายบุคคลยืนยัน` และกล่อง รายละเอียด ของแถวนั้น**ไม่มีปุ่มท้ายกล่องเลย**
  บรรทัดแรกเป็น `ใบนี้ผ่านขั้นหัวหน้าไปแล้ว — …` · ใบที่ตัวผู้อ่านยื่นเอง อ่านว่า
  `คุณเป็นผู้บันทึกรายการนี้ — ต้องให้คนอื่นเป็นผู้อนุมัติ`
  · **HR-001 ไม่ขยับสักอย่าง** — ตัวกรองยังเป็น `ค้นหา · สถานะ · แผนก · เดือน` ไม่มีช่อง บทบาท ·
  หัวการ์ด `รออนุมัติ OT · 4 รายการ · รอหัวหน้า 5` · แถว รอหัวหน้า ยังอ่านว่า
  `ยังไม่ถึงขั้นยืนยัน — รอหัวหน้าแผนกเซ็นก่อน` และแถว รอ HR ยังมี ยืนยัน / ไม่อนุมัติ ครบ
  · **คิวที่ว่างจริงถูกเดินทีหลังในวันเดียวกัน และเป็นรอบที่แก้อะไรจริง ๆ** — บนโรสเตอร์
  ตัวอย่าง สุรชัย ถือ 8 แผนก และ **7 ใน 8 ไม่มีพนักงานอยู่เลยสักคน** (ฝ่ายขายมีเขาคนเดียว)
  ส่วนใบค้างทั้ง 9 ใบอยู่ในสายผลิต/วิจัย คิวจึงว่างอย่างถูกต้อง — แต่จอเดิมทิ้งไว้ให้แค่
  ประโยคเดียวกลางการ์ด ไม่มีแถบตัวกรอง ไม่มีหัวตาราง ไม่มีอะไรบอกว่าค้นจากที่ไหน
  ซึ่ง**แยกไม่ออกจากหน้าที่โหลดพลาด** · ตอนนี้บนแอปที่ build แล้ว หน้าเดียวกันอ่านว่า
  `รออนุมัติ · 0 รายการ` เหนือ `ตรวจสอบรายวัน · เฉพาะ 8 แผนกที่คุณดูแล` มีแถบตัวกรอง
  ครบสี่ช่อง (`ค้นหา · บทบาท · แผนก · เดือน`) หัวตาราง 12 คอลัมน์ และประโยคใต้ตาราง:
  **`ยังไม่มีใบ OT ที่รออนุมัติ — ค้นจาก 8 แผนกที่คุณดูแล — ใบจะขึ้นที่นี่ทันทีที่มีคนในแผนกยื่น
  และจะอยู่ต่อจนฝ่ายบุคคลยืนยัน`**
  · **เดินจอว่างของสามบทบาทบน build เดียวกัน** โดยพลิกใบค้างทั้ง 9 ใบใน**สำเนา**เป็น
  `approved` เพื่อให้ทุกคิวว่างพร้อมกัน แล้วอ่านหน้าจอจริง — ทั้งสามได้ `0 รายการ`
  บนหัวการ์ด หัวตาราง 12 คอลัมน์ และประโยคกลางจอที่ขึ้นต้นเหมือนกันว่า
  **`ยังไม่มีใบ OT ที่รออนุมัติ`** ต่างกันแค่ขอบเขตใต้บรรทัดนั้น: หัวหน้างาน
  `ค้นจาก 2 แผนกที่คุณดูแล` · ผู้จัดการฝ่าย `ค้นจาก 8 แผนกที่คุณดูแล` · ฝ่ายบุคคล
  `ค้นจากทุกแผนกทั้งบริษัท`
  · แถบตัวกรองอยู่ครบทุกจอ — ฝ่ายบุคคล `ค้นหา · สถานะ · แผนก · เดือน` · ผู้จัดการฝ่าย
  `ค้นหา · บทบาท · แผนก · เดือน` · **หัวหน้างานสามช่อง** `ค้นหา · แผนก · เดือน` เพราะ
  `seesRoles > 1` ยังกันดรอปดาวน์ บทบาท ไว้ตามที่ HR สั่งไว้เอง — ถามซ้ำแล้วเมื่อ
  2026-09-04 ว่าจะให้ทุกบทบาทมีเท่ากันไหม และคำตอบคือ **คงไว้ตามเดิม ไม่ต้องมี**
  · `+ บันทึก OT แทนพนักงาน` ขึ้นให้ผู้เซ็นขั้นแรกทั้งสามคนที่เดิน และ**ไม่ขึ้นให้**
  ฝ่ายบุคคล ซึ่งถูกแล้ว: `proxyPermission` ตอบ 403 ให้คนที่ไม่ใช่ผู้เซ็นขั้นแรก
  · **แล้วรอบถัดมาในวันเดียวกัน: ตัวเลือกในดรอปดาวน์** — แถบที่เพิ่งทำให้อยู่ต่อ
  บนคิวว่าง เปิดออกมาแล้วมีแต่ `ไม่มีตัวเลือก` ทั้งสี่ช่อง เพราะทุกลิสต์สร้างจากแถว ·
  ตอนนี้แต่ละลิสต์มาจากสิ่งที่มันเป็นลิสต์ของ และเดินยืนยันบน build บนคิวที่ว่างสนิท
  (พลิกใบทั้ง 9 ใบในสำเนาเป็น `approved`): ผู้จัดการฝ่ายเปิด `บทบาท` ได้
  **ทุกบทบาท · พนักงาน · หัวหน้างาน · ผู้จัดการแผนก** และ `แผนก` ได้ **8 แผนกที่เขาดูแล** ·
  ฝ่ายบุคคลได้ `สถานะ` **ทุกสถานะ · รอหัวหน้า · รอ HR** และ `แผนก` **ทั้ง 18 แผนก** ·
  หัวหน้างานได้ `แผนก` **แผนกออกแบบและวิจัยผลิตภัณฑ์** แผนกเดียวของเขา ·
  ทุกคนได้ `เดือน` **กันยายน 2569** ซึ่งเป็นเดือนที่ใบที่ยื่นวันนี้จะไปตกอยู่
  · ที่มาของแต่ละลิสต์: `แผนก` ← `coversDepartments` (เปลี่ยนจากจำนวนเป็นรายการ id)
  จับคู่ชื่อกับ `GET /api/departments` · `บทบาท` ← `visibleRolesFor` · `สถานะ` ← `listed` ·
  `เดือน` ← เดือนที่มีแถว บวกเดือนปัจจุบันจาก `today()` · **แถวยังเป็นคนบอกจำนวน**
  ตัวเลขข้างตัวเลือกจึงไม่ขึ้นเมื่อไม่มีอะไรค้าง
  · ⚠ พบระหว่างเดิน: หัวหน้างาน PM-0100 บนโรสเตอร์ตัวอย่างถือ `approvesDepartments`
  หนึ่งค่าที่**ชี้ไปยังแผนกที่ไม่มีอยู่แล้ว** หัวข้อจึงอ่านว่า “เฉพาะ 2 แผนก” ขณะที่
  ดรอปดาวน์มีแผนกเดียว — ข้อมูลค้างจากรอบนำเข้าแผนกจริง ไม่ใช่ของโค้ดรอบนี้
  · **และรอบสุดท้ายของวัน: ค่าเริ่มต้น `ผู้จัดการแผนก` ตั้งเสมอ ไม่ใช่ตั้งเมื่อมีแถว** ·
  เดินกรณีที่เสี่ยงที่สุดของมันบน build โดยติ๊ก RND ให้ PM-0147 ในสำเนา — แผนกนั้นมีใบค้าง
  5 ใบ แต่**ไม่มีใบของผู้จัดการแผนกสักใบ** · จอเปิดมาที่ `ผู้จัดการแผนก` ตารางว่าง
  และแผงใต้ตารางอ่านว่า **`ไม่มีรายการที่ตรงกับตัวกรอง — มีอีก 5 ใบในคิวนี้ที่ตัวกรองซ่อนอยู่`**
  พร้อมปุ่ม `ดูทั้งหมด` · กดแล้วกลับมา **5 แถว** และชิปหัวการ์ดอ่าน `3 รายการ · รอหัวหน้า 2`
  · หัวการ์ดตอนถูกกรองอ่านว่า `0 / 3 รายการ · รอหัวหน้า 0 / 2` ซึ่งเป็นรูปเดิมที่
  ใช้มาตั้งแต่มีตัวกรอง — ตัวเลขซ้ายคือที่เห็น ตัวเลขขวาคือทั้งกอง
  · ⚠ **สะดุดหนึ่งครั้งระหว่างเดิน และเป็นเรื่องของขั้นตอน ไม่ใช่ของโค้ด**: build ทับ
  `.next-verify` เดิมโดยไม่ลบก่อน ทำให้หน้าที่เสิร์ฟออกมาอ้าง chunk ที่ build นั้นไม่ได้สร้าง —
  เบราว์เซอร์ที่ยังมี cache ของรอบก่อนเปิดได้ตามปกติ ส่วน profile ใหม่ได้ `ChunkLoadError`
  แล้วค้างที่ `กำลังโหลด…` ซึ่งอ่านเหมือนแอปพังทั้งใบ · `rm -rf .next-verify` แล้ว build ใหม่
  หายทันที — **ลบ distDir ก่อน build ซ้ำเสมอ**
- **ไม่มีหน้าคั่นก่อนเข้าระบบอีกแล้ว — หน้า ตั้งรหัสผ่านของคุณ ถูกลบทิ้ง** —
  2026-09-04 · เดินบนแอปที่ build แล้วที่ :3001 (`VERIFY_DIST_DIR=.next-verify`)
  กับฐานชั่วคราวที่ `npm run seed` เขียนขึ้น แล้ว drop ทิ้งหลังเสร็จ (`:3000`
  ไม่ถูกแตะ ตรวจแล้วยังตอบ 200 หลังจบ) · ตั้ง `mustChangePassword: true` ให้
  บัญชีที่ใช้เดินด้วยมือ แล้วขับผ่าน CDP
  · **PM-0412 ล็อกอินแล้วอยู่บนแอปทันที** — มีเมนู ไม่มีข้อความ
  “ตั้งรหัสผ่านของคุณ” อยู่บนหน้าเลย และแถบ **“คุณยังใช้รหัสผ่านที่ฝ่ายบุคคล
  ตั้งให้อยู่”** อยู่บนหน้าแรก
  · ปุ่มบนแถบพาไป ข้อมูลส่วนตัว ซึ่ง**รับช่วงประโยคของหน้าที่ถูกลบมาแล้ว** —
  ข้อความเหนือฟอร์มบอกว่า “รหัสผ่านเดิม” คือรหัสพนักงานของคุณ พร้อมกล่องเตือน
  ตัวเดียวกัน
  · **ตั้งรหัสใหม่เป็นภาษาไทยแล้วทั้งสองข้อความหายทันทีโดยไม่ต้อง reload**
  (`onRefresh` อ่าน session ใหม่) แถบบนหน้าแรกก็หายไปด้วย และ
  `/api/auth/me` ตอบ `mustChangePassword: false`
  · **HR-001 ซึ่งเป็นคนละบทบาทและยังถือธงอยู่ ก็ลงจอดบนแอปเหมือนกัน**
  พร้อมแถบเตือนบนหน้าแรกของบทบาทตัวเอง · **refresh แล้วยังเป็นแบบเดิม** ไม่มี
  หน้าคั่นตัวไหนกลับมา
  · *(ก่อนหน้านั้นในวันเดียวกัน เดินรุ่นที่หน้านั้นยังอยู่แต่มีปุ่ม
  ข้ามไปก่อน · เข้าใช้งานเลย ครบทุกขั้นเช่นกัน — ทั้งการข้ามที่ไม่เขียนอะไรลง
  `localStorage`/`sessionStorage` เลย และการที่คนถัดไปบนเบราว์เซอร์เดียวกัน
  ไม่ได้ถูกพาข้ามตาม · หน้านั้นถูกลบทิ้งหลังจากนั้น)*

- **การเงินได้ รายงาน OT ประจำทีม เพิ่ม — เดือนเดียวกัน สองความกว้าง สองคีย์** —
  2026-09-03 · เดินบนแอปที่ build แล้วที่ :3003 กับสำเนาฐานข้อมูลจริง โดย**ย้าย
  บัญชีการเงินไปแผนก QC** ซึ่งมีใบ OT อยู่ ไม่ใช่ ADM ที่ว่างเปล่า — ถ้าไม่ย้าย
  แท็บทีมจะว่างด้วยเหตุผลที่ถูกต้อง และแยกไม่ออกจากขอบเขตที่พัง
  · การเงิน `ตรวจสอบประจำเดือน` **5 คน ENG/PROD/QC** · `รายงาน OT ประจำทีม`
  **1 คน QC เท่านั้น** จากฐานข้อมูลเดียวกัน เดือนเดียวกัน คนเดียวกัน
  · หัวหน้างาน ENG — ส่ง `scope=team` หรือไม่ส่ง **ได้ 4 คน ENG/PROD เท่ากัน**
  ขยายอะไรไม่ได้ · ฝ่ายบุคคลส่ง `scope=team` **ยังได้ 5 คนทั้งบริษัท** เพราะ
  ไม่ได้เซ็นแผนกไหน `isSigner` จึงเป็นเท็จ
  · **ปุ่มส่งออกตามแท็บ**: `monthly.csv` แบบทีมได้ THT0074 คนเดียว แบบบริษัทได้
  ครบห้า และ `entries.csv` แบบทีมได้เฉพาะใบของ THT0074
  · ⚠ **ยังไม่ได้เดินด้วยตาบนหน้าจอ** — แถบเมนู หัวข้อการ์ด และ `key={tab}` ที่กัน
  ไม่ให้สองแท็บใช้ state ร่วมกัน ตรึงไว้ด้วยเทสต์ที่อ่านซอร์สเท่านั้น
  · ฐานข้อมูลเดินเสร็จแล้ว drop ทิ้ง · :3000 ไม่ถูกแตะ

- **เรียงตามลำดับตัวเลข บนสองจอรายงานและไฟล์ที่ส่งออกจากมัน** — 2026-09-03 ·
  เดินบนแอปที่ build แล้วที่ :3003 (`VERIFY_DIST_DIR=.next-verify-fin`) กับสำเนา
  ฐานข้อมูลจริง ที่เติมใบให้ `PM00416` และ `THT00111` เพื่อให้รหัสสองรูปแบบมาอยู่
  ในลิสต์เดียวกัน — ซึ่งเป็นเงื่อนไขเดียวที่ทำให้บั๊กนี้มองเห็นได้
  · `ตรวจสอบประจำเดือน` — **PM-0100 · PM-0147 · PM-0412 · PM00416 · THT0056 ·
  THT0074 · THT00111** และ `monthly.csv` ออกมาลำดับเดียวกันเป๊ะ
  · `รายงาน OT ฝ่ายบัญชี` เต็มทะเบียน (`includeZero=1`) — ไพรมัส **0100 · 0147 ·
  0290 · 0388 · 0412 · 00416 · 0501 · 00512 · 0533 · 0620** และ เดมเทค
  **0018 · 0056 · 0074 · 0079 · 00111** · สังเกต `0501 · 00512 · 0533` กับ
  `0079 · 00111` — สองจุดที่การเทียบทีละตัวอักษรเคยสลับลำดับ
  · `entries.csv` — ใบของคนเดียวกันมาอยู่ติดกันเป็นครั้งแรก แล้วเรียงตามรหัส
  · **การเงินเห็นทั้งสองบริษัทในไฟล์เดียว** — ทั้งใบ ไพรมัส และ เดมเทค อยู่ใน
  `accounting.csv` ที่บัญชีการเงินโหลดเอง และ `companies` บนจอเดือนมีทั้งสองค่า

- **การเงินเห็นสองเมนูของฝ่ายบุคคล ทั้งบริษัท และแก้อะไรไม่ได้** — 2026-09-03 ·
  เดินบนแอปที่ build แล้วที่ :3001 (`VERIFY_DIST_DIR=.next-verify`) กับสำเนา
  ฐานข้อมูลจริงชื่อ `primus_ot_finwalk` — ทะเบียน 22 คน 5 แผนก และ **PM-0210
  เป็น `finance` อยู่ในแผนก ADM ซึ่งไม่มีใบ OT เลยสักใบ** จึงเป็นตัวอย่างที่
  แยกสองคำถามออกจากกันได้ชัดที่สุด: ถ้าจอเดือนยังคิดขอบเขตจากบทบาทที่เซ็น
  บัญชีนี้จะเปิด ตรวจสอบประจำเดือน มาเจอศูนย์คน
  · `GET /reports/monthly/2026-08` — **การเงิน 5 คน ENG/PROD/QC เท่ากับฝ่ายบุคคล
  เป๊ะ ส่วนหัวหน้างาน ENG ได้ 4 คน ENG/PROD** ซึ่งคือขอบเขตเดิมของเขา ·
  `reports/accounting` และ `exports/accounting.csv` — **การเงิน 200 · ฝ่ายบุคคล
  200 · หัวหน้างาน 403** · `exports/monthly.csv` — การเงิน 4 แถว หัวหน้างาน 3 ·
  **ลงไปดูรายแถวของคนใน QC ซึ่งไม่ใช่แผนกของใครทั้งสอง**: การเงิน 2 แถว และ
  ใบ F-HR-027 ตอบ 200 · หัวหน้างานได้ **0 แถว และ 403** ทั้งที่ส่ง `scope=report`
  มาเหมือนกัน — scope ใหม่จึงให้สิทธิ์ใหม่กับใครไม่ได้จริง ·
  **และคิวไม่ได้กว้างขึ้น**: `GET /entries?status=pending_mgr,pending_hr` —
  การเงิน **0 แถว** (ADM ไม่มีใบ) หัวหน้างาน 6 แถวใน ENG/PROD ·
  **ปุ่มที่ถอดออกจากจอ ถูกปฏิเสธที่ route อยู่แล้ว**: `PATCH /entries/:id` →
  403 *"แก้ไขได้เฉพาะรายการของตนเองที่ยังไม่มีผู้อนุมัติ หรือโดยฝ่ายบุคคล"* ·
  `POST /entries/:id/cancel` → 403 *"ยกเลิกได้เฉพาะรายการของตนเอง"*
  · ⚠ **ยังไม่ได้เดินด้วยตาบนหน้าจอ** — ที่ตรึงแถบเมนูกับปุ่มสองปุ่มที่หายไป
  คือ `test/roleNavTabs.test.js` และ `test/roles.test.js` ซึ่งอ่านซอร์ส ไม่ใช่
  ภาพ · ฐานข้อมูลเดินเสร็จแล้ว drop ทิ้ง :3000 ไม่ถูกแตะตลอดรอบนี้

- **ลำดับสายการอนุมัติ — ใบของตำแหน่งไหนไปหาใครเซ็น** — 2026-09-03 ·
  `APPROVED_BY` ใน `lib/roles.js` ถือตารางทั้งหมด และ `approvalPermission`
  ถามมันคู่กับ `claim` เดิม (แผนก + บริษัท) · **§2 ถูกกลับข้าง**: ทุกบทบาทยื่น OT
  ของตัวเองได้ · **ไม่มีใครเซ็นใบตัวเอง ยกเว้นฝ่ายบุคคล** ·
  **แผนกที่ไม่มีใครเซ็นได้เลย ใบไปที่ฝ่ายบุคคลทันที** แทนที่จะค้างตลอดไป ซึ่งปิดรู
  ของแผนก ADM ที่ค้างมาตั้งแต่มีทะเบียน · คิวกับตัวเลขบน badge ใช้กฎเดียวกัน
  (`maySignFirstStep` · `pendingMgr`) จึงไม่มีปุ่มที่กดแล้วได้ 403 ·
  **⚠ เดินจริงบนแอปที่ build แล้วจับบั๊กที่เทส 2044 ตัวมองไม่เห็นสองตัว**:
  `DECIDE_POPULATE` ไม่ได้ `select` ฟิลด์ `role` — `mayApproveRole` จึงเห็น
  `undefined` และ**ปฏิเสธทุกลายเซ็นในระบบ** (เทสทุกตัวสร้าง fixture ที่มี role
  ติดมาเอง ฟิลด์ที่หายไปจากลิสต์นี้จึงมองไม่เห็นจากในเทสเลย) และ `requireRole`
  ของ approve / reject / withdraw ยังระบุแค่ `'supervisor'` ·
  **เดินจริงที่ `:3002` บนสำเนาฐานข้อมูล** (`:3000` และฐานจริงไม่ถูกแตะ):
  ใบของทั้งหกบทบาทลงขั้นถูกต้อง — พนักงาน/หัวหน้างาน/ผู้จัดการแผนก ลง
  `pending_mgr` · การเงิน/ผู้จัดการฝ่าย/ฝ่ายบุคคล ลง `pending_hr` ·
  หัวหน้างานเซ็นใบตัวเองถูกปฏิเสธ · เซ็นใบผู้จัดการแผนกถูกปฏิเสธพร้อมชื่อตำแหน่ง
  ในข้อความ · การเงินเซ็นใบหัวหน้างานถูกปฏิเสธ (เพื่อนร่วมขั้น) · สามลายเซ็นที่
  ถูกต้องผ่านหมด · พนักงานแผนก ADM ลง `pending_hr` ตรง · ฝ่ายบุคคลเซ็นใบตัวเอง
  ได้ · badge ของหัวหน้างาน/ผู้จัดการแผนก/ผู้จัดการฝ่าย อ่านได้ **1 / 2 / 3**
  จากใบสามใบเดียวกันในแผนกเดียวกัน
- **ใครเห็นใบของใคร — ลำดับสายบังคับบัญชาทั้งสาย** — 2026-09-03 · เดิมรายการ
  ตอบเป็น*ทั้งแผนก* ให้บทบาทที่ถือแผนก จึงมีหัวหน้างานอ่านใบของหัวหน้างานด้วยกัน
  และอ่านใบของผู้จัดการแผนกของตัวเอง · `visibleRolesFor` คำนวณจาก
  `APPROVED_BY` ไม่ใช่ตารางที่สอง และ `visibleEmployeeClause` แปลงเป็น
  `$and` บนรายการ · **เดินจริงบนแอปที่ build แล้วที่ `:3003` บนสำเนาฐานข้อมูล**
  (`:3000` และฐานจริงไม่ถูกแตะ) แผนกเดียวที่มีครบทุกขั้น: พนักงานเห็น 1 ·
  หัวหน้างานเห็น 1 (ของพนักงาน ไม่เห็นของผู้จัดการแผนก) · การเงินเห็น 1 ·
  ผู้จัดการแผนกเห็น 3 · ผู้จัดการฝ่ายเห็น 2 (อีกใบเป็นของคนละบริษัท ถูกตัดด้วย
  `approvesCompany` ไม่ใช่ด้วยลำดับชั้น) · ฝ่ายบุคคลเห็น 22 · และหัวหน้างานที่
  ขอใบของผู้จัดการแผนกตรง ๆ ด้วย `?employee=` ได้ **0 ใบ** ขณะที่ผู้จัดการฝ่าย
  ขอใบเดียวกันได้ 2 ใบ
- **⚠ บันทึกและประวัติ OT ของผู้อนุมัติเคยแสดงใบของทั้งทีม** — แจ้งจากหน้าจอจริง
  ในวันเดียวกัน และเป็นผลข้างเคียงตรง ๆ ของการเปิดให้ทุกบทบาทยื่นใบ: `scopeFor`
  ตอบเป็น*แผนก*ให้บทบาทที่ถือแผนก ซึ่งไม่เคยเป็นปัญหาเพราะบทบาทเหล่านั้นเปิดจอนี้
  ไม่ได้มาก่อน · แก้ด้วย `?scope=mine` และตัดตัวเองออกจาก
  `GET /api/entries/approvers` · **ยืนยันบนแอปที่ build แล้ว**: `PM-0100`
  (หัวหน้างาน แผนกวิศวกรรม) เคยได้ 16 ใบจาก 6 คน ตอนนี้ได้ **1 ใบของตัวเอง**
  และ "ใครจะเซ็นใบของเขา" ตอบว่าไม่มีใคร — ถูกต้อง เพราะแผนกวิศวกรรมมีเขาเป็น
  ผู้เซ็นคนเดียว ใบของเขาจึงลง `pending_hr` ตรงตามกฎแผนกที่ไม่มีใครเซ็นได้
- **บทบาทสี่ → เจ็ด, และ `manager` ถูกปลดระวาง** — 2026-09-03 · `lib/roles.js`
  เป็นที่เดียวที่เก็บรายชื่อ ชื่อไทย และลำดับขั้น (`outranks` · การเงินกับ
  หัวหน้างานเป็น**เพื่อนร่วมขั้น** เซ็นให้กันไม่ได้) · โมเดล จอ ทะเบียนพนักงาน และ
  รายงานการใช้สิทธิ์พิเศษ อ่านจากไฟล์นั้นทั้งสามที่ แทนที่จะถือสำเนาของตัวเอง ·
  **120 จุดในโค้ดเปลี่ยนชื่อ `manager` → `supervisor`** ใน 48 ไฟล์ เว้นไว้
  เฉพาะที่ที่คำนั้นไม่ใช่บทบาท (`hrRejectReturnsTo` · `Department.manager`) ซึ่ง
  `test/roles.test.js` ตรึงไว้ว่าเป็นข้อยกเว้นสองข้อนั้นเท่านั้น ·
  **`npm run migrate:roles --yes` รันบนฐานข้อมูลจริงแล้ว** — ห้าแถว
  (`PM-0100` `PM-0101` `PM-0102` `PM-0103` `THT0012`) กลายเป็น
  `supervisor` · สำรองไว้ก่อนรันที่ `backups/primus_ot-20260903-061810` ·
  ทดลองเส้นทางเขียนบนฐานข้อมูลชั่วคราวก่อน แล้วรันซ้ำเพื่อยืนยันว่ารันสองครั้งได้ ·
  **เดินจริงบนแอปที่ build แล้วที่ `:3001` คนละ `distDir`** (`:3000` เสิร์ฟอยู่
  ตลอดและไม่ถูก build ทับ): `/api/entries` ตอบ 401 ไม่ใช่ 500 — กับดัก
  re-export ไม่ติด — และด้วยคุกกี้ที่ mint เอง `/api/employees`
  `/api/entries/approvers` `/api/logs` `/api/entries/queue-summary` ตอบ 200 ทั้งหมด ·
  `PM-0101` ที่เพิ่งถูก migrate ยังเห็นใบของแผนกตัวเองใบเดียวเหมือนเดิม และยังถูก
  ระบุชื่อเป็นผู้เซ็นของแผนกนั้น

- **สวัสดิการวันเกิด กลับมาเป็นใบที่พนักงานยื่นเอง + ช่องติ๊ก เหมารายวัน,
  walked on the built app** — 2026-09-03, `:3001` on a scratch `distDir` against
  the live database, read-only (`/entries/preview` writes nothing; `:3000` kept
  serving throughout and was never rebuilt under). Nine calls with a minted
  cookie, as two real employees:
  · **เหมารายวัน caps the day**: a Saturday 08:00–20:00 previewed **11.00 ชม.**
  untouched and **8.00 ชม.** with the box ticked — `clockHours` still **12**,
  `flatDailyTrimmed` **3**, one **FLAT_DAILY_CAPPED** warning, and the three hours
  came off `ot3_holiday` while `ot15_holiday` kept all eight. The tail, not the
  middle. **ทั้งย่อหน้านี้ถูกแทนที่ไปแล้วสองรอบ** — on 2026-09-04 the same request
  previewed **0.00 ชม.** in all three columns with `normalHours` **8** and the
  warning code `FLAT_DAILY_NO_OT`; since 2026-09-07 it previews **8.00 ชม.** of
  `ot15_holiday` with `normalHours` **0**, `flatDailyTrimmed` **3** and
  `FLAT_DAILY_CAPPED` back — which is, in figures, exactly what this walk saw on
  2026-09-03. Kept because it is what the screen really said that day, and
  because the shape of the mistake it was corrected for — right total, wrong
  columns — is the reason the rule moved at all.
  · **the tick is checked, in three shapes**: PM-0412's real birthday
  (13 Oct 2026, a Tuesday) previewed clean with `dayReason: 'birthday'` and
  `routing.status` **`pending_mgr`** — the หัวหน้า step, which is the whole ask;
  an ordinary Tuesday returned *"วันที่เลือกไม่ใช่สวัสดิการวันเกิดของพนักงานคนนี้…"*;
  and a birthday that lands on a Saturday (PM-0210, 15 Aug 2026) returned the
  OTHER sentence — *"…เป็นวันหยุดของทั้งบริษัทอยู่แล้ว … ชั่วโมงยังนับเท่าเดิม"* —
  which is the case worth having walked, because it is the one where refusing
  the tick must not read as refusing the hours.
  · **the same day with the box untouched previews identically** — 8.00 ชม.,
  same buckets, same `dayReason`. The tick is a claim, not an input to the
  arithmetic.
  · **the four doors are shut**: `GET /api/birthday/queue`,
  `POST /api/birthday/entries`, `POST /api/birthday/checks` and
  `GET /api/reports/birthday-check/2026-08` all answer **404** on the built app,
  and `/api/entries/queue-summary` no longer carries a `birthdayPending` field.
- **ลบแผนก, walked end to end on the built app** — 2026-09-02, `:3001` on a
  restored copy of the real database (`primus_ot_deptwalk`; `:3000` never
  touched). Six API calls with real cookies and both dialogs pressed through
  with a pointer:
  · `DELETE` on **ENG** as ผู้ดูแลระบบ → **409**, *"ไม่สามารถลบแผนกนี้ได้…
  (พนักงาน 5 คน · ใบ OT 8 ใบ)"*
  · a department created empty → HR **403**, admin **200 deleted**, then **404**
  · **the race the second count exists for**: free when the screen asked,
  somebody moved into it, `DELETE` → **409 (พนักงาน 1 คน)**; moved back out →
  deleted.
  On screen at 390 and 1280px: three chips — ทั้งหมด 5 / เฉพาะที่ใช้งานอยู่ 4 /
  ไม่มีหัวหน้างาน 1 — the closed row's cells at **opacity 0.5** with its สถานะ
  and จัดการ cells at **1.0**, the dot **rgb(46,119,71)** on and
  **rgb(239,107,65)** off, and ลบแผนก at **x=16 of a 390px foot with 82px of
  gap** before ยกเลิก. Pressing it on a held department opened *ลบแผนกนี้ไม่ได้*
  with both counts printed; on the empty one, the confirmation — and pressing
  through removed the row and said *"ลบแผนก ZZFREE · แผนกว่าง แล้ว"*.
- **แก้ไขแผนก's สถานะ block, tightened the same day.** The paragraph beside the
  pill went behind a (?) — it was two lines written *two ways*, one for on and
  one for off, so it rewrote itself on every press, which reads as the rule
  changing rather than the state. One wording now, true in both directions,
  with the pill saying which direction it is in. Measured on the built app at
  1280 and 390px, as both roles: **nothing but the pill in the block when the
  tip is closed** (0 notes), one when it is opened, and the (?) **0.00px off
  the heading's centre line**. The one sentence that did NOT go behind it is
  the reason ฝ่ายบุคคล cannot press the pill — measured as the single note
  standing open in the HR session, because a reason that arrives on hover
  arrives after the click that did nothing. **ลบแผนก stopped being a filled
  button** in the same pass: `--reject-bg` / `--reject-ink` / `--reject-line`,
  the danger-light the refusal in `.foot-split` already wears, measured as
  `rgb(51,23,23)` on `rgb(90,38,38)` with `rgb(252,165,165)` letters — and
  still `disabled` for HR without losing its colours.
- `npm test` — **2380 tests, all green**, about 3.4 s, measured 2026-09-08 across 131
  files. It read **"2379 … across 131"** until ไม่พักเที่ยง became a red highlight —
  one more case in `entryRowChrome`, the file that already holds the row’s chrome.
  It read **"2374 … across 131"** until ไม่พักเที่ยง was put behind the
  company calendar — five more cases in `otFormChecks` and NO new file, because it
  is the same strip of tick-boxes under a second HR sentence. It read
  **"2366 … across 130"** until แถบช่องติ๊กบนฟอร์มบันทึก OT was cut to
  three boxes and re-ordered วันเกิด → เหมารายวัน → ไม่พักเที่ยง, with the เหมารายวัน box
  drawn for เจ้าหน้าที่บริการ only — `otFormChecks` is the 131st file. It read **"2352 … across 129"** until ประวัติการแก้ทะเบียน folded each
  record to its heading line — `rosterTrailFold` is the 130th file, and that
  round is another session working in this tree today; its own account of itself
  is theirs to write, and this line records only that the figure moved for it. It read **"2344 … across 129"** earlier the same day, until
  ประวัติเวอร์ชันนโยบาย got the same band under it — fourteen cases and no new
  file, because it is the same component under a third table. It read
  **"2313 … across 128"** before that, until both tables
  on บันทึกประวัติระบบ got a pager under them and ดูย้อนหลังเพิ่ม — with the
  500-row ceiling behind it — was deleted. `tablePager` is the 129th file.
  It read **"2306 … across 128"** before that, until F-HR-027's
  grid became 31 rows in every month and the two ลงชื่อ boxes dropped the
  คำนำหน้า — seven cases in the two files that already owned those two rules.
  It read **"2327 … across 127"** earlier the same day, before
  การใช้สิทธิ์พิเศษ's head was rewritten: one line of explanation with the five
  kinds behind the ⓘ, the three filters and the two buttons on one row, and the
  amber count as a `tight` notice. `complianceFilterRow` is the 128th file, and
  the case it exists for is the one a screenshot cannot keep — the pair of
  buttons is padded onto the line of the BOXES by `.field-head`'s height plus
  `.field`'s gap, so either of those two rules moving leaves it a few pixels out
  of line on a screen nobody rebuilds for a week. It read **"2319 … across 128"**
  until the fold got one standard, after
  three shapes in a day: a card's subtitle is drawn in full, an alert is never
  folded, and the text under one SETTING keeps two lines with …อ่านต่อ riding
  the end of the second. `disclosure` was rewritten around that rule and came
  back to the same count, which is what a round that put two of its own answers
  back should look like. Two of its cases are the boundary: nothing inside a
  `ConfirmDialog` or an `Alert` is folded, and a line that reports a live
  figure is not an explanation. It read
  **"2312 … across 128"** until the six-bullet manual on the พนักงาน card went
  behind a ghost button, which the round above took out again the same day. It read **"2294 … across 127"** until .xlsx became a shape the two
  importers accept — `xlsxImport` is the 128th file, and the eighteen cases in it
  are mostly about dates, because reading the workbook rather than a CSV of it is
  what removes the transposed-birthday problem at its source. It read
  **"2278 … across 126"** before that, until the roster import learnt to read a
  file typed in Thai — `departmentMatch` is the 127th file and its sixteen cases
  are half about matching แผนก by any of its three names and half about refusing
  to guess when two of them collide. It read **"2282"** for the afternoon the fourth F-HR-027 column existed —
  withdrawing that round took its cases back out, and `formSignatures` gained
  three of its own for the colgroup and the header spans, which is where a
  removed column leaves a stale `colSpan` behind.
  It read "2281" an hour earlier, before the TWO cases that จาก–ถึง's four-line
  cell added to `entryRowChrome` — one for the spacing and the order of loudness
  in it, one for the two badges that wrap; the same round rewrote two assertions
  in that file for the footnote box's new padding and border, which are cases
  that already existed. **A figure measured in a tree two sessions are editing
  carries a timestamp**, which is why the clean-worktree "2259" further down is
  the one a clean run should be compared against.
  What the round added is fourteen cases in `disclosure` and no case anywhere
  else: the two assertions it rewrote (`description`, `formPrintScope`) are
  inside tests that already existed and pin the same two facts about a different
  element. The other three between "2259" and this figure landed in the same
  tree from the `flatDaily` work while this was being written — the file count
  moved by one, and that one is `disclosure`. (It read "2259 tests … across 125 files" until ข้อความอธิบายที่ยาว
  เกินหน้าจอ เริ่มพับเก็บได้, and
  "2240 tests … across 124 files" until ประวัติรายการ ในป๊อปอัปของผู้ตรวจ เลิกลิสต์
  แถวที่ระบบเขียนเอง, and "2195 tests … measured 2026-09-04" until เรียงใบตามรหัสพนักงาน
  reached every list of ใบ, and "2165 tests" until a month of scanner files
  became four rather than two, and "2157 tests … across 121 files" until the last
  twenty `<select>`s in the app became `PickOne` the same day.)
  It read "**This is the first green figure in this bullet for two rounds**"
  when 2240 was the figure, and what the two ⚠️ notes THAT one replaced recorded
  is worth keeping: both were measured while
  the working tree was mid-edit — the first on `components/common.jsx`, where
  `queueDropdown` was still greping for `% rows.length)` after `PickOne`'s row
  walker began spelling it `% n)`; the second on `components/App.jsx` and the
  `.tabs-view` fade in `app/styles.css`, which `settingsCoverageUi`,
  `roleNavTabs` and `popover` read as source. Both halves have landed. They were
  recorded rather than rounded off, because a green figure copied out of an
  earlier run is exactly the kind of sentence this file exists to stop.
  **The newest file is `test/queueHistoryFilter.test.js`** — thirteen cases,
  for ประวัติรายการ ในป๊อปอัปของผู้ตรวจ dropping the rows a policy replay wrote.
  Two of the thirteen are not about the filter at all: they name the two screens
  that must go on drawing those rows, because the round is a display rule on ONE
  pop-up and the failure available to it is a later tidy-up switching it on
  everywhere. **Before it the newest was `test/noNativeSelect.test.js`** — four
  cases, and the whole of it is one rule stated once over the whole tree
  instead of per screen: no component draws a `<select>`, an
  `<input type="date">` or a `type="time"`, and every list that opens is
  `.pick-menu`. Three screens had dropped the tag one at a time between
  2026-09-01 and 2026-09-03, each with a ban of its own, which is exactly the
  shape that leaves the twentieth behind — a per-screen rule is a rule about the
  screen somebody happened to be looking at. **Before it the newest was
  `test/scanFile.test.js`** —
  eighteen cases over the .txt a fingerprint scanner writes, run against the
  bytes of both machines' real files. **Before it the newest was
  `test/queueRoleFilter.test.js`** — fourteen cases
  for the round that let a หัวหน้างาน, การเงิน, ผู้จัดการแผนก or ผู้จัดการฝ่าย
  follow a request through to ฝ่ายบุคคล’s signature instead of losing sight of
  it at their own. Three of the fourteen are about the `บทบาท` filter that was
  asked for; the rest are about what a queue must stop offering once it holds
  rows its reader cannot sign, and about `OPENS_ON` — the only filter in this
  app a screen sets by itself, and therefore the only one that can leave
  somebody looking at an empty table they never asked for. **Before it, the one
  added last was `scope=team narrows and never widens — which is
  the only direction that matters` in `test/roles.test.js`** — the whole of
  `teamScoped`, as a table: a หัวหน้างาน asking for the company still gets their
  team, ฝ่ายบุคคล asking for a team still get the company because they sign
  none, and the one บทบาท the parameter moves is การเงิน, who hold both tabs.
  (It read `signing in reaches the app, and the flag is
  said in ink instead` in `test/tempPassword.test.js` until then — no new file, because
  deleting ตั้งรหัสผ่านของคุณ changes what `mustChangePassword` costs, and the
  file holding that bargain is the one that should fail if the screen comes
  back, if a skip state comes back with it, or — the failure that looks like
  nothing at all going wrong — if the flag ends up read by no screen. (It read
  "`ข้ามไปก่อน postpones the screen and changes nothing else`" for the few hours
  the skip button existed.)) **The newest FILE is still `test/printPdf.test.js`** — the two locks on the route
  that turns a print view into a file, the names those files leave under, and
  the one view that offers no file. **No new file for การเงิน's two screens**,
  and that is the point of where those cases went: the reading right is
  `lib/roles.js`'s and the writing refusal is `lib/entries.js`'s, so they are
  fourteen more cases in `roles`, beside the routing matrix they qualify — a
  file of its own would have been a second place to look for "what may a
  การเงิน do". (It read "2074/2074 … across 119 files" until the four first-step signers’ queues started listing a request until it is confirmed, and "2071/2071" until ตั้งรหัสผ่านของคุณ was deleted, and
  "2044/2044" before that, and "2000/2000 … across 118 files.
  The newest is `test/roles.test.js`" until บันทึกเป็น PDF started producing a
  file the same day, and "1983/1983 … across 117 files. The newest are `test/flatDaily.test.js`
  and `test/birthdayTick.test.js`" until บทบาท became seven the same day, and
  "2096/2096 … across 122 files. The newest is `test/queueStatusColumn.test.js`"
  until the same day, when ฝ่ายบุคคล’s birthday work was withdrawn and seven
  files went with it, and "2070/2070 … across 121 files.
  The newest is `test/screenTablePrint.test.js`" until 2026-09-03, and
  "2060/2060 … across 120 files. The newest is `test/oneRowPerDate.test.js`"
  before that.)

  **The rule at the form was already there** and needed nothing: `findSameDate`
  has refused a second live request on a date since 2026-08-31, on all four
  paths that write a session — filing, editing, the birthday sheet and the
  form's own live preview — with the sentence
  *พบรายการ OT ของวันที่ 05/08/2026 แล้ว กรุณาแก้ไขรายการเดิม*, and a refused or
  withdrawn request does not block the day, because `CAP_STATUSES` is what
  counts as live. `findOverlaps` catches a clash of minutes beside it.

  **What that rule could never reach was one request occupying two dates.** An
  overnight session filed against the 7th put its 00:00–07:00 on the 8th, above
  the 8th's own request — the only way left for a date to draw two lines. HR
  asked for that line off the sheet on 2026-09-02 and asked twice, with the cost
  stated both times, so `printsOn` now prints a segment only on the date its
  request was filed against.

  ⚠️ **THE HOURS ARE DROPPED, NOT MOVED, AND THE SHEET IS NOW SHORT ON PURPOSE.**
  They leave the rows and สรุปรวม together — a total counting a line the paper
  does not show would be worse than a short one — but every other document for
  the month still counts them: ตรวจสอบประจำเดือน, both CSVs, สรุป OT ส่งบัญชี and
  the department ceiling all read entries and segments rather than this route.
  So an overnight month will not reconcile against its own F-HR-027, and the
  difference is exactly `notPrintedHours`. That figure and the nights behind it
  are returned to the screen and raised as the second notice above the sheet —
  behind ยังไม่อนุมัติ, which decides whether to sign at all, and ahead of
  everything else, which this outranks — and as the second digest on a bundle of
  forty, so whoever is reconciling knows which sheets are short and by how much.
  It stays off the paper: adding a line to a controlled form to explain a line
  taken off it is not a trade this sheet makes.

  **Counted on the live database, read-only, on 2026-09-02: one entry.** Of 21
  live entries, exactly one crosses a midnight — in งวด 2026-08, dropping
  **7 hours from `ot3_holiday`**, the ×3 bucket and the most expensive one there
  is. It is the row in the screenshot the change was asked from. So the cost
  today is one person's August sheet reading 7 hours short against every other
  document for that month, and the cost tomorrow is every overnight OT filed
  from here on.

  `continuedFromPreviousDay` and the (ต่อจากคืนก่อน) mark went with the row —
  the flag could only ever be false once `printsOn` existed, and a flag that
  cannot be true is a false lead rather than a spare part.
  It read "2033/2033" until then.
  **Before it, `test/formSignatures.test.js`** — nineteen cases;
  the other eight of the twenty-seven since the figure before it landed in
  the same tree from other work the same afternoon, so the totals either side of
  this entry are not its arithmetic alone. ลงชื่อพนักงาน and
  ลงชื่อหัวหน้างาน are typed onto F-HR-027 now, and typed as a REPLACEMENT: HR
  asked for the printed name to BE the signature, so the sheet is not signed by
  hand after it prints. Nothing new is recorded to do it — `byName` on the
  entry's own history rows is what prints, through `managerSignature` in
  `lib/approverLine.js`, which is the module การอนุมัติ in the pop-up already
  reads. The paper and the screen therefore cannot come to name two different
  people.

  **Most of the cases are about when a name is NOT printed**, and that
  is the shape of the risk rather than caution. A blank box on a hand-signed
  form is an unsigned row somebody chases; a blank box on a form whose names are
  typed stays honest only while nothing prints a name nobody made. Two ways
  exist in this database for a row to have no signature to print and both are on
  prod: a request nobody has approved yet — still at รอหัวหน้า or รอ HR — and an
  entry old enough that its history carries no `byName`. Both print blank. An
  `adminOverride` row DOES print, with the administrator's own name: ADM has
  no หัวหน้า, somebody signed that step, and this is who.

  **There were THREE such ways until 2026-09-07**, and this paragraph read
  "`submit_hr_verified`, which ฝ่ายบุคคล filed off the fingerprint scanner and
  approved in the same act, so it has no หัวหน้า signature and never will" and
  "`approve_hr` prints blank too — it is the second signature and it has its own
  box at the foot of the sheet". HR reversed both: ลงชื่อหัวหน้างาน names
  **whoever pressed อนุมัติ**, so a row approved at the ฝ่ายบุคคล desk with no
  หัวหน้า step behind it carries that desk's name. The reversal was forced by
  ฝ่ายบุคคล's own OT — they file straight to their own step and may approve it
  themselves (2026-09-03), and those sheets printed approved with the box empty.
  `approve_mgr` is still read FIRST and still wins wherever it exists, which was
  asked about explicitly: taking simply the last approval would have rewritten
  every ordinary sheet in the database to say ฝ่ายบุคคล. The fallback reads the
  ROW and not the name, so an old `approve_mgr` carrying no `byName` still
  prints blank instead of dropping through to the confirmation underneath it.

  **The box holds a given name in bold and nothing else** — no surname, no
  brackets, no punctuation of any kind. `firstName` in `lib/api.js` is the split
  and it is the first whitespace-separated word, which is safe on THIS roster
  rather than in general: counted off the live database the same day, not one of
  the 22 writes a title as a separate word, so the first word is never a bare
  นาย/นาง/นางสาว. Five of the 22 have no surname at all and two of those five
  are the accounts that sign things — `ฝ่ายบุคคล` and `ผู้ดูแลระบบ` — so a
  single-word name comes back whole, or the box would go blank on exactly the
  rows an administrator signed for a แผนก with no หัวหน้า.

  **The type size was measured, not chosen — twice, and the pair is the point.**
  The sheet is rendered to PDF through Chrome and counted by PAGE. With
  ชื่อ-นามสกุล in a 19mm box, 6pt put a 25-row month onto two sides and so did a
  31-row one, and only 5.5pt held; widening the columns to 22 and 24mm fixed
  nothing, because what costs the row its height is the SECOND line and a long
  Thai name took one at every width. **Dropping the surname is what actually
  removed that line**, and the size went back up to the sheet's own 7.2pt, bold
  — 31 filled rows on one side with the longest signer on the roster
  (`ผู้ดูแลระบบ`, 11 characters), and 9pt would still fit. Through both rounds
  the `colgroup` never moved and รายละเอียดงานที่ทำ kept every millimetre.
  It read "( ชื่อ นามสกุล ) at 5.5pt" for one afternoon.
  It read "2006/2006" until then.
  **Before it, `test/hoursColumnCentred.test.js`** — the hour figures
  are in the middle of their cells now, on the printed
  ใบขออนุมัติทำงานล่วงเวลา and on ตรวจสอบประจำเดือน, and that is the whole
  change: one declaration in `app/print.css` and one selector in
  `app/styles.css`. **Six of the ten cases are about what did not move**, which
  is the shape of the ask rather than caution — three wider readings were
  offered the same morning and all three were declined. So the file pins the
  sheet's headings as they are (`เริ่ม 17.01-07.59` included, whose dots are
  the open question in docs/hr-briefing.md §ข้อ 0), the blank an hour cell keeps
  when the day has no OT — "-" and "0" were both offered and neither was wanted
  — and the 52px and 58px the screen's rate columns are still measured at,
  which is why the paper's long labels could not go on them. The four that are
  about the change: `.f027 td.n` centres, `.f027 td.c` still does beside it, the
  rule sits above every `@media` block in a stylesheet `app/layout.js` imports
  unconditionally — so the `.f027-screen` preview and the paper cannot be
  aligned two ways — and the shared rate-column rule now names `.total-col`
  alongside `.rate-col`. That last one had been half-written since it went in:
  the paragraph over it said "three rates and their total", and the selector
  under it said only `.rate-col`, so `รวม ชม.` centred on คิวรออนุมัติ, where
  the cell happens to carry both classes, and stayed right-aligned on
  ตรวจสอบประจำเดือน, สรุปทีม and สรุป OT ส่งบัญชี. It read "1996/1996" until then.
  **Before it, `test/overCeiling.test.js`** — an entry over a
  department ceiling cannot be signed without a sentence any more, either way
  and at either step. ไม่อนุมัติ has demanded one since it existed; อนุมัติ
  never had, which left the only record of why hours past a deliberate limit
  were sent to payroll being that a button was pressed. Nineteen cases: the
  rule refusing a blank and an all-spaces reason, a waived entry NOT being
  asked twice, that same waived entry still counting as over-ceiling for the
  accounting sheet, the approver's reason and ฝ่ายบุคคล's waiver staying on
  separate lines, the tooltip's hours being the long night rather than the
  whole month, and a ban on any `isOverCeiling` boolean existing beside
  `capExceeded`. It read "1977/1977" until then.
  **Before it, `test/smartDate.test.js`** — the era rule had been
  written four times by that morning (`lib/holidays.js`,
  `legacy/routes/holidays.js`, `lib/birthDate.js`, and nowhere at all on the
  roster form), and all four now read `lib/smartDate.js`. Nineteen cases: the
  rule, the 2400 line tested from both sides, the four spellings of one date,
  29 February judged in ค.ศ., the `03/25/1998` refusal that names the swap
  rather than making it, and — the two that are the reason the file exists —
  **no other source file may subtract 543 or compare a year to 2400**. Adding
  543 stays legal everywhere: a display that is wrong is seen the same day, and
  a stored year that is wrong is seen by nobody. It read "1940/1940" until then.
  **Before it, `test/birthDateImport.test.js`** — the roster CSV
  reads พ.ศ. and ค.ศ. both, so the three cases that pinned the refusal are
  gone and eleven stand in their place: `19/09/2515 → 1972-09-19`, the 2400
  floor shared with the holiday calendar, `/` and `-` on both shapes,
  29 February judged in ค.ศ. and not in พ.ศ., วัน/เดือน still refused when
  nothing in the file settles it, and the count the preview owes HR. It read
  "1932/1932" until then.
  **Before it, `test/settingsCoverageUi.test.js`** — the สถานะ
  block in แก้ไขแผนก holds the pill and nothing else, the sentence is behind a
  `TipButton` in one wording rather than open in two, `.dept-state-row` may not
  come back as a rule, and ลบแผนก is `.btn.ghost.danger` in the four-class
  selector that cannot lose the tie to `.modal-foot .btn.ghost`. It read
  "1931/1931" until then.
  **Before it, `test/withdrawalRowLayout.test.js`** — twenty-one cases
  over the reviewer's card on คำขอถอนใบที่อนุมัติแล้ว. It read "1915/1915" and
  "thirteen cases" until that card learnt to answer several requests at once.
  **Nine of the twenty-one are that round**: the count moved into the heading
  and the chip that used to repeat it is gone; `.withdraw-list` holds the stack
  to 400px and scrolls, because this card sits above the queue somebody works
  every day and its height is set by how many people asked for something; and
  the shape of **อนุมัติให้ถอนทั้งหมด** — above two or more only, an amber
  outline that writes nothing, a box that prints every reason in full, one POST
  per entry in order, and no ไม่อนุมัติทั้งหมด beside it.
  **The row underneath** was five things in
  one flex line with four of them `flex: none` and only the sentence allowed to
  give. What is pinned there is the allocation: `minmax(0, 1fr)` on the text
  column, the date chip and the name band sharing one grid row so their centres
  cannot drift, the two-class selector that keeps `display: grid` from being
  settled against `.item` by file order, and the split between what is held
  together (a code, a clock span *with the figure inside it*, a button label)
  and what is left to wrap (every line of Thai prose in the row).
  **Three of the first twelve are about what is NOT drawn**: the row offers exactly
  two buttons, `ไม่อนุมัติการถอน` and `อนุมัติให้ถอน`, and no chip of any kind —
  the green `อนุมัติ` status pill beside them was read as a third decision.
  What the pill said that the heading does not is kept as prose, and the test
  fails if it is made a chip again. It read "1912" until then.
  **Before it, in `test/pickTime.test.js`**, and the count did not
  move — one case replaced another: the minute wheel carries **all sixty
  minutes on every form**, so the five-minute step, the `minuteStep` prop and
  the rule that inserted a held value into the list are all withdrawn. They were
  one arrangement and it existed for one reason, which was the scrolling: while
  a column was the only way in, sixty rows was four screens of dragging to reach
  17:30. The header pays for it now — a minute is typed rather than reached —
  and the case that used to run `minuteValues` over 17:03 instead asserts that
  03 needs no insertion because it is simply the fourth stop. The birthday form
  loses its exception with it: `เวลาเข้า (สแกนนิ้ว)` keeps every minute by being
  like every other form rather than by asking for one.
  **Before it, in the same file**, over เวลาเริ่ม /
  เวลาสิ้นสุด being a HYBRID: two number boxes at the top that a keypad types
  into, over two wheels that snap to a band drawn across both of them. The file
  went from nineteen cases to twenty-five and it is the same control's third
  shape in two days — which is not indecision, it is each shape answering what
  the last one was actually wrong about. The wheel alone was hard to use because
  a 208px column shows six of twenty-four rows; the grids answered that by
  spending the whole panel on cells nobody presses, and still could not answer
  "I know the time, let me type it". **What makes the wheel bearable is the
  header above it** — being the only way in was the problem, not the scrolling.
  **Six of the new cases are about the two directions of the binding**: a valid
  keystroke writes the draft, which turns the wheel; a wheel that settles writes
  the draft, which fills the boxes; and `scrollTop === index × slot` is true for
  every stop, which is the arithmetic both directions rest on — two stops of
  padding at each end are what make it so. **Two are about what is refused and
  what is only marked**: a non-digit and a third digit never reach the box, but
  `25` stands with a red ring, `aria-invalid`, a line naming the ranges, and
  ตกลง shut — because the draft still holds the last good figure and applying
  THAT would be applying a time the screen is not showing. **And one bans the
  other two shapes by name**, `.time-opt` and `.time-grid` alike, so half of an
  old panel cannot survive in the stylesheet. It read "1896/1896" until then.
  **Before it, in the same file**, over เวลาเริ่ม / เวลาสิ้นสุด being two GRIDS
  instead of two scrolling wheels — **the count did not move**: nineteen cases
  in that file before and nineteen after, because most of them changed shape
  rather than number. (The grids lasted an evening. What survived them is the
  draft, ตกลง / ยกเลิก, and the reason the hours are all twenty-four.)
  **Three of its cases were reversals of what stood there**: `role="grid"`
  where a note argued that a column of hours is not two-dimensional, ←/→
  wrapping where ↑/↓ used to, and **nothing written until ตกลง** where the rule
  had been that every press applies immediately. The last is the one to read
  twice — ตกลง / ยกเลิก were asked for, and a ยกเลิก that could not take
  anything back would be a lie in a control that files somebody's hours, so the
  panel holds a draft and every way out except ตกลง leaves the field as it was
  found. What it costs is what the old rule bought: a panel walked away from
  mid-choice now keeps nothing. **Two more pinned what the first wheel left
  behind**, and both still hold under the second one: no `scrollIntoView`
  anywhere in the component — the wheel that came back turns by writing
  `scrollTop`, which is exact — and none of `.time-cols`, `.time-col-head`,
  `.time-list` or `.time-opt` in the stylesheet. **Six popular hours
  (17:00–22:00) was the other shape offered** for the hour grid and it was
  refused on the value rather than the layout: this same control is
  เวลาสิ้นสุด, where a shift ending 00:30 is ordinary, and OT on a holiday
  starts at 08:00. Neither is between 17 and 22.
  **Before them, in `test/queueDropdown.test.js` and
  `test/popover.test.js`**, over `PickOne`'s panel being portaled. The count
  went DOWN: four cases about this list placing itself in the page — a
  `z-index: 21` clearing the queue's sticky toolbar, a `.up` flip measured
  against `.mobile-nav`, its own scroll-and-resize listeners, and the
  `left: 0; right: 0` that made it its box's width — became two about not having
  to. `Popover` does all of it, which is what `popover.jsx`'s own header said
  from the day it was written: a second copy of the placement arithmetic is how
  two popups that are supposed to be one panel start behaving differently. They
  already had — the calendar could escape a `.modal`'s `overflow: hidden` and
  this could not. The one thing a dropdown needs that the other three do not is
  `matchWidth`, and it is still not a number: the width is read off the anchor
  on every placement. It read "1896/1896" until then.
  **Before them, two in `test/pickTime.test.js`**, over the quick-time
  chips now moving the wheels instead of closing the panel, and over the minute
  column no longer drawing a scrollbar — which in a two-column popup was a line
  down the middle, because the hour column's bar sits at ITS right edge. Three
  more in that file were rewritten: the minute column steps by **five** now,
  except on the birthday form where the times come off a fingerprint scanner,
  and the assertion that matters most is that **a held value not on the step is
  inserted into the list** — without it an entry filed at 17:03 opens with
  nothing selected and the first arrow press moves it silently. (**All three of
  those are gone now**, and the newest entry above says why: the step, the
  `minuteStep` prop and the held-value insertion were one arrangement, and it
  existed because a column somebody scrolls made sixty rows expensive. The
  header made a minute something you type, so the minutes went back to all sixty
  on 2026-09-02 — on every form, the birthday one included, which is no longer
  the exception. 17:03 needs no insertion when 03 is simply a stop.)
  It read "1894/1894" until then.
  **Before them, three in `test/proxyTeamSearch.test.js`**, over the
  microcopy บันทึก OT แทนพนักงาน lost — the sub-header, the note under the
  picker and the blue panel — and over where the third of them went. Two of the
  three are about what may NOT follow from "make this shorter": the sub-header
  is behind `!proxy` rather than deleted, so the employee's own form and the
  birthday row keep it; and the ⓘ still says which of the two routings applies
  today, because that is a policy flag read off the server and the one-line
  wording proposed in its place would have promised HR routing unconditionally.
  The `<Alert kind="info">` ban is scoped to the picker block, since this form
  draws two other info panels about a computed preview. It read "1891/1891"
  until then.
  **Before them, two in `test/submissionWindowForm.test.js`**, and they
  are a ban and its counterweight: the sentence under วันที่เริ่ม that said the
  date range in words is **gone**, and neither of the two wordings it had that
  day may come back quietly — while the BOUNDS it described are asserted to be
  untouched, because "remove the line" and "remove the limit" look identical in
  a diff a year from now. Those two replaced the pair that had pinned the
  rewritten sentence a few hours earlier. The file also gained the
  comment-stripper the other four screen-test files carry, and it earned its
  place on the first run: the paragraph explaining the rewrite QUOTES the old
  sentence, so the assertion that the box "says the range in words" went on
  passing against a comment describing the wording it was there to replace.
  Fifth time in this repo. It read "1889/1889" until then.
  **Before them, nine REPLACED cases in
  `test/proxyTeamSearch.test.js`** — the total did not move, because the search
  box those nine held down came out the same day and nine cases about the picker
  it left behind went in where they were: that no part of the search grew back
  (the state, the filter, the `<mark>`, the four imports), that the label counts
  at nought as well, that the box scrolls at a capped height with a scrollbar
  recoloured to belong to it, and that a ticked row carries a green ring with
  the hairlines on both sides of it dropping out. Three of the nine were bugs
  the box made possible and are now unreachable rather than guarded — see
  §หัวหน้าบันทึก OT แทนลูกทีม. **Before them, two in
  `test/queueDropdown.test.js`**,
  over สถานะที่นับ on ตรวจสอบรายเดือน — the last `<select>` on THAT screen
  (ส่งบัญชี, ตั้งค่าระบบ and บันทึกระบบ still have theirs), and the first
  `PickOne` with no "stop filtering" row to add under its options — and over the
  panel's width, which is pinned as two offsets rather than as a number.
  Measured on the built app in ธีมมืด at 1280, 1440, 360 and 320: the panel's
  left and right edges are **0.00px** from the box's at every width, it sits 4px
  under it, and `document.scrollWidth` equals the viewport in all four.
  It read "1887/1887" and then "1888/1888" until then.
  **Before it, `test/pickTime.test.js` and `test/popover.test.js`**,
  over เวลาเริ่ม / เวลาสิ้นสุด and over the panel all three of the app's own
  pickers now share. The time boxes were the last native popup in the app and
  the only one that was not merely a styling complaint: an `<input type="time">`
  renders in the VIEWER's locale, so on an English-locale Windows the stored
  `17:00` was drawn as **05:00 PM** — in a form about overtime between 17:00 and
  20:00 น., on a screen where the queue's rows, the preview under the form and
  ใบ F-HR-027 all print 24-hour. No attribute on that tag settles it; the format
  is the browser's business. Drawing it ourselves is what makes 24-hour a fact.
  `popover.test.js` exists because the panel came OUT of `PickDate.jsx` when the
  third picker arrived — the alternative was a second copy of the placement
  arithmetic and the three listeners, which is how two popups that are supposed
  to be one panel start behaving differently. Its first assertion is that there
  is one of it: only `popover.jsx` builds a `.pop`, and `Modal`'s own portal is
  excused by name, since two things needing the same escape from
  `overflow: hidden` is not two copies of one thing.
  One case pins what only opening the built app found — again: both time
  columns focused their own selected option on mount, so the one that mounted
  second won and the panel opened with the cursor on the MINUTES, where one
  press of ↓ turned 17:00 into 17:01. The columns themselves came out on
  2026-09-01 and the case outlived them: two GRIDS have the same defect
  available to them, so exactly one of them holds the cursor and it is the
  hours. It read "1866/1866 … across 112 files" until then.
  **Before them, twenty-five in `test/pickDate.test.js`**, over
  `PickDate` and `PickMonth` — the app's own calendar, now behind all eighteen
  date and month boxes. The wall was the same one the queue's `<select>`s hit
  one round earlier and one step further along: an `<input type="date">`'s box
  is in this document and every rule in `app/styles.css` reached it, but the
  calendar it dropped down is drawn by the browser and the OS, is not in the
  DOM, and no selector in this app has ever entered one. Two paragraphs — the
  note over `input:out-of-range` and the one over วันที่เริ่ม — already said so
  and settled for it, because all that was asked of that calendar then was to
  grey out the days outside `min`/`max`. A `z-index`, a portal, an edge to flip
  off and a sheet on a phone are none of them reachable on an element nobody
  here renders.
  Three of the twenty-five pin what only opening the built app found: the panel
  is portaled to `document.body` because `.modal` carries `overflow: hidden` and
  `isolation: isolate` — measured at a 520px viewport, the dialog runs 31→489
  and the calendar 218→512, hanging 23px below the dialog and fully on screen;
  it takes `z-index: 120` over the backdrop's 100, which is a departure from
  "nothing above the dialog" argued out in `test/modalCloseButton.test.js`; and
  the frame before it is placed is hidden with `opacity` rather than
  `visibility`, because a `visibility: hidden` element cannot take focus and the
  grid's own focus call was landing on one — `document.activeElement` was `BODY`
  with the calendar open and the arrow keys did nothing.
  One of them also caught a plain missing import: `LogSystem.jsx` drew two
  pickers it had never imported, which builds clean and throws the moment
  บันทึกประวัติระบบ is opened. It read "1841/1841 … across 111 files" until then.
  **Before them, one case in `test/proxyTeamSearch.test.js`**, over the
  clause under รออนุมัติ that names whose queue this is. `เฉพาะแผนกวิศวกรรม`
  was breaking as `เฉพาะแผนก` / `วิศวกรรม`, orphaning the department's own name
  on a second line — and the break is the browser doing something correct:
  half the notes in `app/styles.css` lean on Thai setting no spaces between
  words, which is only true where the browser has no dictionary. Chrome has
  one. So the fix says that clause is one word, which MOVES the break to the
  `·` between the two facts rather than forbidding one. It is half a change:
  an unbreakable clause has a min-content width, and on a phone this hint sits
  in a column whose width every other rule in that head assumed was decided by
  the TITLE. Measured at 360px, the clause with the longest department then on
  the roster was 142px against the title's 129 — the column grew and the
  one-line head went from 33px of headroom to 2. It read "The hint drops to
  11px in that head alone, which brings the clause to 125px and the geometry
  back to what it was" until 2026-09-08, when the roster import made that
  clause 27 Thai characters, the head overflowed its card by 93px, and the head
  stopped being one line — which is what the 11px note itself had said the
  remedy would have to be. The hint is back at 12.5px everywhere.
  It read "1840/1840" until then. The same round loosened `.alert` from 1.6 to
  1.75 for the blue notice on บันทึกแทน — the longest alert in the app, five
  lines of Thai in one colour with no inter-word spaces to give the paragraph
  any texture — which moved an assertion in “test/absentCallout.test.js” (ลบแล้ว 2026-09-03) rather
  than adding one. (That notice went behind an ⓘ later the same day and the
  value stays: 1.75 was never about that paragraph, it was about a solid block
  of Thai at 13.5px.)
  Before it, twenty-two in `test/queueDropdown.test.js`, over the
  แผนก and เดือน filters on รายการรออนุมัติ now that neither is a `<select>` —
  and, since later the same day, over สถานะที่นับ on ตรวจสอบรายเดือน, which was
  the last `<select>` on that screen and is the first caller with no "stop
  filtering" row: `allLabel` names a row carrying `''`, and `''` is not a
  สถานะที่นับ this app has a reading for. The twenty-second pins the panel's
  WIDTH, and pins it as the absence of one: `.pick-menu` is `position: absolute`
  with both `left: 0` and `right: 0` inside `.pick-one-wrap`'s
  `position: relative`, so the panel is the box's width by construction and has
  no number that could drift from it — which is what a native `<select>`'s list,
  an OS overlay sized to its longest option, could never promise. It read
  "twenty" and then "twenty-one" until then.
  The file exists because of what a stylesheet cannot reach: a `<select>`'s box
  is an element in the document and every rule in `app/styles.css` could style
  it, but its options are drawn by the browser and the operating system, are not
  in the DOM, and no selector in this app has ever entered one — so on ธีมมืด
  those two filters opened as a white sheet with the system's blue selection bar
  on it. The list is the app's own elements now, which means everything the tag
  gave for free is given back by hand, and that is most of what these twenty
  pin: the keys (↑↓, Enter, Space, Escape, Home/End, and the 900 ms type-ahead),
  the ARIA the tag used to imply, that the panel is `PickPerson`'s `.pick-menu`
  and not a fourth floating box, that the box's height and inset are the
  `.field` tokens rather than a second copy of them, and that there is exactly
  ONE highlight — the pointer writes to `data-active`, so a mouse resting away
  from the keyboard's row cannot light a second one. Three of them pin what
  only opening the built app on a phone found: the panel takes `z-index: 21`
  because `.queue-mobile-bar` is sticky at 20 and was covering its first row,
  it closes on a page scroll — which is what makes that number safe against
  `.pick-menu`'s own note — and it opens UPWARDS when the box is too near the
  bottom, measured against the fixed นำทาง bar's top edge rather than the
  viewport's. One of them is the
  comment-stripper's own self-test, which caught this file's first `<select>`
  ban matching the paragraph in ApprovalQueue.jsx that explains why there is no
  `<select>`. It read "1820/1820 … across 110 files" until then.
  **Before them, nine in `test/proxyTeamSearch.test.js`**, over the
  search box on บันทึก OT แทนลูกทีม — one of them is the stripper's own
  self-test, which caught this file's first stripper eating `const shownTeam`
  and would have let every ban in it pass against source it could not see.
  (Those nine were replaced on 2026-09-01 when the box came out; the file kept
  its name and its stripper, and the self-test now anchors on the words the
  removal is recorded in.)
  Before them, eight in `test/roleNavTabs.test.js`, over the menu
  now that it is built one block per role — which tab sits behind which gate,
  in what order the gates open, and that the count badge names its colour once.
  Before them, five in `test/logChartBars.test.js`, over
  ปริมาณการใช้งานรายวัน on ภาพรวม of บันทึกระบบ — the fourteen-day chart that
  drew a row of date ticks and nothing else. Every height in it is a
  percentage, so the whole picture rested on `.log-chart` stretching its bars:
  unstretched, each bar was as tall as its own date label. Two of the five pin
  that, one pins the floor under คำสั่งแก้ไขข้อมูล — three writes among six
  hundred requests rounds to 0% — and one pins that the floor cannot paint a
  foot on a day where nothing was edited. It read "1792/1792 … across 107
  files" until then.
  **Before them the newest seven were in `test/logPanelRows.test.js`**, over the four
  counted lists on ภาพรวม of บันทึกระบบ, which now all open on the same number
  of rows. Two of the seven are the layout itself; the rest are the rule
  underneath it — one number for all four cards, no larger than the smallest
  cap the endpoint sends, opening the rest scrolls the list rather than growing
  the card, and something on screen says so, because a card that does not
  change height is a card that looks like the button did nothing. It read
  "1785/1785 … across 106 files" until then.
  **Before them the newest nine were in `test/holidayDeleteConfirm.test.js`**, over
  the ยืนยันการลบ dialog that replaced `window.confirm` on วันหยุดบริษัท. Only
  four of the nine are about that screen; the rest ban the browser's own box
  across every file in `components/`, because a `confirm()` that creeps back is
  visible from nowhere except the running app, on a press nobody re-walks. It
  read "1776/1776 … across 105 files" until then.
  **Before them the newest twelve were in “test/birthdaySelfFiling.test.js” (ลบแล้ว 2026-09-03)**, over
  สวัสดิการวันเกิด ยื่นเองไม่ได้ — the rule and the badge that goes with it.
  Half of that file is about what is still ALLOWED: a หัวหน้า filing for a team
  member on their birthday, and a shift filed against an ordinary day that ran
  past midnight into one. A refusal that took those away would be taking hours
  people worked. It read "1763/1763 … across 104 files" until then.
  **Before them the newest six were in `test/overlap.test.js`**, over หนึ่งวัน
  หนึ่งใบ — a date carries one live request and no more, because F-HR-027 has
  one line per day. Two of them are the pair that says why the older minute
  rule stayed: 08:00–12:00 and 18:00–21:00 on one day share no minute and are
  refused anyway, and a shift filed against the 4th running to 02:00 is a
  different DATE from a request on the 5th and shares hours with it anyway. The
  rest pin the sentence HR asked for word for word, that an edit does not find
  itself sitting on its own date, and that the form prints the SERVER's
  sentence rather than a second wording of it.
  **Before them, one case in `test/withdrawal.test.js`**: that each of
  the two refusals either side of the first signature names the OTHER side's
  button — ยกเลิก before it, ขอถอนใบ after it — rather than sending anybody to
  ติดต่อฝ่ายบุคคล, which is what `cancelPermission` was still answering months
  after ขอถอนใบที่อนุมัติแล้ว replaced that very sentence.
  **Before them, three more in `test/overlap.test.js`**, and they are about
  the half of เวลาทับซ้อน that is a SCREEN rather than a refusal: that
  `app/api/entries/preview/route.js` asks the same helper the write paths refuse
  with (it was “refuseOverlap” until หนึ่งวัน หนึ่งใบ folded both rules into
  `refuseDayConflict`) — with `excludeId`, or editing an entry would report it
  as clashing with itself — and that
  `components/OtForm.jsx` prints the clash and greys บันทึก on it, except on a
  proxy batch of more than one, where the preview belongs to the first name
  ticked and the other seven must stay filable. The rule was never the gap; the
  refusal arriving only after the press was.
  **Before them, `test/periodStatus.test.js`**, which replaced
  test/periodLock.test.js when ปิดงวด was withdrawn on 2026-08-31. Four of them
  are unusual and worth knowing about: they read the WHOLE TREE and fail if
  anything imports the deleted lock model, calls `refusePeriodLock`, leaves a
  `close` or `reopen` endpoint on disk, or lets the status card grow a button.
  A half-removed feature is worse than either state — a route still refusing a
  month nothing can close is a refusal nobody can lift — and that is the shape
  those four exist to catch. Two whole files went with the feature
  (periodLockRoutes, replayPeriodLock), which is where the drop from "1780/1780
  across 106 files" comes from.
  **Before them were thirteen in `test/approverLine.test.js`**, over
  การอนุมัติ — the block in the employee's own pop-up that names every signature
  on a request rather than only the last one. They exist because the line that
  was there answered a different question well: `approverLine` prints the LAST
  decision, which is the right way to say where a request stands and the wrong
  way to say who signed it, since on a fully approved entry the last decision is
  the ฝ่ายบุคคล step and ฝ่ายบุคคล is one shared login. The หัวหน้า who read the
  request and signed it first was on no screen the employee could open. Four of
  the thirteen are about what the words may NOT say: that the desk is read off
  the `action` and never off the signer's live `position`, so a promotion cannot
  silently re-label a signature somebody made two years ago as a title they did
  not hold; that `ฝ่ายบุคคล (ฝ่ายบุคคล)` is never printed, because a name that
  already IS the desk repeated in brackets reads as two parties; that a stand-in
  and an administrator's override both survive into the list, since "who signed"
  without "on what basis" is the half of the answer nobody disputes; and that
  nothing which has not happened yet carries a time. **The file before it is
  `test/pressChrome.test.js`**, four cases over the
  two rectangles a browser draws on a control — the tap highlight under a finger
  and the focus ring around a keyboard — and every one of them is about WHERE
  the declaration lives rather than what colour it is. That the tap highlight is
  declared exactly once, on `html`, because the property is inherited and a
  per-control list is one somebody has to remember to add to. That the focus
  ring has a base rule at the lowest specificity there is, so every deviation
  already in the file still beats it. That **no control repeats the base ring**,
  which is the assertion with the history behind it: eight of them had written
  it out for themselves. And that `outline: none` is never written across the
  app — the answer to a ring being the wrong colour is a different colour, not
  the deletion of the only thing a keyboard has to go on. The file parses the
  stylesheet into rules rather than grepping it, because "no rule anywhere says
  X" cannot be asked of a string. **The case before it is in
  `test/holidayNotice.test.js`**, which arrived with
  ประกาศวันหยุดบริษัท: nine cases over the pure filters in `lib/holidayNotice.js`
  — month boundaries as string comparisons, a row with an unusable date dropped
  rather than repaired, วันหยุดถัดไป counting today itself — and twelve over the
  decisions that are not arithmetic. Those last are the ones worth having: that
  the banner is mounted on both employee screens (one component returns the form
  *instead of* the dashboard, so a single mount would miss the screen where the
  date is chosen) **and on the landing tab of every other role** — the second
  half arrived when the announcement was opened to หัวหน้า, ฝ่ายบุคคล and admin,
  and it reads `defaultTab` alongside the mount so that a role added to one and
  not the other cannot go unannounced; that nothing can dismiss it, that it is not a third pinned
  band, that its green comes from a token, that the calendar dialog does not
  re-fetch what the banner already holds, that on a phone its button is the
  card's own 44px row and stays outlined rather than taking the brand green off
  the primary button a card away, and — after the rates sentence was removed on
  request — that the fact about เสาร์–อาทิตย์ is still stated in the calendar
  dialog. **That last pair is why the file reads the component with its comments
  stripped**: the comments quote what was deleted and why, so an assertion made
  against the raw file would pass on the strength of an explanation of its own
  failure. The same trick holds the rule that the holiday NAMES are dropped for
  every row rather than for the two whose name prompted it — a filter that read
  what a row said would put the screen and the engine on different lists of
  which days are holidays. **And the one before that is in
  `test/buttonBox.test.js`** — the same lesson as `pressChrome` from the other
  end of the file — and it is the fourth
  report of one row, and the first that changed it: ส่งบัญชี and แยกแผนก were
  reported over and over as "the buttons do not line up with the tick box beside
  them", and three rounds answered by measuring the level — centre 0.00px, text
  baselines 0.45px, 1024 to 1920. What was being seen was the AIR above each
  side, which is row 1's 23.75px of column difference and cannot be paid off in
  row 2 without taking the two out of level. The tick box takes the buttons'
  height and a rule of its own instead, so the row has one top edge and one
  bottom edge; the pin holds `align-self: stretch`, the border, and that its
  radius and colour stay `.btn.ghost`'s rather than a matching pair of their
  own. It read "1728/1728" before that, and "1727/1727" before the case beside
  it — that one pins that neither screen answers the alignment question locally:
  one shared `.action-row`, the plain/ghost pair the base rule below is about,
  no `alignItems` and no `marginTop` of their own. A hand-rolled row on either
  is how one report becomes two answers.
  **That file was the 104th when it arrived**, and it pins
  one declaration: `.btn` carries a 1px transparent rule so that `.btn.ghost`,
  `.btn.outline` and `.btn.on-hero` — which each add a real one — stop standing
  2px taller than the filled button beside them. That had been patched in six
  containers one at a time before it was fixed once in the base; the padding
  drops 1px to pay for the rule, so no button that was already the right size
  changed size. Two more cases went into `test/monthSearch.test.js` for the
  heading row `.head-split`, now shared by ตรวจสอบรายเดือน, ส่งบัญชี and
  สรุป OT แยกแผนก — the third caller was added without a line of CSS, which is
  the whole of what naming the rule for what it does rather than where it
  started was for.
  It read "1722/1722 … across 103 files", and before that **the count came DOWN
  by one**: the two
  cases in `test/modalScrollFrame.test.js` about `backdrop-filter` became one
  when the filter itself went. They used to pin the workaround — the two bars
  dropping the filter under a dialog — and that the two were its only carriers;
  the invariant now is that **nothing in `app/styles.css` carries it**, so the
  compositing hazard cannot recur rather than being answered while a dialog
  happens to be open. Beside it, the opaque `--bar-ground` in both themes and a
  negative on the two translucent tokens coming back. **And the one exception is
  named rather than left as a gap**: `.sheet-hint` in `app/print.css` still
  carries a 2px blur, and the case asserts it is the only one there and that it
  stays `position: absolute` with `pointer-events: none` — a pill inside a scroll
  wrap cannot span the viewport or outlive a dialog, which is what the hazard
  needs. That assertion exists because the paragraph beside it claimed "nothing
  in this app" for an hour, against a second stylesheet the test did not read. The case is also a small
  lesson about this file: its own paragraph quotes the rule it says was removed,
  so the negative assertion strips the commentary before searching — the trap
  four assertions in the sibling file have been caught by.
  The case before it is in `test/hrMonthCards.test.js` for the fold at three over
  the employee list, and what it pins is the property the seven arrangements
  before it produced: **the fold exists only where the pager does not**. Its
  three conditions are asserted as one expression — `pageCount === 1 &&
  !query.trim() && shown.length > CARD_FOLD` — because each is a way a folded
  row could become unreachable: a pager beside it, a search whose matches it
  would swallow, or a month too short for the button to hide anything. Beside
  them: that `off-page` now ends at `cardsTo` so one class still answers one
  question, that `goToRow` opens the fold as well as setting the page, and that
  `.cards-more-row` joins `.pager-row` in being `display: none` above 860px.
  It read "1722/1722" before it.
  The case before that is in “test/birthdayCardUi.test.js” (ลบแล้ว 2026-09-03) for the fold button’s
  wording: that the noun is CHOSEN from the folded rows — “SETTLED_STATUSES”,
  the app’s own "nothing left to do" list, which excludes ยังไม่ถึงวัน — rather
  than written into the label, with that list asserted at its source so a status
  added later cannot be silently described as checked. A month with a birthday
  still ahead reads ไม่ต้องดำเนินการ; every other month reads ตรวจสอบแล้ว, which
  is the wording that was asked for. It read "1721/1721" before it, and **that
  count held across three rounds the same day** and the cases under it
  moved each time; the last of them added the assertion this file most wants
  kept — that the pager is wrapped in `{pageCount > 1 && …}` **with both
  reasons written beside it**, because that condition has now been added,
  removed and added again, and that the condition is on the ROW rather than on
  the buttons inside it, since a band that keeps its height and empties itself
  is the shape problem its 2026-08-26 removal was written about. Beside it: that
  `.pager-row` states a TOP margin only and `รวมทั้งหมด` states its own, which is
  what stops the gap over the total from disappearing with the row it used to
  hang on.
  The newest case is in “test/birthdayCardUi.test.js” (ลบแล้ว 2026-09-03) for the card's last two
  numbers — `min-height: 36px` on its two buttons and `padding: 8px` on the card
  — pinned **together with the 44px the employee cards and วันเกิดรอตรวจ keep**,
  because the failure mode is somebody harmonising the three to one number in
  either direction, and with `.btn.sm`'s own padding asserted beside them because
  a `min-height` under 38 decides nothing without `padding-block` coming down
  with it. The 44 was refused five times and the reasoning for giving
  it up is over the rule: WCAG 2.2's minimum is 24×24, the target is 152 × 36,
  and both answers are reversible. The case beside it, in
  `test/hrMonthCards.test.js`, pins that a disabled pager chevron is an OUTLINE
  — `background: none`, `--line`, `--muted-2` — with the app-wide
  `.btn:disabled` asserted untouched beside it and `opacity` asserted absent,
  since the fade was tried and rejected once already. It read "1720/1720" before
  them. **That count did not move on 2026-08-28's first round and three cases
  changed under it**, all in the same two files,
  because that round rewrote a layout rather than adding a behaviour: the birthday
  card's grid is `auto auto minmax(min-content, 1fr)` with วันเกิด, แผนก and
  บริษัท on ONE row and ชั่วโมง under the chip; the date is drawn twice, long and
  short, with the stylesheet picking — asserted in both directions, plus that the
  switch is scoped to `.bmonth-table` and that no `::before` label came back onto
  the fact line; and the pager band asserts `margin: 12px 0` where it asserted 6.
  The `white-space: nowrap` case survives unchanged and now reads as the reason
  the date had to go SHORT rather than the reason it could not be paired.
  The case before those is in “test/birthdayCardUi.test.js” (ลบแล้ว 2026-09-03) for the fold on
  วันเกิดของเดือนนี้, and what it pins is the one property that makes a fold
  safe on this screen: WHICH rows go. The class is written as an exception —
  `status === DUE ? undefined : 'settled'` — so a status added later folds by
  default and can never become a row that asks something off screen; the count on
  the button comes off the same test, so what is said and what disappears cannot
  drift apart; the hiding rule is asserted present in the phone block and absent
  from the desktop half of the file; and the button names both classes, because
  `.btn` sets `display` and a bare `.bday-more` would tie with it on specificity.
  It read "1719/1719" before it. The one before that is also in that file and
  pins a REVERSAL, so
  that it is not tidied back: the employee code sits on the name's line on
  ตรวจสอบรายเดือน's birthday card and on its own line in วันเกิดรอตรวจ, and the
  test asserts both directions — the second is what makes the first affordable,
  since a column of codes is worth keeping on the screen somebody might scan by
  code and not on a card that holds one person per birthday. The case beside it
  moved with the layout: แผนก joined บริษัท and ชั่วโมง on one row, so the grid
  is three tracks and the area sweep no longer expects `co` or `hrs` to open a
  row. It read "1718/1718" before them. The one before that is in
  `test/approverMultiDepartment.test.js`, which owns
  `.pick-menu`, for the suggestion panel becoming a surface of its own rather
  than the card it opens over: the two tokens (`--card-lift` and `--line-lift`)
  and both halves of the light-dark pair, since the asymmetry — the same white
  on the light theme, one step up on the dark — is the whole content of that
  token. The case beside it gained the two-part shadow and a negative assertion
  that the panel has not gone back to `--shadow-1`, which was measured and
  rejected on `.dept-menu` a round earlier; that assertion was written wrong
  twice and both ways are recorded beside it, the second being that it caught
  the comment written to justify it. It read
  "1717/1717" before it. The two before that are in “test/birthdayCardUi.test.js” (ลบแล้ว 2026-09-03) for the birthday
  card being compacted on ตรวจสอบรายเดือน: that the short facts share a line
  while วันเกิด may not — pinned together with the `white-space: nowrap` in
  HrView that is the REASON it may not, so removing the nowrap fails the test
  that would otherwise let the pairing spread; that case now reads
  "วันเกิด, แผนก and บริษัท share one line, and the short date is what pays for
  it", which is the same assertion answered the other way round — and that
  `padding: 0` on those
  cells names the element (`table.bmonth-table td`), because the bare class had
  been losing to `table.mini` since the card was written and every cell had been
  carrying 7px of padding nobody had asked for. Three existing cases were
  rewritten rather than adjusted, each with the reason: the grid-area sweep no
  longer expects `hrs` to start a row, the pager band asserted its "6px" margins
  (12 since 2026-08-28) and that the tbody is still a flex column so they ADD to
  the gap, and the two containers above the list read 18px under themselves
  rather than 13.
  It read "1715/1715" before them. The two before that are for งวดกับช่องค้นหา going above the export buttons
  and the card round the list coming off: that `.month-find` is inside
  `.month-head` and before `.export-row`, and that below 860px `.month-card`
  states all four of `background: none`, `border: none`, `border-radius: 0` and
  `padding: 0` — all four, because a border with no fill is still a frame — with
  no `--month-pad` and no full-bleed pair left anywhere in the rules. It read
  "1713/1713" before them. The one before that pinned the padding the containers
  above the list gave back that evening — it read that `.month-head` and
  `.month-card` share one `--month-pad` and that the strip’s side margins are
  measured from it rather than written as a number beside it, which is history
  now that the token and the strip are both gone; what survives in it is the
  12px on `.month-head` and that `.card`’s own 15px phone padding did NOT move
  for the rest of the app. It read "1712/1712" before it. The four
  before that are in the same file for ประจำเดือน moving
  down to join ค้นหาพนักงาน on ตรวจสอบรายเดือน: that the picker is in the row
  with the search box and appears exactly once, that the month comes first in
  that row, that the picker declares a width of its own rather than taking half
  the row, and that the UTF-8 BOM line under the export buttons is gone. (Two of
  those four were reworded the same day and one clause of them dropped: the row
  is not above the list any more, and ค้นหา is not the last thing before the
  first card.) It read "1708/1708" before them, and **it had gone
  DOWN by nine earlier that afternoon**, which nothing else in this
  list has done: สรุป OT ส่งบัญชี's search box was removed and the nine cases in
  `test/monthSearch.test.js` that pinned it went with it — its filter and what
  may not follow it, its `.acct-find` row, its debounce, its listbox, what a
  suggestion held, what a pick did, and the flash on its cells. That file is
  ตรวจสอบรายเดือน's alone again and everything it shares is still pinned there.
  It read "1717/1717" before that. `test/acctScrollHint.test.js` was the 103rd
  file and was the newest until `test/buttonBox.test.js` above. It arrived with
  the extra case `test/docsMatchCode.test.js` gains from counting it: they pin
  the right-edge fade on สรุป OT ส่งบัญชี — that it is a phone rule, that it
  reaches those two sheets and no other table, and the declarations that are
  load-bearing and invisible on a laptop (the table may not shrink, the fade
  itself is not behind the `@supports` gate while switching it off is, it fades
  to the card rather than through grey, a table that fits draws none at all, it
  does not take the tap meant for the cell under it, and `animation-timeline` is
  declared after the shorthand that would reset it). It read "1715/1715" earlier
  the same day, "1707/1707 … 2026-08-26 across 102 files" before that, and
  "1706", "1701", "1700", "1699", "1697", "1694", "1689", "1687", "1678" and "1672" earlier the same day and "1654, measured
  2026-08-25" before that, which was five behind
  the tree rather than a change: the count was simply not re-run after the last
  few cases landed. Before that, "1653", "1651", "1649", "1646", "1641", "1638"
  and "1601" earlier that day, and "1386 across 86 files, 2026-08-24" before
  that. It also read "1662" for part of 2026-08-26, while สรุป OT ส่งบัญชี had a
  phone layout of its own; that was reverted the same day and its four cases
  went with it — see §"The screen and the paper are two different documents".
  The eighteen newest are the whole of `test/entryRowChrome.test.js`, the
  102nd file — it held "nine", then "eleven", "fourteen", "sixteen" and
  "seventeen" earlier the same day — and they pin the
  last cell of a row on รายการ OT: that the one thing which can be pressed is the
  only thing drawn as a button and that a disabled one may not come back, that
  nothing in a row writes its own type size any more, that the flex row's wrap
  belongs to the card layout and not to the table, that the pencil is drawn
  rather than typed and sized by a class, that a ghost button's hover and press
  are a ladder and neither names a colour, the 10px field rhythm, the chip under
  a description, three on the footnote under the table — that it is a bordered
  wash rather than a hairline and is still not faded past reading, that its two
  rules are one bullet each and not one sentence joined by a ·, and that below
  860px its edges sit on the cards' edges rather than 12px outside them — and
  three more from the same afternoon: that the bar above the table centres its
  two halves on one axis and that the inherited `margin-bottom` which broke that
  is the explanation, that on a ยกเลิก row the live control outweighs the dead
  sentence and does it with an edge rather than a fill, and that the one value
  which wraps carries a line-height **and** a padding, because a line-height puts
  only half its growth under the last line and what sits below is a label, that
  the notice under the employee's name has one place whether or not there is a
  notice to put in it, that every row's last cell is the same two slots and they
  line up down the month, that a bar with nothing to show fades while the
  sentence explaining why it is disabled does not, and that the bar puts its
  sentence at the right end or under the label and never adrift — with no
  breakpoint, because the width of the words is what decides. Five in `test/hrMonthCards.test.js` joined them for the notice both screens draw:
  that the panel says its instruction in the same `.say` the list does, that the
  shortened fourth sentence still says why and where, that the screen it names is
  a link when a caller offers one and plain text when it does not, that a link
  inside a notice takes that notice's own `-ink` rather than the app's green, and
  that ตั้งโดย is quieter than the version it hangs under. Before them, six in
  `test/monthSearch.test.js` pinning ตรวจสอบรายเดือน's own
  copy of that box: that it is the same combobox and not a third grammar and
  that `.acct-menu` is gone from every rule, what a suggestion holds — including
  that its figure comes from `capFigure` while the row's ceiling cell prints
  `capPair` — the same `row.cap`, and the dash only in the column
  — that picking somebody calls `setOpened` and never `setFind` or `setQuery`,
  that the scroll and the flash wait for `data` and for all three sub-screens to
  clear, that the flash is painted on the `<tr>` there and fades to `--card` on
  the phone card, and that both screens read the same `FIND_DEBOUNCE_MS` with
  their hooks above every early return. Before them, four in the same file
  pinning ส่งบัญชี's suggestion
  list: that it is the app's own `.pick-menu` and the same five keys rather than
  a second combobox, what a row holds, that `goToRow()` never touches `find` or
  `query` — asserted as a negative — and that the flash is painted on the cells
  and survives `prefers-reduced-motion`. Before them, five in the same file for
  the live half of that box: the debounce's two strings and the early return
  that makes ✕ act
  at once, that the rows, the count, the empty state and the highlight all read
  the same `query`, that the hooks sit above the print early-return, and three
  PURE cases over `highlightParts` — a code matched without its hyphen marks the
  hyphen, a Thai name matched without its space marks the space, a mark never
  lands between a letter and the vowel written on it, and the pieces rejoin to
  the original string exactly. Before them, four in the same file pinning
  ค้นหาชื่อ หรือ รหัสพนักงาน itself: that it asks the roster's rule, that the
  spread narrows `rows` and carries `totals` and `departments` through
  untouched, that no query reaches a total, the CSV href or `AccountingPrint`,
  that the screen names all three totals while narrowing, and that รวมทุกบริษัท
  is the first
  card and gets `data` rather than the filtered list. Before them, the six in
  `test/hrMonthCards.test.js` that pin
  แถบแจ้งเตือนของเดือน — that the card holds exactly **one** `.alert` and the
  list opens inside it, what an item is made of, that its wording is the
  notice's own module's and not a copy, one toggle and one ✕ with no `<details>`
  anywhere inside, the position, and the ✕ that outlives a remount but not a
  reload. They replaced five from earlier the same day that pinned the version
  where the panels opened *under* the strip — which is the bug they now guard
  against. No new file at any point, so the 101 did not move.
  Before them was `test/scriptEncoding.test.js`, which holds the two 🔴 rules in
  §Setup about how a PowerShell script Task Scheduler runs has to be encoded —
  the file that is the whole of the 101st. The three before that are the cases
  in the same `test/hrMonthCards.test.js` that pin what ตรวจสอบรายเดือน says
  under its total card on a phone.
  The earlier count was cross-checked three ways that agreed exactly: the runner's own
  total, the sum of running each file separately, and a count of the ✔ lines.
  Worth doing once because a bare total is a figure nobody can reproduce, and
  because three files register cases from lists rather than one `test()` each
  (`birthdayOnPaper`, `overlap`, `rejectedNeverCounted`), so grepping for
  `test(` undercounts. It read "four files … (`birthdayOnPaper`, `overlap`,
  periodLockRoutes, `rejectedNeverCounted`), so grepping for `test(`
  undercounts by 33" until 2026-08-31, when periodLockRoutes went with ปิดงวด. The suite covers all five worked
  examples from §4, the OPEN 1–5, 9 and 12 policy variants, company inference
  from the code, `editPermission()` over every role × status pair
  (`test/editPermission.test.js`), proxy filing and delegation
  (`test/proxyFiling.test.js`, `test/delegation.test.js`), and the two
  conservation rules: that no rate
  bucket is lost between the engine's three columns and the paper's two
  (`test/reportColumns.test.js`), and that no person's hours are lost between
  the entry collection and the printed roster
  (`test/accountingReconciliation.test.js`).
- Every server module imports cleanly — but that is only ever observed as a
  side effect of `next build` below, never as a check of its own. **Do not go
  looking for one by importing the tree in bare `node`.** The `@/` aliases do
  not resolve outside Next, so every route reports a false failure.
  ✅ The second half of this warning is now retired: **all eight entry-point
  scripts under `src/` guard their entry point**, so importing one is a read of
  the file and nothing else. `src/seed.js` was fixed 2026-08-24 and the three
  `src/migrate-*.js` plus `src/whatif.js` on 2026-08-25 —
  `test/seedEntryPoint.test.js` holds the list, checks it behaviourally, and
  fails if `package.json` learns to start a `src/` file that is not on it.
- `npm run build` — **passes 2026-09-04**, Next 16.3 under Turbopack, and the
  route table it prints is **55 `/api/*` routes** plus `/`, `/_not-found` and
  `/icon.png`. Compared against the 55 `app/api/**/route.js` files on disk, in
  both directions: nothing on disk went unbuilt and nothing was built that has
  no file. This line read "passes 2026-09-03 … 54 routes" until `/api/scans` and
  `/api/scans/import` arrived with the fingerprint-scanner import, and
  "passes 2026-09-03 … 53 routes" until `/api/print/pdf`
  was added the same day, and "passes 2026-08-31 … 57 routes" until the four birthday
  routes were withdrawn with ฝ่ายบุคคล's birthday work, and "passes 2026-08-25 …
  59 routes" until the withdrawal of ปิดงวด took `close` and `reopen` off the
  tree, and "passes 2026-08-24 … 54 routes" before that, and "succeeds —
  2026-08-14, all 50 routes" before that.
  The 2026-08-24 record had gone five routes out of date within a day, which is
  the argument for the count being here at all rather than in somebody's memory.
  **The run was made while :3000 kept serving**, against a scratch
  `VERIFY_DIST_DIR`, and that is the only way to do it: `next start` holds the
  `BUILD_ID` it booted with, so a plain rebuild under it makes every loaded
  page ask for chunks that no longer exist and every screen 500s until a
  restart. `next.config.js` is already wired for the scratch directory; delete
  it afterwards, because it is not in `.gitignore`.
  The run cleared everything since `38353a8` — the eight commits of 2026-08-20
  and 2026-08-21 were cleared by the 2026-08-24 pass before it.
  **A green test suite is still not a working build**, which is why this line
  exists at all: `next build` resolves imports that `node --test` never
  touches, and that is how a re-export bug once let `GET /api/entries` answer
  500 in the built app with all tests passing.
  ⚠ It emits **one warning**, and this line read "two warnings" until
  2026-08-25. Both came from `lib/backupStatusQuery.js`, and Turbopack said the
  same thing about each — *"Dynamic filesystem access causes tracing of the
  whole project"*. **The second was a no-op and is gone**: `backupStatus` asked
  for the root of `resolve(process.cwd())`, where `process.cwd()` is already
  absolute and already normalised. Dropping the wrapper changes no value on any
  input and removes a warning.

  **The first one stays, deliberately, and the file says why at length.**
  `backupDestination()` builds a path out of `BACKUP_DIR`, so the path really
  can be anything and the warning is accurate about it. Three ways to silence
  it were tried and measured on 2026-08-25. Hoisting the read into a
  module-level `const` does not move it at all — the warning is about the
  expression, not about when it runs — and would cost a restart to re-read the
  setting, in exchange for nothing. Swapping `resolve` for `join` moves the
  warning onto the `join`. Swapping it for a template string plus `normalize`
  does reach zero, and is wrong: `resolve` and `normalize` disagree on Windows
  about a POSIX-shaped setting. `BACKUP_DIR=/ot-backups` comes back from
  `resolve` on the current drive and from `normalize` with no drive at all, and
  its `parse().root` is then a bare separator rather than the drive — which is
  exactly what `offsiteVerdict` compares against the application's root. The
  banner would announce that the backups are on another disk when they are on
  the same one. They also disagree on drive-relative paths and on a trailing
  separator, which is printed on the screen.

  The traced-output cost the warning names is nothing here, where `next start`
  serves out of the repository it was built in and every source file is on the
  disk already. **One warning is the expected count; a second is new.**
- `scripts/start-server.ps1` — **both paths walked by hand 2026-08-25**, with
  `powershell.exe` 5.1 rather than `pwsh`, because 5.1 is what Task Scheduler
  runs. Against the live :3000 it reported the port already held and exited
  **0**; started on :3001 it served a real page, wrote `logs/server.log` and a
  `starting:` line to `logs/task.log`, and when that server was force-killed it
  logged the exit and returned **1** — the failure signal the task's restart
  setting reads. The file is pure ASCII and is checked to stay that way, so it
  cannot repeat the BOM failure that once made `scripts/backup.ps1` exit 1
  before its first log line.
  ⚠ **The scheduled task itself is a separate step and this line does not claim
  it is registered.** The command is in
  [ให้แอปขึ้นเองทุกครั้งที่ล็อกอิน](#ให้แอปขึ้นเองทุกครั้งที่ล็อกอิน--task-scheduler),
  along with the three checks that prove it — logon, kill, reboot — and none of
  the three is verified here. `Get-ScheduledTask` has now been read three times
  — 2026-08-20, 2026-08-25 and **2026-08-27** — and the only OT job on the box is
  `OT backup`. The server on :3000 is still a process started by hand, which is
  exactly the state the task exists to end.
  ⚠ **And on 2026-08-27 that hand-started process was `next dev`**, not the
  built app — serving the working tree straight from source, so uncommitted
  edits were live to HR and `.next\BUILD_ID` was two days stale while the site
  looked current. The way back is `deploy-ot.ps1`, and the way to TELL is the
  parent process's command line or the shape of the chunk names, both written
  down in the same section. `start-server.ps1` logs the mode now: its
  port-busy line names the parent, because the pid on the port is the same
  `start-server.js` worker in either mode and names neither.
- `npm audit --omit=dev` — **1 high**, read 2026-08-24. `nanoid@3.3.17` wants
  `<3.3.18`, reached through `next@16.3.0 → postcss@8.5.23`; a fix is
  available. This line read "0 vulnerabilities" until then. Nothing under
  `app/`, `lib/`, `src/`, `components/` or `test/` calls `nanoid`, and the
  advisory is about a custom generator invoked with `size` 0 looping — so it
  is not an opening anybody can reach through this application. It is also not
  nought, which is why the count is printed here instead of the reassurance.
- Against a live MongoDB, one entry walked end to end: submit → manager
  approve → HR approve → **HR correct** → printed form. Checked on the way
  through that a correction with no reason is refused (400), that the
  corrected entry keeps `approved` while its hours change, that the history
  reads `submit>approve_mgr>approve_hr>hr_edit`, that the employee still
  cannot edit an approved entry (409), that a cancelled entry refuses
  correction (409), and that `/reports/form` reads back the new times. The
  throwaway entries were deleted afterwards.
- Against the same live MongoDB, สรุป OT ส่งบัญชี end to end:
  `/api/reports/accounting/:period` and `/api/exports/accounting.csv` with and
  without `includeZero`, filtered to one company and to all, checked that the
  hours match ตรวจสอบรายเดือน for the same month, that pending entries are
  reported but not counted, that the CSV comes back with the UTF-8 BOM
  (`EF BB BF`) and its subtotal lines agree with the screen, that a malformed
  period and an unknown company key are both 400, and that an employee, a
  manager and an anonymous caller get 403/403/401. The database used had
  `company` unset on every row — the code-prefix fallback partitioned it
  correctly. **The printed sheet has still never been sent to a printer** — the
  column widths (22 + 70 + 24 + 24mm over the 194mm the `@page` margins leave)
  and the ~38 rows a first page holds are measured on paper, not observed. The
  screens themselves are no longer in that state: they have been worked in a
  browser since, and several were changed because of what that showed.
- Against a live MongoDB, 2026-08-14, **the login delay** (`lib/loginThrottle.js`):
  five wrong passwords cost nothing and the fifth adds the "ติดต่อฝ่ายบุคคล"
  line, the sixth waits 1 s and the seventh 2 s, a correct password pays the
  delay it had earned and then clears the count, and the failure after it is
  fast again. No account was locked at any point, which is the whole rule.
- ~~Against a live MongoDB, 2026-08-14, **ปิดงวด** end to end: closing a month
  with three requests still pending is refused and the refusal names the three;
  closing an empty month succeeds; filing into the closed month comes back 409
  naming the month in Thai; ฝ่ายบุคคล reopening it is 403 and an administrator
  without a reason is 400; with a reason it opens, filing works again, and
  `events` holds both the close and the reopen in order with the reason on the
  second.~~ **The feature this walked was withdrawn on 2026-08-31** — see
  `lib/periodStatus.js`. Kept struck through rather than deleted because the walk
  is the evidence that ปิดงวด worked: it was removed because HR did not want it,
  not because it was broken.
- Against a live MongoDB, 2026-08-14, **สำรองและกู้คืน** proved as a round trip
  rather than as an exit code (`82981ca`): the dump and the restored database
  compared byte for byte; indexes carried in the manifest and rebuilt after the
  insert, because a database restored without the unique index on
  `Employee.code` would accept a second PM-0620 that same afternoon; and
  `restore` parses every file and checks the fingerprint before it drops the
  first collection, so a truncated or edited backup is found while the real
  database is still whole. `mongodump` is not installed on the machine this
  runs on — both scripts read and write through the driver.
- Against a live MongoDB, 2026-08-18, the `{ period, status }` index
  (`ad538c7`): it built with no error and survived a backup/restore round trip.
- Against a live MongoDB **and against the built app**, 2026-08-19
  (`2f17483`): กรอบเวลาการยื่นใบ OT, the password-reveal button, and the line
  naming who a request is waiting on — walked end to end on a throwaway
  database and on the real one. This is the only walk in this list exercised
  through `next start` rather than `next dev`, which is the distinction the
  build note above is about.
- The mobile approval bar, 2026-08-19 (`8e2b71c`, `a43fedd`, `9eba37e`):
  checked against the CSS the server actually served, not against the source. A
  rule can be present in `.next` and still lose — grepping the bundle proves it
  exists, not that it wins.

**A build is not a walk.** The eight commits of 2026-08-20 and 2026-08-21 were
built for the first time on 2026-08-24 and the build is clean, so they compile
and their imports resolve. None of them has been walked against a live
database. Four are screen only; the other four reach `app/api`, `lib/` or
`src/`, and one of those is `0dac634 Birthday holiday OT calculation logic
fix`, which is arithmetic. What that commit actually changes is the birthday
queue's floor, not the engine — `src/lib/otEngine.js` is untouched by it — and
its four edge cases (a missing date in `dayTypes`, an overnight session
straddling a birthday, 29 February in a common year, a birthday landing on a
Saturday or a company holiday) are covered by `test/otBirthday.test.js` and
“test/birthdayCheck.test.js” (ลบแล้ว 2026-09-03), checked 2026-08-24.

**Not yet verified**

~~The employee's own edit of a `pending_mgr` entry has not been walked against a
live database.~~ **Walked 2026-08-14** — and it is where the description cap
turned out to refuse edits to every entry written before the cap existed, for
the length of a field the editor had not touched. Fixed the same day
(`descriptionUnchanged` in lib/entries.js, `test/descriptionEdit.test.js`); the
recompute, the cap re-check with `excludeId` and the history stamp behind that
write all hold.

~~Proxy filing and delegation have not been walked against a live database at
all.~~ **Both were walked on 2026-08-14 and both hold.** A หัวหน้า filing for a
team member produced an entry carrying the TARGET's department and the TARGET's
cap snapshot (40 / 12, used 0 — not the filer's), `filedBy` the manager,
`submit_proxy` in the history and `pending_hr` as the opening status; the
employee saw it in their own list, a colleague in the same department did not,
and ฝ่ายบุคคล confirmed it. A delegation set from one หัวหน้า to another
returned exactly the covered team's rows under `scope=delegated` and nothing
else; approving as the stand-in recorded `approve_mgr` by the stand-in with
`onBehalfOf` the queue's owner, which is what prints as **ทำแทน**; and with the
window moved into the past the covered queue emptied, `holding` went to zero,
and approving that team's request came back 403. The throwaway entries and the
delegation were deleted afterwards.

That walk is also what found the description bug below.

The **F-HR-027 note block has never been printed.** `proxyNoteOnForm` ships
`false`, so nothing about the sheet changes until somebody turns it on — but the
block's height against the 297 mm page is measured by eye and by nothing else,
exactly like the column widths above. Print a sample month before showing it to
HR.

**Which paths have and have not met a real database is now answered by
evidence rather than by memory — see [docs/features.md](docs/features.md)**,
read out of the tree and out of the live collections on 2026-08-25. It supersedes
the sentence that stood here, which said the CSV exports, the CSV imports and the
holiday and roster screens were all unexercised: the roster import ran
2026-08-18, the holiday import 2026-08-17, and four of the six CSV exports are in
`otAccessLogs`. What that document does confirm is a shorter and sharper list —
ปิดงวด (`otPeriodLocks` was empty — it stayed empty until the feature was
withdrawn on 2026-08-31, and no month was ever closed on this database),
rejection (no entry had ever been
`rejected`), ขอถอนใบ, the admin override, the birthday queue's two write
actions, cap-override, `npm run reset-admin` and `settings/recompute` had none
of them ever run against real data. The arithmetic underneath them is covered by
the test suite, which does not touch Mongo at all — which is exactly why a green
suite said nothing about that list.

**All eight were walked on 2026-08-25, and all eight hold.** Against a clone of
the live database — `npm run backup` of `primus_ot` restored into
`primus_ot_walk`, so real documents with real field shapes, which is what a
seeded scratch database cannot reproduce and what the `Holiday.year` bug hid
behind. Driven over HTTP through `next dev` on :3002 with a scratch
`VERIFY_DIST_DIR`, so :3000 kept serving out of `.next` untouched; every
assertion read back out of Mongo rather than off the response; and the database
restored from the snapshot and diffed document by document after each one — it
came back identical to the snapshot all eight times, so none of it is still in
the data.

What each one showed, briefly. **ปิดงวด** — the feature has since been withdrawn
(2026-08-31, `lib/periodStatus.js`); what the walk showed was that it worked: it
refused to close สิงหาคม over its four pending rows and named them, closed
กรกฎาคม, answered a request filed into it with 409, refused ฝ่ายบุคคล's reopen and
an administrator's reason-less one, and left `events` reading close-then-reopen
with the reason on the second only. **The four pending rows it named are the
sentence the replacement card now prints** — สรุปสถานะงวด says "งวด สิงหาคม 2569
— มีใบรออนุมัติค้างอยู่ 4 ใบ" and stops there, which is the whole of what HR
wanted from the check. **Rejection** produced the first `rejected` entry the database has held, at both
stages — `reject_mgr`, and `reject_hr` through `hrMayReject` — and ส่งใหม่ spent
its one chance: the refused row stayed exactly where it was, the replacement
carried `refiledFrom`, and both a second claim on the same parent and a claim on
the replacement were refused in their own words. **ขอถอนใบ** left the entry
`approved` while the request was open, ended at `cancelled` when granted and
moved nothing at all when refused, with the asking half of the record never
overwritten by the answer. **The admin override** wrote
`managerDecision.adminOverride: true` with `onBehalfOf` and `delegationId`
absent rather than null, and the same administrator was then refused the
ฝ่ายบุคคล step of that same entry. **The birthday queue's two writes** produced
an entry `approved` in one step with no `managerDecision` on it at all, and a
check that took a row off the list and a retraction that put it back — two rows
in “otBirthdayChecks”, the first one untouched. **cap-override** cleared
`capExceeded` while `capSnapshot.breaches` kept the record of what had been
breached. **`npm run reset-admin`** was refused three ways, then issued a
password that logged in over HTTP with `mustChangePassword` set, leaving an
`otEmployeeAudits` row with `source: 'script'` and no actor — because there was
none. **`settings/recompute`** is the paragraph below.

One thing the walk had to work around, worth knowing before repeating it: ADM is
`otMode: 'none'`, so the entry for the override walk could not be an ordinary
weekday. It was filed on วันเฉลิมพระชนมพรรษา 12 สิงหาคม — a department that does
no ordinary OT still takes holiday hours, and on this roster that is the only way
to get a genuinely unsignable row into the queue.

**`settings/recompute` reaches every month, and the paragraph that stood here is
worth keeping in full because of how it got things wrong twice.**

It first read that a replay was the eighth way into a closed month, left open on
purpose on 2026-08-14 because HR had not been asked. That was true when it was
written at 08:13 that morning and false by 08:38, when `2c1f3ae` closed it — the
same commit edited this file and did not edit this paragraph, and the false
sentence stood for eleven days and went into a work plan as a thing to build. It
was then rewritten to say the opposite: "a replay SKIPS every closed month,
whatever is asked for", verified against a live database on 2026-08-25 —
`includeApproved: true` from an administrator with an explicit `period` answered
`updated: 0`, the entry's `updatedAt` and `__v` unmoved, and reopening กรกฎาคม
and running the same call again replayed it. Both records are true of their day
and neither describes the code now.

**What it does today.** ปิดงวด was withdrawn on 2026-08-31 — see
`lib/periodStatus.js` — so there is no closed month to skip, no `closedPeriods`
list, and no `'period_closed'` skip reason. `planRecompute` in
lib/policyVersion.js has ONE rule left and it is the approved one: an entry
somebody has signed is not replayed unless the caller passes `includeApproved`,
which `authorizeReplay` allows only to an administrator and only with a `note`.
That check is now the whole of what stands between a signed-off figure and a
restatement.

`test/policyVersion.test.js` and `test/birthDateReplay.test.js` hold the rule.
`test/periodStatus.test.js` holds the removal — it reads the whole tree and fails
if anything imports the lock model, calls `refusePeriodLock`, or leaves a
`close`/`reopen` endpoint on disk. That test exists because a half-removal is
worse than either state: a route still refusing a month nothing can close is a
refusal nobody can lift.

Install MongoDB, then `npm run seed && npm run dev` and walk one entry through
submit → manager → HR → export before treating the API as working. The seed
includes three Themtech people and two of their entries, so the demo database
has OT against both payrolls.
