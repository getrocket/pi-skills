#!/usr/bin/env node

import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectBrowser, getActivePage } from "./browser-common.js";

const b = await connectBrowser();
const p = await getActivePage(b);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const filename = `screenshot-${timestamp}.png`;
const filepath = join(tmpdir(), filename);

await p.screenshot({ path: filepath });

console.log(filepath);

await b.disconnect();
