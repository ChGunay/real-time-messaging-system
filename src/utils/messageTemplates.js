// Predefined message templates for auto messages
const messageTemplates = [
  // Greeting messages
  'Hello! How are you doing today?',
  'Hi there! Hope you\'re having a great day!',
  'Hey! What\'s new with you?',
  'Good day! How are things going?',
  'Hello! Hope all is well with you!',

  // Conversation starters
  'What\'s the most interesting thing that happened to you this week?',
  'Have you discovered any good books/movies/music lately?',
  'What\'s your favorite way to spend a weekend?',
  'If you could travel anywhere right now, where would you go?',
  'What\'s something you\'re looking forward to?',

  // Friendly check-ins
  'Just wanted to check in and see how you\'re doing!',
  'Thinking of you today! Hope everything is going well.',
  'How has your week been so far?',
  'Hope you\'re having a wonderful day!',
  'Sending positive vibes your way!',

  // Random interesting questions
  'What\'s the best advice you\'ve ever received?',
  'If you could have dinner with anyone, who would it be?',
  'What\'s your hidden talent?',
  'What\'s the most beautiful place you\'ve ever visited?',
  'What\'s something new you\'d like to learn?',

  // Light and fun
  'Fun fact: Did you know honey never spoils?',
  'Random question: Coffee or tea?',
  'What\'s your go-to comfort food?',
  'If you could have any superpower, what would it be?',
  'What\'s your favorite season and why?',

  // Motivational
  'Remember, every day is a new opportunity!',
  'You\'re doing great! Keep up the good work!',
  'Hope today brings you joy and success!',
  'Wishing you a day filled with happiness!',
  'You\'ve got this! Believe in yourself!',

  // Casual conversation
  'What are you up to today?',
  'Any plans for the weekend?',
  'How\'s your day treating you?',
  'What\'s keeping you busy these days?',
  'Hope you\'re taking care of yourself!',

  // Thoughtful messages
  'Life is what happens when you\'re busy making other plans. How\'s yours going?',
  'Sometimes the smallest gestures make the biggest difference. Hope this message brightens your day!',
  'In a world where you can be anything, be kind. Hope kindness finds you today!',
  'Every sunset is an opportunity to reset. How are you resetting today?',
  'The best time to plant a tree was 20 years ago. The second best time is now. What are you planting today?'
];

// Categories for different types of messages
const messageCategories = {
  greeting: [
    'Hello! How are you doing today?',
    'Hi there! Hope you\'re having a great day!',
    'Hey! What\'s new with you?',
    'Good day! How are things going?',
    'Hello! Hope all is well with you!'
  ],

  conversation_starter: [
    'What\'s the most interesting thing that happened to you this week?',
    'Have you discovered any good books/movies/music lately?',
    'What\'s your favorite way to spend a weekend?',
    'If you could travel anywhere right now, where would you go?',
    'What\'s something you\'re looking forward to?'
  ],

  check_in: [
    'Just wanted to check in and see how you\'re doing!',
    'Thinking of you today! Hope everything is going well.',
    'How has your week been so far?',
    'Hope you\'re having a wonderful day!',
    'Sending positive vibes your way!'
  ],

  motivational: [
    'Remember, every day is a new opportunity!',
    'You\'re doing great! Keep up the good work!',
    'Hope today brings you joy and success!',
    'Wishing you a day filled with happiness!',
    'You\'ve got this! Believe in yourself!'
  ],

  fun: [
    'Fun fact: Did you know honey never spoils?',
    'Random question: Coffee or tea?',
    'What\'s your go-to comfort food?',
    'If you could have any superpower, what would it be?',
    'What\'s your favorite season and why?'
  ]
};

function getRandomMessage() {
  const randomIndex = Math.floor(Math.random() * messageTemplates.length);
  return messageTemplates[randomIndex];
}

function getRandomMessageByCategory(category) {
  if (!messageCategories[category]) {
    return getRandomMessage();
  }

  const categoryMessages = messageCategories[category];
  const randomIndex = Math.floor(Math.random() * categoryMessages.length);
  return categoryMessages[randomIndex];
}

function getRandomMessages(count = 1, category = null) {
  const sourceArray = category
    ? messageCategories[category] || messageTemplates
    : messageTemplates;

  if (count >= sourceArray.length) {
    return shuffleArray([...sourceArray]);
  }

  const shuffled = shuffleArray([...sourceArray]);
  return shuffled.slice(0, count);
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function personalizeMessage(message, userName = null) {
  if (!userName) {
    return message;
  }

  const greetingWords = ['Hello', 'Hi', 'Hey', 'Good day'];
  for (const greeting of greetingWords) {
    if (message.startsWith(greeting)) {
      return message.replace(greeting, `${greeting} ${userName}`);
    }
  }

  return message;
}

function getTimeBasedMessage() {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    return getRandomMessageByCategory('greeting');
  } else if (hour >= 12 && hour < 17) {
    return getRandomMessageByCategory('conversation_starter');
  } else if (hour >= 17 && hour < 21) {
    return getRandomMessageByCategory('check_in');
  } else {
    return getRandomMessageByCategory('motivational');
  }
}

function getMessageStats() {
  return {
    totalTemplates: messageTemplates.length,
    categories: Object.keys(messageCategories).length,
    categoryBreakdown: Object.entries(messageCategories).reduce(
      (acc, [key, value]) => {
        acc[key] = value.length;
        return acc;
      },
      {}
    )
  };
}

module.exports = {
  messageTemplates,
  messageCategories,
  getRandomMessage,
  getRandomMessageByCategory,
  getRandomMessages,
  shuffleArray,
  personalizeMessage,
  getTimeBasedMessage,
  getMessageStats
};
