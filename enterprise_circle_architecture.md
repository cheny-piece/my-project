# 企业朋友圈系统架构设计 (CQRS)

## 系统概述

基于CQRS（Command Query Responsibility Segregation）模式设计的企业朋友圈系统，支持高并发读写分离，满足以下需求：

- 企业用户发布/删除内容
- 同企业成员可见
- 点赞功能
- 智能置顶（24小时内点赞数前三自动置顶）
- 评论功能（可选）

## 整体架构

```mermaid
graph TB
    subgraph "客户端层"
        A[移动端App]
        B[Web端]
        C[管理后台]
    end
    
    subgraph "网关层"
        D[API网关]
        E[负载均衡器]
    end
    
    subgraph "应用层"
        F[认证服务]
        G[命令服务]
        H[查询服务]
        I[推送服务]
    end
    
    subgraph "CQRS核心"
        J[命令处理器]
        K[事件存储]
        L[事件总线]
        M[查询处理器]
        N[读模型更新器]
    end
    
    subgraph "存储层"
        O[写数据库<br/>MySQL集群]
        P[读数据库<br/>Redis集群]
        Q[搜索引擎<br/>Elasticsearch]
        R[文件存储<br/>OSS/S3]
    end
    
    subgraph "基础设施"
        S[消息队列<br/>Kafka]
        T[缓存<br/>Redis]
        U[监控<br/>Prometheus]
        V[日志<br/>ELK]
    end
    
    A --> D
    B --> D
    C --> D
    D --> E
    E --> F
    E --> G
    E --> H
    E --> I
    
    G --> J
    J --> K
    K --> L
    L --> N
    H --> M
    M --> P
    M --> Q
    
    J --> O
    N --> P
    N --> Q
    
    L --> S
    S --> I
    
    F --> T
    G --> T
    H --> T
    
    style J fill:#e1f5fe
    style M fill:#f3e5f5
    style K fill:#fff3e0
    style L fill:#e8f5e8
```

## 命令端（写操作）架构

```mermaid
graph TB
    subgraph "命令端架构"
        A[客户端请求]
        B[API网关]
        C[命令服务]
        D[权限验证]
        E[命令验证]
        F[业务逻辑处理]
        G[事件生成]
        H[事件存储]
        I[消息发布]
    end
    
    subgraph "命令类型"
        J[发布内容命令]
        K[删除内容命令]
        L[点赞命令]
        M[取消点赞命令]
        N[评论命令]
    end
    
    subgraph "存储"
        O[MySQL主库]
        P[事件存储]
        Q[Kafka]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I
    
    J --> F
    K --> F
    L --> F
    M --> F
    N --> F
    
    H --> O
    H --> P
    I --> Q
    
    style F fill:#ffebee
    style G fill:#e8f5e8
    style H fill:#fff3e0
```

## 查询端（读操作）架构

```mermaid
graph TB
    subgraph "查询端架构"
        A[客户端请求]
        B[API网关]
        C[查询服务]
        D[缓存检查]
        E[查询处理]
        F[数据聚合]
        G[结果返回]
    end
    
    subgraph "查询类型"
        H[企业圈列表查询]
        I[内容详情查询]
        J[点赞列表查询]
        K[评论列表查询]
        L[用户发布查询]
    end
    
    subgraph "存储"
        M[Redis缓存]
        N[MySQL从库]
        O[Elasticsearch]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    
    H --> E
    I --> E
    J --> E
    K --> E
    L --> E
    
    D --> M
    E --> N
    E --> O
    
    style E fill:#e1f5fe
    style F fill:#f3e5f5
```

## 核心业务流程

### 发布内容流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant G as API网关
    participant C as 命令服务
    participant E as 事件存储
    participant K as Kafka
    participant Q as 查询服务
    participant R as Redis
    
    U->>G: 发布内容请求
    G->>C: 转发请求
    C->>C: 权限验证
    C->>C: 内容验证
    C->>E: 保存ContentCreated事件
    E->>K: 发布事件
    K->>Q: 事件消费
    Q->>R: 更新读模型
    Q->>U: 推送通知（可选）
    C->>G: 返回成功
    G->>U: 返回结果
