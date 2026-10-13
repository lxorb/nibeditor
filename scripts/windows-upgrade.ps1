<#
  An install from before the product was renamed Orden - Nib up to 0.11, nibeditor
  from 0.12 to 0.13, or Nib updated to nibeditor - updated by this build the way each
  road to an update runs it, and what Windows says afterwards. For a CI runner only: it
  installs, updates and uninstalls for real, in the account it runs in, so it refuses
  to run anywhere but GitHub Actions.

    pwsh scripts/windows-upgrade.ps1 -Scenario updater -Old <dir> -OldName Nib -New <dir>
    pwsh scripts/windows-upgrade.ps1 -Scenario updater -Old <dir> -OldName Nib `
      -Via <dir> -ViaName nibeditor -New <dir>

  -Old holds the old release's setup.exe and .msi and -OldName is the name it was
  made under; -Via, when given, is a later old release the first is updated to before
  this build, the same way; -New holds this build's. The scenarios:

    updater    the old NSIS install, updated as the app's own updater does (`/P /UPDATE`)
    silent     the same, updated as winget does (`/S`)
    elsewhere  the same, updated into a folder of its own (`/S /D=`)
    msi        the old MSI, updated as Chocolatey and the app's updater run an MSI

  Before the update the app is made the default browser for http and https the way
  Settings would, with the hash Windows seals the choice with (PS-SFTA, pinned by
  digest), so what is checked after it is that the choice still holds. Exits with
  the number of checks that failed. See installer.nsh and wix/browser.wxs.
#>
param(
  [Parameter(Mandatory)][ValidateSet('updater', 'silent', 'elsewhere', 'msi')][string]$Scenario,
  [Parameter(Mandatory)][string]$Old,
  [Parameter(Mandatory)][ValidateSet('Nib', 'nibeditor')][string]$OldName,
  [string]$Via = '',
  [ValidateSet('', 'nibeditor')][string]$ViaName = '',
  [Parameter(Mandatory)][string]$New,
  [Parameter(Mandatory)][string]$Sfta
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'this installs and uninstalls for real; it runs on a CI runner only' }
if (($Via -eq '') -ne ($ViaName -eq '')) { throw '-Via and -ViaName go together' }

# Every name the product has had, the one this build is made under last.
$names = @('Nib', 'nibeditor', 'Orden')
$product = 'Orden'
# The name the install is under once the old releases have run: the last of them.
$before = if ($ViaName) { $ViaName } else { $OldName }

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

# The program a command starts, as a long path: the MSI writes its own as a short one
# (C:\PROGRA~1\...), which is the same file.
function Starts([string]$command) {
  if ($command -notmatch '^"([^"]+)"') { return $null }
  $file = Get-Item -LiteralPath $Matches[1] -ErrorAction SilentlyContinue
  if ($file) { return $file.FullName } else { return $Matches[1] }
}

Add-Type -Namespace Nib -Name Shell -MemberDefinition @'
[DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
public static extern uint AssocQueryString(uint flags, uint what, string assoc, string extra, System.Text.StringBuilder found, ref uint size);
'@

# The ProgID the shell opens a scheme with.
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
  $keys = foreach ($name in $names) {
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$name"
    "HKCU:\Software\Emil Vinu\$name"
    "HKCU:\Software\Clients\StartMenuInternet\$name\shell\open\command"
  }
  foreach ($key in @($keys) + @('HKCU:\Software\Classes\NibURL\shell\open\command', 'HKCU:\Software\RegisteredApplications')) {
    if (Has $key) { Write-Host $key; Get-ItemProperty -LiteralPath $key | Format-List | Out-String | Write-Host }
  }
  Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' |
    ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.Publisher -eq 'Emil Vinu' } |
    ForEach-Object { Write-Host "HKLM uninstall: $($_.PSChildName) $($_.DisplayName) $($_.DisplayVersion) $($_.InstallLocation)" }
  $dirs = @($programs, $desktop, $commonPrograms, $commonDesktop, $where) + @($names | ForEach-Object { "$commonPrograms\$_" })
  foreach ($dir in $dirs) {
    Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^(Uninstall )?(Nib|nibeditor|Orden)\.lnk$' } |
      ForEach-Object { $s = Shortcut $_.FullName; Write-Host "shortcut $($_.FullName) -> $($s.Target) [$($s.Id)]" }
  }
  Write-Host "http: $(Handler 'http' 20)"
  Write-Host "https: $(Handler 'https' 20)"
}

function Files([string]$dir) {
  [pscustomobject]@{
    Setup = (Get-ChildItem $dir -Filter '*-setup.exe' | Select-Object -First 1).FullName
    Msi = (Get-ChildItem $dir -Filter '*.msi' | Select-Object -First 1).FullName
  }
}

$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('Desktop')
$commonPrograms = [Environment]::GetFolderPath('CommonPrograms')
$commonDesktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
$where = ''
$first = Files $Old
$new = Files $New
$version = (Get-Item $new.Setup).Name -replace '^[^_]+_([^_]+)_.*$', '$1'

$hkcu = 'HKCU:\Software'
$uninstall = "$hkcu\Microsoft\Windows\CurrentVersion\Uninstall"
$clients = "$hkcu\Clients\StartMenuInternet"
$registered = "$hkcu\RegisteredApplications"

# --- the install from before: the first old release, where its name puts it
if ($Scenario -eq 'msi') {
  Run 'msiexec.exe' "/i `"$($first.Msi)`" /qn /l*v `"$env:RUNNER_TEMP\old-msi.log`"" | Out-Null
  $dir = "$env:ProgramFiles\$OldName"
} else {
  Run $first.Setup '/S' | Out-Null
  $dir = "$env:LOCALAPPDATA\$OldName"
}
$where = $dir
Check "$OldName is installed in $dir" (Test-Path "$dir\nib.exe")

