<#
  An install from before the product was renamed (Nib, up to 0.11), updated by this
  build (nibeditor) the way each road to an update runs it, and what Windows says
  afterwards. For a CI runner only: it installs, updates and uninstalls for real, in
  the account it runs in, so it refuses to run anywhere but GitHub Actions.

    pwsh scripts/windows-upgrade.ps1 -Scenario updater -Old <dir> -New <dir>

  -Old holds the 0.11.0 setup.exe and .msi, -New this build's. The scenarios:

    updater    the old NSIS install, updated as nib's own updater does (`/P /UPDATE`)
    silent     the same, updated as winget does (`/S`)
    elsewhere  the same, updated into a folder of its own (`/S /D=`)
    msi        the old MSI, updated as Chocolatey and nib's updater run an MSI

  Before the update nib is made the default browser for http and https the way
  Settings would, with the hash Windows seals the choice with (PS-SFTA, pinned by
  digest), so what is checked after it is that the choice still holds. Exits with
  the number of checks that failed. See installer.nsh and wix/browser.wxs.
#>
param(
  [Parameter(Mandatory)][ValidateSet('updater', 'silent', 'elsewhere', 'msi')][string]$Scenario,
  [Parameter(Mandatory)][string]$Old,
  [Parameter(Mandatory)][string]$New,
  [Parameter(Mandatory)][string]$Sfta
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'this installs and uninstalls for real; it runs on a CI runner only' }

$wrong = [System.Collections.Generic.List[string]]::new()
function Check([string]$what, [bool]$held) {
  if ($held) { Write-Host "ok     $what" } else { Write-Host "WRONG  $what"; $wrong.Add($what) }
}

function Run([string]$file, [string]$arguments) {
  Write-Host "> $file $arguments"
  $process = Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru
  Write-Host "  exit $($process.ExitCode)"
  return $process.ExitCode
}

function Value([string]$key, [string]$name = '(default)') {
  $item = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
  if (-not $item) { return $null }
  return $item.$name
}

function Has([string]$key) { Test-Path -LiteralPath $key }

