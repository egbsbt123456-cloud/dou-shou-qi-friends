import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class El{
 attrs:Record<string,string>={};children:El[]=[];events:Record<string,Function>={};hidden=false;disabled=false;textContent='';className='';
 face?:El;rank?:El;filled?:boolean;private set=new Set<string>();
 classList={toggle:(name:string,flag:boolean)=>{flag?this.set.add(name):this.set.delete(name);},add:(name:string)=>this.set.add(name),contains:(name:string)=>this.set.has(name)};
 setAttribute(key:string,value:unknown){this.attrs[key]=String(value);}
 getAttribute(key:string){return this.attrs[key]??null;}
 addEventListener(name:string,fn:Function){this.events[name]=fn;}
 appendChild(child:El){const i=this.children.indexOf(child);if(i>=0)this.children.splice(i,1);this.children.push(child);return child;}
}
function setup(mode:string,Worker?:any){
 const els:Record<string,El>={};for(const id of ['board','status','counts','result','resultTitle','resultText','confetti','newGame','undo','resultClose','modeLabel'])els[id]=new El();
 const messages:any[]=[],events:Record<string,Function>={};
 const ctx:any={URLSearchParams,console,setTimeout:(fn:Function,ms:number)=>setTimeout(fn,ms),clearTimeout:(id:any)=>clearTimeout(id),__DSQ_TEST_MODE__:true};
 ctx.window=ctx;ctx.location={search:`?mode=${mode}`,origin:'https://board.test'};ctx.parent={postMessage:(p:unknown)=>messages.push(p)};ctx.Worker=Worker;
 ctx.addEventListener=(name:string,fn:Function)=>events[name]=fn;
 ctx.document={getElementById:(id:string)=>els[id],createElement:()=>new El()};vm.createContext(ctx);
 for(const name of ['engine','app'])vm.runInContext(readFileSync(new URL(`../public/dou-shou-qi/${name}.js`,import.meta.url),'utf8'),ctx);
 const send=(room:unknown,origin=ctx.location.origin,source=ctx.parent)=>events.message?.({origin,source,data:{channel:'boardgame:dou-shou-qi:control',room}});
 return {game:ctx.__DSQ_TEST__,engine:ctx.DSQ,els,messages,send};
}
afterEach(()=>vi.useRealTimers());
it('renders terrain and pieces from the red side, selects legal targets, alternates and undoes locally',()=>{
 const {game,els}=setup('local');
 expect(els.board.children).toHaveLength(63);expect(els.board.children[0]).toBe(game.cells[8][0]);expect(els.board.children[62]).toBe(game.cells[0][6]);
 expect(game.cells[0][3].className).toContain('den-r');expect(game.cells[4][1].className).toContain('water');expect(game.cells[1][3].className).toContain('trap-r');
 expect(game.cells[2][0].face.textContent).toBe('🐘');expect(game.cells[2][0].rank.textContent).toBe('8');
 game.click(6,0);expect(game.getSelected()).toBeNull();
 game.click(2,0);expect(game.getTargets()).toHaveLength(3);expect(game.cells[3][0].className).toContain('target');
 game.click(3,0);expect(game.getState().board[3][0]).toBe('r8');expect(game.getState().turn).toBe('b');
 game.click(6,6);game.click(5,6);expect(game.getHistory()).toHaveLength(2);
 game.undo();expect(game.getState().turn).toBe('b');expect(game.getHistory()).toHaveLength(1);expect(els.status.textContent).toContain('蓝方');expect(els.counts.textContent).toBe('红方 8 子 · 蓝方 8 子');
 game.reset();expect(game.getState().version).toBe(0);
});
it('shows the result, celebrates and locks the board after a den win',()=>{
 const {game,engine,els}=setup('local');const s=engine.createInitialState();s.board=engine.emptyBoard();s.board[7][3]='r7';s.board[6][6]='b1';game.load(s);
 expect(els.result.hidden).toBe(true);game.click(7,3);expect(game.getTargets().some((m:any)=>m.tr===8&&m.tc===3)).toBe(true);game.click(8,3);
 expect(game.getState()).toMatchObject({over:true,winner:'r',reason:'den'});expect(els.result.hidden).toBe(false);expect(els.resultTitle.textContent).toBe('红方获胜！');
 expect(els.status.textContent).toContain('攻入兽穴');expect(els.confetti.classList.contains('show')).toBe(true);expect(els.confetti.children.length).toBeGreaterThan(0);
 game.click(6,6);expect(game.getSelected()).toBeNull();els.resultClose.events.click!();expect(els.result.hidden).toBe(true);
 game.undo();expect(game.getState().over).toBe(false);
});
it('AI replies legally and resetting or undoing cancels a pending reply',()=>{
 vi.useFakeTimers();const {game,els}=setup('ai');expect(game.play({fr:2,fc:0,tr:3,tc:0})).toBe(true);expect(els.status.textContent).toContain('思考');
 expect(game.play({fr:6,fc:0,tr:5,tc:0})).toBe(false);vi.advanceTimersByTime(150);expect(game.getHistory()).toHaveLength(2);expect(game.getState().turn).toBe('r');
 game.undo();expect(game.getHistory()).toHaveLength(0);
 game.play({fr:2,fc:0,tr:3,tc:0});game.reset();vi.advanceTimersByTime(300);expect(game.getHistory()).toHaveLength(0);
 game.play({fr:2,fc:0,tr:3,tc:0});game.undo();vi.advanceTimersByTime(300);expect(game.getHistory()).toHaveLength(0);
});
it('ignores old Worker results and falls back when Worker fails',()=>{
 vi.useFakeTimers();const workers:any[]=[];
 class Worker{onmessage:any;onerror:any;job:any;postMessage(job:any){this.job=job;workers.push(this);}terminate(){}}
 const {game}=setup('ai',Worker);game.play({fr:2,fc:0,tr:3,tc:0});vi.advanceTimersByTime(150);const old=workers[0];game.reset();
 old.onmessage({data:{id:old.job.id,version:old.job.state.version,move:{fr:6,fc:0,tr:5,tc:0}}});expect(game.getHistory()).toHaveLength(0);
 game.play({fr:2,fc:0,tr:3,tc:0});vi.advanceTimersByTime(150);workers[1].onerror({preventDefault(){}});expect(game.getHistory()).toHaveLength(2);expect(game.getState().turn).toBe('r');
});
it('online input is authorized by seat, flips the board for blue and only applies authoritative snapshots',()=>{
 const {game,engine,send,messages,els}=setup('online');let state=engine.createInitialState();state.version=1;
 const room={code:'0123456789',yourSide:'b',status:'playing',state,history:[]};
 expect(messages[0].type).toBe('ready');expect(els.newGame.hidden).toBe(true);
 send(room,'https://evil.test');expect(els.status.textContent).toContain('等待房间同步');
 send(room);expect(els.board.children[0]).toBe(game.cells[0][6]);game.click(6,0);expect(game.getSelected()).toBeNull();
 state=engine.safeApplyMove(state,'r',{fr:2,fc:0,tr:3,tc:0}).state;send({...room,state});
 game.click(6,0);game.click(5,0);expect(messages).toHaveLength(2);expect(messages[1]).toMatchObject({type:'move',data:{expectedVersion:2,move:{fr:6,fc:0,tr:5,tc:0}}});
 expect(game.getState().board[6][0]).toBe('b1');game.click(6,6);expect(game.getSelected()).toBeNull();
 const next=engine.safeApplyMove(state,'b',{fr:6,fc:0,tr:5,tc:0}).state;send({...room,state:next});expect(game.getState().board[5][0]).toBe('b1');
 send({...room,state});expect(game.getState().version).toBe(3);
});