# Then the later old release over it, which keeps that folder.
if ($Via) {
  $via = Files $Via
  if ($Scenario -eq 'msi') {
    Run 'msiexec.exe' "/i `"$($via.Msi)`" /qn /l*v `"$env:RUNNER_TEMP\via-msi.log`"" | Out-Null
  } else {
    Run $via.Setup '/S' | Out-Null
  }
  Check "$ViaName is installed in $dir" ((Test-Path "$dir\nib.exe") -and -not (Test-Path "$($dir -replace '[^\\]+$', $ViaName)\nib.exe"))
}

# Settings' own choice, sealed with its hash. The old install wrote NibURL, which is
# what the choice names.
. $Sfta
foreach ($scheme in 'http', 'https') { Set-PTA -ProgId 'NibURL' -Protocol $scheme }
$chosen = (Handler 'http' 20) -eq 'NibURL' -and (Handler 'https' 20) -eq 'NibURL'
if (-not $chosen) { Write-Host '::warning::this runner did not take the default browser; the choice is not checked' }
Show 'before'
$hadDesktop = Test-Path "$desktop\$before.lnk"

# --- the update
switch ($Scenario) {
  'updater' { Run $new.Setup '/P /UPDATE' | Out-Null; $want = $dir }
  'silent' { Run $new.Setup '/S' | Out-Null; $want = $dir }
  'elsewhere' { $want = 'C:\nib-elsewhere'; Run $new.Setup "/S /D=$want" | Out-Null }
  'msi' { Run 'msiexec.exe' "/i `"$($new.Msi)`" /passive /norestart /l*v `"$env:RUNNER_TEMP\new-msi.log`"" | Out-Null; $want = $dir }
}
Show 'after'

$olds = @($names | Where-Object { $_ -ne $product })

# --- one install, where it should be
$exe = "$want\nib.exe"
Check "the program is in $want" (Test-Path $exe)
Check "and it is $version" ((Get-Item $exe).VersionInfo.ProductVersion -like "$version*")
if ($Scenario -eq 'msi') {
  Check 'no second folder under the new name' (-not (Test-Path "$env:ProgramFiles\$product"))
  $entries = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' |
      ForEach-Object { Get-ItemProperty $_.PSPath } |
      Where-Object { $_.Publisher -eq 'Emil Vinu' -and $_.DisplayName -in $names })
  Check 'one entry in Apps & Features' ($entries.Count -eq 1)
  Check "and it is $product $version" ($entries.Count -eq 1 -and $entries[0].DisplayName -ceq $product -and $entries[0].DisplayVersion -eq $version)
  $start = Shortcut "$commonPrograms\$product\$product.lnk"
  Check "the Start menu entry is $product and starts the program" ($start -and $start.Target -eq $exe)
  Check 'and carries the app id' ($start -and $start.Id -eq 'ch.emilvinu.nib')
  foreach ($name in $olds) {
    Check "the $name Start menu entry is gone" (-not (Test-Path "$commonPrograms\$name\$name.lnk"))
    Check "and its folder" (-not (Test-Path "$commonPrograms\$name"))
    Check "the $name desktop icon is gone" (-not (Test-Path "$commonDesktop\$name.lnk"))
    Check "the $name uninstall shortcut in the program's folder is gone" (-not (Test-Path "$want\Uninstall $name.lnk"))
  }
} else {
  if ($Scenario -eq 'elsewhere') {
    Check 'the old folder is gone' (-not (Test-Path "$dir\nib.exe"))
  }
  Check 'no folder under the new name' (-not (Test-Path "$env:LOCALAPPDATA\$product"))
  foreach ($name in $olds) {
    Check "the $name Apps & Features entry is gone" (-not (Has "$uninstall\$name"))
    Check "the $name remembered folder is gone" (-not (Has "$hkcu\Emil Vinu\$name"))
    Check "the $name Start menu entry is gone" (-not (Test-Path "$programs\$name.lnk"))
    Check "the $name desktop icon is gone" (-not (Test-Path "$desktop\$name.lnk"))
  }
  Check 'the new one is there' ((Value "$uninstall\$product" 'DisplayName') -ceq $product)
  Check "and is $version" ((Value "$uninstall\$product" 'DisplayVersion') -eq $version)
  Check "and says it is in $want" ((Value "$uninstall\$product" 'InstallLocation') -eq "`"$want`"")
  Check 'the folder is remembered under the new name' ((Value "$hkcu\Emil Vinu\$product") -eq $want)
  $start = Shortcut "$programs\$product.lnk"
  Check "the Start menu entry is $product and starts the program" ($start -and $start.Target -eq $exe)
  Check 'and carries the app id' ($start -and $start.Id -eq 'ch.emilvinu.nib')
  if ($hadDesktop) {
    $icon = Shortcut "$desktop\$product.lnk"
    Check "the desktop icon is $product and starts the program" ($icon -and $icon.Target -eq $exe)
  }
}

# --- the browser
foreach ($name in $olds) {
  Check "the $name browser client is gone" (-not (Has "$clients\$name"))
  Check "and its line in RegisteredApplications" ($null -eq (Value $registered $name))
}
Check "the browser client is $product and starts the program" ((Starts (Value "$clients\$product\shell\open\command")) -eq $exe)
Check 'and is listed for Default apps' ((Value $registered $product) -eq "Software\Clients\StartMenuInternet\$product\Capabilities")
$link = Value "$hkcu\Classes\NibURL\shell\open\command"
Check 'the ProgID starts the program with a link' ((Starts $link) -eq $exe -and $link -like '* --url "%1"')
if ($chosen) {
  foreach ($scheme in 'http', 'https') {
    # The ProgID the shell resolves the scheme to, through the sealed choice; that the
    # ProgID starts this program is checked above.
    Check "the app is still the default for $scheme" ((Handler $scheme 20) -eq 'NibURL')
  }
}

# --- PDFs: in "Open with", and never the default
$pdf = Value "$hkcu\Classes\NibPDF\shell\open\command"
Check 'the PDF ProgID starts the program with the file' ((Starts $pdf) -eq $exe -and $pdf -like '* "%1"')
Check 'and is offered in Open with' ($null -ne (Value "$hkcu\Classes\.pdf\OpenWithProgids" 'NibPDF'))
Check 'and the default for PDFs is left alone' ((Value "$hkcu\Classes\.pdf") -ne 'NibPDF')

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
Check 'nothing in Open with for PDFs' (-not (Has "$hkcu\Classes\NibPDF") -and $null -eq (Value "$hkcu\Classes\.pdf\OpenWithProgids" 'NibPDF'))
foreach ($name in $names) {
  Check "no $name Apps & Features entry is left" (-not (Has "$uninstall\$name"))
  Check "no $name browser client is left" (-not (Has "$clients\$name"))
  Check "nothing of $name in RegisteredApplications" ($null -eq (Value $registered $name))
  $left = @("$programs\$name.lnk", "$desktop\$name.lnk", "$commonPrograms\$name\$name.lnk", "$commonDesktop\$name.lnk") |
    Where-Object { Test-Path $_ }
  Check "no $name shortcut is left $left" (-not $left)
}

Write-Host "$($wrong.Count) wrong"
exit $wrong.Count
