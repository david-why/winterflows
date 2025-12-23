import { sql } from 'bun'
import type { User } from '../database/users'

export async function authenticateRequest(req: Request): Promise<User | null> {
  const authHeader = req.headers.get('Authorization')

  if (!authHeader?.startsWith('Bearer ')) return null

  const apiKey = authHeader.slice(7)
  const users = await sql<User[]>`SELECT * FROM users WHERE api_key = ${apiKey}`
  return users[0] || null
}

export function unauthorizedResponse() {
  return Response.json(
    {
      error: {
        code: 'authentication_failed',
        message: 'Invalid or missing API key',
      },
    },
    { status: 401 }
  )
}

export function forbiddenResponse() {
  return Response.json(
    {
      error: {
        code: 'authorization_failed',
        message: 'User does not have permission',
      },
    },
    { status: 403 }
  )
}

export function notFoundResponse(message = 'Resource not found') {
  return Response.json(
    {
      error: {
        code: 'not_found',
        message,
      },
    },
    { status: 404 }
  )
}

export function badRequestResponse(message: string, details?: any) {
  return Response.json(
    {
      error: {
        code: 'invalid_request',
        message,
        ...(details && { details }),
      },
    },
    { status: 400 }
  )
}

export function conflictResponse(message: string) {
  return Response.json(
    {
      error: {
        code: 'conflict',
        message,
      },
    },
    { status: 409 }
  )
}

export function validationErrorResponse(message: string, details?: any) {
  return Response.json(
    {
      error: {
        code: 'validation_error',
        message,
        ...(details && { details }),
      },
    },
    { status: 422 }
  )
}
