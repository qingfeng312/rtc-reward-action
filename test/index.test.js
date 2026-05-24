const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractWallet,
  normalizeUrl,
  parseAmount,
  successComment,
} = require("../dist/index");

test("extracts labelled RTC wallet values", () => {
  assert.equal(extractWallet("RTC Wallet: RTC7be68f41360f8edc9013fd6cb997b6b07a45e57a"), "RTC7be68f41360f8edc9013fd6cb997b6b07a45e57a");
  assert.equal(extractWallet("Wallet: qingfeng312-codex"), "qingfeng312-codex");
});

test("extracts standalone RTC addresses", () => {
  assert.equal(extractWallet("please pay RTC1234567890abcdef1234567890abcdef12345678 thanks"), "RTC1234567890abcdef1234567890abcdef12345678");
});

test("normalizes transfer URLs", () => {
  assert.equal(normalizeUrl("https://50.28.86.131/", "api/transfer"), "https://50.28.86.131/api/transfer");
  assert.equal(normalizeUrl("https://rustchain.org", "/wallet/transfer"), "https://rustchain.org/wallet/transfer");
});

test("validates positive amounts", () => {
  assert.equal(parseAmount("5"), 5);
  assert.throws(() => parseAmount("0"), /positive/);
  assert.throws(() => parseAmount("nope"), /positive/);
});

test("renders dry-run comments without claiming transfer", () => {
  const comment = successComment({
    amount: 5,
    walletTo: "alice",
    walletFrom: "project-fund",
    dryRun: true,
  });
  assert.match(comment, /Dry Run/);
  assert.match(comment, /No transfer was sent/);
});
