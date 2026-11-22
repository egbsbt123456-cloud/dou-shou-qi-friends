import { randomBytes, createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { doushouqiEngine as engine } from '@board/game-core';
import type { DoushouqiState, DoushouqiHistory, DoushouqiRoomView } from '@board/contracts';
import { sessionUser, type SessionUser } from '../auth/session.js';

type Room = {code:string;red_id:string;blue_id:string|null;status:DoushouqiRoomView['status'];state:string;history:string;version:number;created_at:number;updated_at:number};
class Refusal extends Error {constructor(public status:number,message:string){super(message);}}
const codeSchema=z.string().regex(/^[A-F0-9]{10}$/);
const move=z.object({fr:z.number().int().min(0).max(8),fc:z.number().int().min(0).max(6),tr:z.number().int().min(0).max(8),tc:z.number().int().min(0).max(6)}).strict();
const action=z.discriminatedUnion('type',[
  z.object({type:z.literal('move'),requestId:z.uuid(),expectedVersion:z.number().int().nonnegative(),move}).strict(),
  z.object({type:z.literal('resign'),requestId:z.uuid(),expectedVersion:z.number().int().nonnegative()}).strict(),
  z.object({type:z.literal('cancel'),requestId:z.uuid(),expectedVersion:z.number().int().nonnegative()}).strict(),
]);
const sideName=(side:'r'|'b')=>side==='r'?'红':'蓝';
const square=(r:number,c:number)=>'ABCDEFG'.charAt(c)+(r+1);
const pieceName=(p:string)=>sideName(p.charAt(0) as 'r'|'b')+engine.NAMES[Number(p.charAt(1))];

export function registerDoushouqi(app:FastifyInstance,db:Database.Database,origin:string,production:boolean){
  app.register(async routes=>{
    const identities=new WeakMap<FastifyRequest,SessionUser>();
    const limits=new Map<string,{n:number;until:number}>();
    routes.addHook('preHandler',async(req,reply)=>{
      if(production&&!origin.startsWith('https://'))return reply.code(503).send({error:'好友同玩需要 HTTPS'});
      const user=sessionUser(db,req.headers.cookie);
      if(!user)return reply.code(401).send({error:'请先登录，再与好友同玩'});
      identities.set(req,user);
      if(req.method==='GET')return;
      if(req.headers.origin!==origin)return reply.code(403).send({error:'请求来源不允许'});
      const now=Date.now();
      for(const [key,v] of limits)if(v.until<now)limits.delete(key);
      if(limits.size>=10000&&!limits.has(user.id))return reply.code(429).send({error:'请求繁忙，请稍后重试'});
      const limit=limits.get(user.id)??{n:0,until:now+60000};limits.set(user.id,limit);
      if(++limit.n>60)return reply.code(429).send({error:'操作太频繁，请稍后重试'});
    });
    routes.setErrorHandler((err,req,reply)=>{
      if(err instanceof Refusal)return reply.code(err.status).send({error:err.message});
      req.log.error(err);return reply.code(500).send({error:'房间服务暂时不可用，请稍后重试'});
    });
    const getRoom=(code:string)=>db.prepare('SELECT * FROM doushouqi_rooms WHERE code=?').get(code) as Room|undefined;
    const parseCode=(req:FastifyRequest)=>{
      const parsed=z.object({code:codeSchema}).safeParse(req.params);
      if(!parsed.success)throw new Refusal(400,'房间码应为 10 位字母和数字');return parsed.data.code;
    };
    const member=(room:Room|undefined,user:SessionUser):Room=>{
      if(!room||(room.red_id!==user.id&&room.blue_id!==user.id))throw new Refusal(404,'房间不存在，或你尚未加入');return room;
    };
    const view=(room:Room,user:SessionUser):DoushouqiRoomView=>{
      const name=(id:string|null)=>id?(db.prepare('SELECT nickname FROM users WHERE id=?').get(id) as {nickname:string}|undefined)?.nickname??'玩家':null;
      return {code:room.code,status:room.status,yourSide:room.red_id===user.id?'r':'b',redName:name(room.red_id)!,blueName:name(room.blue_id),state:JSON.parse(room.state),history:JSON.parse(room.history),updatedAt:room.updated_at};
    };
    const activeCount=(id:string)=>(db.prepare("SELECT count(*) AS n FROM doushouqi_rooms WHERE (red_id=? OR blue_id=?) AND status IN ('waiting','playing')").get(id,id) as {n:number}).n;
    routes.get('/rooms',req=>{
      const user=identities.get(req)!;
      const rooms=db.prepare("SELECT * FROM doushouqi_rooms WHERE (red_id=? OR blue_id=?) AND status IN ('waiting','playing') ORDER BY updated_at DESC LIMIT 3").all(user.id,user.id) as Room[];
      return {rooms:rooms.map(r=>view(r,user))};
    });
    routes.post('/rooms',(req,reply)=>{
      if(!z.object({}).strict().safeParse(req.body).success)throw new Refusal(400,'建房参数不正确');
      const user=identities.get(req)!;
      const result=db.transaction(()=>{
        if(activeCount(user.id)>=3)throw new Refusal(409,'已有 3 个未结束房间，请先继续或结束对局');
        const recent=db.prepare('SELECT count(*) AS n FROM doushouqi_rooms WHERE red_id=? AND created_at>?').get(user.id,Date.now()-3600000) as {n:number};
        if(recent.n>=20)throw new Refusal(429,'本小时建房较多，请稍后再试');
        let code:string;do{code=randomBytes(5).toString('hex').toUpperCase();}while(getRoom(code));
        const state=engine.createInitialState(),now=Date.now();
        db.prepare("INSERT INTO doushouqi_rooms VALUES(?,?,NULL,'waiting',?,'[]',0,?,?)").run(code,user.id,JSON.stringify(state),now,now);
        return view(getRoom(code)!,user);
      })();return reply.code(201).send(result);
    });
    routes.get('/rooms/:code',req=>{const user=identities.get(req)!;return view(member(getRoom(parseCode(req)),user),user);});
    routes.post('/rooms/:code/join',req=>{
      if(!z.object({}).strict().safeParse(req.body).success)throw new Refusal(400,'加入参数不正确');
      const code=parseCode(req),user=identities.get(req)!;
      return db.transaction(()=>{
        const room=getRoom(code);
        if(!room)throw new Refusal(404,'没有找到这个房间，请检查房间码');
        if(room.red_id===user.id||room.blue_id===user.id)return view(room,user);
        if(room.status!=='waiting'||room.blue_id)throw new Refusal(409,'该房间已满或已结束');
        if(activeCount(user.id)>=3)throw new Refusal(409,'请先结束一个已有房间');
        const state=JSON.parse(room.state) as DoushouqiState;state.version++;
        db.prepare("UPDATE doushouqi_rooms SET blue_id=?,status='playing',state=?,version=?,updated_at=? WHERE code=?").run(user.id,JSON.stringify(state),state.version,Date.now(),code);
        return view(getRoom(code)!,user);
      })();
    });
    routes.post('/rooms/:code/actions',req=>{
      const parsed=action.safeParse(req.body);if(!parsed.success)throw new Refusal(400,'走棋参数不正确');
      const code=parseCode(req),user=identities.get(req)!,input=parsed.data;
      const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
      return db.transaction(()=>{
        const room=member(getRoom(code),user);
        const old=db.prepare('SELECT user_id,fingerprint FROM doushouqi_requests WHERE room_code=? AND request_id=?').get(code,input.requestId) as {user_id:string;fingerprint:string}|undefined;
        if(old){if(old.user_id!==user.id||old.fingerprint!==fingerprint)throw new Refusal(409,'请求编号已被使用');return view(room,user);}
        if(room.version!==input.expectedVersion)throw new Refusal(409,'棋局已更新，请同步后再走');
        const side=room.red_id===user.id?'r':'b';let state=JSON.parse(room.state) as DoushouqiState;
        const history=JSON.parse(room.history) as DoushouqiHistory[];
        let status=room.status;
        if(input.type==='cancel'){
          if(status!=='waiting'||side!=='r')throw new Refusal(409,'仅房主可取消尚未开始的房间');
          status='cancelled';state={...state,over:true,reason:'cancelled',version:state.version+1};
        }else{
          if(status!=='playing'||state.over)throw new Refusal(409,'对局尚未开始或已结束');
          if(input.type==='resign'){
            state={...state,over:true,winner:side==='r'?'b':'r',reason:'resign',version:state.version+1};status='finished';
          }else{
            const m=input.move,mover=state.board[m.fr]?.[m.fc]??null,captured=state.board[m.tr]?.[m.tc]??null;
            const next=engine.safeApplyMove(state,side,m);
            if(!next.ok)throw new Refusal(409,next.code==='NOT_YOUR_TURN'?'还没有轮到你走棋':'这一步不符合斗兽棋规则');
            history.push({move:m,mover:mover!,captured,turnBefore:side,notation:`${pieceName(mover!)} ${square(m.fr,m.fc)}→${square(m.tr,m.tc)}${captured?` 吃${pieceName(captured)}`:''}`});
            state=next.state;if(state.over)status='finished';
          }
        }
        db.prepare('UPDATE doushouqi_rooms SET state=?,history=?,version=?,status=?,updated_at=? WHERE code=?').run(JSON.stringify(state),JSON.stringify(history),state.version,status,Date.now(),code);
        db.prepare('INSERT INTO doushouqi_requests VALUES(?,?,?,?)').run(code,input.requestId,user.id,fingerprint);
        return view(getRoom(code)!,user);
      })();
    });
  },{prefix:'/api/dou-shou-qi'});
}
