$ErrorActionPreference = 'Stop'

# Chocolatey installs for the whole machine, so this package uses the MSI
# (ALLUSERS=1, Program Files) rather than the NSIS setup.exe, which is a
# per-user install and would land in the elevated account's %LOCALAPPDATA%.
#
# The url and checksum are spelled out as literals, never built from variables:
# the community repository's validator reads them straight out of this file
# (CPMR0073) and treats anything it cannot read as a download with no checksum.
# The release workflow rewrites all four literals when it publishes.
#
# The asset name and softwareName below stay "Nib": that is the product name the
# bundle carries and what it registers in Add/Remove Programs, whatever the app
# is called on the website.
$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/nibeditor/releases/download/v0.10.0/Nib-0.10.0-windows-x64.msi'
  checksum       = '72709B3CA457ABA9D9FDD8C571B1F226B880863D7166F51AC8D5C84A8CF0D66B'
  checksumType   = 'sha256'
  softwareName   = 'Nib'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

# Chocolatey's own url/url64bit pair has no slot for ARM64, and an ARM64 machine
# reports as 64-bit, so the architecture is picked by hand here.
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/nibeditor/releases/download/v0.10.0/Nib-0.10.0-windows-arm64.msi'
  $packageArgs['checksum'] = '49719FD347179FDEF6F061C60FE4214415E9E27BA1C348CAAEC93EB5369A3687'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'nibeditor requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
