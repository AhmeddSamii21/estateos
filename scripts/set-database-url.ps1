# EstateOS - securely update ONLY the DATABASE_URL line in .env.
# Run this file in your own PowerShell terminal. The password is entered via a
# hidden prompt, URL-encoded, never displayed, and never stored in this script.

$ErrorActionPreference = 'Stop'
$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'

if (-not (Test-Path -LiteralPath $envPath)) {
  throw '.env not found at the project root.'
}

$secure = Read-Host -AsSecureString 'Enter the estateos_app database password'
if ($secure.Length -eq 0) {
  throw 'Password cannot be empty. No changes made.'
}

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $encoded = [Uri]::EscapeDataString($plain)
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  $secure.Dispose()
  $plain = $null
}

$newUrl = 'postgresql://estateos_app:' + $encoded + '@localhost:5432/estateos_db?schema=public'
$redacted = 'postgresql://estateos_app:REDACTED@localhost:5432/estateos_db?schema=public'

$utf8 = New-Object System.Text.UTF8Encoding($false)
$content = [IO.File]::ReadAllText($envPath, $utf8)
$pattern = '(?m)^DATABASE_URL=.*$'
if ([regex]::Matches($content, $pattern).Count -ne 1) {
  throw 'Expected exactly one DATABASE_URL line. No changes made.'
}

$updated = [regex]::Replace(
  $content,
  $pattern,
  [System.Text.RegularExpressions.MatchEvaluator] { param($m) 'DATABASE_URL=' + $newUrl }
)

Write-Host "Intended DATABASE_URL change (redacted): $redacted"
$confirm = Read-Host 'Type YES to write this change to .env (anything else aborts)'
if ($confirm -ne 'YES') {
  Write-Host 'Aborted. No changes made.'
  exit 0
}

[IO.File]::WriteAllText($envPath, $updated, $utf8)
Write-Host 'DATABASE_URL updated successfully. Password was never displayed.'
Write-Host 'Next: node scripts/verify-db.cjs'
