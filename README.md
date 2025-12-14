# Winterflows: Next-gen Slack workflows

Winterflows is a (WIP) full replacement to Slack workflows, as [the winter of workflows approaches](https://hackclub.slack.com/archives/C01D7AHKMPF/p1763781823485519) on the Hack Club Slack. It's designed to be relatively easy to create workflows and use them.

## Features

- Separate app for each workflow!
- Custom URL unfurls (aka embeds) for workflow links (`https://winterflows.davidwhy.me/workflow/{id}`)
- An intuitive GUI for designing workflows
- Support for ~~all~~ many workflow steps (still WIP!)
- Conditional steps

## Demo

You can use the `/winterflows` command to try out the bot yourself, or watch [the demo video](https://hc-cdn.hel1.your-objectstorage.com/s/v3/7942502507f18a68b3c0ef09bde7d26502534198_winterflows.mp4) to see the main features!

## Tech stack

Winterflows is made using Bun and the Slack web API SDK. I didn't use Bolt because I needed all the workflow apps to share the same endpoints, which Bolt couldn't do.
