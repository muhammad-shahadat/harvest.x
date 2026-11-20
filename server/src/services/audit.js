// One helper to write an audit row (FR-36). Call it INSIDE the same transaction as the action it records,
// so the action and its audit row either both happen or neither does.
async function audit(c, actorId, action, entityType, entityId, reason, metadata) {
  await c.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, metadata) VALUES ($1,$2,$3,$4,$5,$6)`,
    [actorId, action, entityType, String(entityId), reason || null, metadata ? JSON.stringify(metadata) : null]);
}

module.exports = { audit };
