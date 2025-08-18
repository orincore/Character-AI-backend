import supabase from '../config/supabaseClient.js';
import AppError from '../utils/appError.js';
import { v4 as uuidv4 } from 'uuid';
import { uploadToS3, deleteFromS3 } from '../utils/s3.js';
import { generateImageWithStability } from '../utils/stability.js';
import { processImage, getImageOutputConfig } from '../utils/imageProcessor.js';
import { formatCharacterData, validateCharacterData } from '../utils/characterUtils.js';

// Basic gender helper used when generating default first messages
function getGenderInfo(gender) {
  const g = String(gender || '').toLowerCase();
  switch (g) {
    case 'female':
      return { emoji: '💜', pronouns: { subject: 'she', object: 'her', possessive: 'her' } };
    case 'male':
      return { emoji: '💙', pronouns: { subject: 'he', object: 'him', possessive: 'his' } };
    case 'nonbinary':
    case 'nb':
    case 'other':
      return { emoji: '💛', pronouns: { subject: 'they', object: 'them', possessive: 'their' } };
    default:
      return { emoji: '😊', pronouns: { subject: 'they', object: 'them', possessive: 'their' } };
  }
}

// Like a character (idempotent)
export const likeCharacter = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Ensure character exists and is accessible (public or owner)
    await checkCharacterAccess(id, req.user.id, false);

    // Insert like if not exists
    const { error: likeErr } = await supabase
      .from('character_likes')
      .insert({ character_id: id, user_id: req.user.id })
      .select()
      .single();

    if (likeErr && !String(likeErr?.message || '').includes('duplicate')) {
      // If it's not a duplicate primary key error, propagate
      throw likeErr;
    }

    // Recalculate likes_count from character_likes to avoid race conditions
    const { count } = await supabase
      .from('character_likes')
      .select('*', { count: 'exact', head: true })
      .eq('character_id', id);

    await supabase
      .from('characters')
      .update({ likes_count: count || 0, updated_at: new Date().toISOString() })
      .eq('id', id);

    await recomputePopularityScore(id);

    res.status(200).json({ status: 'success', message: 'Liked' });
  } catch (error) {
    next(error);
  }
};

// Unlike a character (idempotent)
export const unlikeCharacter = async (req, res, next) => {
  try {
    const { id } = req.params;
    await checkCharacterAccess(id, req.user.id, false);

    await supabase
      .from('character_likes')
      .delete()
      .eq('character_id', id)
      .eq('user_id', req.user.id);

    const { count } = await supabase
      .from('character_likes')
      .select('*', { count: 'exact', head: true })
      .eq('character_id', id);

    await supabase
      .from('characters')
      .update({ likes_count: count || 0, updated_at: new Date().toISOString() })
      .eq('id', id);

    await recomputePopularityScore(id);

    res.status(200).json({ status: 'success', message: 'Unliked' });
  } catch (error) {
    next(error);
  }
};

// Register a share event and increment counter
export const shareCharacter = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Public feed counts shares on public characters; still allow for shareable or owner
    await checkCharacterAccess(id, req.user.id, false);

    await supabase
      .from('character_share_events')
      .insert({ character_id: id, user_id: req.user.id });

    // Update counter from events
    const { count } = await supabase
      .from('character_share_events')
      .select('*', { count: 'exact', head: true })
      .eq('character_id', id);

    await supabase
      .from('characters')
      .update({ shares_count: count || 0, updated_at: new Date().toISOString() })
      .eq('id', id);

    await recomputePopularityScore(id);

    res.status(200).json({ status: 'success', message: 'Share recorded' });
  } catch (error) {
    next(error);
  }
};

// Register a use event and increment counter
export const useCharacter = async (req, res, next) => {
  try {
    const { id } = req.params;
    await checkCharacterAccess(id, req.user.id, false);

    await supabase
      .from('character_use_events')
      .insert({ character_id: id, user_id: req.user.id });

    const { count } = await supabase
      .from('character_use_events')
      .select('*', { count: 'exact', head: true })
      .eq('character_id', id);

    await supabase
      .from('characters')
      .update({ uses_count: count || 0, updated_at: new Date().toISOString() })
      .eq('id', id);

    await recomputePopularityScore(id);

    res.status(200).json({ status: 'success', message: 'Use recorded' });
  } catch (error) {
    next(error);
  }
};

