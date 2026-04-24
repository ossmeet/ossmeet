import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

const PLAN_VALUES = ["free", "pro", "org"] as const;
const SUBSCRIPTION_STATUS_VALUES = ["active", "canceled", "past_due", "trialing", "paused"] as const;
const USER_ROLE_VALUES = ["admin", "user"] as const;
const VERIFICATION_TYPE_VALUES = [
  "otp_signup",
  "otp_login",
  "otp_account_delete",
  "oauth_pkce",
  "passkey_register",
  "passkey_auth",
] as const;
const PASSKEY_DEVICE_TYPE_VALUES = ["singleDevice", "multiDevice"] as const;
const SPACE_ROLE_VALUES = ["owner", "admin", "member"] as const;
const SPACE_INVITE_ROLE_VALUES = ["admin", "member"] as const;
const ROOM_TYPE_VALUES = ["instant", "permanent"] as const;
const MEETING_ROLE_VALUES = ["host", "participant", "guest"] as const;
const MEETING_STATUS_VALUES = ["active", "ended"] as const;
const MEETING_PARTICIPANT_STATUS_VALUES = [
  "awaiting_approval",
  "pending",
  "active",
  "left",
  "aborted",
  "denied",
] as const;
const SPACE_ASSET_TYPE_VALUES = ["pdf"] as const;
const MEETING_ARTIFACT_TYPE_VALUES = [
  "recording",
  "whiteboard_snapshot",
  "whiteboard_state",
  "whiteboard_pdf",
] as const;
const JSON_TEXT_MAX_LENGTH = 32_768;

