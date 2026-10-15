import importlib, os, sqlite3, tempfile, unittest
from pathlib import Path
from store import Store

@unittest.skipUnless(os.name=='posix','Backup scheduler runs on Linux')
class BackupTest(unittest.TestCase):
    def test_consistent_backup_excludes_credentials_and_can_restore(self):
        backup=importlib.import_module('backup')
        with tempfile.TemporaryDirectory() as tmp:
            data=Path(tmp);store=Store(data/'notebook.sqlite3')
            store.write('cost','2026-10-15',[{'id':'a','amountCents':1250,'tag':'餐饮','note':'测试','time':'12:00'}],None)
            store.write('daily','2026-10-15',{'zh':'中文 Markdown','en':''},None)
            marker=b'never-include-this-secret-marker'
            with store.connect() as db:
                db.execute("INSERT INTO metadata VALUES ('migration_complete','2')")
                db.execute('INSERT INTO credentials VALUES (?,?,?)',('owner',marker,marker))
                db.execute('INSERT INTO sessions VALUES (?,?,?)',('secret-session','owner',9999999999))
            original=(backup.DATA,backup.REPO,backup.git)
            calls=[]
            def fake_git(*args):
                calls.append(args)
                if args[0]=='clone':(data/'github-backup').mkdir()
                if args[0]=='rev-list':return '0'
                if args[0]=='status':return 'M cost'
                return ''
            backup.DATA=data;backup.REPO=data/'github-backup';backup.git=fake_git
            try:
                backup.run()
                snapshot_time=(data/'export-snapshot.sqlite3').stat().st_mtime_ns
                calls.clear()
                # Logins and saving identical business data must not trigger a backup.
                with store.connect() as db:
                    db.execute('UPDATE sessions SET expires=expires+1')
                cost=store.read('cost','2026-10-15')
                store.write('cost','2026-10-15',cost['data'],cost['sha'])
                backup.run()
                self.assertEqual(calls,[])
                self.assertEqual((data/'export-snapshot.sqlite3').stat().st_mtime_ns,snapshot_time)
                self.assertIn(marker,(data/'notebook.sqlite3').read_bytes())
                diary=store.read('daily','2026-10-15')
                store.write('daily','2026-10-15',{'zh':'changed','en':''},diary['sha'])
                backup.run()
                self.assertIn(('push','origin','HEAD:main'),calls)
                calls.clear()
                # Simulate a process interrupted after beginning a backup.
                backup.state(store,'pending','1')
                backup.run()
                self.assertIn(('push','origin','HEAD:main'),calls)
            finally:backup.DATA,backup.REPO,backup.git=original
            snapshot=data/'github-backup/database/notebook-data.sqlite3'
            self.assertNotIn(marker,snapshot.read_bytes())
            db=sqlite3.connect(snapshot)
            try:
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                self.assertEqual(db.execute('SELECT count(*) FROM credentials').fetchone()[0],0)
                self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0],0)
                self.assertEqual(db.execute('SELECT sum(amountCents) FROM expenses').fetchone()[0],1250)
            finally:db.close()
            self.assertTrue((data/'github-backup/cost/2026/10/2026-10-15.json').exists())
            self.assertTrue((data/'github-backup/daily/2026/10/2026-10-15.md').exists())
            self.assertIn(('push','origin','HEAD:main'),calls)

if __name__=='__main__':unittest.main()
