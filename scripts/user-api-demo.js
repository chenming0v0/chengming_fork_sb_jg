import fs from 'node:fs';
import path from 'node:path';

// 基础访问地址，可通过环境变量 BASE_URL 覆盖
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8000';
// 简单的 Cookie 存储，方便复用会话
let cookieJar = '';
// CSRF Token 会在获取后保存在这里
let csrfToken = '';

// 从响应头提取 Set-Cookie 并更新 cookieJar，确保后续请求复用同一会话
function updateCookies(response) {
    const getSetCookie = response.headers.getSetCookie?.();
    const raw = response.headers.raw?.();
    const cookies = getSetCookie ?? raw?.['set-cookie'] ?? [];
    if (cookies.length > 0) {
        cookieJar = cookies.map((c) => c.split(';')[0]).join('; ');
    }
}

// 通用的 JSON POST 请求封装，自动带上 Cookie 与 CSRF Token
async function jsonRequest(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: cookieJar,
            'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(body),
    });

    updateCookies(response);
    let data;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    return { status: response.status, data, headers: Object.fromEntries(response.headers.entries()) };
}

// 下载指定用户的备份到指定路径，返回状态与字节数
async function downloadBackup(handle, outputPath) {
    const response = await fetch(`${baseUrl}/api/users/backup`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: cookieJar,
            'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ handle }),
    });

    updateCookies(response);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    return { status: response.status, bytes: buffer.length, headers: Object.fromEntries(response.headers.entries()) };
}

// 简化的日志输出，既显示标题也展示具体 JSON 数据
function logStep(title, payload) {
    console.log(`\n### ${title}`);
    console.log(JSON.stringify(payload, null, 2));
}

// 获取 CSRF Token 并保存，便于后续受保护的接口调用
async function fetchCsrfToken() {
    const response = await fetch(`${baseUrl}/csrf-token`, {
        method: 'GET',
        headers: {
            cookie: cookieJar,
        },
    });

    updateCookies(response);
    const body = await response.json();
    csrfToken = body?.token || '';
    return { status: response.status, token: csrfToken, headers: Object.fromEntries(response.headers.entries()) };
}

// 生成唯一用户名，避免与已有账号冲突
const newHandle = `demo-${Date.now()}`;

console.log(`Base URL: ${baseUrl}`);

// 1) 获取 CSRF Token
const csrfResult = await fetchCsrfToken();
logStep('获取 CSRF Token', csrfResult);

// 2) 使用默认管理员账号登录（默认无密码）
const loginResult = await jsonRequest('/api/users/login', { handle: 'default-user' });
logStep('管理员登录 default-user', loginResult);

// 3) 创建一个演示用户，初始密码为 P@ssw0rd!
const createResult = await jsonRequest('/api/users/create', {
    handle: newHandle,
    name: '演示用户',
    password: 'P@ssw0rd!',
    admin: false,
});
logStep('创建用户', { request: { handle: newHandle }, response: createResult });

// 4) 将该用户密码修改为新的口令
const changePasswordResult = await jsonRequest('/api/users/change-password', {
    handle: newHandle,
    oldPassword: '',
    newPassword: 'NewerP@ssw0rd!',
});
logStep('修改密码', { request: { handle: newHandle }, response: changePasswordResult });

// 5) 下载该用户的备份 ZIP 文件
const backupPath = `./backups/${newHandle}.zip`;
const backupResult = await downloadBackup(newHandle, backupPath);
logStep('下载备份', { request: { handle: newHandle }, response: backupResult, savedTo: backupPath });

console.log('\n脚本执行完成。');