```

### 点赞流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant G as API网关
    participant C as 命令服务
    participant E as 事件存储
    participant K as Kafka
    participant R as 排序服务
    participant Q as 查询服务
    participant Cache as Redis
    
    U->>G: 点赞请求
    G->>C: 转发请求
    C->>C: 验证用户权限
    C->>C: 检查是否已点赞
    C->>E: 保存LikeAdded事件
    E->>K: 发布事件
    K->>R: 触发排序计算
    R->>R: 更新点赞计数
    R->>R: 检查置顶条件
    R->>Cache: 更新排序缓存
    K->>Q: 更新读模型
    Q->>Cache: 更新内容缓存
    C->>G: 返回成功
    G->>U: 返回结果
```

### 智能置顶算法流程

```mermaid
graph TB
    A[点赞事件触发] --> B[获取内容发布时间]
    B --> C{是否24小时内发布?}
    C -->|否| D[不参与置顶]
    C -->|是| E[更新点赞计数]
    E --> F[获取同企业24小时内内容]
    F --> G[按点赞数排序]
    G --> H{点赞数>10?}
    H -->|否| I[不置顶]
    H -->|是| J[检查是否前三名]
    J --> K{是否前三?}
    K -->|否| L[取消置顶状态]
    K -->|是| M[设置置顶状态]
    M --> N[更新排序权重]
    N --> O[刷新缓存]
    
    style M fill:#4caf50
    style L fill:#ff9800
    style D fill:#9e9e9e
    style I fill:#9e9e9e
```

## 数据模型设计

### 命令端数据模型（MySQL）

```mermaid
erDiagram
    ENTERPRISE ||--o{ USER : has
    USER ||--o{ CONTENT : creates
    CONTENT ||--o{ LIKE : receives
    CONTENT ||--o{ COMMENT : receives
    USER ||--o{ LIKE : gives
    USER ||--o{ COMMENT : writes
    
    ENTERPRISE {
        bigint id PK
        string name
        string description
        datetime created_at
        datetime updated_at
    }
    
    USER {
        bigint id PK
        bigint enterprise_id FK
        string username
        string email
        string avatar_url
        datetime created_at
        datetime updated_at
    }
    
    CONTENT {
        bigint id PK
        bigint user_id FK
        bigint enterprise_id FK
        text content
        string media_urls
        boolean is_deleted
        datetime created_at
        datetime updated_at
    }
    
    LIKE {
        bigint id PK
        bigint content_id FK
        bigint user_id FK
        datetime created_at
    }
    
    COMMENT {
        bigint id PK
        bigint content_id FK
        bigint user_id FK
        bigint parent_id FK
        text content
        datetime created_at
        datetime updated_at
    }
```

### 查询端数据模型（Redis）

```mermaid
graph LR
    subgraph "Redis数据结构"
        A[enterprise:{id}:timeline<br/>ZSET - 时间线排序]
        B[enterprise:{id}:hot<br/>ZSET - 热门排序]
        C[content:{id}<br/>HASH - 内容详情]
        D[content:{id}:likes<br/>SET - 点赞用户]
        E[content:{id}:comments<br/>LIST - 评论列表]
        F[user:{id}:contents<br/>ZSET - 用户内容]
        G[ranking:24h<br/>ZSET - 24小时热门]
    end
    
    style A fill:#e3f2fd
    style B fill:#fff3e0
    style C fill:#f3e5f5
    style D fill:#e8f5e8
    style E fill:#fce4ec
    style F fill:#fff8e1
    style G fill:#ffebee
```

## 性能优化策略

### 缓存策略

```mermaid
graph TB
    A[用户请求] --> B{L1缓存<br/>本地缓存}
    B -->|命中| C[返回结果]
    B -->|未命中| D{L2缓存<br/>Redis集群}
    D -->|命中| E[更新L1缓存]
    E --> C
    D -->|未命中| F{L3缓存<br/>MySQL从库}
    F -->|命中| G[更新L2缓存]
    G --> E
    F -->|未命中| H[查询主库]
    H --> I[更新所有缓存层]
    I --> C
    
    style B fill:#e8f5e8
    style D fill:#fff3e0
    style F fill:#f3e5f5
```

