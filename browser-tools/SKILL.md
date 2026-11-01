---
name: browser-tools
description: Interactive browser automation via Chrome DevTools Protocol. Use when you need to interact with web pages, test frontends, or when user interaction with a visible browser is required.
---

# Browser Tools

Connect to Chrome on the host through its remote debugging interface. Use the existing host browser when running in a container; keep browser profiles outside the repository. Do not launch or install a container browser to work around a host connection failure.

## Connection and setup

Chrome must already have remote debugging enabled. The default endpoint is `http://host.docker.internal:9222`. `BROWSER_URL` overrides it, for example `http://localhost:9222` when running on the host. The helper resolves `host.docker.internal` to an IPv4 address, including when explicitly configured, because Chrome rejects that hostname in the debugging endpoint's Host header.

Use Node.js 22 or newer. Dependencies are normally already installed. Only if they are missing:

```bash
cd {baseDir}
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
```

Check the connection and list tab IDs:

```bash
{baseDir}/browser-start.js
```

The helper uses the existing Puppeteer 24 dependency. Puppeteer 23 can stall during attachment when isolated contexts with existing iframes are open, even though Chrome's HTTP and WebSocket endpoints respond.

## Select the intended tab

With multiple tabs, use the ID from `browser-start.js`:

```bash
BROWSER_TARGET_ID=<tab-id> {baseDir}/browser-eval.js 'document.title'
BROWSER_TARGET_ID=<tab-id> {baseDir}/browser-nav.js http://localhost:3000/orbit
```

Tab order does not indicate focus or the newest tab. Commands that operate on an existing page require `BROWSER_TARGET_ID` when more than one tab exists. In a script, keep the `Page` returned by `newPage()` or call `getActivePage(browser, targetId)` explicitly. A missing ID fails rather than choosing another user's tab.

## Keep one connection for a workflow

For multiple steps or users, use one Node script and keep its connection open through authentication, context creation, navigation, requests, and assertions. `connectBrowser()` shares pending and established connections **within that Node process**; separate CLI invocations cannot share it. Disconnect once when finished. A later call after disconnect or a failed connection can reconnect.

```javascript
import { connectBrowser, getActivePage } from "{baseDir}/browser-common.js";

const browser = await connectBrowser();
try {
    const page = await getActivePage(browser); // BROWSER_TARGET_ID selects the tab.
    await page.goto("http://localhost:3000/orbit", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('textarea[placeholder="Type a message…"]');
    console.log(await page.title());
    // Continue this workflow using the same browser and page objects.
} finally {
    await browser.disconnect(); // Leave host Chrome running.
}
```

For concurrent users, create separate `browser.createBrowserContext()` contexts on this connection and retain their page objects. Use the application's approved development login flow; keep any session credentials in memory. Verify the authenticated identity in each context before sending requests. Close only the contexts and tabs created by the test in `finally`, before disconnecting. Use `browser.disconnect()`, not `browser.close()`, to leave the user's browser running.

## Diagnose failures by stage

The helper reports distinct failures for HTTP discovery, the debugging WebSocket, and Puppeteer attachment. Each connection stage has a bounded wait; failed attachment closes the connection it opened and clears its timers. It throws an error so the caller can clean up its own test resources.

- **HTTP discovery failed:** check the host address, port, and remote debugging endpoint. A container process list does not establish whether a host process is running.
- **HTTP succeeded, WebSocket failed:** the discovery endpoint is reachable; inspect the reported debugging socket and host connection.
- **HTTP and WebSocket succeeded, attachment failed:** Chrome is reachable. Keep the workflow on one connection and inspect attachment behavior; do not treat this as proof Chrome is stopped.

A single reconnect is reasonable after a transient failure. If it persists, stop browser actions and report the failing stage and remaining tests. Do not restart or kill host processes, alter host configuration, or close unrelated contexts as a recovery shortcut.

## Interact with the page

Inspect DOM state and available controls before interacting. Prefer DOM reads for state checks; use screenshots when visual appearance is the thing being checked.

```javascript
await page.evaluate(() => ({
    title: document.title,
    buttons: Array.from(document.querySelectorAll("button")).map((button) => ({
        label: button.getAttribute("aria-label") || button.textContent.trim(),
        disabled: button.disabled
    }))
}));
```

Host Chrome may be backgrounded. Animation-frame waits and pointer-driven clicks can stall there. For state checks use `waitForFunction` with explicit polling, such as `{ polling: 100, timeout: 15000 }`. For a simple button, `page.$eval(selector, button => button.click())` can exercise the actual handler without relying on foreground rendering. Use real pointer or keyboard interaction when that behavior is part of the test. Wait for the resulting application state before the next dependent action.

Batch independent reads or actions; keep dependent navigation and state transitions in order. Wait for streaming responses and final stdout to finish before declaring a test complete.

## CLI commands

Use these for individual operations; use the persistent script workflow above for a sequence. Set `BROWSER_TARGET_ID` for commands that use an existing tab.

```bash
# Navigation; --new opens a tab and does not require an existing tab ID.
{baseDir}/browser-nav.js https://example.com --new
BROWSER_TARGET_ID=<tab-id> {baseDir}/browser-nav.js https://example.com --reload

# Evaluate JavaScript in the selected page.
BROWSER_TARGET_ID=<tab-id> {baseDir}/browser-eval.js 'document.title'

# Screenshot; prints the temporary image path.
BROWSER_TARGET_ID=<tab-id> {baseDir}/browser-screenshot.js

# Let the user select page elements interactively.
BROWSER_TARGET_ID=<tab-id> {baseDir}/browser-pick.js "Select the submit button"

# Inspect cookies when needed for an authentication investigation.
BROWSER_TARGET_ID=<tab-id> {baseDir}/browser-cookies.js

# Navigate the selected tab and extract readable Markdown.
BROWSER_TARGET_ID=<tab-id> {baseDir}/browser-content.js https://example.com
```

Use `browser-pick.js` when the user asks to select specific elements visually. Cookie output includes credentials; inspect it only when needed and keep those values out of reports and saved artifacts. Content extraction uses Readability and Turndown, without adding dependencies to the application under test.
