---
orphan: true
---

# Authentication and sharing

Status: design. Part (a) has shipped (v0.3.0); parts (b) to (e) are the plan for
v0.4.0. Not linked from the user documentation yet.

The goal: set up a server, make a dataset available, and give a collaborator one
link that opens it in the view you are looking at, while making sure nobody else
on the institutional network can open it. Signing in must not lose what the link
was meant to show.

## What exists (v0.3.0)

Line numbers refer to the commit that added this document.

- **When login is on.** It is off for a loopback `annzarro start` and for the
  desktop app. It is on for a network host and for the WSGI entry point
  (gunicorn). `--auth-disabled` / `ANNZARRO_AUTH_DISABLED=true` turn it off and
  log a SECURITY banner (`annzarro/server/core.py`, `warn_about_exposure`;
  `docs/deployment/authentication.md`).
- **Users.** One JSON file, `auth.user_file`, mode 0600. Writes are atomic and
  locked, and the file is reloaded when another process changes it
  (`annzarro/server/auth.py`: `_save_users`, `_reload_if_changed`).
  - Passwords are stored as scrypt hashes, or `pbkdf2:sha256` where `hashlib`
    has no scrypt (`_new_hash`).
  - There are two roles, user and admin (`is_admin`). Admin matters for
    panel sets, the cache reset and, under the default `server.arbitrary_paths: admins`,
    opening paths outside the data directories.
  - Users are managed only from the command line: `annzarro user
    add|remove|passwd|set-admin|list` (`annzarro/cli.py`). There is no web
    interface.
- **Login.** A form POST to `/login` (`core.py`, `register_auth_routes`).
  Repeated failures lock out the pair (user, client address), recorded in the
  users file so every worker sees it (`auth.py`, `authenticate`). There is no
  global rate limit.
- **Session.** A Flask signed cookie: HttpOnly, SameSite=Lax, and Secure when
  the request came over HTTPS directly or through `server.proxy_count` trusted
  proxies (`core.py`, `_LoginCookieInterface`).
  - It is signed with a generated key kept in a 0600 file beside the users file
    (`annzarro/server/secret_key.py`).
  - The idle timeout is `auth.session_timeout`, 8 hours by default
    (`core.py`, `is_logged_in`).
  - A login ends when its user is removed or changes password
    (`auth.py`, `session_is_current`). Single sessions cannot be revoked
    otherwise, because there is no server-side session store.
- **Routes.** Every route except `/login`, `/logout` and static files is wrapped
  by `require_auth` (`core.py`). Without a session, an API call gets
  `401 {"error": "Authentication required", "reason": "login_required"}` and a
  page is redirected to `/login?next=`.
- **Deep links through login.** These work.
  - `safe_next` accepts only a same-origin path under the app's mount point
    (`core.py`). `safe_fragment` and `login_required_response` are in the same
    file.
  - The login page copies `location.hash` into a hidden `fragment` field, and
    after a failed attempt the server renders it back
    (`templates/login.html`).
  - The server redirects to `next` plus the fragment after a successful login.
- **What a signed-in user can open.** No per-dataset rule exists: every
  signed-in user can open every dataset under `server.data_dir` and
  `server.allowed_dirs`.
  - Confinement only keeps paths inside those roots. It is one
    `before_request` hook (`annzarro/server/confinement.py`, `enforce`), and
    links that point outside the roots are left out of the dataset list
    (`listable`).
  - Panel sets are the only objects with an owner: their owner or an admin may
    change them, and everyone may read them (`annzarro/server/permissions.py`).
