# 企业朋友圈系统设计方案

## 1. 系统整体架构

```mermaid
graph TB
    subgraph "客户端层"
        A[Web前端] 
        B[移动端App]
        C[小程序]
    end
    
    subgraph "网关层"
        D[Nginx负载均衡]
        E[API Gateway]
    end
    
    subgraph "应用层"
        F[用户服务]
        G[内容服务] 
        H[点赞服务]
        I[评论服务]
        J[推送服务]
    end
    
    subgraph "数据层"
        K[(PostgreSQL主库)]
        L[(PostgreSQL从库)]
        M[(Redis缓存)]
        N[(Elasticsearch)]
    end
    
    subgraph "基础设施"
        O[消息队列MQ]
        P[定时任务调度]
        Q[文件存储OSS]
        R[监控告警]
    end
    
    A --> D
    B --> D  
    C --> D
    D --> E
    E --> F
    E --> G
    E --> H
    E --> I
    F --> K
    G --> K
    H --> M
    I --> K
    G --> L
    F --> M
    G --> N
    O --> P
    G --> Q
    
    style K fill:#ff9999
    style M fill:#99ccff
    style O fill:#99ff99
```

## 2. 数据库设计

### 2.1 ER图

```mermaid
erDiagram
    Enterprise {
        string id PK
        string name
        string domain
        datetime created_at
        datetime updated_at
    }
    
    User {
        string id PK
        string email
        string password
        string name
        string avatar
        string enterprise_id FK
        enum role
        boolean is_active
        datetime created_at
        datetime updated_at
    }
    
    Post {
        string id PK
        text content
        json images
        string author_id FK
        string enterprise_id FK
        int like_count
        int comment_count
        boolean is_pinned
        datetime pinned_at
        datetime created_at
        datetime updated_at
    }
    
    Like {
        string id PK
        string user_id FK
        string post_id FK
        datetime created_at
    }
    
    Comment {
        string id PK
        text content
        string author_id FK
        string post_id FK
        datetime created_at
        datetime updated_at
    }
    
    Enterprise ||--o{ User : "employs"
    Enterprise ||--o{ Post : "contains"
    User ||--o{ Post : "creates"
    User ||--o{ Like : "gives"
    User ||--o{ Comment : "writes"
    Post ||--o{ Like : "receives"
    Post ||--o{ Comment : "has"
```

### 2.2 核心表结构

#### 企业表 (enterprises)
| 字段 | 类型 | 说明 | 索引 |
|------|------|------|------|
| id | VARCHAR(30) | 主键 | PRIMARY |
| name | VARCHAR(100) | 企业名称 | UNIQUE |
| domain | VARCHAR(100) | 企业域名 | UNIQUE |
| created_at | TIMESTAMP | 创建时间 | - |

#### 用户表 (users)  
| 字段 | 类型 | 说明 | 索引 |
|------|------|------|------|
| id | VARCHAR(30) | 主键 | PRIMARY |
| email | VARCHAR(100) | 邮箱 | UNIQUE |
| enterprise_id | VARCHAR(30) | 企业ID | INDEX |
| name | VARCHAR(50) | 用户名 | - |
| role | ENUM | 角色(ADMIN/EMPLOYEE) | - |

#### 内容表 (posts)
| 字段 | 类型 | 说明 | 索引 |
|------|------|------|------|
| id | VARCHAR(30) | 主键 | PRIMARY |
| content | TEXT | 内容 | - |
| author_id | VARCHAR(30) | 作者ID | - |
| enterprise_id | VARCHAR(30) | 企业ID | INDEX |
| like_count | INT | 点赞数 | - |
| is_pinned | BOOLEAN | 是否置顶 | - |
| created_at | TIMESTAMP | 创建时间 | INDEX |

**复合索引策略：**
- `(enterprise_id, created_at)` - 企业内容时间排序
- `(enterprise_id, is_pinned, like_count)` - 置顶内容排序
- `(created_at, like_count)` - 自动置顶计算

## 3. 自动置顶算法设计

### 3.1 置顶算法流程图

```mermaid
flowchart TD
    A[定时任务启动<br/>每5分钟执行] --> B[查询24小时内发布的内容]
    B --> C[筛选点赞数≥10的内容]
    C --> D[按点赞数降序排列]
    D --> E[取前3名]
    E --> F[检查当前置顶状态]
    F --> G{是否有变化?}
    G -->|是| H[更新置顶状态]
    G -->|否| I[结束]
    H --> J[清除旧置顶]
    J --> K[设置新置顶]
    K --> L[更新缓存]
    L --> M[推送实时更新]
    M --> I
```

