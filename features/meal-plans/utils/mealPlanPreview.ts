import { isPlannedMealContent, type PlanState } from './mealPlanMove';

/** Late image reads may enrich previews, but must preserve the current draft. */
export const applyMealImagePreviews = (plan: PlanState, photos: Map<string, string>): PlanState => {
  let next = plan;
  for (const [day, cells] of Object.entries(plan)) {
    for (const [id, content] of Object.entries(cells)) {
      if (!isPlannedMealContent(content) || !content.image || content.imagePreview || content.pendingPhoto) continue;
      const preview = photos.get(content.image);
      if (!preview) continue;
      if (next === plan) next = { ...plan };
      if (next[day] === cells) next[day] = { ...cells };
      next[day][id] = { ...content, imagePreview: preview };
    }
  }
  return next;
};
