param([Parameter(Mandatory=$true)][string]$Vault,[string]$ProjectRoot=(Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
$root=$ProjectRoot
$vaultPath=[System.IO.Path]::GetFullPath($Vault)
if(!(Test-Path -LiteralPath (Join-Path $vaultPath '.obsidian') -PathType Container)){throw 'Not an Obsidian vault'}
$dest=Join-Path $vaultPath '.obsidian/plugins/apex-dashboard'
[void][System.IO.Directory]::CreateDirectory($dest)
$utf8=[System.Text.UTF8Encoding]::new($false,$true)
$runtime=@('main.js','manifest.json','styles.css','secure-worker.js')
foreach($name in $runtime){
 $source=Join-Path $root ('dist/'+$name)
 $bytes=[System.IO.File]::ReadAllBytes($source);[void]$utf8.GetString($bytes)
 if([System.Text.Encoding]::ASCII.GetString($bytes,0,[Math]::Min(100,$bytes.Length)).Contains('%TSD-Header')){throw "Invalid source: $name"}
}
foreach($name in $runtime){
 $source=Join-Path $root ('dist/'+$name);$destination=Join-Path $dest $name
 Copy-Item -LiteralPath $source -Destination $destination -Force
 if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash){throw "Hash mismatch: $name"}
}
$toolRoot=Join-Path $root 'dist/tools'
foreach($file in Get-ChildItem -LiteralPath $toolRoot -File -Recurse){
 $relative=$file.FullName.Substring($toolRoot.Length+1);$destination=Join-Path $vaultPath ('tools/'+$relative)
 [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($destination))
 Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
 if((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash){throw "Tool hash mismatch: $relative"}
}
Write-Output 'Deployed runtime and standalone recovery tools. Existing data.json and note files preserved. Reload Apex in Obsidian.'