### 3.2 置顶算法实现逻辑

```sql
-- 查询候选置顶内容
SELECT id, like_count, created_at 
FROM posts 
WHERE enterprise_id = ? 
  AND created_at >= NOW() - INTERVAL '24 HOURS'
  AND like_count >= 10
ORDER BY like_count DESC, created_at DESC
LIMIT 3;

-- 更新置顶状态
UPDATE posts 
SET is_pinned = false, pinned_at = null 
WHERE enterprise_id = ? AND is_pinned = true;

UPDATE posts 
SET is_pinned = true, pinned_at = NOW() 
WHERE id IN (?, ?, ?);
```

## 4. 系统交互时序图

### 4.1 发布内容流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant API as API网关
    participant CS as 内容服务
    participant DB as 数据库
    participant Cache as Redis缓存
    participant MQ as 消息队列
    
    U->>API: 发布内容请求
    API->>CS: 验证权限
    CS->>DB: 保存内容到数据库
    DB-->>CS: 返回内容ID
    CS->>Cache: 更新企业动态缓存
    CS->>MQ: 发送内容推送消息
    CS-->>API: 返回发布结果
    API-->>U: 发布成功
    
    MQ->>CS: 异步处理推送
    CS->>U: WebSocket实时推送给企业用户
```

### 4.2 点赞和置顶流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant API as API网关  
    participant LS as 点赞服务
    participant DB as 数据库
    participant Cache as Redis缓存
    participant Job as 定时任务
    
    U->>API: 点赞请求
    API->>LS: 处理点赞
    LS->>DB: 更新点赞记录
    LS->>DB: 更新内容点赞数
    LS->>Cache: 更新缓存计数
    LS-->>API: 返回点赞结果
    API-->>U: 点赞成功
    
    Note over Job: 每5分钟执行
    Job->>DB: 查询24h内高赞内容
    Job->>DB: 更新置顶状态
    Job->>Cache: 刷新置顶缓存
    Job->>U: WebSocket推送置顶变化
```

## 5. 核心功能设计

### 5.1 权限控制设计

```mermaid
graph LR
    A[用户登录] --> B{验证企业身份}
    B -->|同企业| C[可见企业内容]
    B -->|非同企业| D[无权限访问]
    C --> E[发布内容]
    C --> F[点赞评论]
    C --> G[删除自己内容]
    
    subgraph "管理员权限"
        H[删除任意内容]
        I[管理企业设置]
    end
    
    E --> H
    F --> H
    G --> I
```

### 5.2 内容可见性规则

| 角色 | 查看权限 | 发布权限 | 删除权限 | 管理权限 |
|------|----------|----------|----------|----------|
| 企业员工 | 同企业内容 | ✓ | 自己的内容 | ✗ |
| 企业管理员 | 同企业内容 | ✓ | 所有企业内容 | ✓ |
| 其他企业用户 | ✗ | ✗ | ✗ | ✗ |

## 6. 高并发和性能优化方案

### 6.1 缓存策略

```mermaid
graph TD
    A[用户请求] --> B{缓存命中?}
    B -->|命中| C[返回缓存数据]
    B -->|未命中| D[查询数据库]
    D --> E[更新缓存]
    E --> F[返回数据]
    
    subgraph "缓存层级"
        G[L1: 应用内存缓存<br/>热点数据 5分钟]
        H[L2: Redis缓存<br/>企业动态 30分钟]
        I[L3: CDN缓存<br/>静态资源 24小时]
    end
    
    C --> G
    E --> H
    F --> I
```

### 6.2 数据分片策略

```mermaid
graph TB
    subgraph "分片策略"
        A[按企业ID分片]
        B[按时间分片]
        C[按地理位置分片]
    end
    
    subgraph "分片规则"
        D[主分片: enterprise_id % 16]
        E[时间分片: YYYY-MM 月表]
        F[读写分离: 主从复制]
    end
    
    A --> D
    B --> E
    C --> F
    
    subgraph "分片优势"
        G[单企业查询性能优化]
        H[历史数据归档]
        I[读写性能分离]
    end
    
    D --> G
    E --> H
    F --> I
```

