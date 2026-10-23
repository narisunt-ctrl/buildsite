# Buildsite — a construction site for your AI coding agent

**Watch your AI coding agent work as a live 3D construction site.** Every prompt raises a building. Every tool call adds an element. Failed calls become red defects until a later call fixes them. Every project exports a printable **handover report**.

Local only · read only · no npm install · MIT

[ภาษาไทย](README.md)

![The site](docs/site.jpg)

## Reading the scene

| On site | In the agent session |
|---|---|
| A building | One prompt, from submit to final answer |
| An element | One tool call |
| Surveyor (blue hat) | Read, Grep, Glob, web search/fetch, MCP tools → survey stakes |
| Builder (orange hat) | Edit, Write, ordinary shell commands → concrete blocks, placed by the crane |
| QC engineer (green hat) | test / build / lint commands → inspection tags on the board |
| Subcontractor (purple hat) | Subagents → scaffolding bays |
| Pulsing yellow ghost | In progress |
| Red, cracked | Defect: the tool reported a failure |
| Yellow patch | Repaired: the same kind of call on the same target later succeeded |
| Roof and green flag | Handed over (turn finished) |
| Orange cones | Stopped early (interrupted, or a new prompt arrived) |

Finished buildings stay on site, so a session leaves a visible history. Drag to orbit, Shift-drag or right-drag to pan, scroll to zoom.

## Install

Requires Claude Code, Node.js 18.17+ and git.

```bash
claude plugin marketplace add narisunt-ctrl/buildsite
claude plugin install buildsite@buildsite
```

Start a **new** session, then open `http://127.0.0.1:4646/` or run `/buildsite:site`.

Preview without a real session: `cd server && npm run demo`.

## Customising trades

Copy `server/config/trades.json` to `~/.buildsite/trades.json` and edit labels, colours, verbs, or the regex that decides which shell commands count as QC.

## Privacy

Binds to 127.0.0.1, checks `Host` and `Origin`, accepts JSON only. The hook forwards event names, session id, folder, tool name and a trimmed path/command/query; never prompts, file contents, tool output or error text. Token counts come only from usage numbers in transcripts inside `~/.claude`. Set `BUILDSITE_OFF=1` to pause.

## License

MIT © 2026 Narisan Nakakes. Uses three.js (MIT). Inspired by [claude-code-3d](https://github.com/thekaroe-thailand/claude-code-3d); this is an independent implementation — see [NOTICE.md](NOTICE.md).
