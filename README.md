# 日常 · Life Notebook

iPhone 优先的个人记账与双语日记。浅色简约 UI，无天气栏，支持首页、Cost、Daily、历史记录、月度统计、标签和设置。宽屏采用侧栏和双栏内容，手机采用底部导航、安全区留白和 16px 输入框。断点按 CSS 视口宽度工作，因此兼容 4K 屏幕缩放和 1080P 屏幕，而不是依赖设备型号。

## 本地体验

需要 Node.js 22 或更高版本。

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 。默认 `web/config.js` 启用演示模式。演示数据只保存在当前浏览器 localStorage，与正式仓库数据隔离，无默认虚构账单。不要将演示模式当作线上备份。

```sh
npm run check
npm test
npm run build
```

`dist/` 是完整可部署的静态前端。页面采用相对路径资源和 hash 路由，也适用于 GitHub Pages 项目子路径。前端不依赖打包框架；Worker 使用 jose 验证 JWT，Wrangler 负责部署。

## 架构与文件格式

```text
GitHub Pages: app.example.com
       ↓ HTTPS + Cookie（同一主域名）
Cloudflare Access → Worker: api.example.com
       ↓ 服务端 GitHub Token
GitHub 私有数据仓库
  cost/YYYY/MM/YYYY-MM-DD.json
  daily/YYYY/MM/YYYY-MM-DD.md
  settings/tags.json
```

Cost 每天一个 JSON 数组，例：

```json
[{"id":"a-unique-uuid","amountCents":1250,"tag":"餐饮","note":"午餐","time":"12:30"}]
```

金额以整数分保存（1250 = ¥12.50），避免小数误差。日期由路径确定；时间是所选日期的本地 HH:mm。新建、编辑和删除均以更新该天数组实现；删除最后一笔后保留空数组。标签移除不会影响历史账单。当前版本单用户、人民币支出，不包含收入、汇率或 SQL。

Daily 使用 UTF-8 Markdown，包含中文和英文标题。首行 `<!-- life-notebook:... -->` 是可往返读取的 JSON 元数据，正文是可阅读的 Markdown。不要仅手动改正文；应用以首行元数据为准。英文和中文都可为空。直接修改仓库时必须同步首行；建议使用应用编辑。清空两栏并保存会清空日记内容，保留该天文件。

每次保存都提交 GitHub commit，并校验加载时的 SHA；如果其他设备已经修改，返回 409，不会自动覆盖。冲突时请先复制未保存的日记，然后重新加载。历史搜索和月度统计只针对选定月份；月度读取最多 31 个日文件，历史最多 62 个，限制为 4 个并发任务。不存在的文件视为空白；GitHub 权限错误或配额失败不会当作空数据。

## 正式部署（按顺序）

需要你自己的 GitHub 与 Cloudflare 账号，以及由 Cloudflare 管理 DNS 的自定义域名。当前交付是实际项目与部署配置，尚未使用你的账号部署。

### 1. 私有数据仓库

创建一个 **Private** 仓库，例如 `life-private-data`，用 README 初始化 `main` 分支。它不能启用 Pages，也不能与前端公共仓库混用。无需手动创建日文件，Worker 会首次保存时创建目录与文件。

创建 GitHub fine-grained personal access token，仅选择该数据仓库，Repository permissions 设置 **Contents: Read and write**。不要放入前端、Git 仓库或工作流文件。设置合理的有效期，过期后在 Worker Secret 中更新。

### 2. Worker 配置

修改 `wrangler.toml` 的所有占位值：

| 配置 | 含义 |
|---|---|
| FRONTEND_ORIGIN | `https://app.example.com`，不含末尾 `/` 或子路径 |
| GITHUB_OWNER / GITHUB_REPO / GITHUB_BRANCH | 私有数据仓库所属用户、名称、分支 |
| ACCESS_TEAM_DOMAIN | Zero Trust 团队域名，例如 `myteam.cloudflareaccess.com` |
| ACCESS_AUD | 下一步骤创建的 Access 应用 AUD |
| ALLOWED_EMAIL | 唯一允许使用的邮箱 |

