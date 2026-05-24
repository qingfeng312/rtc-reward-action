# RTC Reward Action

Award RustChain RTC when a pull request is merged.

This action is designed for open source projects that want a small, auditable bounty workflow without a custom backend. It reads the contributor's wallet from the PR body, a `.rtc-wallet` file, or an explicit input, supports dry runs, and can post a confirmation comment back to the merged PR.

## Usage

```yaml
name: RTC Rewards

on:
  pull_request:
    types: [closed]

jobs:
  reward:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
      pull-requests: read
    steps:
      - uses: actions/checkout@v4
      - uses: qingfeng312/rtc-reward-action@v1
        with:
          node-url: https://50.28.86.131
          amount: 5
          wallet-from: project-fund
          admin-key: ${{ secrets.RTC_ADMIN_KEY }}
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `node-url` | `https://50.28.86.131` | RustChain node base URL. |
| `transfer-endpoint` | `/api/transfer` | Transfer endpoint path. Override to `/wallet/transfer` if your node uses that route. |
| `amount` | `5` | RTC amount to award. |
| `wallet-from` | required | Project fund wallet. |
| `wallet-to` | optional | Explicit recipient wallet. |
| `admin-key` | optional | Secret used by the node for real transfers. Required unless `dry-run` is true. |
| `github-token` | `${{ github.token }}` | Token for reading `.rtc-wallet` and posting comments. |
| `dry-run` | `false` | Validate and comment without sending RTC. |
| `comment` | `true` | Post a success, dry-run, or failure comment on the PR. |
| `fail-on-error` | `false` | Fail the workflow if a real transfer fails. |
| `fallback-to-author` | `false` | Use the PR author's GitHub login if no wallet is found. |

## Wallet Detection

The recipient wallet is resolved in this order:

1. `wallet-to` input.
2. Labelled wallet in the PR body, such as `RTC Wallet: RTC...` or `Wallet: qingfeng312-codex`.
3. A local `.rtc-wallet` file in the checked-out repository.
4. A `.rtc-wallet` file in the PR head branch through the GitHub API.
5. The PR author's login, only when `fallback-to-author: true`.

## Dry Run

Use dry-run mode when installing the action for the first time:

```yaml
- uses: qingfeng312/rtc-reward-action@v1
  with:
    amount: 5
    wallet-from: project-fund
    dry-run: true
```

The action will resolve the wallet and post a comment saying what would have been awarded. No transfer request is sent.

## Outputs

| Output | Description |
| --- | --- |
| `result` | `sent`, `dry-run`, `skipped`, `no-wallet`, `failed`, or `error`. |
| `wallet-to` | Resolved recipient wallet. |
| `amount` | Award amount. |
| `transaction-id` | Transaction id/hash returned by the node, when available. |
| `comment-url` | PR comment URL, when created. |

## Security Notes

- `admin-key` and `github-token` are masked in logs.
- Non-merged PR events are skipped.
- Missing wallets fail closed unless `fallback-to-author` is explicitly enabled.
- `dry-run` does not send a transfer request.
- The action has no npm runtime dependencies.

## Local Validation

```bash
npm test
npm run lint
```
