import supabase from '../config/supabaseClient.js';
import AppError from '../utils/appError.js';
import { v4 as uuidv4 } from 'uuid';
import { uploadToS3 } from '../utils/s3.js';
import { processImage, getImageOutputConfig } from '../utils/imageProcessor.js';

// Format character response with personality traits
const formatCharacterResponse = (character, userId) => {
  const personalityTraits = {};
  const personalityKeys = [
    'flirtiness', 'shyness', 'kindness', 'rudeness', 'confidence',
    'intelligence', 'empathy', 'humor', 'aggression', 'openness',
    'extroversion', 'patience'
  ];

  personalityKeys.forEach(trait => {
    if (character[trait] !== undefined) {
      personalityTraits[trait] = parseFloat(character[trait]);
    }
  });

  return {
    id: character.id,
    creator_id: character.creator_id,
    name: character.name,
    description: character.description,
    persona: character.persona,
    avatar_url: character.avatar_url,
    character_type: character.character_type,
    visibility: character.visibility,
    nsfw_enabled: character.nsfw_enabled,
    tags: character.tags || [],
    first_message: character.first_message,
    example_conversations: character.example_conversations || [],
    personality: personalityTraits,
    is_owner: character.creator_id === userId,
    created_at: character.created_at,
    updated_at: character.updated_at
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

  const isOwner = character.creator_id === userId;
  const isPublic = character.visibility === 'public';
  
  // Check if user has explicit access
  let hasSharedAccess = false;
  if (!isOwner) {
    const { count } = await supabase
      .from('character_shares')
      .select('*', { count: 'exact', head: true })
      .eq('character_id', characterId)
      .eq('user_id', userId);
    
    hasSharedAccess = (count || 0) > 0;
  }

  if (requireOwner && !isOwner) {
    throw new AppError('Not authorized to perform this action', 403);
  }

  if (!isOwner && !isPublic && !hasSharedAccess) {
    throw new AppError('Access denied', 403);
  }

  return { isOwner, character };
};

// Default personality traits
const DEFAULT_PERSONALITY = {
  flirtiness: 0.5,
  shyness: 0.5,
  kindness: 0.7,
  rudeness: 0.3,
  confidence: 0.6,
  intelligence: 0.7,
  empathy: 0.7,
  humor: 0.5,
  aggression: 0.2,
  openness: 0.7,
  extroversion: 0.6,
  patience: 0.7
};

// Create a new character
export const createCharacter = async (req, res, next) => {
  try {
    const {
      name,
      description,
      persona,
      character_type,
      visibility = 'private',
      nsfw_enabled = false,
      tags = [],
      first_message,
      example_conversations = [],
      // Personality traits (0.0 to 1.0)
      flirtiness = 0.5,
      shyness = 0.5,
      kindness = 0.7,
      rudeness = 0.3,
      confidence = 0.6,
      intelligence = 0.7,
      empathy = 0.7,
      humor = 0.5,
      aggression = 0.2,
      openness = 0.7,
      extroversion = 0.6,
      patience = 0.7
    } = req.body;

    if (!name || !description || !persona || !character_type) {
      throw new AppError('Missing required fields', 400);
    }

    // Validate personality traits
    const personalityTraits = {
      flirtiness: Math.max(0, Math.min(1, parseFloat(flirtiness) || 0.5)),
      shyness: Math.max(0, Math.min(1, parseFloat(shyness) || 0.5)),
      kindness: Math.max(0, Math.min(1, parseFloat(kindness) || 0.7)),
      rudeness: Math.max(0, Math.min(1, parseFloat(rudeness) || 0.3)),
      confidence: Math.max(0, Math.min(1, parseFloat(confidence) || 0.6)),
      intelligence: Math.max(0, Math.min(1, parseFloat(intelligence) || 0.7)),
      empathy: Math.max(0, Math.min(1, parseFloat(empathy) || 0.7)),
      humor: Math.max(0, Math.min(1, parseFloat(humor) || 0.5)),
      aggression: Math.max(0, Math.min(1, parseFloat(aggression) || 0.2)),
      openness: Math.max(0, Math.min(1, parseFloat(openness) || 0.7)),
      extroversion: Math.max(0, Math.min(1, parseFloat(extroversion) || 0.6)),
      patience: Math.max(0, Math.min(1, parseFloat(patience) || 0.7))
    };

    const characterData = {
      creator_id: req.user.id,
      name,
      description,
      persona,
      character_type,
      visibility,
      nsfw_enabled,
      tags: Array.isArray(tags) ? tags : [],
      first_message: first_message || null,
      example_conversations: Array.isArray(example_conversations) ? example_conversations : [],
      ...personalityTraits,
      updated_at: new Date()
    };

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
    const { isOwner } = await checkCharacterAccess(id, req.user.id);

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

    // Extract and validate personality traits if provided
    const personalityTraits = {};
    const personalityKeys = [
      'flirtiness', 'shyness', 'kindness', 'rudeness', 'confidence',
      'intelligence', 'empathy', 'humor', 'aggression', 'openness',
      'extroversion', 'patience'
    ];

    personalityKeys.forEach(trait => {
      if (req.body[trait] !== undefined) {
        personalityTraits[trait] = Math.max(0, Math.min(1, parseFloat(req.body[trait]) || DEFAULT_PERSONALITY[trait]));
      }
    });

    // Prepare updates
    const updates = { 
      ...req.body,
      ...personalityTraits,
      updated_at: new Date() 
    };
    
    // Don't allow updating creator_id and handle special fields
    delete updates.creator_id;
    
    // Handle tags and example_conversations if provided
    if (updates.tags && !Array.isArray(updates.tags)) {
      updates.tags = [];
    }
    
    if (updates.example_conversations && !Array.isArray(updates.example_conversations)) {
      updates.example_conversations = [];
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
    const { type, search, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('characters')
      .select('*', { count: 'exact' })
      .or(`creator_id.eq.${req.user.id},visibility.eq.public`)
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
          total: count,
          page: parseInt(page),
          total_pages: Math.ceil((count || 0) / limit)
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
