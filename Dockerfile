# syntax=docker/dockerfile:1

# ระบบขออนุมัติทำงานล่วงเวลา — Primus Instrument · อิมเมจสำหรับรันจริง
#
# ฐานข้อมูลไม่ได้อยู่ในอิมเมจนี้ และนั่นคือทั้งหมดของการออกแบบไฟล์นี้
#
# THE DATABASE STAYS ON THE HOST AND THE CONTAINER SHARES THE HOST'S NETWORK.
# `mongod` on this machine listens on 127.0.0.1:27017 and nowhere else (read
# with `ss -ltnp` on 2026-09-09), and its URI carries no username or password —
# loopback IS the authentication. Reaching it from a bridge network would mean
# re-binding mongod to the docker0 interface, i.e. opening an unauthenticated
# database to every container on the box, to gain nothing. So the container runs
# with `network_mode: host` (see docker-compose.yml) and MONGODB_URI keeps
# saying 127.0.0.1 exactly as it does outside a container. Nothing about
# .env changes when the app moves in here — which is the point.
#
# THE PORT IS NOT SETTABLE FROM THE ENVIRONMENT, IN A CONTAINER OR OUT OF ONE.
# package.json's `start` is `next start -p 3000`, and `-p` beats $PORT — so the
# `PORT=3000` line in .env has been inert since it was written. With host
# networking there is also nothing to remap: the app is on the host's :3000
# directly, and `ports:` in compose is ignored. To move the app to another port,
# change the flag in package.json; setting PORT will not do it.
#
# A BUILD IN HERE DOES NOT TAKE THE RUNNING APP DOWN. That is the failure
# AGENTS.md warns about: `next start` holds the BUILD_ID it booted with, so
# rebuilding `.next` underneath it makes every loaded page ask for chunks that
# no longer exist. Here the build happens inside the image while the old
# container keeps serving its own `.next`, and `docker compose up -d` swaps them
# in one step. The VERIFY_DIST_DIR scratch-build dance is still what a build on
# the Windows laptop needs; it is not needed for this path, and VERIFY_DIST_DIR
# must never be set in the image — `next start` would then look for a distDir
# that was never built.


# ── deps · ต้นไม้ node_modules เต็ม สำหรับใช้ build ────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund


# ── prod-deps · ต้นไม้ที่ไม่มี devDependencies สำหรับเอาไปวางในอิมเมจจริง ──────
#
# วันนี้สองสเตจนี้ให้ผลเหมือนกันเป๊ะ เพราะ package.json ไม่มี devDependencies
# สักตัว — แยกไว้เพื่อให้วันที่มีคนเพิ่ม eslint หรือ typescript เข้ามา อิมเมจ
# ไม่โตขึ้นเงียบ ๆ และ build ไม่พังเพราะเครื่องมือหาย
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund


# ── build · next build ────────────────────────────────────────────────────────
#
# ไม่ต้องมี .env ตอนนี้ และไม่ควรมี: `registerInstrumentation()` ของ Next คืนค่า
# ทันทีเมื่อ NEXT_PHASE เป็น 'phase-production-build' ด่านที่ instrumentation-node.js
# ตั้งไว้จึงไม่ทำงานตอน build — มันกันเฉพาะตอน "start" ซึ่งเป็นนาทีเดียวที่ค่าพวกนั้นสำคัญ
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build


# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# TZ คือเขตเวลาของ "process" ส่วน OT_TIMEZONE คือเขตเวลาที่ระบบใช้ "ตัดสินว่าวันไหน"
# — ตั้งทั้งคู่ ตัวหลังมีค่าเริ่มต้นเป็น Asia/Bangkok ใน lib/today.js อยู่แล้ว แต่
# .env.example เขียนไว้ตรง ๆ ว่าบนเซิร์ฟเวอร์ให้ตั้งให้เห็นด้วยตา เพราะ base image
# เป็น UTC และนั่นคือบรรทัดเดียวที่กันกะเลิก 00:30 ไม่ให้ไปนับเป็นวันถัดไป
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Asia/Bangkok \
    OT_TIMEZONE=Asia/Bangkok

