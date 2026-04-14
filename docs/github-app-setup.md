# GitHub App Setup

## 1. Register the GitHub App

Go to: https://github.com/settings/apps/new

Settings:
- **GitHub App name**: paulagentbot (or your preferred name)
- **Homepage URL**: https://your-domain.com
- **Webhook URL**: https://your-domain.com/api/webhooks/github
- **Webhook secret**: generate with `openssl rand -hex 32` → save as `GITHUB_APP_WEBHOOK_SECRET`

### Permissions (Repository)
- Contents: Read & Write
- Issues: Read & Write
- Pull requests: Read & Write
- Metadata: Read-only

### Subscribe to events
- Issue comment
- Issues
- Pull request
- Pull request review comment

## 2. After creating the app

1. Note the **App ID** → save as `GITHUB_APP_ID`
2. Generate a **private key** → download `.pem` file → save contents as `GITHUB_APP_PRIVATE_KEY`
3. Note the **bot username** (shown on the app page as "Username") → save as `GITHUB_APP_BOT_USERNAME` (e.g. `paulagentbot[bot]`)

## 3. Install the app on your repos

Go to: https://github.com/settings/installations

Click "Install" on your app → select repos → confirm.

## 4. Sync repos in PaulAgentBot

Once the app is installed:
1. Log in to the dashboard
2. Go to Repos → click "Sync from GitHub"
3. Enable the repos you want PaulAgentBot to work on

## 5. Test the integration

In any enabled repo, create an issue and comment:

```
@paulagentbot add a README.md with a brief description of this project
```

PaulAgentBot should:
1. Reply "🤖 Taking the task..."
2. Clone the repo, create branch `paulagentbot/<issue-number>`
3. Make the change and push
4. Comment with the result
