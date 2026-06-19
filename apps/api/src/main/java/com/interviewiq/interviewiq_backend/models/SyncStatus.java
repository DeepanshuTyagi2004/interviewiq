package com.interviewiq.interviewiq_backend.models;

/**
 * Lifecycle of a source connection's background collection.
 *
 * <ul>
 *   <li>{@code SYNCING}  – collection is in progress (set the moment a connect is accepted).</li>
 *   <li>{@code SYNCED}   – last collection succeeded and the fragment is current.</li>
 *   <li>{@code FAILED}   – last collection failed (network/unexpected); the fragment, if any, is left untouched.</li>
 *   <li>{@code DEGRADED} – the upstream profile became unavailable (e.g. went private after connect);
 *       we keep the last-known-good fragment rather than dropping data.</li>
 * </ul>
 */
public enum SyncStatus {
    SYNCING,
    SYNCED,
    FAILED,
    DEGRADED
}
