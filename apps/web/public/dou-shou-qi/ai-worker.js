'use strict';
importScripts('engine.js?v=1');
self.onmessage=function(event){
  var job=event.data;
  try{self.postMessage({id:job.id,version:job.state.version,move:self.DSQ.bestMove(job.state,'b',{depth:4,maxNodes:80000})});}
  catch(error){self.postMessage({id:job.id,error:true});}
};
