[CmdletBinding()]
param(
    [switch]$Write,
    [switch]$Headed,
    [double]$DelaySeconds = 1.0,
    [int]$MaxProducts = 20
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw 'Python bulunamadı. Python 3.9 veya daha yeni bir sürüm kurun.'
}

if (-not (Test-Path '.venv')) {
    python -m venv .venv
}

& .venv\Scripts\python.exe -m pip install -r requirements-browser.txt
& .venv\Scripts\python.exe -m playwright install chromium

$updaterArgs = @(
    'scripts/update_price_history_browser.py',
    '--delay-seconds', $DelaySeconds,
    '--max-products', $MaxProducts
)
if ($Write) { $updaterArgs += '--write' }
if ($Headed) { $updaterArgs += '--headed' }

& .venv\Scripts\python.exe @updaterArgs
if ($LASTEXITCODE -ne 0) {
    throw "Browser updater başarısız oldu. Çıkış kodu: $LASTEXITCODE"
}
