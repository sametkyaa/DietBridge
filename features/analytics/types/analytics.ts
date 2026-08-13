export const ANALYTICS_DATE_RANGE_KEYS = ['7d', '30d', '3m', 'all'] as const;

export type AnalyticsDateRangeKey = (typeof ANALYTICS_DATE_RANGE_KEYS)[number];

export interface AnalyticsDateRange {
  key: AnalyticsDateRangeKey;
  startDate: string | null;
  endDate: string;
}

export const BODY_MEASUREMENT_FIELDS = [
  'waist',
  'hip',
  'arm',
  'rightArm',
  'leftArm',
  'chest',
  'thigh',
  'calf',
  'rightCalf',
  'leftCalf',
  'neck',
] as const;

export type BodyMeasurementField = (typeof BODY_MEASUREMENT_FIELDS)[number];

export interface AnalyticsClientProfile {
  clientId: string;
  startWeight: number | null;
  currentWeight: number | null;
  targetWeight: number | null;
  waterGoalLiters: number | null;
}

export interface AnalyticsMeasurement {
  id: string;
  clientId: string;
  date: string;
  weight: number | null;
  waist: number | null;
  hip: number | null;
  arm: number | null;
  rightArm: number | null;
  leftArm: number | null;
  chest: number | null;
  thigh: number | null;
  calf: number | null;
  rightCalf: number | null;
  leftCalf: number | null;
  neck: number | null;
}

export interface AnalyticsDailyLog {
  id: string;
  clientId: string;
  date: string;
  waterLiters: number | null;
  hasInvalidWaterValue: boolean;
}

export type AnalyticsMealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface AnalyticsMeal {
  id: string;
  type: AnalyticsMealType;
  isCompleted: boolean;
  hasCompletionValue: boolean;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export interface AnalyticsMealPlan {
  id: string;
  clientId: string;
  dietitianId: string;
  date: string;
  meals: AnalyticsMeal[];
}

export interface AnalyticsTrendPoint {
  date: string;
  value: number;
}

export interface BodyMeasurementTrend {
  field: BodyMeasurementField;
  points: AnalyticsTrendPoint[];
}

export interface AnalyticsAdherencePoint {
  periodStart: string;
  periodEnd: string;
  planned: number;
  completed: number;
  percentage: number | null;
}

export interface AnalyticsMealTypeAdherence {
  type: AnalyticsMealType;
  planned: number;
  completed: number;
  percentage: number | null;
}

export interface PlannedNutritionMetric {
  total: number | null;
  coveredMeals: number;
  totalMeals: number;
  isComplete: boolean;
}

export interface PlannedNutritionSummary {
  calories: PlannedNutritionMetric;
  protein: PlannedNutritionMetric;
  carbs: PlannedNutritionMetric;
  fat: PlannedNutritionMetric;
}

export interface AnalyticsWaterSummary {
  averageLiters: number | null;
  latestLiters: number | null;
  goalLiters: number | null;
  trackedDays: number;
  periodDays: number | null;
  achievedGoalDays: number;
  goalEligibleDays: number;
  goalAchievementPercentage: number | null;
}

export interface AnalyticsKpiSummary {
  currentWeight: number | null;
  startWeight: number | null;
  weightChange: number | null;
  targetWeight: number | null;
  targetGap: number | null;
  lastMeasurementDate: string | null;
  plannedMeals: number;
  completedMeals: number;
  mealAdherencePercentage: number | null;
  water: AnalyticsWaterSummary;
}

export interface AnalyticsDataQuality {
  invalidWaterRows: number;
  invalidCompletionRows: number;
  incompleteCalorieMeals: number;
  incompleteMacroMeals: number;
}

export interface ClientAnalyticsReport {
  clientId: string;
  dietitianId: string;
  range: AnalyticsDateRange;
  kpis: AnalyticsKpiSummary;
  weightTrend: AnalyticsTrendPoint[];
  bodyMeasurementTrends: BodyMeasurementTrend[];
  waterTrend: AnalyticsTrendPoint[];
  dailyAdherence: AnalyticsAdherencePoint[];
  weeklyAdherence: AnalyticsAdherencePoint[];
  mealTypeAdherence: AnalyticsMealTypeAdherence[];
  plannedNutrition: PlannedNutritionSummary;
  dataQuality: AnalyticsDataQuality;
}

export interface AnalyticsSourceData {
  clientId: string;
  dietitianId: string;
  range: AnalyticsDateRange;
  profile: AnalyticsClientProfile;
  measurements: AnalyticsMeasurement[];
  latestMeasurement: AnalyticsMeasurement | null;
  earliestWeightMeasurement: AnalyticsMeasurement | null;
  latestWeightMeasurement: AnalyticsMeasurement | null;
  dailyLogs: AnalyticsDailyLog[];
  mealPlans: AnalyticsMealPlan[];
}

export interface AnalyticsClientOption {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export type AnalyticsClientListResult =
  | { status: 'success'; clients: AnalyticsClientOption[] }
  | { status: 'error'; kind: 'auth' | 'query' | 'unexpected'; userMessage: string };
