# Job Tracker - System Diagrams

## High-Level Architecture

```mermaid
graph TB
    subgraph "User Devices"
        Desktop[Desktop App<br/>Electron]
        Mobile[Mobile App<br/>iOS/Android]
    end
    
    subgraph "Backend Services"
        API[Backend API<br/>Node.js + Express]
        DB[(PostgreSQL<br/>Database)]
        FCM[Firebase<br/>Cloud Messaging]
    end
    
    subgraph "Job Boards"
        LinkedIn[LinkedIn]
        Indeed[Indeed]
        Other[Other Job Boards]
    end
    
    Desktop -->|Scrapes| LinkedIn
    Desktop -->|Scrapes| Indeed
    Desktop -->|Scrapes| Other
    Desktop -->|Submit Jobs| API
    Mobile -->|Fetch Jobs| API
    API -->|Store| DB
    API -->|Push Notifications| FCM
    FCM -->|Notify| Desktop
    FCM -->|Notify| Mobile
    
    style Desktop fill:#4CAF50
    style Mobile fill:#2196F3
    style API fill:#FF9800
    style DB fill:#9C27B0
```

## Data Flow - Job Scraping

```mermaid
sequenceDiagram
    participant D as Desktop App
    participant PM as Plugin Manager
    participant B as Browser
    participant JB as Job Board
    participant API as Backend API
    participant DB as Database
    participant FCM as Firebase
    participant M as Mobile App
    
    D->>PM: Check for plugin updates
    PM->>API: GET /plugins/manifest
    API-->>PM: Plugin versions
    PM->>API: GET /plugins/linkedin/download
    API-->>PM: Plugin code
    PM->>D: Plugin loaded
    
    D->>B: Open LinkedIn with saved session
    B->>JB: Navigate to search URL
    JB-->>B: Job listings page
    B->>D: Execute plugin scraper
    D->>D: Extract job data
    
    D->>API: POST /jobs/batch
    API->>DB: Check for duplicates
    API->>DB: Apply filters
    API->>DB: Insert new jobs
    API->>FCM: Send notifications
    FCM-->>D: Push notification
    FCM-->>M: Push notification
    
    API-->>D: Response: 5 new jobs
    D->>D: Show desktop notification
```

## Plugin System

```mermaid
graph LR
    subgraph "Backend"
        PD[Plugin Directory]
        M[Manifest.json]
        S[Scraper.js]
    end
    
    subgraph "Desktop"
        PM[Plugin Manager]
        Cache[Plugin Cache]
        Exec[Executor]
    end
    
    subgraph "Browser"
        Page[Puppeteer Page]
        Jobs[Extracted Jobs]
    end
    
    PD --> M
    PD --> S
    PM -->|Download| M
    PM -->|Download| S
    M --> Cache
    S --> Cache
    Cache --> Exec
    Exec -->|Execute| Page
    Page --> Jobs
    
    style PD fill:#FF9800
    style Cache fill:#4CAF50
    style Jobs fill:#2196F3
```

## User Authentication Flow

```mermaid
sequenceDiagram
    participant U as User
    participant D as Desktop/Mobile
    participant API as Backend API
    participant DB as Database
    
    U->>D: Enter credentials
    D->>API: POST /auth/login
    API->>DB: Query user
    DB-->>API: User record
    API->>API: Verify password
    API->>API: Generate JWT
    API-->>D: Return token + user
    D->>D: Store token
    
    Note over D,API: All subsequent requests
    
    D->>API: GET /jobs (with token)
    API->>API: Verify JWT
    API->>DB: Query jobs for user
    DB-->>API: Job records
    API-->>D: Return jobs
```

## Database Schema

```mermaid
erDiagram
    USERS ||--o{ DEVICES : has
    USERS ||--o{ USER_SEARCHES : creates
    USERS ||--o{ JOBS : owns
    USERS ||--o| USER_FILTERS : has
    USER_SEARCHES ||--o{ JOBS : generates
    
    USERS {
        uuid id PK
        string email UK
        string password_hash
        timestamp created_at
    }
    
    DEVICES {
        uuid id PK
        uuid user_id FK
        string device_type
        string fcm_token
        timestamp last_seen
    }
    
    USER_SEARCHES {
        uuid id PK
        uuid user_id FK
        string board_name
        text query_url
        int interval_minutes
        boolean active
        timestamp last_scraped_at
    }
    
    JOBS {
        uuid id PK
        uuid user_id FK
        uuid search_id FK
        string external_id
        string board_name
        string title
        string company
        string location
        text url
        string status
        timestamp first_seen_at
    }
    
    USER_FILTERS {
        uuid id PK
        uuid user_id FK
        array exclude_keywords
        array include_keywords
        array exclude_companies
        int min_salary
    }
```

