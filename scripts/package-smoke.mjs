import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const npmCli = process.env.npm_execpath;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const directory = await mkdtemp(path.join(os.tmpdir(), "mdhq-package-"));
const packageDirectory = path.join(directory, "package");
const consumerDirectory = path.join(directory, "consumer");
const listRoot = path.join(directory, "list-root");

try {
  await mkdir(packageDirectory);
  await mkdir(consumerDirectory);
  await mkdir(listRoot);
  const runNpm = (arguments_, options = {}) =>
    npmCli
      ? execFileSync(process.execPath, [npmCli, ...arguments_], options)
      : execFileSync(npm, arguments_, {
          ...options,
          shell: process.platform === "win32"
        });
  const tarball = runNpm(
    ["pack", "--pack-destination", packageDirectory, "--silent"],
    { cwd: process.cwd(), encoding: "utf8" }
  ).trim();
  await writeFile(
    path.join(consumerDirectory, "package.json"),
    JSON.stringify({ private: true, type: "module" })
  );
  runNpm(
    [
      "install",
      "--omit=optional",
      "--no-audit",
      "--no-fund",
      path.join(packageDirectory, tarball)
    ],
    { cwd: consumerDirectory, stdio: "inherit" }
  );
  execFileSync(
    process.execPath,
    ["--input-type=module", "-e", 'await import("@songmu/mdhq")'],
    { cwd: consumerDirectory, stdio: "inherit" }
  );
  await access(
    path.join(
      consumerDirectory,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "mdhq.cmd" : "mdhq"
    )
  );
  const version = runNpm(["exec", "--offline", "--", "mdhq", "--version"], {
    cwd: consumerDirectory,
    encoding: "utf8"
  }).trim();
  if (!version) {
    throw new Error("Installed mdhq executable produced no version output");
  }
  const listed = runNpm(
    ["exec", "--offline", "--", "mdhq", "list", "--root", listRoot],
    {
      cwd: consumerDirectory,
      encoding: "utf8"
    }
  );
  if (listed !== "") {
    throw new Error("Installed mdhq list produced unexpected output");
  }
  await readFile(
    path.join(
      consumerDirectory,
      "node_modules",
      "@songmu",
      "mdhq",
      "docs",
      "specification.md"
    ),
    "utf8"
  );
  const declarations = await readFile(
    path.join(
      consumerDirectory,
      "node_modules",
      "@songmu",
      "mdhq",
      "dist",
      "index.d.ts"
    ),
    "utf8"
  );
  if (!declarations.includes("MdhqConfig")) {
    throw new Error("Packed mdhq declarations do not export MdhqConfig");
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