Add-Type -Namespace Nib -Name Shell -MemberDefinition @'
[DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
public static extern uint AssocQueryString(uint flags, uint what, string assoc, string extra, System.Text.StringBuilder found, ref uint size);
'@

# What the shell opens a scheme with: its ProgID (20) or its program (2).
function Handler([string]$scheme, [uint32]$what) {
  $found = New-Object System.Text.StringBuilder 1024
  $size = [uint32]1024
  [void][Nib.Shell]::AssocQueryString(0x1000, $what, $scheme, $null, $found, [ref]$size)
  return $found.ToString()
}

function Shortcut([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
  $folder = (New-Object -ComObject Shell.Application).Namespace((Split-Path $path))
  $id = $folder.ParseName((Split-Path $path -Leaf)).ExtendedProperty('System.AppUserModel.ID')
  return [pscustomobject]@{ Target = $link.TargetPath; Id = $id }
}

function Show([string]$when) {
  Write-Host "--- $when"
  foreach ($key in @(
      'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nib',
      'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\nibeditor',
      'HKCU:\Software\Emil Vinu\Nib',
      'HKCU:\Software\Emil Vinu\nibeditor',
      'HKCU:\Software\Clients\StartMenuInternet\Nib\shell\open\command',
      'HKCU:\Software\Clients\StartMenuInternet\nibeditor\shell\open\command',
      'HKCU:\Software\Classes\NibURL\shell\open\command',
      'HKCU:\Software\RegisteredApplications')) {
    if (Has $key) { Write-Host $key; Get-ItemProperty -LiteralPath $key | Format-List | Out-String | Write-Host }
  }
  Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' |
    ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.Publisher -eq 'Emil Vinu' } |
    ForEach-Object { Write-Host "HKLM uninstall: $($_.PSChildName) $($_.DisplayName) $($_.DisplayVersion) $($_.InstallLocation)" }
  foreach ($dir in @($programs, $desktop, $commonPrograms, "$commonPrograms\Nib", "$commonPrograms\nibeditor")) {
    Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^(Nib|nibeditor)' } |
      ForEach-Object { $s = Shortcut $_.FullName; Write-Host "shortcut $($_.FullName) -> $($s.Target) [$($s.Id)]" }
  }
  Write-Host "http: $(Handler 'http' 20) $(Handler 'http' 2)"
  Write-Host "https: $(Handler 'https' 20) $(Handler 'https' 2)"
}

$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('Desktop')
$commonPrograms = [Environment]::GetFolderPath('CommonPrograms')
$oldSetup = (Get-ChildItem $Old -Filter '*-setup.exe' | Select-Object -First 1).FullName
$oldMsi = (Get-ChildItem $Old -Filter '*.msi' | Select-Object -First 1).FullName
$newSetup = (Get-ChildItem $New -Filter '*-setup.exe' | Select-Object -First 1).FullName
$newMsi = (Get-ChildItem $New -Filter '*.msi' | Select-Object -First 1).FullName
$version = (Get-Item $newSetup).Name -replace '^[^_]+_([^_]+)_.*$', '$1'

$hkcu = 'HKCU:\Software'
$uninstall = "$hkcu\Microsoft\Windows\CurrentVersion\Uninstall"
$clients = "$hkcu\Clients\StartMenuInternet"
$registered = "$hkcu\RegisteredApplications"

# --- the install from before
if ($Scenario -eq 'msi') {
  Run 'msiexec.exe' "/i `"$oldMsi`" /qn /l*v `"$env:RUNNER_TEMP\old-msi.log`"" | Out-Null
  $dir = "$env:ProgramFiles\Nib"
} else {
  Run $oldSetup '/S' | Out-Null
  $dir = "$env:LOCALAPPDATA\Nib"
}
Check "0.11.0 is installed in $dir" (Test-Path "$dir\nib.exe")

# Settings' own choice, sealed with its hash. The old install wrote NibURL, which is
# what the choice names.
. $Sfta
foreach ($scheme in 'http', 'https') { Set-PTA -ProgId 'NibURL' -Protocol $scheme }
$chosen = (Handler 'http' 20) -eq 'NibURL' -and (Handler 'https' 20) -eq 'NibURL'
if (-not $chosen) { Write-Host '::warning::this runner did not take the default browser; the choice is not checked' }
Show 'before'
$hadDesktop = Test-Path "$desktop\Nib.lnk"

# --- the update
switch ($Scenario) {
  'updater' { Run $newSetup '/P /UPDATE' | Out-Null; $want = $dir }
  'silent' { Run $newSetup '/S' | Out-Null; $want = $dir }
  'elsewhere' { $want = 'C:\nib-elsewhere'; Run $newSetup "/S /D=$want" | Out-Null }
  'msi' { Run 'msiexec.exe' "/i `"$newMsi`" /passive /norestart /l*v `"$env:RUNNER_TEMP\new-msi.log`"" | Out-Null; $want = $dir }
}
Show 'after'

# --- one install, where it should be
$exe = "$want\nib.exe"
Check "the program is in $want" (Test-Path $exe)
Check "and it is $version" ((Get-Item $exe).VersionInfo.ProductVersion -like "$version*")
if ($Scenario -eq 'msi') {
  Check 'no second folder under the new name' (-not (Test-Path "$env:ProgramFiles\nibeditor"))
  $entries = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' |
      ForEach-Object { Get-ItemProperty $_.PSPath } |
      Where-Object { $_.Publisher -eq 'Emil Vinu' -and $_.DisplayName -in 'Nib', 'nibeditor' })
  Check 'one entry in Apps & Features' ($entries.Count -eq 1)
  Check "and it is nibeditor $version" ($entries.Count -eq 1 -and $entries[0].DisplayName -eq 'nibeditor' -and $entries[0].DisplayVersion -eq $version)
  $start = Shortcut "$commonPrograms\nibeditor\nibeditor.lnk"
  Check 'the Start menu entry is nibeditor and starts the program' ($start -and $start.Target -eq $exe)
  Check 'and carries the app id' ($start -and $start.Id -eq 'ch.emilvinu.nib')
  Check 'the old Start menu entry is gone' (-not (Test-Path "$commonPrograms\Nib\Nib.lnk"))
} else {
  if ($Scenario -eq 'elsewhere') {
    Check 'the old folder is gone' (-not (Test-Path "$env:LOCALAPPDATA\Nib\nib.exe"))
  }
  Check 'no folder under the new name' (-not (Test-Path "$env:LOCALAPPDATA\nibeditor"))
  Check 'the old Apps & Features entry is gone' (-not (Has "$uninstall\Nib"))
  Check 'the new one is there' ((Value "$uninstall\nibeditor" 'DisplayName') -eq 'nibeditor')
  Check "and is $version" ((Value "$uninstall\nibeditor" 'DisplayVersion') -eq $version)
  Check "and says it is in $want" ((Value "$uninstall\nibeditor" 'InstallLocation') -eq "`"$want`"")
  Check 'the old remembered folder is gone' (-not (Has "$hkcu\Emil Vinu\Nib"))
  Check 'the folder is remembered under the new name' ((Value "$hkcu\Emil Vinu\nibeditor") -eq $want)
  $start = Shortcut "$programs\nibeditor.lnk"
  Check 'the Start menu entry is nibeditor and starts the program' ($start -and $start.Target -eq $exe)
  Check 'and carries the app id' ($start -and $start.Id -eq 'ch.emilvinu.nib')
  Check 'the old Start menu entry is gone' (-not (Test-Path "$programs\Nib.lnk"))
  if ($hadDesktop) {
    $icon = Shortcut "$desktop\nibeditor.lnk"
    Check 'the desktop icon is nibeditor and starts the program' ($icon -and $icon.Target -eq $exe)
    Check 'the old desktop icon is gone' (-not (Test-Path "$desktop\Nib.lnk"))
  }
}

# --- the browser
Check 'the old browser client is gone' (-not (Has "$clients\Nib"))
Check 'and its line in RegisteredApplications' ($null -eq (Value $registered 'Nib'))
Check 'the browser client is nibeditor and starts the program' ((Value "$clients\nibeditor\shell\open\command") -eq "`"$exe`"")
Check 'and is listed for Default apps' ((Value $registered 'nibeditor') -eq 'Software\Clients\StartMenuInternet\nibeditor\Capabilities')
Check 'the ProgID starts the program with a link' ((Value "$hkcu\Classes\NibURL\shell\open\command") -eq "`"$exe`" --url `"%1`"")
if ($chosen) {
  foreach ($scheme in 'http', 'https') {
    Check "nib is still the default for $scheme" ((Handler $scheme 20) -eq 'NibURL')
    Check "and $scheme starts the program" ((Handler $scheme 2) -eq $exe)
  }
}

# --- and away again
if ($Scenario -eq 'msi') {
  $code = $entries[0].PSChildName
  Run 'msiexec.exe' "/x $code /qn" | Out-Null
} else {
  Run "$want\uninstall.exe" '/S' | Out-Null
  Start-Sleep -Seconds 3
}
Show 'uninstalled'
Check 'the program is gone' (-not (Test-Path $exe))
Check 'no Apps & Features entry is left' (-not (Has "$uninstall\Nib") -and -not (Has "$uninstall\nibeditor"))
Check 'no browser client is left' (-not (Has "$clients\Nib") -and -not (Has "$clients\nibeditor"))
Check 'nothing in RegisteredApplications' ($null -eq (Value $registered 'Nib') -and $null -eq (Value $registered 'nibeditor'))
Check 'no shortcut is left' (-not ((Test-Path "$programs\Nib.lnk") -or (Test-Path "$programs\nibeditor.lnk") -or (Test-Path "$commonPrograms\nibeditor\nibeditor.lnk")))

Write-Host "$($wrong.Count) wrong"
exit $wrong.Count
