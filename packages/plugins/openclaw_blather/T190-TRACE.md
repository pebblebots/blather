# T#190 callback/send-boundary trace

This is an **opt-in diagnostic**, not a suppression fix or a reconstruction of
the May incident. Set `BLATHER_T190_TRACE=1` in a **reviewed canary environment**
to record a `[t190-boundary]` warning only when a turn suppresses a duplicate
final or a transport send fails. It is off by default. Do not deploy or enable
it merely to make a counter look better.

Each warning records the inbound message UUID, a generated dispatch UUID,
channel/thread IDs, callback ordinal and kind, byte length, a 16-hex-character
process-keyed HMAC of each callback text, guard decision, and (only on success)
the server message UUID. At most 32 callbacks are retained per dispatch; the
omitted count is included. The per-process HMAC key is never written to disk,
so hashes are comparable within one process but not across restarts. There are
no reply bodies, tool arguments, API keys, or unbounded per-turn histories.

Keep the flag enabled only for a short, agreed diagnostic window; host journal
retention controls the lifetime of these records. On a reproduced loss,
correlate the dispatch UUID with upstream producer and runner/replyResult
observations, then check the server message UUID and thread against Blather's
API. This plugin trace **cannot** tell whether upstream produced a missing
answer, or whether two different callbacks are duplicate or substantive;
length/digest only distinguish their identities. `approvedFinalCount()` is an
approval count, not a transport success count.

Before a behavioral fix: agree an upstream one-final/turn-completion contract,
keep T#178 cascade protections, and test one final, block→final, distinct
final→final, failed first send, and genuine duplicate finals. A naive
"last wins" policy cannot retract an already-sent first final.
