export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  enterpriseId: string;
  role: 'ADMIN' | 'EMPLOYEE';
}

export interface Post {
  id: string;
  content: string;
  images: string[];
  authorId: string;
  enterpriseId: string;
  likeCount: number;
  commentCount: number;
  isPinned: boolean;
  pinnedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  author: User;
  hasLiked?: boolean;
}

export interface Like {
  id: string;
  userId: string;
  postId: string;
  createdAt: Date;
}

export interface Comment {
  id: string;
  content: string;
  authorId: string;
  postId: string;
  createdAt: Date;
  author: User;
}

export interface CreatePostRequest {
  content: string;
  images?: string[];
}

export interface AuthRequest extends Express.Request {
  user?: User;
}