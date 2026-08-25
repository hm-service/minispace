# 设计规范

## 1. 设计约定

### 1.1 认证与鉴权

- 所有 `/api` 端点（除 `/api/login` 外）均需 `Authorization: Bearer <token>` 认证，由自定义 Token 认证 scheme 处理；未认证返回 401（由 `RequireAuthorization` 产生）。
- 用户与登录 token 由管理员手动预设，无注册/管理接口；可通过 `DATA_DIR/users.json` 声明式预设（见 4.4）。
- token 仅允许 ASCII 字符（HTTP 头约束），前端登录时校验并提示；数据库仅存 token 的 SHA-256 哈希。
- handler 内通过 `HttpContext.User` 获取当前用户（`User.UserId` / `User.Nickname`），不自行解析 Authorization 头。

### 1.2 错误响应

400/403 等业务错误响应使用 RFC 9457 Problem Details 格式（`type`/`title`/`status`/`detail`/`instance`），例如：

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Invalid Content",
  "status": 400,
  "detail": "评论最多 500 字"
}
```

- `title`：固定错误类别，如 Invalid Content / Invalid Operation / Forbidden Operation
- `status`：HTTP 状态码
- `detail`：人类可读的错误描述（前端展示用）
- 404 响应无 body

### 1.3 分页与列表

- 帖子列表 `page` 从 1 开始，每页 10 条有效帖子，按创建时间倒序（`created_at` 降序、`id` 降序）。
- `page` 小于等于 0 返回第一页，大于最大页返回最后一页。
- 前端依据 `GET /api/posts/metadata` 的 `totalCount` 计算总页数并做页导航；列表接口不返回 hasMore。
- 评论列表不分页，返回某帖子全部有效评论，按创建时间倒序。

### 1.4 逻辑删除

- 帖子与评论删除均为逻辑删除（`is_deleted=1`），删除后列表/详情不再返回。
- 删除帖子不会删除其评论与媒体文件；媒体文件为引用共享（多条帖子可引用同一 sha256），删除帖子/评论不会删除媒体文件。

### 1.5 媒体与缩略图约定

- 前端小图模式（列表网格）请求 `GET /media/{sha256}@small`；卡片内大图请求 `@medium`，全屏大图请求原图。
- 基准取宽度：`small` 目标宽度 384px、`medium` 目标宽度 1024px；高度按原图比例计算（height = 基准宽 × 原图高 ÷ 原图宽）；原图更小则不放大。
- 输出格式为 WebP；GIF 取第一帧转静态。
- 缩略图缓存于 thumb.db（见 4.3），以 `(raw_sha256, width, height)` 唯一索引去重。
- 生成失败时，在 blob 中写入特殊标记字节；后续命中该标记时不再重试生成，直接返回原图。
- mode 采用白名单：`small` / `medium`，后续扩展 `large` 复用同一机制。
- 媒体 MIME 由后端判定（按文件内容/扩展名）；无法判定时才使用上传时携带的 Content-Type。
- 上传时后端解析图片原始尺寸（width/height，像素），存入 media 表并随 MediaDto 返回；字段命名与语义和 thumb.db 保持一致。
- 媒体响应（原图与缩略图）携带 `Cache-Control: private, max-age=31536000, immutable`（sha256 内容寻址，URL 永不失效）。

## 2. 端点

> 除特别说明外，所有端点均需 `Authorization: Bearer <token>`。

### 2.1 用户

#### POST /api/login

校验 token 并返回用户资料（token 即凭证，无密码登录）。

**请求**：无请求体；token 放在 `Authorization` 头。

**响应**：

| 状态码 | body | 说明 |
| --- | --- | --- |
| 200 | LoginResult | 登录成功 |
| 400 | ProblemDetails | token 为空 |
| 401 | - | token 无效 |

### 2.2 帖子

#### POST /api/posts

创建帖子。

**请求体** CreatePostRequest：

```json
{
  "textContent": "今天天气不错",
  "mediaContent": ["<media sha256>"]
}
```

**响应**：

| 状态码 | body | 说明 |
| --- | --- | --- |
| 201 | PostDto | 创建成功，`Location: /api/posts/{postId}` |
| 400 | ProblemDetails | textContent 与 mediaContent 都为空；textContent 超 10000 字；mediaContent 含非法 SHA256 或未上传的图片 |
| 401 | - | 未认证 |

**规则**：

- `textContent` 可选，最多 10000 字；`mediaContent` 可选，元素须为已上传图片的 SHA256（编辑阶段先经 POST /api/media 上传，由后端计算返回），重复元素原样保留、顺序保留。
- 后端按原顺序将 mediaContent 存为 sha256 字符串列表（见 3.1），响应时再从 media 表补齐 width/height。

#### GET /api/posts/metadata

获取有效帖子总数。

**请求**：无参数。

**响应**：

| 状态码 | body | 说明 |
| --- | --- | --- |
| 200 | PostMetadataDto | `totalCount` 为有效（未删除）帖子总数 |
| 401 | - | 未认证 |

#### GET /api/posts

分页获取帖子列表。

**请求**：`page` 查询参数，从 1 开始（规则见 1.3）。

**响应**：

| 状态码 | body | 说明 |
| --- | --- | --- |
| 200 | PostListDto | `items` 为 PostDto 数组 |
| 401 | - | 未认证 |

#### GET /api/posts/{postId}

获取单条帖子。

**响应**：

| 状态码 | body | 说明 |
| --- | --- | --- |
| 200 | PostDto | 帖子详情 |
| 404 | - | 帖子不存在（含 is_deleted=1） |
| 401 | - | 未认证 |

#### DELETE /api/posts/{postId}

删除帖子（仅作者）。

**响应**：

| 状态码 | body | 说明 |
| --- | --- | --- |
| 204 | - | 删除成功（逻辑删除，见 1.4） |
| 403 | ProblemDetails | 非作者 |
| 404 | - | 帖子不存在 |
| 401 | - | 未认证 |

### 2.3 评论

#### POST /api/comments

创建评论。

**请求体** CreateCommentRequest：

```json
{
  "postId": "<postId>",
  "content": "写得好"
}
```

**响应**：

| 状态码 | body | 说明 |
| --- | --- | --- |
| 201 | CommentDto | 创建成功，`Location: /api/comments/{commentId}` |
| 400 | ProblemDetails | content 为空或超 500 字；postId 缺失或空白 |
| 404 | - | 帖子不存在 |
| 401 | - | 未认证 |

#### GET /api/comments?postId={postId}

获取某帖子的评论列表。

**请求**：`postId` 查询参数，必填。

**响应**：

| 状态码 | body | 说明 |
| --- | --- | --- |
| 200 | CommentList | `items` 为 CommentDto 数组，只含有效评论，按创建时间倒序 |
| 400 | ProblemDetails | postId 缺失或空白 |
| 404 | - | 帖子不存在 |
| 401 | - | 未认证 |

#### DELETE /api/comments/{commentId}

删除评论（仅作者）。

**响应**：

| 状态码 | body | 说明 |
| --- | --- | --- |
| 204 | - | 删除成功（逻辑删除，见 1.4） |
| 403 | ProblemDetails | 非作者 |
| 404 | - | 评论不存在 |
| 401 | - | 未认证 |

### 2.4 媒体

#### GET /media/{key}

获取原图或缩略图文件流。

`key` 为图片 sha256，或 `sha256@small` / `sha256@medium` 缩略图模式（规则见 1.5）。

**响应**：

| 状态码 | body | 说明 |
| --- | --- | --- |
| 200 | 文件流 | 原图（媒体 MIME）或 WebP 缩略图 |
| 400 | ProblemDetails | 未知缩略图模式 |
| 404 | - | 媒体不存在（media 表无记录或文件缺失） |
| 401 | - | 未认证 |

**注意**：前端需带 Bearer token 用 fetch 获取 blob 后显示（`<img>` 无法携带请求头）；响应携带 `Cache-Control: private, max-age=31536000, immutable`。

#### POST /api/media

上传图片（multipart/form-data）。

**请求**：multipart 字段 `file`。

**响应**：

| 状态码 | body | 说明 |
| --- | --- | --- |
| 201 | MediaDto | 上传成功（相同内容重复上传复用已有记录） |
| 400 | ProblemDetails | 类型不支持（仅 jpg/jpeg/png/gif/webp/bmp）；大小超过 20MB；内容无法解析为有效图片 |
| 401 | - | 未认证 |

**规则**：

- sha256 与 width/height 由后端解析并返回；相同内容重复上传复用已有记录。
- 图片大小不超过 20MB。

## 3. DTO 定义

### 3.1 请求体

#### CreatePostRequest

```json
{
  "textContent": "今天天气不错",
  "mediaContent": ["<media sha256>"]
}
```

- `textContent`：可选，最多 10000 字
- `mediaContent`：可选，元素为已上传图片的 SHA256（字符串列表）；重复元素原样保留、顺序保留

#### CreateCommentRequest

```json
{
  "postId": "<postId>",
  "content": "写得好"
}
```

- `postId`：必填，所属帖子的 id，缺失或空白返回 400
- `content`：必填，最多 500 字，为空返回 400

### 3.2 响应体

#### LoginResult

```json
{
  "userId": "<userId>",
  "nickname": "nickname"
}
```

#### PostDto

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

- `mediaContent`：存储层为 sha256 字符串列表，响应时由后端从 media 表补齐 width/height

#### PostListDto

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

#### PostMetadataDto

```json
{
  "totalCount": 128
}
```

- `totalCount`：有效（未删除）帖子总数

#### CommentDto

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

#### CommentList

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

#### MediaDto

```json
{
  "sha256": "<sha256>",
  "contentType": "image/png",
  "width": 1920,
  "height": 1080,
  "url": "/media/<sha256>"
}
```

## 4. 数据存储

### 4.1 基本存储方案

| 名称       | 类型          | 作用                                                            |
| ---------- | ------------- | --------------------------------------------------------------- |
| data.db    | sqlite 数据库 | 存储主要数据，包括用户/帖子/回复/媒体文件元数据                 |
| thumb.db   | sqlite 数据库 | 缓存缩略图（WebP blob），见 4.3 表定义                          |
| static/    | 目录          | 存储静态文件，例如媒体文件，采用二级哈希结构，如 /ef/ac/efac... |
| users.json | 文件          | 用户预设数据源（DATA_DIR），启动时与 user 表对齐，见 4.4        |

### 4.2 data.db 表定义

**用户 (user):**

| 字段       | 类型    | 说明                        |
| ---------- | ------- | --------------------------- |
| id         | INTEGER | 自增主键                    |
| user_id    | TEXT    | 用户唯一 id，为 uuidv4      |
| nickname   | TEXT    | 用户的昵称                  |
| token_hash | TEXT    | 登录 token 的 SHA256 哈希值 |

**帖子 (post):**

| 字段          | 类型    | 说明                                                           |
| ------------- | ------- | -------------------------------------------------------------- |
| id            | INTEGER | 自增主键                                                       |
| post_id       | TEXT    | post 的 id，为 uuidv4                                          |
| user_id       | TEXT    | 发布者的 user_id                                               |
| text_content  | TEXT    | 文字内容                                                       |
| media_content | TEXT    | 媒体文件内容，为 JSON 数组，元素为图片 sha256 字符串，有顺序性 |
| created_at    | INTEGER | 发布时间，为 unix 秒级时间戳，使用 UTC 0                       |
| is_deleted    | INTEGER | 0/1，指示 post 是否被删除                                      |

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

### 4.3 thumb.db 表定义

**缩略图 (thumb):**

| 字段       | 类型    | 说明                                            |
| ---------- | ------- | ----------------------------------------------- |
| id         | INTEGER | 自增主键                                        |
| raw_sha256 | TEXT    | 原图的 sha256                                   |
| width      | INTEGER | 缩略图宽度（基准：small 384px / medium 1024px） |
| height     | INTEGER | 缩略图高度（按原图比例计算）                    |
| blob       | BLOB    | WebP 图像数据；生成失败时写入特殊标记字节       |

唯一索引：`(raw_sha256, width, height)`。

说明：thumb.width / thumb.height 与 media.width / media.height 均为像素尺寸，命名与语义一致。

**特殊标记字节：**

| 特殊标记字节 | 值                                                        | 说明                                                                                                                                                                                                    |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| THUMBFAIL    | `54 48 55 4D 42 46 41 49 4C`（ASCII "THUMBFAIL"，9 字节） | 缩略图生成失败时写入 blob 首部；读取时先比较 blob 长度：长度小于 16 字节时才进入 StartsWith 比对；命中则视为生成失败，直接返回原图，不再重试生成（合法 WebP 至少 16+ 字节，长度判断可跳过绝大多数比对） |

### 4.4 用户数据源（users.json）

- 文件不存在 → 不做任何行为，不影响启动。
- 格式为 JSON 数组：

```json
[
  {
    "userId": "<uuid>",
    "nickname": "test",
    "token": "abc123"
  }
]
```

- `token` 为明文，启动时计算 SHA256 哈希入库。
- `token` 必须为 ASCII 字符（HTTP 头约束）；非 ASCII 的 token 条目跳过并记入审计日志。
- 对齐规则（按 userId upsert）：
  - 用户存在 → 盲写 `nickname` 与 `token_hash`（不比较旧值）；
  - 用户不存在 → 插入；
  - **不删除** json 中缺失的用户。
- `userId` 必须非空且在 json 内唯一；非法/重复条目跳过并记入审计日志。
- json 解析失败 → 记审计日志并跳过，不影响启动。

## 5. 前端架构与缓存策略

### 5.1 组件结构

- 根组件：登录页、发布框、分页、全屏大图（lightbox）、确认弹窗；通过 `provide('app', ...)` 向卡片提供共享状态与函数。
- `PostCard` 组件：一张帖子的完整卡片（头像/正文/图片网格/卡片内大图/评论），持有卡片级图片缓存。

### 5.2 缓存作用域

媒体经 Bearer 鉴权，`<img>` 无法携带请求头，图片必须走 `fetch → Blob → URL.createObjectURL` 转成本地 URL 显示；该 URL 必须由某个作用域持有（这是异步 fetch 与同步渲染之间的“桥”，也是媒体鉴权引入的核心复杂度）。分三层：

| 层级        | 作用域             | 内容                                   | 生命周期                                                   |
| ----------- | ------------------ | -------------------------------------- | ---------------------------------------------------------- |
| 卡片级      | 单个 `PostCard`    | `sha@mode` → blob URL（缩略图 + 原图） | 卡片卸载时整体 revoke + clear                              |
| 全屏会话级  | 一次全屏打开到关闭 | 原图 sha → blob URL                    | 关闭时 revoke + clear（含在途集合）                        |
| 浏览器 HTTP | 整个浏览器         | 原图/缩略图响应                        | 后端 `Cache-Control: private, max-age=31536000, immutable` |

### 5.3 关键约定

- `openLightbox` 传递图片**索引**而非 sha（序列允许重复 sha，用 sha 反查会命中第一个副本，导致定位错误）。
- 加载失败在缓存中记 `''`，本次作用域内不再重试；作用域销毁后自然恢复重试。
- 全屏关闭时必须同时清空“在途”集合，否则重开同一张图不会重新发起请求。
- 前端静态资源通过 `index.html` 中 `?v=` 手动递增版本号；`index.html` 本身 `no-cache`。
- 复制链接等轻量反馈使用顶部 toast（非阻塞），不再使用弹窗。

### 5.4 路由与页面

前端无路由库，按 `location.pathname` 判断视图，页面间用整页跳转（`location.replace`）：

| 路径              | 页面     | 说明                                                                                          |
| ----------------- | -------- | --------------------------------------------------------------------------------------------- |
| `/auth`           | 登录页   | 未认证访问其他路径 → 302 到 `/auth?next=<原路径>`；已认证访问 `/auth` → 跳到 `next` 或 `/`    |
| `/`               | 动态流   | 登录后主页（发布框 + 分页 + 帖子卡片）                                                        |
| `/posts/{postId}` | 单动态页 | 复用 PostCard，拉取单帖 + 评论；隐藏发布框/分页；顶部为全宽返回条（无品牌标题），提供返回链接 |

- 未认证时非 `/auth` 路径一律重定向到 `/auth`（带 `next` 回跳）；认证失败同样重定向。
- SPA 路由由后端 `MapFallbackToFile("index.html")` 兜底；所有无扩展名路径的 HTML 响应 `no-cache`。
- 帖子菜单“复制链接”生成 `{origin}/posts/{postId}`。
