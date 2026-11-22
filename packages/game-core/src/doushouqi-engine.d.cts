import type { DoushouqiState, DoushouqiMove, DoushouqiSide } from '@board/contracts';
declare const engine: {
 RED:'r';BLUE:'b';ROWS:9;COLS:7;
 NAMES:Record<number,string>;EMOJI:Record<number,string>;
 emptyBoard():(string|null)[][];
 createInitialState(): DoushouqiState;
 movesFor(board:(string|null)[][],row:number,col:number):DoushouqiMove[];
 legalMoves(board:(string|null)[][],side:DoushouqiSide):DoushouqiMove[];
 safeApplyMove(state:DoushouqiState,side:DoushouqiSide,move:DoushouqiMove):{ok:true;state:DoushouqiState}|{ok:false;code:string};
 bestMove(state:DoushouqiState,side:DoushouqiSide,options?:{depth?:number;maxNodes?:number}):DoushouqiMove|null;
};
export = engine;
