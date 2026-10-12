# The admin interface

A server with login on has an admin page at `/admin`. It changes, while the server runs and
without editing YAML, what an administrator is responsible for: which directories the server
reads from, which panels and external services users get, the server's health, and (with the
users and access sections) who may sign in and which datasets they see. Every change is
written to an audit log. The API behind the page is documented in {ref}`http-admin`.

The page is for people you trust with the server. It never writes the operator's YAML: what it
stores goes into one small directory, and the YAML always wins where the two disagree.

## Setup

1. **Login must be on.** The admin routes exist whether or not login is on; with login off every
   one answers `404` `admin_requires_login`, and the `annzarro` command line is the only way to
   manage users ({doc}`authentication`).
2. **Make a first admin** with the command line, as the account that runs the server and with
   the same configuration:

   ```bash
   export ANNZARRO_CONFIG=/etc/annzarro/site.yaml
   annzarro user add --username alice --admin
   ```

   Admins can then be made and removed in the browser, and the last admin cannot be removed or
   demoted by mistake.
3. **Tell the server about its proxy.** Behind a reverse proxy that terminates TLS or rewrites
   `Host`, set `server.proxy_count` to the number of proxies (1 for nginx alone) and have the
   proxy send `X-Forwarded-Proto` and `X-Forwarded-Host` ({doc}`lab-server`). Every change in
   the admin interface is refused with `403 csrf_failed` unless the `Origin` header the browser
   sends equals the address the server believes it has, and without `proxy_count` the server
   sees its own `http://127.0.0.1:port`. A server that listens on loopback with login on and
   `proxy_count: 0` logs a warning at start-up that says so, and the refusal names this setting
   in the log.
4. **Open `/admin`** after signing in (`https://your-host/admin`, or under `server.url_prefix`).

The page has six sections: Users, Data directories, Server health, Panel sets, Settings and
Audit log.

### Where the state lives

All the admin interface stores is in `annzarro_admin/` in the directory of the users file
(`auth.user_file`), created with mode 0700. Back it up with the users file; it is also what tells
two servers apart.

| File | Content |
|---|---|
| `overlay.json` | Data directories an admin added, and the admin layer of the policy ({ref}`admin-policy`). |
| `access.json` | Per-user dataset access and per-user policy overrides. |
| `audit.jsonl`, `audit.head`, `audit.jsonl.1` to `.5` | The audit log ({ref}`admin-audit`). |
| `health/<host>-<pid>.json` | One snapshot per server process, rewritten every 2 seconds. Ephemeral. |

Every file is replaced atomically (a temporary file renamed over the old one) and changed under
a lock, so two admins and the command line never overwrite each other. A request waits for the
lock `server.lock_timeout_s` (10 seconds), then answers `503 busy`.

**Several workers.** A gunicorn server has several processes. Each one `stat`s these files at most
once per request and re-reads one that changed, so a change made by any admin, or by the command
line, or by editing a file by hand, reaches every worker on its next request, with no signal and no
restart. This needs the directory to be on a local file system: on NFS the client's attribute
cache (`actimeo`) delays a change by up to its timeout.

### Safeguards on every change

| Rule | Setting | Default |
|---|---|---|
| The admin's password was entered within this many minutes, else `403 reauth_required` and the page asks for the password again. Reading needs no password. | `server.admin_reauth_minutes` (0 = never asked) | 30 |
| At most this many changes per minute per admin and worker (reads get eight times as many), else `429 admin_rate_limited` with `Retry-After`. | `server.admin_rate_per_minute` (at least 1) | 30 |
| The audit log rotates at this size. | `server.admin_audit_max_mb` (0 = never) | 50 |
| Directories an admin may add as data directories lie inside one of these. Empty: adding is off. | `server.admin_data_roots` | `[]` |

