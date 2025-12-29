# Winterflows: Next-gen Slack workflows

Winterflows is a (WIP) full replacement to Slack workflows, as [the winter of workflows approaches](https://hackclub.slack.com/archives/C01D7AHKMPF/p1763781823485519) on the Hack Club Slack. It's designed to be relatively easy to create workflows and use them.

## Features

- Separate app for each workflow!
- Custom URL unfurls (aka embeds) for workflow links (`https://winterflows.davidwhy.me/workflow/{id}`)
- An intuitive GUI for designing workflows
- Support for ~~all~~ many workflow steps (still WIP!)
- Conditional steps

## Demo

You can use the `/winterflows` command to try out the bot yourself, or watch [the demo video](https://hc-cdn.hel1.your-objectstorage.com/s/v3/8d8e49fb46eaa62c_flowdemo.mp4) to see the main features!

## Setup instructions

1. Create a Slack app on [the Slack portal](https://api.slack.com/apps). You should use the manifest found in [manifest.json](./manifest.json), but make sure you change the app name, bot name, and slash command names. Don't worry about the domain yet.
2. Copy `.env.example` as `.env` and fill out the first three lines.
3. Create a Postgres database called `winterflows`.
4. Run `psql winterflows -f sql/init.sql`.
5. On your Slack account (or an alt), go to [the Slack portal](https://api.slack.com/apps) again, scroll to the bottom, and generate an App Configuration Token. Copy the REFRESH token.
6. Run `bun scripts/add_config_token.ts`. This will prompt you for your refresh token.
7. Tunnel `localhost:45867` (or whatever your port is) to the Internet under an HTTPS domain (I use a Cloudflare Tunnel).
8. Update your Slack app to use your new domain, and set `EXTERNAL_URL` in `.env` to the appropriate value.
9. Run `bun dev` to start the development server, which restarts on a file change.

## Tech stack

Winterflows is made using Bun and the Slack web API SDK. I didn't use Bolt because I needed all the workflow apps to share the same endpoints, which Bolt couldn't do.