# ── สิ่งที่ปุ่ม บันทึกเป็น PDF ต้องใช้ · เพิ่ม 2026-09-09 ────────────────────
#
# `/api/print/pdf` ไม่ได้เรนเดอร์ PDF เอง — มัน spawn เบราว์เซอร์ headless แล้วสั่ง
# `--print-to-pdf` (lib/pdfExport.js) ซึ่งบนแล็ปท็อปคือ Edge ที่ติดมากับ Windows
# อยู่แล้ว base image นี้ไม่มีเบราว์เซอร์สักตัว `findBrowser()` จึงคืน null และ
# ปุ่มนั้นตอบ "ไม่พบเบราว์เซอร์สำหรับสร้างไฟล์ PDF บนเครื่องนี้" ทุกครั้ง
#
# ไม่ต้องตั้ง `PDF_BROWSER` — `/usr/bin/chromium` อยู่ในรายการที่ `browserCandidates()`
# ไล่หาบน POSIX อยู่แล้ว ตัวแปรนั้นมีไว้สำหรับเครื่องที่เก็บเบราว์เซอร์ไว้ที่อื่น
#
# ⚠ ฟอนต์ไม่ได้ใส่ไว้เผื่อสวยงาม แต่เผื่อ "เน็ตล่ม" — เอกสารที่ส่งให้เบราว์เซอร์
# `<link>` ฟอนต์ IBM Plex Sans Thai Looped จาก Google Fonts และมี CSP ที่ยอมให้
# โหลดได้เฉพาะจากที่นั่น วันที่ออกอินเทอร์เน็ตไม่ได้ ตัวอักษรจะตกไปที่ `sans-serif`
# ของเครื่อง ซึ่งใน base image เปล่า ๆ ไม่มีตัวไหนวาดภาษาไทยได้เลย — ใบ F-HR-027
# จะออกมาเป็นกล่องสี่เหลี่ยมทั้งใบ แทนที่จะเป็นใบที่หน้าตาต่างไปนิดหน่อย
# `fonts-thai-tlwg` คือตัวที่ทำให้ fontconfig มีคำตอบสำหรับภาษาไทย และ
# `fonts-liberation` คือชุดละตินที่ Chrome คาดว่าจะเจอ (ปกติมาทาง Recommends
# ซึ่ง --no-install-recommends ตัดทิ้ง)
#
# ⚠ ราคาคืออิมเมจโตขึ้นมาก — chromium พร้อม dependency กินหลายร้อย MB
#   ตัวเลขล่าสุดบันทึกไว้ที่ docs/docker.md §เรื่องที่ยังไม่แก้
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-thai-tlwg fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --chown=node:node public ./public
COPY --chown=node:node package.json next.config.js jsconfig.json ./
COPY --chown=node:node instrumentation.js instrumentation-node.js ./

# สองไฟล์นี้ถูกอ่านตอนรันไทม์ ไม่ใช่ตอน build — `sheetStyles()` ใน lib/pdfExport.js
# อ่าน `app/styles.css` กับ `app/print.css` จาก `process.cwd()` แล้วฝังลงในเอกสาร
# ที่ส่งให้เบราว์เซอร์ เพราะการ `import` ไฟล์ .css ใน route handler จะได้ URL ของ
# chunk ที่มีแฮช ซึ่งเป็นสิ่งเดียวที่หน้า `file://` โหลดไม่ได้
#
# เอามาแค่สองไฟล์ ไม่ใช่ทั้ง `app/` — ที่เหลือในนั้นเป็น route กับ layout ซึ่ง
# `next start` ไม่ได้อ่านจากซอร์ส มันอ่านจาก `.next` ที่ build ไว้แล้ว
# ถ้าวันหนึ่ง `sheetStyles()` อ่านไฟล์ที่สาม บรรทัดนี้ต้องตามไปด้วย และอาการคือ
# throw พร้อมบอก path ที่หาไม่เจอ ไม่ใช่ PDF ที่ไม่มีสไตล์
COPY --chown=node:node app/styles.css app/print.css ./app/

# src/ กับ lib/ ไม่ได้ถูกใช้ตอนเสิร์ฟ — .next มีทุกอย่างที่ next start ต้องใช้แล้ว
# ที่ใส่มาเพราะสคริปต์ดูแลระบบทั้งชุดอยู่ในนั้น และมันต้องรันได้จากในคอนเทนเนอร์:
#
#   docker compose exec app npm run backup -- --out /backups
#   docker compose exec app npm run reset-admin -- ADMIN
#   docker compose exec app npm run whatif -- --show
#
# สคริปต์พวกนี้ import กันเองด้วย path แบบสัมพัทธ์ ไม่ได้ใช้ alias `@/` ของ Next
# จึงรันด้วย node เปล่า ๆ ได้โดยไม่ต้องผ่าน build
COPY --chown=node:node src ./src
COPY --chown=node:node lib ./lib

# โฟลเดอร์ปลายทางของ `npm run backup` — สร้างโดยมีเจ้าของเป็น node ตั้งแต่แรก
# เพราะกระบวนการเขียนไฟล์ในนี้ไม่ได้เป็น root แล้ว
RUN mkdir -p /backups && chown node:node /backups

USER node

# ประกาศไว้ให้คนอ่าน — ภายใต้ network_mode: host docker ไม่ได้ทำอะไรกับบรรทัดนี้เลย
EXPOSE 3000

# /api/health เป็น endpoint เดียวที่ไม่ต้องล็อกอิน และมันปิง MongoDB จริง ๆ ไม่ใช่
# แค่ตอบว่าเว็บเซิร์ฟเวอร์ยังอยู่ — 503 เมื่อฐานข้อมูลเงียบ ซึ่งพอดีกับสิ่งที่
# restart: unless-stopped ควรเห็น ใช้ fetch ของ node เพราะ base image ไม่มี curl
HEALTHCHECK --interval=60s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
