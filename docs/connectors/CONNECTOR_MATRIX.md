# GeoLens 全渠道 Connector 能力矩阵与官方准入清单

> **版本**：v2.0  
> **更新日期**：2026-09-15  
> **状态**：全平台接入就绪（37 渠道全覆盖）  
> **安全基线**：零逆向爬虫，零私有 Cookie，100% 官方可信依据  

---

## 1. 架构总览与状态枚举说明

### 1.1 实现状态 (`ImplementationStatus`)
- **`READY`**：官方 API 完备，SaaS 自动化发布链路就绪，配置凭据后即可生产运行。
- **`READY_FOR_CREDENTIALS`**：官方支持发布，需用户提供自有 API Key / 租户密钥后激活。
- **`REQUIRES_APP_REVIEW`**：官方需完成开发者应用审核、权限范围 (Scope) 申请或企业资质备案。
- **`RESTRICTED`**：官方对第三方发布能力施加极其严苛的白名单准入或仅允许企业特定业务直发。
- **`MANUAL_ONLY`**：官方不存在针对第三方 SaaS 的服务端发布 API，系统提供高保真手工发布包 (`ManualPublishingPackage`)。

### 1.2 认证方式 (`AuthorizationType`)
- **`OAUTH2`**：标准 OAuth 2.0 授权码模式或 PKCE。
- **`API_KEY`**：API Key、Bearer Token、Personal Access Token 或 Webhook URL。
- **`NONE`**：无鉴权直接生成发布物料包。

---

## 2. 渠道能力全景矩阵

