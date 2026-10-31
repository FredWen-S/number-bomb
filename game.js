import { randomInt, randomBytes } from 'node:crypto';
export class Game {
  constructor({random = (a,b) => randomInt(a,b), now = () => Date.now(), offline = 60000, maxRooms = 500} = {}) { this.rooms = new Map(); this.random = random; this.now = now; this.offline = offline; this.maxRooms = maxRooms; }
  fail(message, gone) { const e = new Error(message); if (gone) e.gone = true; throw e; }
  player(name) { name = String(name || '').trim(); if (!name || name.length > 16) this.fail('昵称需要 1–16 个字符'); return { id: randomBytes(8).toString('hex'), token: randomBytes(24).toString('hex'), name, alive:true, ready:false, wins:0, seen:this.now() }; }
  create(name) { if(this.rooms.size>=this.maxRooms) this.fail('服务器房间已满，请稍后再试'); const p=this.player(name); let code; do {code=randomBytes(3).toString('hex').toUpperCase()} while(this.rooms.has(code)); const r={code,host:p.id,players:[p],phase:'lobby',round:0,low:1,high:100,version:1,log:[],updated:this.now(),deadline:null}; this.rooms.set(code,r); return {r,p}; }
  room(code) { const r=this.rooms.get(String(code||'').toUpperCase()); if(!r) this.fail('找不到房间，请检查房间码', true); return r; }
  auth(r,token) { const p=r.players.find(p=>p.token===token); if(!p) this.fail('你已不在这个房间，请重新加入', true); p.seen=this.now(); return p; }
  seen(r,id) { const p=r.players.find(p=>p.id===id); if(p) p.seen=this.now(); }
  online(p) { return this.now()-p.seen<=this.offline; }
  remove(r,id) { r.players=r.players.filter(x=>x.id!==id); if(r.host===id) r.host=r.players[0]?.id||null; if(!r.players.length) this.rooms.delete(r.code); }
  // Lobby: drop players who went offline so they cannot block the start. Game over: hand host to someone still here.
  presence(r) { if(r.phase==='lobby'){const gone=r.players.filter(p=>!this.online(p));if(!gone.length)return false;gone.forEach(p=>this.remove(r,p.id));return true;}
    if(r.phase==='gameover'){const host=r.players.find(p=>p.id===r.host),next=r.players.find(p=>this.online(p));if(!host||this.online(host)||!next)return false;r.host=next.id;return true;}
    return false; }
  touch(r) {r.version++;r.updated=this.now();}
  join(code,name) {const r=this.room(code); if(r.phase!=='lobby') this.fail('游戏已经开始，请等待下一局'); if(r.players.length>=8) this.fail('房间已满'); const p=this.player(name); r.players.push(p);this.touch(r);return {r,p};}
  nextRound(r) {r.round++;r.low=1;r.high=100;r.bomb=this.random(1,101);r.turn=r.players.find(p=>p.alive).id;r.phase='playing';r.deadline=this.now()+30000;}
  action(code,token,type,value,version) {const r=this.room(code),p=this.auth(r,token);if(version!==r.version)this.fail('状态已更新，请重试');
    if(type==='ready') {if(r.phase!=='lobby')this.fail('当前不能准备');p.ready=!p.ready;}
    else if(type==='start') {if(p.id!==r.host||r.phase!=='lobby')this.fail('只有房主能开始');if(r.players.length<2||!r.players.every(p=>p.ready))this.fail('至少两人且全员准备后才能开始');r.players.forEach(p=>p.alive=true);r.round=0;r.log=[];r.winner=null;this.nextRound(r);}
    else if(type==='guess') {if(r.phase!=='playing'||r.turn!==p.id)this.fail('还没轮到你');if(this.now()>=r.deadline)this.fail('本回合已超时');if(!Number.isInteger(value)||value<r.low||value>r.high)this.fail(`请输入 ${r.low}–${r.high} 之间的整数`);this.resolve(r,p,value);}
    else if(type==='leave') {if(r.phase!=='lobby'&&r.phase!=='gameover')this.fail('游戏中请等待本局结束后离开');this.remove(r,p.id);}
    else if(type==='restart') {if(p.id!==r.host||r.phase!=='gameover')this.fail('只有房主能在结束后重新开局');r.phase='lobby';r.players.forEach(p=>{p.ready=false;p.alive=true});r.log=[];r.result=null;r.deadline=null;}
    else this.fail('未知操作');this.touch(r);return r;
  }
  resolve(r,p,n) {const hit=n===r.bomb; if(hit)p.alive=false;else if(n!==null&&n<r.bomb)r.low=n+1;else if(n!==null)r.high=n-1;r.result={player:p.name,number:n,hit,bomb:hit?r.bomb:null,timeout:n===null};r.log.unshift({...r.result,round:r.round});r.log=r.log.slice(0,40);r.phase='resolving';r.deadline=this.now()+2200;}
  tick(r) {if(this.presence(r)){this.touch(r);return true;}if(!r.deadline||this.now()<r.deadline)return false;
    if(r.phase==='playing'){const p=r.players.find(p=>p.id===r.turn);p.alive=false;this.resolve(r,p,null);r.result.hit=true;r.result.bomb=r.bomb;r.log[0]={...r.result,round:r.round};}
    else if(r.phase==='resolving'){const alive=r.players.filter(p=>p.alive);if(alive.length===1){r.phase='gameover';r.winner=alive[0].id;alive[0].wins++;r.deadline=null;}
      else if(r.result.hit)this.nextRound(r);
      else {const i=r.players.findIndex(p=>p.id===r.turn);for(let k=1;k<=r.players.length;k++){const p=r.players[(i+k)%r.players.length];if(p.alive){r.turn=p.id;break}}r.phase='playing';r.deadline=this.now()+30000;}}
    else return false;this.touch(r);return true;
  }
  view(r) {const {bomb,...rest}=r;return {...rest,serverTime:this.now(),players:r.players.map(({token,seen,...p})=>({...p,online:this.online({seen})}))};}
}

