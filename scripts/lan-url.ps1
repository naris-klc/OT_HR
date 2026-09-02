<#
.SYNOPSIS
    บอกที่อยู่ที่พนักงานใช้เข้าระบบ OT ตอนนี้ และตรวจว่ากฎไฟร์วอลล์ยังตรงกับวงเน็ตจริง

.DESCRIPTION
    ที่อยู่ของเครื่องนี้มาจาก DHCP จึงเปลี่ยนเองได้โดยไม่มีใครแตะอะไร และเคยเปลี่ยนมาแล้ว
    หนึ่งครั้ง — 192.168.109.119 กลายเป็น .76 ระหว่าง 2026-08-18 ถึง 2026-09-01
    ระหว่างนั้นบุ๊กมาร์กของทุกคนเข้าไม่ได้ โดยหน้าจอขึ้นแค่ "เชื่อมต่อไม่ได้"

    สคริปต์นี้จึงมีไว้แทนการเชื่อตัวเลขในเอกสาร ให้อ่านจากเครื่องทุกครั้ง

    และมันตรวจของที่พังเงียบอีกอย่างหนึ่ง: กฎไฟร์วอลล์ของพอร์ต 3000 ถูกจำกัดไว้ที่
    ซับเน็ตเดียว ถ้าเครื่องย้ายไปวงอื่น (เราเตอร์ใหม่ ห้องประชุมคนละวง มือถือปล่อย
    hotspot) มือถือจะเข้าไม่ได้ทั้งที่แอปยังรันอยู่ดี ๆ และไม่มีข้อความอะไรบอกเลย
    หมุนค้างแล้ว timeout ซึ่งอ่านได้ว่า "ระบบล่ม"

.PARAMETER Fix
    แก้ -RemoteAddress ของกฎไฟร์วอลล์ให้เป็นซับเน็ตปัจจุบัน ต้องรัน PowerShell
    แบบ Run as administrator ไม่ใส่ = อ่านอย่างเดียว ไม่แก้อะไร

.PARAMETER Port
    พอร์ตที่แอปเสิร์ฟอยู่ ปกติ 3000

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\lan-url.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\lan-url.ps1 -Fix
#>
[CmdletBinding()]
param(
    [switch] $Fix,
    [int] $Port = 3000
)

$ErrorActionPreference = 'Continue'
$RuleName = 'OT system (Next.js) 3000'

function Write-Head([string] $text) {
    Write-Host ''
    Write-Host $text -ForegroundColor Cyan
    Write-Host ('-' * 68) -ForegroundColor DarkGray
}

# ── ที่อยู่ของเครื่องบนวง ────────────────────────────────────────────────────
# เอาการ์ดที่ทาง default route ออกไป ไม่ใช่ใบแรกที่เจอ เพราะเครื่องนี้มีทั้ง Wi-Fi
# และ Ethernet และใบที่ไม่ได้เสียบสายก็ยังมี IP ค้างอยู่ได้
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric | Select-Object -First 1

$addr = $null
if ($route) {
    $addr = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1
}
if (-not $addr) {
    $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1
}

if (-not $addr) {
    Write-Host ''
    Write-Host 'ไม่พบที่อยู่ IPv4 บนเครื่องนี้เลย — เครื่องยังไม่ได้ต่อเน็ตใช่ไหม' -ForegroundColor Red
    exit 1
}

$ip     = $addr.IPAddress
$prefix = $addr.PrefixLength
$octets = $ip.Split('.')
$subnet = "$($octets[0]).$($octets[1]).$($octets[2]).0/$prefix"
$url    = "http://${ip}:${Port}"

Write-Head 'ที่อยู่ที่พนักงานใช้เข้าระบบ'
Write-Host "    $url" -ForegroundColor Green
Write-Host ''
Write-Host "    การ์ด    : $($addr.InterfaceAlias)"
Write-Host "    ที่มา IP : $($addr.PrefixOrigin)/$($addr.SuffixOrigin)"
Write-Host "    ซับเน็ต  : $subnet"

if ("$($addr.PrefixOrigin)" -eq 'Dhcp') {
    Write-Host ''
    Write-Host '    หมายเหตุ: IP นี้มาจาก DHCP จึงเปลี่ยนเองได้ทุกเมื่อ' -ForegroundColor Yellow
    Write-Host '    ทางแก้ถาวรคือ DHCP Reservation ที่เราเตอร์ — ดู docs/network.md' -ForegroundColor Yellow
}

