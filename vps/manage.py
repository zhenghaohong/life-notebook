"""Run as the notebook user. Password input is hidden and never written to logs."""
import argparse, getpass, hashlib, os, secrets
from store import Store

parser=argparse.ArgumentParser()
parser.add_argument('command',choices=['set-password','check'])
args=parser.parse_args()
os.umask(0o077)
store=Store(os.environ.get('NOTEBOOK_DB','/var/lib/life-notebook/notebook.sqlite3'))
if args.command=='check':
    with store.connect() as db:
        print('SQLite integrity:',db.execute('PRAGMA integrity_check').fetchone()[0])
        print('Expenses:',db.execute('SELECT count(*) FROM expenses').fetchone()[0])
        print('Diaries:',db.execute('SELECT count(*) FROM diaries').fetchone()[0])
else:
    password=getpass.getpass('New password (at least 8 characters): ')
    if len(password)<8 or len(password)>512 or password!=getpass.getpass('Repeat password: '):
        raise SystemExit('Password not changed')
    salt=secrets.token_bytes(16)
    digest=hashlib.pbkdf2_hmac('sha256',password.encode(),salt,600000)
    with store.connect() as db:
        db.execute('INSERT INTO credentials VALUES (?,?,?) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt,digest=excluded.digest',(os.environ.get('NOTEBOOK_USERNAME','zhenghaohong'),salt,digest))
        db.execute('DELETE FROM sessions')
    print('Password changed; previous sessions revoked')
