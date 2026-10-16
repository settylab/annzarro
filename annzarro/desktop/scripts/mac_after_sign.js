/* electron-builder afterSign hook: notarize and staple the signed .app, before the dmg and the
 * zip are packed, so both carry the ticket and the updater's zip is right.
 *
 * electron-builder's own notarization is off (electron_build.js passes mac.notarize=false): it
 * throws when `stapler staple` loses its connection to Apple's ticket service, right after Apple
 * accepted the app, and cannot retry. mac_notarize.sh does the same with retries.
 *
 * Runs only when electron_build.js set ANNZARRO_NOTARIZE=1 (a Developer ID identity and
 * notarization credentials are present); otherwise the app is left signed but not notarized.
 */
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin" || process.env.ANNZARRO_NOTARIZE !== "1") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • notarizing ${app} (mac_notarize.sh)`);
  const r = spawnSync(path.join(__dirname, "mac_notarize.sh"), [app], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`notarizing ${app} failed (exit ${r.status})`);
};
