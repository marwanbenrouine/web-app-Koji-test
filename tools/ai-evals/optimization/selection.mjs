export function compareRuns(previous,candidate,module) {
 const old=previous.results.filter(r=>r.assistant===module),next=candidate.results.filter(r=>r.assistant===module);
 if(old.length!==10||next.length!==10||old.some(r=>!next.some(n=>n.id===r.id)))throw new Error('Unpaired development comparison');
 const oldPass=old.filter(r=>r.passed).length,newPass=next.filter(r=>r.passed).length;
 const regressions=old.filter(r=>r.passed&&!next.find(n=>n.id===r.id).passed).map(r=>r.id);
 const critical=next.filter(r=>r.critical.length).map(r=>({id:r.id,issues:r.critical}));
 const gainPp=(newPass-oldPass)/30*100;
 return {oldPass,newPass,gainPp,regressions,critical,accept:newPass>oldPass&&regressions.length===0&&critical.length===0};
}
export function stopAfterStagnation(iterations) {
 const modified=iterations.filter(i=>!i.noChange);
 return modified.length>=2&&modified.slice(-2).every(i=>i.gainPp<3);
}
