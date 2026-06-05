# AI Proxy

通用 API 反向代理服务，部署在 [Vercel](https://vercel.com) 平台。将请求透明转发到目标 API，同时剥离调用方身份信息（IP、UA、Cookie 等），保护客户端隐私。

## 功能

- **透明转发**：原样转发请求方法、路径、查询参数和 Body（JSON / Buffer / 文本）
- **隐私剥离**：彻底移除调用方的 IP、User-Agent、Cookie、Referer、浏览器指纹等识别信息
- **CORS 支持**：内置跨域头，支持浏览器直接调用，OPTIONS 预检请求直接返回 204
- **零依赖**：使用 Node.js 原生 `fetch`，无需安装任何 npm 包
- **配置文件驱动**：修改目标域名和部署区域只需编辑 `config.json`

## 项目结构

```
├── api/
│   └── index.js      # 代理核心逻辑（Vercel Serverless Function）
├── config.json        # 配置文件（目标 URL、部署区域）
├── vercel.json        # Vercel 部署配置（路由重写、函数区域）
└── package.json
```

## 实现细节

### 请求处理流程

```
客户端 → Vercel 域名 → rewrite → api/index.js → 目标 API
```

1. **路由重写**（`vercel.json`）：所有请求 `/(.*)` 统一路由到 `api/index.js`
2. **路径恢复**：从 `x-forwarded-path` header 恢复原始请求路径
3. **Header 清洗**：剥离以下类别的 header 后转发：
   - IP 链：`x-forwarded-for`、`x-real-ip`、`true-client-ip`、`cf-connecting-ip`、`forwarded`
   - Vercel 平台：`x-vercel-*`、`x-now-*`
   - Cloudflare：`cf-*`
   - 浏览器指纹：`sec-fetch-*`、`sec-ch-ua*`、`referer`、`origin`、`cookie`
   - 链路追踪：`via`、`x-request-id`、`x-trace-id`
   - User-Agent 替换为固定值 `Vercel-Proxy/1.0`
4. **请求转发**：使用原生 `fetch` 发送请求到目标 API
5. **响应回传**：将目标 API 的状态码、响应头和 Body 返回给客户端

### Body 处理

- `Buffer` / `string` 类型 → 原样转发
- `Object` 类型 → `JSON.stringify` 后转发
- GET / HEAD / OPTIONS → 不发送 Body

### 环境

- **运行时**：Node.js 24 LTS（Vercel Fluid Compute）
- **区域**：`config.json` 中配置（默认 `hnd1` 东京）

## 配置

编辑 `config.json`：

```json
{
  "target_url": "https://your-target-api.com",
  "region": "hnd1"
}
```

| 字段 | 说明 |
|------|------|
| `target_url` | 要代理的目标 API 地址 |
| `region` | Vercel 函数部署区域（需与 `vercel.json` 中保持一致） |

## 部署

### 方式一：GitHub 集成（推荐）

1. 将代码推送到 GitHub 仓库
2. 打开 [vercel.com/new](https://vercel.com/new)
3. 导入 GitHub 仓库，Vercel 自动识别项目类型
4. 无需设置环境变量（配置已在 `config.json` 中）
5. 点击 **Deploy**，完成

之后每次 `git push`，Vercel 自动重新部署。

### 方式二：CLI 部署

```bash
npm i -g vercel
vercel login
vercel            # 预览部署
vercel --prod     # 生产部署
```

## 使用示例

假设部署域名为 `https://ai-proxy.vercel.app`，目标 API 为 `https://api.openai.com`：

```bash
# 原始请求
curl https://api.openai.com/v1/chat/completions

# 通过代理请求（路径 /v1/chat/completions 会被保留转发）
curl https://ai-proxy.vercel.app/v1/chat/completions
```

浏览器端：

```js
fetch('https://ai-proxy.vercel.app/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-xxx' },
  body: JSON.stringify({ model: 'gpt-4', messages: [...] })
})
```

## 注意事项

- **CORS**：当前 `Access-Control-Allow-Origin` 设为 `*`，生产环境建议改为具体域名
- **认证透传**：`Authorization` header 会原样转发，确保客户端传入有效的 API Key
- **流式响应**：当前为缓冲模式，大响应会完全读入内存后再返回；如需 SSE 流式转发需额外改造
- **区域同步**：修改部署区域时，`config.json` 的 `region` 和 `vercel.json` 的 `regions` 需同步更新（Vercel 平台限制，函数区域必须在部署配置中声明）
- **超时**：Vercel Functions 默认超时 300s，长请求需注意
