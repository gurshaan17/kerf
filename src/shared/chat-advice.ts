const adviceRequests = [
  /^(?:how (?:can|could|should|do) (?:i|we) (?:improve|make)|how would you improve)\b/i,
  /^(?:what (?:can|could|should) (?:i|we) (?:improve|change)|what would you (?:improve|change))\b/i,
  /^(?:any (?:feedback|suggestions|tips)\b|what do you think (?:of|about)\b)/i,
  /^(?:(?:give me|can you give me) (?:some )?(?:feedback|suggestions)|suggest (?:some )?(?:improvements|ways to improve))\b/i,
];

export function isChatAdviceRequest(message: string): boolean {
  const request = message.trim();
  return adviceRequests.some((pattern) => pattern.test(request));
}
