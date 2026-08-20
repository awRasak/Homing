export const WELCOME = {
  greeting: () => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  },
  main: 'How can I help you',
  mainAccent: 'today?',
  sub: 'I\'m your personal intelligence assistant. Ask me anything, tell me what to track, or say "give me a briefing".',
  chipsLabel: 'Try saying…',
  quickChips: [
    'Track AI regulation',
    'What\'s new in crypto?',
    'Give me a briefing',
    'Remember: always frame for enterprise',
    'Remind me to review the pipeline tomorrow',
  ],
};