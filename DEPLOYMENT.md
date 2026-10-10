# 当前部署：GitHub 网址 + 用户名密码登录

前端：https://zhenghaohong.github.io/life-notebook/
后台：https://life-notebook-api.zhengteshuai.workers.dev

用户名 `zhenghaohong`，网站内直接输入密码，不跳转 GitHub。Cloudflare Worker 校验密码并签发 30 分钟会话；API 每次请求都验证签名、账号、来源和有效期。会话仅在页面内存中，刷新后需要登录；浏览器密码管理器可由用户自行选择使用。密码不会写入前端、Git 仓库或 localStorage。

Worker 变量：AUTH_MODE=password、LOGIN_USERNAME=zhenghaohong，以及 wrangler.toml 中的仓库和来源配置。
Worker 加密密钥：LOGIN_PASSWORD（独立的至少 16 字符网站密码）、GITHUB_TOKEN（仅私有数据仓库 Contents 读写）、SESSION_SECRET（至少32字符随机值）；现有部署也可使用已加密保存的 GITHUB_OAUTH_SECRET 作为签名密钥，无需 OAuth 授权。

LOGIN_RATE_LIMIT 为 Cloudflare 速率限制器，namespace_id=1001001，limit=5，period=60，以连接 IP 为键；缺少绑定时拒绝登录。此限制按 Cloudflare 边缘位置执行，并非全球账号锁定。使用强且不重复的密码。

GitHub Token 到期后需要替换后台 GITHUB_TOKEN，网站重新登录不会延长 Token 有效期。

数据路径：cost/YYYY/MM/YYYY-MM-DD.json、daily/YYYY/MM/YYYY-MM-DD.md、settings/tags.json；每次保存检查文件 SHA，避免覆盖其他设备修改。不使用 SQL。

本地检查：npm run check、npm test、npm run build。部署：npm run deploy:worker；前端推送 main 自动通过 GitHub Actions 发布。web/config.js demo=false 为正式模式；本地演示请改为 true，数据独立。

密码登录替代早期 README 的 Cloudflare Access 和 GitHub OAuth 方案。无需自定义域名或 Zero Trust 订阅。旧 OAuth 应用目前保留，但 password 模式不使用它的登录路由。

上线仍需用户保存 LOGIN_PASSWORD，并完成真实登录与私有仓库读写验证。

参考：https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## 记住登录
勾选后签发 7 天登录凭证，保存在前端路径范围的 Secure、SameSite=Lax Cookie；不保存明文密码。未勾选有效期 30 分钟，仅保存在内存。恢复登录前后台验证凭证，退出登录清除当前浏览器 Cookie。跨站前端无法设置 HttpOnly Cookie，所以凭证可由本网站脚本读取，应保护前端免受 XSS；密码仍仅保存在后台。退出清除本地会话，但已复制的凭证到期前仍有效。
