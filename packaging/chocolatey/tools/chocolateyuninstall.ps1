$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  softwareName   = 'Nib'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1605, 1614, 1641)
}

# nibeditor's own NSIS installer registers under the same display name but with
# a plain key ("Nib") instead of a product GUID. Only the MSI's entry can be
# handed to the Windows Installer, so anything that is not a GUID is left alone.
[array]$keys = Get-UninstallRegistryKey -SoftwareName $packageArgs.softwareName |
  Where-Object { $_.PSChildName -match '^\{[0-9A-Fa-f]{8}-([0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}$' }

if ($keys.Count -eq 0) {
  Write-Warning "$($packageArgs.packageName) is not installed by this package - nothing to uninstall."
  return
}

if ($keys.Count -gt 1) {
  Write-Warning "$($keys.Count) matching installations found. None were removed; uninstall them by hand:"
  $keys | ForEach-Object { Write-Warning "  $($_.DisplayName) $($_.DisplayVersion) [$($_.PSChildName)]" }
  return
}

$packageArgs['file'] = ''
$packageArgs['silentArgs'] = "$($keys[0].PSChildName) $($packageArgs.silentArgs)"

Uninstall-ChocolateyPackage @packageArgs
