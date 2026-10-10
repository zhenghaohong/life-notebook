import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
const origin='https://zhenghaohong.github.io';
const env={AUTH_MODE:'password',LOGIN_USERNAME:'zhenghaohong',LOGIN_PASSWORD:'test-only-password-42!',SESSION_SECRET:'test-only-session-secret-1234567890',FRONTEND_ORIGIN:origin,LOGIN_RATE_LIMIT:{limit:async()=>({success:true})}};
const login=(body,extra={})=>worker.fetch(new Request('https://example.workers.dev/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),{...env,...extra});
test('password login issues scoped session; wrong password, origin, missing limiter and rate limit fail closed',async()=>{
 const r=await login({username:env.LOGIN_USERNAME,password:env.LOGIN_PASSWORD});assert.equal(r.status,200);const s=await r.json();assert.ok(s.token);assert.ok(!JSON.stringify(s).includes(env.LOGIN_PASSWORD));
 const me=await worker.fetch(new Request('https://example.workers.dev/api/me',{headers:{Origin:origin,Authorization:'Bearer '+s.token}}),env);assert.equal(me.status,200);assert.equal((await me.json()).login,env.LOGIN_USERNAME);
 assert.equal((await login({username:env.LOGIN_USERNAME,password:'wrong'})).status,401);
 assert.equal((await login({username:'other',password:env.LOGIN_PASSWORD})).status,401);
 assert.equal((await login({username:env.LOGIN_USERNAME,password:env.LOGIN_PASSWORD},{LOGIN_RATE_LIMIT:null})).status,503);
 assert.equal((await login({username:env.LOGIN_USERNAME,password:env.LOGIN_PASSWORD},{LOGIN_RATE_LIMIT:{limit:async()=>({success:false})}})).status,429);
 const foreign=await worker.fetch(new Request('https://example.workers.dev/api/login',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:'{}'}),env);assert.equal(foreign.status,403);
});

test('remember choice grants thirty days only for boolean true; ordinary login stays thirty minutes',async()=>{
 for(const [remember,seconds] of [[true,2592000],[false,1800],['true',1800]]){
  const response=await login({username:env.LOGIN_USERNAME,password:env.LOGIN_PASSWORD,remember});const session=await response.json();const payload=JSON.parse(Buffer.from(session.token.split('.')[1],'base64url').toString());assert.equal(payload.exp-payload.iat,seconds);
  const me=await worker.fetch(new Request('https://example.workers.dev/api/me',{headers:{Origin:origin,Authorization:'Bearer '+session.token}}),env);assert.equal(me.status,200);
 }
});

test('configuration errors identify missing and short password without revealing it',async()=>{
 const missing=await login({}, {LOGIN_PASSWORD:''});assert.equal(missing.status,503);assert.match((await missing.json()).error,/LOGIN_PASSWORD/);
 const short=await login({}, {LOGIN_PASSWORD:'short'});assert.equal(short.status,503);assert.match((await short.json()).error,/16/);
});
