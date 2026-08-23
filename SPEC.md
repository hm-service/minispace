# 设计规范

## 1. API

说明：错误响应统一使用 ErrorBody（见 2.2）。

### 1.1. 用户

说明：用户与登录 token 由管理员手动预设，无注册/管理接口；可通过 `DATA_DIR/users.json` 声明式预设（见 3.4）。token 仅允许 ASCII 字符（HTTP 头约束），前端登录时校验并提示。

| 方法 | 路径       | 请求体 | 响应体      | 鉴权         | 说明                         |
| ---- | ---------- | ------ | ----------- | ------------ | ---------------------------- |
| POST | /api/login | 无     | LoginResult | Bearer token | 400 空 token；401 无效 token |

### 1.2. 帖子

说明：前端依据 metadata 的 totalCount 计算总页数并做页导航，列表接口不返回 hasMore。

| 方法   | 路径                         | 请求体               | 响应体       | 鉴权         | 说明                                                                                                                                                                                                                                                   |
| ------ | ---------------------------- | -------------------- | ------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | /api/posts                   | CreatePostRequest    | PostDto      | Bearer token | textContent 与 mediaContent 都为空返回 400；textContent 最多 10000 字；mediaContent 元素须为已上传的 SHA256（编辑阶段先经 POST /api/media 上传，由后端计算返回），重复元素原样保留，存在未上传元素返回 400；成功 201，Location 指回帖子；401（未登录） |
| GET    | /api/posts/metadata          | 无                   | PostMetadata | Bearer token | totalCount 为有效（未删除）帖子总数；401（未登录）                                                                                                                                                                                                     |
| GET    | /api/posts                   | 无                   | PostList     | Bearer token | page 从 1 开始，每页 10 条有效帖子，按创建时间倒序；page 小于等于 0 返回第一页，大于最大页返回最后一页；401（未登录）                                                                                                                                  |
| GET    | /api/posts/{postId}          | 无                   | PostDto      | Bearer token | 404 帖子不存在（含 is_deleted=1）；401（未登录）                                                                                                                                                                                                       |
| POST   | /api/posts/{postId}/comments | CreateCommentRequest | CommentDto   | Bearer token | content 最多 500 字；404 帖子不存在；401（未登录）                                                                                                                                                                                                     |
| GET    | /api/posts/{postId}/comments | 无                   | CommentList  | Bearer token | 只返回有效评论，按创建时间倒序；404 帖子不存在；401（未登录）                                                                                                                                                                                          |
| DELETE | /api/posts/{postId}          | 无                   | 无（204）    | Bearer token | 仅作者可删，非作者返回 403；逻辑删除（is_deleted=1），删除后列表/详情不再返回；其评论与媒体文件保留；404 帖子不存在；401（未登录）                                                                                                                     |

### 1.3. 媒体文件

说明：媒体文件为引用共享（多条帖子可引用同一 sha256），删除帖子/评论不会删除媒体文件。

**缩略图（thumb）：**

- 前端小图模式（列表网格）请求 `GET /media/{sha256}@small`；卡片内大图请求 `@medium`，全屏大图请求原图。
- 基准取宽度：`small` 目标宽度 384px、`medium` 目标宽度 1024px；高度按原图比例计算（height = 基准宽 × 原图高 ÷ 原图宽）；原图更小则不放大。
- 输出格式为 WebP；GIF 取第一帧转静态。
- 缩略图缓存于 thumb.db（见 3.1 / 3.2），以 `(raw_sha256, width, height)` 唯一索引去重。
- 生成失败时，在 blob 中写入特殊标记字节；后续命中该标记时不再重试生成，直接返回原图。
- mode 采用白名单：`small` / `medium`，后续扩展 `large` 复用同一机制。
- 媒体 MIME 由后端判定（按文件内容/扩展名）；无法判定时才使用上传时携带的 Content-Type。
- 上传时后端解析图片原始尺寸（width/height，像素），存入 media 表并随 MediaDto 返回；字段命名与语义和 thumb.db 保持一致。
- 媒体响应（原图与缩略图）携带 `Cache-Control: private, max-age=31536000, immutable`（sha256 内容寻址，URL 永不失效）。

