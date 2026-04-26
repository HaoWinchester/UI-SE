# Skill Pack

`UI-SE` 最适合沉淀成一个“多 skill 交付包”，而不是单个大而全 skill。

## 拆分原则

- **skill 负责方法论**
  写清楚一个 agent 在什么场景触发、读什么输入、怎样输出结果、如何和上下游交接。
- **代码负责执行**
  包括 orchestrator、Stitch SDK、文件落盘、数据库执行、测试运行、日志与预览服务。

## 当前建议的 skill 套件

| Skill | 作用 | 是否已落库 |
| --- | --- | --- |
| `spec-agent` | 需求澄清、feature 切片、验收标准 | 是 |
| `ui-agent` | Stitch prompt 组织与 UI 版本生成约束 | 是 |
| `frontend-agent` | 前端代码生成与 UI 对齐 | 是 |
| `backend-agent` | 后端接口、校验、服务层生成 | 是 |
| `db-agent` | Prisma + PostgreSQL schema / migration / seed / repository | 是 |
| `test-agent` | 测试结果解释与修复分流 | 是 |
| `fix-agent` | bug / 偏航 finding 定向修复 | 是 |
| `monitor-agent` | 需求对齐检查 | 是 |
| `acceptance-agent` | 客户预览前的最终可演示性判断 | 是 |
| `deploy-agent` | 发布决策 | 是 |

## 项目与 skill 的边界

下面这些仍然应该留在项目代码中：

- `src/workflow/orchestrator.ts`
- `src/tools/stitch-client.ts`
- `src/tools/repo-writer.ts`
- `src/tools/test-runner.ts`
- `src/tools/database-runner.ts`
- `src/tools/customer-preview.ts`
- `src/tools/dashboard-builder.ts`

原因很简单：这些能力是**确定性执行系统**，不是提示词手册。

## 复用方式

如果后面你想把这套东西迁移到别的仓库，推荐顺序：

1. 复制 `skills/` 下对应的 agent skill
2. 复制 `src/tools` 中需要的执行层
3. 复制或重写 `src/workflow/orchestrator.ts`
4. 再按目标项目的目录结构调整 `readScopes` / `writeScopes`

## V3 补强

当前仓库已经补上两类更适合持续迭代的材料：

1. 每个核心 skill 都补了更明确的“示例输入 / 示例输出”
2. 在 [evals/evals.json](../evals/evals.json) 里放了一份初版评测集，用来验证不同 prompt 下的主要触发角色和预期行为

后面如果要继续升级，优先顺序建议是：

1. 为 `evals` 增加断言
2. 跑真实评测并回看触发偏差
3. 再针对命中率低的 skill 重写 description 或工作流说明
