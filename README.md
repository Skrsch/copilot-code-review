<p align="center">
  <img src="images/icon_compressed.png" width="104" alt="Github Copilot Code Reviewer icon" />
</p>

<h1 align="center">Github Copilot Code Reviewer</h1>

<p align="center">
  A modern review cockpit inside VS Code: faster feedback, cleaner navigation, and smarter context-aware analysis for real-world repositories.
</p>

## Why Use It

- Review directly inside a dedicated **Code Review** activity bar workspace.
- Switch between **General**, **Architectural**, **Styleguide**, and **Performance** review modes.
- Select the exact repository to review, including repositories in workspace subfolders.
- Run incremental re-reviews with persistent finding history and triage.
- Apply suggested fixes from findings and move quickly through comments with keyboard navigation.

## What Makes It Different

- **Purpose-built sidebar UI**: model, mode, repository, and review controls in one place.
- **No accidental quick-review runs**: pick refs first, then explicitly press **Start Review**.
- **Context-aware reviews**: supports `.github/instructions/*.md` and optional Copilot instruction files.
- **Finding lifecycle support**: triage as Open, Accepted, or Not an issue, and optionally hide triaged items.
- **Traceable review context**: summary includes model used plus resources/tools considered.

## Requirements

- VS Code `1.99+`
- Git repository in your workspace
- GitHub Copilot Chat extension (`github.copilot-chat`)

## Quick Start

1. Open the **Code Review** icon in the Activity Bar.
2. In **Review Setup**, choose:
   - review mode
   - chat model
   - repository
3. Start a review using one of these flows:
   - **Quick picks**: `Pick refs` / `Pick branches` / `Pick commit`, then click **Start Review**
   - **Branch comparison**: select base + target branch, then click **Review**
4. Open findings from the results list to jump straight to code.

## Review Modes

- `general`: broad bug/risk/quality review
- `architectural`: higher-level structure and design review
- `styleguide`: checks against style guidance and instruction files
- `performance`: runtime/memory/efficiency focused review

## Instructions and Styleguide Context

- Optional repository-wide instructions: `.github/instructions/*.md`
- Optional Copilot instruction files in styleguide mode:
  - `.github/copilot-instructions.md`
  - `copilot-instructions.md`
- Custom styleguide text via `codeReview.styleguide`

## Findings Workflow

- Sidebar finding triage: **Open**, **Accepted**, **Not an issue**
- Inline comment actions: **Apply Fix**, **Skip**, **Accept**, **Discard**
- Incremental baseline and triage persistence via `codeReview.baselineFilePath`

## Chat and Agent Workflows

### Chat participant commands

- `/review` compare refs (branches/tags/commits)
- `/branch` compare branches
- `/commit` review one commit

### Agent tools

- `#review`
- `#reviewStaged`
- `#reviewUnstaged`

## Useful Settings

```json
{
  "codeReview.repositoryPath": "",
  "codeReview.reviewMode": "general",
  "codeReview.chatModel": "gpt-4o",
  "codeReview.incrementalReReview": true,
  "codeReview.hideTriagedFindings": false,
  "codeReview.styleguide": "",
  "codeReview.styleguideUseCopilotInstructions": true,
  "codeReview.useGithubInstructions": true,
  "codeReview.baselineFilePath": ".codereview-baseline.json"
}
```

## Keyboard Shortcuts

- Next comment: `Ctrl+Shift+N` (`Cmd+Shift+N` on macOS)
- Previous comment: `Ctrl+Shift+B` (`Cmd+Shift+B` on macOS)

## Install from VSIX

```bash
code --install-extension github-copilot-code-reviewer-0.22.2.vsix
```

## Build Locally

```bash
pnpm install
pnpm test
pnpm build
```

## Data Usage

Files, diffs, and relevant review context are sent to the configured chat model to generate findings.

## License

See [LICENSE](./LICENSE).
