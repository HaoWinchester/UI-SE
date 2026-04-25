# UI-SE

`UI-SE` 是一个“智能体编排式交付系统”的初版骨架，当前目标是把下面这条链路先跑通：

1. 接收一句话需求或需求文件
2. 先把需求整理成结构化 spec
3. 将澄清后的 spec 发送给 Stitch 生成 UI
4. 询问用户是否满意当前设计，不满意则继续重生成新版本
5. 按功能点进入前端、后端、测试、修复循环
6. 检查最终结果是否仍与原始需求一致
7. 自动生成客户预览页并启动本地预览地址
8. 最终给客户预览，确认后进入部署阶段

当前仓库仍然是演示版骨架，但已经不只是“流程说明”了。现在 UI 确认后，前端、后端、数据库和修复 agent 会把代码真正写入独立的任务工作区，数据库 migration/seed 也会真正执行到 PostgreSQL，再由测试层检查这些生成出来的文件和数据库执行结果。

## 仓库结构

- `docs/architecture.md`：系统架构和演进路线
- `docs/agent-runtime.md`：agent 的模型画像、目录权限、工具权限
- `docs/roadmap.md`：按版本推进的开发计划
- `src/workflow`：工作流编排与状态流转
- `src/agents`：各个 agent 的角色定义与默认实现
- `src/tools`：Stitch、数据库执行、面板生成、测试、部署等确定性工具层
- `src/storage`：任务存储抽象，目前是内存实现
- `skills`：每个 agent 的本地 skill，以及复制进仓库的 `speckit-*` skill
- `.specify`：Speckit 期望的模板、memory、bash 脚本骨架
- `specs`：Speckit 风格的规格目录
- `artifacts`：生成的 spec、UI、测试结果、部署清单等产物

## 快速开始

```bash
npm install
cp .env.example .env
npm run dev
```

如果你在 `.env` 中配置了 `STITCH_API_KEY` 或 OAuth 相关凭证，流程会优先走真实 Stitch SDK；如果没有配置，则会自动降级到 mock Stitch，但整个流程依然可以本地跑通。

如果你额外配置了 `OPENAI_API_KEY`，`frontend-agent`、`backend-agent`、`fix-agent` 会优先尝试走真实模型生成代码；如果没有配置，也会回退到内置模板生成，但同样会把代码文件写出来。

## 需求输入方式

当前支持 3 种输入方式，推荐直接传一句话，最方便演示。

```bash
# 方式一：直接传一句话需求（最适合演示）
npm run dev -- --prompt "为 AI 产品团队做一个项目交付看板"

# 方式二：直接把一句话作为位置参数传入
npm run dev -- "为 AI 产品团队做一个项目交付看板"

# 方式三：使用项目根目录下的 requirement.md
npm run dev

# 指定一个自定义需求文件
npm run dev -- --file ./requirement.md

# 查看帮助
npm run dev -- --help

# 自动通过 UI 确认和最终发布确认（适合演示脚本或自动化验证）
npm run dev -- --yes --no-open
```

输入优先级如下：

1. 命令行直接传入的一句话需求
2. `--file` 指定的需求文件
3. 项目根目录下的 `requirement.md`
4. 代码内置的兜底演示需求

默认情况下，生成完成后会自动打开 HTML 预览；如果你不想自动弹出预览，可以加 `--no-open`。
如果你不想在终端里逐次回答“Speckit 澄清问题”“是否满意当前设计”“是否允许发布”，可以加 `--yes` 自动接受推荐答案并通过确认节点。

## 当前主流程

当前最重要的一条链路已经是：

1. 输入一句话需求
2. `spec-agent` 先按 Speckit CLI 风格逐题澄清需求，生成结构化 spec
3. 将这份 spec 落到 `artifacts/specs`
4. `ui-agent` 基于澄清后的 spec 组织 Stitch prompt
5. `stitch-client` 调用 Stitch 生成并下载 UI 到 `artifacts/ui/<jobId>/v<版本号>/`
6. 询问是否满意当前 UI，不满意则带着反馈重新生成下一版
7. 满意后再进入 `frontend-agent -> backend-agent -> db-agent -> test-agent -> fix-agent`
8. 最终通过 `monitor-agent -> acceptance-agent -> deploy-agent`