- **Security tiers.** The `security:` annotations in `schema.yaml` decide which
  configuration keys `/api/v1/config` publishes and which `config show/info`
  mask (issue #32). They concern configuration, not user access.
- **Share button.** It copies a plain deep link,
  `?dataset_path=<path>#view=<payload>` (`static/js/main.js`,
  `_shareCurrentView`; `static/js/utils/deeplink.js`, `buildDeepLinkUrl`).

## Threat model

The setting is an institutional network. People on the same network are not
trusted with each other's data, but this is not a defence against a determined
attacker on the host. Assets: datasets (often unpublished) and panel sets.

| | Threat | Main defence |
|---|---|---|
| T1 | A colleague on the network browses to the server | login on by default for network hosts; per-dataset access (b) |
| T2 | A share link forwarded by mistake, or pasted in a channel | expiry, single-use binding, revocation, audit log |
| T3 | A link leaks through browser history, proxy/access logs or the Referer header | token in the URL fragment, exchanged by POST and removed from the address bar; `Referrer-Policy` |
| T4 | Guessing or brute-forcing tokens or passwords | 256-bit tokens; per-(user, address) lockout; rate limit on redemption |
| T5 | CSRF or XSS turning a victim's session into an attacker's | SameSite=Lax plus CSRF tokens on state-changing forms; a Content-Security-Policy |
| T6 | A guest leaving their scope: other datasets, path tricks, remote URLs, writes | scope enforced in the single confinement hook; tests that enumerate every path-carrying route |

Out of scope: a malicious administrator, a compromised host, and links that the
recipient deliberately re-shares (expiry and revocation limit the damage).

## (a) Deep links survive login (shipped)

A link opened while signed out goes through `/login?next=<path and query>`. The
`#view=` fragment never reaches the server, so the login page carries it in a
hidden field and the server appends it to the redirect after a successful
login. `next` is accepted only as a same-origin path under the mount point; an
absolute URL, `//host`, a backslash or a control character falls back to the
front page.

The other half: a login can end while the app is open (the idle timeout, a
password change, user removal). `static/js/utils/session-expiry.js` wraps
`window.fetch` once.

- On the first `401` whose body says `reason: login_required`, it encodes the
  current view with the share-link encoder.
- It then goes to `/login?next=...#view=...`, and the steps above bring the user
  back to the same dataset and view.
- A return URL on another origin is dropped.

Tests:

- `annzarro/tests/server/test_login_redirect.py`: `next` and fragment
  handling, and the open-redirect cases.
- `annzarro/tests/js/session-expiry.test.mjs`: the wrapper.
- `annzarro/tests/browser/test_session_expiry.py`: sign in through a link,
  change the view, end the login, sign in again, same view.

## (b) Share links with a token

### What a link grants

A share link is a capability. Each link is stored in `links.json` beside the
users file, with the same locked atomic write and hot reload as the users file:

| Field | |
|---|---|
| `id` | short random id, shown in the interface and the audit log |
| `token_sha256` | SHA-256 of a 256-bit random token. The token is shown once, at creation. Its entropy makes a fast hash sufficient, and a lookup by hash is constant-time. |
| `label` | required, says who it is for ("Jane Doe, Broad") |
| `created_by`, `created_at` | |
| `expires_at` | default 7 days; a server maximum (`auth.share_link_max_days`, e.g. 90) |
| `datasets` | the real paths of single stores, each inside `data_dir`/`allowed_dirs` when the link is created |
| `permission` | `view`: read the datasets; no panel-set writes; optionally read-only panel sets |
| `single_use` | the first browser that redeems it is the only one it works for |
| `revoked_at`, `use_count`, `last_used_at` | |

### Link format and redemption

```
https://host/<prefix>/?dataset_path=<path relative to data_dir>#view=<payload>&s=<token>
```

1. The token lives in the **fragment**, so it never appears in a request line.
   That keeps it out of server and proxy access logs and out of Referer.
2. On load, the app reads `s` (the fragment is already parsed with
   `URLSearchParams`, so an extra key does not disturb `view`) and POSTs it to
   `/api/v1/share/redeem`.
3. The server checks the link (exists, not revoked, not expired, single-use not
   already bound to another browser). It then clears the session and starts a
   guest session `{share_id, login_at}`. The response carries
   `Cache-Control: no-store`.
4. The app calls `history.replaceState` to drop `s=` from the address. The
   history entry keeps the dataset and the view, not the token.
5. The app continues as with any deep link: one link carries data, view and
   access together.

Every page sends `Referrer-Policy: same-origin`.

### Guest sessions and scope

On every request the guest's link is checked again, the same way
`session_is_current` checks users, so revoking a link takes effect at once. The
scope is enforced in `confinement.enforce`, the hook every path-carrying request
already passes:

- a guest may open a path only if its real path equals one of the link's stores
  or lies under one;
- the dataset list shows only those stores;
- the directory browser and remote URLs (`s3://`, `https://`, ...) are refused;
- panel-set writes are refused through `permissions.can_modify`;
- the cache reset is already admin-only.

### Per-dataset access for named users

For "only the intended person" with passwords too, a user entry may carry
`datasets: [...]`. Without it, the user may open everything, as today. The same
confinement hook enforces it. Sharing with a named person can then be "grant
bob these datasets" instead of a bearer link.

### Abuse resistance

- **Forwarded links (T2):** short default expiry; single-use binding, where a
  second redemption is refused and appears in the audit log; one-click
  revocation.
- **Guessing (T4):** 256-bit tokens, plus a per-address rate limit on
  `/api/v1/share/redeem` (about 10 per minute; in memory per worker is enough at
  this entropy).
- **Audit log:** append-only JSON lines, readable by admins.
  - Events: `login`, `login_failed`, `link_created`, `link_redeemed`,
    `link_denied` (with the reason: expired, revoked, used),
    `link_revoked`, `dataset_opened` (first open per session and dataset).
  - Each event records the time, the user or link label, the client address (as
    seen through `proxy_count`) and the user agent.

## (c) Interface

These are server-rendered pages in the existing Flask app with the vendored
Bootstrap. They need no external service.

- `/admin`, for admins:
  - **Users:** add, admin flag, dataset access, remove.
  - **Invite:** a one-time link (48 hours) on which the new user sets their own
    password. It uses the same token machinery with purpose `invite`, so nobody
    has to type a password into the command line.
  - **Share links:** create, with datasets picked from the dataset list, a
    label, an expiry and single-use; a copy button; use count, last use, and
    revoke.
  - **Activity:** the audit log, filterable by user, link and dataset.
- `/links`: for users allowed to share (a new `can_share` flag), their own links
  only.
- **Login page:** the same template, plus clear messages for "this link has
  expired", "this link was revoked" and "this link was already used; ask the
  sender for a new one".
- **CSRF tokens** on every form and state-changing JSON request. SameSite=Lax
  alone does not cover other apps on the same site.
- **A Content-Security-Policy** (`script-src 'self'`), once the inline scripts
  in the templates have moved to files.

**Institutional single sign-on** is not built in. The reverse proxy (for
example oauth2-proxy, mod_auth_openidc, Shibboleth, or LDAP through nginx
`auth_request`) authenticates the user. AnnZarro then trusts a configured
header, `auth.trusted_user_header` (e.g. `X-Remote-User`), but only when
`server.proxy_count` is greater than 0. The header maps to existing users or
provisions them on first sight.

## (d) Share button

- With login off: a plain link, as today.
- With login on and a user who may share (an admin, or `can_share`): a small
  dialog.
  - "Signed-in users only" copies the plain link.
  - "Anyone with the link" takes a label, an expiry and a single-use choice,
    then POSTs `/api/v1/share-links` with the current dataset. The server returns
    the token once; the app composes the link with the current view and the
    token, and copies it.
- Guests get a plain link only: they cannot re-share access.

## (e) Defaults

Nothing changes where login is off, that is a loopback `annzarro start` and the
desktop app. There are no tokens, no admin pages and no new files. The links
file and the audit log are created when first needed, beside the users file.
`auth.share_links: false` turns share links off on a server that wants
passwords only.

## Effort, risk and order

| Part | Effort | Risk |
|---|---|---|
| (a) expiry handler | done | low, client only |
| per-dataset access and audit log | 1 to 2 days | the scope check must cover every path-carrying route |
| invite links | 1 day | token handling, reused by share links |
| share links and guest sessions | 3 to 4 days | bearer tokens, scope escape |
| admin and links pages, login states | 3 to 5 days | CSRF, XSS |
| share dialog | 1 day | low |
| single sign-on header | 1 day plus docs | header spoofing if `proxy_count` is wrong |
| security review | 1 to 2 days | |

Order for v0.4.0:

1. Per-dataset access and the audit log. These are small and already give
   "only the intended person".
2. Invite links.
3. Share links.
4. The pages.
5. The single sign-on header, in parallel.

The main risks are a path-carrying route that escapes the scope check
(mitigated by the single hook and a test that enumerates every route with a
path parameter), XSS (CSP), and tokens copied into the wrong place (short
expiry, single use, audit, revocation).
