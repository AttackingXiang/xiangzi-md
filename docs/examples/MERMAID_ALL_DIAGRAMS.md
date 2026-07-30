# Mermaid 常用图表示例

本文档集中展示 AI 生成 Markdown 时常见的 Mermaid 图表类型，可用于检查 Xiangzi MD 的渲染效果，也可作为后续可视化编辑功能的测试样例。

## 1. 流程图

适合表达业务流程、审批过程、决策树和系统处理步骤。

```mermaid
flowchart LR
    Start([开始]) --> Input[提交资料]
    Input --> Check{资料是否完整}
    Check -->|是| Approve[进入审批]
    Check -->|否| Return[退回补充]
    Return --> Input
    Approve --> Finish([完成])
```

## 2. 时序图

适合表达用户、应用和服务之间按照时间顺序发生的交互。

```mermaid
sequenceDiagram
    autonumber
    actor User as 用户
    participant App as Xiangzi MD
    participant FS as 文件系统

    User->>App: 打开 Markdown 文档
    App->>FS: 读取文件
    FS-->>App: 返回文档内容
    App-->>User: 渲染并显示文档
    User->>App: 编辑并保存
    App->>FS: 写入更新内容
    FS-->>App: 保存成功
    App-->>User: 更新保存状态
```

## 3. 思维导图

适合表达主题、知识结构、需求拆解和层级关系。

```mermaid
mindmap
  root((项目知识库))
    需求
      用户故事
      验收标准
    设计
      交互原型
      技术方案
    实施
      开发
      测试
    交付
      发布
      复盘
```

## 4. 状态图

适合表达文档、订单、任务等对象的生命周期和状态转换。

```mermaid
stateDiagram-v2
    state "草稿" as Draft
    state "评审中" as Review
    state "已批准" as Approved
    state "已发布" as Published
    state "已归档" as Archived

    [*] --> Draft
    Draft --> Review : 提交评审
    Review --> Draft : 退回修改
    Review --> Approved : 评审通过
    Approved --> Published : 发布
    Published --> Archived : 归档
    Archived --> [*]
```

## 5. ER 图

适合表达数据库实体、字段以及实体之间的关系。

```mermaid
erDiagram
    USER ||--o{ DOCUMENT : creates
    DOCUMENT ||--o{ VERSION : contains
    DOCUMENT }o--o{ TAG : uses

    USER {
        string id PK
        string name
        string email
    }

    DOCUMENT {
        string id PK
        string title
        string owner_id FK
        datetime updated_at
    }

    VERSION {
        string id PK
        string document_id FK
        int revision
    }

    TAG {
        string id PK
        string name
    }
```

## 6. 类图

适合表达代码模块、领域对象、属性、方法和依赖关系。

```mermaid
classDiagram
    class Document {
        +String id
        +String title
        +save()
        +export()
    }

    class MarkdownEditor {
        +open(document)
        +update(markdown)
    }

    class MermaidRenderer {
        +render(source)
        +copyAsImage()
    }

    Document o-- MarkdownEditor : edited by
    MarkdownEditor --> MermaidRenderer : requests
```

## 7. 甘特图

适合表达项目阶段、任务依赖和时间计划。

```mermaid
gantt
    title 产品迭代计划
    dateFormat YYYY-MM-DD
    axisFormat %m-%d

    section 需求
    需求梳理     :done, req, 2026-07-01, 5d
    方案评审     :done, design, after req, 3d

    section 开发
    编辑器实现   :active, dev, after design, 10d
    联调测试     :test, after dev, 5d

    section 发布
    灰度验证     :crit, canary, after test, 3d
    正式发布     :release, after canary, 1d
```

## 8. 饼图

适合表达各类数据在整体中的占比。

```mermaid
pie showData
    title 文档内容构成
    "需求" : 30
    "设计" : 20
    "开发记录" : 25
    "测试报告" : 15
    "发布说明" : 10
```

## 9. XY 图

适合表达连续数据、趋势变化以及不同数据系列之间的对比。

```mermaid
xychart-beta
    title "每周处理文档数"
    x-axis "星期" [1, 2, 3, 4, 5, 6, 7]
    y-axis "文档数" 0 --> 50
    bar [12, 18, 25, 22, 35, 28, 20]
    line [10, 16, 21, 24, 30, 26, 23]
```

## 可视化编辑建议

- 流程图、状态图、ER 图和类图适合使用节点与连线画布编辑。
- 思维导图适合使用树形分支编辑器。
- 时序图适合调整参与者、消息内容和消息顺序。
- 甘特图适合在时间轴上调整任务起止时间和依赖关系。
- 饼图和 XY 图适合通过数据表格修改名称与数值。
