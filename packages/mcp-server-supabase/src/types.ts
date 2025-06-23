import { z } from 'zod';

export const featureGroupSchema = z.enum([
  'docs',
  'account',
  'database',
  'debugging',
  'development',
  'functions',
  'branching',
  'storage',
]);

export type FeatureGroup = z.infer<typeof featureGroupSchema>;
