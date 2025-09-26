import { 
  pgTable, 
  uuid, 
  varchar, 
  text, 
  boolean, 
  timestamp, 
  integer, 
  jsonb,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

// Users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  emailIdx: index('idx_users_email').on(table.email)
}));

// Automation rules table
export const automationRules = pgTable('automation_rules', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  location: jsonb('location').notNull(),
  conditions: jsonb('conditions').notNull(),
  conditionLogic: jsonb('condition_logic'),
  campaigns: jsonb('campaigns').notNull(),
  checkIntervalMinutes: integer('check_interval_minutes').notNull(),
  lastCheckedAt: timestamp('last_checked_at'),
  lastExecutedAt: timestamp('last_executed_at'),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  userIdIdx: index('idx_automation_rules_user_id').on(table.userId),
  isActiveIdx: index('idx_automation_rules_is_active').on(table.isActive)
}));

// Automation executions table
export const automationExecutions = pgTable('automation_executions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ruleId: uuid('rule_id').notNull().references(() => automationRules.id, { onDelete: 'cascade' }),
  executedAt: timestamp('executed_at').default(sql`CURRENT_TIMESTAMP`),
  weatherData: jsonb('weather_data').notNull(),
  conditionsMet: boolean('conditions_met').notNull(),
  actionsTaken: jsonb('actions_taken').notNull(),
  success: boolean('success').notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  ruleIdIdx: index('idx_automation_executions_rule_id').on(table.ruleId),
  executedAtIdx: index('idx_automation_executions_executed_at').on(table.executedAt)
}));

// Meta accounts table
export const metaAccounts = pgTable('meta_accounts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  metaUserId: varchar('meta_user_id', { length: 255 }).notNull(),
  metaUserName: varchar('meta_user_name', { length: 255 }).notNull(),
  metaUserEmail: varchar('meta_user_email', { length: 255 }),
  accessToken: text('access_token').notNull(),
  tokenExpiresAt: timestamp('token_expires_at'),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  userIdIdx: index('idx_meta_accounts_user_id').on(table.userId),
  metaUserIdIdx: index('idx_meta_accounts_meta_user_id').on(table.metaUserId),
  userMetaUserUnique: uniqueIndex('unique_user_meta_user').on(table.userId, table.metaUserId)
}));

// Meta ad accounts table
export const metaAdAccounts = pgTable('meta_ad_accounts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  metaAccountId: uuid('meta_account_id').notNull().references(() => metaAccounts.id, { onDelete: 'cascade' }),
  adAccountId: varchar('ad_account_id', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  accountStatus: integer('account_status').notNull().default(1),
  businessId: varchar('business_id', { length: 255 }),
  businessName: varchar('business_name', { length: 255 }),
  currency: varchar('currency', { length: 10 }).notNull(),
  timezoneName: varchar('timezone_name', { length: 100 }).notNull(),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  metaAccountIdIdx: index('idx_meta_ad_accounts_meta_account_id').on(table.metaAccountId),
  adAccountIdIdx: index('idx_meta_ad_accounts_ad_account_id').on(table.adAccountId),
  isActiveIdx: index('idx_meta_ad_accounts_is_active').on(table.isActive),
  metaAccountAdAccountUnique: uniqueIndex('unique_meta_account_ad_account').on(table.metaAccountId, table.adAccountId)
}));

// Google accounts table (from the  repositories)
export const googleAccounts = pgTable('google_accounts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  googleId: varchar('google_id', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  customerId: varchar('customer_id', { length: 255 }),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  userIdIdx: index('idx_google_accounts_user_id').on(table.userId),
  googleIdIdx: index('idx_google_accounts_google_id').on(table.googleId),
  userGoogleUnique: uniqueIndex('unique_user_google').on(table.userId, table.googleId)
}));

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  automationRules: many(automationRules),
  metaAccounts: many(metaAccounts),
  googleAccounts: many(googleAccounts)
}));

export const automationRulesRelations = relations(automationRules, ({ one, many }) => ({
  user: one(users, {
    fields: [automationRules.userId],
    references: [users.id]
  }),
  executions: many(automationExecutions)
}));

export const automationExecutionsRelations = relations(automationExecutions, ({ one }) => ({
  rule: one(automationRules, {
    fields: [automationExecutions.ruleId],
    references: [automationRules.id]
  })
}));

export const metaAccountsRelations = relations(metaAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [metaAccounts.userId],
    references: [users.id]
  }),
  adAccounts: many(metaAdAccounts)
}));

export const metaAdAccountsRelations = relations(metaAdAccounts, ({ one }) => ({
  metaAccount: one(metaAccounts, {
    fields: [metaAdAccounts.metaAccountId],
    references: [metaAccounts.id]
  })
}));

export const googleAccountsRelations = relations(googleAccounts, ({ one }) => ({
  user: one(users, {
    fields: [googleAccounts.userId],
    references: [users.id]
  })
}));

// Type exports for use in application
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type AutomationRule = typeof automationRules.$inferSelect;
export type NewAutomationRule = typeof automationRules.$inferInsert;

export type AutomationExecution = typeof automationExecutions.$inferSelect;
export type NewAutomationExecution = typeof automationExecutions.$inferInsert;

export type MetaAccount = typeof metaAccounts.$inferSelect;
export type NewMetaAccount = typeof metaAccounts.$inferInsert;

export type MetaAdAccount = typeof metaAdAccounts.$inferSelect;
export type NewMetaAdAccount = typeof metaAdAccounts.$inferInsert;

export type GoogleAccount = typeof googleAccounts.$inferSelect;
export type NewGoogleAccount = typeof googleAccounts.$inferInsert;