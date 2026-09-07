# Quality Gates & Guard (`guard`)

The `guard` module establishes proactive automated verification loops. Whenever an agent modifies code using `edit` or `write`, the guard can automatically execute your project's linters, typecheckers, or test suites in the background.

If errors occur, the diagnostic trace is automatically fed back to the model once the turn goes idle, prompting it to self-correct before you even review the changes.

---

## 1. Automatic Stack Detection (`auto: true`)

The simplest way to use `guard` is setting `"auto": true` in `opencode.json`:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "guard": {
          "auto": true,
        },
      },
    ],
  ],
}
```

When `"auto": true` is enabled, Overclock inspects your workspace root on startup and automatically mounts the relevant recipes:

- `tsconfig.json` $\rightarrow$ mounts `tsc` (`bun x tsc --noEmit || npx tsc --noEmit` on `**/*.{ts,tsx}`)
- `Cargo.toml` $\rightarrow$ mounts `cargo` (`cargo check` on `**/*.rs`)
- `pyproject.toml` or `ruff.toml` $\rightarrow$ mounts `ruff` (`ruff check .` on `**/*.py`)
- `go.mod` $\rightarrow$ mounts `go` (`go test ./...` on `**/*.go`)
- Enables `floorGuard` anti-bypass protection automatically.

---

## 2. Built-in Stack Recipes (`recipes`)

You can also explicitly enable prebuilt stack recipes via the `recipes` array:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "guard": {
          "recipes": ["tsc", "eslint", "cargo", "ruff", "go"],
        },
      },
    ],
  ],
}
```

---

## 3. Custom Quality Gate Hooks (`hooks`)

Define custom verification commands tailored to your project or monorepo structure:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "guard": {
          "hooks": [
            {
              "name": "api-typecheck",
              "tools": ["edit", "write"],
              "pathFilter": "services/api/**/*.{ts,tsx}",
              "run": "npm --prefix services/api run typecheck",
              "mode": "inject",
              "debounceMs": 2000,
              "timeoutMs": 60000,
              "onSuccess": "silent",
            },
          ],
        },
      },
    ],
  ],
}
```

### Hook Configuration Schema

| Field        | Type                   | Default             | Description                                                                                                                                              |
| :----------- | :--------------------- | :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | `string`               | _(Required)_        | Label shown in error reports and success notifications.                                                                                                  |
| `tools`      | `string[]`             | `["edit", "write"]` | Tools that trigger this hook.                                                                                                                            |
| `run`        | `string`               | _(Required)_        | Shell command to execute.                                                                                                                                |
| `pathFilter` | `string`               | `undefined`         | Optional glob pattern restricting execution to matching files (e.g. `src/**/*.ts`).                                                                      |
| `mode`       | `"inject" \| "append"` | `"inject"`          | `"inject"` debounces and waits for the session to become idle before injecting errors. `"append"` runs synchronously and appends results to tool output. |
| `debounceMs` | `number`               | `2000`              | Trailing debounce delay in milliseconds for rapid edits.                                                                                                 |
| `timeoutMs`  | `number`               | `60000`             | Execution timeout before terminating the process.                                                                                                        |
| `maxDeferMs` | `number`               | `300000`            | In `"inject"` mode, maximum time to defer if the session remains busy before forcing injection.                                                          |
| `onSuccess`  | `"silent" \| "notify"` | `"silent"`          | `"notify"` displays a toast notification when the check passes clean.                                                                                    |

### Environment Variables Passed to Hook Commands

Every hook receives contextual environment variables:

- `$GUARD_TOOL`: The tool that triggered the hook (`edit` or `write`).
- `$GUARD_FILE`: The relative or absolute path of the modified file.

---

## 4. Anti-Bypass Quality Gate (`floorGuard`)

Autonomous models frequently attempt to make failing tests "pass" by taking unrequested shortcuts: skipping tests, silencing linter errors, or deleting assertions.

`floorGuard` intercepts `edit` and `write` tool calls and issues immediate blocking warnings if anti-patterns are detected:

### Blocked Anti-Patterns

1. **Test Skipping:**
   - JS/TS: `.skip()`, `test.skip`, `it.skip`, `describe.skip`, `xit()`, `xdescribe()`
   - Python: `@pytest.mark.skip`, `@unittest.skip`
   - Go: `t.Skip`
   - Rust: `#[ignore]`
2. **Diagnostic Suppressions:**
   - TypeScript: `@ts-ignore`, `@ts-nocheck`
   - ESLint: `eslint-disable`
   - Python: `#` `noqa`, `#` `type: ignore`
   - General: Empty `catch {}` blocks swallowing errors silently.
3. **Assertion Removal:**
   - Deleting `expect(...)`, `assert`, or `assertEquals` from test files without replacement.

### Granular Configuration & Escape Hatches

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "guard": {
          "floorGuard": {
            "allowSkips": false, // Set true to allow test skips
            "allowSuppressions": false, // Set true to allow lint/type suppressions
            "allowAssertionRemoval": false, // Set true to allow deleting assertions
          },
        },
      },
    ],
  ],
}
```

---

## 5. Edit Recovery Hints (`editRecovery`)

When enabled (default: `true`), if the model fails an `edit` tool call because `oldString` was not found or had multiple matches, Overclock automatically appends an actionable recovery hint:

```text
[edit recovery hint]
The edit failed due to a content mismatch. Use the `read` tool to inspect the latest file state around the target lines before retrying the edit.
```

This prevents the model from hallucinating or retrying the exact same broken string replacement in an infinite loop.

---

## 6. Hook Command Safety Verification

To protect against misconfiguration or malicious prompt injections that attempt to exploit hook commands, Overclock inspects all hook `run` commands at startup. Commands containing dangerous idioms are rejected before execution:

- Network socket redirection: `/dev/tcp`, `/dev/udp`
- Named pipes: `mkfifo`
- Netcat shells: `nc -e`, `nc -c`
- Remote execution pipes: `curl ... | bash`, `wget ... | sh`
- Base64 decode pipes: `base64 -d | sh`
- Interactive reverse shells: `bash -i >&`
- Socket relays: `socat`
