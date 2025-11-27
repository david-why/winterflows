import { sql } from 'bun'

export interface ConfigToken {
  id: number
  access_token: string
  refresh_token: string
  expires_at: number
  user_id: string
}

export async function getConfigToken() {
  const result = await sql<
    ConfigToken[]
  >`SELECT * FROM config_tokens ORDER BY id DESC LIMIT 1`
  return result[0]
}

export async function updateConfigToken(obj: ConfigToken) {
  const payload = { ...obj, id: undefined }
  await sql`UPDATE config_tokens SET ${sql(payload)} WHERE id = ${obj.id}`
}
