# ทำไม Postgres ไม่เคยพัง แต่ mongod พังทุกวัน — และวิธีปิดปัญหานี้ถาวร

เขียน 2026-09-10 หลังจาก `npm run dev` แล้ว login ตอบ 500 เป็นครั้งที่สอง
เครื่องที่พูดถึงคือ **แล็ปท็อป Windows** ไม่ใช่เครื่องคอนเทนเนอร์ Linux ใน
[docker.md](docker.md)

> **ทำไปแล้วเมื่อ 2026-09-10** — ไฟล์นี้เคยเป็นแผน ตอนนี้เป็นบันทึกว่าทำอะไรไป
> ผลอยู่ที่ §ผลหลังทำจริง ท้ายไฟล์

## คำตอบสั้น ๆ

Postgres บนเครื่องนี้เป็น **Windows service ที่รันได้จริง** Windows สตาร์ทให้
ตั้งแต่บูต คุณเลยไม่เคยต้องนึกถึงมัน

mongod **ไม่ได้เป็นอย่างนั้น** มันเป็นโปรเซสที่คนต้องพิมพ์คำสั่งเปิดเอง ปิดเครื่อง
เมื่อไหร่ก็หายไป — และ service ของ MongoDB ที่มีอยู่ก็ตั้งค่าผิดจนใช้แทนกันไม่ได้

## หลักฐาน

| | Postgres | MongoDB |
|---|---|---|
| ชื่อ service | `postgresql-x64-18` | `MongoDB` |
| StartType | Automatic | Automatic |
| สถานะจริง | **Running** | **Running** *(อ่านว่า "**Stopped**" จนถึง 2026-09-10)* |

ทั้งคู่ตั้ง Automatic เหมือนกัน แต่ก่อน 2026-09-10 ตัวหนึ่งรัน อีกตัวไม่รัน เพราะ
service ของ MongoDB ต่อให้สตาร์ทขึ้นมาก็ยังผิดอยู่ดี — มันไม่ได้ชี้ไปที่ฐานที่แอปใช้
สามข้อข้างล่างคือสิ่งที่ผิด และคือสิ่งที่แก้ไปแล้ว

## สามอย่างที่ทำให้ service ของ MongoDB ใช้แทนไม่ได้

อ่านจาก `C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg` เทียบกับ `.env`

1. **dbPath คนละที่**
   service ชี้ `C:\Program Files\MongoDB\Server\8.3\data` ซึ่งมีแต่ `mongod.lock`
   ฐานจริงอยู่ที่ `C:\Users\bcozf\mongodb-data` (employees 164, otentries 422,
   departments 18) ถ้าสตาร์ท service ตามที่ตั้งไว้ตอนนี้ จะได้ฐานเปล่า แล้วจะ
   login ไม่ผ่านอยู่ดี — คนละอาการ เดาผิดทางง่ายกว่าเดิม

2. **พอร์ตคนละพอร์ต**
   service ตั้ง `27017` แต่ `.env` ชี้ `mongodb://127.0.0.1:27018/primus_ot`

3. **บัญชีที่ service ใช้ อ่านโฟลเดอร์ฐานไม่ได้**
   service รันเป็น `NT AUTHORITY\NetworkService` ซึ่ง **ไม่มีอยู่ใน ACL** ของ
   `C:\Users\bcozf\mongodb-data` (มีแค่ SYSTEM, Administrators, FAirpLay\bcozf)
   ข้อนี้คือข้อที่จะทำให้ "แก้ config แล้วยังไม่ขึ้น" ถ้าลืม

## เรื่องที่เปลี่ยนไปแล้วและยังไม่มีใครแก้คอมเมนต์

`.env` เขียนว่าเลือก 27018 เพราะ *"พอร์ต 27017 บนเครื่องนี้ถูกโปรเซสของ VS Code
ถือไว้"* — วันนี้ **27017 ว่าง** ไม่มีอะไร listen อยู่

ถึงอย่างนั้นก็ยังควรอยู่ที่ 27018 ต่อไป เพราะเหตุผลเดิมย้อนกลับมาได้ทุกเมื่อ
(extension ของ VS Code เปิดเอง) และการย้ายกลับ 27017 แปลว่าต้องแก้ `.env`
โดยไม่ได้อะไรเพิ่ม

## วิธีแก้ถาวร — ทำให้ mongod เป็น service เหมือน Postgres

ต้องเปิด PowerShell **แบบ Run as administrator** (แก้ไฟล์ใน Program Files และ
สั่ง service) ทำครั้งเดียวจบ

```powershell
# 1. ปิด mongod ตัวที่เปิดค้างด้วยมือก่อน — มันถือ lock ของ dbpath อยู่
#    ถ้าไม่ปิด service จะสตาร์ทไม่ขึ้นเพราะแย่งไฟล์กัน
Get-Process mongod -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. ให้บัญชีของ service อ่าน/เขียนโฟลเดอร์ฐานได้
icacls C:\Users\bcozf\mongodb-data /grant "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)F" /T

# 3. ชี้ config ไปที่ฐานจริงและพอร์ตที่ .env ใช้
$cfg = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg'
Copy-Item $cfg "$cfg.bak" -Force          # เก็บของเดิมไว้ก่อน
(Get-Content $cfg) `
  -replace 'dbPath: .*', 'dbPath: C:\Users\bcozf\mongodb-data' `
  -replace 'port: 27017', 'port: 27018' | Set-Content $cfg -Encoding ascii

# 4. เปิด แล้วดูว่าขึ้นจริง
Start-Service MongoDB
Get-Service MongoDB | Select-Object Name,Status,StartType
```

