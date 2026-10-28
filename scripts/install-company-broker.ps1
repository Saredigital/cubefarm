# Run manually as administrator on the dedicated broker machine, never on the agents' workstation.
param(
  [Parameter(Mandatory=$true)][string]$Workspace,
  [Parameter(Mandatory=$true)][string]$Config,
  [Parameter(Mandatory=$true)][string]$KeyFile,
  [Parameter(Mandatory=$true)][string]$StateDirectory,
  [Parameter(Mandatory=$true)][string]$TlsCertificate,
  [Parameter(Mandatory=$true)][string]$TlsKey,
  [Parameter(Mandatory=$true)][securestring]$AccountPassword
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Ejecuta el instalador como administrador.' }
$Workspace = (Resolve-Path -LiteralPath $Workspace).Path
$Config = (Resolve-Path -LiteralPath $Config).Path
$KeyFile = (Resolve-Path -LiteralPath $KeyFile).Path
$TlsCertificate = (Resolve-Path -LiteralPath $TlsCertificate).Path
$TlsKey = (Resolve-Path -LiteralPath $TlsKey).Path
$StateDirectory = [IO.Path]::GetFullPath($StateDirectory)
if ($StateDirectory -eq [IO.Path]::GetPathRoot($StateDirectory)) { throw 'El directorio de datos no puede ser la raíz de una unidad.' }
if (Test-Path -LiteralPath $StateDirectory) {
  if ((Get-Item -LiteralPath $StateDirectory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No se admiten redirecciones en el directorio de datos.' }
  if (Get-ChildItem -LiteralPath $StateDirectory -Force | Select-Object -First 1) { throw 'La primera instalación requiere un directorio de datos vacío. No modifica instalaciones existentes.' }
}
foreach ($target in @($Workspace, $Config, $KeyFile, $TlsCertificate, $TlsKey)) {
  if ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No se admiten junctions ni enlaces en las rutas del broker.' }
}
$codeItems = @((Get-Item -LiteralPath $Workspace -Force)) + @(Get-ChildItem -LiteralPath $Workspace -Recurse -Force)
if ($codeItems | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'La copia de código no puede contener enlaces, junctions ni dependencias compartidas.' }
$privateParents = @($Config, $KeyFile, $TlsKey | ForEach-Object { Split-Path -Parent $_ } | Select-Object -Unique)
foreach ($parent in $privateParents) {
  if ($parent -eq [IO.Path]::GetPathRoot($parent) -or $parent -eq $Workspace) { throw 'Los archivos privados requieren directorios dedicados fuera del código y de la raíz de la unidad.' }
  if ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No se admiten redirecciones en directorios privados.' }
}
New-Item -ItemType Directory -Force -Path $StateDirectory | Out-Null
if (-not (Get-LocalUser -Name 'sareoffice-broker' -ErrorAction SilentlyContinue)) {
  New-LocalUser -Name 'sareoffice-broker' -Password $AccountPassword -Description 'Servicio protegido de empresa' -UserMayNotChangePassword | Out-Null
}
$account = Get-LocalUser -Name 'sareoffice-broker'
$adminGroup = Get-LocalGroup -SID 'S-1-5-32-544'
if (Get-LocalGroupMember -Group $adminGroup | Where-Object { $_.SID -eq $account.SID }) { throw 'La cuenta del broker no puede ser administradora.' }
foreach ($target in @($privateParents) + @($Config, $KeyFile, $StateDirectory, $TlsKey)) {
  $acl = Get-Acl -LiteralPath $target
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  foreach ($sid in @($account.SID.Value, 'S-1-5-18', 'S-1-5-32-544')) {
    $rights = if ($sid -eq $account.SID.Value -and $target -ne $StateDirectory) { 'ReadAndExecute' } else { 'FullControl' }
    $inheritance = if (Test-Path -LiteralPath $target -PathType Container) { 'ContainerInherit, ObjectInherit' } else { 'None' }
    $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), $rights, $inheritance, 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $target -AclObject $acl
}
foreach ($item in $codeItems) {
  $acl = Get-Acl -LiteralPath $item.FullName
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  foreach ($sid in @($account.SID.Value, 'S-1-5-18', 'S-1-5-32-544')) {
    $rights = if ($sid -eq $account.SID.Value) { 'ReadAndExecute' } else { 'FullControl' }
    $inheritance = if ($item.PSIsContainer) { 'ContainerInherit, ObjectInherit' } else { 'None' }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), $rights, $inheritance, 'None', 'Allow'))
  }
  Set-Acl -LiteralPath $item.FullName -AclObject $acl
}
$node = (Get-Command node.exe).Source
# Node must be installed administratively. The runtime gate checks this directory and every child.
if (-not ([IO.Path]::GetFullPath($node).StartsWith([IO.Path]::GetFullPath($env:ProgramFiles), [StringComparison]::OrdinalIgnoreCase))) { throw 'Instala Node para todos los usuarios en Program Files; no se admite un runtime modificable por el usuario.' }
$paths = @((Join-Path $Workspace 'server/company-security/broker.ts'), $Config, $KeyFile, $StateDirectory, $TlsCertificate, $TlsKey)
if ($paths | Where-Object { $_.Contains('"') }) { throw 'Las rutas no pueden contener comillas.' }
$arguments = '--import tsx "' + $paths[0] + '" --config "' + $Config + '" --key-file "' + $KeyFile + '" --state-dir "' + $StateDirectory + '" --tls-cert "' + $TlsCertificate + '" --tls-key "' + $TlsKey + '"'
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $Workspace
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AccountPassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  Register-ScheduledTask -TaskName 'SareofficeCompanyBroker' -Action $action -Trigger $trigger -Settings $settings -User "$env:COMPUTERNAME\sareoffice-broker" -Password $plainPassword -RunLevel Limited | Out-Null
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  $plainPassword = $null
}
Write-Output 'Tarea registrada. Revisa las reglas de red y arráncala manualmente; no se ha conectado ninguna cuenta.'