也就是说，现在已经不是“把原始一句话直接发给 Stitch”，而是：

`一句话需求 -> 澄清 spec -> Stitch 生成 UI`

这样生成结果会更稳定，因为 Stitch 拿到的是更清晰的输入，而不是一条过于模糊的原始描述。

同时，控制台现在也会实时打印进度，例如：

- 已接收需求输入
- 正在按照 Speckit 流程生成初始 spec
- 正在进行 Speckit 需求澄清（1/5）
- 自动接受或等待你回答澄清问题
- spec 已生成
- 正在执行 `ui-agent`
- 正在等待 Stitch 生成 UI
- UI 下载完成
- 正在等待你确认是否满意当前设计
- `frontend-agent` 已写入 2 个代码文件
- `backend-agent` 已写入 2 个代码文件
- `db-agent` 已写入 5 个代码文件
- 正在将 migration/seed 执行到 PostgreSQL
- `fix-agent` 已写入 3 到 4 个代码文件
- 正在等待你确认是否允许发布

## 代码工作区

当 UI 被批准后，系统会为当前任务创建一块独立的代码工作区：

- `artifacts/code-workspace/<jobId>/frontend`
- `artifacts/code-workspace/<jobId>/backend`
- `artifacts/code-workspace/<jobId>/database`
- `artifacts/code-workspace/<jobId>/tests`

当前版本里：

- `frontend-agent` 会生成前端组件和样式文件
- `backend-agent` 会生成路由和 schema 文件
- `db-agent` 会生成 Prisma schema、PostgreSQL migration、seed 和 repository 文件
- `database-runner` 会读取这些 migration/seed，并真正执行到 PostgreSQL
- `fix-agent` 会读取这些文件，并在测试失败后生成修复版改动
- `test-runner` 会真实检查这些生成文件是否存在、是否还残留 TODO、是否具备关键标记，以及 Prisma/PostgreSQL 配置是否到位
- `monitor-agent` 会在每个功能点修复完成后立即检查一次，看前端、后端、数据库层有没有偏离已批准的需求与架构
- 一旦 monitor 发现偏航，系统会：
  - 明确指出是 `frontend`、`backend`、`database`、`ui` 还是 `workflow` 层出了问题
  - 把偏航结果落到 `artifacts/alignment-reports/<jobId>/`
  - 直接把偏航 finding 交给 `fix-agent` 做一次定向修复
  - 把全过程写入 `artifacts/logs/<jobId>/workflow.jsonl`

也就是说，链路已经从“只出实现计划”升级成了：

`UI 确认 -> 生成前端/后端/数据库代码 -> 跑校验 -> 失败则修复代码 -> 复测 -> monitor-agent 检查是否跑偏`

## 日志与偏航报告

为了方便排查“什么时候在哪一步出了问题”，当前每个 job 都会额外生成：

- 工作流日志：`artifacts/logs/<jobId>/workflow.jsonl`
- 偏航报告：`artifacts/alignment-reports/<jobId>/*.json`

其中：

- 日志会记录阶段切换、agent 执行、测试结果、失败记忆、客户确认等关键事件
- 偏航报告会记录：
  - 是 feature 级还是 job 级检查
  - 是否对齐
  - 哪个层面出了问题
  - 检查了哪些文件
  - 是否尝试过自动定向修复

## 网页面板

现在每个 job 都会额外生成一个静态网页面板：

- `artifacts/dashboard/<jobId>/index.html`

面板里会汇总：

- 当前需求摘要和阶段
- 最新 UI 预览
- 功能点状态
- PostgreSQL 执行记录
- 偏航报告
- `workflow.jsonl` 时间线

这样你不用只盯着终端输出，也可以直接打开一个页面回看整个任务在什么时候、哪一层出了问题。

## 客户预览页

当流程通过验收测试后，系统还会额外生成一份“给客户看”的预览页，并自动启动一个本地静态服务：

