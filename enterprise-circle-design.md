# 企业朋友圈系统设计方案

## 一、系统概述

基于CQRS（Command Query Responsibility Segregation）模式设计的企业朋友圈系统，支持发布、删除、点赞、评论等功能，并实现热门内容自动置顶机制。

## 二、核心需求分析

### 功能需求
- 企业用户发布/删除内容
- 同企业成员内容互相可见
- 点赞功能
- 24小时内点赞数超过10的内容，前三名自动置顶
- 评论功能（可选）

### 数据规模
- 企业数量：1万
- 每日新增内容：50万条
- 日活用户数：500万

## 三、CQRS架构设计

### 3.1 整体架构图

```mermaid
graph TB
    subgraph "客户端层"
        Web[Web客户端]
        Mobile[移动客户端]
    end
    
    subgraph "API网关层"
        Gateway[API Gateway<br/>负载均衡/路由/限流]
    end
    
    subgraph "应用服务层"
        subgraph "命令端 Command Side"
            CS[Command Service<br/>处理写操作]
            CV[Command Validator<br/>命令验证]
            CH[Command Handler<br/>命令处理器]
        end
        
        subgraph "查询端 Query Side"
            QS[Query Service<br/>处理读操作]
            QP[Query Processor<br/>查询处理器]
            QC[Query Cache<br/>查询缓存]
        end
    end
    
    subgraph "事件处理层"
        EB[Event Bus<br/>事件总线]
        ES[Event Store<br/>事件存储]
        EP[Event Processor<br/>事件处理器]
    end
    
    subgraph "数据存储层"
        subgraph "写库"
            MySQL[(MySQL<br/>主数据库)]
        end
        
        subgraph "读库"
            MongoDB[(MongoDB<br/>读优化存储)]
            Redis[(Redis<br/>缓存/计数器)]
            ES_DB[(ElasticSearch<br/>全文搜索)]
        end
    end
    
    subgraph "后台服务"
        Scheduler[定时任务<br/>置顶计算]
        Analytics[数据分析<br/>统计服务]
    end
    
    Web --> Gateway
    Mobile --> Gateway
    Gateway --> CS
    Gateway --> QS
    
    CS --> CV
    CV --> CH
    CH --> MySQL
    CH --> EB
    
    EB --> ES
    EB --> EP
    EP --> MongoDB
    EP --> Redis
    EP --> ES_DB
    
    QS --> QP
    QP --> QC
    QC --> Redis
    QP --> MongoDB
    QP --> ES_DB
    
    Scheduler --> Redis
    Scheduler --> MongoDB
    Analytics --> ES
```

### 3.2 命令处理流程

```mermaid
sequenceDiagram
    participant Client as 客户端
    participant Gateway as API网关
    participant CS as Command Service
    participant CV as Command Validator
    participant CH as Command Handler
    participant DB as MySQL
    participant EB as Event Bus
    participant EP as Event Processor
    participant Cache as Redis
    participant ReadDB as MongoDB
    
    Client->>Gateway: 发布内容请求
    Gateway->>CS: 转发请求
    CS->>CV: 验证命令
    CV->>CV: 校验用户权限<br/>校验企业归属<br/>校验内容合规
    CV-->>CS: 验证结果
    
    alt 验证通过
        CS->>CH: 执行命令
        CH->>DB: 写入数据
        DB-->>CH: 写入成功
        CH->>EB: 发布ContentCreated事件
        
        par 异步处理
            EB->>EP: 事件处理
            EP->>ReadDB: 更新读库
            EP->>Cache: 更新缓存
        end
        
        CH-->>CS: 返回成功
        CS-->>Gateway: 返回结果
        Gateway-->>Client: 发布成功
    else 验证失败
        CS-->>Gateway: 返回错误
        Gateway-->>Client: 发布失败
    end
```

### 3.3 查询处理流程

