# Fig. 8: three ways to run AnnZarro

```{figure} ../_static/figures/paper/fig8.png
:alt: Three panels: desktop app on a laptop; personal server on a workstation or HPC node reached through an SSH tunnel; lab server behind a TLS proxy serving several browsers.
:width: 100%

Paper Fig. 8. Dashed boxes are machines, blue boxes the AnnZarro server. Arrows show what
moves per click: compressed chunks from storage to the server, and one decoded vector from
the server to each browser.
```

The three arrangements run the same server code and the same browser interface. They differ
in where the server runs, who can reach it, and whether a login is needed. This page shows
how to set up each one far enough to reproduce the figure. The deployment pages hold the
full instructions; this guide links to them rather than repeating them.

| | Desktop app | Personal server | Lab server |
|---|---|---|---|
| Server runs on | the laptop, inside the app | a workstation or HPC node, `annzarro start` | an institutional server, gunicorn behind nginx |
| Data live on | the laptop | the machine with the server | the institutional server |
| Browser reaches it via | the app window | an SSH tunnel to `localhost` | HTTPS |
| Login | none | none (bound to 127.0.0.1) | required |
| Users | one | one | many; panel sets shared by all |
| Full instructions | {doc}`../getting-started/desktop-app` | {doc}`../deployment/personal-server` | {doc}`../deployment/lab-server` |

{doc}`../deployment/modes` compares the three in more depth.

## What crosses each arrow

In every arrangement a click moves the same two things, and only these. The server reads the
zarr chunks that hold the requested slice and decompresses them; the browser receives that
one decoded vector. For the focused gene's fold change on `bm_aging.zarr` that is 8,090
float32 values, 32,360 bytes; for the focused cell's row it is 16,285 values, 65,140 bytes
(measured in {doc}`fig9-performance`). The whole store never leaves the machine it is on.
This is why the personal server is practical over an SSH tunnel: the network carries vectors
of kilobytes to a few megabytes, not the matrices.

## Reproducing each mode

::::{tab-set}

:::{tab-item} Desktop app
The desktop app runs the bundled server and the interface together in one Electron window
on the laptop. Data and server stay on the laptop.

1. Install the app as described in {doc}`../getting-started/desktop-app`.
2. Start it. The AnnZarro window opens with its own server already running.
3. Choose a local `.zarr` or `.h5ad` in the **Dataset** dropdown.

```{note}
At the time of writing, the newest published desktop release on GitHub is v0.1.1
(April 2025), which predates most features in this documentation. Until a new release is
published, run the current code as a personal server on the laptop instead (next tab, without
the tunnel), which gives the same picture: browser and server on one machine.
```
:::

:::{tab-item} Personal server
The server runs where large stores already are (a workstation, or a compute node of a cluster),
and binds to that node's loopback address. Your laptop's browser reaches it through an SSH
tunnel, so no port is opened to the network and no login is needed.

1. Install AnnZarro in an environment on the cluster ({doc}`../getting-started/installation`).
2. Get a node, for example with an interactive Slurm job, and start the server there:

   ```bash
   annzarro start --port 8765 --data-dir /path/to/stores --no-browser
   ```

   It binds to `127.0.0.1` by default, and on loopback it starts without a login (the log
   says `Authentication disabled`).
3. On your laptop, open a tunnel to that node through the cluster's login host. Replace
   `login.example.org` and `node123` with your login host and the node name:

   ```bash
   ssh -N -J you@login.example.org -L 8765:127.0.0.1:8765 you@node123
   ```

   Because the server listens on the node's own loopback, the tunnel has to end on the node
   (`-J` jumps through the login host); forwarding to `node123:8765` from the login host
   would not reach it.
4. Open `http://localhost:8765` in your browser and choose a store in **Dataset**.

Share links made here contain `localhost:8765` and the dataset's path on the cluster; a
colleague can open them only with their own tunnel to the same server. See
{doc}`../deployment/personal-server` for running it in the background, choosing a free port
and keeping the server alive across disconnects.
:::

:::{tab-item} Lab server
A lab or core facility hosts datasets for many users. The server never writes to the
datasets and runs no user code; the only thing users write is panel sets, which every user
of the server can open.

1. Run the WSGI app under gunicorn on loopback, with a site configuration that names the data
   directory and the users file:

   ```bash
   export ANNZARRO_CONFIG=/etc/annzarro/site.yaml
   gunicorn -w 4 -b 127.0.0.1:8000 "annzarro.server.wsgi:create_wsgi_app()"
   ```

   `create_wsgi_app()` treats the server as hosted: login is on and datasets are confined to
   the data directory.
2. Put nginx (or another TLS-terminating proxy) in front on port 443, forwarding to
   `127.0.0.1:8000`, and set `proxy_count: 1` in the site configuration.
3. Add users with `annzarro user add` (`--admin` for users who may delete or overwrite
   anyone's panel sets).
4. Users open `https://annzarro.example.org`, log in, and choose a dataset.

The complete site configuration, nginx block, systemd unit and the permissions model are in
{doc}`../deployment/lab-server` and {doc}`../deployment/authentication`; check the setup
against {doc}`../deployment/hosting-checklist` before announcing the server.
:::

::::

## Which one to use

- **Data on your laptop, working alone:** the desktop app, or `annzarro start` on the laptop.
- **Data on a cluster or workstation, working alone:** a personal server and an SSH tunnel.
  Copying a large store to the laptop is not needed; a click moves one vector.
- **Several people, the same datasets, shared views:** a lab server. Panel sets saved by one
  user appear in **Load Panel Set** for everyone (see {doc}`../user-guide/panel-sets`).

Latency differs between the arrangements mainly through storage: a network file system adds
time to a cold read compared with a laptop SSD. {doc}`fig9-performance` gives both laptop and
HPC measurements.