- 预览目录：`artifacts/customer-preview/<jobId>/`
- 预览地址：终端里会打印 `Customer preview: http://127.0.0.1:<port>/index.html`

如果运行时不带 `--no-open`，那么：

- UI 初稿确认阶段会自动打开当前 UI 预览
- 最终发布确认阶段会自动打开客户预览页

如果你带了 `--no-open`，系统仍然会生成并启动预览地址，只是不自动弹浏览器。

## Prisma + PostgreSQL 数据层

当前版本已经把数据库层纳入编排，而且不是只生成文件了：

- `db-agent` 负责为每个功能点生成 Prisma + PostgreSQL 数据模型
- 会生成共享的 `schema.prisma`
- 会为每个功能点生成独立 migration SQL
- 会生成每个功能点的 Prisma seed 脚本和可直接执行的 SQL seed
- 会生成给后端使用的 repository 层
- `database-runner` 会把 migration/seed 真正执行到 PostgreSQL
- 如果你没有手动配置 `DATABASE_URL`，系统会默认尝试拉起一个本地 Docker Postgres（`127.0.0.1:55432`）

生成结果会放在：

- `artifacts/code-workspace/<jobId>/database/prisma/schema.prisma`
- `artifacts/code-workspace/<jobId>/database/prisma/migrations/<feature>_init/migration.sql`
- `artifacts/code-workspace/<jobId>/database/prisma/seeds/<feature>.ts`
- `artifacts/code-workspace/<jobId>/database/prisma/seeds/<feature>.sql`
- `artifacts/code-workspace/<jobId>/database/src/features/<feature>/repository.ts`
- `artifacts/db-runs/<jobId>/*.json`

这意味着现在的后端代码不只是“留个接口壳子”，而是会显式引用数据库仓储层，形成：

`前端 -> 后端 -> Prisma repository -> PostgreSQL schema/migration/seed`

## UI 版本管理

每一次 UI 生成结果都会保存到单独目录，不会覆盖上一版：

- `artifacts/ui/<jobId>/v1`
- `artifacts/ui/<jobId>/v2`
- `artifacts/ui/<jobId>/v3`

每个版本目录里都会保存：

- 图片
- HTML
- metadata

系统会记录：

- 当前是第几版
- 哪一版最终被批准
- 每次被拒绝时留下的反馈

## 失败记忆

当某个功能点首轮测试失败后，系统现在会额外记录一份“失败记忆”，包括：

- 失败发生在哪个步骤
- 当时的测试结果摘要
- 对应的 bug 标题和描述
- 后续修复摘要与修复计划
- 最终是否已解决

这些记录会落到：

- `artifacts/test-reports/<jobId>/<featureId>-failure-memory.json`

后续 `test-agent` 和 `fix-agent` 会带着这份失败记忆继续工作，尽量避免在下一轮修复里重复踩中相同问题。

## Speckit 风格澄清

现在这一层已经不再是“静默自动补默认值”，而是会在进入 Stitch 之前，按 Speckit CLI 的节奏先做一轮逐题澄清：

- 每次只问 1 个高影响问题
- 默认最多问 5 个问题
- 优先问会影响首版范围、终端形态、核心用户路径这类关键决策
- 你可以输入选项字母、直接接受推荐答案，或者给一个简短自定义答案
- 如果带 `--yes`，系统会自动采用推荐答案继续往下走

澄清完成后，spec 里会明确写出：

- 澄清后的需求摘要
- 功能切片（feature slices）
- 用户场景（user scenarios）
- 成功标准（success criteria）
- 假设条件（assumptions）
- 已确认的澄清项（clarifications）

生成后的 spec 会写到：

- `artifacts/specs`

这份 spec 既能给人看，也会被后续 `ui-agent` 用来组织发给 Stitch 的 prompt。

## Speckit 集成

当前仓库里已经补进了最小可用的 Speckit 结构：

- `.specify/templates/*`
- `.specify/memory/constitution.md`
- `.specify/scripts/bash/*`
- `skills/speckit-*`
- `specs/`

