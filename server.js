// Multiplayer Casino Server – Spielgeld only. Start: npm install && npm start
const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000, DBF=path.join(__dirname,'players.json');
let db={}; try{db=JSON.parse(fs.readFileSync(DBF))}catch{}
const save=()=>fs.writeFile(DBF,JSON.stringify(db),()=>{});
const rnd=n=>Math.floor(Math.random()*n);
const srv=http.createServer((q,r)=>fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(d)}));
const wss=new WebSocketServer({server:srv});
const send=(ws,o)=>ws.readyState===1&&ws.send(JSON.stringify(o));
const all=o=>wss.clients.forEach(c=>send(c,o));
const bal=ws=>send(ws,{t:'bal',v:db[ws.tk].bal});
const lb=()=>all({t:'lb',online:[...wss.clients].filter(c=>c.tk).length,top:Object.values(db).sort((a,b)=>b.bal-a.bal).slice(0,10).map(p=>({n:p.name,b:p.bal}))});

// ---------- Slots ----------
const SYM=['🍒','🍋','🔔','⭐','7️⃣','💎'], MULT=[5,8,10,15,25,50];
function slots(){const r=[rnd(6),rnd(6),rnd(6)];let m=0;
  if(r[0]===r[1]&&r[1]===r[2])m=MULT[r[0]];
  else if(r[0]===r[1]||r[1]===r[2]||r[0]===r[2])m=1;
  return{reels:r.map(i=>SYM[i]),m}}

// ---------- Rubbellos ----------
const PR=[5,10,20,50,100,500],PW=[40,30,15,10,4,1];
function scratch(){const cnt={},cells=[];
  const add=p=>{cnt[p]=(cnt[p]||0)+1;cells.push(p)};
  let win=0;
  if(Math.random()<0.35){let x=rnd(100),i=0;while(x>=PW[i]){x-=PW[i];i++}win=PR[i];for(let k=0;k<3;k++)add(win)}
  while(cells.length<6){const p=PR[rnd(6)];if((cnt[p]||0)<2)add(p)}
  for(let i=5;i>0;i--){const j=rnd(i+1);[cells[i],cells[j]]=[cells[j],cells[i]]}
  return{cells,win}}

// ---------- Blackjack ----------
const deck=()=>{const d=[];for(const s of '♠♥♦♣')for(const r of ['A',2,3,4,5,6,7,8,9,10,'J','Q','K'])d.push(r+s);return d.sort(()=>Math.random()-.5)};
const val=h=>{let v=0,a=0;for(const c of h){const r=c.slice(0,-1);if(r==='A'){a++;v+=11}else v+=isNaN(r)?10:+r}while(v>21&&a--)v-=10;return v};
function bjSend(ws,over,msg){const g=ws.bj;send(ws,{t:'bj',p:g.p,d:over?g.d:[g.d[0],'??'],pv:val(g.p),dv:over?val(g.d):null,over,msg})}
function bjEnd(ws,res){const g=ws.bj,p=db[ws.tk];let msg;
  if(res==='bj'){p.bal+=Math.floor(g.bet*2.5);msg='Blackjack! 3:2 💰'}
  else if(res==='win'){p.bal+=g.bet*2;msg='Gewonnen! 🎉'}
  else if(res==='push'){p.bal+=g.bet;msg='Unentschieden – Einsatz zurück'}
  else msg='Verloren 😢';
  ws.bj=null;bal(ws);bjSend(Object.assign(ws,{bj:g}),true,msg);ws.bj=null;save();lb()}
function dealerPlay(ws){const g=ws.bj;while(val(g.d)<17)g.d.push(g.k.pop());
  const pv=val(g.p),dv=val(g.d);bjEnd(ws,dv>21||pv>dv?'win':pv===dv?'push':'lose')}

