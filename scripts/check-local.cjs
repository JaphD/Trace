const assert=require('node:assert/strict');
(async()=>{
 const base='http://localhost:3000';
 const health=await fetch(base+'/api/health');assert.equal(health.status,200);assert.equal((await health.json()).localOnly,true);
 const invalid=await fetch(base+'/api/part/not-a-part');assert.equal(invalid.status,400);
 const origin=await fetch(base+'/api/health',{headers:{Origin:'https://untrusted.example'}});assert.equal(origin.status,403);
 const response=await fetch(base+'/api/part/C25804');const payload=await response.json();
 assert.equal(response.status,200);assert.equal(payload.code,200);assert.equal(payload.data.componentCode,'C25804');
 assert.equal(typeof payload.observedAt,'number');
 console.log('PASS: local health, malformed-code rejection, origin protection, live C25804 lookup.');
 console.log('Supplier field names:',Object.keys(payload.data).join(', '));
 console.log('Library/eligibility-related fields:',JSON.stringify(Object.fromEntries(Object.entries(payload.data).filter(([k])=>/lib|economic|standard|smt|preferred|assembly/i.test(k)))));
})().catch(e=>{console.error(e.message);process.exitCode=1;});

