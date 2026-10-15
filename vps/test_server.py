import hashlib, http.client, json, os, tempfile, threading, unittest
from pathlib import Path
from http.server import ThreadingHTTPServer

TEMP=tempfile.TemporaryDirectory()
os.environ['NOTEBOOK_DB']=str(Path(TEMP.name)/'test.sqlite3')
os.environ['NOTEBOOK_ORIGIN']='https://notebook.test'
import server
from store import Store, Conflict

class NotebookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        salt=b'only-a-test-salt'
        with server.STORE.connect() as db:
            db.execute('INSERT INTO credentials VALUES (?,?,?)',(server.USERNAME,salt,server.hash_password('Test!234',salt)))
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        threading.Thread(target=cls.http.serve_forever,daemon=True).start()
    @classmethod
    def tearDownClass(cls):cls.http.shutdown();cls.http.server_close()
    def request(self,method,path,body=None,cookie=None,origin='https://notebook.test'):
        conn=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        headers={'Origin':origin,'Content-Type':'application/json'}
        if cookie:headers['Cookie']=cookie
        conn.request(method,path,json.dumps(body) if body is not None else None,headers)
        response=conn.getresponse();result=(response.status,json.loads(response.read()),dict(response.getheaders()));conn.close();return result
    def test_auth_crud_conflict_month_and_logout(self):
        self.assertEqual(self.request('GET','/api/cost?date=2026-10-15')[0],401)
        self.assertEqual(self.request('POST','/api/login',{'username':server.USERNAME,'password':'wrong123'})[0],401)
        code,login,headers=self.request('POST','/api/login',{'username':server.USERNAME,'password':'Test!234','remember':True})
        self.assertEqual(code,200)
        self.assertIn('HttpOnly',headers['Set-Cookie']);self.assertIn('Max-Age=2592000',headers['Set-Cookie'])
        cookie=headers['Set-Cookie'].split(';')[0]
        item={'id':'one','amountCents':1234,'tag':'餐饮','note':'测试','time':'12:00'}
        self.assertEqual(self.request('PUT','/api/cost?date=2026-10-15',{'sha':None,'data':[item]},cookie,origin='https://evil.test')[0],403)
        code,saved,_=self.request('PUT','/api/cost?date=2026-10-15',{'sha':None,'data':[item]},cookie)
        self.assertEqual(code,200)
        self.assertEqual(self.request('PUT','/api/cost?date=2026-10-15',{'sha':None,'data':[]},cookie)[0],409)
        diary={'zh':'中文\n# Markdown <!-- -->','en':''}
        self.assertEqual(self.request('PUT','/api/daily?date=2026-10-15',{'sha':None,'data':diary},cookie)[0],200)
        code,month,_=self.request('GET','/api/month?date=2026-10',cookie=cookie)
        self.assertEqual(code,200);self.assertEqual(month['data'][0]['cost'][0]['amountCents'],1234)
        self.assertEqual(month['data'][0]['daily'],diary)
        self.assertEqual(self.request('PUT','/api/cost?date=2026-10-15',{'sha':saved['sha'],'data':[]},cookie)[0],200)
        self.assertEqual(self.request('POST','/api/logout',{},cookie)[0],200)
        self.assertEqual(self.request('GET','/api/me',cookie=cookie)[0],401)
    def test_snapshot_exports_roundtrip(self):
        path=Path(TEMP.name)/'roundtrip.sqlite3';store=Store(path)
        store.write('daily','2026-10-10',{'zh':'中文\n# 标题','en':'English'},None)
        root=Path(TEMP.name)/'export';store.export_tree(root)
        other=Store(Path(TEMP.name)/'import.sqlite3');self.assertEqual(other.import_tree(root),1)
        self.assertEqual(other.read('daily','2026-10-10')['data'],store.read('daily','2026-10-10')['data'])
        with self.assertRaises(ValueError):other.import_tree(root)

if __name__=='__main__':unittest.main()
