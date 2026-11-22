(function(){
  'use strict';
  var E=window.DSQ,mode=new URLSearchParams(window.location.search).get('mode')||'ai';
  if(['ai','local','online'].indexOf(mode)<0)mode='ai';
  var boardEl=document.getElementById('board'),status=document.getElementById('status'),counts=document.getElementById('counts');
  var resultEl=document.getElementById('result'),resultTitle=document.getElementById('resultTitle'),resultText=document.getElementById('resultText'),confetti=document.getElementById('confetti');
  var state=E.createInitialState(),history=[],selected=null,targets=[],thinking=false,pending=false,side=null,ready=false,roomCode=null;
  var epoch=0,timer=null,watchdog=null,worker=null,orientation=null,shownResult=null,cells=[];
  var SIDE={r:'红方',b:'蓝方'},COLS='ABCDEFG';

  function parentMessage(type,data){window.parent.postMessage({channel:'boardgame:dou-shou-qi',type:type,data:data},window.location.origin);}
  function canPlay(){return !state.over&&!thinking&&!pending&&(mode==='local'||(mode==='ai'&&state.turn===E.RED)||(mode==='online'&&ready&&state.turn===side));}
  function viewSide(){return mode==='online'&&side===E.BLUE?E.BLUE:E.RED;}
  function squareName(r,c){return COLS.charAt(c)+(r+1);}
  function pieceName(p){return SIDE[E.sideOf(p)]+E.NAMES[E.rankOf(p)];}

  // 系统没有彩色 emoji 字体时改显汉字，避免方框
  function detectEmoji(){
    try{
      var canvas=document.createElement('canvas'),ctx=canvas.getContext&&canvas.getContext('2d');
      if(!ctx)return true;canvas.width=canvas.height=24;ctx.textBaseline='top';ctx.font='20px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';ctx.fillText('\uD83D\uDC18',0,0);
      var d=ctx.getImageData(0,0,24,24).data;
      for(var i=0;i<d.length;i+=4)if(d[i+3]>0&&(Math.abs(d[i]-d[i+1])>24||Math.abs(d[i+1]-d[i+2])>24))return true;
      return false;
    }catch(error){return true;}
  }
  var emoji=detectEmoji();boardEl.classList.toggle('no-emoji',!emoji);

  for(var r=0;r<E.ROWS;r++){
    cells[r]=[];
    for(var c=0;c<E.COLS;c++)(function(r,c){
      var cell=document.createElement('button'),face=document.createElement('span'),rank=document.createElement('span');
      cell.setAttribute('type','button');face.className='face';rank.className='rank';
      cell.appendChild(face);cell.appendChild(rank);cell.face=face;cell.rank=rank;
      cell.addEventListener('click',function(){onCell(r,c);});
      cells[r][c]=cell;
    })(r,c);
  }
  function orient(){
    var view=viewSide();if(orientation===view)return;orientation=view;
    for(var i=0;i<E.ROWS;i++)for(var j=0;j<E.COLS;j++){
      var r=view===E.RED?E.ROWS-1-i:i,c=view===E.RED?j:E.COLS-1-j;boardEl.appendChild(cells[r][c]);
    }
  }
  function terrain(r,c){
    var t=['cell'];if(E.isWater(r,c))t.push('water');
    var trap=E.trapOwner(r,c),den=E.denOwner(r,c);if(trap)t.push('trap','trap-'+trap);if(den)t.push('den','den-'+den);
    return t;
  }
  function isTarget(r,c){for(var i=0;i<targets.length;i++)if(targets[i].tr===r&&targets[i].tc===c)return true;return false;}
  function render(){
    orient();var last=state.lastMove,red=0,blue=0,active=canPlay();
    for(var r=0;r<E.ROWS;r++)for(var c=0;c<E.COLS;c++){
      var p=state.board[r][c],cell=cells[r][c],cls=terrain(r,c),label=squareName(r,c);
      if(p){cls.push('has-piece','piece-'+E.sideOf(p));if(E.sideOf(p)===E.RED)red++;else blue++;
        cell.face.textContent=emoji?E.EMOJI[E.rankOf(p)]:E.NAMES[E.rankOf(p)];cell.rank.textContent=String(E.rankOf(p));label+='，'+pieceName(p);}
      else{cell.face.textContent='';cell.rank.textContent='';label+=E.isWater(r,c)?'，河':E.denOwner(r,c)?'，'+SIDE[E.denOwner(r,c)]+'兽穴':E.trapOwner(r,c)?'，'+SIDE[E.trapOwner(r,c)]+'陷阱':'，空地';}
      if(selected&&selected.r===r&&selected.c===c)cls.push('selected');
      if(isTarget(r,c))cls.push(p?'capture':'target');
      if(last&&((last.fr===r&&last.fc===c)||(last.tr===r&&last.tc===c)))cls.push('last');
      if(active&&p&&E.sideOf(p)===state.turn)cls.push('movable');
      cell.className=cls.join(' ');cell.setAttribute('aria-label',label);
      cell.setAttribute('aria-pressed',selected&&selected.r===r&&selected.c===c?'true':'false');
    }
    var text;
    if(state.over)text=resultLine();
    else if(mode==='online'&&!ready)text=roomCode?'等待好友加入':'等待房间同步…';
    else if(thinking)text='电脑思考中…';
    else if(pending)text='等待服务器确认…';
    else text=SIDE[state.turn]+'行棋'+(mode==='online'?(state.turn===side?' · 轮到你':' · 等待对方'):mode==='ai'&&state.turn===E.RED?' · 轮到你':'');
    status.textContent=text;status.classList.toggle('over',state.over);
    counts.textContent='红方 '+red+' 子 · 蓝方 '+blue+' 子';
    document.getElementById('undo').disabled=!history.length||mode==='online';
    showResult();
  }
  function resultLine(){
    if(state.reason==='cancelled')return '房间已取消';
    if(!state.winner)return '对局结束';
    var why={den:'攻入兽穴',captured:'吃光对方棋子','no-moves':'对方无子可走',resign:'对方认输'}[state.reason]||'';
    return SIDE[state.winner]+'获胜'+(why?' · '+why:'');
  }
  function showResult(){
    if(!state.over||state.reason==='cancelled'){resultEl.hidden=true;confetti.classList.toggle('show',false);return;}
    if(shownResult===state.version)return;shownResult=state.version;
    var mine=mode==='local'||(mode==='ai'&&state.winner===E.RED)||(mode==='online'&&state.winner===side);
    resultTitle.textContent=mode==='local'?SIDE[state.winner]+'获胜！':mine?'你赢了！':'这局输了';
    resultText.textContent=resultLine()+(mine||mode==='local'?'':' · 再来一局，换个思路。');
    resultEl.hidden=false;
    if(mine){
      if(!confetti.filled){for(var i=0;i<36;i++){var bit=document.createElement('i');bit.setAttribute('style','left:'+((i*37)%100)+'%;animation-delay:'+((i%9)*0.12).toFixed(2)+'s');confetti.appendChild(bit);}confetti.filled=true;}
      confetti.classList.toggle('show',true);
    }
  }
  function stopAI(){epoch++;clearTimeout(timer);clearTimeout(watchdog);if(worker)worker.terminate();worker=null;timer=null;watchdog=null;thinking=false;}
  function commit(move){
    var mover=state.board[move.fr][move.fc],captured=state.board[move.tr][move.tc],turn=state.turn;
    var result=E.safeApplyMove(state,turn,move);if(!result.ok)return false;
    history.push({move:move,mover:mover,captured:captured,turnBefore:turn});state=result.state;selected=null;targets=[];render();return true;
  }
  function scheduleAI(){
    if(mode!=='ai'||state.over||state.turn!==E.BLUE)return;
    thinking=true;var id=++epoch,version=state.version;render();
    function current(){return id===epoch&&state.version===version&&!state.over&&state.turn===E.BLUE;}
    function finish(move){
      if(!current())return;
      clearTimeout(watchdog);if(worker)worker.terminate();worker=null;thinking=false;
      if(!move||!commit(move)){var fallback=E.bestMove(state,E.BLUE,{depth:2});if(fallback)commit(fallback);else render();}
    }
    function fallback(){if(current())finish(E.bestMove(state,E.BLUE,{depth:2}));}
    timer=setTimeout(function(){
      if(!current())return;
      try{
        if(typeof window.Worker!=='function'){fallback();return;}
        worker=new window.Worker('ai-worker.js?v=1');
        worker.onmessage=function(e){if(e.data.id!==id)return;if(e.data.error)fallback();else if(e.data.version===version)finish(e.data.move);};
        worker.onerror=function(e){if(e.preventDefault)e.preventDefault();fallback();};worker.onmessageerror=fallback;
        watchdog=setTimeout(fallback,4000);worker.postMessage({id:id,state:state});
      }catch(error){fallback();}
    },150);
  }
  function play(move){
    if(!canPlay())return false;
    if(mode==='online'){
      if(!E.safeApplyMove(state,side,move).ok)return false;
      pending=true;selected=null;targets=[];parentMessage('move',{move:move,expectedVersion:state.version});render();return true;
    }
    if(commit(move)){scheduleAI();return true;}
    return false;
  }
  function onCell(r,c){
    if(!canPlay())return;
    if(selected&&isTarget(r,c)){play({fr:selected.r,fc:selected.c,tr:r,tc:c});return;}
    var p=state.board[r][c];
    if(p&&E.sideOf(p)===state.turn&&!(selected&&selected.r===r&&selected.c===c)){selected={r:r,c:c};targets=E.movesFor(state.board,r,c);}
    else{selected=null;targets=[];}
    render();
  }
  function reset(){if(mode==='online')return;stopAI();state=E.createInitialState();history=[];selected=null;targets=[];pending=false;shownResult=null;render();}
  function undo(){
    if(mode==='online'||!history.length)return;stopAI();
    var steps=mode==='local'?1:state.turn===E.BLUE?1:2;
    history=history.slice(0,Math.max(0,history.length-steps));state=E.createInitialState();
    for(var i=0;i<history.length;i++)state=E.safeApplyMove(state,state.turn,history[i].move).state;
    selected=null;targets=[];shownResult=null;render();
  }
  document.getElementById('newGame').addEventListener('click',reset);document.getElementById('undo').addEventListener('click',undo);
  document.getElementById('resultClose').addEventListener('click',function(){resultEl.hidden=true;confetti.classList.toggle('show',false);});
  document.getElementById('modeLabel').textContent=mode==='ai'?'人机对战 · 你执红先行':mode==='local'?'本地双人 · 红蓝轮流':'好友同玩';
  if(mode==='online'){
    document.getElementById('newGame').hidden=true;document.getElementById('undo').hidden=true;
    window.addEventListener('message',function(event){
      if(event.source!==window.parent||event.origin!==window.location.origin||!event.data||event.data.channel!=='boardgame:dou-shou-qi:control')return;
      var room=event.data.room;if(!room||!room.state||!Array.isArray(room.history))return;
      if(roomCode===room.code&&state.version>room.state.version)return;
      if(roomCode===room.code&&state.version===room.state.version&&!pending&&ready===(room.status==='playing'))return;
      if(state.version!==room.state.version){selected=null;targets=[];}
      roomCode=room.code;side=room.yourSide;ready=room.status==='playing';state=room.state;history=room.history;pending=false;render();
    });
    parentMessage('ready',{});
  }
  window.addEventListener('pagehide',stopAI);render();boardEl.setAttribute('data-ready','true');
  if(window.__DSQ_TEST_MODE__)window.__DSQ_TEST__={getState:function(){return state;},getHistory:function(){return history;},getSelected:function(){return selected;},getTargets:function(){return targets;},play:play,click:onCell,reset:reset,undo:undo,cells:cells,load:function(next){stopAI();state=next;history=[];selected=null;targets=[];pending=false;shownResult=null;render();}};
})();
