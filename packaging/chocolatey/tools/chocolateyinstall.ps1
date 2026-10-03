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
# The asset name stays "Nib-": every build of main from before the product was
# renamed reads no other name. softwareName is what the MSI registers in
# Add/Remove Programs, which is the product's name, nibeditor. The MSI replaces
# one made under the old name, Nib, in place: it keeps that one's upgrade code.
$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/nibeditor/releases/download/v0.11.0/Nib-0.11.0-windows-x64.msi'
  checksum       = '1087F908D12FD7DEBB0F6EB9359E369150E26B8AE46B2A0596510489D126BD5A'
  checksumType   = 'sha256'
  softwareName   = 'nibeditor'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

# Chocolatey's own url/url64bit pair has no slot for ARM64, and an ARM64 machine
# reports as 64-bit, so the architecture is picked by hand here.
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/nibeditor/releases/download/v0.11.0/Nib-0.11.0-windows-arm64.msi'
  $packageArgs['checksum'] = '62383F9889118554D6A121AE7642A3CC931D7602DC4B117F1A5FEFB806B93035'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'nibeditor requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
