import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

export const VERSION = packageJson.version;
export const PROJECT_URL = "https://github.com/Songmu/markhq";
export const DEFAULT_USER_AGENT = `markhq/${VERSION} (+${PROJECT_URL})`;
