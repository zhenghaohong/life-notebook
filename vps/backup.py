"""Nightly SQLite snapshot + JSON/Markdown export into a private Git repository."""
import datetime, fcntl, hashlib, os, sqlite3, subprocess, time
from pathlib import Path
from store import Store

DATA=Path(os.environ.get('NOTEBOOK_DATA','/var/lib/life-notebook'))
REPO=DATA/'github-backup'
SSH='ssh -i '+str(DATA/'backup_ed25519')+' -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='+str(DATA/'github_known_hosts')
ENV={**os.environ,'GIT_SSH_COMMAND':SSH,'GIT_TERMINAL_PROMPT':'0'}

def git(*args):
    return subprocess.run(['git',*args],cwd=REPO if REPO.exists() else DATA,env=ENV,check=True,capture_output=True,text=True,timeout=120).stdout.strip()

def state(store,key,value):
    with store.connect() as db:
        db.execute('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('backup_'+key,value))

def run():
    os.umask(0o077)
    DATA.mkdir(parents=True,exist_ok=True)
    with (DATA/'backup.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        store=Store(DATA/'notebook.sqlite3')
        now=datetime.datetime.now(datetime.timezone.utc).isoformat()
        state(store,'attempt',now)
        try:
            with store.connect() as db:
                if not db.execute("SELECT 1 FROM metadata WHERE key='migration_complete'").fetchone():
                    raise RuntimeError('Data migration not complete; refusing backup')
            if not REPO.exists():
                git('clone','--branch','main','git@github.com:zhenghaohong/life-private-data.git',str(REPO))
            git('fetch','origin','main')
            # Never force-push or reset data. Recover a previous failed push first;
            # divergent branches must be reviewed instead of merging silently.
            ahead=git('rev-list','--count','origin/main..HEAD')
            behind=git('rev-list','--count','HEAD..origin/main')
            if ahead!='0' and behind!='0':
                raise RuntimeError('Backup branch diverged; manual review required')
            if ahead!='0':git('push','origin','HEAD:main')
            if behind!='0':git('merge','--ff-only','origin/main')
            # One coherent SQLite online snapshot, without sessions/password hashes.
            snapshot=DATA/'export-snapshot.sqlite3'
            with store.connect() as source,sqlite3.connect(snapshot) as dest:
                source.backup(dest)
                dest.execute('PRAGMA secure_delete=ON')
                dest.execute('DELETE FROM credentials')
                dest.execute('DELETE FROM sessions')
                dest.execute('DELETE FROM login_attempts')
            with sqlite3.connect(snapshot) as clean:
                clean.execute('VACUUM')
            export_store=Store(snapshot)
            export_store.export_tree(REPO)
            # Full data database backup supplements human-readable exported files.
            dest=REPO/'database/notebook-data.sqlite3'
            dest.parent.mkdir(parents=True,exist_ok=True)
            with export_store.connect() as source,sqlite3.connect(dest) as target:
                source.backup(target)
                target.execute('PRAGMA journal_mode=DELETE')
            git('config','user.name','Life Notebook Backup')
            git('config','user.email','life-notebook@users.noreply.github.com')
            git('add','cost','daily','settings','database')
            if git('status','--porcelain'):
                git('commit','-m','Nightly SQLite data backup '+now)
            git('push','origin','HEAD:main')
            state(store,'success',now)
            state(store,'error','')
            print('Backup completed successfully')
        except Exception as exc:
            # No stderr from SSH/Git (which may contain private paths) in UI state.
            state(store,'error',type(exc).__name__+': backup failed; retry scheduled')
            print('Backup failed; retry scheduled')
            raise

if __name__=='__main__':run()
