# 用户管理 API 速查

以下示例假设服务器运行在 `http://127.0.0.1:8000`。

## 登录以获取会话
大多数用户/管理员接口依赖会话 Cookie。先调用 **POST `/api/users/login`**。

- 请求体
  ```json
  {
    "handle": "user-handle",
    "password": "optional-password"
  }
  ```
- 成功：`200 OK`，响应 `{ "handle": "user-handle" }`，并在响应头中设置会话 Cookie。
- 失败：`400`（缺少 handle）、`403`（凭据错误或用户被禁用）、`429`（频率限制）。

### 如何获取管理员权限

- 新安装时，如还没有任何用户，会自动创建一个默认管理员账号：`handle` 为 `default-user`，没有密码。可直接调用上面的登录接口获取管理员会话 Cookie。
- 出于安全考虑，建议给管理员设置密码：
  - 已登录时：用 **POST `/api/users/change-password`**，`handle` 设为目标管理员，`oldPassword` 按需填写，`newPassword` 写入新密码。
  - 未登录或遗忘密码时：在仓库根目录执行 `node recover.js <管理员账号> <新密码>`（需要 `config.yaml` 中配置了 `dataRoot`），脚本会直接写入新密码并确保账号启用。
  - 如果希望使用自定义管理员账号，可先登录默认管理员，调用 **POST `/api/users/create`** 创建一个带 `"admin": true` 的新账号，再为其设置密码。

## 创建用户（仅管理员）
`POST /api/users/create`

- 需要管理员会话。
- 请求体
  ```json
  {
    "handle": "new-user",
    "name": "显示名称",
    "password": "optional-password",
    "admin": false
  }
  ```
  `handle` 会被转成 slug 且必须唯一。`password` 可以留空，表示创建无密码账号。
- 成功：`200 OK`，响应 `{ "handle": "new-user" }`。
- 失败：`400`（字段缺失或格式错误）、`409`（handle 已存在）。

## 修改密码
`POST /api/users/change-password`

- 需要登录；管理员可修改任意账号，普通用户只能修改自己。
- 请求体
  ```json
  {
    "handle": "target-user",
    "oldPassword": "当前密码，如账号需要",
    "newPassword": "新密码，留空表示移除密码"
  }
  ```
  - 非管理员在当前账号有密码时必须提供 `oldPassword`。
  - `newPassword` 设为空字符串即可移除密码。
- 成功：`204 No Content`。
- 失败：`400`（缺少 handle）、`403`（无权限/密码错误/用户被禁用）、`404`（用户不存在）。

## 下载用户备份
`POST /api/users/backup`

- 需要登录；管理员可备份任意账号，普通用户只能备份自己。
- 请求体
  ```json
  {
    "handle": "user-to-back-up"
  }
  ```
- 成功：以 ZIP 附件流式返回，文件名形如 `<handle>-<timestamp>.zip`，包含该用户数据。
- 失败：`400`（缺少 handle）、`403`（无权限）。

## 路由前缀
上述路由均挂载在 `/api/users` 下。