```mermaid
sequenceDiagram
    participant Client as 客户端
    participant Gateway as API网关
    participant QS as Query Service
    participant QC as Query Cache
    participant QP as Query Processor
    participant Redis as Redis缓存
    participant MongoDB as MongoDB
    participant TopService as 置顶服务
    
    Client->>Gateway: 查询企业圈内容
    Gateway->>QS: 转发查询请求
    QS->>QC: 检查缓存
    
    alt 缓存命中
        QC->>Redis: 获取缓存数据
        Redis-->>QC: 返回数据
        QC-->>QS: 返回缓存结果
    else 缓存未命中
        QS->>QP: 处理查询
        QP->>QP: 构建查询条件<br/>企业ID过滤
        
        par 并行查询
            QP->>TopService: 获取置顶内容
            TopService->>Redis: 查询置顶列表
            Redis-->>TopService: 返回置顶ID列表
            TopService-->>QP: 返回置顶内容
        and
            QP->>MongoDB: 查询普通内容
            MongoDB-->>QP: 返回内容列表
        end
        
        QP->>QP: 合并结果<br/>置顶在前<br/>普通在后
        QP->>Redis: 更新缓存
        QP-->>QS: 返回查询结果
    end
    
    QS-->>Gateway: 返回数据
    Gateway-->>Client: 显示内容
```

### 3.4 点赞处理流程

```mermaid
sequenceDiagram
    participant Client as 客户端
    participant Gateway as API网关
    participant CS as Command Service
    participant CH as Command Handler
    participant DB as MySQL
    participant EB as Event Bus
    participant EP as Event Processor
    participant Redis as Redis
    participant TopCalc as 置顶计算服务
    
    Client->>Gateway: 点赞请求
    Gateway->>CS: 转发请求
    CS->>CH: 处理点赞命令
    
    CH->>Redis: 检查是否已点赞
    Redis-->>CH: 返回状态
    
    alt 未点赞
        CH->>DB: 记录点赞
        CH->>Redis: INCR点赞计数
        CH->>Redis: 记录用户点赞
        CH->>EB: 发布LikeCreated事件
        
        EB->>EP: 处理事件
        EP->>Redis: 更新内容点赞数
        EP->>TopCalc: 触发置顶计算
        
        TopCalc->>TopCalc: 检查发布时间<24h
        TopCalc->>TopCalc: 检查点赞数>10
        TopCalc->>Redis: 更新置顶列表
        
        CH-->>CS: 点赞成功
    else 已点赞
        CH-->>CS: 已点赞提示
    end
    
    CS-->>Gateway: 返回结果
    Gateway-->>Client: 更新UI
```

### 3.5 置顶计算流程

```mermaid
flowchart TB
    Start([定时任务触发<br/>每5分钟])
    
    Start --> GetRecent[获取24小时内的内容]
    GetRecent --> Filter[过滤点赞数>10的内容]
    
    Filter --> GroupByCompany[按企业分组]
    GroupByCompany --> SortByLikes[按点赞数排序]
    
    SortByLikes --> SelectTop3[选取前3名]
    SelectTop3 --> UpdateRedis[更新Redis置顶列表]
    
    UpdateRedis --> InvalidateCache[失效相关缓存]
    InvalidateCache --> NotifyClients[通知客户端更新]
    
    NotifyClients --> End([结束])
    
    subgraph "数据结构"
        RedisStructure[Redis数据结构<br/>Key: top:company:{companyId}<br/>Value: Sorted Set<br/>Score: 点赞数<br/>Member: 内容ID]
    end
```

## 四、数据模型设计

### 4.1 命令端数据模型（MySQL）

