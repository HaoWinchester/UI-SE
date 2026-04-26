---
name: dev-agent
description: 这是一个兼容旧流程的开发 skill。仅当工作流仍使用单一开发 agent，而不是 frontend-agent / backend-agent / db-agent 三段拆分时再使用。适用于旧版实现规划、单 agent 交付、或迁移老流程时的过渡场景。
---

# Dev Agent

## 角色职责

作为旧版兼容角色，把单个功能点整理成开发实现计划。

## 当前状态

当前项目主流程已经拆成：

- `frontend-agent`
- `backend-agent`
- `db-agent`

所以 `dev-agent` 现在主要用于兼容旧版流程或过渡场景，不是主线推荐角色。

## 输入

- 当前功能点
- 已批准的 UI 参考
- 当前代码上下文

## 输出

- 实现计划
- 交接说明

## 工作流

1. 聚焦当前功能点，不扩展额外范围。
2. 保持与批准后的需求和 UI 对齐。
3. 输出简短、可执行的实现计划。
4. 如果新流程可用，优先改用 `frontend-agent`、`backend-agent`、`db-agent`。
