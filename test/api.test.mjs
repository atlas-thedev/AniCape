import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {deflateSync} from 'node:zlib';import {createApp,validateFiles} from '../server/server.mjs';
const require=createRequire(import.meta.url),{GifWriter}=require('../libs/omggif.js');
function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);let crc=0xffffffff;for(const x of b.subarray(4,-4)){crc^=x;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(64);ihdr.writeUInt32BE(32,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc((64*4+1)*32))),chunk('IEND',Buffer.alloc(0))]);
const gb=Buffer.alloc(500000),gw=new GifWriter(gb,320,320,{palette:[0,0xffffff],loop:0});gw.addFrame(0,0,320,320,new Uint8Array(320*320),{delay:5});const gif=gb.subarray(0,gw.end());
test('real PNG/GIF binary validation rejects corruption and dimension mismatch',()=>{validateFiles(png,gif,{width:64,frameHeight:32,frames:1,fps:0});assert.throws(()=>validateFiles(png,gif,{width:128,frameHeight:64,frames:1,fps:0}));const bad=Buffer.from(png);bad[40]^=1;assert.throws(()=>validateFiles(bad,gif,{width:64,frameHeight:32,frames:1,fps:0}));assert.throws(()=>validateFiles(png,Buffer.from('GIF89a'),{width:64,frameHeight:32,frames:1,fps:0}));});
test('verified ticket → upload → bot claim → confirmed Discord link; auth/CSRF/idempotency/close/results/persistence',async()=>{
 const data=await mkdtemp(path.join(os.tmpdir(),'native-contest-'));let server=await createApp({dataDir:data,key:'test-secret',origin:'https://test.native'});await new Promise(r=>server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+server.address().port;
 const call=async(p,b,headers={})=>{const r=await fetch(base+p,{method:b===undefined?'GET':'POST',headers:{...(b===undefined?{}:{'Content-Type':'application/json'}),...headers},body:b===undefined?undefined:JSON.stringify(b)});return {r,b:await r.json()};},bot={Authorization:'Bearer test-secret'};
 try{
 assert.equal((await call('/api/bot/tickets',{discord_user_id:'123456789012345678'})).r.status,401);
 assert.equal((await call('/server/server.mjs')).r.status,404);
 let {b:t}=await call('/api/bot/tickets',{discord_user_id:'123456789012345678'},bot);const ticket=new URL(t.entry_url).hash.slice('#entry_ticket='.length);
 assert.equal((await call('/api/session',{ticket},{Origin:'https://evil.test'})).r.status,403);
 const login=await call('/api/session',{ticket},{Origin:'https://test.native'}),cookie=login.r.headers.get('set-cookie').split(';')[0];assert.equal(login.r.status,200);assert.equal((await call('/api/session',{ticket},{Origin:'https://test.native'})).r.status,401);
 const upload=async(key='abcdefghijklmnop',title='Native entry')=>{const f=new FormData();for(const [k,v] of Object.entries({entry_name:title,frame_count:'1',fps:'0',width:'64',frame_height:'32'}))f.set(k,v);f.set('cape_texture',new Blob([png]),'cape.png');f.set('preview_gif',new Blob([gif]),'model-preview.gif');const r=await fetch(base+'/api/entries',{method:'POST',headers:{Origin:'https://test.native',Cookie:cookie,'Idempotency-Key':key},body:f});return {r,b:await r.json()};};
 const a=await upload();assert.equal(a.r.status,202);assert.equal(a.b.status,'pending');assert.equal(a.b.message_url,null);const id=a.b.entry_id;
 assert.equal((await upload()).b.entry_id,id);assert.equal((await upload('abcdefghijklmnop','other')).r.status,409);
 assert.equal((await call('/api/bot/entries/'+id+'/complete',{message_id:'123456789012345678',channel_id:'234567890123456789',guild_id:'345678901234567890'},bot)).r.status,409);
 assert.equal((await call('/api/bot/entries/'+id+'/claim',{},bot)).b.status,'processing');assert.equal((await call('/api/bot/entries/'+id+'/claim',{},bot)).r.status,409);
 assert.equal((await fetch(base+a.b.files.cape_texture,{headers:bot})).status,200);
 const completed=await call('/api/bot/entries/'+id+'/complete',{message_id:'123456789012345678',channel_id:'234567890123456789',guild_id:'345678901234567890'},bot);assert.equal(completed.b.status,'submitted');assert.match(completed.b.message_url,/discord.com\/channels\//);
 await call('/api/bot/event',{action:'close'},bot);assert.equal((await upload('anotherunique123456')).r.status,410);assert.equal((await fetch(base+'/')).status,410);
 assert.equal((await call('/api/bot/event',{action:'results',votes:[]},bot)).r.status,409);
 const results=await call('/api/bot/event',{action:'results',votes:[{entry_id:id,votes:3}]},bot);assert.deepEqual(results.b.results.winners,[id]);assert.equal((await call('/api/bot/event',{action:'results',votes:[{entry_id:id,votes:4}]},bot)).r.status,409);
 await new Promise(r=>server.close(r));server=await createApp({dataDir:data,key:'test-secret',origin:'https://test.native'});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;assert.equal((await call('/api/bot/event',undefined,bot)).b.open,false);assert.equal((await call('/api/session',undefined,{Cookie:cookie})).r.status,200);
 }finally{await new Promise(r=>server.close(r));await rm(data,{recursive:true,force:true});}
});
