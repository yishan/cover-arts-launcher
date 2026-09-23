import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";

const expectedVersion = "0.6.1";
const packageRoot = new URL("./node_modules/esptool-js/", import.meta.url);
const vendorRoot = new URL("./vendor/", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));

if (packageJson.version !== expectedVersion) {
  throw new Error(`Expected esptool-js ${expectedVersion}, found ${packageJson.version}.`);
}

await mkdir(vendorRoot, { recursive: true });
const bundleSource = new URL("bundle.js", packageRoot);
const bundleTarget = new URL(`esptool-js-${expectedVersion}.js`, vendorRoot);
await copyFile(bundleSource, bundleTarget);
await copyFile(new URL("LICENSE", packageRoot), new URL("LICENSE.esptool-js.txt", vendorRoot));

const digest = createHash("sha256").update(await readFile(bundleTarget)).digest("hex");
console.log(`Vendored esptool-js ${expectedVersion}: sha256 ${digest}`);