## 7. 系统容量规划

### 7.1 数据量估算

| 维度 | 数值 | 计算依据 |
|------|------|----------|
| 企业数量 | 1万 | 给定 |
| 日活用户 | 500万 | 给定，平均每企业500用户 |
| 日新增内容 | 50万条 | 给定 |
| 年内容总量 | 1.8亿条 | 50万 × 365天 |
| 单条内容存储 | ~2KB | 文本+元数据 |
| 年存储需求 | ~360GB | 1.8亿 × 2KB |

### 7.2 性能指标设计

```mermaid
graph LR
    subgraph "响应时间要求"
        A[内容列表: <200ms]
        B[发布内容: <500ms]
        C[点赞操作: <100ms]
        D[置顶计算: <30s]
    end
    
    subgraph "并发能力"
        E[QPS: 10000+]
        F[并发用户: 50万]
        G[峰值倍数: 3倍]
    end
    
    subgraph "可用性"
        H[系统可用性: 99.9%]
        I[数据一致性: 最终一致]
        J[故障恢复: <5分钟]
    end
```

## 8. 核心算法设计

### 8.1 置顶算法详细设计

```mermaid
flowchart TD
    A[定时任务触发<br/>每5分钟] --> B[获取所有企业列表]
    B --> C[并行处理各企业]
    
    subgraph "单企业处理流程"
        D[查询24小时内容<br/>like_count >= 10] --> E[按点赞数排序]
        E --> F[取前3名候选]
        F --> G[对比当前置顶]
        G --> H{置顶列表有变化?}
        H -->|是| I[执行置顶更新]
        H -->|否| J[跳过更新]
        I --> K[清除旧置顶标记]
        K --> L[设置新置顶标记]
        L --> M[更新Redis缓存]
        M --> N[WebSocket推送变化]
    end
    
    C --> D
    N --> O[处理完成]
    J --> O
```

### 8.2 置顶算法优化策略

| 优化点 | 策略 | 效果 |
|--------|------|------|
| 查询优化 | 预计算热门内容 | 减少实时计算压力 |
| 缓存策略 | Redis存储置顶结果 | 快速响应查询 |
| 批量处理 | 企业级并行处理 | 提高处理效率 |
| 增量更新 | 只更新有变化的企业 | 减少无效操作 |

## 9. API接口设计

### 9.1 核心接口规范

```mermaid
graph TB
    subgraph "用户认证"
        A[POST /auth/login<br/>用户登录]
        B[POST /auth/register<br/>用户注册]
        C[GET /auth/profile<br/>获取用户信息]
    end
    
    subgraph "内容管理"
        D[GET /posts<br/>获取企业动态列表]
        E[POST /posts<br/>发布新内容]
        F[DELETE /posts/:id<br/>删除内容]
        G[GET /posts/:id<br/>获取内容详情]
    end
    
    subgraph "互动功能"
        H[POST /posts/:id/like<br/>点赞/取消点赞]
        I[GET /posts/:id/likes<br/>获取点赞列表]
        J[POST /posts/:id/comments<br/>发布评论]
        K[GET /posts/:id/comments<br/>获取评论列表]
    end
```

### 9.2 接口响应格式

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "posts": [
      {
        "id": "post_123",
        "content": "企业动态内容",
        "images": ["url1", "url2"],
        "author": {
          "id": "user_456",
          "name": "张三",
          "avatar": "avatar_url"
        },
        "like_count": 15,
        "comment_count": 3,
        "is_pinned": true,
        "has_liked": false,
        "created_at": "2024-01-15T10:30:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "size": 20,
      "total": 100,
      "has_more": true
    }
  }
}
```

## 10. 实时推送设计

### 10.1 WebSocket架构

```mermaid
graph TB
    subgraph "WebSocket服务"
        A[WebSocket Gateway]
        B[连接管理器]
        C[消息路由器]
    end
    
    subgraph "推送类型"
        D[新内容推送]
        E[点赞数更新]
        F[置顶状态变化]
        G[评论通知]
    end
    
    subgraph "推送策略"
        H[企业级房间隔离]
        I[用户在线状态检测]
        J[消息去重和合并]
    end
    
    A --> B
    B --> C
    C --> D
    C --> E
    C --> F
    C --> G
    
    B --> H
    C --> I
    C --> J
