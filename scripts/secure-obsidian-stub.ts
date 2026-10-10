export class Notice {constructor(public message:string){} }
export class TFile {extension:string;basename:string;name:string;parent:any;stat={mtime:1,size:0};constructor(public path:string){this.name=path.split('/').pop()!;this.extension=this.name.split('.').pop()!;this.basename=this.name.slice(0,-this.extension.length-1);this.parent={path:path.split('/').slice(0,-1).join('/')};}}
export class FileSystemAdapter {}
export class MarkdownView {file:TFile|null=null;async save(){}}
export class Modal {contentEl:any;titleEl:any;constructor(public app:any){}open(){}close(){}}
export class SuggestModal extends Modal {}
export class Plugin {}
export class Component {load(){}unload(){}addChild<T>(x:T):T{return x;}}
export function setIcon(){}
export const Platform={isDesktop:true,isMobile:false};
export type App=any;
