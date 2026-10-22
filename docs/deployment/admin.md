# The admin interface

A server with login on has an admin page at `/admin`. It changes, while the server runs and
without editing YAML, what an administrator is responsible for: which directories the server
reads from, which panels and external services users get, the texts a public site shows its
visitors, the server's health, and (in the
Users section and its Access panel) who may sign in and which datasets they see. Every change is
written to an audit log. The API behind the page is documented in {ref}`http-admin`.

The page is for people you trust with the server. It never writes the operator's YAML: what it
stores goes into one small directory. Where the two disagree, the rule depends on the setting:

- For a setting of the policy registry (the Settings, Public site and Remote datasets pages), a
  value an admin sets **overrides** the YAML, unless the key is listed in `policy.locked`: then
  only the YAML decides and the page shows the setting read-only with a lock.
- A **restrict** key (panels, outbound hosts, remote datasets) can only be narrowed: the most
  restrictive of the YAML, the admin and the user wins, so an admin never widens what the YAML
  forbids ({ref}`admin-policy`).
- A setting that only the YAML owns, such as the resource limits, is shown read-only. An
  environment variable that names a setting beats both the YAML and the admin.
- Data directories an admin adds are added to the YAML's; the YAML's cannot be removed on the page.

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

The page has seven sections: Users, Data sources, Server health, Panel sets, Settings, Public
site and Audit log.

### Where the state lives

All the admin interface stores is in `annzarro_admin/` in the directory of the users file
(`auth.user_file`), created with mode 0700. Back it up with the users file; it is also what tells
two servers apart.

| File | Content |
|---|---|
| `overlay.json` | Data directories an admin added, and the admin layer of the policy ({ref}`admin-policy`). |
| `access.json` | Per-user dataset access and per-user policy overrides. |
| `audit.jsonl`, `audit.head`, `audit.jsonl.1` to `.5` | The audit log ({ref}`admin-audit`). |
| `health/<host>-<pid>.json` | One snapshot per server process, rewritten every 2 seconds, read by Server health and by `/metrics` ({doc}`monitoring`). Ephemeral. |

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

(admin-user-fields)=
### Fields

