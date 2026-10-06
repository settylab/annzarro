# Personal server over SSH

Run AnnZarro where the stores already are (a workstation or an HPC compute node) and view it in
the browser on your laptop through an SSH tunnel. The stores are never copied: the server reads
the chunks it needs and sends only the vectors on screen across the tunnel. This is the
"Personal server" arrangement of {doc}`modes`.

The server stays bound to `127.0.0.1` on the remote machine, so it is not reachable from the
network and needs no login. The tunnel is what lets your laptop in.

## On a workstation

1. Log in to the workstation and install AnnZarro there ({doc}`../getting-started/installation`).
2. Start the server without a browser, on a port of your choice (here 8765):

   ```bash
   annzarro start --no-browser --port 8765 --data-dir /path/to/stores
   ```

   It logs `Starting Annzarro server on 127.0.0.1:8765`. If the port is taken, pick another.
3. On your **laptop**, open the tunnel:

   ```bash
   ssh -N -L 8765:127.0.0.1:8765 you@workstation.example.org
   ```

   `-L 8765:127.0.0.1:8765` forwards port 8765 on your laptop to port 8765 on the
   workstation's own loopback interface; `-N` runs no remote command. Leave it running.
4. On your laptop, open `http://localhost:8765`.

Through the tunnel the page is served from `localhost`, which browsers treat as a secure
context, so **Share Link** copies straight to the clipboard. A share link contains
`localhost:8765` and the server-side path of the dataset; a colleague can open it only with
their own tunnel to the same server and port.

To keep the server running after you log out, start it inside `tmux` or `screen`, or detach it:

```bash
annzarro start --no-browser --port 8765 --data-dir /path/to/stores --detach
annzarro stop        # later; stops the server started with --detach
```

`--detach` writes its PID to `~/.annzarro/server.pid`; `annzarro stop` reads that file and
signals the process only if it is your own `annzarro start`, so it only stops a server started
with `--detach` by the same user (with the same `ANNZARRO_HOME`).

## On an HPC cluster with Slurm

Run the server in a job on a compute node, never on a login node.

1. Submit a job that starts the server. Example `annzarro.sbatch`:

   ```bash
   #!/bin/bash
   #SBATCH --job-name=annzarro
   #SBATCH --cpus-per-task=4
   #SBATCH --mem=8G
   #SBATCH --time=08:00:00
   source ~/annzarro-env/bin/activate
   annzarro start --no-browser --port 8765 --data-dir /path/to/stores
   ```

   ```bash
   sbatch annzarro.sbatch
   squeue --me --name annzarro --format "%N %T"   # node name once RUNNING
   ```

   Interactively, `srun --pty -c 4 --mem 8G -t 8:00:00 bash` and then the same `annzarro start`
   line works too.
2. From your laptop, tunnel through the login node to the compute node:

   ```bash
   ssh -N -J you@login.cluster.example.org -L 8765:127.0.0.1:8765 you@<node>
   ```

   `-J` (ProxyJump) hops through the login node, and the forward ends on the compute node's own
   loopback, where the server listens. Most clusters allow SSH to a node on which you have a
   running job; if yours does not, ask your administrators how they forward ports to jobs.
3. Open `http://localhost:8765` on your laptop.
4. When you are done, `scancel` the job.

**Memory.** The server's result cache is bounded by `server.cache_memory_mb`, 4,000 MB with the
default configuration, plus the chunks being read; serving one gene column or cell row of a
0.2-20 GB layer took 81-102 MiB in the paper's v0.4.0 laptop benchmark
({doc}`../reference/performance`). Request memory for both, or lower the cache, for example
with `ANNZARRO_SERVER_CACHE_MEMORY_MB=1000`.

**Chunks matter more than size.** The slowest interaction is decided by the chunk layout of
the stores, not by their size; with whole-gene chunks one cell's row decompresses the whole
layer ({doc}`../data/chunking`).

**Home directories.** The log and PID file go to `~/.annzarro`. Set `ANNZARRO_HOME` to a
scratch or project directory if your home quota is small.

:::{warning}
**Loopback is shared on a shared node.** `127.0.0.1` keeps the server off the network, but
every other user logged in to the *same* node can connect to it, and without login they can
open every dataset the server can read and delete your panel sets. On a node shared with other
users, turn login on even though the server is bound to loopback. Put this in
`~/annzarro-personal.yaml`:

```yaml
auth:
  enabled: true
```

then add yourself and start with that file:

```bash
annzarro --config ~/annzarro-personal.yaml user add --username you
annzarro start --config ~/annzarro-personal.yaml --no-browser --port 8765 --data-dir /path/to/stores
```

With login on, the server also confines paths to the data directory. See {doc}`authentication`.
:::

## Without SSH to the compute node

If the cluster does not allow SSH to compute nodes, the server must listen on the node's network
address so the login node can reach it, and the tunnel ends there:

```bash
annzarro start --no-browser --host 0.0.0.0 --port 8765 --data-dir /path/to/stores   # on the node
ssh -N -L 8765:<node>:8765 you@login.cluster.example.org                           # on the laptop
```

A non-loopback host makes the server *shared*: login is required and paths are confined to the
data directory. Add yourself as a user first (`annzarro user add`, {doc}`authentication`). Do not
pass `--auth-disabled` here: the port is then open to everyone on the cluster network.
