import { isValidWeightMeasurementValue } from '../../clients/utils/measurementContract';

export interface GoalProgressInput {
  startWeight: number | null;
  currentWeight: number | null;
  targetWeight: number | null;
}

export interface GoalProgressResult {
  progressPercentage: number | null;
  remainingKg: number | null;
  isComplete: boolean;
  hasData: boolean;
}

const NO_GOAL_PROGRESS: GoalProgressResult = {
  progressPercentage: null,
  remainingKg: null,
  isComplete: false,
  hasData: false,
};

const clampPercentage = (value: number): number => Math.min(100, Math.max(0, value));

export const calculateGoalProgress = ({
  startWeight,
  currentWeight,
  targetWeight,
}: GoalProgressInput): GoalProgressResult => {
  if (
    !isValidWeightMeasurementValue(startWeight)
    || !isValidWeightMeasurementValue(currentWeight)
    || !isValidWeightMeasurementValue(targetWeight)
    || targetWeight === startWeight
  ) {
    return { ...NO_GOAL_PROGRESS };
  }

  const direction = Math.sign(targetWeight - startWeight);
  const distanceToGoal = Math.abs(targetWeight - startWeight);
  const progressDistance = (currentWeight - startWeight) * direction;
  const progressPercentage = clampPercentage((progressDistance / distanceToGoal) * 100);
  const remainingKg = Math.max(0, (targetWeight - currentWeight) * direction);

  return {
    progressPercentage,
    remainingKg,
    isComplete: progressPercentage >= 100,
    hasData: true,
  };
};
