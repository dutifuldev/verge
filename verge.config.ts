import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSelfHostedVergeConfig, defineVergeConfig } from "./packages/core/src/config.js";

const rootPath = path.dirname(fileURLToPath(import.meta.url));

export default defineVergeConfig(createSelfHostedVergeConfig(rootPath));
