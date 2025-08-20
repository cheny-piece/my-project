# Enterprise Social Feed System (WeChat-like)

## System Overview
A scalable enterprise social feed system supporting:
- Enterprise user post creation/deletion
- Company-based visibility (only same company members can see posts)
- Like functionality with auto-pinning for top posts
- Optional comment system
- High performance for 10k enterprises, 500k daily posts, 5M DAU

## Architecture
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL with Redis for caching
- **Frontend**: React + TypeScript
- **Real-time**: WebSocket for live updates

## Key Features
1. **Post Management**: Create, delete, view posts within enterprise
2. **Visibility Control**: Company-based access control
3. **Auto-Pinning**: Top 3 posts (10+ likes, within 24h) auto-pinned by like count
4. **Scalability**: Optimized for high-volume usage

## Performance Considerations
- Database indexing for enterprise_id, created_at, like_count
- Redis caching for hot data (pinned posts, recent posts)
- Pagination for large feeds
- Background jobs for auto-pinning calculations