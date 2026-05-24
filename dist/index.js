const fs = require("fs");

function input(name, defaultValue = "") {
  const rawNames = [
    `INPUT_${name.toUpperCase()}`,
    `INPUT_${name.toUpperCase().replace(/-/g, "_")}`,
  ];
  for (const key of rawNames) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      return String(process.env[key]).trim();
    }
  }
  return defaultValue;
}

function boolInput(name, defaultValue = false) {
  const value = input(name, String(defaultValue)).toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(value);
}

function setOutput(name, value) {
  const text = value == null ? "" : String(value);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${text.replace(/\n/g, "%0A")}\n`);
  } else {
    console.log(`::set-output name=${name}::${text}`);
  }
}

function mask(value) {
  if (value) console.log(`::add-mask::${value}`);
}

function parseAmount(raw) {
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`amount must be a positive number, got ${raw}`);
  }
  return amount;
}

function normalizeUrl(base, endpoint) {
  const cleanBase = String(base || "").replace(/\/+$/, "");
  const cleanEndpoint = String(endpoint || "").startsWith("/")
    ? String(endpoint)
    : `/${endpoint}`;
  return `${cleanBase}${cleanEndpoint}`;
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return {};
  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}

function extractWallet(text) {
  if (!text) return "";
  const labelled = [
    /(?:rtc\s*wallet|wallet|wallet-to|wallet_to|rtc-wallet)\s*[:=]\s*`?([A-Za-z0-9_.:-]{3,128})`?/i,
    /(?:payout|payment)\s*(?:wallet|address|to)?\s*[:=]\s*`?([A-Za-z0-9_.:-]{3,128})`?/i,
  ];
  for (const pattern of labelled) {
    const match = String(text).match(pattern);
    if (match) return trimWallet(match[1]);
  }
  const standaloneRtc = String(text).match(/\b(RTC[A-Za-z0-9]{20,80})\b/);
  return standaloneRtc ? trimWallet(standaloneRtc[1]) : "";
}

function trimWallet(value) {
  return String(value || "").replace(/[),.;\]]+$/g, "").trim();
}

function readLocalWallet() {
  const file = ".rtc-wallet";
  if (!fs.existsSync(file)) return "";
  return trimWallet(fs.readFileSync(file, "utf8").split(/\r?\n/)[0]);
}

async function readHeadWallet(event, token) {
  const pr = event.pull_request;
  if (!token || !pr || !pr.head || !pr.head.repo) return "";
  const owner = pr.head.repo.owner && pr.head.repo.owner.login;
  const repo = pr.head.repo.name;
  const ref = pr.head.ref;
  if (!owner || !repo || !ref) return "";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/.rtc-wallet?ref=${encodeURIComponent(ref)}`;
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "rtc-reward-action",
    },
  });
  if (response.status === 404) return "";
  if (!response.ok) throw new Error(`failed to read head .rtc-wallet: ${response.status}`);
  const body = await response.json();
  if (!body.content) return "";
  return trimWallet(Buffer.from(body.content, "base64").toString("utf8").split(/\r?\n/)[0]);
}

async function resolveWallet(event, token, explicit, fallbackToAuthor) {
  if (explicit) return trimWallet(explicit);
  const pr = event.pull_request || {};
  const fromBody = extractWallet(pr.body || "");
  if (fromBody) return fromBody;
  const local = readLocalWallet();
  if (local) return local;
  const head = await readHeadWallet(event, token);
  if (head) return head;
  return fallbackToAuthor && pr.user && pr.user.login ? pr.user.login : "";
}