启用 `routes` 的自定义域名 `api.example.com`。保留 `workers_dev = false`，避免另一公网地址绕开 Access。部署：

```sh
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npm run deploy:worker
```

Secret 命令会交互式要求 Token；不要把 Token 当命令行参数。发布后更新 Secret 时不需要修改前端。

### 3. Cloudflare Access 身份认证

在 Cloudflare Zero Trust → Access → Applications 创建 Self-hosted 应用，覆盖 **整个 api.example.com**，不要仅覆盖 `/login`。登录方式可使用邮箱一次性验证码，Allow policy 只允许你的邮箱。复制该应用 AUD 到 `wrangler.toml` 后重新部署 Worker。

在此 Access 应用的 CORS 设置中启用 **Bypass OPTIONS requests**，使浏览器的预检到达 Worker；实际 GET/PUT 请求仍须登录验证。Worker 只允许 FRONTEND_ORIGIN、只接受 JSON 写入，验证 JWT 的签名、issuer、AUD、有效期和邮箱。不可用 Skip/Bypass 策略放行实际 API 请求。

Access 自身会维护 HttpOnly 认证 Cookie；本项目不在 localStorage 存放 Token。建议 Access 会话有效期设为 24 小时，并对 GitHub 和 Cloudflare 管理账号开启 MFA。

### 4. GitHub Pages 前端

创建单独的前端代码仓库，将本项目内容推送到 `main`。GitHub Settings → Pages → Source 选择 GitHub Actions。仓库中已有 `.github/workflows/pages.yml`，自动检查、测试、构建并部署 `dist/`。

修改 `web/config.js`：

```js
window.APP_CONFIG = { apiBase: "https://api.example.com", demo: false };
```

Pages 设置 Custom domain 为 `app.example.com`；按 GitHub Pages 提示添加 DNS CNAME 指向 `你的用户名.github.io`，启用 Enforce HTTPS。配置修改后推送，触发部署。

**前端和 API 必须在同一主域名下**。不要把正式前端留在 `github.io` 而 API 使用另一网站域名；iPhone Safari 对第三方 Cookie 的限制会使这种结构登录失败。两个子域名都必须是 HTTPS。Pages 前端静态代码可公开，个人账单和日记只在私有仓库和已认证 API 内。

首次访问前端 → 设置 → 登录，浏览器会在 API 域名完成 Access 认证并返回前端。刷新读取数据。重新登录可以续期；退出登录按钮清除 API Access 会话（身份提供商的 SSO 会话可能仍有效）。

### 5. 上线验收

1. 未登录直接访问 `/api/cost?date=2026-10-10` 不应返回个人数据。
2. 用非允许邮箱登录，应被 Access 拒绝；Worker 也会检查邮箱。
3. 新建一笔 ¥12.50 → 编辑 → 删除，查看私有仓库对应 JSON 和提交记录。
4. 保存中文日记、英文为空 → 刷新 → 核对内容；再测试英文。
5. 两个浏览器加载同一天，先后保存，后保存应出现冲突提示。
6. 查看月份统计、历史搜索、标签新增和移除。
7. 在 iPhone Safari、Mac Safari 与 Windows 浏览器检查布局。建议检查 430/440、1440、1920、2560/3840 CSS 视口宽度；4K 屏幕系统缩放会改变实际 CSS 宽度。

## 安全与限制

只有 Worker Secret 持有 GitHub Token。前端 API 地址与 Access AUD 不是密钥。GitHub 私有仓库维护版本历史，删除记录不等于删除历史提交。前端以 textContent/HTML 转义显示文本，不执行日记 Markdown 中的 HTML。未保存日记离开前会提示；没有离线同步或自动保存。大文件限制与字段校验在 Worker 中执行。

正式访问需要完成域名、Access 和 Token 配置。没有真实账号配置时，本地测试无法验证跨域 Cookie、云端认证、GitHub 实际写入以及指定物理设备上的显示效果。GitHub API 配额与仓库可用性会影响读取速度；此版本适合个人每日记录。

官方参考：[Cloudflare Access JWT 验证](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、[GitHub Contents API](https://docs.github.com/en/rest/repos/contents)。
