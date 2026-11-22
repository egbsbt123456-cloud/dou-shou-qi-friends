export type DoushouqiSide='r'|'b';
export interface DoushouqiMove {fr:number;fc:number;tr:number;tc:number}
export interface DoushouqiState {board:(string|null)[][];turn:DoushouqiSide;over:boolean;winner:DoushouqiSide|null;reason:string|null;version:number;lastMove:DoushouqiMove|null}
export interface DoushouqiHistory {move:DoushouqiMove;mover:string;captured:string|null;turnBefore:DoushouqiSide;notation:string}
export interface DoushouqiRoomView {code:string;status:'waiting'|'playing'|'finished'|'cancelled';yourSide:DoushouqiSide;redName:string;blueName:string|null;state:DoushouqiState;history:DoushouqiHistory[];updatedAt:number}