function oneOf(column: unknown, values: readonly string[]) {
  return sql`${column} in (${sql.join(
    values.map((value) => sql.raw(`'${value.replace(/'/g, "''")}'`)),
    sql.raw(", "),
  )})`;
}

function requiredTrimmedTextLength(column: unknown, max: number) {
  return sql`length(${column}) <= ${sql.raw(String(max))} AND length(trim(${column})) BETWEEN 1 AND ${sql.raw(String(max))}`;
}

function optionalTextLength(column: unknown, max: number) {
  return sql`${column} IS NULL OR length(${column}) <= ${sql.raw(String(max))}`;
}

function optionalExactTextLength(column: unknown, length: number) {
  return sql`${column} IS NULL OR length(${column}) = ${sql.raw(String(length))}`;
}

function meetingCodeShape(column: unknown) {
  const letterPositions = [1, 2, 3, 5, 6, 7, 8, 10, 11, 12];
  const letterChecks = sql.join(
    letterPositions.map((position) => sql`substr(${column}, ${sql.raw(String(position))}, 1) BETWEEN 'a' AND 'z'`),
    sql.raw(" AND "),
  );

  // Avoid SQLite GLOB here: D1 can reject this specific pattern in CHECK constraints
  // with "LIKE or GLOB pattern too complex" during inserts. Explicit position checks
  // preserve the same xxx-xxxx-xxx contract without relying on GLOB.
  return sql`
    length(${column}) = 12
    AND substr(${column}, 4, 1) = '-'
    AND substr(${column}, 9, 1) = '-'
    AND lower(${column}) = ${column}
    AND ${letterChecks}
  `;
}

// ============================================================================
// AUTHENTICATION TABLES
// ============================================================================
// All UPDATE operations must explicitly set `updatedAt: new Date()` in the set clause.

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    normalizedEmail: text("normalized_email").notNull().unique(),
    image: text("image"),
    plan: text("plan", { enum: PLAN_VALUES })
      .default("free")
      .notNull(),
    paddleCustomerId: text("paddle_customer_id"),
    paddleSubscriptionId: text("paddle_subscription_id"),
    subscriptionStatus: text("subscription_status", { enum: SUBSCRIPTION_STATUS_VALUES }),
    role: text("role", { enum: USER_ROLE_VALUES })
      .default("user")
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check("users_name_length_check", requiredTrimmedTextLength(table.name, 100)),
    check("users_email_length_check", sql`length(${table.email}) <= 320`),
    check("users_normalized_email_length_check", sql`length(${table.normalizedEmail}) <= 320`),
    check("users_image_length_check", optionalTextLength(table.image, 2048)),
    check("users_updated_after_created_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    check("users_plan_check", oneOf(table.plan, PLAN_VALUES)),
    check("users_role_check", oneOf(table.role, USER_ROLE_VALUES)),
    index("users_paddle_customer_id_idx").on(table.paddleCustomerId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    previousTokenHash: text("previous_token_hash"),
    rotationVersion: integer("rotation_version").notNull().default(0),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    // Hard cap — never renewed regardless of activity. Prevents indefinite
    // session persistence from a stolen cookie.
    absoluteExpiresAt: integer("absolute_expires_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
    index("sessions_absolute_expires_at_idx").on(table.absoluteExpiresAt),
    index("sessions_previous_token_hash_idx").on(table.previousTokenHash),
    check("sessions_token_hash_length_check", sql`length(${table.tokenHash}) = 64`),
    check("sessions_previous_token_hash_length_check", optionalExactTextLength(table.previousTokenHash, 64)),
    check("sessions_expires_after_created_check", sql`${table.expiresAt} >= ${table.createdAt}`),
    check(
      "sessions_absolute_expires_after_expires_check",
      sql`${table.absoluteExpiresAt} >= ${table.expiresAt}`,
    ),
    check(
      "sessions_last_seen_after_created_check",
      sql`${table.lastSeenAt} IS NULL OR ${table.lastSeenAt} >= ${table.createdAt}`,
    ),
    check("sessions_ip_address_length_check", optionalTextLength(table.ipAddress, 64)),
    check("sessions_user_agent_length_check", optionalTextLength(table.userAgent, 500)),
  ]
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    linkedAt: integer("linked_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("accounts_user_id_idx").on(table.userId),
    uniqueIndex("accounts_provider_account_idx").on(
      table.providerId,
      table.providerAccountId
    ),
    uniqueIndex("accounts_user_provider_idx").on(
      table.userId,
      table.providerId
    ),
  ]
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    type: text("type", {
      enum: VERIFICATION_TYPE_VALUES,
    }).notNull(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    data: text("data"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("verifications_type_identifier_unique").on(table.type, table.identifier),
    index("verifications_identifier_idx").on(table.identifier),
    index("verifications_expires_at_idx").on(table.expiresAt),
    check("verifications_type_check", oneOf(table.type, VERIFICATION_TYPE_VALUES)),
    check(
      "verifications_data_json_check",
      sql`${table.data} IS NULL OR json_valid(${table.data})`,
    ),
    check("verifications_data_length_check", optionalTextLength(table.data, JSON_TEXT_MAX_LENGTH)),
    check(
      "verifications_expires_after_created_check",
      sql`${table.expiresAt} >= ${table.createdAt}`,
    ),
    check(
      "verifications_updated_after_created_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ]
);

/**
 * WebAuthn passkey credentials. One user can have multiple passkeys
 * (e.g. laptop Touch ID + phone Face ID).
 * credentialId is the raw credential ID bytes stored as base64url.
 * publicKey is the COSE-encoded public key stored as base64url.
 * counter is updated on every successful assertion to detect cloned authenticators.
 * transports is a JSON array of AuthenticatorTransport values used to hint the
 * browser which transport to prefer (e.g. ["internal"], ["hybrid","usb"]).
 */
export const passkeys = sqliteTable(
  "passkeys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    // 'singleDevice' = bound to one device, 'multiDevice' = synced via platform (iCloud/Google)
    deviceType: text("device_type", { enum: PASSKEY_DEVICE_TYPE_VALUES }).notNull(),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
    transports: text("transports", { mode: "json" }).$type<string[] | null>(), // JSON array: 'internal' | 'hybrid' | 'usb' | 'nfc' | 'ble'
    // User-visible label, either given by the user or auto-generated from UA
    name: text("name"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  },
  (table) => [
    index("passkeys_user_id_idx").on(table.userId),
    check("passkeys_credential_id_length_check", sql`length(${table.credentialId}) <= 1024`),
    check("passkeys_public_key_length_check", sql`length(${table.publicKey}) <= 1024`),
    check("passkeys_device_type_check", oneOf(table.deviceType, PASSKEY_DEVICE_TYPE_VALUES)),
    check("passkeys_counter_nonnegative_check", sql`${table.counter} >= 0`),
    check(
      "passkeys_transports_json_check",
      sql`${table.transports} IS NULL OR (json_valid(${table.transports}) AND json_type(${table.transports}) = 'array')`,
    ),
    check("passkeys_transports_length_check", optionalTextLength(table.transports, 1024)),
    check(
      "passkeys_last_used_after_created_check",
      sql`${table.lastUsedAt} IS NULL OR ${table.lastUsedAt} >= ${table.createdAt}`,
    ),
    check("passkeys_name_length_check", optionalTextLength(table.name, 120)),
  ]
);

/**
 * Long-lived device recognition tokens stored in an HttpOnly cookie.
 * Survive session expiry and are used to show "Welcome back, X" on return visits
 * so users are never asked which account they used.
 * tokenHash is SHA-256 of the raw token held in the device cookie.
 */
export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    // Human-readable label parsed from User-Agent at creation time
    label: text("label"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("devices_user_id_idx").on(table.userId),
    index("devices_expires_at_idx").on(table.expiresAt),
    check("devices_token_hash_length_check", sql`length(${table.tokenHash}) = 64`),
    check("devices_expires_after_created_check", sql`${table.expiresAt} >= ${table.createdAt}`),
    check(
      "devices_last_seen_after_created_check",
      sql`${table.lastSeenAt} IS NULL OR ${table.lastSeenAt} >= ${table.createdAt}`,
    ),
    check("devices_label_length_check", optionalTextLength(table.label, 200)),
  ]
);

// ============================================================================
// SPACES
// ============================================================================

export const spaces = sqliteTable(
  "spaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    slug: text("slug").notNull().unique(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // null = active, timestamp = when it was archived
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("spaces_owner_id_idx").on(table.ownerId),
    index("spaces_owner_archived_idx").on(table.ownerId, table.archivedAt),
    check("spaces_name_length_check", requiredTrimmedTextLength(table.name, 200)),
    check("spaces_description_length_check", optionalTextLength(table.description, 1000)),
    check("spaces_slug_length_check", requiredTrimmedTextLength(table.slug, 64)),
    check(
      "spaces_slug_format_check",
      sql`
        lower(${table.slug}) = ${table.slug}
        AND ${table.slug} GLOB '[a-z0-9]*'
        AND ${table.slug} NOT GLOB '*[^a-z0-9-]*'
        AND ${table.slug} NOT GLOB '*-'
      `,
    ),
    check("spaces_updated_after_created_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    check(
      "spaces_archived_after_created_check",
      sql`${table.archivedAt} IS NULL OR ${table.archivedAt} >= ${table.createdAt}`,
    ),
  ]
);

export const spaceMembers = sqliteTable(
  "space_members",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: SPACE_ROLE_VALUES })
      .default("member")
      .notNull(),
    joinedAt: integer("joined_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("space_members_user_id_idx").on(table.userId),
    uniqueIndex("space_members_unique_idx").on(table.spaceId, table.userId),
    check("space_members_role_check", oneOf(table.role, SPACE_ROLE_VALUES)),
  ]
);

export const spaceInvites = sqliteTable(
  "space_invites",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    role: text("role", { enum: SPACE_INVITE_ROLE_VALUES })
      .default("member")
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    maxUses: integer("max_uses"),
    useCount: integer("use_count").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("space_invites_space_id_idx").on(table.spaceId),
    index("space_invites_expires_at_idx").on(table.expiresAt),
    check("space_invites_token_length_check", sql`length(${table.token}) = 64`),
    check("space_invites_role_check", oneOf(table.role, SPACE_INVITE_ROLE_VALUES)),
    check("space_invites_use_count_nonnegative_check", sql`${table.useCount} >= 0`),
    check("space_invites_max_uses_positive_check", sql`${table.maxUses} IS NULL OR ${table.maxUses} > 0`),
    check(
      "space_invites_use_count_within_limit_check",
      sql`${table.maxUses} IS NULL OR ${table.useCount} <= ${table.maxUses}`,
    ),
    check("space_invites_expiry_after_created_check", sql`${table.expiresAt} >= ${table.createdAt}`),
  ]
);

// ============================================================================
// ROOMS AND MEETING SESSIONS
// ============================================================================

/**
 * A room is the human-facing meeting address. Its code is the only meeting code
 * that appears in public URLs (`/abc-defg-hij`).
 */
export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    type: text("type", { enum: ROOM_TYPE_VALUES })
      .default("instant")
      .notNull(),
    hostId: text("host_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    spaceId: text("space_id").references(() => spaces.id, { onDelete: "cascade" }),
    title: text("title"),
    allowGuests: integer("allow_guests", { mode: "boolean" }).notNull().default(false),
    recordingEnabled: integer("recording_enabled", { mode: "boolean" }).notNull().default(false),
    requireApproval: integer("require_approval", { mode: "boolean" }).notNull().default(false),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("rooms_host_id_idx").on(table.hostId),
    index("rooms_host_last_used_idx").on(table.hostId, table.lastUsedAt),
    index("rooms_space_id_idx").on(table.spaceId),
    index("rooms_expires_at_idx").on(table.expiresAt),
    check("rooms_code_shape_check", meetingCodeShape(table.code)),
    check("rooms_type_check", oneOf(table.type, ROOM_TYPE_VALUES)),
    check("rooms_title_length_check", optionalTextLength(table.title, 200)),
    check(
      "rooms_expiry_after_created_check",
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} >= ${table.createdAt}`,
    ),
    check(
      "rooms_last_used_after_created_check",
      sql`${table.lastUsedAt} IS NULL OR ${table.lastUsedAt} >= ${table.createdAt}`,
    ),
    check(
      "rooms_last_used_before_expiry_check",
      sql`${table.expiresAt} IS NULL OR ${table.lastUsedAt} IS NULL OR ${table.lastUsedAt} <= ${table.expiresAt}`,
    ),
    check(
      "rooms_archived_after_created_check",
      sql`${table.archivedAt} IS NULL OR ${table.archivedAt} >= ${table.createdAt}`,
    ),
    check(
      "rooms_updated_after_created_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ]
);

