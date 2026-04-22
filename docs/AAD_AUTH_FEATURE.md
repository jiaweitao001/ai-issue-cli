# Feature: Azure AD 认证（通过 Azure CLI）

> 组内成员通过 Azure CLI 自动获得后端服务访问权限，无需手动分发 API key。

## 工作原理

```
用户执行 ai-issue 命令（如 triage, solve 等）
  → CLI 自动执行 az account get-access-token
  → 获取 AAD access token
  → 请求带 Authorization: Bearer <token>
  → 后端验证 JWT
  → 完成
```

**用户无需任何额外操作**，只要已安装 Azure CLI 且执行过 `az login`。

## 前置条件

```bash
# 安装 Azure CLI（如未安装）
# macOS
brew install azure-cli

# 登录（一次性，token 有效期 ~90 天）
az login
```

## 认证优先级

| 优先级 | 方式 | 条件 |
|---|---|---|
| 1 | Azure CLI Bearer token | `az` 已安装且已登录 |
| 2 | API key（兜底） | config 中配置了 `serviceApiKey` |

完全向后兼容：未安装 Azure CLI 的用户可继续使用 API key。

## 实现细节

### `lib/az-token.js`

- 执行 `az account get-access-token --output json` 获取 token
- 内存缓存 token，过期前 2 分钟自动刷新
- 错误处理：az 未安装 → 提示安装链接；未登录 → 提示 `az login`

### `lib/service-client.js`

- `resolveAuthHeaders()` 按优先级解析认证 header
- `serviceRequest` 和 `serviceRequestStream` 均使用该函数

## 后端对接要求

后端（ai-issue-service）需要：

1. 接受 `Authorization: Bearer <token>` 的 JWT
2. 从 AAD JWKS endpoint 获取公钥验证签名
3. 验证 `tid`（tenant ID）属于组织
4. 继续支持 `X-Api-Key` 认证（并存）

## 调试

```bash
# 验证 az token 可用
az account get-access-token --output json

# 开启 debug 查看认证方式
AI_ISSUE_DEBUG=true ai-issue triage 12345
# 输出: "Using Azure CLI Bearer token for service auth"
# 或:   "Falling back to API key for service auth"
```
