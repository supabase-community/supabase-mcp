import { z } from 'zod';

export const deprecatedFeatureGroupSchema = z.enum(['debug']);

export const currentFeatureGroupSchema = z.enum([
  'docs',
  'account',
  'database',
  'debugging',
  'development',
  'functions',
  'branching',
  'storage',
]);

export const featureGroupSchema = z
  .union([deprecatedFeatureGroupSchema, currentFeatureGroupSchema])
  .transform((value) => {
    // Convert deprecated groups to their new name
    switch (value) {
      case 'debug':
        return 'debugging';
      default:
        return value;
    }
  });

export type FeatureGroup = z.infer<typeof featureGroupSchema>;
