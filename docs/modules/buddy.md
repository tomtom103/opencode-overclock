# The ASCII Buddy Companion (`buddy`)

The `buddy` module adds an interactive ASCII creature perched beside your terminal prompt. Purely cosmetic, the buddy reacts dynamically to what your coding session is doing.

---

## Anatomy of the Companion

Upon installation, a unique companion hatches with a randomized species, rarity, and name, persisted in OpenCode's TUI key-value store (`buddy.companion`):

- **Species:** Cat, Owl, Dragon, Fox, Dog, Frog, Duck, and more.
- **Rarity:** `common`, `uncommon`, `rare`, and `legendary`. The creature's color adapts to match the active OpenCode theme based on rarity.
- **State Persistence:** Stored in `.opencode/` key-value storage so your companion remains consistent across sessions.

---

## Layout & Responsive Positioning

- **Slot Placement:** Mounted into OpenCode's `home_prompt_right` and `session_prompt_right` UI slots.
- **Absolute Out-of-Flow Rendering:** Rather than expanding the single-line prompt row, the buddy is positioned with `position: "absolute", bottom: 0, right: 0`. Its multi-line sprite grows upward over unused empty input space, preserving tight, clean statusline rows.
- **Responsive Width Hiding:** If your terminal window shrinks below 100 columns (`MIN_COLS`), the buddy automatically hides itself to avoid cramping prompt inputs or overlapping text.

---

## Reactive Behaviors & Animations

Driven by a 500ms ticker, the buddy responds to live session events:

- **Turn Complete (`done`):** Emits a happy speech bubble when the assistant finishes a response.
- **Error (`error`):** Switches to an alarmed or shocked face when a turn fails.
- **Needs Approval (`permission`):** Nudges you when an agent requests tool authorization.
- **User Question (`question`):** Alerts you when the agent is waiting for your response.
- **Sleep (`sleep`):** After 2 minutes of inactivity, the creature closes its eyes and dozes off.
- **Petting (`pet`):** Reacts with affectionate animations when petted via slash command.

---

## Slash Commands

| Command                | Aliases         | Description                                                                                |
| :--------------------- | :-------------- | :----------------------------------------------------------------------------------------- |
| **`/oc-buddy`**        | `/buddy`        | Pets your companion, triggers a reaction animation, and toasts its current stats.          |
| **`/oc-buddy-switch`** | `/buddy-switch` | Opens an interactive dialog to choose a specific species or hatch a brand new random roll. |
| **`/oc-buddy-cycle`**  | `/buddy-cycle`  | Cycles instantly to the next species in rotation without opening a dialog.                 |

---

## Graceful Degradation

The buddy requires `@opentui/solid >= 0.4.5`, which OpenCode began bundling in release `1.18.4`.

If running on an older OpenCode version or in a headless terminal without Solid JSX support, the buddy quietly sits out. Desktop notifications, audio chimes, and slash commands (`/oc-tasks`, `/oc-usage`) continue functioning without error.

---

## Configuration

Disable the buddy in `tui.json`:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "buddy": false,
      },
    ],
  ],
}
```

Or in `opencode.json`:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "buddy": false,
      },
    ],
  ],
}
```
