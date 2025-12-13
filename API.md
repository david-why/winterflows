# Winterflows API Documentation

## Overview

The Winterflows API provides programmatic access to workflow management. Authenticate using API keys obtained via the `/winterflows-api` Slack command.

**Base URL:** `/api/v1`

## Authentication

Include your API key in the `Authorization` header:

```
Authorization: Bearer <your_api_key>
```

Get your API key by running `/winterflows-api` in Slack.

## Workflows

### List Workflows

```
GET /api/v1/workflows
```

**Query Parameters:**

- `limit` (optional, max 100, default 50)
- `offset` (optional, default 0)
- `sort` (optional): `created_asc`, `created_desc`, `name_asc`, `name_desc`

**Response:**

```json
{
  "workflows": [
    {
      "id": 1,
      "name": "Daily Standup",
      "description": "Morning reminders",
      "created_at": "2025-12-01T10:00:00Z",
      "is_installed": true,
      "trigger": { "type": "cron", "schedule": "0 9 * * 1-5" },
      "step_count": 3
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0,
  "has_more": false
}
```

### Get Workflow

```
GET /api/v1/workflows/:id
```

**Response:**

```json
{
  "id": 1,
  "name": "Daily Standup",
  "description": "Morning reminders",
  "creator_user_id": "U12345678",
  "app_id": "A98765432",
  "is_installed": true,
  "created_at": "2025-12-01T10:00:00Z",
  "trigger": { "type": "cron", "schedule": "0 9 * * 1-5" },
  "steps": [
    {
      "id": "step_1",
      "type_id": "send_message",
      "inputs": {
        "channel_id": "C12345678",
        "message": "Good morning!"
      }
    }
  ]
}
```

### Create Workflow

```
POST /api/v1/workflows
```

**Request:**

```json
{
  "name": "Daily Standup",
  "description": "Morning reminders",
  "steps": [
    {
      "id": "step_1",
      "type_id": "send_message",
      "inputs": {
        "channel_id": "C12345678",
        "message": "Good morning!"
      }
    }
  ],
  "trigger": {
    "type": "cron",
    "schedule": "0 9 * * 1-5"
  }
}
```

**Response:** `201 Created`

```json
{
  "id": 1,
  "name": "Daily Standup",
  "installation_url": "https://slack.com/oauth/v2/authorize?...",
  ...
}
```

### Update Workflow

```
PATCH /api/v1/workflows/:id
```

**Request (all fields optional):**

```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "steps": [...],
  "trigger": { "type": "cron", "schedule": "0 10 * * *" }
}
```

### Delete Workflow

```
DELETE /api/v1/workflows/:id?force=false
```

**Query Parameters:**

- `force` (optional, default false) - Delete even with active executions

**Response:** `204 No Content`

## Executions

### List Workflow Executions

```
GET /api/v1/workflows/:id/executions
```

**Query Parameters:**

- `limit` (optional, max 100, default 50)
- `offset` (optional, default 0)
- `status` (optional): `running`, `completed`, `failed`, `cancelled`
- `from` (optional, ISO 8601 timestamp)
- `to` (optional, ISO 8601 timestamp)

**Response:**

```json
{
  "executions": [
    {
      "id": 42,
      "workflow_id": 1,
      "trigger_user_id": "U12345678",
      "status": "completed",
      "started_at": "2025-12-11T14:30:00Z",
      "current_step": 3,
      "total_steps": 3,
      "trigger_type": "manual"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0,
  "has_more": false
}
```

### Get Execution Details

```
GET /api/v1/executions/:execution_id
```

**Response:**

```json
{
  "id": 42,
  "workflow_id": 1,
  "workflow_name": "Daily Standup",
  "trigger_user_id": "U12345678",
  "status": "completed",
  "started_at": "2025-12-11T14:30:00Z",
  "trigger_type": "manual",
  "steps": [
    {
      "id": "step_1",
      "type_id": "send_message",
      "status": "completed",
      "output": "Message sent"
    }
  ],
  "context": {},
  "outputs": {
    "step_1": "Message sent"
  }
}
```

### Cancel Execution

```
POST /api/v1/executions/:execution_id/cancel
```

