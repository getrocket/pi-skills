#!/usr/bin/env node

import { connectBrowser, getActivePage } from "./browser-common.js";

const b = await connectBrowser();
const p = await getActivePage(b);

const cookies = await p.cookies();

for (const cookie of cookies) {
	console.log(`${cookie.name}: ${cookie.value}`);
	console.log(`  domain: ${cookie.domain}`);
	console.log(`  path: ${cookie.path}`);
	console.log(`  httpOnly: ${cookie.httpOnly}`);
	console.log(`  secure: ${cookie.secure}`);
	console.log("");
}

await b.disconnect();
