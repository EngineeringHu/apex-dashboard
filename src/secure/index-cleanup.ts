import { TFile, type App } from 'obsidian';

/** Suppress late Dataview writes only for Markdown being removed by a mode change. */
export class ProtectedIndexCleanup {
  private restore:(()=>void)|null=null;
  private pending=new Set<Promise<unknown>>();
  constructor(private app:App,private paths:Set<string>){}
  install():void{
    if(this.restore)return;
    const dv=(this.app as any).plugins?.plugins?.dataview;if(!dv)return;
    if(dv.manifest?.version!=='0.5.68'||typeof dv.index?.persister?.storeFile!=='function'||typeof dv.index?.finish!=='function')throw Error('此 Dataview 版本的加密后缓存清理尚未验证，请停用 Dataview 后再开启加密');
    const index=dv.index,storage=index.persister,store=storage.storeFile,finish=index.finish,self=this;
    storage.storeFile=function(path:string,...args:any[]){if(self.paths.has(path))return Promise.resolve();const p=Promise.resolve(store.apply(this,[path,...args]));self.pending.add(p);void p.finally(()=>self.pending.delete(p)).catch(()=>{});return p;};
    index.finish=function(file:TFile,...args:any[]){if(self.paths.has(file.path))return;return finish.apply(this,[file,...args]);};
    this.restore=()=>{storage.storeFile=store;index.finish=finish;};
  }
  async clean():Promise<void>{
    const dv=(this.app as any).plugins?.plugins?.dataview;if(!dv)return;
    const index=dv.index,storage=index?.persister?.persister;if(!storage)throw Error('Dataview 缓存清理未完成');
    await Promise.allSettled([...this.pending]);
    for(const path of this.paths){index.pages.delete(path);index.tags.delete(path);index.etags.delete(path);index.links.delete(path);await storage.removeItem('file:'+path);}
    index.touch();
  }
  unload():void{this.restore?.();this.restore=null;}
}
