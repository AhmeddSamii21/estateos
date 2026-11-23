param(
  [Parameter(Mandatory = $true)]
  [string]$Email,
  [string]$FirstName = '',
  [string]$OrganizationSlug = 'estateos'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $scriptDir 'create-admin.cjs'

$secure = Read-Host -Prompt 'Administrator password (hidden)' -AsSecureString
$password = [System.Net.NetworkCredential]::new('', $secure).Password

$nodeArgs = @($nodeScript, '--email', $Email)
if ($FirstName -ne '') { $nodeArgs += @('--firstName', $FirstName) }
if ($OrganizationSlug -ne '') { $nodeArgs += @('--slug', $OrganizationSlug) }

$password | & node @nodeArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
