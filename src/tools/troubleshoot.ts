/**
 * The `flarum_troubleshoot` tool: a plain-language guide for forum ADMINS and
 * non-developers to diagnose a broken or misbehaving Flarum forum and prepare a
 * support request that people can actually help with.
 *
 * This is the self-service counterpart to the managed `flarum_diag`/
 * `flarum_triage` tools: those need server-side access (a hosting control plane)
 * and so are managed-tier only, whereas this ships only knowledge, needs no
 * forum connection or API key, and works for every self-hoster. It deliberately
 * assumes no coding experience and is vendor-neutral (points at the official
 * community and each extension's own tracker, no specific host or brand).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const TITLE = "Flarum troubleshooting & support-request guide";

const INTRO =
  "A plain-language guide for forum admins (no coding required) to diagnose a misbehaving or broken " +
  "Flarum forum and put together a support request people can actually help with. It is the self-service " +
  "companion to managed diagnostics: knowledge, not server access. Pass a `topic` to narrow it. To collect " +
  "the details automatically from a forum that still loads, use the `prepare-flarum-support-request` prompt.";

const SECTIONS: Record<string, { title: string; body: string }> = {
  "first-aid": {
    title: "First aid: safe things to try first",
    body: `Before asking for help, these safe, reversible steps fix a large share of problems. Run them in your forum's folder (the one with \`composer.json\`). If you can't open a command line, see \`info\` for how to get one on your host.
- **Clear the cache**: \`php flarum cache:clear\`. Fixes most "I changed a setting or enabled an extension and now it's blank or weird" issues.
- **Re-publish assets**: \`php flarum assets:publish\`. Fixes broken styling, missing icons, or JavaScript that won't load, usually after an update.
- **Run migrations**: \`php flarum migrate\`. Fixes errors right after updating Flarum or an extension (a database change didn't get applied).
- **Suspect the last thing you changed.** Most breakage comes from the most recently installed, updated, or enabled extension; disabling it is the fastest test (see \`common\` for how to disable one even when the admin page won't load).
- **Check the basics**: that you haven't run out of disk space and that your database server is running. A lot of "sudden 500 errors" are a full disk or a stopped database.
- **Re-test in a private/incognito window** to rule out a stale browser cache or a browser extension.
None of these delete content. If a step doesn't help, move on and gather details for a support request (\`report\`).`,
  },
  info: {
    title: "Getting your system info (php flarum info)",
    body: `Helpers always ask for your versions and setup. One command prints all of it: \`php flarum info\` (Flarum version, PHP version, every installed extension with its version, and your mail/queue/database drivers).
- **How to run it depends on your hosting:**
  - **Your own server / VPS (SSH)**: connect with SSH, \`cd\` to your forum's folder (the one with \`composer.json\`), and run \`php flarum info\`.
  - **Docker**: \`docker compose exec <service> php flarum info\` (replace \`<service>\` with your Flarum container's name).
  - **Shared hosting / cPanel**: open the host's "Terminal" feature if it has one and run the command in your site's folder; if there's no terminal, look for a "run a command" or cron tool, or ask your host to run \`php flarum info\` for you.
  - **Managed Flarum host**: look for a "diagnostics", "info", or "console" feature in the dashboard, or ask their support.
- **No command line at all?** If your forum still loads in a browser, you may not need it: this MCP can read much of the same information (Flarum version, installed and enabled extensions and their versions, mail and queue drivers) straight from your forum's API. Ask your AI to "gather my forum's system info for a support request", or run the \`prepare-flarum-support-request\` prompt.
- **Redact before sharing** (see \`report\`): the info output is usually safe, but never post your database password, API keys, or anything that looks like a secret token.`,
  },
  logs: {
    title: "Finding the error and the logs",
    body: `The real cause is almost always in a log or in the browser, not on the generic "Oops!" page.
- **Flarum's log file** is at \`storage/logs/flarum.log\` in your forum folder, and the **last** entries are the relevant ones. With SSH: \`tail -n 100 storage/logs/flarum.log\`. No SSH? Download the file with your host's File Manager or an FTP client and read the bottom of it.
- **Turn on debug mode** to see the full error instead of "Oops!": edit \`config.php\` in your forum folder, set \`'debug' => true,\`, reload the page, copy the error, then **set it back to \`false\`** (leaving debug on in public is a security risk).
- **White screen, or buttons that do nothing?** That is usually a front-end error. Open your browser's developer tools (press F12), check the **Console** tab for red errors and the **Network** tab for any request that failed (status 500/403), and copy the text.
- **Nothing in Flarum's log?** The error may be in your **web server / PHP log** (for example \`error_log\`, or your host's "Error Log" panel in the control panel).
- Copy the **exact error text and the first few lines of the stack trace**. That, plus what you did right before it happened, is what makes a problem solvable.`,
  },
  common: {
    title: "Common problems & first checks",
    body: `- **"Oops! Something went wrong" / HTTP 500 right after an update**: run \`php flarum migrate\` then \`php flarum cache:clear\`. If it persists, an extension may be incompatible with your new Flarum version (the log usually names it).
- **The whole site broke right after enabling an extension** (every page, even admin, is down): Flarum can't disable a fatally-broken extension for you, because the admin page is down too. Remove its id from the \`extensions_enabled\` list in the \`settings\` table of your database (or \`composer remove <vendor/package>\`), then \`php flarum cache:clear\`.
- **Broken styling, missing icons, or JavaScript not working**: \`php flarum assets:publish\`, then hard-refresh (Ctrl/Cmd+Shift+R).
- **Emails not sending** (sign-up confirmations, notifications): check the mail settings in admin; if you use a background queue, make sure its worker is actually running, or queued emails never send. Use the admin "send test mail" if available.
- **Can't log in, keep getting logged out, or "page expired" (419)**: usually a URL or cookie mismatch. Confirm the \`url\` in \`config.php\` exactly matches how you visit the site (http vs https, www vs not), then clear the cache.
- **File uploads fail**: check folder permissions on \`storage/\` and \`assets/\`, and your PHP \`upload_max_filesize\` / \`post_max_size\` limits.
When in doubt, gather the details (\`info\` + \`logs\`) and ask (\`report\`) rather than guessing.`,
  },
  report: {
    title: "Writing a support request people can help with",
    body: `A good report gets answered fast; "it's broken, help" usually doesn't. Include all of this:
- **What's wrong**, in a sentence or two, and **what you were doing** when it happened.
- **The exact error text** (from the page in debug mode, the log, or the browser console), including the first lines of the stack trace. Paste it as text in a code block, not as a screenshot of a wall of text.
- **What changed recently**: updated Flarum, installed/updated/enabled an extension, changed a setting, moved hosts.
- **Your \`php flarum info\` output** (or what the MCP gathered): Flarum version, PHP version, extensions with versions, and your drivers.
- **What you have already tried** (for example the \`first-aid\` steps).
- **Redact secrets first**: never post your database password, API keys, session cookies, or full admin links containing tokens. Remove or replace any "key"/"secret"/"token"/password value with \`***\`, including the database block in \`config.php\`.
- **Where to post:**
  - General Flarum problems: the official community at **discuss.flarum.org** (use its Support area), and search there first in case someone has already hit it.
  - A problem with **one specific extension**: that extension's own issue tracker (its GitHub "Issues" page, linked from its community listing or its \`composer.json\` \`support\` section). Extension-specific bugs belong with that author, not the general forum.
  - Give a **minimal way to reproduce it** if you can ("on a fresh install, enable X, then do Y"). It is the single biggest thing that gets a bug fixed.
The \`prepare-flarum-support-request\` prompt assembles all of this for you, auto-filling what it can read from your forum and redacting secrets.`,
  },
};

const TOPIC_KEYS = Object.keys(SECTIONS) as [string, ...string[]];

function render(topic?: string): string {
  if (topic && topic !== "all") {
    const s = SECTIONS[topic];
    if (s) return `# ${TITLE}\n\n## ${s.title}\n\n${s.body}\n`;
  }
  const all = Object.values(SECTIONS)
    .map((s) => `## ${s.title}\n\n${s.body}`)
    .join("\n\n");
  return `# ${TITLE}\n\n${INTRO}\n\n${all}\n`;
}

/** Register the static troubleshooting/support-request guide. Needs no forum/API key. */
export function registerTroubleshootTool(server: McpServer): void {
  server.registerTool(
    "flarum_troubleshoot",
    {
      title: "Flarum troubleshooting & support-request guide",
      description:
        "A plain-language guide for forum ADMINS and non-developers to diagnose a broken or misbehaving " +
        "Flarum forum and prepare a request for help (distinct from flarum_dev, which is for building " +
        "extensions). Covers safe first-aid fixes, how to run `php flarum info` and find logs on their " +
        "hosting, what common errors mean, and how to write a redacted support request and where to post " +
        "it. Use it whenever a user describes a forum problem or asks how to get help, and pair it with the " +
        "`prepare-flarum-support-request` prompt to assemble a report from a forum that still loads. " +
        "Omit `topic` for the full guide, or pass one to narrow it.",
      inputSchema: {
        topic: z
          .enum([...TOPIC_KEYS, "all"])
          .optional()
          .describe(
            "Section to return: first-aid, info, logs, common, report (or 'all' / omit for the full guide).",
          ),
      },
    },
    async ({ topic }) => ({
      content: [{ type: "text" as const, text: render(topic) }],
    }),
  );
}
