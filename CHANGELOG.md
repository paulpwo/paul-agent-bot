# Changelog

## [1.0.1](https://github.com/paulpwo/paul-agent-bot/compare/v1.0.0...v1.0.1) (2026-04-17)


### Bug Fixes

* recursive chown after prepareAgentHome so uid:1001 can write .claude/ session files ([2dc94d0](https://github.com/paulpwo/paul-agent-bot/commit/2dc94d0703c219fd75c85da1a44d973ba51e26fd))

## 1.0.0 (2026-04-17)


### Features

* separate notification bot token from channel bot token in settings ([9aa2579](https://github.com/paulpwo/paul-agent-bot/commit/9aa257924fb7f04d0d3d9b757e4c1f534d247dfc))
* show live tool calls in task stream + fix full-width layout ([0b3977b](https://github.com/paulpwo/paul-agent-bot/commit/0b3977bbf44678afbd21bbabb4baad7069e6e234))


### Bug Fixes

* add 15-minute task timeout to prevent infinite hanging tasks ([f052571](https://github.com/paulpwo/paul-agent-bot/commit/f052571314641911d5d9304f3342966f44ef65c6))
* add git safe.directory=* to allow uid 1001 to access root-owned workspaces ([84351f0](https://github.com/paulpwo/paul-agent-bot/commit/84351f05f60127558c490ddbc0f40992dd07461b))
* add git, gh CLI and claude to Docker runtime image ([c96dd81](https://github.com/paulpwo/paul-agent-bot/commit/c96dd81e8ee368fc4a60dcb35109f6c7d446ef59))
* always resolve default branch from ls-remote, auto-correct stale DB values ([5bdd7bf](https://github.com/paulpwo/paul-agent-bot/commit/5bdd7bf9af8d50b89c05634603a39bf23cc34052))
* **auth:** use CLAUDE_CODE_OAUTH_TOKEN, set HOME=/tmp for writable claude state ([efb102f](https://github.com/paulpwo/paul-agent-bot/commit/efb102fe4e11cee701853d160a1cfb733b0745f7))
* catch bot.start() errors to prevent worker crash on Telegram 409 ([ef275f9](https://github.com/paulpwo/paul-agent-bot/commit/ef275f933e1f6aa10378a52332fb5b5d0d5b2715))
* **chat:** prevent stream disconnect on first message ([7c9cc78](https://github.com/paulpwo/paul-agent-bot/commit/7c9cc78fa5e2911dbe91c23790880e42c44ae2ad))
* checkout default branch before git pull in ensureWorkspace ([773e5e7](https://github.com/paulpwo/paul-agent-bot/commit/773e5e70154185a1717796f7d97b20991b469dbb))
* chmod 755 /root in image so uid 1001 can access bind-mounted .claude ([584cb62](https://github.com/paulpwo/paul-agent-bot/commit/584cb6298a74d3a248e98409a04e1db867c276e1))
* correct env var to CLAUDE_CODE_ALLOW_ROOT_EXECUTION ([6748246](https://github.com/paulpwo/paul-agent-bot/commit/6748246d4340707b8ed8c22cbd9d82b04d71c40d))
* correct prisma reset script and update SETUP.md ([ad6f579](https://github.com/paulpwo/paul-agent-bot/commit/ad6f579e8f128b3ab957e36873efa872524f0b4e))
* drop worker to uid 1001 when spawning claude to bypass root restriction ([7b37e99](https://github.com/paulpwo/paul-agent-bot/commit/7b37e99b3044823a314edddad964995a43ea2e6c))
* keep git after install — purge git-man removes it on Debian bookworm ([c41bf0e](https://github.com/paulpwo/paul-agent-bot/commit/c41bf0eea3f1967e4e52c67cab83af420b6c966d))
* per-task agent HOME in Docker to avoid /tmp/.claude ownership conflicts ([b535829](https://github.com/paulpwo/paul-agent-bot/commit/b5358293cc3c05bc34594a219e0175070f6d243f))
* recover stuck RUNNING tasks on worker startup ([46faa74](https://github.com/paulpwo/paul-agent-bot/commit/46faa74d950d581dd55043573cc388b08b4c858f))
* remove auto-push to remote and enforce --repo flag in gh commands ([9368c5f](https://github.com/paulpwo/paul-agent-bot/commit/9368c5fecea038b66458a05b0f84075867b4ba00))
* resolve default branch before checkout + cleanup old docker images on deploy ([760268d](https://github.com/paulpwo/paul-agent-bot/commit/760268d893b1166a83d7593aa2b9563f09adbc20))
* set remote HEAD before resolving default branch ([787198e](https://github.com/paulpwo/paul-agent-bot/commit/787198e2c9cdcf5cad375425ac414d6bfe57f48e))
* use ls-remote --symref to reliably resolve default branch ([3841d48](https://github.com/paulpwo/paul-agent-bot/commit/3841d4866e0a8359bc6fc58897bb1a3e5784f8b4))
* use resolved default branch in finally cleanup instead of hardcoded main ([9fd5ed9](https://github.com/paulpwo/paul-agent-bot/commit/9fd5ed9a242724ca91f146b2964a0395c29063d9))
* **worker:** retry on stale claude session after container restart ([57f96d3](https://github.com/paulpwo/paul-agent-bot/commit/57f96d3aae899b196bcf511fc332b03a6ba7f000))


### Performance Improvements

* optimize Docker runtime image (-87MB) ([1883edf](https://github.com/paulpwo/paul-agent-bot/commit/1883edf40ae1947f033853199c7e1ef2c345e989))


### Reverts

* restore bot.start() — dedicated bot per service avoids 409 ([47184ce](https://github.com/paulpwo/paul-agent-bot/commit/47184cea02980f9e3cfc491bcdeced220bed6953))
