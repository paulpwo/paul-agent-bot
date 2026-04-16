# Git Workflow

## Commit format

```
<type>(<scope>): <description>
```

Types: `feat` `fix` `refactor` `docs` `chore` `test` `style`

- Imperative mood: "add feature" not "added feature"
- Subject line under 72 chars
- Reference issues when relevant: `fix(auth): correct token expiry (#42)`

## Branch naming

- `feat/<short-description>`
- `fix/<short-description>`
- `chore/<short-description>`

## Rules

- Never force-push to main/master.
- Never commit secrets, .env files, or credentials.
- Stage specific files — don't `git add .` blindly.
- Run tests before committing if a test suite exists.