/**
 * A meeting session is one concrete occurrence inside a room. Session IDs are
 * internal: LiveKit, R2, transcripts, summaries, and whiteboard artifacts use them.
 */
export const meetingSessions = sqliteTable(
  "meeting_sessions",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    // Optional short slug for dashboard deep links. It is never used for joining.
    publicSlug: text("public_slug").notNull(),
    title: text("title"),
    hostId: text("host_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    spaceId: text("space_id").references(() => spaces.id, { onDelete: "cascade" }),
    status: text("status", { enum: MEETING_STATUS_VALUES })
      .default("active")
      .notNull(),
    allowGuests: integer("allow_guests", { mode: "boolean" }).default(false).notNull(),
    recordingEnabled: integer("recording_enabled", { mode: "boolean" }).default(false).notNull(),
    requireApproval: integer("require_approval", { mode: "boolean" }).default(false).notNull(),
    locked: integer("locked", { mode: "boolean" }).default(false).notNull(),
    activeEgressId: text("active_egress_id"),
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    endedAt: integer("ended_at", { mode: "timestamp" }),
    retainUntil: integer("retain_until", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("meeting_sessions_room_status_idx").on(table.roomId, table.status),
    uniqueIndex("meeting_sessions_active_room_unique_idx")
      .on(table.roomId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("meeting_sessions_room_public_slug_unique_idx").on(table.roomId, table.publicSlug),
    index("meeting_sessions_space_id_status_idx").on(table.spaceId, table.status),
    index("meeting_sessions_host_id_status_idx").on(table.hostId, table.status),
    index("meeting_sessions_status_started_at_idx").on(table.status, table.startedAt),
    index("meeting_sessions_retain_until_idx").on(table.retainUntil),
    check("meeting_sessions_public_slug_length_check", requiredTrimmedTextLength(table.publicSlug, 32)),
    check("meeting_sessions_title_length_check", optionalTextLength(table.title, 200)),
    check("meeting_sessions_status_check", oneOf(table.status, MEETING_STATUS_VALUES)),
    check(
      "meeting_sessions_lifecycle_check",
      sql`(
        (${table.status} = 'active' AND ${table.endedAt} IS NULL)
        OR (${table.status} = 'ended' AND ${table.endedAt} IS NOT NULL)
      )`,
    ),
    check(
      "meeting_sessions_ended_after_started_check",
      sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}`,
    ),
    check(
      "meeting_sessions_retain_after_end_check",
      sql`${table.retainUntil} IS NULL OR (${table.endedAt} IS NOT NULL AND ${table.retainUntil} >= ${table.endedAt})`,
    ),
    check(
      "meeting_sessions_updated_after_started_check",
      sql`${table.updatedAt} >= ${table.startedAt}`,
    ),
    check(
      "meeting_sessions_ended_egress_cleared_check",
      sql`${table.status} = 'active' OR ${table.activeEgressId} IS NULL`,
    ),
  ]
);

export const meetingParticipants = sqliteTable(
  "meeting_participants",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => meetingSessions.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: MEETING_ROLE_VALUES })
      .default("participant")
      .notNull(),
    // awaiting_approval — inserted by join, but host must admit before the token is issued.
    // pending — token issued, client hasn't connected to LiveKit yet.
    // active — LiveKit webhook confirmed participant is connected.
    // left/aborted/denied — terminal states.
    status: text("status", { enum: MEETING_PARTICIPANT_STATUS_VALUES })
      .default("pending")
      .notNull(),
    livekitIdentity: text("livekit_identity"),
    guestSecret: text("guest_secret"),
    joinedAt: integer("joined_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    // Set when the participant transitions to a terminal lifecycle state.
    leftAt: integer("left_at", { mode: "timestamp" }),
  },
  (table) => [
    index("meeting_participants_meeting_status_idx").on(
      table.sessionId,
      table.status
    ),
    index("meeting_participants_meeting_user_status_idx").on(
      table.sessionId,
      table.userId,
      table.status
    ),
    index("meeting_participants_user_id_idx").on(table.userId),
    uniqueIndex("meeting_participants_meeting_identity_unique_idx")
      .on(table.sessionId, table.livekitIdentity)
      .where(sql`${table.livekitIdentity} IS NOT NULL`),
    // Index for efficient lookups of active participants by user
    // (allows multiple active rows per user — one per device/session)
    index("meeting_participants_active_user_idx")
      .on(table.sessionId, table.userId)
      .where(sql`${table.status} IN ('pending', 'active') AND ${table.userId} IS NOT NULL`),
    check("meeting_participants_role_check", oneOf(table.role, MEETING_ROLE_VALUES)),
    check("meeting_participants_status_check", oneOf(table.status, MEETING_PARTICIPANT_STATUS_VALUES)),
    check(
      "meeting_participants_guest_shape_check",
      sql`(
        (${table.userId} IS NOT NULL AND ${table.guestSecret} IS NULL AND ${table.role} IN ('host', 'participant'))
        OR (${table.userId} IS NULL AND ${table.guestSecret} IS NOT NULL AND ${table.role} = 'guest')
      )`,
    ),
    check(
      "meeting_participants_terminal_left_at_check",
      sql`(
        (${table.status} IN ('awaiting_approval', 'pending', 'active') AND ${table.leftAt} IS NULL)
        OR (${table.status} IN ('left', 'aborted', 'denied') AND ${table.leftAt} IS NOT NULL)
      )`,
    ),
    check(
      "meeting_participants_left_after_join_check",
      sql`${table.leftAt} IS NULL OR ${table.leftAt} >= ${table.joinedAt}`,
    ),
    check(
      "meeting_participants_display_name_length_check",
      requiredTrimmedTextLength(table.displayName, 100),
    ),
  ]
);

// ============================================================================
// TRANSCRIPTS (final Web Speech API segments)
// ============================================================================

export const transcripts = sqliteTable(
  "transcripts",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => meetingSessions.id, { onDelete: "cascade" }),
    participantId: text("participant_id").references(() => meetingParticipants.id, {
      onDelete: "set null",
    }),
    /** LiveKit participant identity (e.g. user ID or guest identity) */
    participantIdentity: text("participant_identity").notNull(),
    /** Display name at the time of transcription */
    participantName: text("participant_name").notNull(),
    /** The transcribed text */
    text: text("text").notNull(),
    /** Segment ID from LiveKit/Web Speech for deduplication. NOT NULL so SQLite UNIQUE works.
     *  When the speech API omits a segment ID, callers must supply a deterministic placeholder. */
    segmentId: text("segment_id").notNull(),
    /** Language code detected/used for this segment */
    language: text("language"),
    /** Speaker ID from diarization (when enabled) */
    speakerId: text("speaker_id"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("transcripts_session_id_started_at_idx").on(table.sessionId, table.startedAt),
    index("transcripts_session_id_participant_idx").on(table.sessionId, table.participantIdentity),
    index("transcripts_session_id_participant_id_started_at_idx").on(
      table.sessionId,
      table.participantId,
      table.startedAt,
    ),
    uniqueIndex("transcripts_segment_id_unique").on(table.sessionId, table.segmentId),
    check(
      "transcripts_updated_after_started_check",
      sql`${table.updatedAt} >= ${table.startedAt}`,
    ),
  ]
);

// ============================================================================
// MEETING SUMMARIES (AI-generated post-meeting recaps)
// ============================================================================

export const meetingSummaries = sqliteTable(
  "meeting_summaries",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => meetingSessions.id, { onDelete: "cascade" }),
    /** Summary text */
    summary: text("summary").notNull(),
    /** Key topics discussed */
    topics: text("topics", { mode: "json" }).$type<string[] | null>(),
    /** Action items extracted */
    actionItems: text("action_items", { mode: "json" }).$type<string[] | null>(),
    /** Decisions made */
    decisions: text("decisions", { mode: "json" }).$type<string[] | null>(),
    /** Total duration in seconds */
    durationSeconds: integer("duration_seconds"),
    /** Number of participants */
    participantCount: integer("participant_count"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("meeting_summaries_session_id_unique").on(table.sessionId),
    check(
      "meeting_summaries_topics_json_check",
      sql`${table.topics} IS NULL OR (json_valid(${table.topics}) AND json_type(${table.topics}) = 'array')`,
    ),
    check("meeting_summaries_topics_length_check", optionalTextLength(table.topics, JSON_TEXT_MAX_LENGTH)),
    check(
      "meeting_summaries_action_items_json_check",
      sql`${table.actionItems} IS NULL OR (json_valid(${table.actionItems}) AND json_type(${table.actionItems}) = 'array')`,
    ),
    check("meeting_summaries_action_items_length_check", optionalTextLength(table.actionItems, JSON_TEXT_MAX_LENGTH)),
    check(
      "meeting_summaries_decisions_json_check",
      sql`${table.decisions} IS NULL OR (json_valid(${table.decisions}) AND json_type(${table.decisions}) = 'array')`,
    ),
    check("meeting_summaries_decisions_length_check", optionalTextLength(table.decisions, JSON_TEXT_MAX_LENGTH)),
    check(
      "meeting_summaries_duration_nonnegative_check",
      sql`${table.durationSeconds} IS NULL OR ${table.durationSeconds} >= 0`,
    ),
    check(
      "meeting_summaries_participant_count_nonnegative_check",
      sql`${table.participantCount} IS NULL OR ${table.participantCount} >= 0`,
    ),
  ]
);

// ============================================================================
// ASSETS
// ============================================================================

export const meetingArtifacts = sqliteTable(
  "meeting_artifacts",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => meetingSessions.id, { onDelete: "cascade" }),
    spaceId: text("space_id").references(() => spaces.id, { onDelete: "cascade" }),
    type: text("type", { enum: MEETING_ARTIFACT_TYPE_VALUES }).notNull(),
    r2Key: text("r2_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    uploadedById: text("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("meeting_artifacts_session_id_created_at_idx").on(table.sessionId, table.createdAt),
    index("meeting_artifacts_space_id_created_at_idx").on(table.spaceId, table.createdAt),
    index("meeting_artifacts_session_type_idx").on(table.sessionId, table.type),
    index("meeting_artifacts_uploaded_by_id_idx").on(table.uploadedById),
    check("meeting_artifacts_type_check", oneOf(table.type, MEETING_ARTIFACT_TYPE_VALUES)),
    check("meeting_artifacts_size_nonnegative_check", sql`${table.size} >= 0`),
    check("meeting_artifacts_filename_length_check", requiredTrimmedTextLength(table.filename, 255)),
    check("meeting_artifacts_mime_type_length_check", requiredTrimmedTextLength(table.mimeType, 100)),
    check("meeting_artifacts_r2_key_length_check", sql`length(${table.r2Key}) <= 512`),
    check(
      "meeting_artifacts_r2_key_check",
      sql`(
        (${table.type} = 'recording' AND ${table.r2Key} LIKE 'recordings/%')
        OR (${table.type} = 'whiteboard_snapshot' AND ${table.r2Key} LIKE 'whiteboards/%')
        OR (${table.type} IN ('whiteboard_state', 'whiteboard_pdf') AND ${table.r2Key} LIKE 'whiteboard/%')
      )`,
    ),
  ],
);

export const spaceAssets = sqliteTable(
  "space_assets",
  {
    id: text("id").primaryKey(),
    // Nullable — personal assets (no space) are valid for solo users
    spaceId: text("space_id").references(() => spaces.id, { onDelete: "cascade" }),
    type: text("type", { enum: SPACE_ASSET_TYPE_VALUES }).notNull(),
    r2Key: text("r2_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    uploadedById: text("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("space_assets_space_id_created_at_idx").on(table.spaceId, table.createdAt),
    index("space_assets_uploaded_by_id_idx").on(table.uploadedById),
    check("space_assets_type_check", oneOf(table.type, SPACE_ASSET_TYPE_VALUES)),
    check("space_assets_size_nonnegative_check", sql`${table.size} >= 0`),
    check("space_assets_filename_length_check", requiredTrimmedTextLength(table.filename, 255)),
    check("space_assets_mime_type_length_check", requiredTrimmedTextLength(table.mimeType, 100)),
    check("space_assets_r2_key_length_check", sql`length(${table.r2Key}) <= 512`),
    check(
      "space_assets_r2_key_check",
      sql`${table.type} = 'pdf' AND (${table.r2Key} LIKE 'uploads/%' OR ${table.r2Key} LIKE 'spaces/%')`,
    ),
  ]
);

// ============================================================================
// RELATIONS
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  passkeys: many(passkeys),
  devices: many(devices),
  ownedSpaces: many(spaces),
  spaceMembers: many(spaceMembers),
  rooms: many(rooms),
  meetingParticipations: many(meetingParticipants),
  meetingArtifacts: many(meetingArtifacts),
  spaceAssets: many(spaceAssets),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const passkeysRelations = relations(passkeys, ({ one }) => ({
  user: one(users, {
    fields: [passkeys.userId],
    references: [users.id],
  }),
}));

export const devicesRelations = relations(devices, ({ one }) => ({
  user: one(users, {
    fields: [devices.userId],
    references: [users.id],
  }),
}));

export const spacesRelations = relations(spaces, ({ one, many }) => ({
  owner: one(users, {
    fields: [spaces.ownerId],
    references: [users.id],
  }),
  members: many(spaceMembers),
  invites: many(spaceInvites),
  rooms: many(rooms),
  meetingArtifacts: many(meetingArtifacts),
  assets: many(spaceAssets),
}));

export const spaceMembersRelations = relations(spaceMembers, ({ one }) => ({
  space: one(spaces, {
    fields: [spaceMembers.spaceId],
    references: [spaces.id],
  }),
  user: one(users, {
    fields: [spaceMembers.userId],
    references: [users.id],
  }),
}));

export const spaceInvitesRelations = relations(spaceInvites, ({ one }) => ({
  space: one(spaces, {
    fields: [spaceInvites.spaceId],
    references: [spaces.id],
  }),
  createdBy: one(users, {
    fields: [spaceInvites.createdById],
    references: [users.id],
  }),
}));

export const roomsRelations = relations(rooms, ({ one, many }) => ({
  host: one(users, {
    fields: [rooms.hostId],
    references: [users.id],
  }),
  space: one(spaces, {
    fields: [rooms.spaceId],
    references: [spaces.id],
  }),
  sessions: many(meetingSessions),
}));

export const meetingSessionsRelations = relations(meetingSessions, ({ one, many }) => ({
  room: one(rooms, {
    fields: [meetingSessions.roomId],
    references: [rooms.id],
  }),
  host: one(users, {
    fields: [meetingSessions.hostId],
    references: [users.id],
  }),
  space: one(spaces, {
    fields: [meetingSessions.spaceId],
    references: [spaces.id],
  }),
  participants: many(meetingParticipants),
  artifacts: many(meetingArtifacts),
  transcripts: many(transcripts),
  summary: one(meetingSummaries, {
    fields: [meetingSessions.id],
    references: [meetingSummaries.sessionId],
  }),
}));

export const transcriptsRelations = relations(transcripts, ({ one }) => ({
  session: one(meetingSessions, {
    fields: [transcripts.sessionId],
    references: [meetingSessions.id],
  }),
  participant: one(meetingParticipants, {
    fields: [transcripts.participantId],
    references: [meetingParticipants.id],
  }),
}));

export const meetingSummariesRelations = relations(meetingSummaries, ({ one }) => ({
  session: one(meetingSessions, {
    fields: [meetingSummaries.sessionId],
    references: [meetingSessions.id],
  }),
}));

export const meetingParticipantsRelations = relations(meetingParticipants, ({ one, many }) => ({
  session: one(meetingSessions, {
    fields: [meetingParticipants.sessionId],
    references: [meetingSessions.id],
  }),
  user: one(users, {
    fields: [meetingParticipants.userId],
    references: [users.id],
  }),
  transcripts: many(transcripts),
}));

export const meetingArtifactsRelations = relations(meetingArtifacts, ({ one }) => ({
  session: one(meetingSessions, {
    fields: [meetingArtifacts.sessionId],
    references: [meetingSessions.id],
  }),
  space: one(spaces, {
    fields: [meetingArtifacts.spaceId],
    references: [spaces.id],
  }),
  uploadedBy: one(users, {
    fields: [meetingArtifacts.uploadedById],
    references: [users.id],
  }),
}));

export const spaceAssetsRelations = relations(spaceAssets, ({ one }) => ({
  space: one(spaces, {
    fields: [spaceAssets.spaceId],
    references: [spaces.id],
  }),
  uploadedBy: one(users, {
    fields: [spaceAssets.uploadedById],
    references: [users.id],
  }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Verification = typeof verifications.$inferSelect;
export type Passkey = typeof passkeys.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type SpaceMember = typeof spaceMembers.$inferSelect;
export type SpaceInvite = typeof spaceInvites.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type MeetingSession = typeof meetingSessions.$inferSelect;
export type MeetingParticipant = typeof meetingParticipants.$inferSelect;
export type Transcript = typeof transcripts.$inferSelect;
export type MeetingSummary = typeof meetingSummaries.$inferSelect;
export type MeetingArtifact = typeof meetingArtifacts.$inferSelect;
export type SpaceAsset = typeof spaceAssets.$inferSelect;