Besides the password, every change needs the CSRF token the page carries (`X-AnnZarro-CSRF`), an
`Origin` equal to the server's own and a JSON body. Admin pages are sent with `Cache-Control:
no-store`, `X-Frame-Options: DENY` and a Content-Security-Policy that allows scripts from the
server only. A request from an account that is not an admin is refused with `403 admin_only`
before anything is read, and the refusal is audited (at most 6 per minute and worker, so one
account cannot fill the log).

(admin-users)=
## Users

The Users section lists the accounts with their last request, last sign-in, number of panel sets
and any lockouts. An admin can add a user (with a typed password or a generated one, shown once and
then gone), reset a password, grant or revoke admin, clear a lockout for one address or all, and remove
a user. Resetting a password or removing a user ends that user's logins, and a running server sees
every change without a restart.

- **The last admin stays.** A change that would leave the server without an admin is refused with
  `409 last_admin`, on the web and on the command line alike (`annzarro user remove`, `set-admin
  --no-admin`; `--force` skips this rule only). It is checked on the stored file under its lock, so two
  admins demoting each other at the same moment cannot both succeed.
- **Not yourself.** You cannot remove your own account or revoke your own admin right in the
  browser (`409 self`); ask another admin or use the command line.
- **Panel sets of a removed user.** The removal dialog can pass the user's panel sets to another
  user in the same step (audited as `panelset.reassign`). Otherwise they keep the old owner's name and only
  an admin can change them; the Panel sets section reassigns them later.
- **Passwords.** At least 10 characters, different from the username. Everyone changes their own at
  `/account/password` (the header's **Change password**), which asks for the current one and ends their other logins.
  A wrong current password counts toward the same lockout as sign-in.
- **Audit.** `user.add`, `user.remove`, `user.password`, `user.set_admin`, `user.unlock` and
  `account.password`, and the refusals. Command-line changes are recorded too, with `via: cli:<account>`.
  `annzarro admin audit verify` checks the chain ({doc}`../reference/cli`).

(admin-data-roots)=
## Data directories

By default the server reads from `server.data_dir` and `server.allowed_dirs`, set in the YAML.
With `server.admin_data_roots` an admin can add more in the browser: the section lists the
directories the server reads from (where each comes from, whether it is active, how many stores
it holds), and **Add** browses below the allowed parents and adds one.

```yaml
server:
  admin_data_roots:
    - /srv/atlases        # an admin may add /srv/atlases/lab2, not /home/someone
```

A directory counts only while its real path (after `..` and symbolic links) lies inside a parent,
and this is checked again on every request. So a link swapped in later, or a parent dropped from
the YAML, switches the directory off at once and the datasets in it answer `403`. The section
shows it as inactive, with the reason. Adding is refused for a path that is not absolute,
outside every parent, not a directory, already readable, an allowed parent itself, or one that
holds the server's own state (the users file's directory, the admin state, the saved panel
sets). At most 100 directories can be added. Removing one takes it away from the dataset picker
and from reads at once, and the answer says how many saved panel sets name a dataset in it.
Directories from the YAML cannot be removed here.

Keep the parents writable by trusted accounts only: whoever can write there can swap a directory
for a link between the check and the read.

## Disabling panels and external hosts

The Settings section is generated from the **policy registry**: one list of keys, each with a
type, a default and a description, grouped by area (panels, outbound, data, limits, features).

(admin-policy)=
### The layers

A setting has a value in up to four places, highest first:

| Layer | Set by | Stored in |
|---|---|---|
| user | an admin, for one user (keys that allow it) | `access.json` |
| overlay (the "admin" badge) | an admin, for everyone | `overlay.json` |
| config | the operator | the YAML, an environment variable, `--config` |
| default | the code | |

Most keys take the highest layer that sets them. A **restrict** key is one that widens what a
user can do or what leaves the server: a panel, an external service, a feature. It takes the most
restrictive value of user, overlay and config, so an admin can narrow what the operator allowed
and can never widen it. (A default is not a decision of the operator: an admin can switch on a
service that is off by default.) The Settings page shows where each value comes from, what it
would be if the admin value were removed (**reset**), and refuses a change the operator's file
forbids with `409 config_ceiling`.

The operator can take keys out of the admins' hands. Keys in `policy.locked` ignore the overlay
and the per-user overrides, and show a lock:

```yaml
policy:
  locked: [outbound.allow_external, panel.gene-set.services]
```

Settings the YAML owns, like the resource limits (`limits.*`), are listed read-only with their
effective values. Names in a stored layer that this version does not declare are kept, listed as
unknown and can be removed one by one; a stored value the registry cannot use (wrong type, a layer
its scope does not allow) is ignored, flagged and kept, never deleted by an unrelated write. If a
stored file does not parse, the page shows a red banner and refuses writes with `503
store_unreadable` until it is repaired.

### Panels

`panel.<type>.enabled` exists for every panel type: `cell-plot`, `gene-plot`, `cell-table`,
`gene-table` and `gene-set`. A disabled type is missing from the panel menu. A saved panel set or
`#view=` link that holds one opens with a placeholder, "Disabled by the administrator", and keeps
the panel's saved JSON, so saving the layout again loses nothing and enabling the panel restores
it.

### Outbound hosts

Gene Set Analysis is the one panel that sends gene ids to other servers ({doc}`../user-guide/gene-set`).
Its keys:

| Key | Meaning | YAML equivalent |
|---|---|---|
| `outbound.allow_external` | "No external hosts". Off forces all the keys below to their no-outbound value. | |
| `panel.gene-set.external_requests` | `on`, `ask`, `off` or `none`. `off` never sends; its Links still work. `none` never sends and removes the Links. | `integrations.external_requests` |
| `panel.gene-set.services` | The services the panel offers (`string-enrichment`, `string-network`, `string-partners`, `gprofiler-gost`, `mygene-mapping`, `mygene-card`, `hpa`, `enrichr`, `reactome`). | `integrations.gene_set.services` |
| `panel.gene-set.species_search` | Whether a typed species name is looked up at NCBI Taxonomy and the ENA (no genes are sent). | |
| `panel.gene-set.links` | Whether the Links section, which opens third-party sites by a click, exists. | |

On a hosted server (login on, a network address or a proxy) **Enrichr and Reactome are off by
default**: they keep the gene lists they are sent where others can read them. An admin or the
operator can switch them on.

This holds on the server, not only in the page. The server puts a `Content-Security-Policy:
connect-src` on every HTML page it serves, listing exactly the hosts that requester's policy
allows (`'self'`, `data:`, `blob:` and the hosts of the enabled services). The browser then
refuses a request to any other host, even from a modified page or the console, and the login page
allows none. Each host comes from the key that declares it, so there is no second list to keep
equal. Three notes:

- A page applies the policy it was loaded with. An open tab reads the policy again before every
  Run of Gene Set Analysis, and when a reply carries a new `X-AnnZarro-Policy` version, so a tab
  that is already open stops sending as soon as it is used. A page restored from the browser's
  back/forward cache (bfcache) can keep the CSP it was loaded with, although the pages are
  `no-store`; only a modified page could still reach a host, until it is reloaded.
- The environment variable `ANNZARRO_EXTERNAL_REQUESTS` decides `integrations.external_requests`
  and beats the YAML in both directions; the Settings page shows its source as `env`. See
  {ref}`config-environment`.
- A tab opened before an admin switches external hosts off sends nothing at its next Run and
  shows the notice.

## Panel sets

The Panel sets section lists the saved panel sets of the server, newest first, filtered by
owner, with each owner's use against the quotas (`server.max_sessions_per_user`, `max_sessions`,
`max_sessions_mb`; {doc}`resource-limits`). An admin can **reassign** sets to another user, one by
one or all of an owner's, and **delete** sets (the button asks a second time). Both are
all-or-nothing for the sets named, and are audited as `panel_sets.reassign` and
`panel_sets.delete`, with the count and the first 50 names. A reassignment may take the new owner
past their quota; the page says so. Removing a user can hand their sets over in the same step
({ref}`admin-users`).

## Server health

The Server health section merges what each worker reports: the read budget in use, the size of
the result cache, the requests and the refusals counted by their `reason` (`read_busy`,
`session_quota_user`, `csrf_failed`, and so on), and the users seen within the session timeout (`server.session_timeout`). It is
the place to look when users report `503 read_busy` or `409 session_quota_*`, and to see
whether the limits of {doc}`resource-limits` are set right.

Each worker writes its own snapshot, so the numbers are per process and start again when a
worker is replaced (`max_requests`); a worker that has been quiet for 10 minutes is shown as
idle, and one whose process cannot be checked and has not written for that long as stale and
left out of the totals. **Clear cache** empties the result caches of every worker (all datasets,
or one) and is audited; it does what `POST /cache/reset` does for an admin.

`GET /status` and `GET /cache/info` answer admins only on a shared server.

(admin-audit)=
## The audit log

Every change, and every refused change or re-authentication attempt, is one line of `audit.jsonl` with the
time, the actor and address, `via` (`web` or `cli:<user>`), the action (`data_roots.add`,
`policy.update`, `cache.clear`, `admin.reauth`, ...), the target, the details and the outcome.
Passwords, hashes, tokens and cookie values are never stored. The Audit log section shows the
newest first and the result of the check below.

Each line holds the SHA-256 of the line before it, so editing or deleting a line in the middle
is found, and the page names the first record that no longer fits. Records cut off the end of
the file leave no trace in it, so every record is also written to the `annzarro.audit` logger
(journald under systemd, which the service account cannot rewrite). The file is rotated at
`server.admin_audit_max_mb`; five rotations are kept and the chain continues across them. A
process that can write the file can also forge later records, so this is evidence of what the
admin interface did, not protection against the account that runs it. Make the file append-only
for that account with:

```bash
sudo chattr +a /path/to/annzarro_admin/audit.jsonl
```

A rotation renames the file, which the append-only attribute forbids: with `chattr +a` set
`admin_audit_max_mb: 0` and rotate by hand (`chattr -a`, move the file, create a new one, `chattr +a`).