| 方法 | 路径                  | 请求体          | 响应体                | 鉴权         | 说明                                                                                                                                                                              |
| ---- | --------------------- | --------------- | --------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | /media/{sha256}       | 无              | 文件流（原图）        | Bearer token | 404 媒体不存在；401（未登录）；前端需带 Bearer token 用 fetch 获取 blob 后显示（`<img>` 无法携带请求头）                                                                          |
| GET  | /media/{sha256}@small | 无              | 文件流（WebP 缩略图） | Bearer token | 规则见上；404 媒体不存在；401（未登录）                                                                                                                                           |
| GET  | /media/{sha256}@medium | 无             | 文件流（WebP 缩略图） | Bearer token | 规则见上；404 媒体不存在；401（未登录）                                                                                                                                          |
| POST | /api/media            | multipart：file | MediaDto              | Bearer token | 仅支持 jpg/jpeg/png/gif/webp/bmp，大小不超过 20MB；sha256 与 width/height 由后端解析，无法解析为有效图片返回 400；相同内容重复上传复用已有记录；400 类型或大小不符；401（未登录） |

### 1.4. 评论

| 方法   | 路径                      | 请求体 | 响应体    | 鉴权         | 说明                                                                                                        |
| ------ | ------------------------- | ------ | --------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| DELETE | /api/comments/{commentId} | 无     | 无（204） | Bearer token | 仅作者可删，非作者返回 403；逻辑删除（is_deleted=1），删除后评论列表不再返回；404 评论不存在；401（未登录） |

## 2. DTO 定义

### 2.1. 请求体

#### 2.1.1. CreatePostRequest

```json
{
    "textContent": "今天天气不错",
    "mediaContent": [
        "<media sha256>"
    ]
}
```

- `textContent`：可选，最多 10000 字
- `mediaContent`：可选，元素为已上传图片的 SHA256（字符串列表）；编辑阶段先上传图片（POST /api/media），由后端计算并返回；发帖时元素须已上传，重复元素原样保留；后端按 sha256 从 media 表补齐 width/height，存为 `{ "sha256", "width", "height" }`

#### 2.1.2. CreateCommentRequest

```json
{
    "content": "写得好"
}
```

- `content`：必填，最多 500 字

### 2.2. 响应体

#### 2.2.1. ErrorBody

```json
{
    "code": 400,
    "message": "message"
}
```

- `code`：与 HTTP 状态码一致
- `message`：错误描述

#### 2.2.2. LoginResult

```json
{
    "userId": "<userId>",
    "nickname": "nickname"
}
```

#### 2.2.3. PostDto

```json
{
    "postId": "<uuid>",
    "userId": "<uuid>",
    "nickname": "<nickname>",
    "textContent": "今天天气不错",
    "mediaContent": [
        {
            "sha256": "<media sha256>",
            "width": 1920,
            "height": 1080
        }
    ],
    "createdAt": 1724227200
}
```

#### 2.2.4. PostList

```json
{
    "items": [
        {
            "postId": "<uuid>",
            "userId": "<uuid>",
            "nickname": "<nickname>",
            "textContent": "今天天气不错",
            "mediaContent": [],
            "createdAt": 1724227200
        }
    ]
}
```

- `items`：PostDto 数组

#### 2.2.5. PostMetadata

```json
{
    "totalCount": 128
}
```

- `totalCount`：有效（未删除）帖子总数

#### 2.2.6. CommentDto

```json
{
    "commentId": "<uuid>",
    "userId": "<uuid>",
    "postId": "<uuid>",
    "nickname": "<nickname>",
    "content": "写得好",
    "createdAt": 1724227200
}
```

#### 2.2.7. CommentList

```json
{
    "items": [
        {
            "commentId": "<uuid>",
            "userId": "<uuid>",
            "postId": "<uuid>",
            "nickname": "<nickname>",
            "content": "写得好",
            "createdAt": 1724227200
        }
    ]
}
```

- `items`：CommentDto 数组

