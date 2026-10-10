import {createRemoteJWKSet, jwtVerify, SignJWT} from 'jose';
const keysets = new Map();
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function checkEmail(payload, env) {
  if (env.AUTH_MODE === 'password') {
    if (payload.login !== env.LOGIN_USERNAME) throw new HttpError(403, '该账号无权访问');
    return payload;
  }
  if (env.AUTH_MODE === 'github') {
    if (typeof payload.login !== 'string' || payload.login.toLowerCase() !== env.ALLOWED_GITHUB_LOGIN?.toLowerCase()) throw new HttpError(403, '该 GitHub 账号无权访问');
    return payload;
  }
  if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) {
    throw new HttpError(403, '该账号无权访问');
  }
  return payload;
}
export async function verifyAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, '请先登录');
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  if (!keysets.has(issuer)) keysets.set(issuer, createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs')));
  let payload;
  try { ({payload} = await jwtVerify(token, keysets.get(issuer), {issuer, audience: env.ACCESS_AUD, algorithms: ['RS256']})); }
  catch { throw new HttpError(401, '登录已过期'); }
  return checkEmail(payload, env);
}
function secret(env) {
  const value = env.SESSION_SECRET || (['github','password'].includes(env.AUTH_MODE) ? env.GITHUB_OAUTH_SECRET : '');
  if (!value || value.length < 32) throw new HttpError(503, '会话密钥尚未配置');
  return new TextEncoder().encode(value);
}
export async function passwordLogin(request, env) {
  if (!env.LOGIN_USERNAME || !env.LOGIN_PASSWORD || env.LOGIN_PASSWORD.length < 16 || !env.LOGIN_RATE_LIMIT) throw new HttpError(503, '账号登录尚未配置完成');
  if (request.headers.get('Origin') !== env.FRONTEND_ORIGIN || !request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(403, '登录来源无效');
  const limited = await env.LOGIN_RATE_LIMIT.limit({key:'login:'+(request.headers.get('CF-Connecting-IP') || 'unknown')});
  if (!limited.success) throw new HttpError(429, '尝试过于频繁，请一分钟后重试');
  const raw = await request.text();
  if (raw.length > 2048) throw new HttpError(413, '登录请求过大');
  let body; try {body=JSON.parse(raw);} catch {throw new HttpError(400, '登录格式无效');}
  if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 512) throw new HttpError(400, '请输入用户名和密码');
  const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const [given,expected] = await Promise.all([digest(body.password),digest(env.LOGIN_PASSWORD)]);
  let diff=0; for(let i=0;i<given.length;i++)diff |= given[i]^expected[i];
  if (diff || body.username !== env.LOGIN_USERNAME) throw new HttpError(401, '用户名或密码错误');
  const expiresAt = Math.floor(Date.now()/1000)+1800;
  const token = await new SignJWT({login:env.LOGIN_USERNAME,purpose:'notebook-session'})
    .setProtectedHeader({alg:'HS256'}).setIssuer(new URL(request.url).origin).setAudience(env.FRONTEND_ORIGIN)
    .setSubject(env.LOGIN_USERNAME).setIssuedAt().setExpirationTime(expiresAt).sign(secret(env));
  return {token,expiresAt,login:env.LOGIN_USERNAME};
}
export async function verifySession(request, env) {
  const key = secret(env);
  const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) throw new HttpError(401, '请先登录');
  let payload;
  try {
    ({payload} = await jwtVerify(token, key, {
      issuer: new URL(request.url).origin, audience: env.FRONTEND_ORIGIN, algorithms: ['HS256'], maxTokenAge: '30m'
    }));
    if (payload.purpose !== 'notebook-session') throw new Error('wrong purpose');
  } catch { throw new HttpError(401, '登录已过期，请重新登录'); }
  return checkEmail(payload, env);
}
export async function loginResponse(request, env) {
  const url = new URL(request.url), state = url.searchParams.get('state');
  if (!/^[a-zA-Z0-9-]{32,100}$/.test(state || '')) throw new HttpError(400, '请从网站设置页面发起登录');
  const identity = await verifyAccess(request, env);
  const expiresAt = Math.floor(Date.now()/1000) + 1800;
  const token = await new SignJWT({email: identity.email, purpose: 'notebook-session'})
    .setProtectedHeader({alg: 'HS256'}).setIssuer(url.origin).setAudience(env.FRONTEND_ORIGIN)
    .setSubject(identity.sub || identity.email).setIssuedAt().setExpirationTime(expiresAt).sign(secret(env));
  return deliverSession(request, env, {type: 'life-session', state, token, expiresAt});
}
function deliverSession(request, env, message, cookie) {
  const cspNonce = crypto.randomUUID();
  const js = value => JSON.stringify(value).replace(/</g, '\\u003c');
  // No credentials are placed in URLs, browser storage, or public source files.
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录日常</title><body><h1>身份验证成功</h1><p id="result">正在返回日常…</p><script nonce="${cspNonce}">if(window.opener){window.opener.postMessage(${js(message)},${js(env.FRONTEND_ORIGIN)});document.getElementById('result').textContent='已完成。请返回日常页面，此窗口可以关闭。';setTimeout(()=>window.close(),1000);}else{document.getElementById('result').textContent='登录窗口与网站的连接已断开。请关闭此窗口，返回网站设置页面重新点击登录，并允许弹出窗口。';}</script></body></html>`, {
    headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${cspNonce}'; base-uri 'none'; frame-ancestors 'none'`,
      'X-Content-Type-Options': 'nosniff', ...(cookie ? {'Set-Cookie': cookie} : {})}
  });
}

