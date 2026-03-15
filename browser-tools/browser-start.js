#!/usr/bin/env node

import { BROWSER_URL, connectBrowser } from "./browser-common.js";

// Just verify we can connect to the remote browser
const b = await connectBrowser();
const pages = await b.pages();
console.log(`✓ Connected to Chrome at ${BROWSER_URL}`);
console.log(`  ${pages.length} tab(s) open`);
for (const p of pages) {
	console.log(`  - ${p.url()}`);
}
await b.disconnect();
