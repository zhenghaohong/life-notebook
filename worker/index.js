import {HttpError,verifyAccess,verifySession,loginResponse,githubLogin,githubCallback} from './auth.js';
import {defaults,filePath,validate,encodeDiary,decodeDiary} from './model.js';

function encode(text){const bytes=new TextEncoder().encode(text);let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
function decode(text){return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g,'')),x=>x.charCodeAt(0)));}
async function github(env,path,method='GET',body){const url=`https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${path}${method==='GET'?'?ref='+encodeURIComponent(env.GITHUB_BRANCH):''}`;const r=await fetch(url,{method,headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'life-notebook','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(r.status===404&&method==='GET'){if(path){await github(env,'');return null;}throw new HttpError(502,'数据仓库或分支不可访问');}if(!r.ok)throw new HttpError([409,422].includes(r.status)?409:502,[409,422].includes(r.status)?'文件已更新，请重新加载后再保存':'GitHub 请求失败，请检查仓库配置或 API 配额');return r.json();}
async function read(env,path,kind){const f=await github(env,path);if(!f)return {data:kind==='cost'?[]:kind==='tags'?defaults:{zh:'',en:''},sha:null};if(f.type!=='file'||f.encoding!=='base64')throw new HttpError(502,'文件格式不支持');const text=decode(f.content);return {sha:f.sha,data:kind==='daily'?decodeDiary(text):validate(kind,JSON.parse(text))};}
export default {async fetch(request,env){const origin=request.headers.get('Origin');const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};if(origin===env.FRONTEND_ORIGIN){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Credentials']='true';}const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});try{
 const u=new URL(request.url);
 if(origin&&origin!==env.FRONTEND_ORIGIN)throw new HttpError(403,'来源不允许');
 if(request.method==='OPTIONS'){return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}});}
 if(env.AUTH_MODE!=='github'&&(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD||!env.ALLOWED_EMAIL||!env.GITHUB_TOKEN))throw new HttpError(503,'服务端尚未配置完成');
 if(u.pathname==='/callback'&&request.method==='GET'&&env.AUTH_MODE==='github')return await githubCallback(request,env);
 if(u.pathname==='/login'&&request.method==='GET'){if(env.AUTH_MODE==='github')return await githubLogin(request,env);if(env.AUTH_MODE==='session')return await loginResponse(request,env);await verifyAccess(request,env);return Response.redirect(env.FRONTEND_ORIGIN,302);}
 const payload=['session','github'].includes(env.AUTH_MODE)?await verifySession(request,env):await verifyAccess(request,env);
 if(u.pathname==='/api/me'&&request.method==='GET')return respond({email:payload.email,login:payload.login});
 const match=u.pathname.match(/^\/api\/(cost|daily|tags)$/);if(!match)throw new HttpError(404,'接口不存在');const kind=match[1];let path;try{path=kind==='tags'?'settings/tags.json':filePath(kind,u.searchParams.get('date')||'');}catch{throw new HttpError(400,'日期无效');}
 if(request.method==='GET')return respond(await read(env,path,kind));
 if(request.method!=='PUT')throw new HttpError(405,'方法不允许');
 if(origin!==env.FRONTEND_ORIGIN||!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HttpError(403,'保存请求来源无效');
 const raw=await request.text();if(new TextEncoder().encode(raw).length>600000)throw new HttpError(413,'文件过大');let body;try{body=JSON.parse(raw);validate(kind,body.data);if(body.sha!==null&&typeof body.sha!=='string')throw new Error();}catch{throw new HttpError(400,'数据格式无效');}
 const existing=await read(env,path,kind);if(existing.sha!==body.sha)throw new HttpError(409,'其他设备已修改此文件，请重新加载后再保存');
 const content=kind==='daily'?encodeDiary(body.data):JSON.stringify(body.data,null,2)+'\n';const result=await github(env,path,'PUT',{message:`Update ${path}`,content:encode(content),branch:env.GITHUB_BRANCH,...(body.sha?{sha:body.sha}:{})});return respond({data:body.data,sha:result.content.sha});
 }catch(e){return respond({error:e.status?e.message:'服务暂时不可用'},e.status||500);}}};