#### 2.2.8. MediaDto

```json
{
    "sha256": "<sha256>",
    "contentType": "image/png",
    "width": 1920,
    "height": 1080,
    "url": "/media/<sha256>"
}
```

## 3. 数据存储

### 3.1. 基本存储方案

| 名称     | 类型          | 作用                                                            |
| -------- | ------------- | --------------------------------------------------------------- |
| data.db  | sqlite 数据库 | 存储主要数据，包括用户/帖子/回复/媒体文件元数据                 |
| thumb.db | sqlite 数据库 | 缓存缩略图（WebP blob），见 3.2 表定义                          |
| static/  | 目录          | 存储静态文件，例如媒体文件，采用二级哈希结构，如 /ef/ac/efac... |
| users.json | 文件        | 用户预设数据源（DATA_DIR），启动时与 user 表对齐，见 3.4        |

### 3.4. 用户数据源（users.json）

- 文件不存在 → 不做任何行为，不影响启动。
- 格式为 JSON 数组：`[ { "userId": "<uuid>", "nickname": "...", "token": "..." } ]`；`token` 为明文，启动时计算 SHA256 哈希入库。
- `token` 必须为 ASCII 字符（HTTP 头约束）；非 ASCII 的 token 条目跳过并记入审计日志。
- 对齐规则（按 userId upsert）：
  - 用户存在 → 盲写 `nickname` 与 `token_hash`（不比较旧值）；
  - 用户不存在 → 插入；
  - **不删除** json 中缺失的用户。
- `userId` 必须非空且在 json 内唯一；非法/重复条目跳过并记入审计日志。
- json 解析失败 → 记审计日志并跳过，不影响启动。

### 3.2. data.db 表定义

**用户 (user):**

| 字段       | 类型    | 说明                        |
| ---------- | ------- | --------------------------- |
| id         | INTEGER | 自增主键                    |
| user_id    | TEXT    | 用户唯一 id，为 uuidv4      |
| nickname   | TEXT    | 用户的昵称                  |
| token_hash | TEXT    | 登录 token 的 SHA256 哈希值 |

**帖子 (post):**

| 字段          | 类型    | 说明                                                                       |
| ------------- | ------- | -------------------------------------------------------------------------- |
| id            | INTEGER | 自增主键                                                                   |
| post_id       | TEXT    | post 的 id，为 uuidv4                                                      |
| user_id       | TEXT    | 发布者的 user_id                                                           |
| text_content  | TEXT    | 文字内容                                                                   |
| media_content | TEXT    | 媒体文件内容，为 json 列表，每个元素为 { sha256, width, height }，有顺序性 |
| created_at    | INTEGER | 发布时间，为 unix 秒级时间戳，使用 UTC 0                                   |
| is_deleted    | INTEGER | 0/1，指示 post 是否被删除                                                  |

**评论 (comment):**

| 字段       | 类型    | 说明                                             |
| ---------- | ------- | ------------------------------------------------ |
| id         | INTEGER | 自增主键                                         |
| comment_id | TEXT    | 评论 ID                                          |
| post_id    | TEXT    | 回复所关联的 post 的 id                          |
| user_id    | TEXT    | 发起回复的用户 user_id                           |
| content    | TEXT    | 回复内容                                         |
| created_at | INTEGER | comment 发布时间，为 unix 秒级时间戳，使用 UTC 0 |
| is_deleted | INTEGER | 0/1，指示 comment 是否被删除                     |

**媒体文件 (media):**

| 字段   | 类型    | 说明                         |
| ------ | ------- | ---------------------------- |
| id     | INTEGER | 自增主键                     |
| sha256 | TEXT    | 文件的 SHA256，唯一索引      |
| mime   | TEXT    | 文件的 MIME，如 `image/jpeg` |
| size   | INTEGER | 文件大小，单位为字节         |
| width  | INTEGER | 图片宽度（像素）             |
| height | INTEGER | 图片高度（像素）             |

### 3.3. thumb.db 表定义

**缩略图 (thumb):**