| 序号 | 渠道枚举 (Channel) | 分类 (Category) | 认证类型 | 实现状态 | 文本 | 图片 | 视频 | 定时 | 状态查询 | 官方开发者文档 URL | 生产准入前置与阻塞点 |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- | :--- |
| **1** | `WORDPRESS` | `OWNED_SITE` | `OAUTH2` / `API_KEY` | `READY` | ✅ | ✅ | ❌ | ✅ | ✅ | `https://developer.wordpress.org/rest-api/` | 需要应用密码或 WordPress.com OAuth App |
| **2** | `GHOST` | `OWNED_SITE` | `API_KEY` | `READY` | ✅ | ✅ | ❌ | ✅ | ✅ | `https://ghost.org/docs/admin-api/` | 需要 Ghost Admin API Key |
| **3** | `WEBFLOW` | `OWNED_SITE` | `OAUTH2` | `READY` | ✅ | ✅ | ❌ | ❌ | ✅ | `https://developers.webflow.com/data/reference/rest-introduction` | 需要 Webflow App Client ID/Secret |
| **4** | `BLOGGER` | `OWNED_SITE` | `OAUTH2` | `READY` | ✅ | ✅ | ❌ | ❌ | ✅ | `https://developers.google.com/blogger/docs/3.0/reference` | Google Cloud Console 审核 Blogger API |
| **5** | `DEVTO` | `OWNED_SITE` | `API_KEY` | `READY` | ✅ | ✅ | ❌ | ❌ | ✅ | `https://developers.forem.com/api/v1` | Forem API Key |
| **6** | `SHOPIFY` | `OWNED_SITE` | `OAUTH2` | `READY_FOR_CREDENTIALS` | ✅ | ✅ | ❌ | ❌ | ✅ | `https://shopify.dev/docs/api/admin-rest` | Shopify Partner App 权限申请 |
| **7** | `TELEGRAM` | `MESSAGING` | `API_KEY` | `READY` | ✅ | ✅ | ✅ | ❌ | ❌ | `https://core.telegram.org/bots/api` | BotFather 创建 Bot Token，加入目标频道 |
| **8** | `DISCORD` | `MESSAGING` | `API_KEY` | `READY` | ✅ | ✅ | ✅ | ❌ | ❌ | `https://discord.com/developers/docs/resources/webhook` | Webhook URL 配置 |
| **9** | `SLACK` | `MESSAGING` | `OAUTH2` / `API_KEY` | `READY` | ✅ | ✅ | ❌ | ❌ | ❌ | `https://api.slack.com/messaging/webhooks` | Incoming Webhook 或 `chat:write` Scope |
| **10** | `CUSTOM_WEBHOOK` | `MESSAGING` | `API_KEY` | `READY` | ✅ | ✅ | ✅ | ❌ | ❌ | `https://geolens.io/docs/webhooks` | 外部接收端实现校验签名 |
| **11** | `MASTODON` | `COMMUNITY` | `OAUTH2` | `READY` | ✅ | ✅ | ✅ | ✅ | ✅ | `https://docs.joinmastodon.org/client/intro/` | 实例域名与 App 凭证 |
| **12** | `BLUESKY` | `COMMUNITY` | `API_KEY` | `READY` | ✅ | ✅ | ❌ | ❌ | ✅ | `https://docs.bsky.app/docs/category/http-reference` | AT Protocol App Password |
| **13** | `REDDIT` | `COMMUNITY` | `OAUTH2` | `READY_FOR_CREDENTIALS` | ✅ | ✅ | ❌ | ❌ | ✅ | `https://www.reddit.com/dev/api/` | Reddit 开发者应用审批 (Submit Scope) |
| **14** | `THREADS` | `SOCIAL` | `OAUTH2` | `REQUIRES_APP_REVIEW` | ✅ | ✅ | ✅ | ❌ | ✅ | `https://developers.facebook.com/docs/threads` | Meta 开发者应用审核 (`threads_content_publish`) |
| **15** | `LINKEDIN` | `SOCIAL` | `OAUTH2` | `REQUIRES_APP_REVIEW` | ✅ | ✅ | ✅ | ❌ | ✅ | `https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin` | LinkedIn 开发者企业页面认证与审核 |
| **16** | `PINTEREST` | `SOCIAL` | `OAUTH2` | `REQUIRES_APP_REVIEW` | ✅ | ✅ | ✅ | ❌ | ✅ | `https://developers.pinterest.com/docs/api/v5/` | Pinterest 商业应用标准访问审核 |
| **17** | `X` | `SOCIAL` | `OAUTH2` | `READY_FOR_CREDENTIALS` | ✅ | ✅ | ✅ | ❌ | ✅ | `https://developer.x.com/en/docs/x-api` | X API Basic/Pro 付费订阅方案 |
| **18** | `FACEBOOK` | `SOCIAL` | `OAUTH2` | `REQUIRES_APP_REVIEW` | ✅ | ✅ | ✅ | ✅ | ✅ | `https://developers.facebook.com/docs/pages-api` | Meta App Review (`pages_manage_posts`) |
| **19** | `INSTAGRAM` | `SOCIAL` | `OAUTH2` | `REQUIRES_APP_REVIEW` | ❌ | ✅ | ✅ | ❌ | ✅ | `https://developers.facebook.com/docs/instagram-api/guides/content-publishing` | Instagram 专业账号绑定与 Meta 权限审核 |
| **20** | `GOOGLE_BUSINESS_PROFILE` | `LOCAL_BUSINESS` | `OAUTH2` | `REQUIRES_APP_REVIEW` | ✅ | ✅ | ❌ | ❌ | ✅ | `https://developers.google.com/my-business/reference/rest` | Google 官方商家 API 调用准入白名单 |
| **21** | `YOUTUBE` | `VIDEO` | `OAUTH2` | `READY_FOR_CREDENTIALS` | ❌ | ❌ | ✅ | ✅ | ✅ | `https://developers.google.com/youtube/v3/docs/videos/insert` | Google Cloud YouTube Data API v3 配额申请 |
| **22** | `TIKTOK` | `VIDEO` | `OAUTH2` | `REQUIRES_APP_REVIEW` | ❌ | ✅ | ✅ | ❌ | ✅ | `https://developers.tiktok.com/doc/content-posting-api-get-started` | TikTok Content Posting API 企业审核 |
| **23** | `BILIBILI` | `VIDEO` | `OAUTH2` | `READY_FOR_CREDENTIALS` | ❌ | ❌ | ✅ | ❌ | ✅ | `https://open.bilibili.com/` | Bilibili 开放平台入驻与分片上传密钥 |
| **24** | `XIGUA` | `VIDEO` | `OAUTH2` | `RESTRICTED` | ❌ | ❌ | ✅ | ❌ | ✅ | `https://open.douyin.com/` | 需字节跳动西瓜视频白名单企业资质 |
| **25** | `DOUYIN` | `RESTRICTED_OFFICIAL` | `OAUTH2` | `RESTRICTED` | ❌ | ❌ | ✅ | ❌ | ✅ | `https://open.douyin.com/platform/doc` | 代投稿下线；仅限企业白名单服务端直发视频 |
| **26** | `WEIBO` | `RESTRICTED_OFFICIAL` | `OAUTH2` | `REQUIRES_APP_REVIEW` | ✅ | ✅ | ❌ | ❌ | ✅ | `https://open.weibo.com/wiki/Statuses/share` | 微博开放平台企业认证，审核 `statuses/share` |
| **27** | `WECHAT_OFFICIAL_ACCOUNT` | `RESTRICTED_OFFICIAL` | `API_KEY` | `READY_FOR_CREDENTIALS` | ✅ | ✅ | ❌ | ❌ | ✅ | `https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_Draft.html` | 仅支持生成草稿箱 (`draft/add`)，需人工群发 |
| **28** | `TOUTIAO` | `RESTRICTED_OFFICIAL` | `OAUTH2` | `RESTRICTED` | ✅ | ✅ | ❌ | ❌ | ✅ | `https://open.douyin.com/` | 头条号开放接口需企业实名与白名单提额 |
| **29** | `BAIDU_SEARCH_SURFACE` | `SEARCH_SURFACE` | `API_KEY` | `READY` | ✅ | ❌ | ❌ | ❌ | ✅ | `https://ziyuan.baidu.com/college/courseinfo?id=267&page=2` | 百度搜索资源平台准入 Token 快速收录 API |
| **30** | `SEARCH_CONSOLE` | `SEARCH_SURFACE` | `OAUTH2` | `READY_FOR_CREDENTIALS` | ✅ | ❌ | ❌ | ❌ | ✅ | `https://developers.google.com/search-console/v1/reference/urlTestingTools/mobileFriendlyTest` | Google Cloud Indexing API 权限配置 |
| **31** | `XIAOHONGSHU` | `MANUAL_ONLY` | `NONE` | `MANUAL_ONLY` | ✅ | ✅ | ✅ | ❌ | ❌ | `https://open.xiaohongshu.com/` | **官方无第三方发文 API**，采用手工发布包 |
| **32** | `WECHAT_CHANNELS` | `MANUAL_ONLY` | `NONE` | `MANUAL_ONLY` | ❌ | ❌ | ✅ | ❌ | ❌ | `https://channels.weixin.qq.com/` | **官方仅开放直播带货接口**，无视频代发 API |
| **33** | `ZHIHU` | `MANUAL_ONLY` | `NONE` | `MANUAL_ONLY` | ✅ | ✅ | ❌ | ❌ | ❌ | `https://www.zhihu.com/` | **官方无开放 API**，采用手工发布包 |
| **34** | `BAIJIAHAO` | `MANUAL_ONLY` | `NONE` | `MANUAL_ONLY` | ✅ | ✅ | ❌ | ❌ | ❌ | `https://baijiahao.baidu.com/` | **百家号 OpenAPI 仅限官方合作媒体**，普通客户不可用 |
| **35** | `KUAISHOU` | `MANUAL_ONLY` | `NONE` | `MANUAL_ONLY` | ❌ | ❌ | ✅ | ❌ | ❌ | `https://open.kuaishou.com/` | **发视频接口仅限手机唤端**，无服务端直发 API |
| **36** | `SUBSTACK` | `MANUAL_ONLY` | `NONE` | `MANUAL_ONLY` | ✅ | ✅ | ❌ | ❌ | ❌ | `https://substack.com/` | **官方无公开发文 API**，采用手工发布包 |
| **37** | `MEDIUM` | `MANUAL_ONLY` | `NONE` | `MANUAL_ONLY` | ✅ | ✅ | ❌ | ❌ | ❌ | `https://github.com/Medium/medium-api-docs` | **Medium 已于 2023 年正式弃用与冻结发文 API** |

---

## 3. 安全防护与出站写隔离

```
[用户触发发布]
       │
       ▼
[审批流判定] ──未通过 APPROVED──► [400 拦截]
       │
       ▼
[连接状态判定] ──非 CONNECTED──► [400 拦截]
       │
       ▼
[内容合规与字数校验] ──不符合限制──► [记录 FAILED Attempt]
       │
       ▼
[EXTERNAL_PUBLISHING_ENABLED]
       ├── false ──► [BaseConnector 生成确定性 Mock Attempt (mock.geo.local)]
       └── true  ──► [向官方平台发出经过凭据脱敏的安全网络调用]
```

1. **绝对保密**：密钥引用 `vault://...` 不在任何外部网络或响应中回显。
2. **确定性重放**：`idempotencyKey` 保障多次重试零副作用。
3. **零封号原则**：对国内封闭平台（小红书、视频号、知乎）坚决不采用灰产自动化，以规范物料包协同赋能客户。
