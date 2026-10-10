// Windows-only transport for the user-enabled Obsidian CLI.
const net=require('node:net'),os=require('node:os'),fs=require('node:fs'),path=require('node:path');
if(process.platform!=='win32')throw Error('Run this helper with Windows node.exe; the plugin runs in Windows Obsidian.');
const args=process.argv.slice(2),output=path.resolve(__dirname,'../test-output');
let argv=args;
if(args[0]==='--eval-file'){
 const script=fs.readFileSync(args[1],'utf8');
 const prefix='globalThis.__apexTestOutputDir='+JSON.stringify(output)+';globalThis.__apexWriteTestReport=async(name,text)=>{const fs=require("fs"),path=require("path");if(path.basename(name)!==name)throw Error("Invalid report name");await fs.promises.mkdir(globalThis.__apexTestOutputDir,{recursive:true});await fs.promises.writeFile(path.join(globalThis.__apexTestOutputDir,name),text,"utf8");};';
 argv=['eval','code='+prefix+script];
}
const socket=net.createConnection('\\\\.\\pipe\\obsidian-cli-'+os.userInfo().username);
socket.setTimeout(60000,()=>{console.error('Obsidian CLI timed out');socket.destroy();process.exitCode=1;});
socket.on('connect',()=>socket.write(JSON.stringify({argv,tty:false,cwd:process.env.APEX_VAULT||process.cwd()})+'\n'));
socket.on('data',data=>process.stdout.write(data));
socket.on('error',error=>{console.error(error.message);process.exitCode=1;});