并且现在每次 orchestrator 生成澄清后的 spec 时，都会同步写一份到 `specs/<编号>-<短名>/spec.md`。  
终端运行结束后也会打印：

- `Spec: ...`：工作流内部使用的 spec 产物
- `Speckit spec: ...`：同步写入 `specs/` 的 Speckit 路径

这样你后面如果要继续用 `speckit-clarify`、`speckit-plan`、`speckit-tasks`，就有正式目录可接，而不是只停留在当前项目自定义的 `spec-agent`。

## Stitch 配置

如果你想走真实 Stitch，需要在 `.env` 中配置下面任意一种方式：

- `STITCH_API_KEY`
- `STITCH_ACCESS_TOKEN` + `GOOGLE_CLOUD_PROJECT`

可选配置包括：

- `STITCH_PROJECT_ID`：复用某个已有的 Stitch 项目
- `STITCH_DEVICE_TYPE`：`DESKTOP`、`MOBILE`、`TABLET`、`AGNOSTIC`
- `STITCH_MODEL_ID`：`GEMINI_3_PRO`、`GEMINI_3_FLASH`、`GEMINI_3_1_PRO`
- `STITCH_HOST`：自定义 Stitch MCP 地址
- `STITCH_PROXY_URL`：手动指定 Stitch 请求走哪个代理
- `DATABASE_URL`：Prisma/PostgreSQL 的连接串
- `POSTGRES_AUTO_START`：没有 `DATABASE_URL` 时，是否自动拉起本地 Docker PostgreSQL
- `POSTGRES_DOCKER_IMAGE`：默认 `postgres:16-alpine`
- `POSTGRES_DOCKER_CONTAINER`：默认 `ui-se-postgres`
- `POSTGRES_DOCKER_PORT`：默认 `55432`
- `DATABASE_CONNECT_TIMEOUT_MS`：数据库连接超时时间

## 代理行为

当启用了真实 Stitch 凭证时，运行时会按下面顺序尝试代理配置：

1. `STITCH_PROXY_URL`
2. 标准环境变量 `HTTP_PROXY` / `HTTPS_PROXY`
3. macOS 系统代理（通过 `scutil --proxy` 自动探测）

这样做是因为 Stitch SDK 本身没有单独的代理参数，而当前 Node 运行环境也不会总是自动继承系统代理，所以这里在代码里显式补了一层代理配置。

## 当前真实程度

目前这套系统里，已经比较“真实”的部分有：

- 一句话需求输入
- 需求自动澄清成 spec
- UI 多版本生成与保存
- UI 满意度确认后再继续开发
- Stitch SDK 调用与 UI 下载
- 任务级独立代码工作区
- 前端/后端/数据库代码文件生成与落盘
- PostgreSQL migration/seed 真执行
- 自动生成客户预览页并启动本地预览服务
- 基于生成文件的测试与修复闭环
- 偏航报告和工作流网页面板
- 最终发布前客户确认
- 产物落盘到 `artifacts/`

目前还是演示骨架的部分有：

- `monitor-agent`
- `acceptance-agent`
- `deploy-agent`
- `MockDeployer`

也就是说，当前最成熟的链路是：

`需求 -> spec -> Stitch -> UI 确认 -> 前后端代码生成 -> 文件级测试/修复 -> 客户确认 -> 部署`

其中部署还是 mock，但开发、测试和修复已经不再只是口头规划，而是会生成和修补实际代码文件；数据库层也已经能生成 Prisma + PostgreSQL 所需的核心文件。

## 推荐下一步

如果你准备继续往下做，最值得优先推进的是：

1. 把 `spec-agent` 从“自动澄清”升级成“可交互追问”的 clarify loop
2. 把当前文件级测试规则换成真实的前端/后端/API/数据库测试命令
3. 把生成代码目录从 `artifacts/code-workspace` 接到真实业务仓库
4. 把 `MockDeployer` 换成真实的测试环境或服务器发布流程
5. 把 job 存储从内存换成 SQLite 或 Postgres
6. 让网页面板支持筛选、对比不同 UI 版本和不同修复轮次
