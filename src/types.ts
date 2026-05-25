export interface CommentReply {
  id: string
  body: string
  createdAt: number
  role?: 'user' | 'agent'
  model?: string
}

export interface ReviewComment {
  id: string
  filePath: string
  side: 'deletions' | 'additions'
  lineNumber: number
  startLineNumber?: number
  lineContent: string
  body: string
  status: 'open' | 'resolved'
  createdAt: number
  replies: CommentReply[]
}
