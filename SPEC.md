# 设计规范

## 1. API

说明：错误响应统一使用 ErrorBody（见 2.2）。

### 1.1. 用户

说明：用户与登录 token 由管理员手动预设，无注册/管理接口。

| 方法 | 路径 | 请求体 | 响应体 | 鉴权 | 说明 |
| ---- | ---- | ------ | ------ | ---- | ---- |
| POST | /api/login | 无 | LoginResult | Bearer token | 400 空 token；401 无效 token |

### 1.2. 帖子

说明：前端依据 metadata 的 totalCount 计算总页数并做页导航，列表接口不返回 hasMore。

| 方法 | 路径 | 请求体 | 响应体 | 鉴权 | 说明 |
| ---- | ---- | ------ | ------ | ---- | ---- |
| POST | /api/posts | CreatePostRequest | PostDto | Bearer token | textContent 与 mediaContent 都为空返回 400；textContent 最多 10000 字；mediaContent 元素须为已上传的 SHA256（编辑阶段先经 POST /api/media 上传，由后端计算返回），重复元素原样保留，存在未上传元素返回 400；成功 201，Location 指回帖子；401（未登录） |
| GET | /api/posts/metadata | 无 | PostMetadata | Bearer token | totalCount 为有效（未删除）帖子总数；401（未登录） |
| GET | /api/posts | 无 | PostList | Bearer token | page 从 1 开始，每页 10 条有效帖子，按创建时间倒序；page 小于等于 0 返回第一页，大于最大页返回最后一页；401（未登录） |
| GET | /api/posts/{postId} | 无 | PostDto | Bearer token | 404 帖子不存在（含 is_deleted=1）；401（未登录） |
| POST | /api/posts/{postId}/comments | CreateCommentRequest | CommentDto | Bearer token | content 最多 500 字；404 帖子不存在；401（未登录） |
| GET | /api/posts/{postId}/comments | 无 | CommentList | Bearer token | 只返回有效评论，按创建时间倒序；404 帖子不存在；401（未登录） |
| DELETE | /api/posts/{postId} | 无 | 无（204） | Bearer token | 仅作者可删，非作者返回 403；逻辑删除（is_deleted=1），删除后列表/详情不再返回；其评论与媒体文件保留；404 帖子不存在；401（未登录） |

### 1.3. 媒体文件

说明：媒体文件为引用共享（多条帖子可引用同一 sha256），删除帖子/评论不会删除媒体文件。

| 方法 | 路径 | 请求体 | 响应体 | 鉴权 | 说明 |
| ---- | ---- | ------ | ------ | ---- | ---- |
| GET | /media/{sha256} | 无 | 文件流 | Bearer token | 404 媒体不存在；401（未登录）；前端需带 Bearer token 用 fetch 获取 blob 后显示（`<img>` 无法携带请求头） |
| POST | /api/media | multipart：file | MediaDto | Bearer token | 仅支持 jpg/jpeg/png/gif/webp/bmp，大小不超过 20MB；sha256 由后端计算，相同内容重复上传复用已有记录；400 类型或大小不符；401（未登录） |

### 1.4. 评论

| 方法 | 路径 | 请求体 | 响应体 | 鉴权 | 说明 |
| ---- | ---- | ------ | ------ | ---- | ---- |
| DELETE | /api/comments/{commentId} | 无 | 无（204） | Bearer token | 仅作者可删，非作者返回 403；逻辑删除（is_deleted=1），删除后评论列表不再返回；404 评论不存在；401（未登录） |

## 2. DTO 定义

### 2.1. 请求体

#### CreatePostRequest

```json
{
    "textContent": "今天天气不错",
    "mediaContent": [
        "<media sha256>"
    ]
}
```

- `textContent`：可选，最多 10000 字
- `mediaContent`：可选，元素为文件内容的 SHA256；编辑阶段先上传图片（POST /api/media），由后端计算并返回；发帖时元素须已上传，重复元素原样保留

#### CreateCommentRequest

```json
{
    "content": "写得好"
}
```

- `content`：必填，最多 500 字

### 2.2. 响应体

#### ErrorBody

```json
{
    "code": 400,
    "message": "message"
}
```

- `code`：与 HTTP 状态码一致
- `message`：错误描述

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
        "<media sha256>"
    ],
    "createdAt": 1724227200
}
```

#### PostList

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

#### PostMetadata

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
    "url": "/media/<sha256>"
}
```

## 3. 数据存储

### 3.1. 基本存储方案

| 名称    | 类型          | 作用                                                            |
| ------- | ------------- | --------------------------------------------------------------- |
| data.db | sqlite 数据库 | 存储主要数据，包括用户/帖子/回复/媒体文件元数据                 |
| static/ | 目录          | 存储静态文件，例如媒体文件，采用二级哈希结构，如 /ef/ac/efac... |

### 3.2. 表定义

**用户 (user):**

| 字段       | 类型    | 说明                        |
| ---------- | ------- | --------------------------- |
| id         | INTEGER | 自增主键                    |
| user_id    | TEXT    | 用户唯一 id，为 uuidv4      |
| nickname   | TEXT    | 用户的昵称                  |
| token_hash | TEXT    | 登录 token 的 SHA256 哈希值 |

**帖子 (post):**

| 字段          | 类型    | 说明                                                             |
| ------------- | ------- | ---------------------------------------------------------------- |
| id            | INTEGER | 自增主键                                                         |
| post_id       | TEXT    | post 的 id，为 uuidv4                                            |
| user_id       | TEXT    | 发布者的 user_id                                                 |
| text_content  | TEXT    | 文字内容                                                         |
| media_content | TEXT    | 媒体文件内容，为 json 列表，每个元素为 media 的 sha256，有顺序性 |
| created_at    | INTEGER | 发布时间，为 unix 秒级时间戳，使用 UTC 0                         |
| is_deleted    | INTEGER | 0/1，指示 post 是否被删除                                        |

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