**Response:**

```json
{
  "id": 42,
  "status": "cancelled",
  "cancelled_at": "2025-12-11T14:30:03Z"
}
```

## Triggers

**Note:** Each workflow can have only one trigger. Updating replaces the existing trigger.

### Get Workflow Trigger

```
GET /api/v1/workflows/:id/trigger
```

**Response:**

```json
{
  "workflow_id": 1,
  "type": "cron",
  "schedule": "0 9 * * 1-5"
}
```

### Update Workflow Trigger

```
PUT /api/v1/workflows/:id/trigger
```

**Trigger Types:**

Cron:

```json
{
  "type": "cron",
  "schedule": "0 10 * * 1-5"
}
```

Message (on message sent):

```json
{
  "type": "message",
  "channel_id": "C12345678"
}
```

Reaction (on emoji added):

```json
{
  "type": "reaction",
  "channel_id": "C12345678",
  "emoji": "fire"
}
```

Member join (on user joins channel):

```json
{
  "type": "member_join",
  "channel_id": "C12345678"
}
```

Manual only:

```json
{
  "type": "none"
}
```

### Delete Workflow Trigger

```
DELETE /api/v1/workflows/:id/trigger
```

Sets trigger to manual only (`type: "none"`).

**Response:** `204 No Content`

## Metadata

### List Step Types

```
GET /api/v1/steps/types
```

**Response:**

```json
{
  "steps": [
    {
      "type_id": "send_message",
      "name": "Send Message",
      "category": "messages",
      "inputs": {
        "channel_id": {
          "type": "string",
          "required": true,
          "description": "Channel ID to send message to"
        },
        "message": {
          "type": "string",
          "required": true,
          "description": "Message text"
        }
      },
      "outputs": {
        "message_ts": {
          "type": "string",
          "description": "Timestamp of sent message"
        }
      }
    }
  ]
}
```

### Get Workflow Statistics

```
GET /api/v1/workflows/:id/stats
```

**Query Parameters:**

- `from` (optional, ISO 8601 timestamp)
- `to` (optional, ISO 8601 timestamp)

**Response:**

```json
{
  "workflow_id": 1,
  "period": {
    "from": "2025-12-01T00:00:00Z",
    "to": "2025-12-11T23:59:59Z"
  },
  "total_executions": 50,
  "successful_executions": 48,
  "failed_executions": 2,
  "average_duration_ms": 3500
}
```

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "error_code",
    "message": "Human readable message",
    "details": {}
  }
}
```

**Error Codes:**

- `authentication_failed` (401) - Invalid/missing API key
- `authorization_failed` (403) - No permission
- `not_found` (404) - Resource not found
- `invalid_request` (400) - Bad request
- `validation_error` (422) - Validation failed
- `conflict` (409) - Resource conflict

## Examples

### cURL

List workflows:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://winterflows.davidwhy.me/api/v1/workflows
```

Create workflow:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Workflow","steps":[]}' \
  https://winterflows.davidwhy.me/api/v1/workflows
```

### JavaScript

```javascript
const apiKey = 'your_api_key'
const baseUrl = 'https://winterflows.davidwhy.me/api/v1'

const response = await fetch(`${baseUrl}/workflows`, {
  headers: {
    Authorization: `Bearer ${apiKey}`,
  },
})

const data = await response.json()
console.log(data.workflows)
```

### Python

```python
import requests

api_key = 'your_api_key'
base_url = 'https://winterflows.davidwhy.me/api/v1'

headers = {'Authorization': f'Bearer {api_key}'}
response = requests.get(f'{base_url}/workflows', headers=headers)
workflows = response.json()['workflows']
```

## Pagination

List endpoints (`/workflows`, `/workflows/:id/executions`) support offset-based pagination:

**Request:**

```
GET /api/v1/workflows?limit=50&offset=100
```

**Response includes:**

- `total` - Total number of items
- `limit` - Items per page (max 100, default 50)
- `offset` - Current offset
- `has_more` - Boolean indicating if more items exist

**Example:**

```json
{
  "workflows": [...],
  "total": 250,
  "limit": 50,
  "offset": 100,
  "has_more": true
}
```
