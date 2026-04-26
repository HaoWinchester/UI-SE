---
name: monitor-agent
description: 当系统需要确认当前实现是否仍与批准后的需求和 UI 对齐时，必须使用这个 skill。适用于功能点对齐检查、全局验收前偏航检测、前端/后端/数据库层规则校验，以及发现偏航后把结果结构化交给 fix-agent 的场景。
---

# Monitor Agent

## 角色职责

检查当前实现有没有逐渐偏离已批准的需求、UI 和数据层边界，并明确指出偏航属于哪一层。

## 适用场景

- 某个功能点修复完成后，需要做对齐检查。
- 全部功能点完成后，需要做 job 级总检查。
- 发布前，需要确认实现没有悄悄跑偏。

## 不适用场景

- 需求还在澄清阶段。
- 只是准备生成前端或后端代码。
- 仅仅需要解释测试结果，不需要做对齐判断。

## 输入契约

- `job`
  当前工作流状态对象。
- `feature`
  可选；如果存在，表示本次做 feature 级检查。

## 输出契约

- `aligned`
  是否对齐。
- `structuredFindings`
  结构化偏航结果，可直接落盘和交给 fix-agent。
- `scope`
  当前检查范围：`feature` 或 `job`。
- `checkedFiles`
  实际检查过的文件列表。

## 推荐工作流

1. 先判断当前是 feature 级还是 job 级检查。
2. 逐层验证：
   - UI 是否已批准
   - 前端标记与结构是否到位
   - 后端是否连到 repository
   - 数据库 schema / migration / seed / repository 是否对齐
   - 工作流状态是否完整
3. 一旦发现偏航，要明确指出：
   - 层级
   - 规则
   - 文件位置
   - 是否属于阻断问题
4. 输出结果必须能直接被 orchestrator 落盘成报告。
5. 在未对齐时阻断继续发布，并把 finding 交给 fix-agent。

## 失败处理

- 如果 UI 未批准：
  直接标为阻断，不要继续假装实现已对齐。
- 如果关键文件缺失：
  记录为 blocking finding，而不是模糊总结。
- 如果是 feature 级问题：
  优先给出能直接修复的最小 finding。

## 上下游交接

- 上游通常是：
  - `frontend-agent`
  - `backend-agent`
  - `db-agent`
  - `fix-agent`
- 下游通常是：
  - `fix-agent`
  - alignment report 落盘逻辑
  - acceptance / deploy 阶段

## 约束

- 不要只给模糊结论，必须指出具体偏航点。
- 不要忽略数据库执行失败或未批准 UI 这类阻断条件。
- 对 feature 级和 job 级检查要清楚区分范围。

## 示例

feature 级检查时，如果发现：

- 前端缺少 `data-alignment-verified="true"`
- 后端 route 没有调用预期 repository

期望行为：

1. 输出两个结构化 finding。
2. 标记为 blocking。
3. 把结果交给 `fix-agent` 做定向修复。
