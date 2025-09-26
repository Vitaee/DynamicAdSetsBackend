import { z } from 'zod';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}


export const platformSchema = z.enum(['meta', 'google']);

export const campaignStatusSchema = z.enum(['active', 'paused', 'deleted']);

export const weatherConditionSchema = z.enum([
  'temperature',
  'precipitation',
  'wind_speed',
  'humidity',
  'air_quality',
  'severe_weather',
]);

export const comparisonOperatorSchema = z.enum([
  'greater_than',
  'less_than',
  'equal_to',
  'between',
]);

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(100),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const weatherRuleSchema = z.object({
  condition: weatherConditionSchema,
  operator: comparisonOperatorSchema,
  value: z.number(),
  secondValue: z.number().optional(),
  unit: z.string(),
});

export const createAutomationSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  rules: z.array(weatherRuleSchema).min(1),
  ruleLogic: z.enum(['AND', 'OR']).default('AND'),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    name: z.string(),
  }),
});

export const updateAutomationSchema = createAutomationSchema.partial();