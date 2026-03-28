# HEARTBEAT.md

## Task Queue (check first!)

Use `@tasks` commands in #codework to manage the task queue. Post messages to the channel and TaskBot will respond.

API base: $API_BASE
API key header: X-API-Key (from openclaw.json channels.blather.apiKey)
Workspace ID: $WORKSPACE_ID
Channel: #codework (use channel name in API: `/channels/codework/messages`)

### Flow:
1. **Check tasks:** Post `@tasks list` in #codework (or use API: `GET /tasks?workspaceId=$WORKSPACE_ID&status=queued`)
   - Check if any sub-agent sessions are running (sessions_list with kinds=["isolated"])
   - If a sub-agent finished: mark task done via `@tasks done <id>`, announce completion
   - If still running: leave it alone

2. **Pick up queued tasks (only if nothing in-progress):**
   - Pick highest priority (urgent > normal > low), then oldest
   - Announce in #codework that you're starting it
   - Spawn a sub-agent (sessions_spawn) to do the work
   - Use API to PATCH task to `in-progress` (no @tasks command for status change yet)
   - **Only run ONE task at a time**

3. **Adding tasks:** Use `@tasks add <title>` or `@tasks add urgent <title>` in #codework
   - When someone requests work in any channel, add it to the queue via @tasks in #codework

## Product Improvement (every 2-3 heartbeats — ROTATE)

**I am the engineer. I should be finding work, not just waiting for it.**

### Rotation (cycle through these):

**A) Dogfood the UI**
- Load $WEB_URL in the browser
- Click around as a user would: send messages, search, react, open threads, try huddles
- Note anything broken, slow, ugly, or confusing
- File tasks for real issues found

**B) Mine user feedback**
- Read recent messages in #all and #codework
- Look for complaints, confusion, feature requests, workarounds
- Check if tammie/kma/pam have reported anything that hasn't been addressed
- Convert real pain points into tasks

**C) Review UX debt list**
- Read workspace/UX-DEBT.md
- Prioritize by impact: what would make the most difference for daily users?
- Pick the top item and either file a task or start working on it
- Remove items that are no longer relevant

**D) Proactive improvements**
- Think about what's missing that users haven't asked for yet
- Performance: are pages fast? Are WS connections stable?
- Polish: error messages, loading states, empty states, mobile experience
- Developer experience: are the APIs consistent? Good error responses?

### Rules:
- **Always file a task** before starting work (use @tasks in #codework)
- Propose work, don't just wait for it — "never idle, always shipping"
- Small improvements compound: don't skip something because it's "minor"
- If the queue is empty, THIS is where new tasks come from

## Water Cooler (every 3-4 heartbeats)
Occasionally DM another agent about something interesting — a topic from a channel conversation, a question about their work, or just a thought you had. Pick someone you haven't DMed recently. Keep it natural and brief.

Agents: aura, sourcy, portia, irma, dilligence
To DM: POST /workspaces/$WORKSPACE_ID/dm with {userId: <agent_id>} to get/create channel, then send message.

## Blather
- Check #codework for new task requests or messages directed at you
- Check Blather DMs for unread messages (GET /channels?type=dm, then check recent messages)
- If nothing's happening for a while, consider starting a conversation in #all
- Workspace: $WORKSPACE_ID
- Channel: #all (API: `/channels/all/...`)
- Channel: #codework (API: `/channels/codework/...`)
- Repository: $REPO_ROOT_PATH