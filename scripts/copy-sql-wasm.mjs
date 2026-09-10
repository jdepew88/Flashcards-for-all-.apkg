// Copies the sql.js WebAssembly binary into public/ so the browser can fetch it
// from `/sql-wasm.wasm` (the path client-import.ts asks for by default).
//
// Kept as a copy step rather than a Vite import so the .wasm is served as a
// plain static asset, exactly as it is in the CCNA Practice Labs app.

import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/sql.js/dist/sql-wasm.wasm");
const target = resolve(root, "public/sql-wasm.wasm");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(source))) {
  if (await exists(target)) {
    console.log("[copy-sql-wasm] sql.js not installed yet; keeping existing public/sql-wasm.wasm");
    process.exit(0);
  }
  console.error("[copy-sql-wasm] node_modules/sql.js/dist/sql-wasm.wasm not found. Run `npm install` first.");
  process.exit(1);
}

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log("[copy-sql-wasm] public/sql-wasm.wasm updated");
