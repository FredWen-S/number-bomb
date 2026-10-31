import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Game} from './game.js';
export const game=new Game();
const clients=new Map(),hits=new Map(),MAX_STREAMS=24;
// Players who left or were dropped lose their stream; everyone else gets the new state.
function broadcast(r){const data=`data: ${JSON.stringify(game.view(r))}\n\n`,set=clients.get(r.code);if(!set)return;for(const c of set){if(game.rooms.has(r.code)&&r.players.some(p=>p.id===c.id))c.res.write(data);else{c.res.end();set.delete(c);}}if(!set.size)clients.delete(r.code);}
// Fixed-window limit per client IP and bucket; returns true when the request should be refused.
function limited(ip,bucket,max,ms){const key=bucket+' '+ip,now=Date.now();let h=hits.get(key);if(!h||now>h.reset)hits.set(key,h={n:0,reset:now+ms});return ++h.n>max;}
const ipOf=req=>String(req.headers['cf-connecting-ip']||req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
export const server=http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
try {
 const url=new URL(req.url,'http://localhost'),ip=ipOf(req);
 if(req.method==='GET'&&url.pathname==='/healthz'){res.end('ok');return;}
 if(req.method==='GET'&&files[url.pathname]){const [file,type]=files[url.pathname];res.setHeader('Content-Type',type);res.end(await readFile(new URL('./public/'+file,import.meta.url)));return;}
 if(req.method==='GET'&&url.pathname==='/api/events'){if(limited(ip,'events',60,60000))throw Error('连接过于频繁，请稍后再试');const r=game.room(url.searchParams.get('code')),p=game.auth(r,url.searchParams.get('token'));if(!clients.has(r.code))clients.set(r.code,new Set());const set=clients.get(r.code);if(set.size>=MAX_STREAMS)throw Error('房间连接数已满');res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});const c={res,id:p.id};set.add(c);res.write(`data: ${JSON.stringify(game.view(r))}\n\n`);const heartbeat=setInterval(()=>res.write('event: ping\ndata: 1\n\n'),10000);req.on('close',()=>{clearInterval(heartbeat);set.delete(c)});return;}
 if(req.method==='POST'&&url.pathname==='/api/game'){if(req.headers.origin&&req.headers.origin!==`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`)throw Error('请求来源不匹配');if(limited(ip,'api',120,10000))throw Error('操作过于频繁，请稍后再试');let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('请求太大');}const b=JSON.parse(body);if(b.type==='create'&&limited(ip,'create',15,600000))throw Error('创建房间过于频繁，请稍后再试');let r,p;if(b.type==='create')({r,p}=game.create(b.name));else if(b.type==='join')({r,p}=game.join(b.code,b.name));else if(b.type==='resume'){r=game.room(b.code);p=game.auth(r,b.token);}else r=game.action(b.code,b.token,b.type,b.value,b.version);if(b.type!=='resume')broadcast(r);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:game.view(r),...(p?{playerId:p.id,token:p.token}:{})}));return;}
 res.writeHead(404);res.end('Not found');
}catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message,...(e.gone?{gone:true}:{})}));}});
setInterval(()=>{for(const r of game.rooms.values()){for(const c of clients.get(r.code)||[])game.seen(r,c.id);if(game.tick(r))broadcast(r);if(Date.now()-r.updated>6*3600000){for(const c of clients.get(r.code)||[])c.res.end();clients.delete(r.code);game.rooms.delete(r.code);}}},200).unref();
setInterval(()=>{const now=Date.now();for(const [k,h] of hits)if(now>h.reset)hits.delete(k);},60000).unref();
if(process.argv[1]===fileURLToPath(import.meta.url)){server.listen(Number(process.env.PORT||4317),'0.0.0.0',()=>console.log('Number Bomb ready: http://localhost:'+(process.env.PORT||4317)));
 for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});}