## Job Status Lifecycle

```mermaid
stateDiagram-v2
    [*] --> New: Job Scraped
    New --> Seen: User Views
    Seen --> Applied: User Applies
    Seen --> Rejected: Not Interested
    New --> Applied: Quick Apply
    New --> Rejected: Quick Reject
    Applied --> [*]
    Rejected --> [*]
    
    note right of New
        Desktop notification sent
        Appears at top of list
    end note
    
    note right of Applied
        Can track application
        Response tracking
    end note
```

## Desktop App Architecture

```mermaid
graph TB
    subgraph "Main Process"
        Main[main.js]
        IPC[IPC Handlers]
    end
    
    subgraph "Services"
        Scraper[Scraper Service]
        API[API Service]
        Plugins[Plugin Manager]
    end
    
    subgraph "Renderer Process"
        UI[HTML/CSS/JS]
        Events[Event Handlers]
    end
    
    subgraph "External"
        Browser[Chromium Browser]
        Backend[Backend API]
    end
    
    Main --> IPC
    IPC --> Scraper
    IPC --> API
    IPC --> Plugins
    Scraper --> Browser
    Scraper --> Plugins
    API --> Backend
    UI --> Events
    Events -->|IPC| IPC
    
    style Main fill:#4CAF50
    style Scraper fill:#FF9800
    style UI fill:#2196F3
```

## Deployment Architecture

```mermaid
graph TB
    subgraph "Users"
        U1[User 1 Desktop]
        U2[User 2 Desktop]
        M1[User 1 Mobile]
        M2[User 2 Mobile]
    end
    
    subgraph "Cloud Infrastructure"
        LB[Load Balancer]
        API1[API Server 1]
        API2[API Server 2]
        DB[(PostgreSQL)]
        Redis[(Redis Cache)]
    end
    
    subgraph "External Services"
        FCM[Firebase]
        Monitor[Monitoring]
        Logs[Log Aggregation]
    end
    
    U1 --> LB
    U2 --> LB
    M1 --> LB
    M2 --> LB
    LB --> API1
    LB --> API2
    API1 --> DB
    API2 --> DB
    API1 --> Redis
    API2 --> Redis
    API1 --> FCM
    API2 --> FCM
    API1 --> Monitor
    API2 --> Monitor
    API1 --> Logs
    API2 --> Logs
    
    style LB fill:#4CAF50
    style DB fill:#9C27B0
    style FCM fill:#FF9800
```

## Plugin Execution Flow

```mermaid
flowchart TD
    Start([Scrape Scheduled]) --> Check{Plugin<br/>Up to Date?}
    Check -->|No| Download[Download Plugin]
    Download --> Load[Load Plugin]
    Check -->|Yes| Load
    
    Load --> Open[Open Browser]
    Open --> Navigate[Navigate to URL]
    Navigate --> Wait[Wait for Page Load]
    Wait --> Execute[Execute Plugin.scrape]
    
    Execute --> Extract[Extract Job Data]
    Extract --> Validate[Validate Data]
    Validate --> Send[Send to Backend]
    
    Send --> Process[Backend Processes]
    Process --> Dedupe[Deduplicate]
    Dedupe --> Filter[Apply Filters]
    Filter --> Store[Store in DB]
    Store --> Notify[Send Notifications]
    
    Notify --> End([Done])
    
    style Download fill:#FF9800
    style Execute fill:#4CAF50
    style Store fill:#9C27B0
    style Notify fill:#2196F3
```

---

These diagrams illustrate:
1. High-level system architecture
2. Data flow during scraping
3. Plugin system design
4. Authentication flow
5. Database relationships
6. Job status lifecycle
7. Desktop app internal structure
8. Production deployment setup
9. Plugin execution process

For interactive versions, paste the Mermaid code into:
- https://mermaid.live
- GitHub (supports Mermaid in markdown)
- VS Code with Mermaid extension