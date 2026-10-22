export const CAPS=Object.freeze({usd:5,input:1500000,output:80000,generations:150,iterations:8,inputPerCall:20000,outputPerCall:512});
export function usage(attempts) {
 return attempts.filter(a=>a.paidReserved).reduce((s,a)=>({usd:s.usd+(a.actual?.usd??a.reservation.usd),input:s.input+(a.actual?.input??a.reservation.input),output:s.output+(a.actual?.output??a.reservation.output),generations:s.generations+1}),{usd:0,input:0,output:0,generations:0});
}
export function authorize(attempts,rates,finalRemaining=45,final=false) {
 const used=usage(attempts), reservation={input:20000,output:512,usd:(20000*rates.input+512*rates.output)/1e6};
 const future=Math.max(0,finalRemaining-(final?1:0));
 const held={input:future*20000,output:future*512,usd:future*(20000*2+512*10)/1e6,generations:future};
 for(const k of ['usd','input','output','generations']) {
  const now=k==='generations'?1:reservation[k];
  if(!Number.isFinite(now)||used[k]+now+held[k]>CAPS[k]+1e-10) throw new Error('STOP_CAP:'+k);
 }
 return reservation;
}
