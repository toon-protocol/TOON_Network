# Takeover happens on liveness expiry, may briefly run two copies, and carries no state

A warm standby takes over when the primary's liveness has expired on a majority of the primary's relay set. It first publishes a takeover event keyed by the workload id, and the earliest valid takeover event wins among standbys. A primary that loses a majority of its own relay set stops its workload. After a takeover, the standby needs a full-price extension before its current standby interval ends, or it stops the workload.

A crashed primary cannot announce that it stopped, and a partitioned primary cannot know it was replaced. So waiting for the primary's signed stand-down would mean no takeover when a host dies hard. Letting the tenant order the takeover would depend on the tenant being online, which is exactly what a standby should not need. We accept that two copies may run briefly while a partitioned primary notices, as Paygress does.

No workload state moves on takeover: the standby starts from the image. A standby set guarantees the service comes back, not its data. Replicating data is the workload's own job. Streaming encrypted state from primary to standbys is deferred, and checkpoints in Lading were rejected, because they would make every checkpoint permanent public ciphertext.