// ---------- Roulette (gemeinsamer Tisch) ----------
const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
let bets=[],hist=[],next=Date.now()+30000;
const rstate=()=>({next,hist,players:new Set(bets.map(b=>b.tk)).size});
function rmult(b,n){switch(b.k){case'num':return n===b.v?36:0;case'red':return RED.has(n)?2:0;case'black':return n&&!RED.has(n)?2:0;
  case'even':return n&&n%2===0?2:0;case'odd':return n%2?2:0;case'low':return n>=1&&n<=18?2:0;case'high':return n>=19?2:0}return 0}
function spin(){const n=rnd(37);hist=[n,...hist].slice(0,12);const net={};
  for(const b of bets){const w=b.amt*rmult(b,n);if(db[b.tk])db[b.tk].bal+=w;net[b.tk]=(net[b.tk]||0)+w-b.amt}
  bets=[];next=Date.now()+30000;
  wss.clients.forEach(c=>{if(!c.tk)return;bal(c);send(c,{t:'rres',n,net:net[c.tk]})});
  all({t:'rspin',n}); all({t:'rstate',...rstate()}); save(); lb()}
(function loop(){setTimeout(()=>{spin();loop()},Math.max(1000,next-Date.now()))})();

// ---------- Verbindung ----------
wss.on('connection',ws=>{
  ws.on('message',m=>{let d;try{d=JSON.parse(m)}catch{return}
    if(d.t==='join'){let tk=String(d.token||'').slice(0,40);
      if(!tk||!db[tk]){tk=Math.random().toString(36).slice(2)+Date.now().toString(36);db[tk]={bal:1000}}
      db[tk].name=String(d.name||'Gast').replace(/[<>&]/g,'').slice(0,16)||'Gast';
      ws.tk=tk;save();send(ws,{t:'you',token:tk,name:db[tk].name});bal(ws);send(ws,{t:'rstate',...rstate()});lb();return}
    const p=ws.tk&&db[ws.tk];if(!p)return;
    const amt=Math.floor(+d.amt);const ok=amt>=1&&amt<=p.bal;
    if(d.t==='slot'&&ok){p.bal-=amt;const r=slots();p.bal+=amt*r.m;bal(ws);send(ws,{t:'slot',reels:r.reels,win:amt*r.m,bet:amt});save();lb()}
    else if(d.t==='scratch'&&p.bal>=10){p.bal-=10;const r=scratch();p.bal+=r.win;bal(ws);send(ws,{t:'scratch',cells:r.cells,win:r.win});save();lb()}
    else if(d.t==='bjstart'&&ok&&!ws.bj){p.bal-=amt;const k=deck();ws.bj={bet:amt,k,p:[k.pop(),k.pop()],d:[k.pop(),k.pop()]};bal(ws);
      if(val(ws.bj.p)===21)bjEnd(ws,val(ws.bj.d)===21?'push':'bj');else bjSend(ws,false,'Dein Zug')}
    else if(d.t==='bjhit'&&ws.bj){ws.bj.p.push(ws.bj.k.pop());const v=val(ws.bj.p);
      if(v>21)bjEnd(ws,'lose');else if(v===21)dealerPlay(ws);else bjSend(ws,false,'Dein Zug')}
    else if(d.t==='bjstand'&&ws.bj)dealerPlay(ws);
    else if(d.t==='rbet'&&ok&&['num','red','black','even','odd','low','high'].includes(d.k)&&(d.k!=='num'||(d.v>=0&&d.v<=36))){
      p.bal-=amt;bets.push({tk:ws.tk,k:d.k,v:+d.v,amt});bal(ws);send(ws,{t:'rbetok',k:d.k,v:d.v,amt});all({t:'rstate',...rstate()})}
    else if(d.t==='rebuy'&&p.bal<10){p.bal+=500;bal(ws);save();lb()}
    else if(d.t==='chat'){all({t:'chat',n:p.name,m:String(d.m).slice(0,120).replace(/[<>&]/g,'')})}
  });
  ws.on('close',lb);
});
srv.listen(PORT,()=>console.log('Casino läuft auf Port '+PORT));
