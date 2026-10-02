# 架构说明 · Architecture

## 一句话概括

一个**配置驱动的 GxP 合规内核**，加一组领域模块，加一个零依赖的中英双语界面。

## 为什么是"配置驱动"

GxP 各领域的合规义务形态高度同构。把差异抽象掉之后，剩下的共性是一个状态机：

```
受控记录 = 一串有顺序、有角色门槛、部分需签名的步骤
```

| 领域 | 记录 | 步骤特征 |
|---|---|---|
| GMP 偏差 | DEV-2026-0001 | 报告 → 遏制 → 调查 → CAPA 判定 → QA 关闭 → 有效性 |
| GMP CAPA | CAPA-2026-0001 | 根本原因 → 计划批准 → 实施 → 有效性 → 关闭 |
| GMP 变更控制 | CC-2026-0001 | 申请 → 影响评估 → QA 批准 → 实施 → 验证 → 关闭 |
| GLP 研究偏离 | GLPF-2026-0001 | 记录 → 通知 QA → 影响评估 → 纠正预防 → QA 关闭 |
| GCP 方案偏离 | PD-2026-0001 | 识别 → 影响评估 → 报告通报 → CAPA → 关闭 |
| GVP 个例报告 | AE-2026-0001 | 接收 → 分类时限 → 医学审核 → 提交 → 随访 → 结案 |

它们的差别只在**步骤数量、步骤名称、角色、签名含义、表单字段**。因此：

> **新增一个 GxP 领域 = 往 `seed/workflows/` 放一个 JSON 文件。不写代码。**

`src/domain/workflow.js` 是全系统唯一的状态机。它读 `process_types.definitions_json`，
校验定义合法性（步骤码不重复、目标状态存在、初始状态合法），并物化步骤清单。

### 流程定义的能力

```jsonc
{
  "code": "DEV", "recordPrefix": "DEV",
  "gxpAreas": ["GMP", "GLP", "GCP", "GDP"],
  "regulationRefs": ["EU GMP Chapter 1.4(x) ..."],
  "slaDays": 30,
  "states": ["draft", "reported", ..., "closed"],
  "initialState": "draft",
  "terminalStates": ["closed", "cancelled", "rejected"],
  "fields": [ /* 定义驱动的表单，含 label/labelEn/type/required/help */ ],
  "steps": [
    {
      "code": "investigation", "name": "原因调查", "nameEn": "Investigation",
      "role": ["qa_specialist", "qc_manager"],        // 角色门槛（数组）
      "type": "task",
      "onComplete": "in_assessment",                   // 完成后流转到的状态
      "signatureMeaning": "approved",                  // 有此字段则强制电子签名
      "independentOfAuthor": true,                     // 作者本人不得执行
      "requiresFields": ["rootCause"],                 // 强制填写的字段
      "persistFields": { "root_cause": "rootCause" },  // 表单字段落到实例列
      "form": [ /* 步骤专属表单 */ ],
      "guidance": "给操作者的指引"
    }
  ]
}
```

## 分层

```
┌──────────────────────────────────────────────────────────────┐
│  web/   原生 JS SPA，中英双语，零依赖，无构建步骤              │
│         index.html → i18n → api → ui → views/* → app          │
└───────────────────────────┬──────────────────────────────────┘
                            │ REST (JSON, cookie session)
┌───────────────────────────▼──────────────────────────────────┐
│  src/api/   routes.js  每个路由声明所需权限                    │
│             server.js  静态文件 + JSON API，node:http          │
├──────────────────────────────────────────────────────────────┤
│  src/domain/  领域模块（业务规则从这里开始）                   │
│    workflow   documents   inspections   training             │
│    equipment  dashboard                                       │
├──────────────────────────────────────────────────────────────┤
│  src/core/    合规内核（所有领域共用）★                        │
│    db         SQLite schema（含防篡改触发器）                  │
│    audit      只可追加哈希链 ★★                                │
│    auth       认证 / 会话 / 电子签名 ★★                        │
│    rbac       21 角色权限矩阵                                  │
│    crypto     scrypt / TOTP / 规范化 JSON 哈希                 │
└───────────────────────────┬──────────────────────────────────┘
                            │ node:sqlite（内置，无依赖）
                     data/gxp.db  +  data/audit-chain.key
```

## 合规内核的三个关键机制

### 1. 哈希链审计追踪（`src/core/audit.js`）

每行存储 `chain_hash = HMAC(key, prev_hash ‖ canonical(payload))`。

**为什么用 HMAC 而不是普通 SHA-256：** 密钥存在数据库之外（`data/audit-chain.key`）。
因此即使有人拿到数据库文件、自己重算整条链，也无法产出能通过校验的链。
普通哈希链做不到这一点——攻击者可以重算。

三层防护：

| 攻击方式 | 防护 | 验证结果 |
|---|---|---|
| 直接 `UPDATE audit_trail` | SQLite 触发器 `RAISE(ABORT)` | 被拒绝 |
| 绕过触发器改数据库文件 | 遍历重算比对摘要 | 精确定位到断点 seq |
| 复制数据库重算整条链 | HMAC 密钥在库外 | 无法伪造 |