async function postComment(event, token, body) {
  const repo = process.env.GITHUB_REPOSITORY || "";
  const pr = event.pull_request || {};
  if (!token || !repo || !pr.number) return "";
  const response = await fetch(`https://api.github.com/repos/${repo}/issues/${pr.number}/comments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "rtc-reward-action",
    },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`failed to post PR comment: ${response.status} ${text.slice(0, 200)}`);
  }
  const json = await response.json();
  return json.html_url || "";
}

async function sendTransfer(url, adminKey, payload) {
  if (!adminKey) throw new Error("admin-key is required when dry-run is false");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-admin-key": adminKey,
      authorization: `Bearer ${adminKey}`,
      "user-agent": "rtc-reward-action",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`transfer failed: ${response.status} ${text.slice(0, 300)}`);
  }
  return json;
}

function successComment({ amount, walletTo, walletFrom, dryRun, transactionId }) {
  if (dryRun) {
    return [
      "## RTC Reward Dry Run",
      "",
      `Would award **${amount} RTC** to \`${walletTo}\` from \`${walletFrom}\`.`,
      "",
      "No transfer was sent because `dry-run` is enabled.",
    ].join("\n");
  }
  return [
    "## RTC Reward Sent",
    "",
    `Awarded **${amount} RTC** to \`${walletTo}\` from \`${walletFrom}\`.`,
    transactionId ? `\nTransaction: \`${transactionId}\`` : "",
  ].join("\n");
}

async function run() {
  const event = readEvent();
  const pr = event.pull_request;
  const merged = Boolean(pr && pr.merged);
  const dryRun = boolInput("dry-run", false);
  const shouldComment = boolInput("comment", true);
  const failOnError = boolInput("fail-on-error", false);
  const fallbackToAuthor = boolInput("fallback-to-author", false);
  const token = input("github-token", process.env.GITHUB_TOKEN || "");
  const adminKey = input("admin-key");
  const nodeUrl = input("node-url", "https://50.28.86.131");
  const endpoint = input("transfer-endpoint", "/api/transfer");
  const amount = parseAmount(input("amount", "5"));
  const walletFrom = input("wallet-from");
  const walletTo = await resolveWallet(event, token, input("wallet-to"), fallbackToAuthor);

  mask(adminKey);
  mask(token);
  setOutput("amount", amount);
  setOutput("wallet-to", walletTo);

  if (!pr) {
    setOutput("result", "skipped");
    console.log("No pull_request payload found; skipping.");
    return;
  }
  if (!merged) {
    setOutput("result", "skipped");
    console.log("Pull request was not merged; skipping.");
    return;
  }
  if (!walletFrom) throw new Error("wallet-from is required");
  if (!walletTo) {
    setOutput("result", "no-wallet");
    throw new Error("No destination wallet found in wallet-to, PR body, or .rtc-wallet");
  }

  const transferPayload = {
    from: walletFrom,
    to: walletTo,
    amount,
    repository: process.env.GITHUB_REPOSITORY,
    pull_request: pr.number,
    head_sha: pr.head && pr.head.sha,
  };

  try {
    let transactionId = "";
    if (dryRun) {
      setOutput("result", "dry-run");
    } else {
      const transfer = await sendTransfer(normalizeUrl(nodeUrl, endpoint), adminKey, transferPayload);
      transactionId =
        transfer.transaction_id ||
        transfer.transactionId ||
        transfer.txid ||
        transfer.tx_hash ||
        transfer.hash ||
        "";
      setOutput("transaction-id", transactionId);
      setOutput("result", "sent");
    }

    if (shouldComment) {
      const commentUrl = await postComment(
        event,
        token,
        successComment({ amount, walletTo, walletFrom, dryRun, transactionId })
      );
      setOutput("comment-url", commentUrl);
    }
  } catch (error) {
    setOutput("result", "failed");
    if (shouldComment && token) {
      const body = [
        "## RTC Reward Failed",
        "",
        `Could not award **${amount} RTC** to \`${walletTo}\`.`,
        "",
        `Reason: \`${String(error.message).slice(0, 240)}\``,
      ].join("\n");
      try {
        const commentUrl = await postComment(event, token, body);
        setOutput("comment-url", commentUrl);
      } catch (commentError) {
        console.warn(commentError.message);
      }
    }
    if (failOnError) throw error;
    console.warn(error.message);
  }
}

if (require.main === module) {
  run().catch((error) => {
    setOutput("result", "error");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  extractWallet,
  normalizeUrl,
  parseAmount,
  trimWallet,
  successComment,
};
