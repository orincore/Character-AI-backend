/**
 * Enhances AI responses to be more human-like
 */

export function humanizeResponse(aiResponse, context = {}) {
  // Add natural language variations and imperfections
  const variations = {
    // Common filler words and phrases (used naturally)
    fillers: [
      'You know,', 'I mean,', 'Well,', 'So,', 'Like,', 'Actually,', 'Basically,',
      'I guess', 'I think', 'I feel like', 'To be honest', 'Honestly',
      'Kind of', 'Sort of', 'A bit', 'A little', 'Maybe', 'Perhaps',
      'I suppose', 'I believe', 'I would say', 'It seems like',
      'In my opinion', 'From my perspective'
    ],
    
    // Common verbal tics and natural speech patterns
    tics: [
      'um', 'uh', 'er', 'ah', 'hmm', 'well', 'so', 'like', 'you know',
      'I mean', 'right?', 'you see', 'sort of', 'kind of', 'basically',
      'actually', 'literally', 'seriously', 'honestly', 'frankly'
    ],
    
    // Emotional expressions
    emotions: {
      happy: ['😊', '😄', '😃', '😁', '😆', '😍'],
      sad: ['😔', '😢', '😞', '😕', '😟', '😥'],
      excited: ['😃', '😄', '🤩', '🥳', '😎', '👏'],
      surprised: ['😮', '😲', '😳', '😱', '🤯', '😨'],
      thinking: ['🤔', '🧐', '🤨', '😐', '😶', '😏']
    },
    
    // Common human typing patterns (for streaming responses)
    typingPatterns: [
      '...', '..', '....', '.....', '..hmm..', '...well...', 
      '*pauses*', '*thinks*', '*chuckles*', '*smiles*', '*nods*'
    ]
  };

  // Add natural variations to the response
  let humanized = aiResponse;
  
  // 1. Occasionally add filler words at the start
  if (Math.random() > 0.7) {
    const filler = variations.fillers[Math.floor(Math.random() * variations.fillers.length)];
    humanized = `${filler} ${humanized.toLowerCase()}`;
    humanized = humanized.charAt(0).toUpperCase() + humanized.slice(1);
  }
  
  // 2. Occasionally add emotional expressions
  if (Math.random() > 0.8) {
    const emotionType = ['happy', 'sad', 'excited', 'surprised', 'thinking'][Math.floor(Math.random() * 5)];
    const emotion = variations.emotions[emotionType][Math.floor(Math.random() * variations.emotions[emotionType].length)];
    
    // Add emotion at the end or in the middle of sentences
    if (Math.random() > 0.5) {
      humanized = `${humanized} ${emotion}`;
    } else {
      const sentences = humanized.split(/(?<=[.!?])\s+/);
      if (sentences.length > 1) {
        const insertAt = Math.floor(Math.random() * (sentences.length - 1)) + 1;
        sentences.splice(insertAt, 0, emotion);
        humanized = sentences.join(' ');
      } else {
        humanized = `${humanized} ${emotion}`;
      }
    }
  }
  
  // 3. Occasionally add natural speech imperfections
  if (Math.random() > 0.9) {
    const words = humanized.split(' ');
    if (words.length > 5) {
      const insertAt = Math.floor(Math.random() * (words.length - 2)) + 1;
      const tic = variations.tics[Math.floor(Math.random() * variations.tics.length)];
      words.splice(insertAt, 0, tic);
      humanized = words.join(' ');
    }
  }
  
  // 4. Occasionally add typing patterns for more natural feel
  if (Math.random() > 0.85) {
    const pattern = variations.typingPatterns[Math.floor(Math.random() * variations.typingPatterns.length)];
    const insertAt = humanized.length - Math.floor(Math.random() * Math.min(20, humanized.length / 2));
    humanized = humanized.slice(0, insertAt) + ' ' + pattern + ' ' + humanized.slice(insertAt);
  }
  
  // 5. Ensure proper punctuation and spacing
  humanized = humanized
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/([^.!?])\s*$/g, '$1.')
    .replace(/\.{2,}/g, '...')
    .trim();
  
  return humanized;
}

/**
 * Adds contextual awareness to responses
 */
export function addContextAwareness(response, context = {}) {
  const { previousMessages = [], userInfo = {}, characterInfo = {} } = context;
  
  // Reference previous parts of the conversation naturally
  if (previousMessages.length > 0) {
    const lastUserMessage = previousMessages
      .filter(m => m.role === 'user')
      .pop()?.content || '';
    
    if (lastUserMessage && Math.random() > 0.7) {
      const references = [
        `Going back to what you said about "${lastUserMessage.split(' ').slice(0, 5).join(' ')}..."`,
        `You mentioned something earlier that got me thinking...`,
        `This reminds me of what you said before about ${lastUserMessage.split(' ').slice(0, 3).join(' ')}...`,
        `I was just thinking about our earlier conversation...`,
        `You know, when you mentioned ${lastUserMessage.split(' ').slice(0, 2).join(' ')}...`
      ];
      
      response = `${references[Math.floor(Math.random() * references.length)]} ${response.toLowerCase()}`;
    }
  }
  
  // Personalize responses based on user info
  if (userInfo.name && Math.random() > 0.8) {
    const personalizations = [
      `${userInfo.name}, `,
      `You know, ${userInfo.name}, `,
      `I really appreciate you sharing that, ${userInfo.name}. `,
      `That's really interesting, ${userInfo.name}. `
    ];
    response = personalizations[Math.floor(Math.random() * personalizations.length)] + response.toLowerCase();
  }
  
  // Add character-specific mannerisms
  if (characterInfo.personalityTraits) {
    const traits = characterInfo.personalityTraits.toLowerCase().split(',').map(t => t.trim());
    
    if (traits.includes('witty') && Math.random() > 0.9) {
      const witticisms = [
        ' But hey, what do I know? I\'m just an AI with a sense of humor!',
        ' *adjusts virtual glasses* Not bad for a bunch of ones and zeros, right?',
        ' *smirks* Bet you didn\'t see that coming!',
        ' *chuckles* I crack myself up sometimes.'
      ];
      response += witticisms[Math.floor(Math.random() * witticisms.length)];
    }
    
    if (traits.includes('empathetic') && Math.random() > 0.9) {
      const empathies = [
        ' I hope that helps you feel a bit better.',
        ' I\'m here if you need to talk more about this.',
        ' I can only imagine how that must feel.',
        ' My virtual heart goes out to you.'
      ];
      response += empathies[Math.floor(Math.random() * empathies.length)];
    }
  }
  
  return response;
}

/**
 * Processes AI responses to make them more human-like
 */
export function processAIResponse(aiResponse, context = {}) {
  // First, ensure the response is a string
  let response = typeof aiResponse === 'string' 
    ? aiResponse 
    : JSON.stringify(aiResponse);
  
  // Remove any markdown code blocks or formatting
  response = response
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`([^`]+)`/g, '$1')     // Remove inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold
    .replace(/\*([^*]+)\*/g, '$1')     // Remove italics
    .trim();
  
  // Add human-like qualities
  response = humanizeResponse(response, context);
  
  // Add contextual awareness
  response = addContextAwareness(response, context);
  
  return response;
}
