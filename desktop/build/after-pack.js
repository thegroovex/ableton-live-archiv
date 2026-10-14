// macOS: Unsignierte Apps auf Apple Silicon brauchen mindestens eine Ad-hoc-Signatur,
// sonst meldet macOS „beschädigt“. Signiert das ganze Paket inkl. Python-Server.
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
};
