import {it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {openDatabase,migrate} from '../database/index.js';
import {createApp} from '../app.js';
const origin='https://board.test';
const headers=(user:string)=>({origin,cookie:`board_session=${user}`});
const redMove={fr:2,fc:0,tr:3,tc:0},blueMove={fr:6,fc:6,tr:5,tc:6};
it('authenticates rooms, serializes joins and moves, rejects forgery, survives restart and ends by resignation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'board-dsq-')),path=join(dir,'db.sqlite');
 const data=openDatabase(path);migrate(data.sqlite);
 for(const user of ['alice','bob','carol']){
  data.sqlite.prepare('INSERT INTO users(id,username,nickname,password_hash,created_at) VALUES(?,?,?,?,?)').run(user,user,user,'unused',Date.now());
  data.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(user).digest('hex'),user,Date.now()+60000);
 }data.sqlite.close();
 let app=createApp({databasePath:path,origin,production:true,logger:false}).app;
 const post=(url:string,user:string,payload:object)=>app.inject({method:'POST',url,headers:headers(user),payload});
 const cmd=(type:string,expectedVersion:number,move?:object,requestId=randomUUID())=>({type,expectedVersion,requestId,...(move?{move}:{})});
 try{
  expect((await app.inject('/api/dou-shou-qi/rooms')).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/dou-shou-qi/rooms',headers:{...headers('alice'),origin:'https://evil.test'},payload:{}})).statusCode).toBe(403);
  const created=await post('/api/dou-shou-qi/rooms','alice',{});expect(created.statusCode).toBe(201);const room=created.json(),base=`/api/dou-shou-qi/rooms/${room.code}`;
  expect(room.status).toBe('waiting');expect(room.yourSide).toBe('r');expect(JSON.stringify(room)).not.toContain('blue_id');
  expect((await post(base+'/actions','alice',cmd('move',0,redMove))).statusCode).toBe(409);
  expect((await app.inject({url:base,headers:headers('bob')})).statusCode).toBe(404);
  expect((await post(base+'/join','alice',{})).json().yourSide).toBe('r');
  const joins=await Promise.all([post(base+'/join','bob',{}),post(base+'/join','carol',{})]);
  expect(joins.map(r=>r.statusCode).sort()).toEqual([200,409]);const blue=joins[0]!.statusCode===200?'bob':'carol',third=blue==='bob'?'carol':'bob';
  expect((await post(base+'/join',blue,{})).json().yourSide).toBe('b');
  expect((await app.inject({url:base,headers:headers(third)})).statusCode).toBe(404);
  expect((await post(base+'/actions',third,cmd('resign',1))).statusCode).toBe(404);
  expect((await post(base+'/actions',blue,cmd('move',1,blueMove))).statusCode).toBe(409);
  expect((await post(base+'/actions','alice',cmd('move',1,{fr:9,fc:0,tr:3,tc:0}))).statusCode).toBe(400);
  expect((await post(base+'/actions','alice',{...cmd('move',1,redMove),board:[]})).statusCode).toBe(400);
  expect((await post(base+'/actions','alice',cmd('move',1,{fr:2,fc:0,tr:4,tc:0}))).statusCode).toBe(409);
  expect((await post(base+'/actions','alice',cmd('move',1,{fr:1,fc:1,tr:3,tc:1}))).statusCode).toBe(409);
  const first=cmd('move',1,redMove);const response=await post(base+'/actions','alice',first);expect(response.statusCode).toBe(200);
  expect(response.json().state.version).toBe(2);expect(response.json().history[0].notation).toBe('红象 A3→A4');
  expect((await post(base+'/actions','alice',first)).json().history).toHaveLength(1);
  expect((await post(base+'/actions','alice',{...first,move:{...redMove,fc:2}})).statusCode).toBe(409);
  expect((await post(base+'/actions',blue,cmd('move',1,blueMove))).statusCode).toBe(409);
  const second=await post(base+'/actions',blue,cmd('move',2,blueMove));expect(second.statusCode).toBe(200);expect(second.json().history).toHaveLength(2);
  expect((await post(base+'/actions','alice',first)).json().history).toHaveLength(2);
  expect((await post(base+'/actions','alice',cmd('cancel',3))).statusCode).toBe(409);
  await app.close();app=createApp({databasePath:path,origin,production:true,logger:false}).app;
  const saved=(await app.inject({url:base,headers:headers('alice')})).json();expect(saved.state.version).toBe(3);expect(saved.state.board[3][0]).toBe('r8');expect(saved.state.board[5][6]).toBe('b8');expect(saved.history).toHaveLength(2);
  expect((await app.inject({url:'/api/dou-shou-qi/rooms',headers:headers(blue)})).json().rooms).toHaveLength(1);
  const end=cmd('resign',3);const ended=await post(base+'/actions',blue,end);expect(ended.json().state.winner).toBe('r');expect(ended.json().status).toBe('finished');
  expect((await post(base+'/actions',blue,end)).statusCode).toBe(200);
  expect((await post(base+'/actions','alice',cmd('move',4,{fr:3,fc:0,tr:4,tc:0}))).statusCode).toBe(409);
  const pending=(await post('/api/dou-shou-qi/rooms','alice',{})).json();const cancelled=await post(`/api/dou-shou-qi/rooms/${pending.code}/actions`,'alice',cmd('cancel',0));expect(cancelled.json().status).toBe('cancelled');
  expect((await post(`/api/dou-shou-qi/rooms/${pending.code}/join`,blue,{})).statusCode).toBe(409);
  const check=openDatabase(path);check.sqlite.prepare("UPDATE users SET status='disabled' WHERE id='alice'").run();check.sqlite.close();
  expect((await app.inject({url:base,headers:headers('alice')})).statusCode).toBe(401);
 }finally{await app.close();if(dirname(dir)===tmpdir()&&basename(dir).startsWith('board-dsq-'))rmSync(dir,{recursive:true,force:true});}
});
it('finishes a friend game when a piece enters the opponent den',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'board-dsq-')),path=join(dir,'db.sqlite');
 const data=openDatabase(path);migrate(data.sqlite);
 for(const user of ['alice','bob']){
  data.sqlite.prepare('INSERT INTO users(id,username,nickname,password_hash,created_at) VALUES(?,?,?,?,?)').run(user,user,user,'unused',Date.now());
  data.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(user).digest('hex'),user,Date.now()+60000);
 }
 let app=createApp({databasePath:path,origin,production:true,logger:false}).app;
 const post=(url:string,user:string,payload:object)=>app.inject({method:'POST',url,headers:headers(user),payload});
 try{
  const room=(await post('/api/dou-shou-qi/rooms','alice',{})).json(),base=`/api/dou-shou-qi/rooms/${room.code}`;
  await post(base+'/join','bob',{});
  // 测试数据：把红狮放到蓝方陷阱旁，验证服务端按规则判定兽穴胜利
  const row=data.sqlite.prepare('SELECT state FROM doushouqi_rooms WHERE code=?').get(room.code) as {state:string};
  const state=JSON.parse(row.state);state.board[7][3]='r7';state.board[0][6]=null;
  data.sqlite.prepare('UPDATE doushouqi_rooms SET state=? WHERE code=?').run(JSON.stringify(state),room.code);data.sqlite.close();
  const win=await post(base+'/actions','alice',{type:'move',requestId:randomUUID(),expectedVersion:1,move:{fr:7,fc:3,tr:8,tc:3}});
  expect(win.statusCode).toBe(200);expect(win.json().status).toBe('finished');expect(win.json().state).toMatchObject({over:true,winner:'r',reason:'den'});
  expect((await post(base+'/actions','bob',{type:'move',requestId:randomUUID(),expectedVersion:2,move:{fr:6,fc:0,tr:5,tc:0}})).statusCode).toBe(409);
  expect((await app.inject({url:'/api/dou-shou-qi/rooms',headers:headers('alice')})).json().rooms).toHaveLength(0);
 }finally{await app.close();if(dirname(dir)===tmpdir()&&basename(dir).startsWith('board-dsq-'))rmSync(dir,{recursive:true,force:true});}
});
it('does not open friend rooms on production HTTP',async()=>{
 const {app}=createApp({databasePath:':memory:',origin:'http://board.test',production:true,logger:false});
 try{expect((await app.inject('/api/dou-shou-qi/rooms')).statusCode).toBe(503);}finally{await app.close();}
});
