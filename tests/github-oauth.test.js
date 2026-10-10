import test from 'node:test';import assert from 'node:assert/strict';
import {githubLogin,githubCallback,verifySession} from '../worker/auth.js';
const origin='https://life-notebook-api.zhengteshuai.workers.dev';
const env={AUTH_MODE:'github',GITHUB_OAUTH_CLIENT_ID:'public-client',GITHUB_OAUTH_SECRET:'f'.repeat(40),ALLOWED_GITHUB_LOGIN:'zhenghaohong',FRONTEND_ORIGIN:'https://zhenghaohong.github.io'};
test('GitHub OAuth validates state, cookie and account; no repo scope or upstream token in browser',async()=>{
 const state=crypto.randomUUID();const login=await githubLogin(new Request(origin+'/login?state='+state),env);
 assert.equal(login.status,302);const url=new URL(login.headers.get('Location'));assert.equal(url.searchParams.get('scope'),null);
 const cookie=login.headers.get('Set-Cookie').split(';')[0];assert.match(login.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async input=>{calls++;return String(input).includes('access_token')?Response.json({access_token:'upstream-secret'}):Response.json({login:'zhenghaohong',id:12345});};
 const callback=(s=url.searchParams.get('state'),c=cookie)=>new Request(origin+'/callback?code=one-time-code&state='+s,{headers:c?{Cookie:c}:{}});
 try{
  await assert.rejects(()=>githubCallback(callback('wrong'),env),e=>e.status===401);assert.equal(calls,0);
  await assert.rejects(()=>githubCallback(callback(undefined,''),env),e=>e.status===401);
  const response=await githubCallback(callback(),env),html=await response.text();assert.ok(!html.includes('upstream-secret'));assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);
  const message=JSON.parse(html.match(/postMessage\((\{.*?\}),/)[1]);assert.equal(message.state,state);
  const session=await verifySession(new Request(origin+'/api/me',{headers:{Authorization:'Bearer '+message.token}}),env);assert.equal(session.login,'zhenghaohong');
  globalThis.fetch=async input=>String(input).includes('access_token')?Response.json({access_token:'upstream-secret'}):Response.json({login:'someone-else',id:999});
  await assert.rejects(()=>githubCallback(callback(),env),e=>e.status===403);
 }finally{globalThis.fetch=original;}
});
