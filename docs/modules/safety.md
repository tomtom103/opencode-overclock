# Destructive Git Safety (`safety`)

Autonomous models frequently attempt to resolve Git conflicts, uncommitted changes, or dirty working trees using blunt, destructive commands. A single `git reset --hard` or `git clean -f` can permanently delete hours of uncommitted work.

The `safety` module intercepts `bash` tool calls before execution and blocks destructive Git operations, preventing irreversible data loss.

---

## Blocked Git Operations

Overclock matches Git commands across variations including flags, subcommands, and flags with custom Git directory paths (e.g. `git -C dir reset --hard`).

| Blocked Action             | Pattern Matched                                    | Why It Is Blocked                                           |
| :------------------------- | :------------------------------------------------- | :---------------------------------------------------------- |
| **`force-push`**           | `git push --force`, `-f`, `+<ref>`                 | Overwrites shared history on remote repositories.           |
| **`hard-reset`**           | `git reset --hard`                                 | Permanently deletes uncommitted working tree changes.       |
| **`force-clean`**          | `git clean -f`, `-df`, `--force`                   | Irreversibly deletes untracked files and directories.       |
| **`branch-force-delete`**  | `git branch -D`, `-d -f`                           | Bypasses unmerged commit safeguards when deleting branches. |
| **`remote-branch-delete`** | `git push --delete`, `-d`, `:<ref>`                | Destroys remote branch references.                          |
| **`discard-all-worktree`** | `git restore .`, `git checkout .`, `git restore *` | Discards all current modifications in the working tree.     |
| **`stash-destroy`**        | `git stash drop`, `git stash clear`                | Permanently destroys stashed work.                          |
| **`rebase-skip`**          | `git rebase --skip`                                | Drops conflicting commits completely during a rebase.       |

---

## Safe Rewrite Mechanism

When a dangerous command is detected in `tool.execute.before`, Overclock does **not** throw an uncaught exception (which would crash OpenCode's execution fiber).

Instead, Overclock safely rewrites the command using POSIX-safe quoting into a clean error exit:

```bash
printf '%s\n' '[overclock safety] Blocked destructive git command (hard-reset)...' >&2 && exit 1
```

### Result:

1. The command fails cleanly with exit code 1.
2. The agent receives an actionable stderr message explaining why the command was blocked and suggesting safe alternatives (such as `git stash push`, `git revert`, or selective file restoration).
3. The conversation turn remains completely stable and uncorrupted.
4. A warning toast is sent to the user interface.

---

## Configuration & Exceptions

You can permit specific operations (such as force-pushing on dedicated feature branches) or add custom safety patterns:

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "safety": {
          "blockDestructiveGit": true,
          "allowForcePush": false, // Set true to allow force-push
          "allowStashDrop": false, // Set true to allow stash drop/clear
          "customPatterns": [
            {
              "name": "no-rm-rf-root",
              "pattern": "rm\\s+-rf\\s+/(?:$|\\s)",
              "reason": "Root filesystem deletion is strictly forbidden.",
            },
            {
              "name": "no-drop-database",
              "pattern": "DROP\\s+DATABASE",
              "reason": "Dropping databases is forbidden in automated sessions.",
            },
          ],
        },
      },
    ],
  ],
}
```
