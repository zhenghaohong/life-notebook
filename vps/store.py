"""SQLite is the only live data store. JSON/Markdown are backup formats only."""
import datetime, json, re, sqlite3
from contextlib import contextmanager
from pathlib import Path

DEFAULT_TAGS = ['餐饮', '交通', '购物', '生活', '其他']

class Conflict(Exception):
    pass

def valid_date(value):
    try:
        return bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', value)) and datetime.date.fromisoformat(value).isoformat() == value
    except (ValueError, TypeError):
        return False

def validate(kind, data):
    if kind == 'cost':
        if not isinstance(data, list) or len(data) > 1000:
            raise ValueError('记录数量无效')
        ids = set()
        for x in data:
            if not isinstance(x, dict):
                raise ValueError('账单字段无效')
            ident = x.get('id', '')
            if not isinstance(ident, str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}', ident) or ident in ids:
                raise ValueError('账单 ID 无效')
            ids.add(ident)
            if type(x.get('amountCents')) is not int or not 1 <= x['amountCents'] <= 9999999900:
                raise ValueError('金额无效')
            if not isinstance(x.get('tag'), str) or not x['tag'].strip() or len(x['tag']) > 40:
                raise ValueError('标签无效')
            if not isinstance(x.get('note'), str) or len(x['note']) > 500 or not isinstance(x.get('time'), str) or not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', x['time']):
                raise ValueError('账单字段无效')
    elif kind == 'daily':
        if not isinstance(data, dict) or not all(isinstance(data.get(k), str) for k in ('zh','en')) or len(data['zh']) + len(data['en']) > 100000:
            raise ValueError('日记字段无效')
    elif kind == 'tags':
        if not isinstance(data, list) or len(data) > 100 or any(not isinstance(x,str) or not x.strip() or len(x)>40 for x in data) or len(set(data)) != len(data):
            raise ValueError('标签无效')
    elif kind == 'reminders':
        if not isinstance(data,list) or len(data)>2000:
            raise ValueError('备忘事项最多保存 2000 项')
        ids=set()
        for x in data:
            if not isinstance(x,dict) or not isinstance(x.get('id'),str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',x['id']) or x['id'] in ids:
                raise ValueError('备忘事项 ID 无效')
            ids.add(x['id'])
            if not isinstance(x.get('title'),str) or not x['title'].strip() or len(x['title'])>120:
                raise ValueError('事项名称不能为空，最多 120 字')
            if not valid_date(x.get('dueDate')) or not isinstance(x.get('note'),str) or len(x['note'])>2000 or type(x.get('completed')) is not bool:
                raise ValueError('备忘事项日期或内容无效')
    else:
        raise ValueError('类型无效')
    return data

class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS expenses(date TEXT NOT NULL,id TEXT NOT NULL,amountCents INTEGER NOT NULL,tag TEXT NOT NULL,note TEXT NOT NULL,time TEXT NOT NULL,PRIMARY KEY(date,id));
                CREATE INDEX IF NOT EXISTS expenses_date ON expenses(date);
                CREATE TABLE IF NOT EXISTS diaries(date TEXT PRIMARY KEY,zh TEXT NOT NULL,en TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS tags(position INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL);
                CREATE TABLE IF NOT EXISTS revisions(kind TEXT NOT NULL,date TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(kind,date));
                CREATE TABLE IF NOT EXISTS credentials(username TEXT PRIMARY KEY,salt BLOB NOT NULL,digest BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY,username TEXT NOT NULL,expires INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS login_attempts(ip TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY,title TEXT NOT NULL,due_date TEXT NOT NULL,note TEXT NOT NULL,completed INTEGER NOT NULL CHECK(completed IN (0,1)));
            ''')
            if not db.execute("SELECT 1 FROM revisions WHERE kind='tags'").fetchone():
                db.executemany('INSERT INTO tags VALUES (?,?)', enumerate(DEFAULT_TAGS))
                db.execute("INSERT INTO revisions VALUES ('tags','',1)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA synchronous=FULL')
        try:
            with db:
                yield db
        finally:
            db.close()

    def read(self, kind, date='', db=None):
        if db is None:
            with self.connect() as conn:
                return self.read(kind,date,conn)
        rev = db.execute('SELECT revision FROM revisions WHERE kind=? AND date=?',(kind,date)).fetchone()
        if kind == 'cost':
            data = [dict(x) for x in db.execute('SELECT id,amountCents,tag,note,time FROM expenses WHERE date=? ORDER BY time,id',(date,))]
        elif kind == 'daily':
            row = db.execute('SELECT zh,en FROM diaries WHERE date=?',(date,)).fetchone()
            data = dict(row) if row else {'zh':'','en':''}
        elif kind == 'reminders':
            data=[{**dict(x),'completed':bool(x['completed'])} for x in db.execute('SELECT id,title,due_date AS dueDate,note,completed FROM reminders ORDER BY due_date,id')]
        else:
            data = [x[0] for x in db.execute('SELECT name FROM tags ORDER BY position')]
        return {'data':data,'sha':str(rev[0]) if rev else None}

    def write(self,kind,date,data,revision):
        validate(kind,data)
        if kind not in ('tags','reminders') and not valid_date(date):
            raise ValueError('日期无效')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing=self.read(kind,date,db)
            if existing['sha'] != revision:
                raise Conflict('其他设备已修改，请重新加载后再保存')
            if kind == 'cost':
                db.execute('DELETE FROM expenses WHERE date=?',(date,))
                db.executemany('INSERT INTO expenses VALUES (?,?,?,?,?,?)',[(date,x['id'],x['amountCents'],x['tag'],x['note'],x['time']) for x in data])
            elif kind == 'daily':
                db.execute('INSERT INTO diaries VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET zh=excluded.zh,en=excluded.en',(date,data['zh'],data['en']))
            elif kind == 'reminders':
                db.execute('DELETE FROM reminders')
                db.executemany('INSERT INTO reminders VALUES (?,?,?,?,?)',[(x['id'],x['title'],x['dueDate'],x['note'],int(x['completed'])) for x in data])
            else:
                db.execute('DELETE FROM tags')
                db.executemany('INSERT INTO tags VALUES (?,?)',enumerate(data))
            rev=int(existing['sha'] or '0')+1
            db.execute('INSERT INTO revisions VALUES (?,?,?) ON CONFLICT(kind,date) DO UPDATE SET revision=excluded.revision',(kind,date,rev))
            return {'data':data,'sha':str(rev)}

    def month(self,month):
        if not re.fullmatch(r'\d{4}-\d{2}',month) or not valid_date(month+'-01'):
            raise ValueError('月份无效')
        with self.connect() as db:
            db.execute('BEGIN')
            dates=[x[0] for x in db.execute("SELECT date FROM expenses WHERE date LIKE ? UNION SELECT date FROM diaries WHERE date LIKE ? ORDER BY date DESC",(month+'-%',month+'-%'))]
            return {'data':[{'date':d,'cost':self.read('cost',d,db)['data'],'daily':self.read('daily',d,db)['data']} for d in dates]}

    def import_tree(self,root):
        root=Path(root)
        with self.connect() as db:
            if db.execute("SELECT 1 FROM metadata WHERE key='migration_complete'").fetchone():
                raise ValueError('数据已经迁移，拒绝重复导入')
            if db.execute("SELECT 1 FROM revisions WHERE kind!='tags'").fetchone():
                raise ValueError('数据库已有记录，拒绝覆盖')
        count=0
        for kind,ext in [('cost','json'),('daily','md')]:
            for p in sorted((root/kind).rglob('*.'+ext)):
                date=p.stem
                if not valid_date(date):
                    raise ValueError('导入文件日期无效')
                text=p.read_text(encoding='utf-8')
                if kind=='cost':
                    data=json.loads(text)
                else:
                    line=text.split('\n')[0]
                    if not line.startswith('<!-- life-notebook:') or not line.endswith(' -->'):
                        raise ValueError('日记格式无法识别')
                    data=json.loads(line[19:-4])
                self.write(kind,date,data,None)
                count+=1
        p=root/'settings/tags.json'
        if p.exists():
            self.write('tags','',json.loads(p.read_text(encoding='utf-8')),self.read('tags')['sha'])
        p=root/'settings/reminders.json'
        if p.exists():
            self.write('reminders','',json.loads(p.read_text(encoding='utf-8')),None)
        with self.connect() as db:
            db.execute("INSERT INTO metadata VALUES ('migration_complete',?)",(str(count),))
        return count

    def export_tree(self,root):
        root=Path(root)
        # All exports use one read transaction, so daily data and tags form a consistent snapshot.
        with self.connect() as db:
            db.execute('BEGIN')
            for kind,date in db.execute("SELECT kind,date FROM revisions WHERE kind IN ('cost','daily')"):
                data=self.read(kind,date,db)['data']
                p=root/kind/date[:4]/date[5:7]/(date+('.json' if kind=='cost' else '.md'))
                p.parent.mkdir(parents=True,exist_ok=True)
                if kind=='cost':
                    text=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
                else:
                    text='<!-- life-notebook:'+json.dumps(data,ensure_ascii=False,separators=(',',':'))+' -->\n\n# 中文\n\n'+data['zh']+'\n\n# English\n\n'+data['en']+'\n'
                p.write_text(text,encoding='utf-8')
            p=root/'settings/tags.json'
            p.parent.mkdir(parents=True,exist_ok=True)
            p.write_text(json.dumps(self.read('tags','',db)['data'],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
            p=root/'settings/reminders.json'
            p.write_text(json.dumps(self.read('reminders','',db)['data'],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
