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
