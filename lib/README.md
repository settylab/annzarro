# Library Files for Annzarro

This directory contains essential library files required for the application to function properly.

## Required Libraries

- `zarr.umd.js` - The UMD build of zarr.js v0.6.2

## How to Install/Update Libraries

### zarr.js

You can install the zarr.js UMD build in either of the following ways:

#### Option 1: Download directly from NPM

```bash
# From the project root directory
npm pack zarr@0.6.2
tar -xzf zarr-0.6.2.tgz
cp package/zarr.umd.js lib/
rm -rf package zarr-0.6.2.tgz
```

#### Option 2: Download directly from GitHub

```bash
curl -o lib/zarr.umd.js https://github.com/gzuidhof/zarr.js/releases/download/v0.6.2/zarr.umd.js
```

#### Option 3: Use a CDN

If you're unable to download the library directly, the application will attempt to 
load it from CDNs in the following order:

1. Local file (lib/zarr.umd.js)
2. jsdelivr CDN (https://cdn.jsdelivr.net/npm/zarr@0.6.2/dist/zarr.umd.js)
3. unpkg CDN (https://unpkg.com/zarr@0.6.2/dist/zarr.umd.js)

Note that using the local file is recommended for consistent performance and offline capabilities.