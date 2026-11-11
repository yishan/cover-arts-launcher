import { copyFile, mkdir } from "node:fs/promises";

const packageRoot = new URL("./node_modules/@vercel/analytics/dist/", import.meta.url);
const vendorRoot = new URL("./vendor/", import.meta.url);

await mkdir(vendorRoot, { recursive: true });

// Copy the main module file
const bundleSource = new URL("index.mjs", packageRoot);
const bundleTarget = new URL("vercel-analytics.js", vendorRoot);
await copyFile(bundleSource, bundleTarget);

console.log("Vendored @vercel/analytics");
