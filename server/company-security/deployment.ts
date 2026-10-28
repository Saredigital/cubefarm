/** Verify OS facts before a real broker can read keys. No environment flag can authorize live mode. */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export interface DeploymentFacts {
  userName: string;
  userSid: string;
  sessionId: number;
  administrator: boolean;
  paths: { path: string; protected: boolean; allowedSids: string[]; ownerSid: string; isReparse: boolean; unsafeDescendants: boolean }[];
  codePaths: { path: string; ownerSid: string; writerSids: string[]; isReparse: boolean; unsafeDescendants: boolean }[];
  unsafeAncestors: boolean;
}
export function assertKeyOutsideState(keyPath: string, stateDir: string, platform: NodeJS.Platform = process.platform): void {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const relative = paths.relative(paths.resolve(stateDir), paths.resolve(keyPath));
  if (!relative || (!paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${paths.sep}`))) {
    throw new Error('Guarda la clave fuera del directorio de datos.');
  }
}
export function verifyDeploymentFacts(facts: DeploymentFacts, requiredPaths: string[], codePaths: string[] = []): void {
  if (facts.userName.split('\\').at(-1)?.toLowerCase() !== 'sareoffice-broker' || facts.sessionId !== 0 ||
    facts.administrator || facts.unsafeAncestors !== false || !/^S-1-5-21-(?:\d+-){2}\d+-\d+$/.test(facts.userSid)) {
    throw new Error('El broker exige la cuenta local dedicada sareoffice-broker, sin privilegios de administrador y en una sesión no interactiva.');
  }
  const permitted = new Set([facts.userSid, 'S-1-5-18', 'S-1-5-32-544']);
  for (const required of requiredPaths) {
    const entry = facts.paths.find(item => path.resolve(item.path).toLowerCase() === path.resolve(required).toLowerCase());
    if (!entry?.protected || !entry.allowedSids.length || entry.allowedSids.some(sid => !permitted.has(sid)) ||
      !permitted.has(entry.ownerSid) || entry.isReparse || entry.unsafeDescendants) {
      throw new Error('La configuración, las claves y los datos requieren ACL privadas para la cuenta del broker, SYSTEM y administradores de confianza.');
    }
  }
  const trustedWriters = new Set(['S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464']);
  for (const required of codePaths) {
    const entry = facts.codePaths?.find(item => path.resolve(item.path).toLowerCase() === path.resolve(required).toLowerCase());
    if (!entry || !trustedWriters.has(entry.ownerSid) || entry.writerSids.some(sid => !trustedWriters.has(sid)) ||
      entry.isReparse || entry.unsafeDescendants) throw new Error('El código y Node deben pertenecer a administradores y no permitir escritura de otras identidades.');
  }
}
export function assertWindowsBrokerDeployment(requiredPaths: string[], codePaths: string[]): void {
  if (process.platform !== 'win32') throw new Error('El arranque real admite el despliegue Windows documentado. La demo sigue disponible en otros sistemas.');
  const script = `
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$sessionId = (Get-Process -Id $PID).SessionId
$administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($identity.Name.Split('\\')[-1] -ne 'sareoffice-broker' -or $sessionId -ne 0 -or $administrator) { throw 'Identidad no autorizada.' }
$inputPaths = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SAREOFFICE_GATE_PATHS)) | ConvertFrom-Json
$privateSids = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
$codeSids = @('S-1-5-18', 'S-1-5-32-544')
$writeMask = [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
$ancestorMask = [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,WriteAttributes,WriteExtendedAttributes,ChangePermissions,TakeOwnership'
$installerSid = ([Security.Principal.NTAccount]::new('NT SERVICE\\TrustedInstaller')).Translate([Security.Principal.SecurityIdentifier]).Value
$codeSids += $installerSid
$ancestorSids = @('S-1-5-18', 'S-1-5-32-544', $installerSid)
function InspectPath($target, $isCode) {
  $item = Get-Item -LiteralPath $target -Force
  $acl = Get-Acl -LiteralPath $target
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  $rules = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and
    (-not $isCode -or ($_.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0) })
  $sids = @($rules | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value })
  $writers = @($rules | Where-Object { ($_.FileSystemRights -band $writeMask) -ne 0 } | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value })
  $reparse = ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
  $allowed = if ($isCode) { $codeSids } else { $privateSids }
  $testSids = if ($isCode) { $writers } else { $sids }
  $unsafe = $reparse -or $owner -notin $allowed -or @($testSids | Where-Object { $_ -notin $allowed }).Count -gt 0
  [PSCustomObject]@{ path = $target; protected = $acl.AreAccessRulesProtected; allowedSids = $sids; writerSids = $writers; ownerSid = $owner; isReparse = $reparse; unsafeDescendants = $false; unsafe = $unsafe }
}
function InspectTree($target, $isCode) {
  $result = InspectPath $target $isCode
  if ((Test-Path -LiteralPath $target -PathType Container) -and -not $result.isReparse) {
    foreach ($item in Get-ChildItem -LiteralPath $target -Recurse -Force) {
      $child = InspectPath $item.FullName $isCode
      if ($child.unsafe) { $result.unsafeDescendants = $true; break }
    }
  }
  return $result
}
$results = @($inputPaths.private | ForEach-Object { InspectTree $_ $false })
$codeResults = @($inputPaths.code | ForEach-Object { InspectTree $_ $true })
$unsafeAncestors = $false
$visited = @{}
foreach ($target in @($inputPaths.private) + @($inputPaths.code)) {
  $parent = [IO.Directory]::GetParent($target)
  while ($parent) {
    if (-not $visited.ContainsKey($parent.FullName)) {
      $visited[$parent.FullName] = $true
      $item = Get-Item -LiteralPath $parent.FullName -Force
      $acl = Get-Acl -LiteralPath $parent.FullName
      $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
      $writers = @($acl.Access | Where-Object {
        $_.AccessControlType -eq 'Allow' -and ($_.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and ($_.FileSystemRights -band $ancestorMask) -ne 0
      } | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value })
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $owner -notin $ancestorSids -or @($writers | Where-Object { $_ -notin $ancestorSids }).Count -gt 0) { $unsafeAncestors = $true }
    }
    $parent = $parent.Parent
  }
}
[PSCustomObject]@{ userName = $identity.Name; userSid = $identity.User.Value; sessionId = $sessionId; administrator = $administrator; paths = $results; codePaths = $codeResults; unsafeAncestors = $unsafeAncestors } | ConvertTo-Json -Depth 5 -Compress
`;
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const output = execFileSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 100_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { SystemRoot: process.env.SystemRoot, SAREOFFICE_GATE_PATHS: Buffer.from(JSON.stringify({ private: requiredPaths, code: codePaths })).toString('base64') },
  });
  verifyDeploymentFacts(JSON.parse(output), requiredPaths, codePaths);
}
