param([string]$ProjectRoot,[string]$ToolsRoot)
$ErrorActionPreference='Stop'
$before=Get-ExecutionPolicy -List|ConvertTo-Json -Compress
$oldProcessPolicy=$env:PSExecutionPolicyPreference
$testRoot=Join-Path $env:TEMP ('apex-policy-test 中文 '+[guid]::NewGuid())
[void][System.IO.Directory]::CreateDirectory($testRoot)
$stub=@'
param([string]$Mode)
$value=@{mode=$Mode;policy=(Get-ExecutionPolicy -Scope Process).ToString()}|ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'result.json'),$value)
'@
$script=Join-Path $testRoot 'weekly-file-dialog.ps1'
[System.IO.File]::WriteAllText($script,$stub,[System.Text.UTF8Encoding]::new($true))
$checks=@()
try{
 $env:PSExecutionPolicyPreference='Restricted'
 $old=Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -File "'+$script+'" -Mode encrypt') -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $testRoot 'old-out.txt') -RedirectStandardError (Join-Path $testRoot 'old-error.txt')
 if($old.ExitCode -eq 0 -or (Test-Path -LiteralPath (Join-Path $testRoot 'result.json'))){throw 'Did not reproduce Restricted policy block'}
 $checks+='Original launch fails with inherited Restricted policy'
 foreach($entry in @(@('加密周记.bat','encrypt'),@('解密周记.bat','decrypt'))){
  $bat=Join-Path $testRoot $entry[0]
  Copy-Item -LiteralPath (Join-Path $ToolsRoot $entry[0]) -Destination $bat
  $process=Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /c call "'+$bat+'" < NUL') -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $testRoot ($entry[1]+'-out.txt')) -RedirectStandardError (Join-Path $testRoot ($entry[1]+'-error.txt'))
  if($process.ExitCode -ne 0){throw ('Fixed BAT failed: '+$entry[0])}
  $result=Get-Content -LiteralPath (Join-Path $testRoot 'result.json') -Raw|ConvertFrom-Json
  if($result.mode -ne $entry[1] -or $result.policy -ne 'Bypass'){throw 'Wrong mode or process policy'}
  Remove-Item -LiteralPath (Join-Path $testRoot 'result.json')
  $checks+=($entry[1]+' BAT works under Restricted policy using process-only Bypass')
 }
 $real=Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -STA -File "'+(Join-Path $ToolsRoot 'weekly-file-dialog.ps1')+'" -Mode invalid-test-mode') -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $testRoot 'real-out.txt') -RedirectStandardError (Join-Path $testRoot 'real-error.txt')
 $message=[System.IO.File]::ReadAllText((Join-Path $testRoot 'real-error.txt'))
 if($real.ExitCode -eq 0 -or $message -match 'PSSecurityException|UnauthorizedAccess' -or $message -notmatch 'ParameterBindingValidationException|ParameterArgumentValidationError'){throw ('Real helper validation failed: '+$message)}
 $checks+='Real helper loads and validates arguments without execution policy error'
}finally{
 if($null -eq $oldProcessPolicy){Remove-Item Env:PSExecutionPolicyPreference -ErrorAction SilentlyContinue}else{$env:PSExecutionPolicyPreference=$oldProcessPolicy}
 $resolved=[System.IO.Path]::GetFullPath($testRoot)
 $allowed=[System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
 if(!$resolved.StartsWith($allowed,[System.StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetFileName($resolved) -notlike 'apex-policy-test*'){throw 'Unsafe cleanup path'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}
$after=Get-ExecutionPolicy -List|ConvertTo-Json -Compress
if($before -ne $after){throw 'Execution policy changed outside test children'}
$checks+='Caller, user and system execution-policy scopes unchanged'
foreach($name in @('加密周记.bat','解密周记.bat')){
 if((Get-FileHash -LiteralPath (Join-Path $ProjectRoot ('tools/'+$name))).Hash -ne (Get-FileHash -LiteralPath (Join-Path $ToolsRoot $name)).Hash){throw 'Source/deployed BAT mismatch'}
}
$report=@{passed=$true;checks=$checks;finished=[DateTime]::UtcNow.ToString('o')}
[System.IO.File]::WriteAllText((Join-Path $ProjectRoot 'test-output/bat-execution-policy.json'),($report|ConvertTo-Json -Depth 5),[System.Text.UTF8Encoding]::new($false))
$report|ConvertTo-Json -Depth 5
