import http from 'node:http';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{GifReader}=require('../libs/omggif.js');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function validateFiles(png,gif,meta){
 if(!Number.isInteger(meta.frames)||meta.frames<1||meta.frames>240||!Number.isInteger(meta.fps)||(meta.frames===1?meta.fps!==0:meta.fps<1||meta.fps>30))fail(400,'Invalid frame count or FPS');
 if(png.length>8*1024*1024||gif.length>8*1024*1024)fail(413,'Each Discord attachment must be under 8 MiB');
 if(png.length<45||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.toString('ascii',12,16)!=='IHDR')fail(400,'Invalid PNG');
 const w=png.readUInt32BE(16),h=png.readUInt32BE(20);
 if(!Number.isInteger(meta.width)||!Number.isInteger(meta.frameHeight)||w!==meta.width||h!==meta.frameHeight*meta.frames||w<64||w>2048||w!==meta.frameHeight*2||h>32768||w*h>33554432)fail(400,'PNG dimensions do not match the cape metadata');
 // Validate chunk boundaries and CRCs. Never decompress untrusted PNGs on the API thread.
 let at=8,ended=false,idat=false;
 while(at<png.length){if(at+12>png.length)fail(400,'Truncated PNG');const n=png.readUInt32BE(at);if(n>png.length-at-12)fail(400,'Truncated PNG chunk');const kind=png.toString('ascii',at+4,at+8);let crc=0xffffffff;for(const b of png.subarray(at+4,at+8+n)){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}if(((crc^0xffffffff)>>>0)!==png.readUInt32BE(at+8+n))fail(400,'PNG checksum failed');if(kind==='IDAT')idat=true;at+=12+n;if(kind==='IEND'){ended=true;break;}}
 if(!ended||!idat||at!==png.length)fail(400,'Invalid PNG structure');
 try{const g=new GifReader(gif);if(g.width!==320||g.height!==320||g.numFrames()<1||g.numFrames()>100)fail(400,'Preview must be a 320×320 GIF with at most 100 frames');const pixels=new Uint8Array(320*320*4);for(let i=0;i<g.numFrames();i++)g.decodeAndBlitFrameRGBA(i,pixels);}catch(e){if(e.status)throw e;fail(400,'Invalid preview GIF');}
}
export async function createApp(options={}){
 const data=options.dataDir||process.env.DATA_DIR||'/var/lib/native-cape-contest',key=options.key||process.env.BOT_API_KEY||'',origin=options.origin||process.env.SITE_ORIGIN||'';
 await mkdir(path.join(data,'files'),{recursive:true,mode:0o700});
 let db;try{db=JSON.parse(await readFile(path.join(data,'state.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;db={open:true,entries:[],tickets:[],sessions:[],results:null};}
 const save=async()=>{const tmp=path.join(data,'state.tmp');await writeFile(tmp,JSON.stringify(db),{mode:0o600});await rename(tmp,path.join(data,'state.json'));};
 // Serialize mutations to keep idempotency, ticket consumption, and disk writes atomic in one process.
 let chain=Promise.resolve();const locked=fn=>{const run=chain.then(fn);chain=run.catch(()=>{});return run;};
 const auth=req=>{const got=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,'')),want=Buffer.from(key);if(!key||got.length!==want.length||!timingSafeEqual(got,want))fail(401,'Unauthorized');};
 const session=req=>{const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('native_entry='))?.slice(13);const s=token&&db.sessions.find(s=>s.hash===hash(token)&&s.expires>Date.now());if(!s)fail(401,'Open your personal entry link from the Native Discord bot first');return s;};
 const sameOrigin=req=>{if(req.headers.origin!==origin)fail(403,'Invalid request origin');};
 async function body(req,limit=65536){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>limit)fail(413,'Upload too large');parts.push(chunk);}return Buffer.concat(parts);}
 const json=async req=>{try{return JSON.parse((await body(req)).toString());}catch(e){if(e.status)throw e;fail(400,'Invalid JSON');}};
 const publicEntry=e=>({entry_id:e.id,entry_name:e.title,discord_user_id:e.user,frames:e.frames,fps:e.fps,width:e.width,frameHeight:e.frameHeight,status:e.status,created_at:e.createdAt,nonce:e.nonce,message_id:e.messageId||null,message_url:e.messageUrl||null,files:{cape_texture:`/api/bot/entries/${e.id}/files/texture`,preview_gif:`/api/bot/entries/${e.id}/files/preview`}});
 const respond=(res,status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(value));};
 const handler=async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost'),p=u.pathname,method=req.method;
  if(p.startsWith('/api/bot/'))auth(req);
  if(p==='/health')return respond(res,200,{ok:true});
  if(p==='/api/event'&&method==='GET')return respond(res,200,{open:db.open,integration:'existing-native-bot',results:db.results});
  if(p==='/api/bot/tickets'&&method==='POST'){const b=await json(req);return await locked(async()=>{if(!db.open)fail(410,'Contest closed');if(!/^\d{17,20}$/.test(b.discord_user_id||''))fail(400,'Verified Discord user ID required');if(db.tickets.filter(t=>t.expires>Date.now()).length>2000)fail(429,'Too many active entry links');const token=randomBytes(32).toString('base64url');db.tickets=db.tickets.filter(t=>t.expires>Date.now());db.tickets.push({hash:hash(token),user:b.discord_user_id,expires:Date.now()+600000});await save();respond(res,201,{entry_url:`${origin}/#entry_ticket=${token}`,expires_in:600});});}
  if(p==='/api/session'&&method==='POST'){sameOrigin(req);const b=await json(req);if(typeof b.ticket!=='string'||b.ticket.length>100)fail(400,'Invalid entry link');return await locked(async()=>{const at=db.tickets.findIndex(t=>t.hash===hash(b.ticket)&&t.expires>Date.now());if(at<0)fail(401,'Entry link expired or already used');const [t]=db.tickets.splice(at,1),token=randomBytes(32).toString('base64url');db.sessions=db.sessions.filter(s=>s.expires>Date.now());db.sessions.push({hash:hash(token),user:t.user,expires:Date.now()+86400000});await save();respond(res,200,{discord_user_id:t.user},{'Set-Cookie':`native_entry=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=86400${origin.startsWith('https:')?'; Secure':''}`});});}
  if(p==='/api/session'&&method==='GET'){return respond(res,200,{discord_user_id:session(req).user});}
  if(p==='/api/entries'&&method==='POST'){
   sameOrigin(req);const s=session(req);if(!db.open)fail(410,'Contest closed');const idkey=req.headers['idempotency-key'];if(!/^[a-zA-Z0-9_-]{16,80}$/.test(idkey||''))fail(400,'Idempotency-Key required');
   const raw=await body(req,17*1024*1024);let form;try{form=await new Request('http://localhost',{method:'POST',headers:{'Content-Type':req.headers['content-type']||''},body:raw}).formData();}catch{fail(400,'Invalid multipart form');}
   const title=form.get('entry_name'),texture=form.get('cape_texture'),preview=form.get('preview_gif');if(typeof title!=='string'||!title.trim()||title.trim().length>64||!texture?.arrayBuffer||!preview?.arrayBuffer)fail(400,'Entry name, cape texture and model GIF required');
   const meta={frames:Number(form.get('frame_count')),fps:Number(form.get('fps')),width:Number(form.get('width')),frameHeight:Number(form.get('frame_height'))};const png=Buffer.from(await texture.arrayBuffer()),gif=Buffer.from(await preview.arrayBuffer());validateFiles(png,gif,meta);
   return await locked(async()=>{if(!db.open)fail(410,'Contest closed');const digest=hash(Buffer.concat([Buffer.from(JSON.stringify({title:title.trim(),...meta})),png,gif]));const existing=db.entries.find(e=>e.user===s.user&&e.key===idkey);if(existing){if(existing.digest!==digest)fail(409,'This submission key was already used for another entry');return respond(res,200,publicEntry(existing));}
    if(db.entries.filter(e=>e.user===s.user&&Date.now()-Date.parse(e.createdAt)<3600000).length>=5)fail(429,'Maximum five entries per hour');
    const id=randomUUID(),dir=path.join(data,'files',id);await mkdir(dir,{mode:0o700});await writeFile(path.join(dir,'texture.png'),png,{mode:0o600});await writeFile(path.join(dir,'preview.gif'),gif,{mode:0o600});const e={id,title:title.trim(),user:s.user,key:idkey,digest,...meta,status:'pending',nonce:hash(id).slice(0,24),createdAt:new Date().toISOString()};db.entries.push(e);await save();respond(res,202,publicEntry(e));});
  }
  const own=p.match(/^\/api\/entries\/([a-f0-9-]{36})$/);if(own&&method==='GET'){const s=session(req),e=db.entries.find(e=>e.id===own[1]&&e.user===s.user);if(!e)fail(404,'Entry not found');return respond(res,200,publicEntry(e));}
  if(p==='/api/bot/entries'&&method==='GET'){const status=u.searchParams.get('status')||'pending';if(!['pending','processing','submitted','failed'].includes(status))fail(400,'Invalid status');return respond(res,200,{entries:db.entries.slice(u.searchParams.get('after')?db.entries.findIndex(e=>e.id===u.searchParams.get('after'))+1:0).filter(e=>e.status===status).slice(0,100).map(publicEntry)});}
  const m=p.match(/^\/api\/bot\/entries\/([a-f0-9-]{36})\/(claim|complete|retry|files\/(texture|preview))$/);
  if(m){const e=db.entries.find(e=>e.id===m[1]);if(!e)fail(404,'Entry not found');if(m[3]&&method==='GET'){const content=await readFile(path.join(data,'files',e.id,m[3]==='texture'?'texture.png':'preview.gif'));res.writeHead(200,{'Content-Type':m[3]==='texture'?'image/png':'image/gif','Cache-Control':'no-store','Content-Disposition':`attachment; filename="${m[3]==='texture'?(e.frames>1?'cape-strip.png':'cape.png'):'model-preview.gif'}"`});return res.end(content);}
   if(method==='POST'){const b=await json(req);return await locked(async()=>{if(m[2]==='claim'){if(!db.open)fail(410,'Contest closed');if(e.status!=='pending')fail(409,'Entry already claimed; reconcile its Discord nonce before retrying');e.status='processing';}
    if(m[2]==='complete'){if(!/^\d{17,20}$/.test(b.message_id||'')||!/^\d{17,20}$/.test(b.channel_id||'')||!/^\d{17,20}$/.test(b.guild_id||''))fail(400,'Actual Discord message, channel and guild IDs required');if(e.status==='submitted'&&e.messageId!==b.message_id)fail(409,'Entry already submitted');if(!['processing','submitted'].includes(e.status))fail(409,'Claim entry before completion');e.status='submitted';e.messageId=b.message_id;e.messageUrl=`https://discord.com/channels/${b.guild_id}/${b.channel_id}/${b.message_id}`;e.submittedAt=new Date().toISOString();}
    if(m[2]==='retry'){if(!db.open)fail(410,'Contest closed');if(e.status!=='processing'||b.confirm_no_discord_post!==true)fail(409,'Reconcile Discord first and explicitly confirm no post exists');e.status='pending';}
    await save();respond(res,200,publicEntry(e));});}
  }
  if(p==='/api/bot/event'&&method==='GET')return respond(res,200,{open:db.open,results:db.results,total:db.entries.length});
  if(p==='/api/bot/event'&&method==='POST'){const b=await json(req);return await locked(async()=>{if(b.action==='close'){db.open=false;for(const e of db.entries)if(e.status==='pending')e.status='failed';}else if(b.action==='open'){db.open=true;db.results=null;}else if(b.action==='results'){if(db.open)fail(409,'Close submissions before saving the final vote snapshot');if(db.results)fail(409,'Final results already frozen');if(!Array.isArray(b.votes)||b.votes.length>10000)fail(400,'Vote snapshot required');const seen=new Set();for(const v of b.votes){if(!db.entries.some(e=>e.id===v.entry_id&&e.status==='submitted')||seen.has(v.entry_id)||!Number.isInteger(v.votes)||v.votes<0)fail(400,'Invalid vote snapshot');seen.add(v.entry_id);}if(db.entries.filter(e=>e.status==='submitted').length!==b.votes.length||db.entries.some(e=>e.status==='processing'))fail(409,'Reconcile processing entries and include every submitted entry');const max=Math.max(0,...b.votes.map(v=>v.votes));db.results={captured_at:new Date().toISOString(),votes:b.votes,winners:max>0?b.votes.filter(v=>v.votes===max).map(v=>v.entry_id):[],highest_votes:max};}else fail(400,'Unknown action');await save();respond(res,200,{open:db.open,results:db.results});});}
  if(p.startsWith('/api/'))fail(404,'Unknown API route');
  if(method!=='GET'&&method!=='HEAD')fail(405,'Method not allowed');
  if(!db.open&&(p==='/'||p==='/index.html')){res.writeHead(410,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(path.join(root,'closed.html')));}
  const relative=p==='/'?'index.html':decodeURIComponent(p).slice(1);if(relative.includes('..')||!(/^(assets|css|libs|src)\//.test(relative)||['index.html','config.json','LICENSE','robots.txt','sw.js'].includes(relative))||!/[.](html|js|json|css|svg|png|jpg|gif|wasm|txt)$/.test(relative)&&relative!=='LICENSE')fail(404,'Not found');
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))fail(404,'Not found');let content;try{content=await readFile(file);}catch{fail(404,'Not found');}const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm','.gif':'image/gif','.jpg':'image/jpeg'}[path.extname(file)]||'text/plain';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});res.end(method==='HEAD'?undefined:content);
 }catch(e){if(!res.headersSent)respond(res,e.status||500,{error:e.status?e.message:'Server error'});else res.end();if(!e.status)console.error('API error',e.code||e.name);}};
 return http.createServer(handler);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(!process.env.BOT_API_KEY||!process.env.SITE_ORIGIN)throw new Error('BOT_API_KEY and SITE_ORIGIN are required');const app=await createApp();app.listen(Number(process.env.PORT||3426),'127.0.0.1',()=>console.log('Native contest listening on loopback'));}