```mermaid
erDiagram
    Company ||--o{ User : contains
    Company ||--o{ Content : has
    User ||--o{ Content : creates
    User ||--o{ Like : gives
    User ||--o{ Comment : writes
    Content ||--o{ Like : receives
    Content ||--o{ Comment : has
    
    Company {
        bigint id PK
        string name
        string code
        datetime created_at
        datetime updated_at
    }
    
    User {
        bigint id PK
        bigint company_id FK
        string username
        string nickname
        string avatar
        int status
        datetime created_at
    }
    
    Content {
        bigint id PK
        bigint user_id FK
        bigint company_id FK
        string content_text
        json media_urls
        int status
        datetime created_at
        datetime deleted_at
    }
    
    Like {
        bigint id PK
        bigint user_id FK
        bigint content_id FK
        datetime created_at
    }
    
    Comment {
        bigint id PK
        bigint user_id FK
        bigint content_id FK
        string comment_text
        bigint reply_to_id
        datetime created_at
    }
```

### 4.2 查询端数据模型（MongoDB）

```mermaid
graph LR
    subgraph "MongoDB Collections"
        ContentView[ContentView Collection<br/>包含完整内容信息<br/>用户信息<br/>点赞数<br/>评论数]
        
        CompanyTimeline[CompanyTimeline Collection<br/>按企业组织的时间线<br/>支持分页查询]
        
        UserActivity[UserActivity Collection<br/>用户活动记录<br/>点赞历史<br/>评论历史]
    end
    
    subgraph "文档结构示例"
        ContentDoc["{<br/>  _id: ObjectId,<br/>  contentId: Long,<br/>  companyId: Long,<br/>  userId: Long,<br/>  userName: String,<br/>  userAvatar: String,<br/>  content: String,<br/>  mediaUrls: Array,<br/>  likeCount: Number,<br/>  commentCount: Number,<br/>  isTop: Boolean,<br/>  topOrder: Number,<br/>  createdAt: Date,<br/>  updatedAt: Date<br/>}"]
    end
```

### 4.3 缓存数据结构（Redis）

```mermaid
graph TB
    subgraph "Redis数据结构"
        subgraph "内容缓存"
            ContentCache["Key: content:{contentId}<br/>Type: Hash<br/>TTL: 1小时"]
        end
        
        subgraph "点赞计数"
            LikeCounter["Key: like:count:{contentId}<br/>Type: String<br/>Value: 点赞数"]
        end
        
        subgraph "用户点赞记录"
            UserLikes["Key: like:user:{userId}:{contentId}<br/>Type: String<br/>Value: 1<br/>TTL: 30天"]
        end
        
        subgraph "置顶列表"
            TopList["Key: top:company:{companyId}<br/>Type: Sorted Set<br/>Score: 点赞数<br/>Member: contentId<br/>TTL: 5分钟"]
        end
        
        subgraph "企业时间线"
            Timeline["Key: timeline:company:{companyId}<br/>Type: List<br/>Value: contentId列表<br/>TTL: 10分钟"]
        end
        
        subgraph "热门内容候选"
            HotCandidate["Key: hot:candidate:{companyId}<br/>Type: Sorted Set<br/>Score: 点赞数<br/>Member: contentId<br/>只保留24小时内数据"]
        end
    end
```

## 五、事件驱动设计

### 5.1 事件流转图

```mermaid
graph TB
    subgraph "命令事件"
        CE1[ContentCreatedEvent]
        CE2[ContentDeletedEvent]
        CE3[LikeCreatedEvent]
        CE4[LikeRemovedEvent]
        CE5[CommentCreatedEvent]
        CE6[CommentDeletedEvent]
    end
    
    subgraph "事件处理器"
        EP1[ContentEventProcessor]
        EP2[LikeEventProcessor]
        EP3[CommentEventProcessor]
        EP4[TimelineProcessor]
        EP5[NotificationProcessor]
        EP6[StatisticsProcessor]
    end
    
    subgraph "副作用"
        SE1[更新读库]
        SE2[更新缓存]
        SE3[计算置顶]
        SE4[发送通知]
        SE5[更新统计]
    end
    
    CE1 --> EP1
    CE2 --> EP1
    CE3 --> EP2
    CE4 --> EP2
    CE5 --> EP3
    CE6 --> EP3
    
    EP1 --> SE1
    EP1 --> SE2
    EP1 --> EP4
    
    EP2 --> SE2
    EP2 --> SE3
    EP2 --> EP5
    
    EP3 --> SE2
    EP3 --> EP5
    
    EP4 --> SE1
    EP5 --> SE4
    EP6 --> SE5
```

