# 当前部署：GitHub 网址 + GitHub 登录

前端：https://zhenghaohong.github.io/life-notebook/

后台：https://life-notebook-api.zhengteshuai.workers.dev

登录应用：Life Notebook · 日常。回调 URL 为后台 `/callback`，只允许 `zhenghaohong` 登录，不请求仓库 scope。

这个方案替代 README 中「同一自定义域名 + Cloudflare Access」的原方案，无需自定义域名或激活 Zero Trust 计费计划。

## Worker 环境变量

AUTH_MODE=github，FRONTEND_ORIGIN=https://zhenghaohong.github.io，ALLOWED_GITHUB_LOGIN=zhenghaohong，GITHUB_OWNER=zhenghaohong，GITHUB_REPO=life-private-data，GITHUB_BRANCH=main。GITHUB_OAUTH_CLIENT_ID 是公开应用 ID。

以下值只放入 Cloudflare Worker 的 **Secret** 类型：

- GITHUB_OAUTH_SECRET：GitHub OAuth 应用的 client secret。用来在后台兑换登录身份，并签发应用短期会话。
- GITHUB_TOKEN：仅授权 `life-private-data`、Contents Read and write 的 fine-grained PAT。不需要 Actions、Administration、其他仓库或账户权限。

前端 config.js 的 apiBase 为后台地址。正式接入并验证后台后再将 demo 改为 false。

## 登录与隐私

用户点击 GitHub 登录时打开独立窗口。Worker 使用有签名的 10 分钟状态 Cookie 防止登录 CSRF，验证回调后查询 GitHub 身份，检查唯一允许账号，再通过 postMessage 向固定前端 origin 返回 30 分钟会话。前端同时验证窗口来源、origin 和随机 state。

私有仓库 PAT、OAuth client secret、GitHub OAuth access token 都不会发送到前端。前端短期会话只存在内存，不保存到浏览器存储或 URL。刷新页面需再次登录，GitHub 已登录时通常可快速完成。API 请求不用跨站 Cookie，适用于 Safari 的第三方 Cookie 限制。退出应用只清除当前网页会话，不退出整个 GitHub 账号；会话自然过期或更换服务端密钥失效。

若浏览器阻止弹出窗口或身份提供商切断 opener，页面会提示重新发起登录；真实 iPhone Safari 仍需上线验收。后台不使用 SQL。