> **`-Encoding ascii` ไม่ใช่ `utf8`** — PowerShell 5.1 เขียน utf8 พร้อม BOM และ
> BOM หน้าไฟล์ YAML ทำให้ mongod อ่าน config ไม่ออก `mongod.cfg` เป็น ASCII
> ล้วนอยู่แล้ว จึงไม่มีอะไรเสียจากการเขียนกลับเป็น ASCII

ตรวจว่าใช้ได้จริง — สองอย่างนี้ ไม่ใช่แค่ดูว่า service เขียนว่า Running

```powershell
Test-NetConnection 127.0.0.1 -Port 27018 | Select-Object TcpTestSucceeded
```

แล้วเข้า `npm run dev` กด login จริงหนึ่งครั้ง

ถ้า service ไม่ขึ้น ให้ดู `C:\Program Files\MongoDB\Server\8.3\log\mongod.log`
บรรทัดท้าย ๆ — permission กับ dbpath ที่ผิดจะบอกตัวเองในนั้นตรง ๆ

**ผลที่ได้คือสิ่งเดียวกับที่ Postgres ให้คุณอยู่ตอนนี้** เปิดเครื่องมาแล้ว
ฐานข้อมูลอยู่แล้ว ไม่ต้องจำอะไร

## ทางเลือกชั่วคราว ถ้ายังไม่อยากยุ่งกับ service

เปิดเองทุกครั้งก่อน `npm run dev`

```powershell
Start-Process 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe' `
  -ArgumentList '--dbpath','C:/Users/bcozf/mongodb-data','--port','27018','--bind_ip','127.0.0.1' `
  -WindowStyle Hidden
```

นี่คือคำสั่งที่รันให้ไปแล้วสองครั้ง — มันหายทุกครั้งที่รีบูตหรือปิด shell
เป็นการรักษาอาการ ไม่ใช่รักษาโรค

## เส้นที่ไม่ได้ข้าม

`scripts/start-server.ps1` บันทึกไว้ว่าเครื่องนี้ตัดสินใจแล้วเมื่อ 2026-08-27
ว่า**จะไม่ตั้ง scheduled task ให้แอป** เพราะเป็นเครื่อง dev/test และห้ามเสนอซ้ำ

เรื่องในไฟล์นี้เป็นคนละเรื่อง — พูดถึง **ฐานข้อมูล** ไม่ใช่แอป และไม่ใช่
scheduled task แต่เป็น Windows service ที่ติดตั้งมาพร้อม MongoDB อยู่แล้ว
ตั้ง Automatic ไว้แล้ว แค่ตั้งค่าผิด เครื่องนี้ก็รัน Postgres แบบนั้นอยู่แล้วด้วย

## ผลหลังทำจริง

เดินครบห้าขั้นเมื่อ **2026-09-10** ผ่านทั้งหมด ตรวจต่อจากฝั่ง repo ได้ว่า:

| ตรวจ | ผล |
|---|---|
| service `MongoDB` | State `Running` · StartMode `Auto` · รันเป็น `NT AUTHORITY\NetworkService` |
| ใครถือ 27018 | mongod ของ service — อ่าน CommandLine ไม่ได้เพราะเป็นของ NetworkService ส่วนตัวที่คนเปิดเองอ่านได้ นั่นคือวิธีแยกสองแบบออกจากกัน |
| ต่อ `mongodb://127.0.0.1:27018/primus_ot` | employees 164 · otentries 422 · departments 18 · settings 1 |

**ยังไม่ได้พิสูจน์ข้อเดียว: การรอดจากการรีบูต** ที่ยืนยันได้คือ StartMode เป็น
`Auto` และ service สตาร์ทขึ้นจริง ส่วนที่ว่ามันขึ้นเองหลังบูต จะรู้ก็ต่อเมื่อ
รีบูตเครื่องจริงหนึ่งครั้ง

สำรองฐานไว้ก่อนลงมือที่ `backups/primus_ot-20260910-142735` (14 collection
14814 รายการ) และ config เดิมอยู่ที่ `mongod.cfg.bak` ข้าง ๆ ตัวจริง

เศษที่เหลือไว้โดยตั้งใจ: `mongod-dev.log` กับ `mongod-dev.err` ใน
`C:\Users\bcozf\mongodb-data` เป็น log ของ mongod ที่เปิดด้วยมือสองรอบก่อนหน้า
ไม่ใช่ไฟล์ของฐาน ลบทิ้งได้ทุกเมื่อ — service เขียน log ของตัวเองที่
`C:\Program Files\MongoDB\Server\8.3\log\mongod.log`

## ค้างอยู่

คอมเมนต์ใน `.env` ยังบอกว่าเลือก 27018 เพราะ VS Code ถือ 27017 ไว้ ซึ่งไม่จริง
แล้ว และตั้งแต่ 2026-09-10 เหตุผลจริงของ 27018 คือ **service ตั้งไว้แบบนั้น** —
คนละเหตุผลกับที่เขียนอยู่ ใครแก้พอร์ตข้างใดข้างหนึ่งต้องแก้อีกข้างด้วย

README §Setup เขียนว่า `copy .env.example .env` แล้วต่อด้วย `npm run seed`
ทันที ไม่มีบรรทัดไหนบอกว่า **mongod ต้องรันอยู่ก่อน** ถึงจะ seed หรือ login ได้
ช่องว่างนี้คือสาเหตุที่คนอ่านเจอ 500 แล้วเดาว่า "backend ไม่ได้รัน" ทั้งที่
โปรเจกต์นี้ไม่มี backend แยก — ควรเติมหนึ่งบรรทัดที่นั่น