**规范化 JSON：** payload 序列化前对 key 排序、字符串做 NFKC 归一化，
因此哈希与字段顺序无关，跨平台稳定。

**历史重建：** `reconstruct(recordKey, version)` 从 `old_value`/`new_value` 的增量
反向重放，可单独从审计链重建任一历史版本——这是 ALCOA+ "Enduring/Available" 的技术证明。

### 2. 双分量电子签名（`src/core/auth.js`）

21 CFR Part 11.200(a)(1)(i) 要求签名使用**至少两个不同的识别要素**。

```
分量 A：识别码（用户名）+ 密码   —— 签署时重新输入，不使用已登录会话
分量 B：TOTP 动态口令  或  服务端签发的一次性挑战码
```

**为什么不用"已登录会话 + 点击批准"：** 那只有一个分量（会话），不满足法规。

挑战码机制：`POST /api/signatures/challenge` 签发随机 nonce，TTL 120 秒，**一次性消费**
（`used_at` 标记），使用后立即失效。e2e 测试专门验证了重放攻击被拒绝。

签名记录姓名、时间、含义（封闭枚举，防止自由文本模糊化）、理由，
并通过 `entity_type`/`entity_id`/`record_key` 与记录永久关联，同时镜像到审计追踪。

### 3. 职责分离（`src/core/rbac.js` + `workflow.js`）

三道门，全部在服务端：

1. **路由权限** —— 每个路由声明 `permission`，无权限返回 403 并记入审计追踪
2. **步骤角色门** —— `step.assignee_role` 数组不含当前角色则 403
3. **独立性门** —— `independentOfAuthor: true` 的步骤拒绝记录作者本人

此外：系统管理员不得作为 GxP 记录的唯一批准人（`rbac.canSign` 的
`ADMIN_CANNOT_APPROVE`）。

## 就绪度评分模型（`src/domain/inspections.js`）

```
readiness_score = Σ(风险权重 × 判定权重) / Σ(风险权重) × 100
风险权重：critical = 10, major = 4, minor = 1
判定权重：compliant = 1, partial = 0.5, gap = 0,
         not_applicable / not_assessed = 不计入
```

**设计取舍：** 该分数是**排序工具，不是合规判定**。"不适用"与"未评估"不计入分母，
因此只评估了一半的检查表不会因为分母小而得到虚高分。

`readinessDashboard()` 进一步把五类证据汇成带**具名阻碍项**的评分：

1. 未关闭的检查缺陷（critical 直接扣 25 分）
2. 文件审核欠账
3. 培训过期/超期
4. 校准超期
5. 质量记录超期
6. 审计链完整性（失败则置顶，因为其他一切都失去意义）

## 前端设计

**零依赖、无构建步骤。** `index.html` 按顺序加载脚本，`window.Views.register()` 注册视图。

合规相关的 UI 决策：

- **所有标识符、日期、哈希用等宽字体** —— 审计时可以电话里念清楚
- **颜色永不作为唯一信息载体** —— 每个色彩提示都配文字标签，界面黑白打印仍然可读
  （检查证据常常是被打印出来的）
- **签名对话框不可用点击遮罩关闭** —— 避免误点丢弃已填写一半的签署声明
- **密码在提交后立即从 DOM 清除** —— 不在表单里残留凭证
- **凭证被拒时强制重新获取挑战码** —— 已消费的挑战码不可重试

## 已知取舍与不做的事

| 取舍 | 原因 |
|---|---|
| 配置库（JSON）不打进 exe | 站点需要能不重新构建就新增领域；代价是 exe 需同级目录 |
| 单文件 exe 需要联网取 `postject` | 离线构建时如实降级为便携文件夹，不产出半成品 exe |
| 不做电子签名的生物特征分量 | 浏览器环境无法可靠实现；用 TOTP/挑战码满足"两个分量" |
| 不做数据库级加密 | SQLite 加密需第三方扩展，与零依赖冲突；用文件系统权限控制 |
| 阅读器不接受外部审计员以外的只读审计 | 审计追踪查阅本身是受控行为，会记录 `view` 事件 |

## 扩展点

| 想做什么 | 改哪里 |
|---|---|
| 新增 GxP 领域（如 GSP、GPP） | `src/seed.js` 的 `GXP_AREAS` + 新增 workflow JSON |
| 新增流程类型 | 往 `seed/workflows/` 加 JSON，重启即生效 |
| 新增法规检查表 | 往 `seed/checklists/` 加 JSON，重启即生效 |
| 新增角色 | `src/core/rbac.js` 的 `ROLES` |
| 自定义"合格"判定词 | `src/domain/equipment.js` 的 `PASS_RESULTS` |
| 调安全策略 | 界面「系统设置」页，或环境变量 |
| 对接企业 SSO | `src/core/auth.js` 的 `login()`，替换为令牌校验 |
| 对接 LIMS/ERP | 用 `POST /api/records` 与 `sourceEntityType`/`sourceEntityId` 建立追溯链接 |