export async function githubLogin(request, env) {
  const url = new URL(request.url), state = url.searchParams.get('state');
  if (!/^[a-zA-Z0-9-]{32,100}$/.test(state || '')) throw new HttpError(400, '请从网站发起登录');
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.ALLOWED_GITHUB_LOGIN) throw new HttpError(503, 'GitHub 登录尚未配置');
  const providerState = crypto.randomUUID();
  const signed = await new SignJWT({purpose:'oauth-state',clientState:state,providerState})
    .setProtectedHeader({alg:'HS256'}).setIssuer(url.origin).setAudience(url.origin)
    .setIssuedAt().setExpirationTime('10m').sign(secret(env));
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', url.origin+'/callback');
  authorize.searchParams.set('state', providerState);
  // No repo scope: the OAuth app is only used to identify the signed-in account.
  return new Response(null, {status:302,headers:{Location:authorize.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
    'Set-Cookie':`__Host-life-oauth=${signed}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`}});
}

export async function githubCallback(request, env) {
  const url = new URL(request.url), code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code || code.length>500 || !state) throw new HttpError(400, 'GitHub 登录被取消或返回无效');
  const cookie = request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-life-oauth='))?.slice(18);
  let stored;
  try {
    ({payload:stored}=await jwtVerify(cookie,secret(env),{issuer:url.origin,audience:url.origin,algorithms:['HS256'],maxTokenAge:'10m'}));
    if(stored.purpose!=='oauth-state'||stored.providerState!==state||typeof stored.clientState!=='string')throw new Error();
  } catch {throw new HttpError(401,'登录校验失败，请从网站重新登录');}
  const exchange=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json','User-Agent':'life-notebook'},body:JSON.stringify({client_id:env.GITHUB_OAUTH_CLIENT_ID,client_secret:env.GITHUB_OAUTH_SECRET,code,redirect_uri:url.origin+'/callback'})});
  if(!exchange.ok)throw new HttpError(502,'GitHub 登录暂时不可用');
  const result=await exchange.json();if(typeof result.access_token!=='string')throw new HttpError(401,'GitHub 登录授权失败，请重试');
  const userResponse=await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+result.access_token,Accept:'application/vnd.github+json','User-Agent':'life-notebook','X-GitHub-Api-Version':'2022-11-28'}});
  if(!userResponse.ok)throw new HttpError(502,'无法验证 GitHub 账号');
  const user=await userResponse.json();checkEmail({login:user.login},env);
  const expiresAt=Math.floor(Date.now()/1000)+1800;
  const token=await new SignJWT({login:user.login,purpose:'notebook-session'}).setProtectedHeader({alg:'HS256'})
    .setIssuer(url.origin).setAudience(env.FRONTEND_ORIGIN).setSubject(String(user.id)).setIssuedAt().setExpirationTime(expiresAt).sign(secret(env));
  return deliverSession(request,env,{type:'life-session',state:stored.clientState,token,expiresAt},'__Host-life-oauth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
}