# ── แอปยังรันอยู่ไหม ─────────────────────────────────────────────────────────
Write-Head 'แอปยังรันอยู่ไหม'
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Write-Host "    ไม่มีอะไรเปิดพอร์ต $Port อยู่เลย — แอปไม่ได้รัน" -ForegroundColor Red
    Write-Host '    เปิดด้วย: powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\suwan\deploy-ot.ps1'
} else {
    # โหมดอ่านจากโปรเซสแม่ ไม่ใช่จาก pid บนพอร์ต — next dev กับ next start ใช้
    # worker ตัวเดียวกัน pid จึงบอกไม่ได้ว่าอันไหน ดู README หัวข้อ Status
    $pidOnPort = ($listening | Select-Object -First 1).OwningProcess
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $pidOnPort" -ErrorAction SilentlyContinue
    $parent = $null
    if ($proc) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.ParentProcessId)" -ErrorAction SilentlyContinue
    }
    $mode = 'ไม่ทราบ'
    $line = ''
    if ($proc) { $line = "$($proc.CommandLine)" }
    if ($parent) { $line = "$line $($parent.CommandLine)" }
    if ($line -match 'next\s+dev|\bdev\b')      { $mode = 'next dev (โหมดพัฒนา — เสิร์ฟไฟล์ที่ยังไม่ commit)' }
    elseif ($line -match 'next\s+start|start-server|deploy') { $mode = 'next start (โหมด production)' }

    Write-Host "    พอร์ต $Port : เปิดอยู่ (pid $pidOnPort)" -ForegroundColor Green
    Write-Host "    โหมด      : $mode"

    try {
        $health = Invoke-WebRequest "http://127.0.0.1:${Port}/api/health" -UseBasicParsing -TimeoutSec 10
        Write-Host "    /api/health : $($health.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "    /api/health : ไม่ตอบ — $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ── ไฟร์วอลล์ยังตรงกับวงจริงไหม ───────────────────────────────────────────────
Write-Head 'กฎไฟร์วอลล์ของพอร์ต 3000'
$rule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if (-not $rule) {
    Write-Host "    ไม่พบกฎชื่อ '$RuleName'" -ForegroundColor Red
    Write-Host '    สร้างใหม่ตามสูตรใน docs/network.md หัวข้อ 3 (ต้องใช้สิทธิ์ผู้ดูแลระบบ)'
    exit 1
}

$filter  = $rule | Get-NetFirewallAddressFilter
$allowed = @($filter.RemoteAddress)
Write-Host "    เปิดให้    : $($allowed -join ', ')"
Write-Host "    เปิดอยู่ไหม : $($rule.Enabled)"

# เทียบแค่สามอ็อกเท็ตแรก เพราะกฎเก็บค่าเป็น 192.168.109.0/255.255.255.0
$myNet = "$($octets[0]).$($octets[1]).$($octets[2])."
$covered = $false
foreach ($a in $allowed) {
    if ($a -eq 'Any' -or $a -like "$myNet*") { $covered = $true }
}

if ($covered) {
    Write-Host ''
    Write-Host '    ตรงกับวงปัจจุบัน — มือถือในวงนี้เข้าได้' -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host '    ไม่ตรงกับวงปัจจุบัน' -ForegroundColor Red
    Write-Host "    เครื่องอยู่วง $subnet แต่กฎเปิดให้แค่ $($allowed -join ', ')"
    Write-Host '    อาการที่จะเจอ: แอปรันอยู่ดี ๆ แต่มือถือหมุนค้างแล้ว timeout ไม่มี error บอก' -ForegroundColor Yellow
    Write-Host ''
    if ($Fix) {
        Write-Host "    กำลังแก้กฎให้เป็น $subnet ..." -ForegroundColor Cyan
        try {
            Set-NetFirewallRule -DisplayName $RuleName -RemoteAddress $subnet -ErrorAction Stop
            $after = (Get-NetFirewallRule -DisplayName $RuleName | Get-NetFirewallAddressFilter).RemoteAddress
            Write-Host "    แก้แล้ว — ตอนนี้เปิดให้ $($after -join ', ')" -ForegroundColor Green
        } catch {
            Write-Host "    แก้ไม่ได้: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host '    ต้องเปิด PowerShell แบบ Run as administrator' -ForegroundColor Yellow
        }
    } else {
        Write-Host '    แก้ด้วยการรันซ้ำโดยเติม -Fix (ต้อง Run as administrator):' -ForegroundColor Yellow
        Write-Host "    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\lan-url.ps1 -Fix"
    }
}

Write-Head 'สรุป'
Write-Host "    ให้พนักงานเปิด  $url" -ForegroundColor Green
Write-Host '    เครื่องที่จะเข้าได้ต้องอยู่ Wi-Fi วงเดียวกันกับเครื่องนี้'
Write-Host ''
