::::::{div} mode-grid

:::::{div} mode-col
<p class="mode-title">Desktop app</p>
<p class="mode-sub">One person, data on your computer</p>

::::{div} badge-row
```{button-link} https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-macos-arm64.dmg
:class: badge badge-apple
macOS
```
```{button-link} https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-windows-x64-setup.exe
:class: badge badge-windows
Windows
```
```{button-link} https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-linux-x86_64.AppImage
:class: badge badge-linux
Linux
```
::::

<p class="badge-alt">macOS: <a href="https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-macos-arm64.dmg">Apple silicon</a>, <a href="https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-macos-x64.dmg">Intel</a>, or <code>brew install --cask settylab/annzarro/annzarro</code>. Linux: <a href="https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-linux-x86_64.AppImage">AppImage</a>, <a href="https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-linux-amd64.deb">.deb</a>. <a href="https://github.com/settylab/annzarro/releases/latest">All files and checksums</a></p>

- Standalone on your laptop, no Python needed
- Works offline
- Your data stay on your computer
- No login, no set-up
- Opens local `.zarr` stores
:::::

:::::{div} mode-col
<p class="mode-title">Server</p>
<p class="mode-sub">One server, many users in the browser</p>

::::{div} badge-row
```{button-ref} /deployment/lab-server
:ref-type: doc
:class: badge badge-server
Server
```
::::

- Multi-user access in the browser, with login
- Panel sets shared and exchanged between users
- Large datasets stay on the server; only the slices a view needs travel to the browser
- Per-user dataset access control and an admin page
- Less memory on each user's computer
:::::

::::::
