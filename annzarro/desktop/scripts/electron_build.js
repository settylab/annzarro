#!/usr/bin/env node
/* electron-builder with the macOS signing mode chosen for this machine.
 *
 *   node annzarro/desktop/scripts/electron_build.js [electron-builder args]
 *   (from annzarro/desktop/electron: `npm run dist`, `npm run dist:dir`)
 *
 * On macOS:
 *   - a Developer ID Application identity is available (CSC_LINK, CSC_NAME, or one in
 *     the keychain): the app is signed with it, hardened runtime and timestamp, every
 *     nested Mach-O of the frozen server included, and the dmg is signed too.
 *     the app is notarized and stapled, with retries, before the dmg and zip are packed
 *     (electron-builder's own notarization is off: mac_after_sign.js, mac_notarize.sh) when
 *     notarization credentials are in the environment: APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER,
 *     or APPLE_KEYCHAIN_PROFILE (a `notarytool store-credentials` profile, by name), or
 *     APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID. Without credentials the
 *     build is signed but not notarized, and says so.
 *   - no identity (a contributor's laptop): ad-hoc signed, never notarized, as before.
 * Other platforms: electron-builder unchanged.
 *
 * Flags of this script (removed before electron-builder sees the arguments):
 *   --adhoc                   ignore any identity and sign ad-hoc
 *   --require-notarization    fail unless a Developer ID identity AND notarization
 *                             credentials are present (the release build uses it)
 */
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");

const argv = process.argv.slice(2);
const take = (flag) => {
  const i = argv.indexOf(flag);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};
const forceAdhoc = take("--adhoc");
const requireNotarization = take("--require-notarization");

const env = { ...process.env };
const args = [...argv];
if (!args.includes("--publish")) args.push("--publish", "never");

const wantsMac = process.platform === "darwin" && (args.includes("--mac") || !(args.includes("--win") || args.includes("--linux")));

function keychainHasDeveloperId() {
  const r = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  return r.status === 0 && /Developer ID Application/.test(r.stdout);
}

function notarizationCredentials() {
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) return "App Store Connect API key";
  if (env.APPLE_KEYCHAIN_PROFILE) return `keychain profile ${env.APPLE_KEYCHAIN_PROFILE}`;
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) return "Apple ID";
  return null;
}

if (wantsMac) {
  const haveIdentity = !forceAdhoc && Boolean(env.CSC_LINK || env.CSC_NAME || keychainHasDeveloperId());
  const creds = haveIdentity ? notarizationCredentials() : null;
  if (requireNotarization && !(haveIdentity && creds)) {
    console.error("electron_build: --require-notarization, but " + (haveIdentity ? "no notarization credentials are set" : "no Developer ID identity is available"));
    process.exit(2);
  }
  if (haveIdentity) {
    args.push("-c.dmg.sign=true");
    // electron-builder's own notarization has no retry for `stapler staple`, which Apple's ticket
    // service fails often enough to break releases. Off here; mac_after_sign.js notarizes the app
    // (before the dmg and zip are packed) through mac_notarize.sh, which retries.
    args.push("-c.mac.notarize=false", `-c.afterSign=${path.join(__dirname, "mac_after_sign.js")}`);
    if (creds) env.ANNZARRO_NOTARIZE = "1";
    console.log(`electron_build: macOS signed with a Developer ID identity; ${creds ? "notarized with " + creds : "NOT notarized (no credentials in the environment)"}`);
  } else {
    // package.json names no identity, so electron-builder would skip signing here. Ad-hoc
    // signing keeps the app launchable on Apple silicon (see "First launch" in the docs).
    args.push("-c.mac.identity=-", "-c.mac.notarize=false");
    env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    console.log("electron_build: macOS ad-hoc signed, not notarized (no Developer ID identity)");
  }
}

const bin = path.join(__dirname, "..", "electron", "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
const r = spawnSync(bin, args, { cwd: path.join(__dirname, "..", "electron"), env, stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status === null ? 1 : r.status);
