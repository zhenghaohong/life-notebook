import test from 'node:test';
import assert from 'node:assert/strict';
import {SignJWT,generateKeyPair,exportJWK} from 'jose';
import {loginResponse,verifySession} from '../worker/auth.js';
import worker from '../worker/index.js';
const origin='https://life-notebook-api.zhengteshuai.workers.dev';
const env={AUTH_MODE:'session',SESSION_SECRET:'a'.repeat(64),FRONTEND_ORIGIN:'https://zhenghaohong.github.io',ALLOWED_EMAIL:'me@example.com',ACCESS_TEAM_DOMAIN:'session-test.cloudflareaccess.com',ACCESS_AUD:'session-aud',GITHUB_TOKEN:'mock'};
async function mint(overrides={}){return new SignJWT({email:env.ALLOWED_EMAIL,purpose:'notebook-session',...overrides}).setProtectedHeader({alg:'HS256'}).setIssuer(origin).setAudience(env.FRONTEND_ORIGIN).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(env.SESSION_SECRET));}
const req=token=>new Request(origin+'/api/me',{headers:{Origin:env.FRONTEND_ORIGIN,...(token?{Authorization:'Bearer '+token}:{})}});
test('session authenticates without Cookie and rejects tampering, wrong purpose and email',async()=>{
 const token=await mint();assert.equal((await verifySession(req(token),env)).email,env.ALLOWED_EMAIL);
 assert.equal((await worker.fetch(req(token),env)).status,200);
 assert.equal((await worker.fetch(req(),env)).status,401);
 assert.equal((await worker.fetch(req('invalid'),env)).status,401);
 assert.equal((await worker.fetch(req(await mint({purpose:'other'})),env)).status,401);
 assert.equal((await worker.fetch(req(await mint({email:'someone@example.com'})),env)).status,403);
 const expired=await new SignJWT({email:env.ALLOWED_EMAIL,purpose:'notebook-session'}).setProtectedHeader({alg:'HS256'}).setIssuer(origin).setAudience(env.FRONTEND_ORIGIN).setIssuedAt(1).setExpirationTime(2).sign(new TextEncoder().encode(env.SESSION_SECRET));
 assert.equal((await worker.fetch(req(expired),env)).status,401);
 const preflight=await worker.fetch(new Request(origin+'/api/me',{method:'OPTIONS',headers:{Origin:env.FRONTEND_ORIGIN}}),env);
 assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/Authorization/);
});
test('login requires signed Access identity and state, emits session only to fixed opener origin',async()=>{
 const original=globalThis.fetch;const {publicKey,privateKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='login-key';jwk.alg='RS256';
 globalThis.fetch=async()=>Response.json({keys:[jwk]});
 try{
 const access=await new SignJWT({email:env.ALLOWED_EMAIL}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://'+env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setIssuedAt().setExpirationTime('1h').sign(privateKey);
 const state=crypto.randomUUID();const r=await loginResponse(new Request(origin+'/login?state='+state,{headers:{'Cf-Access-Jwt-Assertion':access}}),env);const text=await r.text();
 assert.equal(r.headers.get('Cache-Control'),'no-store');assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 assert.ok(text.includes('window.opener.postMessage'));assert.ok(text.includes(env.FRONTEND_ORIGIN));assert.ok(!text.includes('mock'));
 const message=JSON.parse(text.match(/postMessage\((\{.*?\}),/)[1]);assert.equal(message.state,state);assert.equal((await verifySession(req(message.token),env)).email,env.ALLOWED_EMAIL);
 await assert.rejects(()=>loginResponse(new Request(origin+'/login'),env),e=>e.status===400);
 await assert.rejects(()=>loginResponse(new Request(origin+'/login?state='+state),env),e=>e.status===401);
 }finally{globalThis.fetch=original;}
});
