# CC <-> opencode hook map

Source of truth: `sst/opencode` `packages/plugin/src/index.ts` (docs page undersell — many hooks undocumented).

## Lifecycle

| CC hook             | opencode                                                                 | Fidelity                         |
| ------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| SessionStart        | `event: session.created` + inject on first `chat.message`                | emulated                         |
| UserPromptSubmit    | `chat.message` (mutate parts)                                            | full                             |
| PreToolUse          | `permission.ask` (allow/deny/ask) + `tool.execute.before` (rewrite args) | full, better                     |
| PostToolUse         | `tool.execute.after` (rewrite output/title/metadata)                     | better — CC only append feedback |
| Notification        | `event: permission.asked`, `tui.toast.show`                              | partial                          |
| Stop / SubagentStop | none. Emulate: `session.idle` -> check -> `client.session.prompt()`      | emulated, biggest gap            |
| PreCompact          | `experimental.session.compacting` (context + prompt)                     | full                             |
| SessionEnd          | `session.deleted` event, `dispose`                                       | partial                          |

Protocol diff: CC = shell cmd, JSON stdin/stdout, exit codes. opencode = in-process JS. CC hook scripts need translation shim (`cc-hooks` module).

## opencode behavior-modify hooks

| Hook                                   | Power                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `chat.message`                         | mutate user msg before model                                               |
| `chat.params`                          | temp/topP/topK/maxTokens/provider opts per req                             |
| `chat.headers`                         | HTTP headers per req                                                       |
| `permission.ask`                       | resolve allow/deny/ask                                                     |
| `tool.execute.before/after`            | rewrite args / rewrite output                                              |
| `tool.definition`                      | rewrite built-in tool desc/params                                          |
| `command.execute.before`               | intercept slash cmds                                                       |
| `shell.env`                            | env inject all agent shells                                                |
| `config`                               | mutate resolved config (inject agents/commands/MCP/instructions)           |
| `tool: {...}`                          | custom tools, Zod args, `ctx.ask()`, file attachments                      |
| `auth` / `provider`                    | custom auth, custom providers                                              |
| `experimental.chat.system.transform`   | rewrite system prompt                                                      |
| `experimental.chat.messages.transform` | rewrite full history                                                       |
| `experimental.session.compacting`      | compaction context/prompt                                                  |
| `experimental.compaction.autocontinue` | control auto-continue                                                      |
| `experimental.text.complete`           | post-process assistant text                                                |
| `event`                                | full bus: `session.*` `file.*` `message.*` `permission.*` todo lsp `tui.*` |

Plugin ctx: `client` (full SDK — spawn sessions, prompt, TUI control), `$` (Bun shell), `project`, `directory`, `worktree`, `serverUrl`.

## Customization points

| CC                         | opencode                       | Gap                |
| -------------------------- | ------------------------------ | ------------------ |
| CLAUDE.md + @imports       | AGENTS.md (CLAUDE.md fallback) | @import resolution |
| Skills                     | native skills                  | none               |
| Slash commands             | native commands                | format translation |
| Subagents                  | native agents                  | format translation |
| Plugin bundles/marketplace | npm plugins + `config` hook    | emulatable         |
| Permission rules + modes   | native permissions, plan agent | syntax translation |
| Output styles              | system.transform               | emulatable         |
| Statusline                 | none                           | skip               |
| Memory                     | none                           | backportable       |
| Checkpoints                | native undo/revert             | none               |
| Sandboxing                 | none                           | hard gap           |

opencode-only wins (exploit, no backport): params/headers hooks, history+system transforms, tool.definition rewrite, provider/auth hooks, JS custom tools, in-process SDK client.
