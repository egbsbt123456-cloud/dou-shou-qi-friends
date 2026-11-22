import {it,expect} from 'vitest';
import {doushouqiEngine as E} from '@board/game-core';
import type {DoushouqiState} from '@board/contracts';
import {readFileSync} from 'node:fs';
const empty=(turn:'r'|'b'='r'):DoushouqiState=>({...E.createInitialState(),board:E.emptyBoard(),turn});
const targets=(s:DoushouqiState,r:number,c:number)=>E.movesFor(s.board,r,c).map(m=>`${m.tr},${m.tc}`);
it('uses exactly the browser rule source on the server',()=>{
 expect(readFileSync(new URL('../../../../packages/game-core/src/doushouqi-engine.cjs',import.meta.url),'utf8')).toBe(readFileSync(new URL('../../../web/public/dou-shou-qi/engine.js',import.meta.url),'utf8'));
});
it('sets up the standard point-symmetric opening with red to move',()=>{
 const s=E.createInitialState();let pieces=0;
 for(let r=0;r<9;r++)for(let c=0;c<7;c++){const p=s.board[r]![c];if(!p)continue;pieces++;const q=s.board[8-r]![6-c]!;expect(q.charAt(1)).toBe(p.charAt(1));expect(q.charAt(0)).not.toBe(p.charAt(0));}
 expect(pieces).toBe(16);expect(s.turn).toBe('r');expect(s.board[0]![0]).toBe('r6');expect(s.board[0]![6]).toBe('r7');expect(s.board[2]![0]).toBe('r8');expect(s.board[2]![6]).toBe('r1');
 expect(E.legalMoves(s.board,'r').length).toBeGreaterThan(0);
});
it('lets only rats swim and keeps pieces out of their own den',()=>{
 const s=empty();s.board[2]![1]='r1';s.board[2]![2]='r2';s.board[0]![2]='r3';s.board[8]![0]='b2';
 expect(targets(s,2,1)).toContain('3,1');expect(targets(s,2,2)).not.toContain('3,2');expect(targets(s,0,2)).not.toContain('0,3');
});
it('lets lions and tigers jump the river unless any piece is in the way',()=>{
 const s=empty();s.board[3]![0]='r7';s.board[2]![1]='r6';s.board[2]![2]='r5';s.board[8]![6]='b1';
 expect(targets(s,3,0)).toContain('3,3');expect(targets(s,2,1)).toContain('6,1');expect(targets(s,2,2).some(t=>Number(t.split(',')[0])>=3)).toBe(false);
 s.board[4]![1]='b1';expect(targets(s,2,1)).not.toContain('6,1');
 s.board[4]![1]=null;s.board[3]![2]='r1';expect(targets(s,3,0)).not.toContain('3,3');
 const land=empty();land.board[2]![1]='r7';land.board[6]![1]='b6';land.board[8]![6]='b1';expect(targets(land,2,1)).toContain('6,1');
 land.board[6]![1]='b8';expect(targets(land,2,1)).not.toContain('6,1');
});
it('applies rank, rat/elephant, river-bank and trap capture rules',()=>{
 const s=empty();s.board[2]![0]='r1';s.board[3]![0]='b8';expect(targets(s,2,0)).toContain('3,0');expect(targets(s,3,0)).not.toContain('2,0');
 const water=empty();water.board[3]![1]='r1';water.board[3]![0]='b8';water.board[4]![1]='b1';expect(targets(water,3,1)).not.toContain('3,0');expect(targets(water,3,1)).toContain('4,1');
 const bank=empty();bank.board[2]![1]='r1';bank.board[3]![1]='b1';expect(targets(bank,2,1)).not.toContain('3,1');
 const rank=empty();rank.board[4]![0]='r4';rank.board[5]![0]='b4';rank.board[4]![3]='r3';rank.board[5]![3]='b5';expect(targets(rank,4,0)).toContain('5,0');expect(targets(rank,4,3)).not.toContain('5,3');
 const trap=empty();trap.board[0]![1]='r2';trap.board[0]![2]='b7';expect(targets(trap,0,1)).toContain('0,2');
 const ratTrap=empty('b');ratTrap.board[7]![2]='b8';ratTrap.board[8]![2]='r1';expect(targets(ratTrap,7,2)).toContain('8,2');
 const ownTrap=empty();ownTrap.board[0]![1]='b2';ownTrap.board[0]![2]='r7';expect(targets(ownTrap,0,1)).not.toContain('0,2');
});
it('wins by den, by capturing every piece, and when the opponent has no move',()=>{
 const den=empty();den.board[7]![3]='r7';den.board[6]![6]='b1';
 expect(E.safeApplyMove(den,'r',{fr:7,fc:3,tr:8,tc:3})).toMatchObject({ok:true,state:{over:true,winner:'r',reason:'den'}});
 const all=empty();all.board[4]![0]='r3';all.board[5]![0]='b2';
 expect(E.safeApplyMove(all,'r',{fr:4,fc:0,tr:5,tc:0})).toMatchObject({ok:true,state:{over:true,winner:'r',reason:'captured'}});
 const stuck=empty('b');stuck.board[0]![0]='r2';stuck.board[0]![1]='b4';stuck.board[2]![0]='b3';
 const ended=E.safeApplyMove(stuck,'b',{fr:2,fc:0,tr:1,tc:0});expect(ended).toMatchObject({ok:true,state:{over:true,winner:'b',reason:'no-moves'}});
 if(ended.ok)expect(E.safeApplyMove(ended.state,'r',{fr:0,fc:0,tr:1,tc:0})).toMatchObject({ok:false,code:'GAME_OVER'});
});
it('rejects wrong actors, bad coordinates, foreign pieces, illegal moves and malformed state without mutating input',()=>{
 const s=E.createInitialState(),before=JSON.stringify(s);
 expect(E.safeApplyMove(s,'b',{fr:6,fc:0,tr:5,tc:0})).toMatchObject({ok:false,code:'NOT_YOUR_TURN'});
 for(const m of [{fr:-1,fc:0,tr:3,tc:0},{fr:2.5,fc:0,tr:3,tc:0},{fr:2,fc:0,tr:9,tc:0},{fr:2,fc:0,tr:3,tc:7}])expect(E.safeApplyMove(s,'r',m)).toMatchObject({ok:false,code:'BAD_COORDS'});
 expect(E.safeApplyMove(s,'r',{fr:6,fc:0,tr:5,tc:0})).toMatchObject({ok:false,code:'NOT_YOUR_PIECE'});
 expect(E.safeApplyMove(s,'r',{fr:2,fc:0,tr:4,tc:0})).toMatchObject({ok:false,code:'ILLEGAL_MOVE'});
 expect(E.safeApplyMove({...s,board:null} as unknown as DoushouqiState,'r',{fr:2,fc:0,tr:3,tc:0})).toMatchObject({ok:false,code:'BAD_STATE'});
 expect(E.safeApplyMove({...s,board:s.board.map(r=>r.map(p=>p==='r8'?'x9':p))},'r',{fr:2,fc:0,tr:3,tc:0})).toMatchObject({ok:false,code:'BAD_STATE'});
 const next=E.safeApplyMove(s,'r',{fr:2,fc:0,tr:3,tc:0});expect(next).toMatchObject({ok:true,state:{turn:'b',version:1,lastMove:{fr:2,fc:0,tr:3,tc:0}}});expect(JSON.stringify(s)).toBe(before);
});
it('AI takes a winning den move, captures with the rat, and leaves its input unchanged',()=>{
 const den=empty();den.board[7]![3]='r7';den.board[6]![6]='b1';den.board[5]![3]='b8';const before=JSON.stringify(den);
 expect(E.bestMove(den,'r')).toEqual({fr:7,fc:3,tr:8,tc:3});expect(JSON.stringify(den)).toBe(before);
 const rat=empty('b');rat.board[4]![0]='r8';rat.board[5]![0]='b1';rat.board[8]![6]='b7';rat.board[0]![6]='r2';
 expect(E.bestMove(rat,'b')).toEqual({fr:5,fc:0,tr:4,tc:0});
 expect(E.bestMove({...den,over:true},'r')).toBe(null);expect(E.bestMove(den,'b')).toBe(null);
});
it('AI keeps producing legal moves in self-play',()=>{
 let state=E.createInitialState();
 for(let n=0;n<80&&!state.over;n++){const move=E.bestMove(state,state.turn,{depth:2});expect(move).not.toBeNull();const next=E.safeApplyMove(state,state.turn,move!);if(!next.ok)throw Error(next.code);state=next.state;}
 expect(state.version).toBeGreaterThan(0);
});