### 5.2 事件存储设计

```mermaid
sequenceDiagram
    participant Handler as Command Handler
    participant EventStore as Event Store
    participant EventBus as Event Bus
    participant Processor as Event Processor
    participant Snapshot as Snapshot Store
    
    Handler->>EventStore: 保存事件
    EventStore->>EventStore: 持久化到数据库
    EventStore->>EventBus: 发布事件
    
    par 并行处理
        EventBus->>Processor: 分发事件
        Processor->>Processor: 处理业务逻辑
    and
        EventStore->>Snapshot: 定期创建快照
        Snapshot->>Snapshot: 保存聚合状态
    end
    
    Note over EventStore: 事件不可变<br/>只能追加<br/>保留完整历史
```

## 六、性能优化策略

### 6.1 读写分离架构

```mermaid
graph TB
    subgraph "写路径优化"
        W1[异步写入]
        W2[批量处理]
        W3[写入队列]
        W4[分库分表]
    end
    
    subgraph "读路径优化"
        R1[多级缓存]
        R2[预加载]
        R3[CDN加速]
        R4[读库集群]
    end
    
    subgraph "缓存策略"
        C1[Redis缓存<br/>热点数据]
        C2[本地缓存<br/>高频访问]
        C3[CDN缓存<br/>静态资源]
    end
    
    W1 --> W3
    W3 --> W2
    W2 --> W4
    
    R1 --> C1
    R1 --> C2
    R3 --> C3
    C1 --> R4
    C2 --> R4
```

### 6.2 数据分片策略

```mermaid
graph LR
    subgraph "分片策略"
        Company[按企业ID分片]
        Time[按时间分片]
        Hash[一致性Hash]
    end
    
    subgraph "分片实现"
        Shard1[Shard 1<br/>企业1-3000]
        Shard2[Shard 2<br/>企业3001-6000]
        Shard3[Shard 3<br/>企业6001-10000]
    end
    
    Company --> Hash
    Hash --> Shard1
    Hash --> Shard2
    Hash --> Shard3
    
    Time --> Archive[历史数据归档]
```

## 七、高可用设计

### 7.1 容错机制

```mermaid
graph TB
    subgraph "故障检测"
        Health[健康检查]
        Monitor[监控告警]
        Circuit[熔断器]
    end
    
    subgraph "故障恢复"
        Retry[重试机制]
        Fallback[降级策略]
        Backup[备份服务]
    end
    
    subgraph "数据保护"
        Replica[主从复制]
        Backup2[定期备份]
        Recovery[灾难恢复]
    end
    
    Health --> Circuit
    Monitor --> Circuit
    Circuit --> Retry
    Retry --> Fallback
    Fallback --> Backup
    
    Replica --> Recovery
    Backup2 --> Recovery
```

### 7.2 服务降级流程

```mermaid
flowchart TB
    Start([请求到达])
    
    Start --> CheckHealth{服务健康?}
    
    CheckHealth -->|是| Normal[正常处理]
    CheckHealth -->|否| CheckLevel{检查降级级别}
    
    CheckLevel -->|Level 1| Degrade1[关闭实时统计]
    CheckLevel -->|Level 2| Degrade2[关闭评论功能]
    CheckLevel -->|Level 3| Degrade3[只读模式]
    
    Degrade1 --> Cache1[使用缓存数据]
    Degrade2 --> Cache2[禁用写操作]
    Degrade3 --> Static[返回静态数据]
    
    Normal --> Response([返回响应])
    Cache1 --> Response
    Cache2 --> Response
    Static --> Response
```

