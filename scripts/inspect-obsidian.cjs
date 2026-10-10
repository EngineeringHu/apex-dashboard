const fs=require('node:fs');
const path=require('node:path');
const file=process.argv[2], fd=fs.openSync(file,'r'), pre=Buffer.alloc(16);
fs.readSync(fd,pre,0,16,0);const length=pre.readUInt32LE(12), offset=8+pre.readUInt32LE(4);
const header=Buffer.alloc(length);fs.readSync(fd,header,0,length,16);const tree=JSON.parse(header.toString('utf8'));
const files=[];function walk(node,p=''){for(const [name,v] of Object.entries(node.files||{})){const full=p?`${p}/${name}`:name;if(v.files)walk(v,full);else files.push({path:full,...v});}}walk(tree);
if(!process.argv[3])console.log(files.filter(x=>/(^|\/)(main|package|cli)|cli\./i.test(x.path)).map(x=>({path:x.path,size:x.size})));
else {const entry=files.find(x=>x.path===process.argv[3]);if(!entry)throw Error('Entry missing');const data=Buffer.alloc(entry.size);fs.readSync(fd,data,0,entry.size,offset+Number(entry.offset));const out=path.resolve(__dirname,'../test-output/obsidian-'+path.basename(entry.path));fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,data);console.log(out);}
fs.closeSync(fd);
