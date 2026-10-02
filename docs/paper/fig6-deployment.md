# Fig. 6 · Deployment

```{figure} ../_static/figures/paper/fig6.png
:alt: Three panels: desktop app on a laptop; personal server on a workstation or HPC node reached through an SSH tunnel; lab server behind a TLS proxy serving several browsers.
:width: 100%

Paper Fig. 6. Dashed boxes are machines, blue boxes the AnnZarro server. Arrows show what
moves per click: compressed chunks from storage to the server, and one decoded vector from
the server to each browser.
```

The same server and interface run in three arrangements, which differ in where the server
runs, who can reach it and whether a login is needed. In each, a click moves one vector to the
browser: on `bm_aging.zarr` a gene's fold change is 32,360 bytes and a cell's is 65,140 bytes
(measured in {doc}`fig7-performance`). {doc}`../deployment/modes` compares the three; set
each one up with {doc}`../getting-started/desktop-app`, {doc}`../deployment/personal-server`
(`annzarro start` on a workstation or HPC node, reached through an SSH tunnel) and
{doc}`../deployment/lab-server` (gunicorn behind a TLS proxy, with
{doc}`../deployment/authentication` and the {doc}`../deployment/hosting-checklist`).
