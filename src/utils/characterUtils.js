// Local minimal gender info to avoid prompts.js dependency
const GENDER_INFO_MAP = {
  male: { title: 'Male', pronouns: { casual: 'he/him', formal: 'he/him' } },
  female: { title: 'Female', pronouns: { casual: 'she/her', formal: 'she/her' } },
  nonbinary: { title: 'Non-binary', pronouns: { casual: 'they/them', formal: 'they/them' } },
  other: { title: 'Other', pronouns: { casual: 'they/them', formal: 'they/them' } }
};

function getGenderInfoLocal(key = 'other') {
  const k = String(key || 'other').toLowerCase();
  return GENDER_INFO_MAP[k] || GENDER_INFO_MAP.other;
}

/**
 * Formats character data with consistent defaults and structure
 */
export function formatCharacterData(character) {
  if (!character) return null;

  // Personality traits - will use whatever is in the character object
  // from the database, with no hardcoded defaults
  const personalityTraits = { ...character };

  // Extract gender info (local)
  const genderInfo = getGenderInfoLocal(character.character_gender || 'other');
  
  // Build the formatted character
  return {
    id: character.id,
    creator_id: character.creator_id,
    name: character.name || 'Unnamed Character',
    description: character.description || '',
    persona: character.persona || '',
    // Use the same URL decoding technique used for user profile pictures
    avatar_url: (() => {
      const raw = character.avatar_url || '';
      if (!raw) return '';
      try {
        // decodeURI preserves reserved characters but decodes %20 etc.
        return decodeURI(raw);
      } catch (_) {
        return raw;
      }
    })(),
    character_type: character.character_type || 'friend',
    character_gender: character.character_gender || 'other',
    visibility: character.visibility || 'private',
    nsfw_enabled: Boolean(character.nsfw_enabled),
    tags: Array.isArray(character.tags) ? character.tags : [],
    first_message: character.first_message || '',
    example_conversations: Array.isArray(character.example_conversations) 
      ? character.example_conversations 
      : [],
    created_at: character.created_at || new Date().toISOString(),
    updated_at: character.updated_at || new Date().toISOString(),
    
    // Personality traits
    ...personalityTraits,
    
    // Gender information
    gender_info: genderInfo,
    
    // Helper methods
    get full_description() {
      return [this.description, this.persona].filter(Boolean).join('\n\n');
    },
    
    get display_name() {
      return this.name || 'Unnamed Character';
    },
    
    get display_gender() {
      return genderInfo?.title || 'Other';
    },
    
    get display_type() {
      // Convert snake_case to Title Case
      return (this.character_type || 'other')
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
  };
}

/**
 * Validates character data before saving to the database
 */
export function validateCharacterData(characterData) {
  const errors = [];
  
  // Required fields
  if (!characterData.name?.trim()) {
    errors.push('Name is required');
  }
  
  if (!characterData.description?.trim()) {
    errors.push('Description is required');
  }
  
  if (!characterData.persona?.trim()) {
    errors.push('Persona is required');
  }
  
  // Validate character type
  const validCharacterTypes = [
    'girlfriend', 'boyfriend', 'friend', 'therapist', 'other',
    'mentor', 'teacher', 'celebrity', 'idol', 'co-worker',
    'classmate', 'family', 'fictional hero', 'game character'
  ];
  
  if (characterData.character_type && !validCharacterTypes.includes(characterData.character_type)) {
    errors.push(`Invalid character type. Must be one of: ${validCharacterTypes.join(', ')}`);
  }
  
  // Validate gender
  const validGenders = ['male', 'female', 'nonbinary', 'other'];
  if (characterData.character_gender && !validGenders.includes(characterData.character_gender)) {
    errors.push(`Invalid gender. Must be one of: ${validGenders.join(', ')}`);
  }
  
  // Validate personality traits (0.0 to 1.0)
  const personalityTraits = [
    'flirtiness', 'shyness', 'kindness', 'rudeness', 'confidence',
    'intelligence', 'empathy', 'humor', 'aggression', 'openness',
    'extroversion', 'patience'
  ];
  
  for (const trait of personalityTraits) {
    if (characterData[trait] !== undefined) {
      const value = parseFloat(characterData[trait]);
      if (isNaN(value) || value < 0 || value > 1) {
        errors.push(`${trait} must be a number between 0.0 and 1.0`);
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
