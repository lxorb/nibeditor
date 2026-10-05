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
  url            = 'https://github.com/lxorb/nibeditor/releases/download/v0.13.0/Nib-0.13.0-windows-x64.msi'
  checksum       = 'C9EF6D1EF21BA8B9EDED76EE701E6F7411C0033FC8B619608A3B96A378824917'
  checksumType   = 'sha256'
  softwareName   = 'nibeditor'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

# Chocolatey's own url/url64bit pair has no slot for ARM64, and an ARM64 machine
# reports as 64-bit, so the architecture is picked by hand here.
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/nibeditor/releases/download/v0.13.0/Nib-0.13.0-windows-arm64.msi'
  $packageArgs['checksum'] = 'DF9BAADEBD4D1862199BBFDD3CA4F37C6857BCF7989731C4611855C9719E53E9'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'nibeditor requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