### 分片策略

```mermaid
graph TB
    subgraph "数据分片策略"
        A[按企业ID分片]
        B[内容表按enterprise_id % N]
        C[用户表按enterprise_id % N]
        D[点赞表按content_id % N]
        E[评论表按content_id % N]
    end
    
    subgraph "缓存分片策略"
        F[Redis集群]
        G[按enterprise_id分片]
        H[热点数据单独缓存]
        I[读写分离]
    end
    
    A --> B
    A --> C
    B --> D
    B --> E
    
    F --> G
    G --> H
    H --> I
    
    style A fill:#4caf50
    style F fill:#2196f3
```

## 技术栈选型

```mermaid
mindmap
  root)企业朋友圈技术栈(
    后端框架
      Spring Boot
      Spring Cloud
      Netty
    数据存储
      MySQL 8.0
      Redis Cluster
      Elasticsearch
      MongoDB
    消息队列
      Apache Kafka
      RabbitMQ
    缓存
      Redis
      Caffeine
      Hazelcast
    搜索
      Elasticsearch
      Apache Solr
    监控
      Prometheus
      Grafana
      Jaeger
      ELK Stack
    部署
      Docker
      Kubernetes
      Jenkins
      Istio
```

## 扩展性考虑

### 水平扩展方案

```mermaid
graph TB
    subgraph "应用层扩展"
        A[负载均衡器]
        B[命令服务集群]
        C[查询服务集群]
        D[排序服务集群]
    end
    
    subgraph "存储层扩展"
        E[MySQL读写分离]
        F[Redis集群]
        G[Kafka分区]
        H[ES集群]
    end
    
    subgraph "缓存层扩展"
        I[多级缓存]
        J[CDN加速]
        K[预热策略]
    end
    
    A --> B
    A --> C
    A --> D
    
    B --> E
    C --> F
    D --> G
    C --> H
    
    F --> I
    H --> J
    I --> K
    
    style A fill:#4caf50
    style E fill:#2196f3
    style I fill:#ff9800
```

## 监控告警

```mermaid
graph LR
    subgraph "监控指标"
        A[QPS/TPS]
        B[响应时间]
        C[错误率]
        D[系统资源]
        E[业务指标]
    end
    
    subgraph "告警策略"
        F[阈值告警]
        G[趋势告警]
        H[异常检测]
        I[业务告警]
    end
    
    subgraph "通知方式"
        J[邮件]
        K[短信]
        L[钉钉/企微]
        M[电话]
    end
    
    A --> F
    B --> G
    C --> H
    D --> F
    E --> I
    
    F --> J
    G --> K
    H --> L
    I --> M
    
    style A fill:#e3f2fd
    style F fill:#fff3e0
    style J fill:#e8f5e8
```

## 部署架构

```mermaid
graph TB
    subgraph "生产环境"
        A[Kubernetes集群]
        B[Istio服务网格]
        C[Prometheus监控]
        D[Grafana可视化]
    end
    
    subgraph "应用服务"
        E[API Gateway Pod]
        F[Command Service Pod]
        G[Query Service Pod]
        H[Ranking Service Pod]
    end
    
    subgraph "存储服务"
        I[MySQL StatefulSet]
        J[Redis Cluster]
        K[Kafka StatefulSet]
        L[Elasticsearch Cluster]
    end
    
    A --> B
    B --> C
    C --> D
    
    B --> E
    B --> F
    B --> G
    B --> H
    
    F --> I
    G --> J
    H --> K
    G --> L
    
    style A fill:#4caf50
    style E fill:#2196f3
    style I fill:#ff9800
```

这个设计完整地实现了基于CQRS的企业朋友圈系统，具备高并发、高可用、易扩展的特点，能够支持1万企业、日增50万内容、500万日活用户的业务规模。