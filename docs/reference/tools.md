# Tools API Reference

Overclock adds 10 specialized tools to OpenCode. This reference details parameter schemas, defaults, return formats, and error behaviors for each tool.

---

## 1. Background Tasks

### `task_run`

Spawns a shell command in the background. Does not block the conversation turn. Exit code and log tail inject automatically upon completion.

#### Arguments

| Argument      | Type     | Required | Default     | Description                                   |
| :------------ | :------- | :------- | :---------- | :-------------------------------------------- |
| `command`     | `string` | **Yes**  | —           | Shell command to execute.                     |
| `description` | `string` | **Yes**  | —           | Short human-readable label.                   |
| `cwd`         | `string` | No       | Project dir | Working directory for the process.            |
| `timeout`     | `number` | No       | `undefined` | Execution timeout in seconds until auto-kill. |

#### Return Value

```text
started t1-a1b2c3 [running] Short description (log: .opencode/overclock/tasks/t1-a1b2c3.log)
```

#### Rejection Conditions

- Commands requiring interactive input (`vim`, `nano`, `git rebase -i`, bare `python` REPL) are rejected immediately.

---

### `task_status`

Queries the status of running or completed tasks.

#### Arguments

| Argument | Type     | Required | Default     | Description                                               |
| :------- | :------- | :------- | :---------- | :-------------------------------------------------------- |
| `id`     | `string` | No       | `undefined` | Task ID to query. If omitted, returns all retained tasks. |

#### Return Value

```text
t1-a1b2c3 [running] Cargo build watcher
t2-d4e5f6 [exited 0] Database migration
```

---

### `task_output`

Reads the trailing log lines of a task.

#### Arguments

| Argument | Type     | Required | Default | Description                       |
| :------- | :------- | :------- | :------ | :-------------------------------- |
| `id`     | `string` | **Yes**  | —       | Target task ID.                   |
| `tail`   | `number` | No       | `50`    | Number of trailing lines to read. |

#### Return Value

String containing the last `N` lines of stdout and stderr combined. Reads are capped at 512 KB to prevent memory blowups.

---

### `task_kill`

Terminates a running task.

#### Arguments

| Argument | Type     | Required | Default | Description                  |
| :------- | :------- | :------- | :------ | :--------------------------- |
| `id`     | `string` | **Yes**  | —       | Target task ID to terminate. |

#### Return Value

```text
killed t1-a1b2c3
```

Sends `SIGTERM`, escalating to `SIGKILL` after 3 seconds.

---

## 2. Cron & Interval Scheduling

### `schedule_create`

Registers a recurring prompt on an interval or cron expression.

#### Arguments

| Argument | Type                         | Required | Default     | Description                                                                                     |
| :------- | :--------------------------- | :------- | :---------- | :---------------------------------------------------------------------------------------------- |
| `spec`   | `string`                     | **Yes**  | —           | Interval string (`"30s"`, `"5m"`, `"2h"`, `"1d"`) or 5/6-token cron expression (`"0 9 * * *"`). |
| `prompt` | `string`                     | **Yes**  | —           | Prompt text to execute.                                                                         |
| `target` | `"current" \| "new-session"` | No       | `"current"` | Target execution mode.                                                                          |

#### Return Value

```text
Schedule registered: s-0b9699 (runs every 5m)
```

#### Invariants

- Minimum interval is 5 seconds.
- Workspace capped at 50 active schedules.

---

### `schedule_list`

Lists all active schedules in the workspace.

#### Arguments

None.

#### Return Value

Formatted list of schedule IDs, specs, targets, and next run timestamps.

---

### `schedule_delete`

Cancels and removes a recurring schedule.

#### Arguments

| Argument | Type     | Required | Default | Description                           |
| :------- | :------- | :------- | :------ | :------------------------------------ |
| `id`     | `string` | **Yes**  | —       | Target schedule ID (e.g. `s-0b9699`). |

#### Return Value

```text
Schedule s-0b9699 deleted.
```

---

## 3. Browser Automation & Web Research

### `webfetch`

Upgraded SPA-aware web documentation fetcher with Readability distillation.

#### Arguments

| Argument  | Type                                  | Required | Default     | Description                                                                                           |
| :-------- | :------------------------------------ | :------- | :---------- | :---------------------------------------------------------------------------------------------------- |
| `url`     | `string`                              | **Yes**  | —           | HTTP or HTTPS URL to fetch.                                                                           |
| `mode`    | `"distill" \| "outline" \| "section"` | No       | `"distill"` | Distill returns full clean markdown; outline returns H1-H3 headers; section extracts specific anchor. |
| `section` | `string`                              | No       | `undefined` | Target anchor or selector when `mode: "section"` (e.g. `"#getting-started"`).                         |
| `timeout` | `number`                              | No       | `15`        | Navigation timeout in seconds.                                                                        |

---

### `browser`

Interactive headless browser automation tool supporting 16 distinct actions.

#### Arguments

| Argument   | Type               | Required    | Default        | Description                                                                                                                                                                           |
| :--------- | :----------------- | :---------- | :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `action`   | `string` (enum)    | **Yes**     | —              | Action to perform: `navigate`, `click`, `fill`, `select`, `screenshot`, `evaluate`, `console`, `close`, `snapshot`, `back`, `reload`, `scroll`, `press`, `wait`, `tabs`, `switchTab`. |
| `url`      | `string`           | Conditional | —              | Target URL (required for `navigate`).                                                                                                                                                 |
| `selector` | `string`           | Optional    | —              | CSS, role, or text selector.                                                                                                                                                          |
| `ref`      | `number`           | Optional    | —              | 1-based element reference number from visual snapshot.                                                                                                                                |
| `value`    | `string \| number` | Optional    | —              | Text to fill, option to select, key to press, or timeout for wait.                                                                                                                    |
| `script`   | `string`           | Conditional | —              | JavaScript code string (required for `evaluate`).                                                                                                                                     |
| `fullPage` | `boolean`          | No          | `false`        | Capture full scrollable page on `screenshot`.                                                                                                                                         |
| `name`     | `string`           | No          | `"screenshot"` | Custom label/slug for screenshot filename.                                                                                                                                            |

#### Return Value

Formatted text response with updated DOM element references (`[1]`, `[2]`), plus automatic `[ActionTrace Diagnostics]` if browser console errors or exceptions occurred.

---

### `crawl`

Concurrent BFS documentation crawler.

#### Arguments

| Argument       | Type                | Required | Default     | Description                                                          |
| :------------- | :------------------ | :------- | :---------- | :------------------------------------------------------------------- |
| `url`          | `string`            | **Yes**  | —           | Starting URL or sitemap.xml.                                         |
| `maxPages`     | `number`            | No       | `10`        | Maximum pages to crawl (max: 30).                                    |
| `maxDepth`     | `number`            | No       | `2`         | Maximum BFS hop depth.                                               |
| `includePaths` | `string[]`          | No       | `undefined` | Path prefixes to include (e.g. `["/docs/"]`).                        |
| `excludePaths` | `string[]`          | No       | `undefined` | Path prefixes to exclude.                                            |
| `format`       | `"map" \| "digest"` | No       | `"map"`     | `"map"` returns site tree; `"digest"` returns concatenated Markdown. |
| `sitemapOnly`  | `boolean`           | No       | `false`     | Only discover links via sitemap.xml.                                 |