| Field | Meaning |
|---|---|
| [**Username**]{#user-field-username} | The name the person signs in with: letters, digits and `. _ @ -`, up to 64 characters. |
| [**Password**]{#user-field-password} | **Generate a password** makes a random one, shown once; **Set a password** takes one you type, at least 10 characters and different from the username. Resetting a password ends the user's other logins. |
| [**Administrator**]{#user-field-admin} | Whether the account may open the admin pages. Off by default. The last administrator and your own account cannot lose the right in the browser. |
| [**Hand the panel sets to**]{#user-field-reassign} | On removal, the user who takes over the removed user's saved panel sets. Default: keep them under the old owner's name, where only an admin can change them. |

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

(admin-access)=
## Dataset access for external collaborators

By default every signed-in user can open every dataset in the server's data directories. To give
a collaborator only some of them, **restrict** that user and **grant** what they may see:

- a **folder** (`dir`): its whole subtree;
- a **store** (`store`): one dataset;
- a **remote prefix** (`remote`): an `s3://`, `gs://` or `https://` prefix that is inside
  `server.remote_allowlist`.

A restricted user with no grant sees nothing; admins are never restricted. The grants are in
`annzarro_admin/access.json`, next to the per-user policy overrides, and are written under the same
lock as the other admin files, so every worker follows a grant or a revocation on its next request. The
command line manages them as well (`annzarro user access carol --restrict --grant /srv/atlases/pbmc`,
{doc}`authentication`) and both are audited.

### The Access panel

In the Users section, **Access** on a user's row opens their panel above the table. The table's
**Access** column says `all`, or `restricted: 2 grants` (with `(1 inactive)` when a grant does not
apply), `unknown` while `access.json` cannot be read, and a red **reads nothing** badge for a
restricted user with no active grant; a blue badge counts the user's own settings.

- [**Restricted to these datasets**]{#access-field-restricted} is a checkbox. Restricting a user who has an active grant takes one
  click. Anything that could cut someone off or open everything asks first, in a box with a second
  button: restricting a user without an active grant says "*carol* has no active grant, so *carol* will lose
  access to everything now, until you add a grant." (**Restrict now**), and un-restricting says "*carol* will be able to read
  every dataset in the data directories." (**Allow everything**). **Cancel** leaves it as it was.
  Un-restricting keeps the grants, so restricting again brings them back.
- [**Grant**]{#access-field-grant} adds a grant in one of four modes: *this folder* (the whole subtree), *every store in this
  folder* (one store grant for each, for a folder of links), *one store*, or *remote prefix*. Type the path, or
  **Browse data directories** (the directories the server reads from, folder by folder). The grants table
  lists each grant with an *inactive* line with the reason (outside every data
  directory, remote stores off, outside the remote allowlist, not a valid URL) when it does not apply, and a **Revoke** button.
- **Effective** says how many grants are active and how many stores they add up to
  ("at least 5,000 stores" when the count stopped at its limit), and lists the stores a page at a time (**Show more**).
- [**Check a path**]{#access-field-check} asks the server whether this user can read a path or URL and why: covered by
  which grant, covered only by an inactive one, outside every data directory, or no grant at all.
- **Settings for the user** are the per-user overrides of the settings ({ref}`admin-policy`) for that user.
- An admin is never restricted. If a user who was restricted is made an admin, the panel says
  "Administrators read every dataset the server serves. They cannot be restricted. Stored as restricted: that
  applies again if their admin right is revoked."

The **Data sources** table of local directories has a **Granted to** column: the restricted users with an active grant in or
below that directory (`-` for none). It is the quick check that a directory an admin is about to remove or
re-point is not what a collaborator depends on.

While `access.json` cannot be read, the Users table says `unknown` for everyone and the panel refuses
changes (`503 store_unreadable`) instead of overwriting the file.

What a restricted user sees, and how the check works:

- **Not there, not allowed: the same answer.** A dataset, folder or search outside the grants
  answers exactly as a store that does not exist (`404 not_found`), also outside every data
  directory, and no reply names the data directory or the folders above a grant. The dataset
  browser (its root is the list of their grants), its search and panel-set lists show the
  grants and nothing else ({ref}`http-restricted`).
- **Real paths.** A grant is matched on real paths: a symbolic link inside a granted folder that
  leads out of it is not covered (grant the target store, or use `--grant-stores-in` for a folder of
  links), `/data/a` does not cover `/data/ab`, and a grant is active only while its real path is inside a data
  directory (a removed directory or a re-pointed link switches it off; `--show` says which are active).
- **Case and Unicode spellings.** On a case-insensitive or normalising volume (the default
  macOS file system, APFS), `/Data/A.zarr` and `/data/a.zarr` are the same directory to the
  operating system. A variant of a granted path in another case or Unicode form is allowed when
  it names the same file on disk (the server checks it with `samefile`, and matches nothing by
  folding strings). A variant of anything that is not granted is refused, and so is a variant that is a
  different directory, as on a case-sensitive volume (Linux), where names that differ in case are different
  directories.
- **Open tabs.** A link or panel set naming a dataset outside the grants opens the layout with a
  "Dataset not available" notice. A grant revoked while a dataset is open turns the next read into the dataset browser, with a banner saying
  the dataset is not available; what the browser already holds cannot be recalled.
- **Fail closed.** If `access.json` cannot be read, the server cannot tell who is restricted, so every
  non-admin gets `503 access_unavailable` on the data routes, and their policy falls back to the most
  restrictive values, until an admin repairs or removes the file. Admins keep working, and the
  Settings page shows a red banner naming the file.
- **Audit.** Grants, restrictions and revocations are audited; command-line changes with
  `via: cli:<account>`.

(admin-data-roots)=
## Data sources

The section has two parts: the local data directories the server reads from, and the **Remote
datasets** card, which says whether it may also read stores from URLs.

### Local data directories

By default the server reads from `server.data_dir` and `server.allowed_dirs`, set in the YAML.
With [`server.admin_data_roots`]{#data-field-parents} (the **allowed parents**, default none) an
admin can [add more in the browser]{#data-field-add-directory}: the section lists the
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
sets). At most 100 directories can be added. Removing one takes it away from the dataset browser
and from reads at once, and the answer says how many saved panel sets name a dataset in it.
Directories from the YAML cannot be removed here.

Keep the parents writable by trusted accounts only: whoever can write there can swap a directory
for a link between the check and the read.

(admin-remote-datasets)=
### Remote datasets

Opening an `s3://`, `gs://`, `gcs://` or `http(s)://` store makes the server fetch a URL a user
chose, so the server decides whether to do that at all ({doc}`authentication`). The **Remote
datasets** card of the Data sources section sets it for everyone, without a restart, in every
worker. It is a setting of its own: the Gene Set Analysis switch on the Settings page
(`outbound.allow_external`) does not affect it.

| State | Meaning |
|---|---|
| **Off** | The server opens no remote dataset; a remote URL is refused with `403`. |
| **Only these locations** | The server opens remote datasets whose URL starts with one of the listed locations. |
| **Any location** | The server opens any remote URL a user gives it, including addresses on its internal network (cloud metadata services, other machines behind the firewall). The card shows a warning while this is chosen. |

A location is a URL prefix with one of the schemes `s3`, `gs`, `gcs`, `http` or `https`. It is
checked when it is added and again by the server: no credentials in the URL, no query string or
fragment, no `.` or `..` segment. It is stored normalised (lower-case scheme and host, ending in
`/`, so `S3://Lab/atlases` is kept as `s3://lab/atlases/`), and a location matches whole path
segments only: `s3://lab/atlases/` allows `s3://lab/atlases/mouse.zarr`, not `s3://lab/atlases-old/`.
Duplicates are removed. HTTP redirects are not followed while a list is in force.

Without an admin value the default applies: **off** on a shared server (login on, a network
address or a proxy) and **any location** on a single-user local one. The key is
[`feature.remote_stores`]{#policy-feature-remote-stores}, a restrict key like the others ({ref}`admin-policy`):

- `server.remote_stores` and `server.remote_allowlist` in the YAML, or the environment variables
  `ANNZARRO_REMOTE_STORES` and `ANNZARRO_REMOTE_ALLOWLIST` (which beat the YAML in both
  directions), are the operator's decision and the **upper limit**. `deny` leaves nothing to
  change: the card is shown locked, with the reason. `allow` leaves all three states open. A
  `remote_allowlist` leaves **Off** and a narrower list; locations outside it, and **Any
  location**, are refused with `409 config_ceiling`. The shipped `remote_stores: auto` with no
  allowlist is not a decision, so an admin may widen it.
- `policy.locked: [feature.remote_stores]` takes the card away from the admins altogether.
- The card shows the effective state and where it comes from: default, configuration file,
  environment or administrator. **Reset to the default** removes the admin value.
- Credentials for private buckets (`remote_credentials`) are configuration only and are not shown.
- A restricted user's access does not widen: they still open only the remote prefixes they were
  granted, and a grant is inactive while remote datasets are off or outside the list
  ({ref}`admin-access`).

Every change is audited as `policy.update` with the old and new value and the locations added and
removed; a URL with credentials in a refused request is logged with them hidden. Changing it needs
the same password confirmation as other admin changes. A page that is already open picks the change up at its next load.

## Disabling panels and external hosts

The Settings section is generated from the **policy registry**: one list of keys, each with a
type, a default and a description, grouped by area (panels, outbound, data, limits, features).

Every setting on the admin pages, here and in the other sections, has an info mark and a **Guide**
link. Hover over the mark, or tab to it, for what the setting does, its default and what it
affects (Escape closes the tip); Guide opens the part of these docs that explains it.

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

`panel.<type>.enabled` exists for every panel type, on by default:

| Key | Panel |
|---|---|
| [`panel.cell-plot.enabled`]{#policy-panel-cell-plot-enabled} | Cell Plot |
| [`panel.gene-plot.enabled`]{#policy-panel-gene-plot-enabled} | Gene Plot |
| [`panel.cell-table.enabled`]{#policy-panel-cell-table-enabled} | Cell Table |
| [`panel.gene-table.enabled`]{#policy-panel-gene-table-enabled} | Gene Table |
| [`panel.gene-set.enabled`]{#policy-panel-gene-set-enabled} | Gene Set Analysis |

A disabled type is missing from the panel menu. A saved panel set or
`#view=` link that holds one opens with a placeholder, "Disabled by the administrator", and keeps
the panel's saved JSON, so saving the layout again loses nothing and enabling the panel restores
it.

### Searching descriptions

[`datasets.text-search.enabled`]{#policy-datasets-text-search-enabled} is on by default. It governs the
search over the attribution and READMEs of the datasets (`GET /api/v1/datasets/text-search`, with its
status and refresh routes: {doc}`../reference/http-api`). Off for a user, the three routes answer
`403 disabled_by_policy` to them; off in the config file (`server.text_index_enabled: false`) or for
everyone, no crawl runs either. It is a restrict key like the others: the narrowest value of config, admin
and user applies.

The server reads the attribution and the first 64 KB of the README of every local store it can list, one crawl at a
time for the whole server, into a gzipped index in the cache directory (`server.cache_dir`, shared by all
workers). Remote datasets are not indexed. A search shows a user only the stores they can open, and a
restricted user is told the path of what they may open (as in their listings), nothing above a grant, and not how many stores the server holds. **Clear cache**
marks the index stale, so it is refreshed (by the background keeper, or by the next search); it does not delete it.
The server builds the index by itself a few seconds after it starts, continues a crawl that stopped
partway, and refreshes the index once it is older than `server.text_index_ttl_s`, without waiting for
a search; each crawl logs a line at INFO when it starts and one when it ends, with its counts.
`server.text_index_background: false` leaves the crawl to the searches, as in 0.7.2. The limits are in
{doc}`resource-limits`.

### Outbound hosts

Gene Set Analysis is the one panel that sends gene ids to other servers ({doc}`../user-guide/gene-set`).
Its keys:

| Key | Meaning | YAML equivalent |
|---|---|---|
| [`outbound.allow_external`]{#policy-outbound-allow-external} | "Gene Set Analysis: no external services". Off forces all the keys below to their no-outbound value. It does not govern remote datasets ({ref}`admin-remote-datasets`). | |
| [`panel.gene-set.external_requests`]{#policy-panel-gene-set-external-requests} | `on`, `ask`, `off` or `none`. `off` never sends; its Links still work. `none` never sends and removes the Links. | `integrations.external_requests` |
| [`panel.gene-set.services`]{#policy-panel-gene-set-services} | The services the panel offers (`string-enrichment`, `string-network`, `string-partners`, `gprofiler-gost`, `mygene-mapping`, `mygene-card`, `hpa`, `enrichr`, `reactome`). | `integrations.gene_set.services` |
| [`panel.gene-set.species_search`]{#policy-panel-gene-set-species-search} | Whether a typed species name is looked up at NCBI Taxonomy and the ENA (no genes are sent). | |
| [`panel.gene-set.links`]{#policy-panel-gene-set-links} | Whether the Links section, which opens third-party sites by a click, exists. | |

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

(admin-public-site-section)=
## Public site

The Public site section sets the `site` keys while the server runs: the imprint, privacy notice,
accessibility statement and terms of use (each a link or a text written there, with a live
preview), the operator, the contact and its link text, the footer, search engines, the security
contact, the language of the texts, the AnnZarro credit in About and whether convenience items are
kept between visits. A checklist at the top says which of imprint, privacy notice, contact and
accessibility statement are missing. A saved change shows in the footer, About and the `/site/`
pages at the next request, without a restart. A value set here wins over the configuration file
until **Reset to config file**, unless `policy.locked` names the key; a text's `file` can only be
set in the configuration file. Every field, the precedence and what each key shows where are in
{ref}`admin-public-site`.

## Panel sets

The Panel sets section lists the saved panel sets of the server, newest first, filtered by
owner, with each owner's use against the quotas (`server.max_sessions_per_user`, `max_sessions`,
`max_sessions_mb`; {doc}`resource-limits`). An admin can **reassign** sets to another user, one by
one or all of an owner's, and **delete** sets (the button asks a second time). Both are
all-or-nothing for the sets named, and are audited as `panel_sets.reassign` and
`panel_sets.delete`, with the count and the first 50 names. A reassignment may take the new owner
past their quota; the page says so. Removing a user can hand their sets over in the same step
({ref}`admin-users`).

(admin-health)=
## Server health

The Server health section merges what each worker reports: the read budget in use, the size of
the result cache, the worker's memory, the requests and the refusals counted by their `reason` (`read_busy`,
`session_quota_user`, `csrf_failed`, and so on), and the users seen within the session timeout (`auth.session_timeout`). It is
the place to look when users report `503 read_busy` or `409 session_quota_*`, and to see
whether the limits of {doc}`resource-limits` are set right. For the same numbers over time, and
for alerts, use `/metrics` ({doc}`monitoring`, which also says what to point a load balancer at).

Each worker writes its own snapshot every 2 seconds, so the numbers are per process and start again when a
worker is replaced (`max_requests`). A worker that has not written for a minute is shown as stale
and left out of the totals: it is stuck, or it ran on another host and is gone (a process of this
host that is gone is dropped). **Clear cache** empties the result caches of every worker (all datasets,
or one) and is audited; it does what `POST /cache/reset` does for an admin.

`GET /status` and `GET /cache/info` answer admins only on a shared server.

(admin-audit)=
## The audit log

Every change, and every refused change or re-authentication attempt, is one line of `audit.jsonl` with the
time, the actor and address, `via` (`web` or `cli:<user>`), the action (`data_roots.add`,
`policy.update`, `cache.clear`, `admin.reauth`, ...), the target, the details and the outcome.
With JSON logs or metrics on, a change made in the browser also has the `request_id` of its
request, the one on its log lines ({doc}`monitoring`); the Audit log section shows it as the
time's tooltip. Passwords, hashes, tokens and cookie values are never stored. The Audit log section shows the
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
