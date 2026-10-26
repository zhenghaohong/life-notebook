# Life Notebook — VPS + SQLite

Production URL: https://life.trouvaille.ccwu.cc/

## Isolation

- `/opt/life-notebook`: application source and dedicated Caddy binary/configuration.
- `/var/lib/life-notebook/notebook.sqlite3`: authoritative live data (WAL, full synchronous commits).
- `/var/lib/life-notebook-web`: separate HTTPS service user and certificate state.
- `/etc/life-notebook.env`: this application only; no existing system service config changed.
- `life-notebook.service`: Python app, loopback `127.0.0.1:18765`, dedicated unprivileged user.
- `life-notebook-web.service`: HTTPS on the previously unused 80/443 ports, separate user.
- `life-notebook-backup.timer`: 23:55 **Asia/Shanghai**, independent of the server timezone.
- CPU/memory caps apply only to these new services. No package upgrades or network/proxy configuration changes are required.

## Data and login

Expenses, bilingual diaries, tags, versions, sessions and password hashes live in SQLite tables. HTTP JSON is only the transport format, not a live file store. Month history is one database-backed API request. Integer cents prevent floating-point rounding.

Existing GitHub JSON/Markdown records were imported before enabling the site. Database revisions detect conflicting edits. A failed write rolls back the transaction. SQLite connections close after each operation.

The account password is stored only as a random-salted PBKDF2-SHA256 hash. Login is entirely local and has no dependency on the previous Cloudflare Worker or GitHub. No plaintext password is retained. HttpOnly, Secure, SameSite=Strict host cookies hold revocable opaque sessions; remembered sessions expire in 30 days. Ordinary sessions expire in 30 minutes. Five login attempts/IP/minute are allowed. Credential reset revokes all sessions.

## Nightly backups

`backup.py` takes an online consistent SQLite snapshot and exports:

- `cost/YYYY/MM/YYYY-MM-DD.json`
- `daily/YYYY/MM/YYYY-MM-DD.md`
- `settings/tags.json`
- `database/notebook-data.sqlite3` (full data snapshot without credentials/sessions)

Only the private `zhenghaohong/life-private-data` repository is authorized by the dedicated deployment key. GitHub host keys are pinned from GitHub's HTTPS metadata API. The key is not in this source tree, the public frontend, or GitHub backups.

Password hashes, sessions and login attempts are securely removed and the snapshot vacuumed before exporting the database. Backup does not force-push; divergent Git histories fail for review. Before exporting or contacting GitHub, the job compares a fingerprint of expenses, diaries and tags with the last successfully pushed snapshot. Unchanged data skips snapshots, export and all Git operations; logins, timestamps and repeated identical saves do not count as data changes. First backups always run. Failed or interrupted backups remain pending and are never skipped. Changes during backup are detected on the next run. Failed runs retry after 15 minutes. Settings display last success or failure. The first actual push is scheduled at night; connection and write permission can be checked with `git push --dry-run` without changing repository data.

Local WAL and the primary SQLite file are not copied as a live pair; the SQLite online backup API is used. A restore of the data-only database requires setting a password through the hidden SSH prompt.

## Operations (only this application)

```sh
systemctl status life-notebook life-notebook-web life-notebook-backup.timer
systemctl list-timers life-notebook-backup.timer
journalctl -u life-notebook -u life-notebook-web -u life-notebook-backup --since today
runuser -u life-notebook -- python3 /opt/life-notebook/manage.py check
```

Password reset (type directly into the hidden SSH prompt; never paste a password into a command):

```sh
runuser -u life-notebook -- python3 /opt/life-notebook/manage.py set-password
```

Tests:

```sh
python3 -m unittest discover -s vps -p test_server.py -v
node --check vps/web/app.js
```

## Rollback and recovery

Stop only `life-notebook`, `life-notebook-web` and `life-notebook-backup.timer` to disable this deployment. Keep `/var/lib/life-notebook` for recovery. Do not stop or change unrelated services.

For data restore, stop the notebook app and backup timer, preserve the current database, replace it with a verified data-only snapshot, remove only this database's stale WAL/SHM files while stopped, restore owner `life-notebook`, and reset the password through `manage.py` before starting again. Re-enable the timer after verifying records. Do not start two writable versions against the same GitHub backup branch.

## Homepage reminders (2026-10-26)

Reminders are stored in the SQLite `reminders` table and exposed only through the authenticated `/api/reminders` endpoint. The existing database is migrated additively, without replacing or clearing old records. Collection revisions prevent simultaneous edits from overwriting each other.

The homepage lists all incomplete reminders regardless of the selected bookkeeping date. Calendar-day counts use the device's current local date; overdue tasks stay visible in red until completed. Today is amber, future deadlines are blue. Completed items remain in a collapsible section and can be restored or edited. The reminder card repaints on returning to the tab and once a minute for date rollover, without polling the server.

Nightly backups include `settings/reminders.json` and the full data-only SQLite snapshot. The unchanged-data fingerprint includes reminder titles, deadlines, notes and completion flags. Completing or restoring a reminder therefore counts as a change. Import supports existing backups without this new file and new backups with it.

Additional verification: `node vps/test_reminder_dates.cjs`; Linux backend/backup checks: `python3 -m unittest discover -s vps -p 'test_*.py' -v`.

备忘录支持删除：事项移入“已删除”，可恢复并保留原来的完成状态。SQLite 自动补充删除标记列，旧事项保持不变；删除状态纳入每晚备份及变更检测。
