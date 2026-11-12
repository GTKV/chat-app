require('dotenv').config();
const express=require('express'),http=require('http'),crypto=require('crypto');
const {Server}=require('socket.io'),jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs');
const app=express(),srv=http.createServer(app),io=new Server(srv);
const {MongoClient}=require('mongodb');
const SECRET=process.env.JWT_SECRET||'change-me',GUEST_MS=5*60*1000;
let U,C,G;
async function sendMail(to,code){
  const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',
    headers:{'api-key':process.env.BREVO_KEY,'content-type':'application/json'},
    body:JSON.stringify({sender:{email:process.env.MAIL_FROM,name:process.env.MAIL_NAME||'Chat App'},to:[{email:to}],
      subject:'Your verification code',textContent:`Your code is ${code}. Valid for 10 minutes.`})});
  if(!r.ok)throw Error(await r.text());
}
app.set('trust proxy',1);app.use(express.json());app.use(express.static('public'));
const norm=e=>(e||'').trim().toLowerCase();
const tok=e=>jwt.sign({email:e},SECRET,{expiresIn:'30d'});
app.get('/api/ice',(req,res)=>{try{res.json(JSON.parse(process.env.ICE_SERVERS))}catch{res.json([{urls:'stun:stun.l.google.com:19302'}])}});
app.post('/api/send-code',async(req,res)=>{
  const email=norm(req.body.email);
  if(!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({error:'Sahi email daalo'});
  if(await U.findOne({_id:email}))return res.status(400).json({error:'Ye email pehle se registered hai. Login karo.'});
  const old=await C.findOne({_id:email});
  if(old&&Date.now()-old.sent<60000)return res.status(429).json({error:'60 second baad dobara try karo'});
  const code=String(crypto.randomInt(100000,1000000));
  await C.replaceOne({_id:email},{_id:email,code,sent:Date.now(),exp:Date.now()+6e5,tries:0},{upsert:true});
  try{
    if(process.env.BREVO_KEY)await sendMail(email,code);else console.log('[DEV] code for',email,':',code);
    res.json({ok:true});
  }catch(e){console.error(e);res.status(500).json({error:'Email send nahi ho paya'})}
});
app.post('/api/signup',async(req,res)=>{
  const email=norm(req.body.email),{code,password}=req.body,c=await C.findOne({_id:email});
  if(await U.findOne({_id:email}))return res.status(400).json({error:'Email already registered'});
  if((password||'').length<6)return res.status(400).json({error:'Password kam se kam 6 character ka ho'});
  if(!c||Date.now()>c.exp||c.tries>=5)return res.status(400).json({error:'Code expire ho gaya, naya code mangao'});
  if(c.code!==String(code).trim()){await C.updateOne({_id:email},{$inc:{tries:1}});return res.status(400).json({error:'Code galat hai'})}
  await C.deleteOne({_id:email});
  await U.insertOne({_id:email,hash:await bcrypt.hash(password,10),created:Date.now()});
  res.json({token:tok(email)});
});
app.post('/api/login',async(req,res)=>{
  const email=norm(req.body.email),u=await U.findOne({_id:email});
  if(!u||!(await bcrypt.compare(req.body.password||'',u.hash)))return res.status(400).json({error:'Email ya password galat hai'});
  res.json({token:tok(email)});
});

// ---- realtime ----
io.use((s,next)=>{
  try{const t=s.handshake.auth.token;if(t)s.user=jwt.verify(t,SECRET).email}catch{}
  s.gkey=crypto.createHash('sha1').update((s.handshake.auth.gid||'')+s.handshake.address).digest('hex');
  next();
});
const queue=[];
function leave(s){
  const i=queue.indexOf(s);if(i>-1)queue.splice(i,1);
  const p=s.partner;if(p){s.partner=null;p.partner=null;p.emit('ended')}
}
function match(s){
  const j=queue.findIndex(o=>o!==s&&o.mode===s.mode&&(!o.tags.length||!s.tags.length||o.tags.some(t=>s.tags.includes(t))));
  if(j<0){queue.push(s);return s.emit('waiting')}
  const o=queue.splice(j,1)[0];s.partner=o;o.partner=s;
  const common=s.tags.filter(t=>o.tags.includes(t));
  s.emit('matched',{initiator:true,common});o.emit('matched',{initiator:false,common});
}
async function begin(s,d){
  if(!s.user){ // guest: 5 minute total limit, enforced on server
    let g=await G.findOne({_id:s.gkey});if(!g){g={_id:s.gkey,start:Date.now()};await G.insertOne(g)}const left=GUEST_MS-(Date.now()-g.start);
    if(left<=0){s.emit('limit');return false}
    s.emit('guest',{left});clearTimeout(s.lt);
    s.lt=setTimeout(()=>{leave(s);s.emit('limit')},left);
  }
  s.mode=['text','voice','video'].includes(d.mode)?d.mode:'text';
  s.tags=(d.tags||[]).slice(0,5).map(t=>String(t).toLowerCase().slice(0,20));
  return true;
}
io.on('connection',s=>{
  io.emit('online',io.engine.clientsCount);
  s.on('start',async d=>{leave(s);if(await begin(s,d||{}))match(s)});
  s.on('next',async()=>{leave(s);if(s.mode&&await begin(s,{mode:s.mode,tags:s.tags}))match(s)});
  s.on('stop',()=>leave(s));
  s.on('signal',d=>s.partner&&s.partner.emit('signal',d));
  s.on('msg',t=>s.partner&&s.partner.emit('msg',String(t).slice(0,1000)));
  s.on('typing',v=>s.partner&&s.partner.emit('typing',!!v));
  s.on('disconnect',()=>{clearTimeout(s.lt);leave(s);io.emit('online',io.engine.clientsCount)});
});
MongoClient.connect(process.env.MONGO_URL).then(c=>{const d=c.db('chat');U=d.collection('users');C=d.collection('codes');G=d.collection('guests');
  srv.listen(process.env.PORT||3000,()=>console.log('Running on port '+(process.env.PORT||3000)))}).catch(e=>{console.error('MongoDB error:',e.message);process.exit(1)});