```

## 11. 性能优化方案

### 11.1 读写分离架构

```mermaid
graph LR
    subgraph "写操作"
        A[发布内容] --> B[主数据库]
        C[点赞操作] --> B
        D[评论操作] --> B
    end
    
    subgraph "读操作"
        E[内容列表] --> F[从数据库]
        G[内容详情] --> F
        H[用户信息] --> F
    end
    
    subgraph "缓存层"
        I[Redis热点数据]
        J[CDN静态资源]
    end
    
    B --> F
    F --> I
    E --> I
    G --> J
```

### 11.2 缓存策略详细设计

| 缓存类型 | 存储内容 | 过期时间 | 更新策略 |
|----------|----------|----------|----------|
| 热点内容 | 置顶帖子、热门帖子 | 30分钟 | 写入时更新 |
| 用户信息 | 用户基本信息 | 1小时 | 修改时失效 |
| 企业动态 | 最新20条动态 | 15分钟 | 新发布时更新 |
| 点赞计数 | 实时点赞数 | 5分钟 | 点赞时增量更新 |

## 12. 扩展性设计

### 12.1 微服务拆分方案

```mermaid
graph TB
    subgraph "用户服务"
        A[用户管理]
        B[企业管理]
        C[权限验证]
    end
    
    subgraph "内容服务"
        D[内容发布]
        E[内容查询]
        F[内容删除]
    end
    
    subgraph "互动服务"
        G[点赞服务]
        H[评论服务]
        I[置顶计算]
    end
    
    subgraph "推送服务"
        J[实时推送]
        K[离线推送]
        L[消息队列]
    end
    
    A --> D
    C --> E
    G --> I
    I --> J
    D --> L
    G --> L
```

### 12.2 数据库分片策略

```mermaid
graph TB
    subgraph "分片维度"
        A[按企业ID分片<br/>enterprise_id % 16]
        B[按时间分片<br/>按月分表]
        C[按地理区域分片<br/>就近访问]
    end
    
    subgraph "分片优势"
        D[单企业查询性能优化]
        E[历史数据冷热分离]
        F[跨地域访问优化]
    end
    
    A --> D
    B --> E  
    C --> F
    
    subgraph "分片挑战"
        G[跨分片查询复杂]
        H[数据迁移困难]
        I[事务一致性问题]
    end
    
    D --> G
    E --> H
    F --> I
```

## 13. 监控和运维

### 13.1 关键指标监控

```mermaid
graph TB
    subgraph "业务指标"
        A[日活用户数]
        B[内容发布量]
        C[点赞互动率]
        D[置顶命中率]
    end
    
    subgraph "技术指标"
        E[API响应时间]
        F[数据库QPS]
        G[缓存命中率]
        H[WebSocket连接数]
    end
    
    subgraph "系统指标"
        I[CPU使用率]
        J[内存使用率]
        K[磁盘IO]
        L[网络带宽]
    end
    
    subgraph "告警策略"
        M[响应时间>500ms]
        N[错误率>1%]
        O[缓存命中率<80%]
        P[CPU使用率>80%]
    end
    
    E --> M
    F --> N
    G --> O
    I --> P
```

## 14. 部署架构

### 14.1 生产环境部署图

```mermaid
graph TB
    subgraph "负载均衡层"
        A[Nginx LB]
        B[CDN]
    end
    
    subgraph "应用层集群"
        C[API Server 1]
        D[API Server 2]
        E[API Server N]
    end
    
    subgraph "数据层"
        F[PostgreSQL Master]
        G[PostgreSQL Slave 1]
        H[PostgreSQL Slave 2]
        I[Redis Cluster]
    end
    
    subgraph "基础设施"
        J[RabbitMQ Cluster]
        K[Elasticsearch]
        L[File Storage]
        M[Monitoring]
    end
    
    A --> C
    A --> D
    A --> E
    C --> F
    D --> G
    E --> H
    C --> I
    D --> I
    E --> I
    
    style F fill:#ff9999
    style I fill:#99ccff
    style J fill:#99ff99
```

这个设计方案涵盖了企业朋友圈的核心功能、性能优化、扩展性考虑和运维监控，能够支撑1万企业、500万日活用户和50万日新增内容的业务规模。

<function_calls>
<invoke name="todo_write">
<parameter name="merge">true