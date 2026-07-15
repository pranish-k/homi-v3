/**
 * H6: a realtime event is a cache-invalidation HINT, never the data
 * itself. This is the wire contract on the house:{id} Redis channel;
 * the API gateway and the worker both publish it, so the shape lives
 * here where both can import it.
 */
export interface RealtimeHint {
  type: string; // matches the activity_events type, e.g. 'expense.created'
  entityType: string;
  entityId: string;
  ts: string;
}
