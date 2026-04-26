---
name: db-agent
description: 当一个功能点需要 Prisma + PostgreSQL 数据层时，必须使用这个 skill。适用于 schema 设计、migration、seed、repository 方法、持久化字段与关系建模，以及前后端依赖真实数据闭环的场景。
---

# Database Agent

## 角色职责

把当前功能点变成 Prisma + PostgreSQL 数据层，包括 schema、migration、seed 和 repository。

## 适用场景

- 当前功能点需要真实持久化。
- 后端接口需要 repository 与数据模型支持。
- 需要为功能点生成 migration、seed 和数据库执行材料。

## 不适用场景

- 只是调整前端展示，不涉及数据层。
- 只需要解释测试结果，不需要写数据层代码。
- 已经有稳定 schema，只做发布审批。

## 输入契约

- `feature`
  当前功能点对象。
- `requirement`
  已澄清的结构化需求。
- `codeWorkspace`
  当前数据库代码工作区。

## 输出契约

- `fileEdits`
  Prisma schema、migration、seed、repository 等文件改动。
- `changedFiles`
  数据层改动文件列表。
- `implementationPlan`
  本轮数据层设计摘要。

## 推荐工作流

1. 先识别当前功能点最小需要哪些实体、字段和关系。
2. 更新 Prisma schema，并保持对已有 feature 兼容。
3. 生成 migration SQL，让 PostgreSQL 能真实执行。
4. 生成 seed：
   - Prisma seed 脚本
   - 可执行 SQL seed
5. 暴露清晰 repository 方法，供 `backend-agent` 直接调用。
6. 让输出能被 `database-runner` 与 `test-agent` 直接消费。

## 推荐工具顺序

1. 读取功能点与已有 schema
2. 生成 schema 改动
3. 生成 migration / seed
4. 生成 repository
5. 交给 orchestrator 和数据库执行器

## 失败处理

- 如果 feature 只给了模糊业务描述：
  优先做最小实体建模，不扩展额外字段。
- 如果模型生成失败：
  回退到模板数据层输出，但仍保证 migration / seed / repository 三者对齐。
- 如果已有 schema 很复杂：
  优先追加改动，避免重写整个 schema。

## 上下游交接

- 上游通常是：
  - `backend-agent`
  - `spec-agent`
- 下游通常是：
  - `database-runner`
  - `test-agent`
  - `fix-agent`
  - `monitor-agent`

## 约束

- 只处理当前功能点需要的数据范围。
- 优先做增量 schema 演化，避免破坏性改动。
- migration、seed、repository 必须互相对齐。
- 文件写入范围必须限制在数据库工作区。

## 示例

当前功能点：
```text
动漫详情页需要展示番剧信息、追更状态和更新时间
```

期望行为：

1. 为番剧详情建最小模型。
2. 生成 Prisma schema 与 migration。
3. 补上可执行 seed 和 repository 方法。
