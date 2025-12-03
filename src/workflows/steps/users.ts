import { defineStep } from '.'
import slack from '../../clients/slack'
import type { ExecutionContext } from '../context'

async function addToUserGroup(
  ctx: ExecutionContext,
  { user, group }: { user: string; group: string }
) {
  const res = await slack.usergroups.users.list({
    token: ctx.token,
    usergroup: group,
  })
  const users = res.users!
  users.push(user)
  await slack.usergroups.users.update({
    token: ctx.token,
    usergroup: group,
    users: users.join(','),
  })
  return {}
}

export default {
  'usergroup-add': defineStep(addToUserGroup, {
    name: 'Add user to a user group',
    category: 'Users',
    inputs: {
      user: { name: 'User', type: 'user', required: true },
      group: { name: 'User group', type: 'usergroup', required: true },
    },
    outputs: {},
  }),
}
