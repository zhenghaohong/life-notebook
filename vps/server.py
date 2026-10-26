import hashlib, hmac, http.cookies, json, logging, mimetypes, os, secrets, time
import urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from store import Store, Conflict, valid_date

ROOT=Path(__file__).resolve().parent
ORIGIN=os.environ.get('NOTEBOOK_ORIGIN','https://life.trouvaille.ccwu.cc')
USERNAME=os.environ.get('NOTEBOOK_USERNAME','zhenghaohong')
STORE=Store(os.environ.get('NOTEBOOK_DB','/var/lib/life-notebook/notebook.sqlite3'))
COOKIE='__Host-life-session'

class HTTPError(Exception):
    def __init__(self,status,message):
        self.status,self.message=status,message

def hash_password(password,salt):
    return hashlib.pbkdf2_hmac('sha256',password.encode(),salt,600000)

def authenticate(username,password):
    with STORE.connect() as db:
        row=db.execute('SELECT * FROM credentials WHERE username=?',(USERNAME,)).fetchone()
    salt=row['salt'] if row else b'not-an-account!!'
    digest=hash_password(password,salt)
    return bool(row) and hmac.compare_digest(username.encode(),USERNAME.encode()) and hmac.compare_digest(digest,row['digest'])

class Handler(BaseHTTPRequestHandler):
    server_version='LifeNotebook'
    def log_message(self,format,*args):
        # No request bodies, cookies, passwords or query strings in logs.
        logging.info('%s %s %s',self.command,urllib.parse.urlsplit(self.path).path,args[1] if len(args)>1 else '')
    def reply(self,status,data,extra=None):
        payload=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        for k,v in (extra or {}).items():self.send_header(k,v)
        self.end_headers()
        if not getattr(self,'head_only',False):self.wfile.write(payload)
    def body(self):
        if self.headers.get('Origin')!=ORIGIN:
            raise HTTPError(403,'来源不允许')
        if not self.headers.get('Content-Type','').startswith('application/json'):
            raise HTTPError(400,'请求格式无效')
        try:length=int(self.headers.get('Content-Length','0'))
        except ValueError:raise HTTPError(400,'请求长度无效') from None
        if not 1<=length<=600000:raise HTTPError(413,'请求过大')
        try:return json.loads(self.rfile.read(length))
        except (ValueError,UnicodeError):raise HTTPError(400,'请求格式无效') from None
    def token_digest(self):
        try:
            cookie=http.cookies.SimpleCookie();cookie.load(self.headers.get('Cookie',''))
            token=cookie[COOKIE].value
        except (KeyError,http.cookies.CookieError):return None
        return hashlib.sha256(token.encode()).hexdigest()
    def identity(self):
        with STORE.connect() as db:
            row=db.execute('SELECT username,expires FROM sessions WHERE digest=? AND expires>?',(self.token_digest(),int(time.time()))).fetchone()
        if not row:raise HTTPError(401,'登录已过期，请重新登录')
        return dict(row)
    def login(self):
        body=self.body()
        if not isinstance(body,dict):raise HTTPError(400,'登录格式无效')
        username,password=body.get('username'),body.get('password')
        if not isinstance(username,str) or not isinstance(password,str) or len(username)>100 or not 8<=len(password)<=512:
            raise HTTPError(401,'用户名或密码错误')
        ip=self.headers.get('X-Real-IP',self.client_address[0])
        now=int(time.time())
        with STORE.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT window,count FROM login_attempts WHERE ip=?',(ip,)).fetchone()
            count=row['count']+1 if row and now-row['window']<60 else 1
            window=row['window'] if row and now-row['window']<60 else now
            db.execute('INSERT INTO login_attempts VALUES (?,?,?) ON CONFLICT(ip) DO UPDATE SET window=excluded.window,count=excluded.count',(ip,window,count))
        if count>5:raise HTTPError(429,'尝试次数过多，请一分钟后再试')
        if not authenticate(username,password):raise HTTPError(401,'用户名或密码错误')
        remember=body.get('remember') is True
        duration=2592000 if remember else 1800
        token=secrets.token_urlsafe(32);digest=hashlib.sha256(token.encode()).hexdigest()
        with STORE.connect() as db:
            db.execute('DELETE FROM sessions WHERE expires<=?',(now,))
            db.execute('DELETE FROM sessions WHERE digest=?',(self.token_digest(),))
            db.execute('INSERT INTO sessions VALUES (?,?,?)',(digest,USERNAME,now+duration))
        cookie=COOKIE+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict'
        if remember:cookie+='; Max-Age='+str(duration)
        self.reply(200,{'expiresAt':now+duration,'login':USERNAME},{'Set-Cookie':cookie})
    def dispatch(self):
        url=urllib.parse.urlsplit(self.path);path=url.path
        if path=='/health' and self.command=='GET':
            self.reply(200,{'ok':True});return
        if not path.startswith('/api/'):
            if self.command!='GET':raise HTTPError(405,'方法不允许')
            name='index.html' if path=='/' else path.lstrip('/')
            if name not in ['index.html','app.js','style.css','config.js','reminders.js']:raise HTTPError(404,'页面不存在')
            payload=(ROOT/'web'/name).read_bytes()
            self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(name)[0]+'; charset=utf-8')
            self.send_header('Content-Length',str(len(payload)));self.send_header('Cache-Control','no-cache')
            self.send_header('X-Content-Type-Options','nosniff');self.end_headers()
            if not getattr(self,'head_only',False):self.wfile.write(payload)
            return
        if path=='/api/login' and self.command=='POST':self.login();return
        identity=self.identity()
        if path=='/api/me' and self.command=='GET':
            self.reply(200,{'login':identity['username'],'expiresAt':identity['expires']});return
        if path=='/api/logout' and self.command=='POST':
            self.body()
            with STORE.connect() as db:db.execute('DELETE FROM sessions WHERE digest=?',(self.token_digest(),))
            self.reply(200,{'ok':True},{'Set-Cookie':COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'});return
        if path=='/api/backup-status' and self.command=='GET':
            with STORE.connect() as db:
                state=dict(db.execute("SELECT key,value FROM metadata WHERE key LIKE 'backup_%'"))
            self.reply(200,{'data':state});return
        date=urllib.parse.parse_qs(url.query).get('date',[''])[0]
        if path=='/api/month' and self.command=='GET':self.reply(200,STORE.month(date));return
        kind=path.removeprefix('/api/')
        if kind not in ['cost','daily','tags','reminders']:raise HTTPError(404,'接口不存在')
        if kind in ['tags','reminders']:date=''
        elif not valid_date(date):raise HTTPError(400,'日期无效')
        if self.command=='GET':self.reply(200,STORE.read(kind,date));return
        if self.command=='PUT':
            body=self.body()
            if not isinstance(body,dict) or 'sha' not in body or 'data' not in body:raise HTTPError(400,'数据格式无效')
            self.reply(200,STORE.write(kind,date,body['data'],body['sha']));return
        raise HTTPError(405,'方法不允许')
    def handle_request(self):
        try:self.dispatch()
        except HTTPError as exc:self.reply(exc.status,{'error':exc.message})
        except Conflict as exc:self.reply(409,{'error':str(exc)})
        except ValueError as exc:self.reply(400,{'error':str(exc)})
        except Exception:
            logging.exception('Request failed (no request data logged)')
            self.reply(500,{'error':'服务暂时不可用，未确认保存，请重试'})
    def do_HEAD(self):
        self.head_only=True
        self.command='GET'
        self.handle_request()
    do_GET=handle_request
    do_POST=handle_request
    do_PUT=handle_request

if __name__=='__main__':
    os.umask(0o077)
    logging.basicConfig(level=logging.INFO)
    server=ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('NOTEBOOK_PORT','18765'))),Handler)
    server.daemon_threads=True
    server.serve_forever()