## 八、扩展性设计

### 8.1 水平扩展方案

```mermaid
graph TB
    subgraph "应用层扩展"
        LB[负载均衡器]
        AS1[应用服务器1]
        AS2[应用服务器2]
        AS3[应用服务器N]
    end
    
    subgraph "数据层扩展"
        MS[MySQL主库]
        MS1[MySQL从库1]
        MS2[MySQL从库2]
        
        MG1[MongoDB节点1]
        MG2[MongoDB节点2]
        MG3[MongoDB节点3]
        
        RD1[Redis节点1]
        RD2[Redis节点2]
        RD3[Redis节点3]
    end
    
    LB --> AS1
    LB --> AS2
    LB --> AS3
    
    AS1 --> MS
    AS2 --> MS1
    AS3 --> MS2
    
    AS1 --> MG1
    AS2 --> MG2
    AS3 --> MG3
    
    AS1 --> RD1
    AS2 --> RD2
    AS3 --> RD3
```

## 九、监控与运维

### 9.1 监控体系

```mermaid
graph TB
    subgraph "监控指标"
        M1[业务指标<br/>发布量/点赞量/活跃度]
        M2[性能指标<br/>响应时间/QPS/TPS]
        M3[系统指标<br/>CPU/内存/磁盘/网络]
        M4[错误指标<br/>错误率/异常统计]
    end
    
    subgraph "监控工具"
        Prometheus[Prometheus<br/>指标收集]
        Grafana[Grafana<br/>可视化]
        ELK[ELK Stack<br/>日志分析]
        Zipkin[Zipkin<br/>链路追踪]
    end
    
    subgraph "告警机制"
        Alert1[阈值告警]
        Alert2[趋势告警]
        Alert3[异常告警]
    end
    
    M1 --> Prometheus
    M2 --> Prometheus
    M3 --> Prometheus
    M4 --> ELK
    
    Prometheus --> Grafana
    Prometheus --> Alert1
    ELK --> Alert2
    Zipkin --> Alert3
```

## 十、安全设计

### 10.1 安全架构

```mermaid
graph TB
    subgraph "接入层安全"
        WAF[Web应用防火墙]
        DDOS[DDoS防护]
        SSL[SSL/TLS加密]
    end
    
    subgraph "应用层安全"
        Auth[身份认证]
        Author[权限控制]
        Audit[审计日志]
    end
    
    subgraph "数据层安全"
        Encrypt[数据加密]
        Mask[数据脱敏]
        Backup[数据备份]
    end
    
    WAF --> Auth
    DDOS --> Auth
    SSL --> Auth
    
    Auth --> Author
    Author --> Audit
    
    Audit --> Encrypt
    Encrypt --> Mask
    Mask --> Backup
```

## 十一、技术选型建议

### 核心技术栈
- **编程语言**: Java/Go (高性能、高并发)
- **Web框架**: Spring Boot/Gin
- **消息队列**: Kafka/RabbitMQ
- **缓存**: Redis Cluster
- **主数据库**: MySQL (分库分表)
- **读数据库**: MongoDB
- **搜索引擎**: ElasticSearch
- **监控**: Prometheus + Grafana
- **容器化**: Docker + Kubernetes
- **服务网格**: Istio (可选)

### 关键中间件配置
- **MySQL**: 主从复制 + 读写分离
- **Redis**: 集群模式 + 持久化
- **Kafka**: 多分区 + 多副本
- **MongoDB**: 副本集 + 分片集群

## 十二、总结

本设计方案基于CQRS架构模式，通过读写分离、事件驱动、多级缓存等技术手段，能够有效支撑：
- 1万家企业
- 每日50万条新增内容
- 500万日活用户

系统具备良好的扩展性、高可用性和高性能，能够满足企业朋友圈的业务需求。