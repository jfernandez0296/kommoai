export function saveConversationTurn(userMessage, assistantReply, extra = {}) {
  return {
    userMessage,
    assistantReply,
    storedAt: new Date().toISOString(),
    ...extra,
  };
}
