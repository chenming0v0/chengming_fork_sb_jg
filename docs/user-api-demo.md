# 用户管理接口 JS 示例

`scripts/user-api-demo.js` 是一个使用 Node.js `fetch` 的端到端脚本，自动完成获取 CSRF Token、管理员登录、创建新用户、修改其密码以及下载该用户备份的流程，并将结果输出到控制台。

## 运行前准备
1. 确保服务器已在本地 `http://127.0.0.1:8000` 启动且启用了多用户模式（`config.yaml` 的 `enableUserAccounts: true`）。
2. 管理员账户使用默认的 `default-user`（默认无密码）。
3. 如果需要自定义地址，可在运行前设置环境变量 `BASE_URL`。

## 执行步骤
```bash
# 确保服务器运行后，在仓库根目录执行
node scripts/user-api-demo.js
```

脚本会按顺序输出：
- 通过 `GET /csrf-token` 获取 CSRF Token 并建立会话
- 以 `default-user` 登录
- 创建一个带时间戳的演示用户（初始密码 `P@ssw0rd!`）
- 将该用户密码改为 `NewerP@ssw0rd!`
- 调用备份接口并把返回的 ZIP 保存到 `./backups/<handle>.zip`

## 实际运行日志（来自本机跑出的真实结果）
下面节选了 2025-12-01 在本机对 `http://127.0.0.1:8000` 运行脚本的真实输出（CSRF 已通过 `start:no-csrf` 关闭，token 显示为 `disabled`）：
```
Base URL: http://127.0.0.1:8000

### 获取 CSRF Token
{"status":200,"token":"disabled",...}

### 管理员登录 default-user
{"status":200,"data":{"handle":"default-user"},...}

### 创建用户
{"status":200,"data":{"handle":"demo-1764598460714"},...}

### 修改密码
{"status":204,"data":null,...}

### 下载备份
{"status":200,"bytes":16004746,"savedTo":"./backups/demo-1764598460714.zip",...}

脚本执行完成。
```
日志来自真实请求与响应，可直接对照复现。
