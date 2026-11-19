# Adds, removes or checks a directory in the user or machine PATH (registry).
# Used by both the NSIS installer (resources/windows/installer.nsh) and shovel's settings dialog.
# Kept ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts in the ANSI code page.
param(
  [Parameter(Mandatory = $true)][ValidateSet('add', 'remove', 'status')][string]$Action,
  [Parameter(Mandatory = $true)][ValidateSet('User', 'Machine')][string]$Scope,
  [Parameter(Mandatory = $true)][string]$Dir
)

$ErrorActionPreference = 'Stop'

if ($Scope -eq 'User') {
  $key = 'HKCU:\Environment'
} else {
  $key = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
}

$item = Get-Item -LiteralPath $key
# Keep %VARIABLES% unexpanded so that rewriting PATH does not freeze them.
$current = [string]$item.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
$kind = 'ExpandString'
if ($item.GetValueNames() -contains 'Path') {
  $kind = $item.GetValueKind('Path').ToString()
}

$wanted = $Dir.TrimEnd('\')
$entries = @($current -split ';' | Where-Object { $_ -ne '' })
$present = @($entries | Where-Object { $_.TrimEnd('\') -ieq $wanted }).Count -gt 0

switch ($Action) {
  'status' {
    if ($present) { Write-Output 'present' } else { Write-Output 'absent' }
    exit 0
  }
  'add' {
    if ($present) { exit 0 }
    $next = (@($entries) + $Dir) -join ';'
  }
  'remove' {
    if (-not $present) { exit 0 }
    $next = @($entries | Where-Object { $_.TrimEnd('\') -ine $wanted }) -join ';'
  }
}

New-ItemProperty -LiteralPath $key -Name 'Path' -Value $next -PropertyType $kind -Force | Out-Null

# Setting a variable through .NET broadcasts WM_SETTINGCHANGE, so new terminals see the new PATH.
[Environment]::SetEnvironmentVariable('SHOVEL_PATH_REFRESH', '1', $Scope)
[Environment]::SetEnvironmentVariable('SHOVEL_PATH_REFRESH', $null, $Scope)
exit 0
