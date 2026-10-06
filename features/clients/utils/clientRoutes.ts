export const clientMessagesPath = (clientId: string): string => (
  `/messages?clientId=${encodeURIComponent(clientId)}`
);

/** The meal plan editor reads the selected client from navigation state. */
export const clientPlanNavigation = (clientId: string) => ({
  to: '/meal-plans',
  state: { clientId },
});
