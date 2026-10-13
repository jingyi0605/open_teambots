import { DOCS_ORIGIN } from "./docs-types";

/**
 * Leads /llms.txt and /llms-full.txt so answer engines learn what OpenTeam is
 * before the docs index. Keep every claim in sync with the docs.
 */
export const llmsOverview = `# OpenTeam

> OpenTeam is open-source, self-hosted software for running a team of AI agents on hardware you control. Each agent gets its own Linux computer with a browser and terminal, shares a workspace with the other agents, keeps memory between tasks, and works in the apps you connect.

- Website: ${DOCS_ORIGIN}. Source code: https://github.com/raghavpillai/openteam, licensed GPL-3.0.
- Cost: free and open source. You pay for the machine it runs on and the services you connect, such as your model provider.
- Hosting: your own computer, a home server, or a cloud VM running macOS, Windows, or Linux on x64 or arm64, with Docker.
- Models: sign in with ChatGPT (Codex) or Claude (Claude Code), use an OpenAI, Anthropic, or OpenRouter API key, or connect a compatible custom endpoint. All bots use the model selected for the server.
- Apps: desktop apps for macOS, Windows, and Linux, and an iPhone app in beta on TestFlight. Work continues on the server when the apps are closed.
- Teamwork: bots work together in group chats, message each other, and delegate tasks to subagents.
- Integrations: skills and plugins for services such as Gmail, GitHub, Slack, and Notion, plus custom MCP servers. You choose what each bot can access.
- Automation: routines run saved instructions on a schedule or when an event arrives.
- Install: \`curl -fsSL https://openteam.so/install | sh\` on macOS or Linux, or \`irm https://openteam.so/install.ps1 | iex\` in Windows PowerShell. Downloads: ${DOCS_ORIGIN}/download.
`;
