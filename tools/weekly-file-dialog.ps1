param([ValidateSet('encrypt','decrypt')][string]$Mode)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$node=Get-Command node.exe -ErrorAction SilentlyContinue
if(!$node){throw 'Node.js 20+ is required. Install Node.js, then run this file again.'}
$version=& $node.Source --version
if([int]($version.TrimStart('v').Split('.')[0]) -lt 20){throw 'Node.js 20+ is required.'}
$vault=Split-Path -Parent $PSScriptRoot
$open=[System.Windows.Forms.OpenFileDialog]::new()
$open.Multiselect=$false
$open.InitialDirectory=if(Test-Path -LiteralPath (Join-Path $vault '周记')){Join-Path $vault '周记'}else{[Environment]::GetFolderPath('Desktop')}
if($Mode -eq 'decrypt'){$open.Title='选择需要解密的周记';$open.Filter='加密周记 (*.apexenc)|*.apexenc'}
else{$open.Title='选择需要加密的 Markdown 文件';$open.Filter='Markdown (*.md)|*.md'}
try{if($open.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK){Write-Host '已取消';exit 0};$inputFile=$open.FileName}finally{$open.Dispose()}
$save=[System.Windows.Forms.SaveFileDialog]::new()
$save.OverwritePrompt=$false
$save.AddExtension=$true
if($Mode -eq 'decrypt'){
 $save.Title='选择明文导出位置（请保存在笔记库外）'
 $save.Filter='Markdown (*.md)|*.md';$save.DefaultExt='md'
 $save.InitialDirectory=[Environment]::GetFolderPath('Desktop')
 $save.FileName=[System.IO.Path]::GetFileNameWithoutExtension($inputFile)+'.md'
}else{
 $save.Title='选择加密副本保存位置（原明文会保留）'
 $save.Filter='加密周记 (*.apexenc)|*.apexenc';$save.DefaultExt='apexenc'
 $save.InitialDirectory=[System.IO.Path]::GetDirectoryName($inputFile)
 $save.FileName=[System.IO.Path]::GetFileNameWithoutExtension($inputFile)+'.apexenc'
}
try{
 while($true){
  if($save.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK){Write-Host '已取消';exit 0}
  $outputFile=$save.FileName
  if(Test-Path -LiteralPath $outputFile){[void][System.Windows.Forms.MessageBox]::Show('目标文件已存在，请换一个名称。','不会覆盖原文件');continue}
  break
 }
}finally{$save.Dispose()}
Write-Host ''
if($Mode -eq 'decrypt'){
 Write-Host '请在本窗口输入周记密码，输入时不显示字符。'
 & $node.Source (Join-Path $PSScriptRoot 'decrypt-weekly.mjs') $inputFile --output $outputFile --with-assets
}else{
 Write-Host '正在生成加密副本，原明文文件会保留。'
 $keyring=Join-Path $vault '.apex-weekly-keyring.json'
 if(Test-Path -LiteralPath $keyring){& $node.Source (Join-Path $PSScriptRoot 'encrypt-weekly.mjs') $inputFile --output $outputFile --keyring $keyring}
 else{& $node.Source (Join-Path $PSScriptRoot 'encrypt-weekly.mjs') $inputFile --output $outputFile}
}
if($LASTEXITCODE -ne 0){Write-Host '操作失败，请查看上方原因。';exit 1}
Write-Host '操作完成。'
exit 0
