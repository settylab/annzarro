# Deployment modes

The same software runs in three arrangements (paper figure {doc}`../paper/deployment`).
They differ in where the browser, the server and the data are, and in who can reach the server.
In all three, the browser receives only the vectors on screen and the server reads only the
chunks it needs, so the data never have to be copied to the viewer's machine.

| | Desktop app | Personal server | Lab server |
|---|---|---|---|
| Who uses it | one person | one person | a lab or institute |
| Where the server runs | your laptop | a workstation or HPC node next to the data | an institutional server |
| How you start it | open the app | `annzarro start` | gunicorn with the hosted WSGI factory, as a service |
| How the browser reaches it | inside the app | SSH tunnel to `127.0.0.1` | HTTPS through a reverse proxy |
| Login | off | off (the server is bound to loopback) | on |
| Which paths can be opened | any on your disk | any the server process can read | only the data directory and `allowed_dirs` (admins too, unless `server.arbitrary_paths: admins`) |
| Remote stores (`s3://`, ...) | not supported (the app ships without the remote readers) | allowed on loopback without login; with login only from `remote_allowlist` | only from `remote_allowlist` |
| Panel sets | yours | yours | shared by all users, with owners |
| Set-up page | {doc}`../getting-started/desktop-app` | {doc}`personal-server` | {doc}`lab-server`, {doc}`authentication` |

## Choosing

- **Data on your laptop, only you.** Desktop app, or `annzarro start` if you have Python.
- **Data on a cluster or a big workstation, only you.** Personal server. The stores stay where
  they are; only the vectors you look at cross the SSH connection.
- **Several people should browse the same processed datasets.** Lab server. It is read-only by
  design: it never writes to datasets and never runs user code, so giving a colleague access to
  a dataset does not give them write or compute access. The one thing users write is panel sets.

## What decides "shared"

The server treats itself as *shared* (or *hosted*) when any of these is true:

- login is enabled (`auth.enabled`),
- it is bound to an address other than `127.0.0.1`, `localhost` or `::1`,
- `server.hosted: true` is set, which the WSGI entry point used by gunicorn does by default.

A shared server confines every dataset and directory path to the data directory plus
`server.allowed_dirs`, compresses JSON replies, and applies the stricter remote-store policy.
Binding to a network address also turns login on unless you pass `--auth-disabled`; doing that
logs a `SECURITY` banner and shows a "No login" badge in the header
({doc}`hosting-checklist`).

```{note}
`annzarro start` trusts no `X-Forwarded-*` headers (`server.proxy_count: 0`). A server behind a
reverse proxy must say so with `proxy_count: 1` (or `ANNZARRO_SERVER_PROXY_COUNT=1`), see
{doc}`lab-server`. Any value above 0 also counts as "shared" for the remote-store policy.
```
