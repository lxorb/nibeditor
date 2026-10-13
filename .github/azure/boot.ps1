# A Windows build machine's whole life. ci.sh renders this run's values in and hands
# it over as the machine's custom data; vm.json's script extension starts it as SYSTEM.
# It gets the machine ready, starts exactly one job through a just-in-time runner, and
# deletes the machine afterwards.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$jit = '__JIT__'
$runnerUrl = '__RUNNER_URL__'
$runId = '__RUN_ID__'
$repo = '__REPO__'
$lifetime = [int]'__LIFETIME__'
$arm64 = '__ARM64__' -eq '1'
# An installer build makes an MSI, whose WiX 3 runs on .NET 3.5, which the image lacks.
$msi = '__ROW__' -notlike 'chromium-*'

$r = 'C:\r'
New-Item -ItemType Directory -Force $r | Out-Null
Start-Transcript "$r\boot.log" | Out-Null
$t0 = Get-Date
function Mark($what) { Write-Output ("{0,6:n1}s {1}" -f ((Get-Date) - $t0).TotalSeconds, $what) }

# The machine deletes itself, with the identity that may delete only in nib-ci: when
# the job is done, and at the end of its lifetime whatever else happened.
@'
$h = @{ Metadata = 'true' }
$id = Invoke-RestMethod -Headers $h 'http://169.254.169.254/metadata/instance/compute/resourceId?api-version=2021-02-01&format=text'
$token = (Invoke-RestMethod -Headers $h 'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/').access_token
Invoke-RestMethod -Method Delete -Headers @{ Authorization = "Bearer $token" } "https://management.azure.com$($id)?api-version=2024-07-01&forceDeletion=true"
'@ | Set-Content "$r\reap.ps1"
$ps = 'powershell.exe'
Register-ScheduledTask -TaskName nib-reap -User SYSTEM -RunLevel Highest -Force `
  -Action (New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File $r\reap.ps1") `
  -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes($lifetime)) | Out-Null
Mark 'watchdog set'

# Speed: no scanning of every file a build writes, and paths past 260 characters.
Set-MpPreference -DisableRealtimeMonitoring $true -DisableBehaviorMonitoring $true -DisableIOAVProtection $true
Add-MpPreference -ExclusionPath 'C:\'
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' LongPathsEnabled 1
Mark 'defender off'

# What the image lacks, side by side with the runner's own download: Python (pack.py),
# Ninja, for an arm64 build MSVC's arm64 compiler (over five minutes: the slowest part
# of an arm64 machine), and .NET 3.5 for an installer's WiX.
$jobs = @()
$jobs += Start-Job {
  curl.exe -sSfL -o C:\r\python.exe https://www.python.org/ftp/python/3.13.7/python-3.13.7-amd64.exe
  Start-Process C:\r\python.exe -Wait -ArgumentList '/quiet InstallAllUsers=1 TargetDir=C:\Python Include_test=0 Include_doc=0 Include_tcltk=0 Include_launcher=0'
  'python installed'
}
$jobs += Start-Job {
  # The engine's C++ wrapper is configured by CMake for Ninja.
  curl.exe -sSfL -o C:\r\ninja.zip https://github.com/ninja-build/ninja/releases/download/v1.13.1/ninja-win.zip
  New-Item -ItemType Directory -Force C:\ninja | Out-Null
  tar.exe -xf C:\r\ninja.zip -C C:\ninja
  'ninja installed: ' + (Test-Path C:\ninja\ninja.exe)
}
if ($arm64) {
  $jobs += Start-Job {
    $installer = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer"
    $vs = & "$installer\vswhere.exe" -latest -property installationPath
    Start-Process "$installer\setup.exe" -Wait -ArgumentList `
      "modify --installPath `"$vs`" --add Microsoft.VisualStudio.Component.VC.Tools.ARM64 --quiet --norestart --nocache"
    'arm64 compiler installed: ' + (Test-Path "$vs\VC\Tools\MSVC\*\bin\Hostx64\arm64\cl.exe")
  }
}
if ($msi) {
  $jobs += Start-Job {
    Enable-WindowsOptionalFeature -Online -FeatureName NetFx3 -All -NoRestart | Out-Null
    '.NET 3.5: ' + (Get-WindowsOptionalFeature -Online -FeatureName NetFx3).State
  }
}
curl.exe -sSfL -o "$r\runner.zip" $runnerUrl
tar.exe -xf "$r\runner.zip" -C $r
Mark 'runner unpacked'

# The runner takes one job: the one of the run that made this machine. A job of any
# other run, which only somebody who learned the label could send, never starts.
@"
if (`$env:GITHUB_RUN_ID -ne '$runId' -or `$env:GITHUB_REPOSITORY -ne '$repo') {
  Write-Output "::error::this machine is for run $runId of $repo"
  exit 1
}
"@ | Set-Content "$r\hook.ps1"
"ACTIONS_RUNNER_HOOK_JOB_STARTED=$r\hook.ps1" | Set-Content "$r\.env"

# The job itself. Git's bash goes ahead of the one in System32,
# which is WSL's and has no distribution.
@"
`$env:Path = 'C:\Program Files\Git\bin;C:\Python;C:\Python\Scripts;C:\ninja;' + `$env:Path
& '$r\run.cmd' --jitconfig '$jit' *> '$r\runner.log'
& $ps -NoProfile -ExecutionPolicy Bypass -File '$r\reap.ps1'
"@ | Set-Content "$r\job.ps1"

$jobs | Wait-Job | Receive-Job
Mark 'tools installed'

# As SYSTEM: the image's policy does not let the task scheduler keep a user's password,
# and nothing on this machine is anybody's but the job's.
Register-ScheduledTask -TaskName nib-runner -User SYSTEM -RunLevel Highest -Force `
  -Action (New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File $r\job.ps1") `
  -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes $lifetime)) | Out-Null
Start-ScheduledTask -TaskName nib-runner
Mark 'runner started'
Stop-Transcript | Out-Null