| 字段       | 类型    | 说明                                      |
| ---------- | ------- | ----------------------------------------- |
| id         | INTEGER | 自增主键                                  |
| raw_sha256 | TEXT    | 原图的 sha256                             |
| width      | INTEGER | 缩略图宽度（基准：small 384px / medium 1024px） |
| height     | INTEGER | 缩略图高度（按原图比例计算）              |
| blob       | BLOB    | WebP 图像数据；生成失败时写入特殊标记字节 |

唯一索引：`(raw_sha256, width, height)`。

说明：thumb.width / thumb.height 与 media.width / media.height 均为像素尺寸，命名与语义一致。

**特殊标记字节：**

| 特殊标记字节 | 值                                                        | 说明                                                                                                                                                                                                    |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| THUMBFAIL    | `54 48 55 4D 42 46 41 49 4C`（ASCII "THUMBFAIL"，9 字节） | 缩略图生成失败时写入 blob 首部；读取时先比较 blob 长度：长度小于 16 字节时才进入 StartsWith 比对；命中则视为生成失败，直接返回原图，不再重试生成（合法 WebP 至少 16+ 字节，长度判断可跳过绝大多数比对） |

## 4. 前端架构与缓存策略

### 4.1. 组件结构

- 根组件：登录页、发布框、分页、全屏大图（lightbox）、确认弹窗；通过 `provide('app', ...)` 向卡片提供共享状态与函数。
- `PostCard` 组件：一张帖子的完整卡片（头像/正文/图片网格/卡片内大图/评论），持有卡片级图片缓存。

### 4.2. 缓存作用域

媒体经 Bearer 鉴权，`<img>` 无法携带请求头，图片必须走 `fetch → Blob → URL.createObjectURL` 转成本地 URL 显示；该 URL 必须由某个作用域持有（这是异步 fetch 与同步渲染之间的“桥”，也是媒体鉴权引入的核心复杂度）。分三层：

| 层级 | 作用域 | 内容 | 生命周期 |
| ---- | ------ | ---- | -------- |
| 卡片级 | 单个 `PostCard` | `sha@mode` → blob URL（缩略图 + 原图） | 卡片卸载时整体 revoke + clear |
| 全屏会话级 | 一次全屏打开到关闭 | 原图 sha → blob URL | 关闭时 revoke + clear（含在途集合） |
| 浏览器 HTTP | 整个浏览器 | 原图/缩略图响应 | 后端 `Cache-Control: private, max-age=31536000, immutable` |

### 4.3. 关键约定

- `openLightbox` 传递图片**索引**而非 sha（序列允许重复 sha，用 sha 反查会命中第一个副本，导致定位错误）。
- 加载失败在缓存中记 `''`，本次作用域内不再重试；作用域销毁后自然恢复重试。
- 全屏关闭时必须同时清空“在途”集合，否则重开同一张图不会重新发起请求。
- 前端静态资源通过 `index.html` 中 `?v=` 手动递增版本号；`index.html` 本身 `no-cache`。
- 复制链接等轻量反馈使用顶部 toast（非阻塞），不再使用弹窗。

### 4.4. 路由与页面

前端无路由库，按 `location.pathname` 判断视图，页面间用整页跳转（`location.replace`）：

| 路径 | 页面 | 说明 |
| ---- | ---- | ---- |
| `/auth` | 登录页 | 未认证访问其他路径 → 302 到 `/auth?next=<原路径>`；已认证访问 `/auth` → 跳到 `next` 或 `/` |
| `/` | 动态流 | 登录后主页（发布框 + 分页 + 帖子卡片） |
| `/posts/{postId}` | 单动态页 | 复用 PostCard，拉取单帖 + 评论；隐藏发布框/分页；顶部为全宽返回条（无品牌标题），提供返回链接 |

- 未认证时非 `/auth` 路径一律重定向到 `/auth`（带 `next` 回跳）；认证失败同样重定向。
- SPA 路由由后端 `MapFallbackToFile("index.html")` 兜底；所有无扩展名路径的 HTML 响应 `no-cache`。
- 帖子菜单“复制链接”生成 `{origin}/posts/{postId}`。
