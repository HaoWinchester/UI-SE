# Skills 目录说明

这个项目不建议抽成“一个总 skill”，更适合抽成一组彼此协作的 agent skill。

## 推荐拆分

- `spec-agent`
  负责把一句话需求澄清成结构化 spec，并为后续 Stitch / 开发阶段提供边界。
- `ui-agent`
  负责把已批准的 spec 组织成更适合 Stitch 使用的 prompt。
- `frontend-agent`
  负责把已批准的 UI 和当前功能点变成前端代码改动。
- `backend-agent`
  负责把当前功能点变成后端接口、契约、校验和服务层改动。
- `db-agent`
  负责 Prisma + PostgreSQL 的 schema、migration、seed、repository。
- `test-agent`
  负责解释测试结果，决定继续、修复还是阻断。
- `fix-agent`
  负责把 bug、偏航 finding 和失败记忆收敛成最小修复集。
- `monitor-agent`
  负责检查当前实现是否仍与批准后的 spec 对齐。
- `acceptance-agent`
  负责挑选客户预览入口，并判断是否适合进入最终发布确认。
- `deploy-agent`
  负责基于验收结果决定是否允许发布。
- `dev-agent`
  兼容旧版单开发 agent 流程，当前主流程已经由 `frontend-agent`、`backend-agent`、`db-agent` 替代。

## 不建议抽成 skill 的部分

下面这些是项目运行时能力，应该继续保留在代码里：

- `orchestrator`
- 工作流状态机
- Stitch 调用与下载逻辑
- 数据库执行器
- 文件写入器
- 日志与报告落盘
- 预览服务
- 部署执行器

## 使用建议

如果你要把这套能力迁移到别的项目里，推荐顺序是：

1. 先迁移 `skills/` 里的角色说明和工作流规范
2. 再迁移 `src/tools` 里的确定性执行层
3. 最后迁移 `src/workflow/orchestrator.ts` 里的状态流转

这样复用成本最低，也不会把运行时代码和提示词耦死。
