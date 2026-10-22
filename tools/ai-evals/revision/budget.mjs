import {usage} from '../optimization/budget.mjs';
export {usage};
export const CAPS=Object.freeze({usd:3.61,input:851121,output:59756,generations:45,inputPerCall:20000,outputPerCall:512,iterations:2});
export function authorize(attempts,rates,finalRemaining=18,final=false){
 const used=usage(attempts),reservation={input:20000,output:512,usd:(20000*rates.input+512*rates.output)/1e6};
 const future=Math.max(0,finalRemaining-(final?1:0));
 const hold={input:future*20000,output:future*512,usd:future*.04512,generations:future};
 for(const k of ['usd','input','output','generations'])if(used[k]+(k==='generations'?1:reservation[k])+hold[k]>CAPS[k]+1e-10)throw new Error('STOP_CAP:'+k);
 return reservation;
}
