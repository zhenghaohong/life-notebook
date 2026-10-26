import json, sqlite3, tempfile, unittest
from pathlib import Path
from store import Store, Conflict, validate

class RemindersTest(unittest.TestCase):
    def test_migration_preserves_old_data_and_reminders_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'notebook.sqlite3'
            original=Store(path)
            original.write('daily','2026-10-15',{'zh':'existing diary','en':''},None)
            # Emulate the deployed schema before reminders existed.
            with original.connect() as db:db.execute('DROP TABLE reminders')
            store=Store(path)
            self.assertEqual(store.read('daily','2026-10-15')['data']['zh'],'existing diary')
            self.assertEqual(store.read('reminders'),{'data':[],'sha':None})
            item={'id':'task-1','title':'到期事项','dueDate':'2026-10-24','note':'中文备注','completed':False}
            saved=store.write('reminders','',[item],None)
            self.assertEqual(store.read('reminders')['data'],[item])
            with self.assertRaises(Conflict):store.write('reminders','',[],None)
            completed={**item,'completed':True}
            saved=store.write('reminders','',[completed],saved['sha'])
            self.assertTrue(store.read('reminders')['data'][0]['completed'])
            store.write('reminders','',[item],saved['sha'])
            self.assertFalse(Store(path).read('reminders')['data'][0]['completed'])
            root=Path(tmp)/'export';store.export_tree(root)
            self.assertEqual(json.loads((root/'settings/reminders.json').read_text(encoding='utf-8')),[item])
            restored=Store(Path(tmp)/'restored.sqlite3');restored.import_tree(root)
            self.assertEqual(restored.read('reminders')['data'],[item])
            self.assertEqual(restored.read('daily','2026-10-15')['data']['zh'],'existing diary')
    def test_invalid_dates_duplicate_ids_and_invalid_completed_rejected(self):
        item={'id':'task-1','title':'test','dueDate':'2026-10-24','note':'','completed':False}
        for bad in [{**item,'dueDate':'2026-02-30'},{**item,'completed':'false'},{**item,'title':'   '}]:
            with self.assertRaises(ValueError):validate('reminders',[bad])
        with self.assertRaises(ValueError):validate('reminders',[item,item])

if __name__=='__main__':unittest.main()