// Public feed of popular characters
export const getPopularFeed = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = Math.min(50, parseInt(req.query.limit || '12', 10));
    const offset = (page - 1) * limit;

    const { data: items, error, count } = await supabase
      .from('characters')
      .select('*', { count: 'exact' })
      .eq('visibility', 'public')
      .order('popularity_score', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.status(200).json({
      status: 'success',
      data: {
        items: items.map(c => formatCharacterResponse(c, req.user.id)),
        pagination: {
          total: count || 0,
          page,
          limit,
          total_pages: Math.ceil((count || 0) / limit),
          hasMore: offset + (items?.length || 0) < (count || 0)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};


// Format character response with personality traits and metadata
const formatCharacterResponse = (character, userId) => {
  const formatted = formatCharacterData(character);
  return {
    ...formatted,
    is_owner: character.creator_id === userId
  };
};

// Helper to check character access
const checkCharacterAccess = async (characterId, userId, requireOwner = false) => {
  const { data: character, error } = await supabase
    .from('characters')
    .select('creator_id, visibility')
    .eq('id', characterId)
    .single();

  if (error || !character) {
    throw new AppError('Character not found', 404);
  }

  const isOwner = userId && character.creator_id === userId;
  const isPublic = character.visibility === 'public';
  
  // Check if user has explicit access
  let hasSharedAccess = false;
  if (userId && !isOwner) {
    const { count } = await supabase
      .from('character_shares')
      .select('*', { count: 'exact', head: true})
      .eq('character_id', characterId)
      .eq('user_id', userId);
    
    hasSharedAccess = (count || 0) > 0;
  }

  if (requireOwner && !isOwner) {
    throw new AppError('Not authorized to perform this action', 403);
  }

  // If unauthenticated, only allow public
  if (!userId && !isPublic) {
    throw new AppError('Access denied', 403);
  }

  if (userId && !isOwner && !isPublic && !hasSharedAccess) {
    throw new AppError('Access denied', 403);
  }

  return { isOwner, character };
};

// Compute a weighted popularity score with simple freshness decay
async function recomputePopularityScore(characterId) {
  // Fetch needed fields
  const { data: c } = await supabase
    .from('characters')
    .select('id, likes_count, shares_count, uses_count, created_at')
    .eq('id', characterId)
    .single();
  if (!c) return;

  const likes = Number(c.likes_count || 0);
  const shares = Number(c.shares_count || 0);
  const uses = Number(c.uses_count || 0);
  const createdAt = new Date(c.created_at);
  const ageHours = Math.max(0, (Date.now() - createdAt.getTime()) / 36e5);

  // Tunable weights
  const W_LIKE = 3.0;
  const W_SHARE = 5.0;
  const W_USE = 1.0;

  // Freshness bonus decays over ~72h
  const freshness = 25 / (1 + ageHours / 72);

  const score = W_LIKE * likes + W_SHARE * shares + W_USE * uses + freshness;

  await supabase
    .from('characters')
    .update({ popularity_score: score, updated_at: new Date().toISOString() })
    .eq('id', characterId);
}


// Create a new character
export const createCharacter = async (req, res, next) => {
  try {
    const {
      name,
      description,
      persona,
      character_type = 'friend',
      character_gender = 'other',
      visibility = 'private',
      nsfw_enabled = false,
      tags = [],
      first_message,
      example_conversations = [],
      // Extract personality traits from request body
      // These will be whatever the user provides, or undefined if not provided
      flirtiness,
      shyness,
      kindness,
      rudeness,
      confidence,
      intelligence,
      empathy,
      humor,
      aggression,
      openness,
      extroversion,
      patience
    } = req.body;

    // Validate character data
    const { isValid, errors } = validateCharacterData({
      name,
      description,
      persona,
      character_type,
      character_gender,
      first_message,
      tags,
      example_conversations,
      // Include personality traits for validation
      flirtiness,
      shyness,
      kindness,
      rudeness,
      confidence,
      intelligence,
      empathy,
      humor,
      aggression,
      openness,
      extroversion,
      patience
    });
    
    if (!isValid) {
      throw new AppError(`Validation failed: ${errors.join(', ')}`, 400);
    }
    
    // Set default first message based on character type and gender if not provided
    let initialFirstMessage = first_message;
    if (!initialFirstMessage) {
      const genderInfo = getGenderInfo(character_gender);
      const defaultMessages = {
        girlfriend: `Hey there! I'm ${name}. *smiles warmly* How's your day going? ${genderInfo.emoji || '😊'}`,
        boyfriend: `Hey! I'm ${name}. *nods* What's up? ${genderInfo.emoji || '👋'}`,
        friend: `Hi! I'm ${name}. *waves* Nice to meet you! ${genderInfo.emoji || '😊'}`,
        therapist: `Hello, I'm ${name}. *sits attentively* How can I help you today? ${genderInfo.emoji || '💭'}`,
        mentor: `Hello, I'm ${name}. *smiles warmly* What would you like to learn? ${genderInfo.emoji || '📚'}`,
        teacher: `Hello class, I'm ${name}. *stands at the front* Let's begin. ${genderInfo.emoji || '✏️'}`,
        celebrity: `*waves to fans* Hi everyone, I'm ${name}! ${genderInfo.emoji || '🌟'}`,
        other: `Hi, I'm ${name}. *smiles* ${genderInfo.emoji || '👋'}`
      };
      initialFirstMessage = defaultMessages[character_type] || `Hello, I'm ${name}.`;
    }

    // Process personality traits - only include those that are provided
    const personalityTraits = {};
    const traits = [
      'flirtiness', 'shyness', 'kindness', 'rudeness', 'confidence',
      'intelligence', 'empathy', 'humor', 'aggression', 'openness',
      'extroversion', 'patience'
    ];
    
    traits.forEach(trait => {
      if (req.body[trait] !== undefined) {
        const value = parseFloat(req.body[trait]);
        if (!isNaN(value)) {
          // Ensure value is between 0 and 1
          personalityTraits[trait] = Math.max(0, Math.min(1, value));
        }
      }
    });

    // Start with basic character data
    const characterData = {
      id: uuidv4(),
      creator_id: req.user.id,
      name,
      description,
      persona,
      avatar_url: '',
      character_type,
      character_gender,
      visibility,
      nsfw_enabled,
      tags: Array.isArray(tags) ? tags : [],
      first_message: initialFirstMessage || null,
      example_conversations: Array.isArray(example_conversations) ? example_conversations : [],
      updated_at: new Date()
    };
    
    // Add personality traits if they were provided
    Object.entries(personalityTraits).forEach(([key, value]) => {
      if (value !== undefined) {
        characterData[key] = value;
      }
    });

    const { data: character, error } = await supabase
      .from('characters')
      .insert(characterData)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      status: 'success',
      data: {
        character: formatCharacterResponse(character, req.user.id)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get character by ID
export const getCharacter = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id; // optional for public access
    await checkCharacterAccess(id, userId);

    const { data: character, error } = await supabase
      .from('characters')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    res.status(200).json({
      status: 'success',
      data: {
        character: formatCharacterResponse(character, req.user.id)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Update character
export const updateCharacter = async (req, res, next) => {
  try {
    const { id } = req.params;
    await checkCharacterAccess(id, req.user.id, true); // Only owner can update

    // Process personality traits - only include those that are provided
    const personalityTraits = {};
    const traits = [
      'flirtiness', 'shyness', 'kindness', 'rudeness', 'confidence',
      'intelligence', 'empathy', 'humor', 'aggression', 'openness',
      'extroversion', 'patience'
    ];
    
    traits.forEach(trait => {
      if (req.body[trait] !== undefined) {
        const value = parseFloat(req.body[trait]);
        if (!isNaN(value)) {
          // Ensure value is between 0 and 1
          personalityTraits[trait] = Math.max(0, Math.min(1, value));
        }
      }
    });

    // Prepare updates with personality traits
    const updates = { 
      ...req.body,
      ...personalityTraits,
      updated_at: new Date() 
    };
    
    // Don't allow updating creator_id
    delete updates.creator_id;
    
    // If we're updating character data, validate it
    const needsValidation = [
      'name', 'description', 'persona', 'character_type', 
      'character_gender', 'first_message', 'tags', 'example_conversations'
    ].some(field => field in updates);
    
    if (needsValidation) {
      // Get current character data to fill in missing fields
      const { data: currentCharacter } = await supabase
        .from('characters')
        .select('*')
        .eq('id', id)
        .single();
      
      if (!currentCharacter) {
        throw new AppError('Character not found', 404);
      }
      
      // Create a complete character object with updates applied
      const updatedCharacter = {
        ...currentCharacter,
        ...updates,
        // Ensure these are properly formatted
        tags: Array.isArray(updates.tags) ? updates.tags : currentCharacter.tags || [],
        example_conversations: Array.isArray(updates.example_conversations) 
          ? updates.example_conversations 
          : currentCharacter.example_conversations || []
      };
      
      // Validate the updated character data
      const { isValid, errors } = validateCharacterData(updatedCharacter);
      if (!isValid) {
        throw new AppError(`Validation failed: ${errors.join(', ')}`, 400);
      }
    }
    
    // Ensure tags and example_conversations are arrays
    if (updates.tags !== undefined) {
      updates.tags = Array.isArray(updates.tags) ? updates.tags : [];
    }
    
    if (updates.example_conversations !== undefined) {
      updates.example_conversations = Array.isArray(updates.example_conversations) 
        ? updates.example_conversations 
        : [];
    }

    const { data: character, error } = await supabase
      .from('characters')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({
      status: 'success',
      data: {
        character: formatCharacterResponse(character, req.user.id)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Delete character
export const deleteCharacter = async (req, res, next) => {
  try {
    const { id } = req.params;
    await checkCharacterAccess(id, req.user.id, true); // Only owner can delete

    const { error } = await supabase
      .from('characters')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.status(204).json({
      status: 'success',
      data: null
    });
  } catch (error) {
    next(error);
  }
};

// List characters
export const listCharacters = async (req, res, next) => {
  try {
    const { type, search } = req.query;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);
    const offset = (page - 1) * limit;

    let query = supabase
      .from('characters')
      .select('*', { count: 'exact' })
      .eq('creator_id', req.user.id)
      .order('created_at', { ascending: false });

    // Apply filters
    if (type) {
      query = query.eq('character_type', type);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    // Get total count for pagination
    const { data: characters, error, count } = await query.range(offset, offset + limit - 1);

    if (error) throw error;

    res.status(200).json({
      status: 'success',
      data: {
        characters: characters.map(char => formatCharacterResponse(char, req.user.id)),
        pagination: {
          total: count || 0,
          page,
          limit,
          offset,
          total_pages: Math.ceil((count || 0) / limit),
          hasMore: offset + (characters?.length || 0) < (count || 0)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Upload character avatar
export const uploadAvatar = async (req, res, next) => {
  try {
    const { id } = req.params;
    await checkCharacterAccess(id, req.user.id, true); // Only owner can upload avatar

    if (!req.file) {
      throw new AppError('Please upload a file', 400);
    }

    const file = req.file;

    // Fetch existing avatar URL to delete after successful replacement
    let oldAvatarUrl = null;
    try {
      const { data: existing } = await supabase
        .from('characters')
        .select('avatar_url')
        .eq('id', id)
        .single();
      oldAvatarUrl = existing?.avatar_url || null;
    } catch (_) {}
    
    // Process the image (compress and resize)
    const processedImage = await processImage(file.buffer, {
      maxWidth: 800,
      quality: 80
    });
    
    // Get output configuration
    const { contentType, fileExtension } = getImageOutputConfig();
    
    // Generate file path with new extension
    const fileName = `${uuidv4()}.${fileExtension}`;
    const filePath = `avatars/${id}/${fileName}`;

    // Upload to S3 and get the URL
    console.log('Starting S3 upload...', { 
      fileSize: processedImage.length,
      contentType,
      filePath 
    });
    
    const uploadResult = await uploadToS3({
      Key: filePath,
      Body: processedImage,
      ContentType: contentType,
      CacheControl: 'max-age=31536000' // Cache for 1 year
    });
    
    console.log('S3 upload result:', uploadResult);
    const avatarUrl = uploadResult.url;
    
    const { data: character, error } = await supabase
      .from('characters')
      .update({ 
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Best-effort delete of old avatar if it exists and differs
    if (oldAvatarUrl && oldAvatarUrl !== avatarUrl) {
      try { await deleteFromS3(oldAvatarUrl); } catch (e) { console.warn('Failed to delete old avatar:', e?.message || e); }
    }

    res.status(200).json({
      status: 'success',
      data: {
        avatar_url: avatarUrl,
        character: formatCharacterResponse(character, req.user.id)
      }
    });
  } catch (error) {
    console.error('Error in uploadAvatar:', error);
    next(error);
  }
};

// Generate character avatar via Stability AI (owner only)
export const generateCharacterAvatar = async (req, res, next) => {
  try {
    const { id } = req.params;
    await checkCharacterAccess(id, req.user.id, true);

    const { prompt, output_format = 'webp', width, height, seed, model } = req.body || {};
    if (!prompt || !prompt.trim()) {
      throw new AppError('Prompt is required', 400);
    }

    // Fetch existing avatar URL to delete after successful replacement
    let oldAvatarUrl = null;
    try {
      const { data: existing } = await supabase
        .from('characters')
        .select('avatar_url')
        .eq('id', id)
        .single();
      oldAvatarUrl = existing?.avatar_url || null;
    } catch (_) {}

    const { buffer, contentType } = await generateImageWithStability({
      prompt: prompt.trim(), output_format, width, height, seed, model
    });

    const ext = contentType === 'image/png' ? 'png' : (contentType === 'image/jpeg' ? 'jpg' : 'webp');
    const fileName = `${uuidv4()}.${ext}`;
    const filePath = `avatars/${id}/${fileName}`;

    const uploadResult = await uploadToS3({
      Key: filePath,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'max-age=31536000'
    });

    const avatarUrl = uploadResult.url;

    const { data: character, error } = await supabase
      .from('characters')
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    // Best-effort delete of old avatar if it exists and differs
    if (oldAvatarUrl && oldAvatarUrl !== avatarUrl) {
      try { await deleteFromS3(oldAvatarUrl); } catch (e) { console.warn('Failed to delete old avatar:', e?.message || e); }
    }

    res.status(200).json({
      status: 'success',
      data: { avatar_url: avatarUrl, character: formatCharacterResponse(character, req.user.id) }
    });
  } catch (error) {
    next(error);
  }
};
