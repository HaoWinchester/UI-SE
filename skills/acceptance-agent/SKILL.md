---
name: acceptance-agent
description: 当实现已经通过主要测试，系统需要决定“现在能不能给客户看”时，必须使用这个 skill。适用于客户预览前检查、最终预览入口选择、验收完成度判断，以及在发布前确认是否具备展示条件的场景。
---

# Acceptance Agent

## 角色职责

判断当前构建是否已经适合给客户预览，并选出最合适的预览入口。

## 适用场景

- 功能点、流程和验收测试已经基本完成。
- 需要在正式发布前给客户看最终预览。
- 需要从多个候选预览入口中挑一个最清晰的。

## 不适用场景

- 仍有明显 open bug。
- 功能点还未全部完成。
- 只是做 UI 初稿审核，而不是最终客户预览。

## 输入契约

- `job`
  当前工作流完整状态。

## 输出契约

- `readyForCustomerReview`
  当前是否适合给客户看。
- `previewPath`
  最终推荐的预览入口。
- `summary`
  最终验收摘要。

## 推荐工作流

1. 先确认已批准需求与当前交付结果仍然一致。
2. 检查是否还有：
   - open bug
   - 未完成功能点
   - 缺失的预览入口
3. 从客户角度选择最清晰的预览入口。
4. 返回明确的 ready / blocked 结论，让 orchestrator 决定是否进入发布确认。

## 失败处理

- 如果没有可用预览入口：
  直接阻断，不要假装可以预览。
- 如果功能点未完成：
  明确指出未完成数量。
- 如果还有 open bug：
  作为阻断项写进摘要和风险。

## 上下游交接

- 上游通常是：
  - `monitor-agent`
  - acceptance test
- 下游通常是：
  - 客户确认节点
  - `deploy-agent`

## 约束

- 不要在明显未完成时放行客户预览。
- 不要忽略 open bug 或未完成功能点。
- 优先提供一个清晰的预览入口，不要给客户多个混乱入口。

## 示例

如果当前：

- 所有 feature 都已完成
- 没有 open bug
- `customer-preview` 地址可用

则应返回：

- `readyForCustomerReview=true`
- `previewPath=<customer preview url>`
